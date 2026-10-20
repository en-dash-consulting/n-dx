from django.urls import path

from shop import views

patterns = [
    path("faq/", views.faq),
]
