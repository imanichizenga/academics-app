from django.conf import settings
from django.db import models

from apps.core.fields import EncryptedTextField
from apps.core.models import Singleton, TimeStamped, UUIDModel

DEFAULT_MAX_MB = {"video": 8192, "audio": 512, "pdf": 512, "docx": 100, "pptx": 256, "xlsx": 100, "epub": 100,
                  "image": 25, "txt": 10}


def default_limits():
    return dict(DEFAULT_MAX_MB)


def default_types():
    return ["pdf", "docx", "pptx", "xlsx", "epub", "txt", "image", "audio", "video"]


class StorageConfig(Singleton):
    class Backend(models.TextChoices):
        LOCAL = "local", "Local disk (development)"
        S3 = "s3", "Amazon S3"

    class Engine(models.TextChoices):
        MEDIACONVERT = "aws_mediaconvert", "AWS MediaConvert"
        FFMPEG = "ffmpeg_worker", "FFmpeg worker"

    backend = models.CharField(max_length=10, choices=Backend.choices, default=Backend.LOCAL)
    aws_access_key_id = models.CharField(max_length=128, blank=True)
    aws_secret_access_key = EncryptedTextField(blank=True)
    region = models.CharField(max_length=40, blank=True, default="eu-west-1")
    bucket = models.CharField(max_length=120, blank=True)
    public_bucket = models.CharField(max_length=120, blank=True)
    endpoint_url = models.URLField(blank=True)
    key_prefix = models.CharField(max_length=120, blank=True)
    cloudfront_domain = models.CharField(max_length=200, blank=True)
    cloudfront_key_pair_id = models.CharField(max_length=64, blank=True)
    cloudfront_private_key = EncryptedTextField(blank=True)
    signed_url_ttl = models.PositiveIntegerField(default=300)
    max_upload_mb = models.JSONField(default=default_limits, blank=True)
    allowed_types = models.JSONField(default=default_types, blank=True)
    transcoding_engine = models.CharField(max_length=20, choices=Engine.choices, default=Engine.FFMPEG)
    mediaconvert_role_arn = models.CharField(max_length=200, blank=True)
    mediaconvert_region = models.CharField(max_length=40, blank=True)
    mediaconvert_preset = models.CharField(max_length=120, blank=True)
    last_tested_at = models.DateTimeField(null=True, blank=True)
    last_test_status = models.CharField(max_length=10, blank=True)
    last_test_report = models.JSONField(default=dict, blank=True)


class MediaAsset(UUIDModel):
    class Kind(models.TextChoices):
        PDF = "pdf", "PDF"
        DOCX = "docx", "Word"
        PPTX = "pptx", "PowerPoint"
        XLSX = "xlsx", "Excel"
        EPUB = "epub", "EPUB"
        TXT = "txt", "Text"
        IMAGE = "image", "Image"
        AUDIO = "audio", "Audio"
        VIDEO = "video", "Video"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        UPLOADING = "uploading", "Uploading"
        UPLOADED = "uploaded", "Uploaded"
        PROCESSING = "processing", "Processing"
        READY = "ready", "Ready"
        FAILED = "failed", "Failed"

    content = models.ForeignKey(
        "catalog.Content", null=True, blank=True, on_delete=models.SET_NULL, related_name="assets"
    )
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.OTHER, db_index=True)
    original_filename = models.CharField(max_length=255)
    storage_key = models.CharField(max_length=500, blank=True)
    size = models.BigIntegerField(default=0)
    mime = models.CharField(max_length=120, blank=True)
    checksum = models.CharField(max_length=64, blank=True)
    page_count = models.PositiveIntegerField(null=True, blank=True)
    duration = models.FloatField(null=True, blank=True)
    width = models.PositiveIntegerField(null=True, blank=True)
    height = models.PositiveIntegerField(null=True, blank=True)
    thumbnail = models.CharField(max_length=500, blank=True)  # public storage key
    variants = models.JSONField(default=dict, blank=True)  # {"480": key, "960": key, ...}
    preview_key = models.CharField(max_length=500, blank=True)  # first pages / first seconds
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.UPLOADING, db_index=True)
    processing_progress = models.PositiveSmallIntegerField(default=0)
    error_message = models.TextField(blank=True)
    requires_access = models.BooleanField(null=True, blank=True)  # None = inherit from content
    upload_id = models.CharField(max_length=500, blank=True)
    upload_parts = models.JSONField(default=dict, blank=True)
    transcode_job_id = models.CharField(max_length=120, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.original_filename


class VideoRendition(TimeStamped):
    asset = models.OneToOneField(MediaAsset, on_delete=models.CASCADE, related_name="rendition")
    master_key = models.CharField(max_length=500)
    base_key = models.CharField(max_length=500)
    renditions = models.JSONField(default=list)
    poster = models.CharField(max_length=500, blank=True)
    sprite = models.CharField(max_length=500, blank=True)
    sprite_meta = models.JSONField(default=dict, blank=True)
    duration = models.FloatField(default=0)
