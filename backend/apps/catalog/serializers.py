from rest_framework import serializers

from apps.engagement.models import Bookmark, Reaction, ReadingProgress
from apps.media_library.models import MediaAsset
from apps.media_library.storage import get_storage
from apps.payments.access import can_access, context_for

from .models import Category, Content, ContentRevision, Tag
from .renderer import render_html


def public_url(key):
    return get_storage().public_url(key) if key else ""


class CategoryBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "name", "slug", "color", "icon", "parent"]


class CategoryTreeSerializer(serializers.ModelSerializer):
    children = serializers.SerializerMethodField()
    content_count = serializers.SerializerMethodField()
    cover_url = serializers.SerializerMethodField()

    class Meta:
        model = Category
        fields = ["id", "name", "slug", "description", "icon", "color", "cover_url", "order", "is_active",
                  "content_count", "children"]

    def get_cover_url(self, obj):
        return public_url(obj.cover_image)

    def get_content_count(self, obj):
        counts = self.context.get("counts", {})
        own = counts.get(obj.pk, 0)
        return own + sum(counts.get(c.pk, 0) for c in obj.children.all())

    def get_children(self, obj):
        kids = [c for c in obj.children.all() if self.context.get("all") or c.is_active]
        return CategoryTreeSerializer(kids, many=True, context=self.context).data


class TagSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = ["id", "name", "slug"]
        read_only_fields = ["id", "slug"]


class MediaBriefSerializer(serializers.ModelSerializer):
    thumbnail_url = serializers.SerializerMethodField()

    class Meta:
        model = MediaAsset
        fields = ["id", "kind", "original_filename", "size", "mime", "page_count", "duration", "thumbnail_url", "status",
                  "processing_progress"]

    def get_thumbnail_url(self, obj):
        return public_url(obj.thumbnail)


class ContentCardSerializer(serializers.ModelSerializer):
    category = CategoryBriefSerializer()
    cover_url = serializers.SerializerMethodField()
    has_access = serializers.SerializerMethodField()
    effective_price = serializers.IntegerField()
    duration = serializers.SerializerMethodField()
    page_count = serializers.SerializerMethodField()

    class Meta:
        model = Content
        fields = ["id", "slug", "title", "subtitle", "excerpt", "cover_url", "content_type", "category", "reading_time",
                  "duration", "page_count", "access_level", "price", "promo_price", "effective_price", "has_access",
                  "view_count", "like_count", "show_view_count", "published_at", "featured"]

    def get_cover_url(self, obj):
        return public_url(obj.cover_thumb or obj.cover_image)

    def get_has_access(self, obj):
        request = self.context.get("request")
        return can_access(getattr(request, "user", None), obj, context_for(request) if request else None)

    def get_duration(self, obj):
        return obj.main_asset.duration if obj.main_asset_id else None

    def get_page_count(self, obj):
        return obj.main_asset.page_count if obj.main_asset_id else None


class ContentDetailSerializer(ContentCardSerializer):
    tags = TagSerializer(many=True)
    author = serializers.SerializerMethodField()
    body_html = serializers.SerializerMethodField()
    truncated = serializers.SerializerMethodField()
    main_media = serializers.SerializerMethodField()
    attachments = serializers.SerializerMethodField()
    user_state = serializers.SerializerMethodField()
    cover_full_url = serializers.SerializerMethodField()
    seo_title = serializers.SerializerMethodField()
    seo_description = serializers.SerializerMethodField()

    class Meta(ContentCardSerializer.Meta):
        fields = ContentCardSerializer.Meta.fields + [
            "tags", "author", "body_html", "truncated", "main_media", "attachments", "user_state", "cover_full_url",
            "seo_title", "seo_description", "allow_comments", "allow_reactions", "allow_bookmarks", "allow_download",
            "comment_count", "access_duration_days", "included_in_subscription", "preview_seconds", "preview_pages",
            "updated_at", "word_count",
        ]

    def get_cover_full_url(self, obj):
        return public_url(obj.cover_image)

    def get_seo_title(self, obj):
        return obj.seo_title or obj.title

    def get_seo_description(self, obj):
        return obj.seo_description or obj.excerpt or obj.subtitle

    def get_author(self, obj):
        if not obj.author:
            return None
        return {"name": obj.author.get_full_name() or obj.author.username, "role": obj.author.role}

    def get_truncated(self, obj):
        return not self.get_has_access(obj) and bool(obj.body_json)

    def get_body_html(self, obj):
        if self.get_has_access(obj):
            return obj.body_html
        return render_html(obj.body_json, limit_blocks=obj.preview_blocks)  # locked blocks never leave the server

    def get_main_media(self, obj):
        return MediaBriefSerializer(obj.main_asset).data if obj.main_asset_id else None

    def get_attachments(self, obj):
        rows = [a for a in obj.assets.all() if a.pk != obj.main_asset_id and a.kind != "image"
                and a.status == MediaAsset.Status.READY]
        return MediaBriefSerializer(rows, many=True).data

    def get_user_state(self, obj):
        user = getattr(self.context.get("request"), "user", None)
        if user is None or not user.is_authenticated:
            return {"liked": False, "bookmarked": False, "percent": 0, "position_seconds": 0}
        progress = ReadingProgress.objects.filter(user=user, content=obj).first()
        return {
            "liked": Reaction.objects.filter(user=user, content=obj).exists(),
            "bookmarked": Bookmark.objects.filter(user=user, content=obj).exists(),
            "percent": progress.percent if progress else 0,
            "position_seconds": progress.position_seconds if progress else 0,
        }


class AdminContentListSerializer(serializers.ModelSerializer):
    category = CategoryBriefSerializer(read_only=True)
    cover_url = serializers.SerializerMethodField()
    author_name = serializers.CharField(source="author.get_full_name", default="", read_only=True)

    class Meta:
        model = Content
        fields = ["id", "slug", "title", "subtitle", "cover_url", "content_type", "category", "status", "access_level",
                  "price", "featured", "view_count", "like_count", "comment_count", "published_at", "scheduled_for",
                  "updated_at", "author_name"]

    def get_cover_url(self, obj):
        return public_url(obj.cover_thumb or obj.cover_image)


class AdminContentSerializer(serializers.ModelSerializer):
    tags = serializers.ListField(child=serializers.CharField(max_length=60), required=False, write_only=True)
    tag_names = serializers.SerializerMethodField()
    category_detail = CategoryBriefSerializer(source="category", read_only=True)
    cover_url = serializers.SerializerMethodField()
    main_media = MediaBriefSerializer(source="main_asset", read_only=True)

    class Meta:
        model = Content
        exclude = ["search_vector", "body_html", "referenced_assets", "author"]
        read_only_fields = ["view_count", "like_count", "comment_count", "reading_time", "word_count", "published_at"]
        extra_kwargs = {"slug": {"required": False, "allow_blank": True}, "title": {"required": False, "allow_blank": True}}

    def get_tag_names(self, obj):
        return [t.name for t in obj.tags.all()]

    def get_cover_url(self, obj):
        return public_url(obj.cover_image)

    def validate(self, attrs):
        merged = {**{f: getattr(self.instance, f, None) for f in ("access_level", "price", "included_in_subscription")},
                  **attrs} if self.instance else attrs
        if merged.get("access_level") == "paid" and merged.get("price") is None and merged.get(
                "included_in_subscription", True) is False:
            raise serializers.ValidationError({"price": "Paid content needs a price, or must be in subscriptions."})
        if attrs.get("status") == "scheduled" and not (attrs.get("scheduled_for")
                                                       or getattr(self.instance, "scheduled_for", None)):
            raise serializers.ValidationError({"scheduled_for": "Choose a date and time to publish."})
        if attrs.get("status") in ("published", "scheduled") and not (
                attrs.get("title") or getattr(self.instance, "title", "")):
            raise serializers.ValidationError({"title": "Add a title before publishing."})
        return attrs


class RevisionSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source="author.get_full_name", default="", read_only=True)

    class Meta:
        model = ContentRevision
        fields = ["id", "title", "subtitle", "body_json", "created_at", "author_name", "word_count", "label"]
