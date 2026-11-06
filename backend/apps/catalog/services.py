from django.contrib.postgres.search import SearchVector
from django.db import transaction
from django.db.models import Value
from django.utils import timezone

from apps.media_library.models import MediaAsset

from .models import Content, ContentRevision, unique_slug
from .renderer import collect_asset_ids, count_words, plain_text, reading_minutes, render_html


def refresh_derived(content, save=True):
    """Recompute everything derived from body_json. Safe to call on any save."""
    content.body_html = render_html(content.body_json)
    content.word_count = count_words(content.body_json)
    content.reading_time = reading_minutes(content.word_count)
    if save:
        Content.objects.filter(pk=content.pk).update(
            body_html=content.body_html, word_count=content.word_count, reading_time=content.reading_time
        )
    content.referenced_assets.set(MediaAsset.objects.filter(pk__in=collect_asset_ids(content.body_json)))
    Content.objects.filter(pk=content.pk).update(
        search_vector=SearchVector(Value(content.title), weight="A", config="simple")
        + SearchVector(Value(content.subtitle), weight="B", config="simple")
        + SearchVector(Value(content.excerpt), weight="B", config="simple")
        + SearchVector(Value(plain_text(content.body_json)), weight="C", config="simple")
    )


def ensure_slug(content):
    if not content.slug:
        content.slug = unique_slug(Content, content.title, content, max_length=220)


def apply_status(content):
    if content.status == Content.Status.PUBLISHED and not content.published_at:
        content.published_at = timezone.now()


def snapshot_revision(content, user, label=""):
    return ContentRevision.objects.create(
        content=content, title=content.title, subtitle=content.subtitle, body_json=content.body_json, author=user,
        word_count=content.word_count, label=label,
    )


def maybe_autosave_revision(content, user):
    """Autosaves fire every few seconds, so only keep one revision per five minutes."""
    last = content.revisions.first()
    if last is None or (timezone.now() - last.created_at).total_seconds() > 300:
        snapshot_revision(content, user, "Autosave")


@transaction.atomic
def duplicate(content, user):
    fields = ["subtitle", "excerpt", "cover_image", "cover_thumb", "category", "content_type", "body_json", "body_html",
              "reading_time", "word_count", "main_asset", "access_level", "price", "access_duration_days",
              "included_in_subscription", "preview_blocks", "preview_seconds", "preview_pages", "allow_comments",
              "allow_reactions", "allow_bookmarks", "allow_download", "show_view_count", "seo_title",
              "seo_description"]
    copy = Content(title=f"{content.title} (copy)", author=user, status=Content.Status.DRAFT,
                   **{f: getattr(content, f) for f in fields})
    ensure_slug(copy)
    copy.save()
    copy.tags.set(content.tags.all())
    refresh_derived(copy)
    return copy
