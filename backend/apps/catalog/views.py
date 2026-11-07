import re

import django_filters as df
from django.contrib.postgres.search import SearchQuery, SearchRank
from django.db import transaction
from django.db.models import Count, F, Q
from django.db.models.functions import Coalesce
from django.http import Http404, HttpResponse
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import decorators, generics, mixins, permissions, serializers, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core import branding
from apps.core.api import ApiError, IsEditorOrAdmin
from apps.core.audit import diff, record, snapshot
from apps.core.models import Announcement, SiteSettings
from apps.payments.access import can_access, context_for, current_entitlements
from apps.payments.models import Entitlement, PaymentGatewayConfig, SubscriptionPlan

from . import serializers as s
from . import services
from .models import Category, Content, ContentRevision, Tag

AUDITED_FIELDS = ["title", "status", "access_level", "price", "promo_price", "included_in_subscription",
                  "access_duration_days", "featured", "category_id", "slug"]


def card_qs():
    return Content.objects.select_related("category", "main_asset")


def live_qs():
    now = timezone.now()
    return card_qs().filter(status=Content.Status.PUBLISHED).filter(
        Q(published_at__isnull=True) | Q(published_at__lte=now))


def search(qs, term):
    words = re.findall(r"\w+", term, flags=re.UNICODE)[:8]
    if not words:
        return qs
    query = SearchQuery(" & ".join(f"{w}:*" for w in words), search_type="raw", config="simple")
    return qs.filter(search_vector=query).annotate(rank=SearchRank("search_vector", query)).order_by(
        "-rank", "-published_at")


class ContentFilter(df.FilterSet):
    type = df.CharFilter(field_name="content_type")
    tag = df.CharFilter(method="filter_tags")
    category = df.CharFilter(method="filter_category")
    access = df.CharFilter(method="filter_access")
    featured = df.BooleanFilter()

    class Meta:
        model = Content
        fields = []

    def filter_tags(self, qs, name, value):
        return qs.filter(tags__slug__in=value.split(",")).distinct()

    def filter_category(self, qs, name, value):
        return qs.filter(Q(category__slug=value) | Q(category__parent__slug=value))

    def filter_access(self, qs, name, value):
        if value in ("free", "paid"):
            return qs.filter(access_level=value)
        if value == "unlocked":
            user = self.request.user
            if not user.is_authenticated:
                return qs.none()
            ctx = context_for(self.request)
            if ctx.is_staff:
                return qs.filter(access_level="paid")
            q = Q(pk__in=ctx.content_ids)
            if ctx.has_subscription:
                q |= Q(included_in_subscription=True)
            return qs.filter(q, access_level="paid")
        return qs


SORTS = {"newest": ["-published_at"], "popular": ["-view_count"], "liked": ["-like_count"],
         "price": ["price_sort", "-published_at"], "price_desc": ["-price_sort", "-published_at"]}


class ContentViewSet(viewsets.ReadOnlyModelViewSet):
    lookup_field = "slug"
    filterset_class = ContentFilter
    filter_backends = [df.rest_framework.DjangoFilterBackend]

    def get_serializer_class(self):
        return s.ContentDetailSerializer if self.action == "retrieve" else s.ContentCardSerializer

    def get_queryset(self):
        if self.action == "retrieve":
            return self.detail_qs()
        qs = live_qs()
        term = self.request.query_params.get("q", "").strip()
        if term:
            return search(qs, term)
        sort = self.request.query_params.get("sort", "newest")
        return qs.annotate(price_sort=Coalesce("promo_price", "price", 0)).order_by(*SORTS.get(sort, SORTS["newest"]))

    def detail_qs(self):
        return card_qs().select_related("author").prefetch_related("tags", "assets")

    def get_object(self):
        obj = super().get_object()
        ctx = context_for(self.request)
        visible = obj.is_live or ctx.is_staff or (
            obj.status == Content.Status.ARCHIVED and obj.is_paid and can_access(self.request.user, obj, ctx))
        if not visible:
            raise ApiError("This content is not available.", "not_found", 404)
        return obj

    @decorators.action(detail=True)
    def related(self, request, slug=None):
        obj = self.get_object()
        qs = live_qs().exclude(pk=obj.pk)
        tags = obj.tags.values_list("pk", flat=True)
        related = qs.filter(Q(category=obj.category) | Q(tags__in=tags)).distinct().order_by("-view_count")[:6]
        return Response(s.ContentCardSerializer(related, many=True, context={"request": request}).data)


class CategoryTreeView(APIView):
    serializer_class = s.CategoryTreeSerializer

    def get(self, request):
        roots = Category.objects.filter(parent=None, is_active=True).prefetch_related("children")
        counts = dict(live_qs().order_by().values_list("category").annotate(n=Count("id")))
        return Response(s.CategoryTreeSerializer(roots, many=True, context={"counts": counts}).data)


class TagListView(generics.ListAPIView):
    queryset = Tag.objects.annotate(n=Count("contents")).filter(n__gt=0)
    serializer_class = s.TagSerializer
    pagination_class = None
    filter_backends = []


class HomeSerializer(serializers.Serializer):
    pass


class HomeView(APIView):
    serializer_class = HomeSerializer

    def get(self, request):
        ctx = {"request": request}
        card = lambda qs: s.ContentCardSerializer(qs, many=True, context=ctx).data  # noqa: E731
        base = live_qs()
        return Response({
            "featured": card(base.filter(featured=True)[:6]),
            "latest_free": card(base.filter(access_level="free")[:8]),
            "popular": card(base.order_by("-view_count")[:8]),
        })


class SitemapView(APIView):
    serializer_class = HomeSerializer

    def get(self, request):
        rows = live_qs().values("slug", "updated_at")[:5000]
        return Response({"contents": list(rows), "categories": list(
            Category.objects.filter(is_active=True).values_list("slug", flat=True))})


class SiteView(APIView):
    """Public configuration: branding, plans, and whether checkout is possible."""

    serializer_class = HomeSerializer

    def get(self, request):
        from apps.payments.serializers import PlanSerializer

        cfg = SiteSettings.load()
        gateway = PaymentGatewayConfig.load()
        return Response({
            "site_name": cfg.site_name, "tagline": cfg.tagline, "hero_title": cfg.hero_title,
            "hero_subtitle": cfg.hero_subtitle, "logo_url": s.public_url(cfg.logo),
            "favicon_url": s.public_url(cfg.favicon), "icons": branding.icon_urls(cfg),
            "primary_color": cfg.primary_color,
            "contact_email": cfg.contact_email, "contact_phone": cfg.contact_phone, "social_links": cfg.social_links,
            "contact_whatsapp": cfg.contact_whatsapp, "maintenance_message": cfg.maintenance_message,
            "teacher": {"photo_url": s.public_url(cfg.teacher_photo), "name": cfg.teacher_name,
                        "title": cfg.teacher_title, "bio": cfg.teacher_bio, "credentials": cfg.teacher_credentials,
                        "years": cfg.teacher_years, "subjects": cfg.teacher_subjects},
            "currency": cfg.currency, "guest_comment_policy": cfg.guest_comment_policy, "allow_signup": cfg.allow_signup,
            "faq": cfg.faq, "seo_title": cfg.seo_title, "seo_description": cfg.seo_description,
            "maintenance_mode": cfg.maintenance_mode, "checkout_available": gateway.checkout_available,
            "payment_method": gateway.default_method if gateway.hosted_available else "ussd_push",
            "poll_seconds": gateway.poll_seconds, "default_content_price": cfg.default_content_price,
            "plans": PlanSerializer(SubscriptionPlan.objects.filter(is_active=True), many=True).data,
            "announcements": [{
                "id": str(a.pk), "version": a.updated_at.isoformat(), "title": a.title, "body": a.body,
                "title_sw": a.title_sw, "body_sw": a.body_sw, "link_url": a.link_url, "link_label": a.link_label,
                "link_label_sw": a.link_label_sw, "tone": a.tone, "placement": a.placement, "audience": a.audience,
                "dismissible": a.dismissible, "ends_at": a.ends_at,
            } for a in Announcement.live()[:6]],
        })


class BrandIconView(APIView):
    """PWA and home-screen icons, generated from the current logo, colour and site name."""

    authentication_classes = []
    serializer_class = HomeSerializer

    def get(self, request, name):
        if name not in branding.ICONS:
            raise Http404
        response = HttpResponse(branding.icon_png(SiteSettings.load(), name), content_type="image/png")
        response["Cache-Control"] = "public, max-age=3600"  # every reference carries a ?v= that changes with the brand
        return response


class ContinueLearningView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = HomeSerializer

    def get(self, request):
        from apps.engagement.models import ReadingProgress

        rows = ReadingProgress.objects.filter(user=request.user, percent__lt=98).select_related(
            "content", "content__category", "content__main_asset")[:8]
        ctx = {"request": request}
        return Response([{**s.ContentCardSerializer(r.content, context=ctx).data, "percent": r.percent,
                          "position_seconds": r.position_seconds} for r in rows if r.content.is_live])


# ---------- admin ----------
class AdminContentViewSet(viewsets.ModelViewSet):
    permission_classes = [IsEditorOrAdmin]
    queryset = Content.objects.select_related("category", "author", "main_asset").prefetch_related("tags")
    filterset_fields = ["status", "content_type", "access_level", "category", "featured"]
    ordering_fields = ["updated_at", "published_at", "title", "view_count", "price", "created_at"]
    ordering = ["-updated_at"]

    def get_serializer_class(self):
        return s.AdminContentListSerializer if self.action == "list" else s.AdminContentSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        term = self.request.query_params.get("search", "").strip()
        return qs.filter(Q(title__icontains=term) | Q(subtitle__icontains=term)) if term else qs

    def _tags(self, content, names):
        if names is not None:
            tags = [Tag.objects.filter(name__iexact=n.strip()).first() or Tag.objects.create(name=n.strip())
                    for n in names if n.strip()]
            content.tags.set(tags)

    @transaction.atomic
    def perform_create(self, ser):
        names = ser.validated_data.pop("tags", None)
        defaults = SiteSettings.load()
        data = {"allow_comments": defaults.default_allow_comments, "allow_reactions": defaults.default_allow_reactions,
                "allow_bookmarks": defaults.default_allow_bookmarks, "allow_download": defaults.default_allow_download,
                "show_view_count": defaults.default_show_view_count}
        data.update(ser.validated_data)
        content = Content(author=self.request.user, **data)
        content.title = content.title or "Untitled"
        services.ensure_slug(content)
        services.apply_status(content)
        content.save()
        ser.instance = content
        self._tags(content, names)
        services.refresh_derived(content)
        record(self.request, "content.create", content)

    @transaction.atomic
    def perform_update(self, ser):
        names = ser.validated_data.pop("tags", None)
        before = snapshot(ser.instance, AUDITED_FIELDS)
        slug = ser.validated_data.get("slug")
        if slug == "":
            ser.validated_data.pop("slug")
        content = ser.save()
        if not slug and content.slug.startswith("untitled") and content.published_at is None:
            content.slug = ""  # the first real title replaces the placeholder, until the URL goes public
        services.ensure_slug(content)
        services.apply_status(content)
        content.save()
        self._tags(content, names)
        services.refresh_derived(content)
        if self.request.query_params.get("autosave"):
            services.maybe_autosave_revision(content, self.request.user)
        else:
            services.snapshot_revision(content, self.request.user, "Manual save")
        changes = diff(before, snapshot(content, AUDITED_FIELDS))
        if changes:
            record(self.request, "content.update", content, changes)

    def perform_destroy(self, instance):
        self._guard_buyers(Content.objects.filter(pk=instance.pk))
        record(self.request, "content.delete", instance)
        instance.delete()

    @staticmethod
    def _guard_buyers(qs):
        if Entitlement.objects.filter(content__in=qs, is_active=True).exists():
            raise ApiError("This has been purchased. Archive it instead, so buyers keep access.", "has_buyers", 409)

    @decorators.action(detail=True, methods=["post"])
    def duplicate(self, request, pk=None):
        copy = services.duplicate(self.get_object(), request.user)
        record(request, "content.duplicate", copy)
        return Response(s.AdminContentListSerializer(copy).data, status=201)

    @decorators.action(detail=True)
    def revisions(self, request, pk=None):
        rows = self.get_object().revisions.select_related("author")[:50]
        return Response(s.RevisionSerializer(rows, many=True).data)

    @decorators.action(detail=True, methods=["post"], url_path="revisions/(?P<rev>[0-9]+)/restore")
    @transaction.atomic
    def restore(self, request, pk=None, rev=None):
        content = self.get_object()
        revision = ContentRevision.objects.get(pk=rev, content=content)
        services.snapshot_revision(content, request.user, "Before restore")
        content.title, content.subtitle, content.body_json = revision.title, revision.subtitle, revision.body_json
        content.save()
        services.refresh_derived(content)
        record(request, "content.restore_revision", content, {"revision": rev})
        return Response(s.AdminContentSerializer(content).data)

    @decorators.action(detail=True)
    def preview(self, request, pk=None):
        content = self.get_object()
        data = s.ContentDetailSerializer(content, context={"request": request}).data
        return Response(data)

    @decorators.action(detail=False, methods=["post"])
    @transaction.atomic
    def bulk(self, request):
        ids, action = request.data.get("ids") or [], request.data.get("action")
        if not ids:
            raise ApiError("Select at least one item.")
        qs = Content.objects.filter(pk__in=ids)
        count = qs.count()
        if action == "publish":
            for content in qs:
                content.status = Content.Status.PUBLISHED
                services.apply_status(content)
                content.save(update_fields=["status", "published_at"])
        elif action == "unpublish":
            qs.update(status=Content.Status.DRAFT)
        elif action == "archive":
            qs.update(status=Content.Status.ARCHIVED)
        elif action == "move":
            qs.update(category=Category.objects.get(pk=request.data.get("category")))
        elif action == "delete":
            self._guard_buyers(qs)
            qs.delete()
        else:
            raise ApiError("Unknown bulk action.")
        record(request, f"content.bulk_{action}", None, {"ids": ids}, label=f"{count} items")
        return Response({"ok": True, "count": count})


class AdminCategoryViewSet(viewsets.ModelViewSet):
    permission_classes = [IsEditorOrAdmin]
    queryset = Category.objects.all()
    pagination_class = None
    filter_backends = []

    def get_serializer_class(self):
        class Write(serializers.ModelSerializer):
            class Meta:
                model = Category
                fields = ["id", "name", "slug", "description", "icon", "color", "cover_image", "parent", "order",
                          "is_active"]
                extra_kwargs = {"slug": {"required": False, "allow_blank": True}}

        return Write

    def list(self, request):
        roots = Category.objects.filter(parent=None).prefetch_related("children")
        counts = dict(Content.objects.order_by().values_list("category").annotate(n=Count("id")))
        return Response(s.CategoryTreeSerializer(roots, many=True, context={"counts": counts, "all": True}).data)

    def destroy(self, request, *args, **kwargs):
        cat = self.get_object()
        reassign = request.data.get("reassign_to") or request.query_params.get("reassign_to")
        affected = Content.objects.filter(Q(category=cat) | Q(category__parent=cat))
        if affected.exists() or cat.children.exists():
            if not reassign:
                raise ApiError(f"{affected.count()} items use this category. Choose where to move them first.",
                               "category_in_use", 409, {"content_count": affected.count()})
            target = Category.objects.get(pk=reassign)
            if target.pk == cat.pk or target.parent_id == cat.pk:
                raise ApiError("Choose a category outside the one being deleted.")
            with transaction.atomic():
                affected.update(category=target)
                cat.children.all().delete()
        record(request, "category.delete", cat)
        cat.delete()
        return Response(status=204)

    @decorators.action(detail=False, methods=["post"])
    @transaction.atomic
    def reorder(self, request):
        """Accepts [{id, parent, order}] and applies the whole tree, validating depth."""
        rows = request.data.get("items") or []
        parents = {str(r["id"]): r.get("parent") for r in rows}
        for row in rows:
            parent = row.get("parent")
            if parent and (parents.get(str(parent)) or str(parent) == str(row["id"])):
                raise ApiError("Categories can only be nested two levels deep.", "max_depth")
            if parent and any(p == str(row["id"]) for p in map(str, filter(None, parents.values()))):
                raise ApiError("A category with subcategories cannot become one.", "max_depth")
        for row in rows:
            Category.objects.filter(pk=row["id"]).update(parent=row.get("parent") or None, order=row.get("order", 0))
        record(request, "category.reorder", None, label=f"{len(rows)} categories")
        return Response({"ok": True})


class AdminTagViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, mixins.DestroyModelMixin,
                      viewsets.GenericViewSet):
    permission_classes = [IsEditorOrAdmin]
    queryset = Tag.objects.all()
    serializer_class = s.TagSerializer
    pagination_class = None
    filter_backends = []


__all__ = ["current_entitlements", "extend_schema", "F"]
