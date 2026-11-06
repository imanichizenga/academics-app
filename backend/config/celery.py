import os

from celery import Celery
from celery.schedules import crontab

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
app = Celery("darasa")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
app.conf.beat_schedule = {
    "publish-scheduled": {"task": "apps.catalog.tasks.publish_scheduled", "schedule": 60.0},
    "reconcile-payments": {"task": "apps.payments.tasks.reconcile_pending_orders", "schedule": 60.0},
    "expire-entitlements": {"task": "apps.payments.tasks.expire_entitlements", "schedule": crontab(minute="*/15")},
    "expiry-reminders": {"task": "apps.payments.tasks.send_expiry_reminders", "schedule": crontab(hour=6, minute=0)},
    "poll-transcodes": {"task": "apps.media_library.tasks.poll_mediaconvert_jobs", "schedule": 30.0},
    "cleanup-uploads": {"task": "apps.media_library.tasks.cleanup_abandoned_uploads", "schedule": crontab(minute=20)},
}
