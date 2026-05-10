import io
from django.shortcuts import render, redirect, get_object_or_404
from django.http import JsonResponse
from django.core.files.base import ContentFile
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from PIL import Image

from .models import Document, Signature
from .forms import DocumentUploadForm

def upload_document(request):
    if request.method == 'POST':
        form = DocumentUploadForm(request.POST, request.FILES)
        if form.is_valid():
            doc = form.save()
            return redirect('sign_document', doc_id=doc.id)
    else:
        form = DocumentUploadForm()
    
    return render(request, 'signer/upload.html', {'form': form})

def sign_document(request, doc_id):
    doc = get_object_or_404(Document, id=doc_id)
    return render(request, 'signer/sign.html', {'doc': doc})

def apply_signature(request):
    """
    API endpoint to apply the signature.
    Expects POST parameters:
    - doc_id: UUID
    - signature_file: file (PNG)
    - x: float (x coordinate in PDF points)
    - y: float (y coordinate in PDF points)
    - width: float (width in PDF points)
    - height: float (height in PDF points)
    - page_num: int (1-based index)
    """
    if request.method == 'POST':
        doc_id = request.POST.get('doc_id')
        x = float(request.POST.get('x', 0))
        y = float(request.POST.get('y', 0))
        width = float(request.POST.get('width', 100))
        height = float(request.POST.get('height', 50))
        page_num = int(request.POST.get('page_num', 1)) - 1 # 0-based for pypdf
        signature_file = request.FILES.get('signature_file')

        if not doc_id or not signature_file:
            return JsonResponse({'error': 'Missing document ID or signature file'}, status=400)

        doc = get_object_or_404(Document, id=doc_id)
        
        # Save signature to DB
        sig = Signature.objects.create(image=signature_file)

        try:
            # 1. Read existing PDF
            existing_pdf = PdfReader(doc.original_pdf.path)
            output = PdfWriter()

            # The page we want to sign
            target_page = existing_pdf.pages[page_num]
            # Get dimensions (media box usually has coordinates from 0,0)
            page_width = float(target_page.mediabox.width)
            page_height = float(target_page.mediabox.height)

            # 2. Create the overlay PDF in memory
            packet = io.BytesIO()
            # reportlab defaults to bottom-left origin
            can = canvas.Canvas(packet, pagesize=(page_width, page_height))
            
            # Using ImageReader to handle image transparency correctly
            img_reader = ImageReader(sig.image.path)
            
            # PDF coordinates: y is from bottom in reportlab, but JS might send y from top.
            # Assuming the JS sends (x,y) from bottom-left (standard PDF coordinates)
            can.drawImage(img_reader, x, y, width=width, height=height, mask='auto')
            can.save()

            packet.seek(0)
            new_pdf = PdfReader(packet)

            # 3. Merge pages
            for i in range(len(existing_pdf.pages)):
                page = existing_pdf.pages[i]
                if i == page_num:
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
                'signed_url': doc.signed_pdf.url
            })
            
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=500)

    return JsonResponse({'error': 'Invalid request'}, status=400)
