from django.urls import path
from . import views

urlpatterns = [
    path('', views.upload_document, name='upload_document'),
    path('sign/<uuid:doc_id>/', views.sign_document, name='sign_document'),
    path('api/apply-signature/', views.apply_signature, name='apply_signature'),
]
