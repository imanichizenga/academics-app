from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import ProtectedError
from rest_framework import exceptions, status
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle


class Pagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100

    def get_paginated_response(self, data):
        return Response(
            {
                "count": self.page.paginator.count,
                "page": self.page.number,
                "total_pages": self.page.paginator.num_pages,
                "next": self.page.next_page_number() if self.page.has_next() else None,
                "previous": self.page.previous_page_number() if self.page.has_previous() else None,
                "results": data,
            }
        )

    def get_paginated_response_schema(self, schema):
        return {
            "type": "object",
            "properties": {
                "count": {"type": "integer"},
                "page": {"type": "integer"},
                "total_pages": {"type": "integer"},
                "next": {"type": "integer", "nullable": True},
                "previous": {"type": "integer", "nullable": True},
                "results": schema,
            },
        }


class ApiError(exceptions.APIException):
    """An error with a stable machine-readable code for the frontend to switch on."""

    def __init__(self, message, code="error", status_code=400, extra=None):
        self.detail = message
        self.error_code = code
        self.status_code = status_code
        self.extra = extra or {}


def _first(value):
    while isinstance(value, (list, tuple)) and value:
        value = value[0]
    return str(value)


def exception_handler(exc, context):
    """Every error is {error: {code, message, fields?}}."""
    from rest_framework.views import exception_handler as drf_handler

    if isinstance(exc, DjangoValidationError):
        exc = exceptions.ValidationError(getattr(exc, "message_dict", None) or exc.messages)
    if isinstance(exc, ProtectedError):
        exc = ApiError("This item is still in use, so it cannot be deleted.", "in_use", 409)
    response = drf_handler(exc, context)
    if response is None:
        return None
    body = {"code": getattr(exc, "error_code", None) or getattr(exc, "default_code", "error")}
    if isinstance(exc, exceptions.ValidationError) and isinstance(exc.detail, dict):
        fields = {k: _first(v) for k, v in exc.detail.items()}
        body.update(code="validation_error", fields=fields)
        body["message"] = fields.get("non_field_errors") or next(iter(fields.values()), "Invalid input.")
    elif isinstance(exc, exceptions.ValidationError):
        body.update(code="validation_error", message=_first(exc.detail))
    elif isinstance(exc, exceptions.Throttled):
        body.update(code="rate_limited", message="Too many attempts. Please wait a moment and try again.")
    else:
        body["message"] = str(getattr(exc, "detail", exc))
    body.update(getattr(exc, "extra", {}))
    response.data = {"error": body}
    return response


class IsStudentOrAbove(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated)


class IsEditorOrAdmin(BasePermission):
    """Editors manage content, media and comments."""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_staff_role)


class IsAdminRole(BasePermission):
    """Admins manage everything else: money, users, settings."""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role == "admin")


class ScopedIP(SimpleRateThrottle):
    def get_cache_key(self, request, view):
        ident = request.user.pk if request.user and request.user.is_authenticated else self.get_ident(request)
        return f"throttle_{self.scope}_{ident}"


def scoped(name):
    return type(f"{name.title()}Throttle", (ScopedIP,), {"scope": name})


LoginThrottle = scoped("login")
CheckoutThrottle = scoped("checkout")
ResendThrottle = scoped("resend_push")
CommentThrottle = scoped("comments")
WebhookThrottle = scoped("webhook")
PayoutThrottle = scoped("payout")
OtpThrottle = scoped("otp")
ClaimThrottle = scoped("claim")

__all__ = ["ApiError", "Pagination", "status"]
