"""Step-by-step SMS and email tests. These run inline, because the admin is waiting for the answer."""
import smtplib

from django.core.mail import get_connection
from django.utils import timezone

from . import notifications, sms
from .models import NotificationLog

STEPS = {"sms": ["config", "auth", "send"], "email": ["config", "connect", "send"]}
TITLES = {
    "sms": {"config": "Settings are complete", "auth": "Connect and sign in", "send": "Send a test SMS"},
    "email": {"config": "Settings are complete", "connect": "Connect to the mail server", "send": "Send a test email"},
}


def _sms_config(cfg):
    missing = []
    if cfg.sms_provider == "generic":
        missing += [] if cfg.generic_url else ["request URL"]
    else:
        missing += [] if cfg.sms_api_key else ["API key"]
    if cfg.sms_provider == "beem":
        missing += [] if cfg.sms_api_secret else ["API secret"]
        missing += [] if cfg.sms_sender_id else ["sender ID"]
    if cfg.sms_provider == "africastalking":
        missing += [] if cfg.sms_username else ["username"]
    return missing


def _email_config(cfg):
    return [name for name, value in (("host", cfg.smtp_host), ("from address", cfg.email_from_address)) if not value]


def _connect(cfg):
    connection = get_connection(
        "django.core.mail.backends.smtp.EmailBackend", host=cfg.smtp_host, port=cfg.smtp_port,
        username=cfg.smtp_username or None, password=cfg.smtp_password or None,
        use_tls=cfg.smtp_security == "starttls", use_ssl=cfg.smtp_security == "ssl", timeout=12, fail_silently=False)
    connection.open()
    connection.close()


def _step(cfg, channel, key, to):
    if key == "config":
        missing = _sms_config(cfg) if channel == "sms" else _email_config(cfg)
        if missing:
            return "fail", f"Missing: {', '.join(missing)}.", "Fill these in and save first."
        return "ok", "Everything needed is filled in.", ""
    if key == "auth":
        status = sms.check_auth(cfg)
        return ("ok", status, "") if status else ("skip", "A generic provider has no sign-in check.", "")
    if key == "connect":
        _connect(cfg)
        return "ok", f"Connected to {cfg.smtp_host}:{cfg.smtp_port}.", ""
    site = notifications.SiteSettings.load().site_name
    if not to:
        return "fail", "Enter where to send the test.", ""
    if channel == "sms":
        reply = sms.send(cfg, to, f"{site}: this is a test SMS.")
    else:
        reply = notifications.send_email(cfg, to, f"{site}: test email", f"{site}: this is a test email.")
    NotificationLog.objects.create(channel=channel, template="test", recipient_masked=notifications.mask_recipient(to),
                                   status=NotificationLog.Status.SENT, provider=notifications._provider(channel, cfg),
                                   provider_response=reply[:500], attempts=1)
    return "ok", reply, ""


def run_step(cfg, channel, key, to):
    try:
        status, detail, fix = _step(cfg, channel, key, to)
    except sms.SmsError as exc:
        status, detail, fix = "fail", str(exc), "Check the provider settings."
    except (smtplib.SMTPException, OSError) as exc:
        status, detail, fix = "fail", f"{type(exc).__name__}: {exc}"[:300], "Check the host, port, security and login."
    outcome = {"key": key, "title": TITLES[channel][key], "status": status, "detail": detail, "fix": fix,
               "at": timezone.now().isoformat()}
    report = {**getattr(cfg, f"{channel}_test_report"), key: outcome}
    setattr(cfg, f"{channel}_test_report", report)
    update = [f"{channel}_test_report"]
    if key == STEPS[channel][-1]:
        passed = all(report.get(k, {}).get("status") in ("ok", "skip") for k in STEPS[channel])
        setattr(cfg, f"{channel}_test_status", "passed" if passed else "failed")
        setattr(cfg, f"{channel}_tested_at", timezone.now())
        update += [f"{channel}_test_status", f"{channel}_tested_at"]
    cfg.save(update_fields=update)
    return outcome
