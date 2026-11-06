from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from .models import AuditLog

SECRET_WORDS = ("secret", "password", "api_key", "private_key", "token")


def client_ip(request):
    """The nearest proxy's view of the client. Earlier X-Forwarded-For entries can be forged."""
    if request is None:
        return None
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    return (forwarded.split(",")[-1].strip() if forwarded else request.META.get("REMOTE_ADDR")) or None


def _clean(value):
    if isinstance(value, (UUID, date, datetime, Decimal)):
        return str(value)
    if isinstance(value, (list, tuple)):
        return [_clean(v) for v in value]
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def snapshot(instance, fields):
    return {f: _clean(getattr(instance, f, None)) for f in fields}


def diff(before, after):
    """{field: [old, new]}, with secret values replaced by a marker so they never reach the log."""
    out = {}
    for key in after:
        if before.get(key) != after[key]:
            if any(w in key for w in SECRET_WORDS):
                out[key] = ["•••", "••• (changed)"]
            else:
                out[key] = [before.get(key), after[key]]
    return out


def record(request, action, target=None, changes=None, label=""):
    actor = getattr(request, "user", None)
    actor = actor if actor is not None and actor.is_authenticated else None
    AuditLog.objects.create(
        actor=actor,
        actor_label=str(actor) if actor else "system",
        action=action,
        target_type=target.__class__.__name__ if target is not None else "",
        target_id=str(getattr(target, "pk", "")) if target is not None else "",
        target_label=(label or str(target))[:200] if target is not None else label[:200],
        diff=_clean(changes or {}),
        ip=client_ip(request),
    )
