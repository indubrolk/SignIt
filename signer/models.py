import uuid
from django.db import models

class Document(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    original_pdf = models.FileField(upload_to='pdfs/')
    signed_pdf = models.FileField(upload_to='signed_pdfs/', null=True, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Document {self.id} - {self.uploaded_at.strftime('%Y-%m-%d %H:%M')}"

class Signature(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    image = models.FileField(upload_to='signatures/')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Signature {self.id}"
