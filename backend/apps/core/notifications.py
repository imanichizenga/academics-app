"""Pluggable SMS/email. Register a provider with register("sms", fn); with none, messages are logged."""
import logging

log = logging.getLogger("notifications")
_providers = {}


def register(channel, fn):
    _providers[channel] = fn


def has_provider(channel):
    return channel in _providers


def _masked(to):
    return f"{to[:5]}•••{to[-2:]}" if to else "?"


def send_sms(phone, message):
    if "sms" in _providers:
        return _providers["sms"](phone, message)
    log.info("SMS (no provider configured) to=%s chars=%d", _masked(phone), len(message))
    return False


def send_email(email, subject, message):
    if "email" in _providers:
        return _providers["email"](email, subject, message)
    log.info("Email (no provider configured) to=%s subject=%r", _masked(email), subject)
    return False
