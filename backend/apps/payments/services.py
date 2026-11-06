"""Orders, payment completion and entitlements. All money state changes happen in this file."""
import hashlib
import logging
import secrets
from datetime import timedelta
from urllib.parse import urlparse

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.core import notifications
from apps.core.api import ApiError
from apps.core.models import SiteSettings

from .models import Entitlement, Order, PaymentGatewayConfig
from .snippe import SnippeClient, SnippeError

log = logging.getLogger(__name__)
CLAIM_MINUTES = 30
MIN_AMOUNT = 500
WEBHOOK_PATH = "/api/payments/webhooks/snippe/"


def webhook_url():
    return f"{settings.PUBLIC_API_URL}{WEBHOOK_PATH}"


def hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()


def placeholder_email(phone):
    host = urlparse(settings.FRONTEND_URL).hostname or ""
    return f"{phone}@{host if '.' in host else 'example.com'}"


def _new_order(**fields):
    order_id = fields.pop("id")
    token = secrets.token_urlsafe(32)
    order = Order(id=order_id, idempotency_key=order_id.hex[:30], claim_token_hash=hash_token(token),
                  claim_expires_at=timezone.now() + timedelta(hours=5), **fields)
    return order, token


def create_order(*, order_type, phone, first_name, last_name, email="", content=None, plan=None, user=None,
                 client_key=None, method="ussd_push", amount=None, language=""):
    """Create the Order. Prices come from the database only, never from the client.

    Returns (order, claim_token, created). A repeat client_key returns the same order with a rotated
    claim token, which is what makes a double tap harmless.
    """
    import uuid

    if client_key:
        existing = Order.objects.filter(client_key=client_key).first()
        if existing:
            return _rotate(existing), False
    gateway = PaymentGatewayConfig.load()
    if order_type == Order.Type.CONTENT:
        amount, title = content.effective_price, content.title
        plan_days, access_days = None, content.access_duration_days
    elif order_type == Order.Type.SUBSCRIPTION:
        amount, title = plan.effective_price, plan.name
        plan_days, access_days = plan.duration_days, None
    else:
        title, plan_days, access_days = "Gateway test payment", None, None
    if amount is None or amount < MIN_AMOUNT:
        raise ApiError("This item cannot be purchased right now.", "not_purchasable")
    order, token = _new_order(
        id=uuid.uuid4(), order_type=order_type, phone=phone, first_name=first_name, last_name=last_name, email=email,
        content=content, plan=plan, item_title=title, plan_duration_days=plan_days, access_duration_days=access_days,
        amount=amount, currency=gateway.currency, user=user, client_key=client_key, method=method,
        language=language, expires_at=timezone.now() + timedelta(hours=gateway.expiry_hours),
    )
    order.log("created", f"{order.currency} {order.amount}")
    try:
        order.save()
    except IntegrityError:
        existing = Order.objects.filter(client_key=client_key).first()
        if existing is None:
            raise
        return _rotate(existing), False
    return (order, token), True


def _rotate(order):
    token = secrets.token_urlsafe(32)
    Order.objects.filter(pk=order.pk).update(claim_token_hash=hash_token(token))
    order.claim_token_hash = hash_token(token)
    return order, token


def start_payment(order):
    """Ask Snippe to collect. Same Idempotency-Key and body on retry, so Snippe cannot charge twice."""
    gateway = PaymentGatewayConfig.load()
    client = SnippeClient(gateway)
    if order.method == "hosted_checkout":
        return _start_session(order, gateway, client)
    body = {
        "payment_type": "mobile",
        "details": {"amount": order.amount, "currency": order.currency},
        "phone_number": order.phone,
        "customer": {"firstname": order.first_name, "lastname": order.last_name,
                     "email": order.email or placeholder_email(order.phone)},
        "webhook_url": webhook_url(),
        "metadata": {"order_id": str(order.pk)},
    }
    order.raw_request = body
    try:
        data = client.create_payment(body, order.idempotency_key)
    except SnippeError as exc:
        _start_failed(order, exc)
        raise ApiError("We could not start the payment. Please try again.", "gateway_error", 502) from exc
    order.raw_response = data
    order.snippe_reference = data.get("reference", "")
    if data.get("expires_at"):
        order.expires_at = _parse(data["expires_at"]) or order.expires_at
    order.log("push_sent", order.snippe_reference)
    order.save(update_fields=["raw_request", "raw_response", "snippe_reference", "expires_at", "timeline"])
    return order


def _parse(value):
    from django.utils.dateparse import parse_datetime

    try:
        # Snippe sends nanosecond precision, which datetime parsing rejects past microseconds.
        if "." in value:
            head, tail = value.split(".", 1)
            value = f"{head}.{tail.rstrip('Z')[:6]}+00:00" if tail.endswith("Z") else value
        return parse_datetime(value)
    except (ValueError, TypeError):
        return None


def _start_session(order, gateway, client):
    body = {
        "amount": order.amount, "currency": order.currency, "allowed_methods": ["mobile_money"],
        "customer": {"name": f"{order.first_name} {order.last_name}", "phone": order.phone,
                     "email": order.email or placeholder_email(order.phone)},
        "redirect_url": gateway.redirect_url or f"{settings.FRONTEND_URL}/checkout/return?order={order.pk}",
        "webhook_url": webhook_url(), "description": order.item_title[:500],
        "metadata": {"order_id": str(order.pk)}, "expires_in": min(gateway.expiry_hours * 3600, 86400),
    }
    if gateway.hosted_profile_id:
        body["profile_id"] = gateway.hosted_profile_id
    order.raw_request = body
    try:
        data = client.create_session(body)
    except SnippeError as exc:
        _start_failed(order, exc)
        raise ApiError("We could not open the checkout page. Please try again.", "gateway_error", 502) from exc
    order.raw_response = data
    order.snippe_session_reference = data.get("reference", "")
    order.checkout_url = data.get("checkout_url") or data.get("payment_link_url") or ""
    order.log("session_created", order.snippe_session_reference)
    order.save(update_fields=["raw_request", "raw_response", "snippe_session_reference", "checkout_url", "timeline"])
    return order


def _start_failed(order, exc):
    order.status = Order.Status.FAILED
    order.failure_reason = str(exc)[:240]
    order.raw_response = exc.body
    order.log("gateway_rejected", str(exc)[:200])
    order.save(update_fields=["status", "failure_reason", "raw_response", "raw_request", "timeline"])


def find_or_create_user(order):
    """Return (user, created). An existing user's password is never touched.

    Someone logged in keeps the purchase on their own account, even if a relative's phone paid.
    """
    if order.user_id:
        return order.user, False
    user = User.objects.filter(username=order.phone).first()
    if user:
        return user, False
    new = User(username=order.phone, phone=order.phone, first_name=order.first_name, last_name=order.last_name,
               email=order.email, must_change_password=True, source=User.Source.AUTO_CREATED,
               language=order.language)
    new.set_password(order.phone)
    try:
        with transaction.atomic():
            new.save()
        return new, True
    except IntegrityError:
        return User.objects.get(username=order.phone), False


def grant_entitlement(order, user):
    now = timezone.now()
    if order.order_type == Order.Type.SUBSCRIPTION:
        current = (Entitlement.objects.select_for_update().filter(
            user=user, kind=Entitlement.Kind.SUBSCRIPTION, is_active=True, expires_at__gt=now).order_by("-expires_at")
            .first())
        start = current.expires_at if current else now
        return Entitlement.objects.create(
            user=user, kind=Entitlement.Kind.SUBSCRIPTION, plan=order.plan, order=order, starts_at=now,
            expires_at=start + timedelta(days=order.plan_duration_days),
        )
    days = order.access_duration_days
    return Entitlement.objects.create(
        user=user, kind=Entitlement.Kind.CONTENT, content=order.content, order=order, starts_at=now,
        expires_at=now + timedelta(days=days) if days else None,
    )


def complete_order(order_id, *, source, data=None):
    """Mark paid exactly once, however many webhooks and polls arrive. Returns True if this call did it."""
    data = data or {}
    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order_id)
        if order.status == Order.Status.COMPLETED:
            order.log("duplicate_ignored", source)
            order.save(update_fields=["timeline"])
            return False
        amount = data.get("amount")
        paid = amount.get("value") if isinstance(amount, dict) else amount
        if paid is not None and int(paid) != order.amount:
            order.log("amount_mismatch", f"expected {order.amount}, got {paid}")
            order.failure_reason = f"Paid amount {paid} does not match order amount {order.amount}"
            order.save(update_fields=["timeline", "failure_reason"])
            log.error("Amount mismatch on order %s", order.pk)
            return False
        # A failed or cancelled order can still complete: if Snippe says the money moved, honour it.
        order.status = Order.Status.COMPLETED
        order.paid_at = timezone.now()
        order.external_reference = data.get("external_reference") or order.external_reference
        channel = data.get("channel") or {}
        order.payment_channel = channel.get("type") or order.payment_channel
        order.payment_provider = channel.get("provider") or order.payment_provider
        order.log("payment_completed", source)
        if order.order_type != Order.Type.GATEWAY_TEST:
            user, created = find_or_create_user(order)
            order.user, order.account_created = user, created
            if created:
                order.log("account_created", user.username)
            grant_entitlement(order, user)
            order.log("entitlement_granted", order.item_title)
            transaction.on_commit(lambda: send_receipt(order))
        order.claim_expires_at = timezone.now() + timedelta(minutes=CLAIM_MINUTES)
        order.save()
    return True


TERMINAL_MAP = {"failed": Order.Status.FAILED, "voided": Order.Status.VOIDED, "expired": Order.Status.EXPIRED}


def close_order(order_id, status, *, source, reason=""):
    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order_id)
        if order.status != Order.Status.PENDING:
            return False
        order.status = status
        order.failure_reason = (reason or "")[:240]
        order.log(f"payment_{status}", f"{source}: {reason}".strip(": "))
        order.save(update_fields=["status", "failure_reason", "timeline"])
    return True


def apply_payment_state(order, state, *, source, data=None):
    data = data or {}
    if state == "completed":
        return complete_order(order.pk, source=source, data=data)
    if state in TERMINAL_MAP:
        return close_order(order.pk, TERMINAL_MAP[state], source=source, reason=data.get("failure_reason", ""))
    return False


def find_order(data):
    reference = data.get("reference")
    session = data.get("session_reference")
    order_id = (data.get("metadata") or {}).get("order_id")
    order = None
    if reference:
        order = Order.objects.filter(snippe_reference=reference).first()
    if order is None and session:
        order = Order.objects.filter(snippe_session_reference=session).first()
    if order is None and order_id:
        order = Order.objects.filter(pk=order_id).first()
        if order is not None and reference and not order.snippe_reference:
            Order.objects.filter(pk=order.pk).update(snippe_reference=reference)
            order.snippe_reference = reference
    return order


def process_event(event):
    from .models import WebhookEvent

    if event.type.startswith("payment."):
        data = event.payload.get("data") or {}
        order = find_order(data)
        if order is None:
            raise LookupError(f"No order for {data.get('reference')}")
        order.log("webhook_received", event.type)
        Order.objects.filter(pk=order.pk).update(timeline=order.timeline)
        apply_payment_state(order, event.type.split(".", 1)[1], source="webhook", data=data)
    WebhookEvent.objects.filter(pk=event.pk).update(processed_at=timezone.now(), processing_error="")


def reconcile(order):
    """Ask Snippe about one order. Used by the reconciliation task and the admin Re-check button."""
    client = SnippeClient(PaymentGatewayConfig.load())
    if order.snippe_reference:
        data = client.get_payment(order.snippe_reference)
    elif order.snippe_session_reference:
        data = client.get_session(order.snippe_session_reference)
    else:
        return None
    Order.objects.filter(pk=order.pk).update(last_polled_at=timezone.now())
    state = data.get("status")
    apply_payment_state(order, "expired" if state == "cancelled" else state, source="reconciliation", data=data)
    return state


def send_receipt(order):
    from apps.core.phone import local_phone

    language = (order.user.language if order.user_id else "") or order.language
    base = settings.FRONTEND_URL
    notifications.notify("payment_receipt", phone=order.phone, email=order.email, language=language,
                         amount=f"{order.currency} {order.amount:,}", item=order.item_title,
                         reference=str(order.pk)[:8], receipt_url=f"{base}/library/receipts/{order.pk}")
    if order.account_created:
        notifications.notify("account_created", phone=order.phone, email=order.email, language=language,
                             phone_number=local_phone(order.phone), login_url=f"{base}/login")
