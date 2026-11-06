import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.db.models import F
from django.utils import timezone

from apps.core import notifications
from apps.core.models import NotificationConfig

from . import services
from .models import Entitlement, Order, PaymentGatewayConfig, WebhookEvent
from .snippe import SnippeError

log = logging.getLogger(__name__)
RECONCILE_BATCH = 30  # stays well under Snippe's 60 requests a minute


@shared_task(bind=True, max_retries=5, default_retry_delay=30)
def process_webhook_event(self, event_pk):
    event = WebhookEvent.objects.get(pk=event_pk)
    if event.processed_at:
        return
    try:
        services.process_event(event)
    except LookupError as exc:
        # A webhook can beat our own save of the reference, so give it a moment before giving up.
        WebhookEvent.objects.filter(pk=event_pk).update(processing_error=str(exc))
        raise self.retry(exc=exc) from exc
    except Exception as exc:
        log.exception("Webhook event %s failed", event.event_id)
        WebhookEvent.objects.filter(pk=event_pk).update(processing_error=str(exc)[:500])
        raise self.retry(exc=exc) from exc


@shared_task
def reconcile_pending_orders():
    if not PaymentGatewayConfig.load().api_key:
        return
    now = timezone.now()
    pending = Order.objects.filter(status=Order.Status.PENDING)
    for order in pending.filter(expires_at__lt=now - timedelta(minutes=5), snippe_reference="",
                                snippe_session_reference=""):
        services.close_order(order.pk, Order.Status.EXPIRED, source="reconciliation", reason="Never reached Snippe")
    # Least recently checked first, so the batch limit cannot starve older orders.
    batch = pending.exclude(snippe_reference="", snippe_session_reference="").order_by(
        F("last_polled_at").asc(nulls_first=True))[:RECONCILE_BATCH]
    for order in batch:
        try:
            state = services.reconcile(order)
        except SnippeError as exc:
            if exc.status == 429:
                break
            log.warning("Reconcile failed for %s: %s", order.pk, exc)
            continue
        if state == "pending" and order.expires_at and order.expires_at < now - timedelta(minutes=5):
            services.close_order(order.pk, Order.Status.EXPIRED, source="reconciliation", reason="Timed out")


@shared_task
def expire_entitlements():
    now = timezone.now()
    lapsed = list(Entitlement.objects.filter(is_active=True, expires_at__lt=now).select_related("user"))
    Entitlement.objects.filter(pk__in=[e.pk for e in lapsed]).update(is_active=False)
    told = set()
    for entitlement in lapsed:
        user = entitlement.user
        if entitlement.kind != Entitlement.Kind.SUBSCRIPTION or user.pk in told:
            continue
        told.add(user.pk)
        # A renewal stacks a new entitlement, so an old one lapsing need not mean access ended.
        if not Entitlement.objects.filter(user=user, kind=Entitlement.Kind.SUBSCRIPTION, is_active=True,
                                          expires_at__gt=now).exists():
            notifications.notify("subscription_ended", phone=user.phone, email=user.email, language=user.language,
                                 renew_url=f"{settings.FRONTEND_URL}/pricing")
    return len(lapsed)


@shared_task
def send_expiry_reminders():
    now = timezone.now()
    window = timedelta(days=NotificationConfig.load().reminder_days)
    due = Entitlement.objects.filter(kind="subscription", is_active=True, reminded_at=None,
                                     expires_at__range=(now, now + window)).select_related("user")
    for entitlement in due:
        user = entitlement.user
        if Entitlement.objects.filter(user=user, kind="subscription", is_active=True,
                                      expires_at__gt=entitlement.expires_at).exists():
            continue  # already renewed: the later entitlement gets its own reminder
        days = max(1, (entitlement.expires_at - now).days)
        notifications.notify("subscription_ending", phone=user.phone, email=user.email, language=user.language,
                             days=days, renew_url=f"{settings.FRONTEND_URL}/pricing")
        Entitlement.objects.filter(pk=entitlement.pk).update(reminded_at=now)
