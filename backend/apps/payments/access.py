"""The single place that decides who can reach what. Every endpoint goes through these functions."""
from dataclasses import dataclass, field

from django.db.models import Q
from django.utils import timezone

from .models import Entitlement


@dataclass
class AccessContext:
    user: object = None
    is_staff: bool = False
    has_subscription: bool = False
    subscription_expired: bool = False
    subscription_expires_at: object = None
    content_ids: set = field(default_factory=set)


def current_entitlements(user):
    now = timezone.now()
    return Entitlement.objects.filter(user=user, is_active=True, starts_at__lte=now).filter(
        Q(expires_at__isnull=True) | Q(expires_at__gt=now)
    )


def build_context(user):
    if user is None or not user.is_authenticated:
        return AccessContext()
    ctx = AccessContext(user=user, is_staff=user.is_staff_role)
    for kind, content_id, expires in current_entitlements(user).values_list("kind", "content_id", "expires_at"):
        if kind == Entitlement.Kind.SUBSCRIPTION:
            ctx.has_subscription = True
            if expires and (not ctx.subscription_expires_at or expires > ctx.subscription_expires_at):
                ctx.subscription_expires_at = expires
        elif content_id:
            ctx.content_ids.add(content_id)
    if not ctx.has_subscription:
        ctx.subscription_expired = Entitlement.objects.filter(user=user, kind=Entitlement.Kind.SUBSCRIPTION).exists()
    return ctx


def context_for(request):
    """Cached on the request so list views run one query, not one per card."""
    raw = getattr(request, "_request", request)
    if not hasattr(raw, "_access_ctx"):
        raw._access_ctx = build_context(getattr(request, "user", None))
    return raw._access_ctx


def can_access(user, content, ctx=None):
    if not content.is_paid:
        return True
    ctx = ctx or build_context(user)
    if ctx.is_staff or content.pk in ctx.content_ids:
        return True
    return ctx.has_subscription and content.included_in_subscription


def unlocked_by_purchase(user, content, ctx=None):
    """True when the user reached paid content by payment, for the Unlocked badge."""
    return content.is_paid and can_access(user, content, ctx)


def asset_contents(asset):
    from apps.catalog.models import Content

    return Content.objects.filter(Q(pk=asset.content_id) | Q(main_asset=asset) | Q(referenced_assets=asset)).distinct()


def can_access_asset(user, asset, ctx=None):
    """Return (allowed, content_to_sell). Unattached private files are refused for non-staff."""
    ctx = ctx or build_context(user)
    if ctx.is_staff or asset.requires_access is False:
        return True, None
    contents = [c for c in asset_contents(asset).select_related("category") if c.is_live or c.status == "archived"]
    paywall = None
    for content in contents:
        if content.status == "archived" and not (content.is_paid and can_access(user, content, ctx)):
            continue
        if asset.requires_access is True and not content.is_paid:
            continue
        if can_access(user, content, ctx):
            return True, None
        paywall = paywall or content
    return False, paywall
