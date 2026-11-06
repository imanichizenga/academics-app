from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from apps.catalog.views import SiteView
from apps.payments.views import SnippeWebhookView


def health(request):
    return JsonResponse({"status": "ok"})


urlpatterns = [
    path("django-admin/", admin.site.urls),
    path("api/health/", health),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema")),
    path("api/payments/webhooks/snippe/", SnippeWebhookView.as_view()),
    path("api/v1/auth/", include("apps.accounts.urls")),
    path("api/v1/site/", SiteView.as_view()),
    path("api/v1/catalog/", include("apps.catalog.urls")),
    path("api/v1/media/", include("apps.media_library.urls")),
    path("api/v1/", include("apps.payments.urls")),
    path("api/v1/", include("apps.engagement.urls")),
    path("api/v1/admin/", include("apps.adminapi.urls")),
]
