from celery import shared_task
from django.utils import timezone

from .models import Content


@shared_task
def publish_scheduled():
    now = timezone.now()
    due = Content.objects.filter(status=Content.Status.SCHEDULED, scheduled_for__lte=now)
    return due.update(status=Content.Status.PUBLISHED, published_at=now)
