import secrets

from django.conf import settings
from django.core import signing
from django.utils import timezone
from drf_spectacular.extensions import OpenApiAuthenticationExtension
from rest_framework import exceptions
from rest_framework.permissions import SAFE_METHODS
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from apps.core.api import ApiError

ACCESS_COOKIE = "access"
REFRESH_COOKIE = "refresh"
CSRF_COOKIE = "csrf_token"
IMPERSONATE_COOKIE = "view_as"
# A forced password change only blocks password logins; these remain reachable while it is pending.
GATE_ALLOWED = ("/api/v1/auth/", "/api/v1/site/")


class CookieJWTAuthentication(JWTAuthentication):
    """JWT from an httpOnly cookie, with a double-submit CSRF check on unsafe methods.

    A bad or expired cookie makes the request anonymous rather than failing it: public pages must
    keep working for someone whose session lapsed. The client refreshes on 401 from protected calls.
    """

    def authenticate(self, request):
        raw = request.COOKIES.get(ACCESS_COOKIE)
        if not raw:
            return None
        try:
            token = self.get_validated_token(raw)
            user = self.get_user(token)
        except (InvalidToken, TokenError, exceptions.AuthenticationFailed):
            return None
        if token.get("tv", 0) != user.token_version:
            return None
        if request.method not in SAFE_METHODS:
            header = request.META.get("HTTP_X_CSRF_TOKEN", "")
            cookie = request.COOKIES.get(CSRF_COOKIE, "")
            if not cookie or not secrets.compare_digest(header, cookie):
                raise exceptions.PermissionDenied("CSRF check failed. Refresh the page and try again.")
        if token.get("pwc") and user.must_change_password and not request.path.startswith(GATE_ALLOWED):
            raise ApiError("Please change your password to continue.", "password_change_required", 403)
        self._touch(user)
        target = self._impersonated(request, user)
        if target is not None:
            if request.method not in SAFE_METHODS:
                raise ApiError("View-as-student mode is read-only.", "read_only_view", 403)
            request.real_user = user
            return target, token
        return user, token

    @staticmethod
    def _touch(user):
        now = timezone.now()
        if not user.last_seen or (now - user.last_seen).total_seconds() > 300:
            type(user).objects.filter(pk=user.pk).update(last_seen=now)

    @staticmethod
    def _impersonated(request, user):
        value = request.COOKIES.get(IMPERSONATE_COOKIE)
        if not value or user.role != "admin" or request.path.startswith("/api/v1/auth/impersonate"):
            return None
        try:
            data = signing.loads(value, salt="view-as", max_age=3600)
        except signing.BadSignature:
            return None
        if data.get("admin") != str(user.pk):
            return None
        return type(user).objects.filter(pk=data["target"]).first()


class CookieAuthScheme(OpenApiAuthenticationExtension):
    target_class = "apps.accounts.authentication.CookieJWTAuthentication"
    name = "cookieAuth"

    def get_security_definition(self, auto_schema):
        return {"type": "apiKey", "in": "cookie", "name": ACCESS_COOKIE}


def _set(response, key, value, max_age, http_only=True):
    response.set_cookie(
        key, value, max_age=max_age, httponly=http_only, secure=settings.AUTH_COOKIE_SECURE,
        samesite=settings.AUTH_COOKIE_SAMESITE, path="/",
    )


def issue_session(response, user, gate=False):
    """Set the session cookies. gate=True pins the session to the password-change flow."""
    refresh = RefreshToken.for_user(user)
    refresh["tv"] = user.token_version
    refresh["pwc"] = gate
    access = refresh.access_token
    access["tv"] = user.token_version
    access["pwc"] = gate
    write_cookies(response, str(access), str(refresh))


def write_cookies(response, access, refresh):
    conf = settings.SIMPLE_JWT
    _set(response, ACCESS_COOKIE, access, int(conf["ACCESS_TOKEN_LIFETIME"].total_seconds()))
    _set(response, REFRESH_COOKIE, refresh, int(conf["REFRESH_TOKEN_LIFETIME"].total_seconds()))
    _set(response, CSRF_COOKIE, secrets.token_urlsafe(32), int(conf["REFRESH_TOKEN_LIFETIME"].total_seconds()), False)


def clear_session(response):
    for key in (ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE, IMPERSONATE_COOKIE):
        response.delete_cookie(key, path="/", samesite=settings.AUTH_COOKIE_SAMESITE)
