from django.urls import path, re_path

from . import views

app_name = "blog"
urlpatterns = [
    path("", views.index),
    path("<int:year>/", views.year_archive, name="year"),
    re_path(r"^(?P<slug>[\w-]+)/$", views.post_detail),
]
