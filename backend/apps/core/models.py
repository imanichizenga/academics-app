import uuid

from django.conf import settings
from django.core.cache import cache
from django.db import models

from .fields import EncryptedTextField


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
    contact_whatsapp = models.CharField(max_length=30, blank=True)  # a number, turned into a wa.me link
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
    maintenance_message = models.TextField(blank=True)
    teacher_photo = models.CharField(max_length=500, blank=True)  # public storage key
    teacher_name = models.CharField(max_length=120, blank=True)
    teacher_title = models.CharField(max_length=160, blank=True)
    teacher_bio = models.TextField(blank=True)
    teacher_credentials = models.CharField(max_length=240, blank=True)
    teacher_years = models.PositiveIntegerField(null=True, blank=True)
    teacher_subjects = models.JSONField(default=list, blank=True)


class Announcement(UUIDModel):
    """A message the admin publishes to visitors, as a bar on every page or a card on the home page."""

    class Tone(models.TextChoices):
        INFO = "info", "Information"
        SUCCESS = "success", "Good news"
        WARNING = "warning", "Important"
        PROMO = "promo", "Offer"

    class Placement(models.TextChoices):
        BAR = "bar", "Bar on every page"
        HOME = "home", "Card on the home page"

    class Audience(models.TextChoices):
        EVERYONE = "everyone", "Everyone"
        GUESTS = "guests", "Visitors who are not logged in"
        MEMBERS = "members", "Logged-in learners"

    title = models.CharField(max_length=120)
    body = models.CharField(max_length=400, blank=True)
    title_sw = models.CharField(max_length=120, blank=True)  # optional Swahili version
    body_sw = models.CharField(max_length=400, blank=True)
    link_url = models.CharField(max_length=500, blank=True)
    link_label = models.CharField(max_length=40, blank=True)
    link_label_sw = models.CharField(max_length=40, blank=True)
    tone = models.CharField(max_length=10, choices=Tone.choices, default=Tone.INFO)
    placement = models.CharField(max_length=10, choices=Placement.choices, default=Placement.BAR)
    audience = models.CharField(max_length=10, choices=Audience.choices, default=Audience.EVERYONE)
    is_active = models.BooleanField(default=False)  # visible only when switched on
    dismissible = models.BooleanField(default=True)
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.title

    @classmethod
    def live(cls, now=None):
        from django.db.models import Q
        from django.utils import timezone

        now = now or timezone.now()
        return cls.objects.filter(Q(starts_at__isnull=True) | Q(starts_at__lte=now),
                                  Q(ends_at__isnull=True) | Q(ends_at__gt=now), is_active=True)

    @property
    def state(self):
        from django.utils import timezone

        now = timezone.now()
        if not self.is_active:
            return "off"
        if self.ends_at and self.ends_at <= now:
            return "ended"
        if self.starts_at and self.starts_at > now:
            return "scheduled"
        return "live"


class NotificationConfig(TimeStamped):
    """SMS and email delivery. Loaded fresh each time, so decrypted secrets never sit in the cache."""

    class SmsProvider(models.TextChoices):
        BEEM = "beem", "Beem Africa"
        AFRICASTALKING = "africastalking", "Africa's Talking"
        GENERIC = "generic", "Generic HTTP"

    class SmtpSecurity(models.TextChoices):
        STARTTLS = "starttls", "STARTTLS"
        SSL = "ssl", "SSL/TLS"
        NONE = "none", "None"

    sms_enabled = models.BooleanField(default=False)
    sms_provider = models.CharField(max_length=20, choices=SmsProvider.choices, default=SmsProvider.BEEM)
    sms_api_key = EncryptedTextField(blank=True)
    sms_api_secret = EncryptedTextField(blank=True)
    sms_username = models.CharField(max_length=120, blank=True)  # Africa's Talking only
    sms_sender_id = models.CharField(max_length=20, blank=True)
    sms_base_url = models.URLField(blank=True)  # blank means the provider's production host
    generic_url = models.CharField(max_length=500, blank=True)
    generic_method = models.CharField(max_length=6, default="POST")
    generic_headers = models.JSONField(default=dict, blank=True)
    generic_body = models.TextField(blank=True)
    email_enabled = models.BooleanField(default=False)
    smtp_host = models.CharField(max_length=200, blank=True)
    smtp_port = models.PositiveIntegerField(default=587)
    smtp_security = models.CharField(max_length=10, choices=SmtpSecurity.choices, default=SmtpSecurity.STARTTLS)
    smtp_username = models.CharField(max_length=200, blank=True)
    smtp_password = EncryptedTextField(blank=True)
    email_from_name = models.CharField(max_length=120, blank=True)
    email_from_address = models.EmailField(blank=True)
    reminder_days = models.PositiveIntegerField(default=3)
    sms_tested_at = models.DateTimeField(null=True, blank=True)
    sms_test_status = models.CharField(max_length=10, blank=True)
    sms_test_report = models.JSONField(default=dict, blank=True)
    email_tested_at = models.DateTimeField(null=True, blank=True)
    email_test_status = models.CharField(max_length=10, blank=True)
    email_test_report = models.JSONField(default=dict, blank=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    @classmethod
    def load(cls):
        return cls.objects.get_or_create(pk=1)[0]

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @property
    def sms_ready(self):
        if not self.sms_enabled:
            return False
        if self.sms_provider == self.SmsProvider.GENERIC:
            return bool(self.generic_url)
        if self.sms_provider == self.SmsProvider.BEEM:
            return bool(self.sms_api_key and self.sms_api_secret and self.sms_sender_id)
        return bool(self.sms_api_key and self.sms_username)

    @property
    def email_ready(self):
        return bool(self.email_enabled and self.smtp_host and self.email_from_address)


class NotificationTemplate(TimeStamped):
    key = models.CharField(max_length=40, unique=True)
    subject_en = models.CharField(max_length=200, blank=True)
    subject_sw = models.CharField(max_length=200, blank=True)
    body_en = models.TextField()
    body_sw = models.TextField()
    is_enabled = models.BooleanField(default=True)

    class Meta:
        ordering = ["key"]


class NotificationLog(UUIDModel):
    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        SENT = "sent", "Sent"
        FAILED = "failed", "Failed"
        SKIPPED = "skipped", "Skipped"

    channel = models.CharField(max_length=5, db_index=True)  # sms | email
    template = models.CharField(max_length=40, db_index=True)
    recipient_masked = models.CharField(max_length=80)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.QUEUED, db_index=True)
    provider = models.CharField(max_length=20, blank=True)
    provider_response = models.CharField(max_length=500, blank=True)
    attempts = models.PositiveIntegerField(default=0)
    # Held only until delivery finishes, and encrypted because the body can be a reset code.
    pending_to = EncryptedTextField(blank=True)
    pending_subject = EncryptedTextField(blank=True)
    pending_body = EncryptedTextField(blank=True)

    class Meta:
        ordering = ["-created_at"]


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
