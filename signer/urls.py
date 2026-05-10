from django.urls import path
from . import views

urlpatterns = [
    path('', views.upload_document, name='upload_document'),
    path('view/original/<uuid:doc_id>/', views.view_original_pdf, name='view_original_pdf'),
    path('sign/<uuid:doc_id>/', views.sign_document, name='sign_document'),
    path('api/apply-signature/', views.apply_signature, name='apply_signature'),
    path('download/signed/<uuid:doc_id>/', views.download_signed_pdf, name='download_signed_pdf'),
]
