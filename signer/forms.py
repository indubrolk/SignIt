from django import forms
from .models import Document

class DocumentUploadForm(forms.ModelForm):
    class Meta:
        model = Document
        fields = ['original_pdf']
        widgets = {
            'original_pdf': forms.FileInput(attrs={'accept': 'application/pdf', 'class': 'file-input', 'id': 'pdf-upload'})
        }
