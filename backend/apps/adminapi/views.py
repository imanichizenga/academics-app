import csv
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.db.models import Count, Exists, OuterRef, Q, Sum
from django.db.models.functions import TruncDate
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import decorators, serializers, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.authentication import IMPERSONATE_COOKIE
from apps.accounts.models import User
from apps.accounts.views import revoke_all_sessions
from apps.catalog.models import Content
from apps.catalog.serializers import public_url
from apps.core.api import ApiError, IsAdminRole, IsEditorOrAdmin
from apps.core.audit import diff, record, snapshot
from apps.core import diagnostics as notify_diag
from apps.core import notifications
from apps.core.fields import mask_secret
from apps.core.models import AuditLog, NotificationConfig, NotificationLog, NotificationTemplate, SiteSettings
from apps.core.phone import InvalidPhone, normalize_phone
from apps.engagement.models import Comment
from apps.engagement.views import CommentSerializer
from apps.media_library import diagnostics as storage_diag
from apps.media_library.models import MediaAsset, StorageConfig
from apps.media_library.serializers import StorageConfigSerializer
from apps.payments import diagnostics as gateway_diag
from apps.payments import services
from apps.payments.access import build_context, current_entitlements
from apps.payments.models import Entitlement, Order, PaymentGatewayConfig, SubscriptionPlan, WebhookEvent
from apps.payments.serializers import (AdminOrderSerializer, EntitlementSerializer, GatewayConfigSerializer,
                                       PlanSerializer)
from apps.payments.snippe import SnippeError

import django_filters as df


class Empty(serializers.Serializer):
    pass


def csv_response(filename, header, rows):
    response = HttpResponse(content_type="text/csv")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    writer = csv.writer(response)
    writer.writerow(header)
    for row in rows:
        # A leading =, +, - or @ would run as a formula when the file opens in a spreadsheet.
        writer.writerow([f"'{c}" if isinstance(c, str) and c[:1] in ("=", "+", "-", "@") else c for c in row])
    return response


class DashboardView(APIView):
    permission_classes = [IsEditorOrAdmin]
    serializer_class = Empty

    def get(self, request):
        now = timezone.now()
        today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        paid = Order.objects.filter(status="completed").exclude(order_type="gateway_test")

        def total(since):
            return paid.filter(paid_at__gte=since).aggregate(v=Sum("amount"))["v"] or 0

        by_day = {r["d"]: r["v"] for r in paid.filter(paid_at__gte=now - timedelta(days=30))
                  .annotate(d=TruncDate("paid_at")).values("d").annotate(v=Sum("amount"))}
        series = []
        for i in range(29, -1, -1):
            day = timezone.localdate() - timedelta(days=i)
            series.append({"date": day.isoformat(), "revenue": by_day.get(day, 0)})
        subs = Entitlement.objects.filter(kind="subscription", is_active=True, expires_at__gt=now)
        gateway, storage = PaymentGatewayConfig.load(), StorageConfig.load()
        top_views = Content.objects.filter(status="published").order_by("-view_count").values(
            "id", "title", "slug", "view_count")[:5]
        top_rev = list(paid.exclude(content=None).values("content__title", "content__slug").annotate(
            revenue=Sum("amount"), sales=Count("id")).order_by("-revenue")[:5])
        data = {
            "content_total": Content.objects.count(),
            "pending_comments": Comment.objects.filter(status="pending").count(),
            "failed_transcodes": MediaAsset.objects.filter(status="failed").count(),
            "top_content_views": list(top_views),
            "storage_status": storage.last_test_status,
            "gateway_status": gateway.last_test_status,
            "gateway_enabled": gateway.is_enabled,
            "storage_backend": storage.backend,
        }
        if request.user.role == "admin":
            data.update({
                "revenue_today": total(today), "revenue_7d": total(now - timedelta(days=7)),
                "revenue_30d": total(now - timedelta(days=30)), "revenue_series": series,
                "new_students_30d": User.objects.filter(role="student",
                                                        date_joined__gte=now - timedelta(days=30)).count(),
                "active_subscriptions": subs.values("user").distinct().count(),
                "expiring_soon": subs.filter(expires_at__lte=now + timedelta(days=7)).values("user").distinct().count(),
                "top_content_revenue": top_rev,
                "recent_payments": AdminOrderBrief(paid.select_related("user").order_by("-paid_at")[:6],
                                                   many=True).data,
            })
        return Response(data)


class AdminOrderBrief(serializers.ModelSerializer):
    class Meta:
        model = Order
        fields = ["id", "phone", "first_name", "last_name", "amount", "currency", "status", "order_type", "item_title",
                  "created_at", "paid_at", "payment_provider", "user"]


class UserRowSerializer(serializers.ModelSerializer):
    has_subscription = serializers.BooleanField(read_only=True, default=False)

    class Meta:
        model = User
        fields = ["id", "phone", "first_name", "last_name", "email", "role", "is_active", "source", "date_joined",
                  "last_seen", "must_change_password", "has_subscription"]
        read_only_fields = ["id", "date_joined", "last_seen", "source", "must_change_password", "has_subscription"]


class UserFilter(df.FilterSet):
    has_subscription = df.BooleanFilter()
    joined_after = df.DateFilter(field_name="date_joined", lookup_expr="date__gte")
    joined_before = df.DateFilter(field_name="date_joined", lookup_expr="date__lte")

    class Meta:
        model = User
        fields = ["role", "is_active", "source"]


def with_subscription(qs):
    now = timezone.now()
    current = Entitlement.objects.filter(user=OuterRef("pk"), kind="subscription", is_active=True, expires_at__gt=now)
    return qs.annotate(has_subscription=Exists(current))


class AdminUserViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminRole]
    serializer_class = UserRowSerializer
    filterset_class = UserFilter
    ordering_fields = ["date_joined", "last_seen", "first_name"]
    ordering = ["-date_joined"]
    http_method_names = ["get", "post", "patch"]

    def get_queryset(self):
        qs = with_subscription(User.objects.all())
        term = self.request.query_params.get("search", "").strip()
        if term:
            qs = qs.filter(Q(phone__icontains=term.lstrip("+0")) | Q(first_name__icontains=term)
                           | Q(last_name__icontains=term) | Q(email__icontains=term))
        return qs

    def create(self, request):
        data = request.data
        try:
            phone = normalize_phone(data.get("phone"))
        except InvalidPhone as exc:
            raise ApiError(str(exc), "invalid_phone") from exc
        if User.objects.filter(username=phone).exists():
            raise ApiError("A user with this phone already exists.", "exists", 409)
        user = User.objects.create_student(
            phone, data.get("password") or phone, first_name=data.get("first_name", ""),
            last_name=data.get("last_name", ""), email=data.get("email", ""), role=data.get("role", "student"),
            source=User.Source.ADMIN_CREATED, must_change_password=True)
        record(request, "user.create", user)
        return Response(UserRowSerializer(user).data, status=201)

    def _guard(self, user, request):
        if user.pk == request.user.pk:
            raise ApiError("You cannot do this to your own account.", "self_action", 409)
        admins = User.objects.filter(role="admin", is_active=True).exclude(pk=user.pk)
        if user.role == "admin" and not admins.exists():
            raise ApiError("This is the only active admin.", "last_admin", 409)

    def partial_update(self, request, *args, **kwargs):
        user = self.get_object()
        if "role" in request.data or "is_active" in request.data:
            self._guard(user, request)
        fields = ["first_name", "last_name", "email", "role", "is_active"]
        before = snapshot(user, fields)
        ser = self.get_serializer(user, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        record(request, "user.update", user, diff(before, snapshot(user, fields)))
        return Response(ser.data)

    @decorators.action(detail=True)
    def detail_data(self, request, pk=None):
        user = self.get_object()
        ctx = build_context(user)
        return Response({
            "user": UserRowSerializer(user).data,
            "subscription_expires_at": ctx.subscription_expires_at,
            "entitlements": EntitlementSerializer(user.entitlements.select_related("content", "plan")[:100],
                                                  many=True).data,
            "orders": AdminOrderBrief(user.orders.all()[:50], many=True).data,
            "comments": CommentSerializer(user.comments.select_related("user")[:30], many=True).data,
            "audit": AuditSerializer(AuditLog.objects.filter(target_type="User", target_id=str(user.pk))[:50],
                                     many=True).data,
        })

    @decorators.action(detail=True, methods=["post"], url_path="reset-password")
    def reset_password(self, request, pk=None):
        user = self.get_object()
        password = request.data.get("password") or user.phone
        user.set_password(password)
        user.must_change_password = True
        user.save(update_fields=["password", "must_change_password"])
        revoke_all_sessions(user)
        record(request, "user.reset_password", user)
        return Response({"ok": True})

    @decorators.action(detail=True, methods=["post"], url_path="force-password-change")
    def force_password_change(self, request, pk=None):
        user = self.get_object()
        user.must_change_password = True
        user.save(update_fields=["must_change_password"])
        record(request, "user.force_password_change", user)
        return Response({"ok": True})

    @decorators.action(detail=True, methods=["post"])
    def anonymise(self, request, pk=None):
        user = self.get_object()
        self._guard(user, request)
        with transaction.atomic():
            marker = str(user.pk).replace("-", "")[:9]
            user.username = user.phone = f"del{marker}"
            user.first_name, user.last_name, user.email = "Deleted", "user", ""
            user.is_active = False
            user.set_unusable_password()
            user.save()
            user.orders.update(phone="", first_name="Deleted", last_name="user", email="", raw_request={})
            revoke_all_sessions(user)
            record(request, "user.anonymise", user, label=str(user.pk))
        return Response({"ok": True})

    @decorators.action(detail=True, methods=["post"])
    def impersonate(self, request, pk=None):
        from django.core import signing

        user = self.get_object()
        if user.role != "student":
            raise ApiError("Only students can be viewed this way.")
        record(request, "user.view_as", user)
        response = Response({"ok": True})
        value = signing.dumps({"admin": str(request.user.pk), "target": str(user.pk)}, salt="view-as")
        response.set_cookie(IMPERSONATE_COOKIE, value, max_age=3600, httponly=True, samesite="Lax", path="/",
                            secure=settings.AUTH_COOKIE_SECURE)
        return response

    @decorators.action(detail=True, methods=["post"])
    def grant(self, request, pk=None):
        user = self.get_object()
        reason = (request.data.get("reason") or "").strip()
        if not reason:
            raise ApiError("Add a reason, for the audit trail.", "reason_required")
        days = request.data.get("days")
        days = int(days) if days else None
        expires = timezone.now() + timedelta(days=days) if days else None
        if request.data.get("kind") == "subscription":
            plan = get_object_or_404(SubscriptionPlan, pk=request.data.get("plan"))
            expires = expires or timezone.now() + timedelta(days=plan.duration_days)
            ent = Entitlement.objects.create(user=user, kind="subscription", plan=plan, expires_at=expires,
                                             granted_by="admin", reason=reason)
        else:
            content = get_object_or_404(Content, pk=request.data.get("content"))
            ent = Entitlement.objects.create(user=user, kind="content", content=content, expires_at=expires,
                                             granted_by="admin", reason=reason)
        record(request, "entitlement.grant", user, {"reason": reason, "kind": ent.kind, "expires_at": expires})
        return Response(EntitlementSerializer(ent).data, status=201)

    @decorators.action(detail=True, methods=["post"], url_path="entitlements/(?P<ent>[^/.]+)/revoke")
    def revoke(self, request, pk=None, ent=None):
        row = get_object_or_404(Entitlement, pk=ent, user_id=pk)
        reason = (request.data.get("reason") or "").strip()
        if not reason:
            raise ApiError("Add a reason, for the audit trail.", "reason_required")
        row.is_active, row.reason = False, reason
        row.save(update_fields=["is_active", "reason"])
        record(request, "entitlement.revoke", row.user, {"reason": reason, "entitlement": row.pk})
        return Response(EntitlementSerializer(row).data)

    @decorators.action(detail=True, methods=["post"], url_path="entitlements/(?P<ent>[^/.]+)/extend")
    def extend(self, request, pk=None, ent=None):
        row = get_object_or_404(Entitlement, pk=ent, user_id=pk)
        reason = (request.data.get("reason") or "").strip()
        days = int(request.data.get("days") or 0)
        if not reason or days <= 0:
            raise ApiError("Add a number of days and a reason.", "reason_required")
        base = max(row.expires_at or timezone.now(), timezone.now())
        row.expires_at, row.is_active = base + timedelta(days=days), True
        row.save(update_fields=["expires_at", "is_active"])
        record(request, "entitlement.extend", row.user, {"reason": reason, "days": days})
        return Response(EntitlementSerializer(row).data)

    @decorators.action(detail=False, methods=["post"])
    def bulk(self, request):
        ids, action = request.data.get("ids") or [], request.data.get("action")
        users = User.objects.filter(pk__in=ids).exclude(pk=request.user.pk).exclude(role="admin")
        if action == "suspend":
            count = users.update(is_active=False)
        elif action == "activate":
            count = users.update(is_active=True)
        elif action == "force_password_change":
            count = users.update(must_change_password=True)
        else:
            raise ApiError("Unknown bulk action.")
        record(request, f"user.bulk_{action}", None, {"ids": ids}, label=f"{count} users")
        return Response({"count": count})

    @decorators.action(detail=False)
    def export(self, request):
        qs = self.filter_queryset(self.get_queryset())
        rows = qs.values_list("phone", "first_name", "last_name", "email", "role", "is_active", "source",
                              "date_joined", "has_subscription")
        return csv_response("users.csv", ["phone", "first_name", "last_name", "email", "role", "active", "source",
                                          "joined", "subscribed"], rows)


class OrderFilter(df.FilterSet):
    date_from = df.DateFilter(field_name="created_at", lookup_expr="date__gte")
    date_to = df.DateFilter(field_name="created_at", lookup_expr="date__lte")
    phone = df.CharFilter(lookup_expr="icontains")

    class Meta:
        model = Order
        fields = ["status", "order_type"]


class AdminOrderViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAdminRole]
    queryset = Order.objects.select_related("user", "content", "plan")
    filterset_class = OrderFilter
    ordering_fields = ["created_at", "amount", "paid_at"]
    ordering = ["-created_at"]

    def get_serializer_class(self):
        return AdminOrderBrief if self.action == "list" else AdminOrderSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        term = self.request.query_params.get("search", "").strip()
        if term:
            qs = qs.filter(Q(phone__icontains=term) | Q(snippe_reference__icontains=term)
                           | Q(item_title__icontains=term) | Q(first_name__icontains=term))
        return qs

    @decorators.action(detail=True, methods=["post"])
    def recheck(self, request, pk=None):
        order = self.get_object()
        try:
            state = services.reconcile(order)
        except SnippeError as exc:
            raise ApiError(f"Snippe could not answer: {exc}", "gateway_error", 502) from exc
        if state is None:
            raise ApiError("This order never reached Snippe.", "no_reference")
        record(request, "order.recheck", order, {"gateway_status": state})
        return Response({"gateway_status": state, **AdminOrderSerializer(self.get_queryset().get(pk=pk)).data})

    @decorators.action(detail=False)
    def export(self, request):
        rows = self.filter_queryset(self.get_queryset()).values_list(
            "id", "created_at", "paid_at", "status", "order_type", "item_title", "phone", "first_name", "last_name",
            "amount", "currency", "payment_provider", "snippe_reference")
        return csv_response("orders.csv", ["id", "created", "paid", "status", "type", "item", "phone", "first_name",
                                           "last_name", "amount", "currency", "provider", "reference"], rows)


class AdminPlanViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminRole]
    queryset = SubscriptionPlan.objects.annotate(subscribers=Count("orders", filter=Q(orders__status="completed")))
    serializer_class = PlanSerializer
    pagination_class = None
    filter_backends = []
    FIELDS = ["name", "price", "promo_price", "duration_days", "is_active", "highlighted"]

    def perform_create(self, ser):
        record(self.request, "plan.create", ser.save())

    def perform_update(self, ser):
        before = snapshot(ser.instance, self.FIELDS)
        plan = ser.save()
        record(self.request, "plan.update", plan, diff(before, snapshot(plan, self.FIELDS)))

    def perform_destroy(self, instance):
        if Order.objects.filter(plan=instance).exists():
            raise ApiError("This plan has orders. Deactivate it instead.", "in_use", 409)
        record(self.request, "plan.delete", instance)
        instance.delete()


class ModerationSerializer(CommentSerializer):
    content_title = serializers.CharField(source="content.title")
    content_slug = serializers.CharField(source="content.slug")
    content_id = serializers.UUIDField()
    content_allow_comments = serializers.BooleanField(source="content.allow_comments")
    report_count = serializers.IntegerField()

    class Meta(CommentSerializer.Meta):
        fields = CommentSerializer.Meta.fields + ["content_title", "content_slug", "content_id", "content_allow_comments",
                                                  "report_count"]


class AdminCommentViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsEditorOrAdmin]
    serializer_class = ModerationSerializer
    queryset = Comment.objects.select_related("user", "content").order_by("-created_at")
    filterset_fields = ["status", "content"]

    def get_queryset(self):
        qs = super().get_queryset()
        term = self.request.query_params.get("search", "").strip()
        return qs.filter(Q(body__icontains=term) | Q(guest_name__icontains=term)) if term else qs

    @decorators.action(detail=False)
    def counts(self, request):
        rows = dict(Comment.objects.order_by().values_list("status").annotate(n=Count("id")))
        return Response(rows)

    @decorators.action(detail=False, methods=["post"])
    def bulk(self, request):
        ids, action = request.data.get("ids") or [], request.data.get("action")
        statuses = {"approve": "approved", "hide": "hidden", "spam": "spam"}
        comments = Comment.objects.filter(pk__in=ids)
        if action in statuses:
            for comment in comments:  # save() rather than update(), so the counter signal fires
                comment.status = statuses[action]
                comment.save(update_fields=["status"])
        elif action in ("pin", "unpin"):
            comments.update(is_pinned=action == "pin")
        elif action == "delete":
            comments.delete()
        else:
            raise ApiError("Unknown action.")
        record(request, f"comment.bulk_{action}", None, {"ids": ids}, label=f"{len(ids)} comments")
        return Response({"ok": True})

    @decorators.action(detail=True, methods=["post"])
    def reply(self, request, pk=None):
        parent = self.get_object()
        body = (request.data.get("body") or "").strip()
        if not body:
            raise ApiError("Write a reply first.")
        top = parent.parent or parent
        reply = Comment.objects.create(content=parent.content, user=request.user, body=body, parent=top,
                                       status=Comment.Status.APPROVED)
        if parent.status == Comment.Status.PENDING:
            parent.status = Comment.Status.APPROVED
            parent.save(update_fields=["status"])
        return Response(CommentSerializer(reply, context={"request": request}).data, status=201)


class AuditSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLog
        fields = "__all__"


class AuditViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAdminRole]
    serializer_class = AuditSerializer
    queryset = AuditLog.objects.all()
    filterset_fields = ["action", "target_type"]

    def get_queryset(self):
        qs = super().get_queryset()
        term = self.request.query_params.get("search", "").strip()
        return qs.filter(Q(action__icontains=term) | Q(target_label__icontains=term)
                         | Q(actor_label__icontains=term)) if term else qs


class SiteSettingsSerializer(serializers.ModelSerializer):
    logo_url = serializers.SerializerMethodField()
    favicon_url = serializers.SerializerMethodField()
    teacher_photo_url = serializers.SerializerMethodField()
    updated_by_name = serializers.CharField(source="updated_by.get_full_name", default="", read_only=True)

    class Meta:
        model = SiteSettings
        exclude = ["id", "created_at"]
        read_only_fields = ["updated_at", "updated_by"]

    def get_logo_url(self, obj):
        return public_url(obj.logo)

    def get_favicon_url(self, obj):
        return public_url(obj.favicon)

    def get_teacher_photo_url(self, obj):
        return public_url(obj.teacher_photo)

    def validate_teacher_subjects(self, value):
        if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
            raise serializers.ValidationError("Enter a list of subjects.")
        return [v.strip() for v in value if v.strip()]


class SiteSettingsView(APIView):
    permission_classes = [IsAdminRole]
    serializer_class = SiteSettingsSerializer

    def get(self, request):
        return Response(SiteSettingsSerializer(SiteSettings.load()).data)

    def patch(self, request):
        obj = SiteSettings.objects.get_or_create(pk=1)[0]
        fields = [f for f in request.data if f in SiteSettingsSerializer.Meta.model._meta.fields_map or hasattr(obj, f)]
        before = snapshot(obj, fields)
        ser = SiteSettingsSerializer(obj, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save(updated_by=request.user)
        record(request, "settings.update", obj, diff(before, snapshot(obj, fields)), label="Site settings")
        return Response(ser.data)


class GatewayConfigView(APIView):
    permission_classes = [IsAdminRole]
    serializer_class = GatewayConfigSerializer
    FIELDS = ["display_name", "is_enabled", "mode_label", "api_base_url", "api_key", "webhook_secret", "session_token",
              "default_method", "hosted_profile_id", "redirect_url", "expiry_hours", "poll_seconds"]

    def _payload(self, cfg):
        return {**GatewayConfigSerializer(cfg).data, "webhook_url": services.webhook_url(), "steps": [
            {"key": k, "title": gateway_diag.TITLES[k]} for k in gateway_diag.STEPS]}

    def get(self, request):
        return Response(self._payload(PaymentGatewayConfig.load()))

    def patch(self, request):
        cfg = PaymentGatewayConfig.load()
        if request.data.get("is_enabled") is True and cfg.last_test_status != "passed":
            raise ApiError("Run the test and pass steps 1 to 3 before enabling.", "test_required", 409)
        before = snapshot(cfg, self.FIELDS)
        ser = GatewayConfigSerializer(cfg, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save(updated_by=request.user)
        record(request, "gateway.update", cfg, diff(before, snapshot(cfg, self.FIELDS)), label="Snippe gateway")
        return Response(self._payload(cfg))


class GatewayTestView(APIView):
    permission_classes = [IsAdminRole]
    serializer_class = Empty

    def post(self, request):
        step = request.data.get("step")
        if step not in gateway_diag.STEPS:
            raise ApiError("Unknown step.")
        cfg = PaymentGatewayConfig.load()
        outcome = gateway_diag.run_step(cfg, step)
        if step == gateway_diag.STEPS[-1]:
            record(request, "gateway.test", cfg, {"result": cfg.last_test_status}, label="Snippe gateway")
        return Response({"step": outcome, "last_test_status": cfg.last_test_status,
                         "last_tested_at": cfg.last_tested_at})


class GatewayLiveTestView(APIView):
    """A real 500 TZS push to the admin's own phone. Creates a gateway_test order with no entitlement."""

    permission_classes = [IsAdminRole]
    serializer_class = Empty

    def post(self, request):
        try:
            phone = normalize_phone(request.data.get("phone"))
        except InvalidPhone as exc:
            raise ApiError(str(exc), "invalid_phone") from exc
        (order, _token), _ = services.create_order(
            order_type=Order.Type.GATEWAY_TEST, phone=phone, first_name=request.user.first_name or "Admin",
            last_name=request.user.last_name or "Test", email=request.user.email, user=request.user, amount=500)
        order = services.start_payment(order)
        record(request, "gateway.live_test", order, label="Live test payment")
        return Response({"id": str(order.pk), "status": order.status, "reference": order.snippe_reference})


class WebhookEventsView(APIView):
    permission_classes = [IsAdminRole]
    serializer_class = Empty

    def get(self, request):
        rows = WebhookEvent.objects.values("id", "event_id", "type", "signature_valid", "received_at", "processed_at",
                                           "processing_error")[:50]
        return Response(list(rows))


class NotificationConfigSerializer(serializers.ModelSerializer):
    SECRETS = ("sms_api_key", "sms_api_secret", "smtp_password")
    sms_api_key = serializers.CharField(write_only=True, required=False, allow_blank=True)
    sms_api_secret = serializers.CharField(write_only=True, required=False, allow_blank=True)
    smtp_password = serializers.CharField(write_only=True, required=False, allow_blank=True)
    sms_api_key_masked = serializers.SerializerMethodField()
    sms_api_secret_masked = serializers.SerializerMethodField()
    smtp_password_masked = serializers.SerializerMethodField()
    sms_ready = serializers.BooleanField(read_only=True)
    email_ready = serializers.BooleanField(read_only=True)
    updated_by_name = serializers.CharField(source="updated_by.get_full_name", default="", read_only=True)

    class Meta:
        model = NotificationConfig
        exclude = ["id", "created_at"]
        read_only_fields = ["updated_at", "updated_by", "sms_tested_at", "sms_test_status", "sms_test_report",
                            "email_tested_at", "email_test_status", "email_test_report"]

    def get_sms_api_key_masked(self, obj):
        return mask_secret(obj.sms_api_key)

    def get_sms_api_secret_masked(self, obj):
        return mask_secret(obj.sms_api_secret)

    def get_smtp_password_masked(self, obj):
        return mask_secret(obj.smtp_password)

    def validate_generic_method(self, value):
        if value not in ("GET", "POST", "PUT"):
            raise serializers.ValidationError("Use GET, POST or PUT.")
        return value

    def validate_generic_headers(self, value):
        if not isinstance(value, dict) or not all(isinstance(v, str) for v in value.values()):
            raise serializers.ValidationError('Enter a JSON object, like {"Content-Type": "application/json"}.')
        return value

    def validate_generic_url(self, value):
        if value and not value.startswith(("http://", "https://")):
            raise serializers.ValidationError("Start the URL with http:// or https://.")
        return value

    def update(self, instance, validated):
        for secret in self.SECRETS:
            if not validated.get(secret):
                validated.pop(secret, None)
        return super().update(instance, validated)


class NotificationConfigView(APIView):
    permission_classes = [IsAdminRole]
    serializer_class = NotificationConfigSerializer
    FIELDS = ["sms_enabled", "sms_provider", "sms_api_key", "sms_api_secret", "sms_username", "sms_sender_id",
              "sms_base_url", "generic_url", "generic_method", "email_enabled", "smtp_host", "smtp_port",
              "smtp_security", "smtp_username", "smtp_password", "email_from_name", "email_from_address",
              "reminder_days"]

    def _payload(self, cfg):
        return {**NotificationConfigSerializer(cfg).data, "steps": {
            channel: [{"key": k, "title": notify_diag.TITLES[channel][k]} for k in keys]
            for channel, keys in notify_diag.STEPS.items()}}

    def get(self, request):
        return Response(self._payload(NotificationConfig.load()))

    def patch(self, request):
        cfg = NotificationConfig.load()
        before = snapshot(cfg, self.FIELDS)
        ser = NotificationConfigSerializer(cfg, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save(updated_by=request.user)
        record(request, "notifications.update", cfg, diff(before, snapshot(cfg, self.FIELDS)), label="Notifications")
        return Response(self._payload(cfg))


class NotificationTestView(APIView):
    permission_classes = [IsAdminRole]
    serializer_class = Empty

    def post(self, request):
        channel, step = request.data.get("channel"), request.data.get("step")
        if channel not in notify_diag.STEPS or step not in notify_diag.STEPS[channel]:
            raise ApiError("Unknown step.")
        to = str(request.data.get("to") or "").strip()
        if channel == "sms" and to:
            try:
                to = normalize_phone(to)
            except InvalidPhone as exc:
                raise ApiError(str(exc), "invalid_phone") from exc
        cfg = NotificationConfig.load()
        outcome = notify_diag.run_step(cfg, channel, step, to)
        if step == notify_diag.STEPS[channel][-1]:
            record(request, "notifications.test", cfg, {"channel": channel, "status": outcome["status"]},
                   label="Notifications")
        return Response({"step": outcome})


class NotificationTemplateSerializer(serializers.ModelSerializer):
    label = serializers.SerializerMethodField()
    placeholders = serializers.SerializerMethodField()

    class Meta:
        model = NotificationTemplate
        fields = ["key", "label", "placeholders", "subject_en", "subject_sw", "body_en", "body_sw", "is_enabled"]
        read_only_fields = ["key"]

    def get_label(self, obj):
        return notifications.DEFAULTS[obj.key]["label"]

    def get_placeholders(self, obj):
        return notifications.DEFAULTS[obj.key]["placeholders"]

    def validate(self, attrs):
        unknown = notifications.unknown_placeholders(
            self.instance.key, *[v for v in attrs.values() if isinstance(v, str)])
        if unknown:
            raise serializers.ValidationError(
                {"body_en": f"Not available in this message: {', '.join('{' + u + '}' for u in unknown)}"})
        return attrs


class NotificationTemplatesView(APIView):
    permission_classes = [IsAdminRole]
    serializer_class = NotificationTemplateSerializer

    def get(self, request):
        rows = [notifications.template_for(key) for key in notifications.DEFAULTS]
        return Response(NotificationTemplateSerializer(rows, many=True).data)

    def patch(self, request):
        key = request.data.get("key")
        if key not in notifications.DEFAULTS:
            raise ApiError("Unknown template.", "not_found", 404)
        row = notifications.template_for(key)
        ser = NotificationTemplateSerializer(row, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        record(request, "notifications.template", row, label=key)
        return Response(ser.data)


class NotificationLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationLog
        fields = ["id", "created_at", "channel", "template", "recipient_masked", "status", "provider",
                  "provider_response", "attempts"]


class NotificationLogViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAdminRole]
    serializer_class = NotificationLogSerializer
    filterset_fields = ["channel", "status", "template"]

    def get_queryset(self):
        return NotificationLog.objects.all()


class StorageConfigView(APIView):
    permission_classes = [IsAdminRole]
    serializer_class = StorageConfigSerializer
    FIELDS = ["backend", "aws_access_key_id", "aws_secret_access_key", "region", "bucket", "public_bucket",
              "endpoint_url", "key_prefix", "cloudfront_domain", "cloudfront_key_pair_id", "signed_url_ttl",
              "transcoding_engine", "mediaconvert_role_arn"]

    def _payload(self, cfg):
        return {**StorageConfigSerializer(cfg).data, "cors_json": storage_diag.cors_rules(), "steps": [
            {"key": k, "title": storage_diag.TITLES[k]} for k in storage_diag.STEPS]}

    def get(self, request):
        return Response(self._payload(StorageConfig.load()))

    def patch(self, request):
        cfg = StorageConfig.objects.get_or_create(pk=1)[0]
        before = snapshot(cfg, self.FIELDS)
        ser = StorageConfigSerializer(cfg, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save(updated_by=request.user)
        record(request, "storage.update", cfg, diff(before, snapshot(cfg, self.FIELDS)), label="Storage")
        cache.delete(StorageConfig._cache_key())
        return Response(self._payload(cfg))


class StorageTestView(APIView):
    permission_classes = [IsAdminRole]
    serializer_class = Empty

    def post(self, request):
        step = request.data.get("step")
        if step not in storage_diag.STEPS:
            raise ApiError("Unknown step.")
        cfg = StorageConfig.objects.get_or_create(pk=1)[0]
        outcome = storage_diag.run_step(cfg, step)
        cache.delete(StorageConfig._cache_key())
        if step == storage_diag.STEPS[-1]:
            record(request, "storage.test", cfg, {"result": cfg.last_test_status}, label="Storage")
        return Response({"step": outcome, "last_test_status": cfg.last_test_status,
                         "last_tested_at": cfg.last_tested_at})


class CommandSearchView(APIView):
    """Backs the Ctrl/Cmd+K palette."""

    permission_classes = [IsEditorOrAdmin]
    serializer_class = Empty

    def get(self, request):
        term = request.query_params.get("q", "").strip()
        if len(term) < 2:
            return Response({"contents": [], "users": []})
        contents = Content.objects.filter(title__icontains=term).values("id", "title", "status")[:6]
        users = []
        if request.user.role == "admin":
            users = User.objects.filter(Q(phone__icontains=term) | Q(first_name__icontains=term)
                                        | Q(last_name__icontains=term)).values("id", "first_name", "last_name",
                                                                                "phone")[:6]
        return Response({"contents": list(contents), "users": list(users)})


__all__ = ["current_entitlements"]
