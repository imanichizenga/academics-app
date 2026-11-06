from django.conf import settings
from django.db import models

from apps.catalog.models import Content
from apps.core.models import TimeStamped, UUIDModel


class Comment(UUIDModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        HIDDEN = "hidden", "Hidden"
        SPAM = "spam", "Spam"

    content = models.ForeignKey(Content, on_delete=models.CASCADE, related_name="comments")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                             related_name="comments")
    guest_name = models.CharField(max_length=80, blank=True)
    body = models.TextField(max_length=4000)
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.CASCADE, related_name="replies")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.APPROVED, db_index=True)
    is_pinned = models.BooleanField(default=False)
    like_count = models.PositiveIntegerField(default=0)
    report_count = models.PositiveIntegerField(default=0)
    edited_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-is_pinned", "created_at"]


class CommentLike(TimeStamped):
    comment = models.ForeignKey(Comment, on_delete=models.CASCADE, related_name="likes")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["comment", "user"], name="one_comment_like")]


class Reaction(TimeStamped):
    content = models.ForeignKey(Content, on_delete=models.CASCADE, related_name="reactions")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reactions")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["content", "user"], name="one_reaction")]


class Bookmark(TimeStamped):
    content = models.ForeignKey(Content, on_delete=models.CASCADE, related_name="bookmarks")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="bookmarks")

    class Meta:
        ordering = ["-created_at"]
        constraints = [models.UniqueConstraint(fields=["content", "user"], name="one_bookmark")]


class ViewEvent(models.Model):
    content = models.ForeignKey(Content, on_delete=models.CASCADE, related_name="view_events")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.CASCADE)
    device_id = models.CharField(max_length=64, blank=True)
    day = models.DateField(db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["content", "device_id", "day"], name="one_view_per_device_day")]


class ReadingProgress(TimeStamped):
    content = models.ForeignKey(Content, on_delete=models.CASCADE, related_name="progress")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="progress")
    percent = models.PositiveSmallIntegerField(default=0)
    position_seconds = models.FloatField(default=0)

    class Meta:
        ordering = ["-updated_at"]
        constraints = [models.UniqueConstraint(fields=["content", "user"], name="one_progress")]
