from rest_framework import serializers

from apps.accounts.serializers import PhoneField
from apps.catalog.serializers import public_url
from apps.core.fields import mask_secret

from .models import Entitlement, Order, PaymentGatewayConfig, SubscriptionPlan


class PlanSerializer(serializers.ModelSerializer):
    effective_price = serializers.IntegerField(read_only=True)

    class Meta:
        model = SubscriptionPlan
        fields = ["id", "name", "description", "price", "promo_price", "effective_price", "duration_days", "features",
                  "is_active", "highlighted", "order"]


class CheckoutSerializer(serializers.Serializer):
    order_type = serializers.ChoiceField(choices=["content_purchase", "subscription"])
    content = serializers.UUIDField(required=False, allow_null=True)
    plan = serializers.UUIDField(required=False, allow_null=True)
    phone = PhoneField()
    first_name = serializers.CharField(max_length=80)
    last_name = serializers.CharField(max_length=80)
    email = serializers.EmailField(required=False, allow_blank=True)
    method = serializers.ChoiceField(choices=["ussd_push", "hosted_checkout"], required=False)


class OrderPublicSerializer(serializers.ModelSerializer):
    """What a browser polling an order sees. Holds no personal data, as order ids get shared in URLs."""

    content_slug = serializers.CharField(source="content.slug", default=None)

    class Meta:
        model = Order
        fields = ["id", "status", "amount", "currency", "order_type", "item_title", "expires_at", "failure_reason",
                  "content_slug", "method", "checkout_url"]


class OrderMineSerializer(serializers.ModelSerializer):
    content_slug = serializers.CharField(source="content.slug", default=None)

    class Meta:
        model = Order
        fields = ["id", "status", "amount", "currency", "order_type", "item_title", "created_at", "paid_at",
                  "payment_provider", "snippe_reference", "external_reference", "content_slug"]


class EntitlementSerializer(serializers.ModelSerializer):
    title = serializers.SerializerMethodField()
    content_slug = serializers.CharField(source="content.slug", default=None)
    is_current = serializers.BooleanField()

    class Meta:
        model = Entitlement
        fields = ["id", "kind", "title", "content", "content_slug", "plan", "starts_at", "expires_at", "granted_by",
                  "reason", "is_active", "is_current", "created_at"]

    def get_title(self, obj):
        return obj.content.title if obj.content_id else (obj.plan.name if obj.plan_id else "Subscription")


class AdminOrderSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source="user.get_full_name", default="", read_only=True)

    class Meta:
        model = Order
        exclude = ["claim_token_hash", "client_key"]


class GatewayConfigSerializer(serializers.ModelSerializer):
    api_key = serializers.CharField(write_only=True, required=False, allow_blank=True)
    webhook_secret = serializers.CharField(write_only=True, required=False, allow_blank=True)
    session_token = serializers.CharField(write_only=True, required=False, allow_blank=True)
    api_key_masked = serializers.SerializerMethodField()
    webhook_secret_masked = serializers.SerializerMethodField()
    session_token_masked = serializers.SerializerMethodField()
    updated_by_name = serializers.CharField(source="updated_by.get_full_name", default="", read_only=True)
    checkout_available = serializers.BooleanField(read_only=True)
    hosted_available = serializers.BooleanField(read_only=True)

    class Meta:
        model = PaymentGatewayConfig
        exclude = ["id", "provider", "created_at"]
        read_only_fields = ["last_tested_at", "last_test_status", "last_test_report", "updated_at", "updated_by"]

    def get_api_key_masked(self, obj):
        return mask_secret(obj.api_key, "snp_")

    def get_webhook_secret_masked(self, obj):
        return mask_secret(obj.webhook_secret)

    def get_session_token_masked(self, obj):
        return mask_secret(obj.session_token)

    def update(self, instance, validated):
        changed_credentials = False
        for secret in ("api_key", "webhook_secret", "session_token"):
            value = validated.get(secret)
            if not value:
                validated.pop(secret, None)
            elif value != getattr(instance, secret):
                changed_credentials = True
        if changed_credentials or validated.get("api_base_url", instance.api_base_url) != instance.api_base_url:
            # New credentials are unproven: require a fresh passing test before money can flow.
            instance.last_test_status = ""
            instance.is_enabled = False
            validated.pop("is_enabled", None)
        return super().update(instance, validated)


__all__ = ["public_url"]
