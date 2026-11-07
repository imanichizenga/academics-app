import re

from django.http import JsonResponse

from .models import SiteSettings


class MaintenanceMiddleware:
    """While maintenance is on, students get a 503. Staff, sign-in and payments in flight keep working."""

    OPEN = ("/api/health/", "/api/schema/", "/api/docs/", "/api/payments/webhooks/", "/api/v1/auth/", "/api/v1/site/",
            "/api/v1/admin/", "/api/v1/media/public/")  # public/ holds the logo the maintenance page itself shows
    IN_FLIGHT = re.compile(r"^/api/v1/orders/[0-9a-f-]{36}/(status|claim|cancel|resend)/$")

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path
        if (path.startswith("/api/") and not path.startswith(self.OPEN) and not self.IN_FLIGHT.match(path)
                and SiteSettings.load().maintenance_mode):
            from apps.accounts.authentication import staff_session

            if not staff_session(request):
                message = "We are down for maintenance. Please try again soon."
                response = JsonResponse({"code": "maintenance", "error": {"code": "maintenance", "message": message}},
                                        status=503)
                response["Retry-After"] = "300"
                return response
        return self.get_response(request)


class ApiSecurityHeadersMiddleware:
    """The API returns JSON only, so it can carry the strictest CSP. The Django admin is exempt."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if request.path.startswith("/api/") and not request.path.startswith("/api/docs"):
            response.headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        return response
