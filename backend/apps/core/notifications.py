"""Every SMS and email goes through notify(): render a template, log it, queue a Celery task."""
import logging
import re

from django.core.mail import EmailMessage, get_connection

from . import sms
from .models import NotificationConfig, NotificationLog, NotificationTemplate, SiteSettings

log = logging.getLogger("notifications")

DEFAULTS = {
    "payment_receipt": {
        "label": "Payment receipt", "placeholders": ["site_name", "amount", "item", "reference", "receipt_url"],
        "subject_en": "Your {site_name} receipt", "subject_sw": "Risiti yako ya {site_name}",
        "body_en": "{site_name}: payment of {amount} received for {item}. Ref {reference}. Receipt: {receipt_url}",
        "body_sw": "{site_name}: malipo ya {amount} yamepokelewa kwa {item}. Kumb. {reference}. Risiti: {receipt_url}",
    },
    "account_created": {
        "label": "Account created", "placeholders": ["site_name", "phone_number", "login_url"],
        "subject_en": "Your {site_name} account", "subject_sw": "Akaunti yako ya {site_name}",
        "body_en": "{site_name}: your account is ready. Phone: {phone_number}. Password: your phone number. "
                   "Log in and change it: {login_url}",
        "body_sw": "{site_name}: akaunti yako iko tayari. Simu: {phone_number}. Nenosiri: namba yako ya simu. "
                   "Ingia na ulibadilishe: {login_url}",
    },
    "subscription_ending": {
        "label": "Subscription ending soon", "placeholders": ["site_name", "days", "renew_url"],
        "subject_en": "Your {site_name} subscription ends soon",
        "subject_sw": "Usajili wako wa {site_name} unaisha hivi karibuni",
        "body_en": "{site_name}: your subscription ends in {days} day(s). Renew to keep learning: {renew_url}",
        "body_sw": "{site_name}: usajili wako unaisha baada ya siku {days}. Lipia upya uendelee kujifunza: {renew_url}",
    },
    "subscription_ended": {
        "label": "Subscription ended", "placeholders": ["site_name", "renew_url"],
        "subject_en": "Your {site_name} subscription has ended", "subject_sw": "Usajili wako wa {site_name} umeisha",
        "body_en": "{site_name}: your subscription has ended. Renew any time: {renew_url}",
        "body_sw": "{site_name}: usajili wako umeisha. Unaweza kulipia upya wakati wowote: {renew_url}",
    },
    "otp_code": {
        "label": "Password reset code", "placeholders": ["site_name", "code"],
        "subject_en": "Your {site_name} reset code", "subject_sw": "Msimbo wako wa {site_name}",
        "body_en": "{site_name}: your password reset code is {code}. It expires in 10 minutes.",
        "body_sw": "{site_name}: msimbo wako wa kubadilisha nenosiri ni {code}. Unaisha baada ya dakika 10.",
    },
}


def template_for(key):
    fields = {k: v for k, v in DEFAULTS[key].items() if k not in ("label", "placeholders")}
    return NotificationTemplate.objects.get_or_create(key=key, defaults=fields)[0]


def unknown_placeholders(key, *texts):
    allowed = set(DEFAULTS[key]["placeholders"])
    return sorted({name for text in texts for name in re.findall(r"\{(\w+)\}", text or "")} - allowed)


def has_provider(channel):
    cfg = NotificationConfig.load()
    return cfg.sms_ready if channel == "sms" else cfg.email_ready


def mask_recipient(to):
    if "@" in to:
        name, _, domain = to.partition("@")
        return f"{name[:2]}•••@{domain}"
    return f"{to[:6]}•••{to[-2:]}" if to else "?"


def _provider(channel, cfg):
    return cfg.sms_provider if channel == "sms" else "smtp"


def send_email(cfg, to, subject, body):
    security = cfg.smtp_security
    connection = get_connection(
        "django.core.mail.backends.smtp.EmailBackend", host=cfg.smtp_host, port=cfg.smtp_port,
        username=cfg.smtp_username or None, password=cfg.smtp_password or None, use_tls=security == "starttls",
        use_ssl=security == "ssl", timeout=12, fail_silently=False)
    sender = f'"{cfg.email_from_name}" <{cfg.email_from_address}>' if cfg.email_from_name else cfg.email_from_address
    EmailMessage(subject, body, sender, [to], connection=connection).send()
    return "Accepted by the SMTP server"


def _queue(channel, key, to, subject, body, cfg):
    ready = cfg.sms_ready if channel == "sms" else cfg.email_ready
    row = NotificationLog.objects.create(
        channel=channel, template=key, recipient_masked=mask_recipient(to), provider=_provider(channel, cfg),
        status=NotificationLog.Status.QUEUED if ready else NotificationLog.Status.SKIPPED,
        provider_response="" if ready else f"{channel.upper()} is not enabled",
        pending_to=to if ready else "", pending_subject=subject if ready else "", pending_body=body if ready else "")
    if not ready:
        return row
    from .tasks import deliver_notification

    try:
        deliver_notification.delay(str(row.pk))
    except Exception:  # a broker outage must not fail a payment or a page
        log.exception("Could not queue notification %s", row.pk)
        NotificationLog.objects.filter(pk=row.pk).update(
            status=NotificationLog.Status.FAILED, provider_response="Could not reach the task queue",
            pending_to="", pending_subject="", pending_body="")
    return row


def notify(key, *, phone="", email="", language="", **context):
    """Queue a template to whichever of phone and email are given. Never raises, never sends inline."""
    try:
        template = template_for(key)
        if not template.is_enabled:
            return
        lang = "sw" if language == "sw" else "en"
        values = {"site_name": SiteSettings.load().site_name, **context}
        subject = sms.fill(getattr(template, f"subject_{lang}") or template.subject_en, values)
        body = sms.fill(getattr(template, f"body_{lang}") or template.body_en, values)
        cfg = NotificationConfig.load()
        if phone:
            _queue("sms", key, phone, "", body, cfg)
        if email:
            _queue("email", key, email, subject, body, cfg)
    except Exception:
        log.exception("Notification %s could not be queued", key)
