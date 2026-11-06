import json
import logging
import uuid

from django.db import IntegrityError
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import issue_session
from apps.accounts.serializers import MeSerializer
from apps.catalog.models import Content
from apps.catalog.views import live_qs
from apps.core.api import ApiError, CheckoutThrottle, ClaimThrottle, ResendThrottle, WebhookThrottle

from . import services
from .access import build_context, can_access
from .models import Order, PaymentGatewayConfig, SubscriptionPlan, WebhookEvent
from .serializers import (CheckoutSerializer, EntitlementSerializer, OrderMineSerializer, OrderPublicSerializer,
                          ReceiptSerializer)
from .snippe import SnippeClient, SnippeError, verify_signature
from .tasks import process_webhook_event

log = logging.getLogger(__name__)


class Empty(serializers.Serializer):
    pass


class ClaimSerializer(serializers.Serializer):
    claim_token = serializers.CharField()


def _resolve_item(data, request):
    content = plan = None
    if data["order_type"] == Order.Type.CONTENT:
        content = live_qs().filter(pk=data.get("content"), access_level=Content.Access.PAID).first()
        if content is None or content.effective_price is None:
            raise ApiError("This item is not for sale.", "not_purchasable")
        return content, None
    plan = SubscriptionPlan.objects.filter(pk=data.get("plan"), is_active=True).first()
    if plan is None:
        raise ApiError("This plan is not available.", "not_purchasable")
    return content, plan


class CheckoutView(APIView):
    throttle_classes = [CheckoutThrottle]
    serializer_class = CheckoutSerializer

    @extend_schema(responses=OrderPublicSerializer)
    def post(self, request):
        gateway = PaymentGatewayConfig.load()
        if not gateway.checkout_available:
            raise ApiError("Payments are temporarily unavailable.", "payments_unavailable", 503)
        ser = CheckoutSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        content, plan = _resolve_item(data, request)
        user = request.user if request.user.is_authenticated else None
        if content is not None and user and can_access(user, content):
            raise ApiError("You already have access to this.", "already_unlocked", 409)
        method = data.get("method") or "ussd_push"
        if method == "hosted_checkout" and not gateway.hosted_available:
            method = "ussd_push"
        (order, token), created = services.create_order(
            order_type=data["order_type"], phone=data["phone"], first_name=data["first_name"],
            last_name=data["last_name"], email=data.get("email", ""), content=content, plan=plan, user=user,
            client_key=request.headers.get("Idempotency-Key", "")[:64] or None, method=method,
            language=data.get("language", ""),
        )
        if created or not (order.snippe_reference or order.snippe_session_reference):
            order = services.start_payment(order)
        return Response({**OrderPublicSerializer(order).data, "claim_token": token}, status=201 if created else 200)


class OrderStatusView(APIView):
    serializer_class = OrderPublicSerializer

    def get(self, request, pk):
        order = Order.objects.select_related("content").filter(pk=pk).first()
        if order is None:
            raise ApiError("Order not found.", "not_found", 404)
        return Response(OrderPublicSerializer(order).data)


class _ClaimedAction(APIView):
    def locked(self, pk, token):
        order = Order.objects.filter(pk=pk).first()
        if order is None or not token or services.hash_token(token) != order.claim_token_hash:
            raise ApiError("This order does not belong to this browser.", "forbidden", 403)
        return order


class ResendPushView(_ClaimedAction):
    throttle_classes = [ResendThrottle]
    serializer_class = ClaimSerializer

    def post(self, request, pk):
        order = self.locked(pk, request.data.get("claim_token"))
        if order.status != Order.Status.PENDING or not order.snippe_reference:
            raise ApiError("This payment is no longer waiting.", "not_pending", 409)
        if order.resend_count >= 5:
            raise ApiError("Too many resends. Please start again.", "too_many", 429)
        try:
            SnippeClient(PaymentGatewayConfig.load()).push(order.snippe_reference)
        except SnippeError as exc:
            raise ApiError("We could not resend the prompt. Please try again.", "gateway_error", 502) from exc
        order.resend_count += 1
        order.log("push_resent", str(order.resend_count))
        order.save(update_fields=["resend_count", "timeline"])
        return Response({"ok": True})


class CancelOrderView(_ClaimedAction):
    serializer_class = ClaimSerializer

    def post(self, request, pk):
        order = self.locked(pk, request.data.get("claim_token"))
        services.close_order(order.pk, Order.Status.CANCELLED, source="customer")
        order.refresh_from_db()
        return Response(OrderPublicSerializer(order).data)


class ClaimOrderView(_ClaimedAction):
    """Swap the single-use claim token for a session after payment."""

    throttle_classes = [ClaimThrottle]
    serializer_class = ClaimSerializer

    def post(self, request, pk):
        token = request.data.get("claim_token")
        order = self.locked(pk, token)
        if order.status != Order.Status.COMPLETED or order.user is None:
            raise ApiError("This payment has not completed.", "not_completed", 409)
        payload = {"account_created": order.account_created, "username": order.user.username,
                   "content_slug": order.content.slug if order.content_id else None}
        # Consume atomically: of two racing requests, only one sees the row still unclaimed.
        won = Order.objects.filter(pk=order.pk, claimed_at=None, claim_expires_at__gt=timezone.now()).update(
            claimed_at=timezone.now(), claim_token_hash="")
        if not won:
            raise ApiError("This link has expired. Please log in with your phone number.", "claim_expired", 410)
        user = order.user
        if user.is_staff_role or not user.is_active:
            # A USSD approval must never be enough to open a teacher's account.
            return Response({**payload, "user": None, "login_required": True})
        response = Response({**payload, "user": MeSerializer(user).data, "login_required": False})
        issue_session(response, user)
        return response


class SnippeWebhookView(APIView):
    """Verify, store, queue, answer. Signature checks use the exact raw bytes."""

    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = [WebhookThrottle]
    parser_classes = []
    serializer_class = Empty

    def post(self, request):
        raw = request._request.body
        secret = PaymentGatewayConfig.load().webhook_secret
        problem = verify_signature(secret, request.headers.get("X-Webhook-Timestamp"),
                                   request.headers.get("X-Webhook-Signature"), raw)
        try:
            payload = json.loads(raw)
        except ValueError:
            payload = {}
        event_type = payload.get("type") or request.headers.get("X-Webhook-Event") or "unknown"
        if problem:
            log.warning("Rejected webhook: %s", problem)
            WebhookEvent.objects.create(event_id=f"rejected_{uuid.uuid4().hex}", type=event_type[:60], payload={},
                                        signature_valid=False, processing_error=problem)
            return Response({"error": {"code": problem, "message": "Rejected."}}, status=401)
        if event_type == "diagnostic.ping":
            return Response({"ok": True, "mode": "test"})
        reference = (payload.get("data") or {}).get("reference", "")
        event_id = payload.get("id") or f"{event_type}:{reference}"
        try:
            event, created = WebhookEvent.objects.get_or_create(
                event_id=event_id[:120], defaults={"type": event_type[:60], "payload": payload, "signature_valid": True})
        except IntegrityError:
            return Response({"ok": True, "duplicate": True})
        if not created and event.processed_at:
            return Response({"ok": True, "duplicate": True})
        try:
            process_webhook_event.delay(event.pk)
        except Exception:  # a broker outage must not lose the event: reconciliation covers it
            log.exception("Could not queue webhook event %s", event.pk)
        return Response({"ok": True})


class MyOrdersView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = OrderMineSerializer

    def get(self, request):
        rows = Order.objects.filter(user=request.user).select_related("content").exclude(
            order_type=Order.Type.GATEWAY_TEST)[:100]
        return Response(OrderMineSerializer(rows, many=True).data)


class ReceiptView(APIView):
    """The buyer's own receipt, or any receipt for an admin. Editors never see money."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = ReceiptSerializer

    def get(self, request, pk):
        order = Order.objects.filter(pk=pk, status=Order.Status.COMPLETED).exclude(
            order_type=Order.Type.GATEWAY_TEST).first()
        if order is None or (order.user_id != request.user.pk and request.user.role != "admin"):
            raise ApiError("Receipt not found.", "not_found", 404)
        return Response(ReceiptSerializer(order).data)


class MyAccessView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = EntitlementSerializer

    def get(self, request):
        ctx = build_context(request.user)
        rows = request.user.entitlements.select_related("content", "plan")[:200]
        return Response({
            "has_subscription": ctx.has_subscription, "subscription_expired": ctx.subscription_expired,
            "subscription_expires_at": ctx.subscription_expires_at,
            "entitlements": EntitlementSerializer(rows, many=True).data,
        })
