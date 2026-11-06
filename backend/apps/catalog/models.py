import uuid

from django.conf import settings
from django.contrib.postgres.indexes import GinIndex
from django.contrib.postgres.search import SearchVectorField
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models
from django.utils import timezone
from django.utils.text import slugify

from apps.core.models import TimeStamped, UUIDModel


def unique_slug(model, text, instance=None, field="slug", max_length=200):
    base = slugify(text)[: max_length - 8] or uuid.uuid4().hex[:8]
    slug, n = base, 2
    qs = model.objects.all()
    if instance is not None and instance.pk:
        qs = qs.exclude(pk=instance.pk)
    while qs.filter(**{field: slug}).exists():
        slug, n = f"{base}-{n}", n + 1
    return slug


class Category(UUIDModel):
    name = models.CharField(max_length=120)
    slug = models.SlugField(max_length=140, unique=True, blank=True)
    description = models.TextField(blank=True)
    icon = models.CharField(max_length=60, blank=True)
    color = models.CharField(max_length=9, blank=True)
    cover_image = models.CharField(max_length=500, blank=True)
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT, related_name="children")
    order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["order", "name"]
        verbose_name_plural = "categories"

    def __str__(self):
        return self.name

    def clean(self):
        if self.parent_id:
            if self.parent_id == self.pk:
                raise ValidationError({"parent": "A category cannot be its own parent."})
            if self.parent.parent_id:
                raise ValidationError({"parent": "Categories can only be nested two levels deep."})
            if self.pk and Category.objects.filter(parent_id=self.pk).exists():
                raise ValidationError({"parent": "This category has subcategories, so it cannot become one."})

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = unique_slug(Category, self.name, self, max_length=140)
        self.full_clean(exclude=["slug", "parent"] if self.parent_id is None else ["slug"])
        super().save(*args, **kwargs)


class Tag(UUIDModel):
    name = models.CharField(max_length=60, unique=True)
    slug = models.SlugField(max_length=80, unique=True, blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = unique_slug(Tag, self.name, self, max_length=80)
        super().save(*args, **kwargs)


class Content(UUIDModel):
    class Type(models.TextChoices):
        ARTICLE = "article", "Article"
        DOCUMENT = "document", "Document"
        VIDEO = "video", "Video"
        AUDIO = "audio", "Audio"
        MIXED = "mixed", "Mixed"

    class Access(models.TextChoices):
        FREE = "free", "Free"
        PAID = "paid", "Paid"

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SCHEDULED = "scheduled", "Scheduled"
        PUBLISHED = "published", "Published"
        ARCHIVED = "archived", "Archived"

    title = models.CharField(max_length=240)
    subtitle = models.CharField(max_length=320, blank=True)
    slug = models.SlugField(max_length=220, unique=True, blank=True)
    excerpt = models.TextField(blank=True)
    cover_image = models.CharField(max_length=500, blank=True)
    cover_thumb = models.CharField(max_length=500, blank=True)
    category = models.ForeignKey(Category, null=True, blank=True, on_delete=models.PROTECT, related_name="contents")
    tags = models.ManyToManyField(Tag, blank=True, related_name="contents")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="contents")
    content_type = models.CharField(max_length=10, choices=Type.choices, default=Type.ARTICLE, db_index=True)
    body_json = models.JSONField(default=dict, blank=True)
    body_html = models.TextField(blank=True)
    reading_time = models.PositiveIntegerField(default=0)
    word_count = models.PositiveIntegerField(default=0)
    main_asset = models.ForeignKey(
        "media_library.MediaAsset", null=True, blank=True, on_delete=models.SET_NULL, related_name="main_for"
    )
    referenced_assets = models.ManyToManyField("media_library.MediaAsset", blank=True, related_name="referenced_by")

    access_level = models.CharField(max_length=5, choices=Access.choices, default=Access.FREE, db_index=True)
    price = models.PositiveIntegerField(null=True, blank=True, validators=[MinValueValidator(500)])
    promo_price = models.PositiveIntegerField(null=True, blank=True, validators=[MinValueValidator(500)])
    access_duration_days = models.PositiveIntegerField(null=True, blank=True)
    included_in_subscription = models.BooleanField(default=True)
    preview_blocks = models.PositiveIntegerField(default=3)
    preview_seconds = models.PositiveIntegerField(default=60)
    preview_pages = models.PositiveIntegerField(default=3)

    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT, db_index=True)
    published_at = models.DateTimeField(null=True, blank=True, db_index=True)
    scheduled_for = models.DateTimeField(null=True, blank=True, db_index=True)

    allow_comments = models.BooleanField(default=True)
    allow_reactions = models.BooleanField(default=True)
    allow_bookmarks = models.BooleanField(default=True)
    allow_download = models.BooleanField(default=True)
    show_view_count = models.BooleanField(default=True)

    featured = models.BooleanField(default=False, db_index=True)
    order = models.IntegerField(default=0)
    seo_title = models.CharField(max_length=200, blank=True)
    seo_description = models.CharField(max_length=320, blank=True)
    view_count = models.PositiveIntegerField(default=0, db_index=True)
    like_count = models.PositiveIntegerField(default=0, db_index=True)
    comment_count = models.PositiveIntegerField(default=0)
    search_vector = SearchVectorField(null=True, editable=False)

    class Meta:
        ordering = ["-published_at", "-created_at"]
        indexes = [GinIndex(fields=["search_vector"], name="content_search_gin")]

    def __str__(self):
        return self.title

    @property
    def is_paid(self):
        return self.access_level == self.Access.PAID

    @property
    def effective_price(self):
        return self.promo_price or self.price

    @property
    def is_live(self):
        return self.status == self.Status.PUBLISHED and (
            self.published_at is None or self.published_at <= timezone.now()
        )

    def clean(self):
        if self.is_paid and self.price is None and not self.included_in_subscription:
            raise ValidationError({"price": "Paid content needs a price, or must be included in subscriptions."})
        if self.price is not None and self.price < 500:
            raise ValidationError({"price": "The minimum price is TZS 500."})
        if self.status == self.Status.SCHEDULED and not self.scheduled_for:
            raise ValidationError({"scheduled_for": "Choose a date and time to publish."})


class ContentRevision(TimeStamped):
    content = models.ForeignKey(Content, on_delete=models.CASCADE, related_name="revisions")
    title = models.CharField(max_length=240)
    subtitle = models.CharField(max_length=320, blank=True)
    body_json = models.JSONField(default=dict)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    word_count = models.PositiveIntegerField(default=0)
    label = models.CharField(max_length=60, blank=True)

    class Meta:
        ordering = ["-created_at"]
