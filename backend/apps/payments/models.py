import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.core.fields import EncryptedTextField
from apps.core.models import TimeStamped, UUIDModel


class PaymentGatewayConfig(TimeStamped):
    class Method(models.TextChoices):
        USSD = "ussd_push", "USSD push"
        HOSTED = "hosted_checkout", "Hosted checkout"
        CHOOSE = "let_customer_choose", "Let customer choose"

    provider = models.CharField(max_length=20, unique=True, default="snippe")
    display_name = models.CharField(max_length=80, default="Snippe")
    is_enabled = models.BooleanField(default=False)
    mode_label = models.CharField(max_length=10, default="test")
    api_base_url = models.URLField(default="https://api.snippe.sh")
    api_key = EncryptedTextField(blank=True)
    webhook_secret = EncryptedTextField(blank=True)
    session_token = EncryptedTextField(blank=True)  # Sessions document a JWT, not the snp_ key
    default_method = models.CharField(max_length=20, choices=Method.choices, default=Method.USSD)
    hosted_profile_id = models.CharField(max_length=80, blank=True)
    redirect_url = models.URLField(blank=True)
    currency = models.CharField(max_length=3, default="TZS")
    expiry_hours = models.PositiveIntegerField(default=4)
    poll_seconds = models.PositiveIntegerField(default=3)
    last_tested_at = models.DateTimeField(null=True, blank=True)
    last_test_status = models.CharField(max_length=10, blank=True)  # passed | failed
    last_test_report = models.JSONField(default=dict, blank=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(provider="snippe")
        return obj

    @property
    def checkout_available(self):
        return bool(self.is_enabled and self.last_test_status == "passed" and self.api_key)

    @property
    def hosted_available(self):
        return bool((self.last_test_report or {}).get("hosted_checkout_ok"))


class SubscriptionPlan(UUIDModel):
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    price = models.PositiveIntegerField()
    promo_price = models.PositiveIntegerField(null=True, blank=True)
    duration_days = models.PositiveIntegerField(default=30)
    features = models.JSONField(default=list, blank=True)
    is_active = models.BooleanField(default=True)
    highlighted = models.BooleanField(default=False)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order", "price"]

    def __str__(self):
        return self.name

    @property
    def effective_price(self):
        return self.promo_price or self.price


class Order(models.Model):
    class Type(models.TextChoices):
        CONTENT = "content_purchase", "Content purchase"
        SUBSCRIPTION = "subscription", "Subscription"
        GATEWAY_TEST = "gateway_test", "Gateway test"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"
        EXPIRED = "expired", "Expired"
        VOIDED = "voided", "Voided"
        CANCELLED = "cancelled", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="orders"
    )
    phone = models.CharField(max_length=12, db_index=True)
    first_name = models.CharField(max_length=80)
    last_name = models.CharField(max_length=80)
    email = models.EmailField(blank=True)
    order_type = models.CharField(max_length=20, choices=Type.choices, db_index=True)
    content = models.ForeignKey(
        "catalog.Content", null=True, blank=True, on_delete=models.SET_NULL, related_name="orders"
    )
    plan = models.ForeignKey(SubscriptionPlan, null=True, blank=True, on_delete=models.SET_NULL, related_name="orders")
    item_title = models.CharField(max_length=240, blank=True)
    plan_duration_days = models.PositiveIntegerField(null=True, blank=True)  # the terms that were paid for
    access_duration_days = models.PositiveIntegerField(null=True, blank=True)
    amount = models.PositiveIntegerField()
    currency = models.CharField(max_length=3, default="TZS")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING, db_index=True)
    method = models.CharField(max_length=20, default="ussd_push")
    snippe_reference = models.CharField(max_length=80, blank=True, db_index=True)
    snippe_session_reference = models.CharField(max_length=80, blank=True, db_index=True)
    checkout_url = models.URLField(max_length=500, blank=True)
    external_reference = models.CharField(max_length=80, blank=True)
    payment_channel = models.CharField(max_length=30, blank=True)
    payment_provider = models.CharField(max_length=30, blank=True)
    idempotency_key = models.CharField(max_length=30, unique=True)
    client_key = models.CharField(max_length=64, unique=True, null=True, blank=True)
    raw_request = models.JSONField(default=dict, blank=True)
    raw_response = models.JSONField(default=dict, blank=True)
    timeline = models.JSONField(default=list, blank=True)
    failure_reason = models.CharField(max_length=240, blank=True)
    claim_token_hash = models.CharField(max_length=64, blank=True)
    claim_expires_at = models.DateTimeField(null=True, blank=True)
    claimed_at = models.DateTimeField(null=True, blank=True)
    account_created = models.BooleanField(default=False)
    resend_count = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField(null=True, blank=True, db_index=True)
    last_polled_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    paid_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.item_title} ({self.status})"

    def log(self, event, detail=""):
        self.timeline = [*self.timeline, {"at": timezone.now().isoformat(), "event": event, "detail": detail}]


class Entitlement(UUIDModel):
    class Kind(models.TextChoices):
        CONTENT = "content", "Content"
        SUBSCRIPTION = "subscription", "Subscription"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="entitlements")
    kind = models.CharField(max_length=15, choices=Kind.choices, db_index=True)
    content = models.ForeignKey(
        "catalog.Content", null=True, blank=True, on_delete=models.CASCADE, related_name="entitlements"
    )
    plan = models.ForeignKey(SubscriptionPlan, null=True, blank=True, on_delete=models.SET_NULL)
    order = models.ForeignKey(Order, null=True, blank=True, on_delete=models.SET_NULL, related_name="entitlements")
    starts_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField(null=True, blank=True, db_index=True)
    granted_by = models.CharField(max_length=10, default="payment")  # payment | admin
    reason = models.CharField(max_length=240, blank=True)
    is_active = models.BooleanField(default=True, db_index=True)
    reminded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["order"], condition=models.Q(order__isnull=False), name="one_entitlement_per_order"
            )
        ]

    @property
    def is_current(self):
        now = timezone.now()
        return self.is_active and self.starts_at <= now and (self.expires_at is None or self.expires_at > now)


class WebhookEvent(models.Model):
    event_id = models.CharField(max_length=120, unique=True)
    type = models.CharField(max_length=60, db_index=True)
    payload = models.JSONField(default=dict)
    signature_valid = models.BooleanField(default=False)
    received_at = models.DateTimeField(auto_now_add=True, db_index=True)
    processed_at = models.DateTimeField(null=True, blank=True)
    processing_error = models.TextField(blank=True)

    class Meta:
        ordering = ["-received_at"]
