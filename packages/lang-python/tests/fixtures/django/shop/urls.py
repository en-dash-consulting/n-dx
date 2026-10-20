from django.contrib.auth.decorators import login_required
from django.urls import path

from . import views

urlpatterns = [
    path("cart/", views.CartView.as_view()),
    path("checkout/", login_required(views.checkout)),
] + [
    path("ping/", lambda request: None),
]
