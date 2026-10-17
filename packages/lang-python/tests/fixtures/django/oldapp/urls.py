from django.urls import path

from . import views

# Not reached from ROOT_URLCONF: no routes.
urlpatterns = [
    path("old/", views.old),
]
