from django.db.models import F
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from apps.catalog.models import Content

from .models import Comment, CommentLike, Reaction


def _sync_comment_count(content_id):
    n = Comment.objects.filter(content_id=content_id, status=Comment.Status.APPROVED).count()
    Content.objects.filter(pk=content_id).update(comment_count=n)


@receiver(post_save, sender=Comment)
@receiver(post_delete, sender=Comment)
def comment_changed(sender, instance, **kwargs):
    _sync_comment_count(instance.content_id)


@receiver(post_save, sender=Reaction)
def reaction_added(sender, instance, created, **kwargs):
    if created:
        Content.objects.filter(pk=instance.content_id).update(like_count=F("like_count") + 1)


@receiver(post_delete, sender=Reaction)
def reaction_removed(sender, instance, **kwargs):
    Content.objects.filter(pk=instance.content_id, like_count__gt=0).update(like_count=F("like_count") - 1)


@receiver(post_save, sender=CommentLike)
def comment_liked(sender, instance, created, **kwargs):
    if created:
        Comment.objects.filter(pk=instance.comment_id).update(like_count=F("like_count") + 1)


@receiver(post_delete, sender=CommentLike)
def comment_unliked(sender, instance, **kwargs):
    Comment.objects.filter(pk=instance.comment_id, like_count__gt=0).update(like_count=F("like_count") - 1)
