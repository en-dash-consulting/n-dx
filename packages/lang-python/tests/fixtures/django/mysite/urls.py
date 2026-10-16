from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path
from rest_framework.routers import DefaultRouter

from blog import urls as blog_urls
from shop import views as shop_views

from . import extra

router = DefaultRouter()
router.register(r"sites", shop_views.SiteViewSet)
router.register("racks", shop_views.RackViewSet)

urlpatterns = [
    path("", shop_views.home, name="home"),
    path("admin/", admin.site.urls),
    # The same URLconf included three times: by string, by module, under a prefix that is not a literal.
    path("blog/", include("blog.urls")),
    path("archive/", include(blog_urls)),
    path(settings.DYNAMIC_PREFIX, include("blog.urls")),
    path("shop/", include(("shop.urls", "shop"), namespace="shop")),
    path("api/", include(router.urls)),
    path("extra/", include(extra.patterns)),
    path(
        "inline/",
        include([
            path("one/", shop_views.one),
            re_path(r"^two/(?P<n>\d+)/$", shop_views.two),
        ]),
    ),
    path("missing/", include(somewhere.urls)),
]

urlpatterns += [
    path("sites/", shop_views.SiteListView.as_view(), name="sites"),
]

# A router defined in another module: left out silently, as router.urls is.
from .routers import device_router

urlpatterns += [
    path("dcim/", include(device_router.urls)),
]
