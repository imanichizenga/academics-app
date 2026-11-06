import hashlib
import secrets

from django.contrib.auth import authenticate
from django.contrib.auth.password_validation import validate_password
from django.core import signing
from django.core.cache import cache
from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, serializers
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken

from apps.core import notifications
from apps.core.api import ApiError, LoginThrottle, OtpThrottle
from apps.core.models import SiteSettings
from apps.core.phone import InvalidPhone, normalize_phone

from . import serializers as s
from .authentication import (IMPERSONATE_COOKIE, REFRESH_COOKIE, CookieJWTAuthentication, clear_session, issue_session,
                             write_cookies)
from .models import User


MAX_FAILED_LOGINS = 8  # per phone number: an attacker rotating IPs still hits this
FAILED_LOGIN_WINDOW = 900


class Empty(serializers.Serializer):
    pass


def session_payload(user):
    return {"user": s.MeSerializer(user).data}


def _first_password_login(request, phone, entered):
    """Auto-created accounts start with 255XXXXXXXXX as the password, but people type 07XX.

    Only applies while the password is still the unchanged starter one: authenticate() confirms that.
    """
    user = User.objects.filter(username=phone, must_change_password=True).first()
    if user is None:
        return None
    try:
        typed = normalize_phone(entered)
    except InvalidPhone:
        return None
    return authenticate(request, username=phone, password=typed) if typed == user.phone else None


class LoginView(APIView):
    authentication_classes = []
    throttle_classes = [LoginThrottle]
    serializer_class = s.LoginSerializer

    def post(self, request):
        ser = s.LoginSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        phone = ser.validated_data["phone"]
        fail_key = f"login_fail:{phone}"
        if cache.get(fail_key, 0) >= MAX_FAILED_LOGINS:
            raise ApiError("Too many wrong attempts. Please wait 15 minutes and try again.", "locked", 429)
        password = ser.validated_data["password"]
        user = authenticate(request, username=phone, password=password) or _first_password_login(
            request, phone, password)
        if user is None:
            cache.add(fail_key, 0, FAILED_LOGIN_WINDOW)
            cache.incr(fail_key)
            if User.objects.filter(username=ser.validated_data["phone"], is_active=False).exists():
                raise ApiError("This account is suspended. Please contact the teacher.", "suspended", 403)
            raise ApiError("Wrong phone number or password.", "invalid_credentials", 401)
        cache.delete(fail_key)
        response = Response(session_payload(user))
        issue_session(response, user, gate=user.must_change_password)
        return response


class RegisterView(APIView):
    authentication_classes = []
    throttle_classes = [LoginThrottle]
    serializer_class = s.RegisterSerializer

    def post(self, request):
        if not SiteSettings.load().allow_signup:
            raise ApiError("Sign up is closed.", "signup_closed", 403)
        ser = s.RegisterSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        if User.objects.filter(username=data["phone"]).exists():
            raise ApiError("This number already has an account. Please log in.", "account_exists", 409)
        user = User.objects.create_student(data["phone"], data["password"], first_name=data["first_name"],
                                           last_name=data["last_name"], source=User.Source.SELF_SIGNUP)
        response = Response(session_payload(user), status=201)
        issue_session(response, user)
        return response


class RefreshView(APIView):
    authentication_classes = []
    serializer_class = Empty

    def post(self, request):
        raw = request.COOKIES.get(REFRESH_COOKIE)
        if not raw:
            raise ApiError("Session expired.", "no_session", 401)
        try:
            old = RefreshToken(raw)
            user = User.objects.get(pk=old["user_id"], is_active=True)
            if old.get("tv", 0) != user.token_version:
                raise TokenError("stale")
            old.blacklist()
            new = RefreshToken.for_user(user)
            for key in ("tv", "pwc"):
                new[key] = old.get(key)
            access = new.access_token
            access["tv"], access["pwc"] = old.get("tv", 0), old.get("pwc", False)
        except (TokenError, User.DoesNotExist) as exc:
            response = Response({"error": {"code": "no_session", "message": "Session expired."}}, status=401)
            clear_session(response)
            del exc
            return response
        response = Response(session_payload(user))
        write_cookies(response, str(access), str(new))
        return response


class LogoutView(APIView):
    serializer_class = Empty

    def post(self, request):
        raw = request.COOKIES.get(REFRESH_COOKIE)
        if raw:
            try:
                RefreshToken(raw).blacklist()
            except TokenError:
                pass
        response = Response({"ok": True})
        clear_session(response)
        return response


class LogoutAllView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = Empty

    def post(self, request):
        revoke_all_sessions(request.user)
        response = Response({"ok": True})
        clear_session(response)
        return response


def revoke_all_sessions(user):
    with transaction.atomic():
        User.objects.filter(pk=user.pk).update(token_version=user.token_version + 1)
        for token in OutstandingToken.objects.filter(user=user):
            BlacklistedToken.objects.get_or_create(token=token)


class MeView(APIView):
    serializer_class = s.MeSerializer

    def get(self, request):
        if not request.user.is_authenticated:
            return Response({"user": None})
        data = session_payload(request.user)
        data["viewing_as"] = bool(getattr(request, "real_user", None))
        return Response(data)

    def patch(self, request):
        if not request.user.is_authenticated:
            raise ApiError("Please log in.", "not_authenticated", 401)
        ser = s.MeSerializer(request.user, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(session_payload(request.user))


class ChangePasswordView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = s.ChangePasswordSerializer

    def post(self, request):
        ser = s.ChangePasswordSerializer(data=request.data, context={"request": request})
        ser.is_valid(raise_exception=True)
        user = request.user
        user.set_password(ser.validated_data["new_password"])
        user.must_change_password = False
        user.save()
        revoke_all_sessions(user)
        user.refresh_from_db()
        response = Response(session_payload(user))
        issue_session(response, user)
        return response


def _otp_key(phone):
    return f"otp:{phone}"


class OtpRequestView(APIView):
    """Password reset by SMS. Stays inert until SMS is enabled in Settings → Notifications."""

    authentication_classes = []
    throttle_classes = [OtpThrottle]
    serializer_class = s.OtpRequestSerializer

    def get_throttles(self):
        # Only sending costs money. The forgot page must still load after a few visits.
        return super().get_throttles() if self.request.method == "POST" else []

    def get(self, request):
        return Response({"available": notifications.has_provider("sms")})

    def post(self, request):
        if not notifications.has_provider("sms"):
            raise ApiError("SMS reset is not available. Please ask the teacher to reset your password.",
                           "otp_unavailable", 503)
        ser = s.OtpRequestSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        phone = ser.validated_data["phone"]
        user = User.objects.filter(username=phone, is_active=True).first()
        if user:
            code = f"{secrets.randbelow(1_000_000):06d}"
            cache.set(_otp_key(phone), {"h": hashlib.sha256(code.encode()).hexdigest(), "n": 0}, 600)
            notifications.notify("otp_code", phone=phone, language=user.language, code=code)
        return Response({"ok": True})


class OtpConfirmView(APIView):
    authentication_classes = []
    throttle_classes = [OtpThrottle]
    serializer_class = s.OtpConfirmSerializer

    def post(self, request):
        ser = s.OtpConfirmSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        stored = cache.get(_otp_key(data["phone"]))
        digest = hashlib.sha256(data["code"].encode()).hexdigest()
        if not stored or stored["n"] >= 5 or not secrets.compare_digest(stored["h"], digest):
            if stored:
                stored["n"] += 1
                cache.set(_otp_key(data["phone"]), stored, 600)
            raise ApiError("That code is wrong or has expired.", "invalid_code", 400)
        user = User.objects.get(username=data["phone"])
        validate_password(data["new_password"], user)
        user.set_password(data["new_password"])
        user.must_change_password = False
        user.save()
        cache.delete(_otp_key(data["phone"]))
        revoke_all_sessions(user)
        return Response({"ok": True})


class StopImpersonateView(APIView):
    serializer_class = Empty

    @extend_schema(responses=Empty)
    def post(self, request):
        response = Response({"ok": True})
        response.delete_cookie(IMPERSONATE_COOKIE, path="/")
        return response


__all__ = ["CookieJWTAuthentication", "signing"]
