import uuid

from django.conf import settings
from django.core.cache import cache
from django.db import models


class TimeStamped(models.Model):
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class UUIDModel(TimeStamped):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class Meta:
        abstract = True


class Singleton(TimeStamped):
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)
        cache.delete(self._cache_key())

    @classmethod
    def _cache_key(cls):
        return f"singleton:{cls.__name__}"

    @classmethod
    def load(cls):
        obj = cache.get(cls._cache_key())
        if obj is None:
            obj, _ = cls.objects.get_or_create(pk=1)
            cache.set(cls._cache_key(), obj, 300)
        return obj


class SiteSettings(Singleton):
    class GuestComments(models.TextChoices):
        LOGIN = "login_required", "Require login"
        MODERATED = "guest_moderated", "Allow guests, hold for moderation"
        OPEN = "guest_open", "Allow guests, publish immediately"

    site_name = models.CharField(max_length=120, default="Darasa")
    tagline = models.CharField(max_length=240, default="Learn from one great teacher, at your own pace.")
    hero_title = models.CharField(max_length=200, default="Serious lessons, explained simply.")
    hero_subtitle = models.TextField(
        default="Articles, videos and notes from a working teacher. Start free, and unlock everything when you are ready."
    )
    logo = models.CharField(max_length=500, blank=True)  # public storage key
    favicon = models.CharField(max_length=500, blank=True)
    primary_color = models.CharField(max_length=9, default="#4F46E5")
    contact_email = models.EmailField(blank=True)
    contact_phone = models.CharField(max_length=30, blank=True)
    social_links = models.JSONField(default=dict, blank=True)
    currency = models.CharField(max_length=3, default="TZS")
    guest_comment_policy = models.CharField(
        max_length=20, choices=GuestComments.choices, default=GuestComments.LOGIN
    )
    moderate_all_comments = models.BooleanField(default=False)
    default_allow_comments = models.BooleanField(default=True)
    default_allow_reactions = models.BooleanField(default=True)
    default_allow_bookmarks = models.BooleanField(default=True)
    default_allow_download = models.BooleanField(default=True)
    default_show_view_count = models.BooleanField(default=True)
    default_content_price = models.PositiveIntegerField(default=5000)
    allow_signup = models.BooleanField(default=True)
    faq = models.JSONField(default=list, blank=True)
    seo_title = models.CharField(max_length=200, blank=True)
    seo_description = models.CharField(max_length=320, blank=True)
    maintenance_mode = models.BooleanField(default=False)
    sms_provider = models.CharField(max_length=40, blank=True)
    email_provider = models.CharField(max_length=40, blank=True)
    notification_config = models.JSONField(default=dict, blank=True)


class AuditLog(models.Model):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    actor_label = models.CharField(max_length=150, blank=True)
    action = models.CharField(max_length=80, db_index=True)
    target_type = models.CharField(max_length=60, blank=True, db_index=True)
    target_id = models.CharField(max_length=64, blank=True, db_index=True)
    target_label = models.CharField(max_length=200, blank=True)
    diff = models.JSONField(default=dict, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-timestamp"]
