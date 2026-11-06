import logging

from celery import shared_task
from django.db.models import F

from . import notifications, sms
from .models import NotificationConfig, NotificationLog

log = logging.getLogger("notifications")
MAX_ATTEMPTS = 5


def _finish(pk, status, response):
    NotificationLog.objects.filter(pk=pk).update(status=status, provider_response=str(response)[:500], pending_to="",
                                                 pending_subject="", pending_body="")


@shared_task(bind=True, max_retries=MAX_ATTEMPTS - 1)
def deliver_notification(self, pk):
    row = NotificationLog.objects.filter(pk=pk, status=NotificationLog.Status.QUEUED).first()
    if row is None:
        return
    NotificationLog.objects.filter(pk=pk).update(attempts=F("attempts") + 1)
    cfg = NotificationConfig.load()
    try:
        if row.channel == "sms":
            reply = sms.send(cfg, row.pending_to, row.pending_body)
        else:
            reply = notifications.send_email(cfg, row.pending_to, row.pending_subject, row.pending_body)
    except sms.SmsError as exc:
        return _retry_or_fail(self, row, str(exc), exc.retryable)
    except Exception as exc:  # smtplib and socket errors: usually a server hiccup, so worth another try
        return _retry_or_fail(self, row, f"{type(exc).__name__}: {exc}", True)
    _finish(pk, NotificationLog.Status.SENT, reply)


def _retry_or_fail(task, row, message, retryable):
    if retryable and task.request.retries < task.max_retries:
        NotificationLog.objects.filter(pk=row.pk).update(provider_response=message[:500])
        raise task.retry(countdown=30 * 2 ** task.request.retries)
    log.warning("Notification %s failed: %s", row.pk, message)
    _finish(row.pk, NotificationLog.Status.FAILED, message)
