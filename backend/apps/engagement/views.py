import hashlib
import re
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.db.models import F, Prefetch
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, serializers
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.catalog.models import Content
from apps.catalog.serializers import ContentCardSerializer
from apps.catalog.views import live_qs
from apps.core.api import ApiError, CommentThrottle
from apps.core.models import SiteSettings
from apps.payments.access import can_access, context_for

from .models import Bookmark, Comment, CommentLike, Reaction, ReadingProgress, ViewEvent

EDIT_WINDOW = timedelta(minutes=15)
SPAM_WORDS = ("viagra", "casino", "crypto giveaway", "forex signal", "bet now", "whatsapp me", "loan offer")
SessionOnly = permissions.IsAuthenticated


class CommentSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()
    is_teacher = serializers.SerializerMethodField()
    is_mine = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    liked = serializers.SerializerMethodField()
    replies = serializers.SerializerMethodField()

    class Meta:
        model = Comment
        fields = ["id", "body", "parent", "status", "is_pinned", "like_count", "created_at", "edited_at",
                  "author_name", "is_teacher", "is_mine", "can_edit", "liked", "replies"]

    def get_author_name(self, obj):
        return obj.user.display_name if obj.user_id else (obj.guest_name or "Guest")

    def get_is_teacher(self, obj):
        return bool(obj.user_id and obj.user.is_staff_role)

    def _user(self):
        user = getattr(self.context.get("request"), "user", None)
        return user if user is not None and user.is_authenticated else None

    def get_is_mine(self, obj):
        user = self._user()
        return bool(user and obj.user_id == user.pk)

    def get_can_edit(self, obj):
        return self.get_is_mine(obj) and timezone.now() - obj.created_at < EDIT_WINDOW

    def get_liked(self, obj):
        return obj.pk in self.context.get("liked", ())

    def get_replies(self, obj):
        if obj.parent_id:
            return []
        rows = getattr(obj, "visible_replies", [])
        return CommentSerializer(rows, many=True, context=self.context).data


class CommentWrite(serializers.Serializer):
    body = serializers.CharField(max_length=4000, trim_whitespace=True)
    parent = serializers.UUIDField(required=False, allow_null=True)
    guest_name = serializers.CharField(max_length=80, required=False, allow_blank=True)


def looks_spammy(text):
    lowered = text.lower()
    return len(re.findall(r"https?://", lowered)) > 2 or any(w in lowered for w in SPAM_WORDS)


def initial_status(user, policy, text, moderate_all):
    if looks_spammy(text):
        return Comment.Status.SPAM
    if user and user.is_staff_role:
        return Comment.Status.APPROVED
    if moderate_all or (user is None and policy == SiteSettings.GuestComments.MODERATED):
        return Comment.Status.PENDING
    return Comment.Status.APPROVED


class ContentCommentsView(ListAPIView):
    serializer_class = CommentSerializer
    filter_backends = []

    def get_throttles(self):
        return [CommentThrottle()] if self.request.method == "POST" else []

    def get_content(self):
        return get_object_or_404(Content, pk=self.kwargs["pk"])

    def get_queryset(self):
        replies = Comment.objects.filter(status=Comment.Status.APPROVED).select_related("user").order_by("created_at")
        return (Comment.objects.filter(content_id=self.kwargs["pk"], parent=None, status=Comment.Status.APPROVED)
                .select_related("user").prefetch_related(Prefetch("replies", replies, to_attr="visible_replies")))

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        user = self.request.user
        if user.is_authenticated:
            ctx["liked"] = set(CommentLike.objects.filter(user=user, comment__content_id=self.kwargs["pk"])
                               .values_list("comment_id", flat=True))
        return ctx

    def post(self, request, pk):
        content = self.get_content()
        if not content.allow_comments or not content.is_live:
            raise ApiError("Comments are closed here.", "comments_closed", 403)
        ser = CommentWrite(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        site = SiteSettings.load()
        user = request.user if request.user.is_authenticated else None
        if user is None and site.guest_comment_policy == SiteSettings.GuestComments.LOGIN:
            raise ApiError("Please log in to comment.", "login_required", 401)
        if user is None and not data.get("guest_name", "").strip():
            raise ApiError("Please add your name.", "name_required")
        if content.is_paid and not can_access(user, content, context_for(request)):
            raise ApiError("Unlock this content to join the discussion.", "paywall", 403)
        parent = None
        if data.get("parent"):
            parent = get_object_or_404(Comment, pk=data["parent"], content=content)
            parent = parent.parent or parent  # one level of replies
        recent = Comment.objects.filter(content=content, body=data["body"],
                                        created_at__gt=timezone.now() - timedelta(minutes=2))
        if recent.filter(user=user).exists() if user else recent.filter(guest_name=data.get("guest_name")).exists():
            raise ApiError("You already posted that.", "duplicate")
        comment = Comment.objects.create(
            content=content, user=user, guest_name="" if user else data["guest_name"].strip(), body=data["body"],
            parent=parent, status=initial_status(user, site.guest_comment_policy, data["body"],
                                                 site.moderate_all_comments),
        )
        return Response(CommentSerializer(comment, context={"request": request}).data, status=201)


class CommentDetailView(APIView):
    permission_classes = [SessionOnly]
    serializer_class = CommentSerializer

    def _own(self, request, pk):
        comment = get_object_or_404(Comment, pk=pk)
        if comment.user_id != request.user.pk:
            raise ApiError("This is not your comment.", "forbidden", 403)
        if timezone.now() - comment.created_at >= EDIT_WINDOW:
            raise ApiError("Comments can only be changed for 15 minutes.", "edit_window_closed", 403)
        return comment

    def patch(self, request, pk):
        comment = self._own(request, pk)
        body = (request.data.get("body") or "").strip()
        if not body or len(body) > 4000:
            raise ApiError("Write something first.")
        comment.body, comment.edited_at = body, timezone.now()
        comment.save(update_fields=["body", "edited_at", "updated_at"])
        return Response(CommentSerializer(comment, context={"request": request}).data)

    def delete(self, request, pk):
        self._own(request, pk).delete()
        return Response(status=204)


class CommentLikeView(APIView):
    permission_classes = [SessionOnly]
    serializer_class = serializers.Serializer

    def post(self, request, pk):
        comment = get_object_or_404(Comment, pk=pk)
        like, created = CommentLike.objects.get_or_create(comment=comment, user=request.user)
        if not created:
            like.delete()
        comment.refresh_from_db()
        return Response({"liked": created, "like_count": comment.like_count})


class CommentReportView(APIView):
    serializer_class = serializers.Serializer
    throttle_classes = [CommentThrottle]

    def post(self, request, pk):
        Comment.objects.filter(pk=pk).update(report_count=F("report_count") + 1)
        comment = get_object_or_404(Comment, pk=pk)
        if comment.report_count >= 3 and comment.status == Comment.Status.APPROVED:
            comment.status = Comment.Status.PENDING  # back to the moderation queue
            comment.save(update_fields=["status"])
        return Response({"ok": True})


class _ToggleView(APIView):
    permission_classes = [SessionOnly]
    serializer_class = serializers.Serializer
    model = None
    flag = ""

    def post(self, request, pk):
        content = get_object_or_404(Content, pk=pk)
        if not getattr(content, self.flag):
            raise ApiError("This is turned off for this item.", "disabled", 403)
        row, created = self.model.objects.get_or_create(content=content, user=request.user)
        if not created:
            row.delete()
        content.refresh_from_db()
        return Response({"active": created, "like_count": content.like_count})


class LikeView(_ToggleView):
    model, flag = Reaction, "allow_reactions"


class BookmarkView(_ToggleView):
    model, flag = Bookmark, "allow_bookmarks"


class ViewCountView(APIView):
    serializer_class = serializers.Serializer

    def post(self, request, pk):
        user = request.user if request.user.is_authenticated else None
        device = request.headers.get("X-Device-Id", "")[:64]
        if user:
            device = f"u{user.pk}"
        elif not device:
            agent = request.META.get("HTTP_USER_AGENT", "")
            device = hashlib.sha256(f"{request.META.get('REMOTE_ADDR')}{agent}".encode()).hexdigest()[:40]
        try:
            with transaction.atomic():
                _, created = ViewEvent.objects.get_or_create(content_id=pk, device_id=device,
                                                             day=timezone.localdate(), defaults={"user": user})
        except IntegrityError:
            return Response({"counted": False})
        if created:
            Content.objects.filter(pk=pk).update(view_count=F("view_count") + 1)
        return Response({"counted": created})


class ProgressView(APIView):
    permission_classes = [SessionOnly]
    serializer_class = serializers.Serializer

    def put(self, request, pk):
        get_object_or_404(Content, pk=pk)
        try:
            percent = max(0, min(100, int(request.data.get("percent", 0))))
            position = max(0.0, float(request.data.get("position_seconds", 0)))
        except (TypeError, ValueError) as exc:
            raise ApiError("Invalid progress.") from exc
        row, _ = ReadingProgress.objects.update_or_create(
            user=request.user, content_id=pk, defaults={"percent": percent, "position_seconds": position})
        return Response({"percent": row.percent})


class MyBookmarksView(ListAPIView):
    permission_classes = [SessionOnly]
    serializer_class = ContentCardSerializer
    filter_backends = []

    def get_queryset(self):
        ids = Bookmark.objects.filter(user=self.request.user).values("content")
        return live_qs().filter(pk__in=ids)


class MyUnlockedView(ListAPIView):
    """Everything this person holds a current entitlement for."""

    permission_classes = [SessionOnly]
    serializer_class = ContentCardSerializer
    filter_backends = []

    def get_queryset(self):
        ctx = context_for(self.request)
        qs = live_qs().filter(access_level="paid")
        if ctx.is_staff:
            return qs
        if ctx.has_subscription:
            from django.db.models import Q

            return qs.filter(Q(included_in_subscription=True) | Q(pk__in=ctx.content_ids))
        return qs.filter(pk__in=ctx.content_ids)
