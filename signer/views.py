import io
import os
import numpy as np
from django.shortcuts import render, redirect, get_object_or_404
from django.http import JsonResponse, FileResponse, Http404
from django.urls import reverse
from django.core.files.base import ContentFile
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from PIL import Image

from .models import Document, Signature
from .forms import DocumentUploadForm


def _allow_doc_access(request, doc_id):
    allowed = request.session.get('allowed_docs', [])
    doc_id_str = str(doc_id)
    if doc_id_str not in allowed:
        allowed.append(doc_id_str)
        request.session['allowed_docs'] = allowed


def _has_doc_access(request, doc_id):
    allowed = request.session.get('allowed_docs', [])
    return str(doc_id) in allowed


def remove_signature_background(image_file, threshold=200):
    """
    Remove white/light background from a signature image.
    Converts light pixels (above threshold brightness) to transparent.
    Returns a ContentFile containing the processed PNG with transparency.
    """
    img = Image.open(image_file).convert('RGBA')
    data = np.array(img)

    # Calculate brightness from RGB channels
    # Pixels where R, G, and B are all above the threshold are considered background
    r, g, b, a = data[:, :, 0], data[:, :, 1], data[:, :, 2], data[:, :, 3]
    is_light = (r > threshold) & (g > threshold) & (b > threshold)

    # Set alpha to 0 for light (background) pixels
    data[:, :, 3] = np.where(is_light, 0, a)

    # Create the processed image
    result = Image.fromarray(data, 'RGBA')

    # Save to buffer
    buffer = io.BytesIO()
    result.save(buffer, format='PNG')
    buffer.seek(0)

    # Return as a Django ContentFile
    original_name = getattr(image_file, 'name', 'signature.png')
    return ContentFile(buffer.read(), name=original_name)

def upload_document(request):
    if request.method == 'POST':
        form = DocumentUploadForm(request.POST, request.FILES)
        if form.is_valid():
            doc = form.save()
            _allow_doc_access(request, doc.id)
            return redirect('sign_document', doc_id=doc.id)
    else:
        form = DocumentUploadForm()
    
    return render(request, 'signer/upload.html', {'form': form})

def sign_document(request, doc_id):
    if not _has_doc_access(request, doc_id):
        raise Http404()
    doc = get_object_or_404(Document, id=doc_id)
    return render(request, 'signer/sign.html', {'doc': doc})

import json

def apply_signature(request):
    """
    API endpoint to apply multiple signatures.
    Expects POST parameters:
    - doc_id: UUID
    - signatures_data: JSON string of array [{id, page_num, x, y, width, height}]
    - file_<sig_id>: PNG file for each signature
    """
    if request.method == 'POST':
        doc_id = request.POST.get('doc_id')
        signatures_data_str = request.POST.get('signatures_data')

        if not doc_id or not signatures_data_str:
            return JsonResponse({'error': 'Missing document ID or signature data'}, status=400)

        try:
            signatures_data = json.loads(signatures_data_str)
            if not _has_doc_access(request, doc_id):
                return JsonResponse({'error': 'Not found'}, status=404)
            doc = get_object_or_404(Document, id=doc_id)
            
            # 1. Read existing PDF
            existing_pdf = PdfReader(doc.original_pdf.path)
            output = PdfWriter()

            # We need to create an overlay for each page that has signatures
            # Map page_num (1-based) to a list of signature tasks
            page_overlays = {}
            
            for sig in signatures_data:
                page_num = int(sig['page_num']) - 1 # 0-based for pypdf
                file_key = f"file_{sig['id']}"
                sig_file = request.FILES.get(file_key)
                
                if not sig_file:
                    continue
                
                # Remove background from signature image
                processed_file = remove_signature_background(sig_file)
                
                # Save signature to DB
                sig_record = Signature.objects.create(image=processed_file)
                
                if page_num not in page_overlays:
                    page_overlays[page_num] = []
                    
                page_overlays[page_num].append({
                    'record': sig_record,
                    'x': float(sig['x']),
                    'y': float(sig['y']),
                    'width': float(sig['width']),
                    'height': float(sig['height'])
                })

            # Process each page
            for i in range(len(existing_pdf.pages)):
                page = existing_pdf.pages[i]
                
                if i in page_overlays:
                    page_width = float(page.mediabox.width)
                    page_height = float(page.mediabox.height)
                    
                    packet = io.BytesIO()
                    can = canvas.Canvas(packet, pagesize=(page_width, page_height))
                    
                    for sig_task in page_overlays[i]:
                        img_reader = ImageReader(sig_task['record'].image.path)
                        can.drawImage(img_reader, sig_task['x'], sig_task['y'], 
                                      width=sig_task['width'], height=sig_task['height'], mask='auto')
                    
                    can.save()
                    packet.seek(0)
                    new_pdf = PdfReader(packet)
                    page.merge_page(new_pdf.pages[0])
                    
                output.add_page(page)

            # 4. Save signed PDF
            output_packet = io.BytesIO()
            output.write(output_packet)
            output_packet.seek(0)
            
            file_name = f"signed_{doc.original_pdf.name.split('/')[-1]}"
            doc.signed_pdf.save(file_name, ContentFile(output_packet.read()))
            doc.save()

            return JsonResponse({
                'success': True,
                'download_url': reverse('download_signed_pdf', kwargs={'doc_id': doc.id})
            })
            
        except Exception as e:
            import traceback
            traceback.print_exc()
            return JsonResponse({'error': str(e)}, status=500)

    return JsonResponse({'error': 'Invalid request'}, status=400)


def download_signed_pdf(request, doc_id):
    if not _has_doc_access(request, doc_id):
        raise Http404()
    doc = get_object_or_404(Document, id=doc_id)
    if not doc.signed_pdf:
        return JsonResponse({'error': 'Signed PDF not found'}, status=404)

    file_handle = doc.signed_pdf.open('rb')
    filename = os.path.basename(doc.signed_pdf.name)
    response = FileResponse(file_handle, content_type='application/pdf')
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


def view_original_pdf(request, doc_id):
    if not _has_doc_access(request, doc_id):
        raise Http404()
    doc = get_object_or_404(Document, id=doc_id)
    file_handle = doc.original_pdf.open('rb')
    filename = os.path.basename(doc.original_pdf.name)
    response = FileResponse(file_handle, content_type='application/pdf')
    response['Content-Disposition'] = f'inline; filename="{filename}"'
    return response
