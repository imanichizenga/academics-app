"""Withdrawals from the Snippe balance to the teacher's own phone or bank account.

Flow, as Snippe documents it: quote the fee, check the balance covers amount + fee, then send with an
Idempotency-Key. Snippe reports the outcome by webhook (payout.completed / payout.failed / payout.reversed),
and reconcile_pending_payouts covers a missed webhook.
"""
import hashlib
import logging
from datetime import timedelta

from django.db import transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone

from apps.core.api import ApiError
from apps.core.phone import InvalidPhone, normalize_phone

from .models import Order, PaymentGatewayConfig, Payout
from .snippe import SnippeClient, SnippeError

log = logging.getLogger(__name__)
MIN_PAYOUT = 5000
ARRIVAL_MINUTES = 30
LOST_AFTER = timedelta(minutes=15)  # no Snippe record by then means it never left
SCOPE_FIX = ("In the Snippe dashboard open Settings → API Keys and give this key the disbursement:read and "
             "disbursement:create permissions, then save the new key under Settings → Payments.")
TERMINAL = {Payout.Status.COMPLETED, Payout.Status.FAILED, Payout.Status.REVERSED}


def earnings():
    """Money customers actually paid. Gateway tests are the teacher's own money, so they are left out."""
    return Order.objects.filter(status=Order.Status.COMPLETED).exclude(order_type=Order.Type.GATEWAY_TEST)


def last_withdrawal():
    return Payout.objects.exclude(status__in=[Payout.Status.FAILED, Payout.Status.REVERSED]).first()


def _money(value):
    return (value or {}).get("value", 0) if isinstance(value, dict) else int(value or 0)


def _client():
    cfg = PaymentGatewayConfig.load()
    if not cfg.api_key:
        raise ApiError("Add your Snippe API key under Settings → Payments first.", "not_configured", 409)
    return SnippeClient(cfg)


def _explain(exc):
    if exc.status in (401, 403):
        return "Snippe refused this API key for withdrawals.", SCOPE_FIX
    if exc.status is None:
        return "Could not reach Snippe right now.", "Check your connection and try again in a minute."
    return str(exc), ""


def readiness():
    """What the Withdraw page shows before money moves: is Snippe set up to pay out, and how much is there?"""
    cfg = PaymentGatewayConfig.load()
    checks, balance = [], None
    if not cfg.api_key:
        checks.append({"key": "key", "status": "fail", "title": "Snippe API key saved",
                       "detail": "No API key yet.", "fix": "Add it under Settings → Payments."})
        return {"ready": False, "balance": None, "checks": checks}
    checks.append({"key": "key", "status": "ok", "title": "Snippe API key saved", "detail": f"Mode: {cfg.mode_label}."})
    client = SnippeClient(cfg)
    try:
        data = client.balance()
        balance = _money(data.get("available") or data.get("available_balance") or data.get("balance"))
        checks.append({"key": "balance", "status": "ok", "title": "Balance readable",
                       "detail": f"TZS {balance:,} available in Snippe."})
    except SnippeError as exc:
        detail, fix = _explain(exc)
        checks.append({"key": "balance", "status": "fail", "title": "Balance readable", "detail": detail, "fix": fix})
    try:
        quote = client.payout_fee(MIN_PAYOUT)
        checks.append({"key": "payouts", "status": "ok", "title": "Permission to withdraw",
                       "detail": f"A TZS {MIN_PAYOUT:,} withdrawal costs TZS {_money(quote.get('fee_amount')):,} in fees."})
    except SnippeError as exc:
        detail, fix = _explain(exc)
        checks.append({"key": "payouts", "status": "fail", "title": "Permission to withdraw", "detail": detail,
                       "fix": fix})
    return {"ready": all(c["status"] == "ok" for c in checks), "balance": balance, "checks": checks}


def summary():
    paid = earnings()
    totals = paid.aggregate(total=Sum("amount"), count=Count("id"),
                            subscriptions=Sum("amount", filter=Q(order_type=Order.Type.SUBSCRIPTION)),
                            content=Sum("amount", filter=Q(order_type=Order.Type.CONTENT)))
    payouts = Payout.objects.aggregate(
        withdrawn=Sum("amount", filter=Q(status=Payout.Status.COMPLETED)),
        withdrawn_count=Count("id", filter=Q(status=Payout.Status.COMPLETED)),
        fees=Sum("fee", filter=Q(status=Payout.Status.COMPLETED)),
        pending=Sum("amount", filter=Q(status=Payout.Status.PENDING)),
        pending_count=Count("id", filter=Q(status=Payout.Status.PENDING)))
    last = last_withdrawal()
    since = paid.filter(paid_at__gt=last.created_at) if last else paid
    since_totals = since.aggregate(total=Sum("amount"), count=Count("id"))
    destination = None
    if last:
        destination = {"channel": last.channel, "recipient_name": last.recipient_name,
                       "recipient_phone": last.recipient_phone, "recipient_bank": last.recipient_bank,
                       "recipient_account": last.recipient_account}
    return {
        "currency": "TZS", "min_amount": MIN_PAYOUT, "arrival_minutes": ARRIVAL_MINUTES,
        "earned": {"total": totals["total"] or 0, "count": totals["count"],
                   "subscriptions": totals["subscriptions"] or 0, "content": totals["content"] or 0},
        "withdrawn": {"total": payouts["withdrawn"] or 0, "count": payouts["withdrawn_count"],
                      "fees": payouts["fees"] or 0},
        "pending": {"total": payouts["pending"] or 0, "count": payouts["pending_count"]},
        "since_last": {"from": last.created_at if last else None, "total": since_totals["total"] or 0,
                       "count": since_totals["count"]},
        "last_destination": destination,
    }


def quote(amount):
    if amount < MIN_PAYOUT:
        raise ApiError(f"The smallest withdrawal Snippe allows is TZS {MIN_PAYOUT:,}.", "below_minimum")
    try:
        data = _client().payout_fee(amount)
    except SnippeError as exc:
        detail, fix = _explain(exc)
        raise ApiError(f"{detail} {fix}".strip(), "gateway_error", 502) from exc
    fee = _money(data.get("fee_amount"))
    return {"amount": amount, "fee": fee, "total": _money(data.get("total_amount")) or amount + fee}


def _key(client_key):
    return "po_" + hashlib.sha256(client_key.encode()).hexdigest()[:27]


def clean_destination(data):
    channel = data.get("channel")
    name = (data.get("recipient_name") or "").strip()
    if not name:
        raise ApiError("Enter the name on the account.", "invalid", extra={"fields": {"recipient_name": "Enter the name on the account."}})
    out = {"channel": channel, "recipient_name": name[:120]}
    if channel == Payout.Channel.MOBILE:
        try:
            out["recipient_phone"] = normalize_phone(data.get("recipient_phone"))
        except InvalidPhone as exc:
            raise ApiError("Enter a valid Tanzanian phone number.", "invalid", extra={"fields": {"recipient_phone": "Enter a valid Tanzanian phone number."}}) from exc
    elif channel == Payout.Channel.BANK:
        bank = (data.get("recipient_bank") or "").strip().upper()
        account = "".join((data.get("recipient_account") or "").split())
        if not bank or not account.isalnum():
            raise ApiError("Choose the bank and enter the account number.", "invalid", extra={"fields": {"recipient_account": "Choose the bank and enter the account number."}})
        out.update(recipient_bank=bank[:40], recipient_account=account[:40])
    else:
        raise ApiError("Choose mobile money or bank.", "invalid", extra={"fields": {"channel": "Choose mobile money or bank."}})
    return out


def create(user, data):
    client_key = str(data.get("client_key") or "")
    if not 16 <= len(client_key) <= 64:
        raise ApiError("Missing request key. Reload the page and try again.", "invalid")
    key = _key(client_key)
    existing = Payout.objects.filter(idempotency_key=key).first()
    if existing:
        return existing  # a double click or a retried request: same withdrawal, never a second one
    try:
        amount = int(data.get("amount"))
    except (TypeError, ValueError) as exc:
        raise ApiError("Enter the amount to withdraw.", "invalid", extra={"fields": {"amount": "Enter the amount to withdraw."}}) from exc
    destination = clean_destination(data)
    client = _client()
    with transaction.atomic():
        PaymentGatewayConfig.objects.select_for_update().get(provider="snippe")  # one withdrawal at a time
        busy = Payout.objects.filter(status=Payout.Status.PENDING, snippe_reference="",
                                     created_at__gt=timezone.now() - LOST_AFTER).exists()
        if busy:
            raise ApiError("Another withdrawal is still being sent. Wait a moment and refresh.", "busy", 409)
        price = quote(amount)
        try:
            available = _money((client.balance() or {}).get("available"))
        except SnippeError as exc:
            detail, fix = _explain(exc)
            raise ApiError(f"{detail} {fix}".strip(), "gateway_error", 502) from exc
        if price["total"] > available:
            raise ApiError(f"Not enough balance. You need TZS {price['total']:,} (including TZS {price['fee']:,} fee) "
                           f"and Snippe has TZS {available:,}.", "insufficient_balance", 409)
        payout = Payout(amount=amount, fee=price["fee"], total=price["total"], requested_by=user,
                        idempotency_key=key, narration=(data.get("narration") or "Withdrawal")[:120], **destination)
        payout.log("requested", f"TZS {amount:,} to {destination.get('recipient_phone') or destination.get('recipient_bank')}")
        payout.save()
    _send(client, payout)
    return payout


def _send(client, payout):
    from .services import webhook_url

    body = {"channel": payout.channel, "amount": payout.amount, "recipient_name": payout.recipient_name,
            "narration": payout.narration, "webhook_url": webhook_url(), "metadata": {"payout_id": str(payout.pk)}}
    if payout.channel == Payout.Channel.MOBILE:
        body["recipient_phone"] = payout.recipient_phone
    else:
        body.update(recipient_bank=payout.recipient_bank, recipient_account=payout.recipient_account)
    try:
        data = client.send_payout(body, payout.idempotency_key)
    except SnippeError as exc:
        if exc.status is None or exc.status >= 500:
            # The request may or may not have landed. Keep it pending; reconciliation finds out which.
            payout.log("send_uncertain", str(exc))
            Payout.objects.filter(pk=payout.pk).update(timeline=payout.timeline)
            return
        payout.status, payout.failure_reason = Payout.Status.FAILED, str(exc)[:240]
        payout.raw_response = exc.body
        payout.log("rejected", str(exc))
        payout.save()
        return
    payout.snippe_reference = data.get("reference", "")[:80]
    payout.raw_response = data
    payout.log("sent", payout.snippe_reference)
    payout.save()
    apply_state(payout, data.get("status"), data, source="send")


def apply_state(payout, state, data=None, *, source):
    data = data or {}
    with transaction.atomic():
        payout = Payout.objects.select_for_update().get(pk=payout.pk)
        allowed = state in TERMINAL and (payout.status == Payout.Status.PENDING or
                                         (payout.status == Payout.Status.COMPLETED and state == Payout.Status.REVERSED))
        if not allowed:
            return payout
        payout.status = state
        if state == Payout.Status.COMPLETED:
            payout.completed_at = timezone.now()
            payout.external_reference = (data.get("external_reference") or "")[:80]
        if state in (Payout.Status.FAILED, Payout.Status.REVERSED):
            payout.failure_reason = (data.get("failure_reason") or payout.failure_reason or state)[:240]
        payout.log(state, source)
        payout.save()
    return payout


def find(data):
    reference = data.get("reference")
    payout_id = (data.get("metadata") or {}).get("payout_id")
    payout = Payout.objects.filter(snippe_reference=reference).first() if reference else None
    if payout is None and payout_id:
        payout = Payout.objects.filter(pk=payout_id).first()
        if payout is not None and reference and not payout.snippe_reference:
            Payout.objects.filter(pk=payout.pk).update(snippe_reference=reference[:80])
    return payout


def reconcile(payout):
    client = _client()
    Payout.objects.filter(pk=payout.pk).update(last_polled_at=timezone.now())
    if payout.snippe_reference:
        data = client.get_payout(payout.snippe_reference)
    else:
        listing = client.list_payouts()
        items = listing.get("items", listing) if isinstance(listing, dict) else listing
        data = next((p for p in items or [] if (p.get("metadata") or {}).get("payout_id") == str(payout.pk)), None)
        if data is None:
            if timezone.now() - payout.created_at > LOST_AFTER:
                return apply_state(payout, Payout.Status.FAILED, {"failure_reason": "Never reached Snippe"},
                                   source="reconciliation").status
            return payout.status
        Payout.objects.filter(pk=payout.pk).update(snippe_reference=data.get("reference", "")[:80])
    return apply_state(payout, data.get("status"), data, source="reconciliation").status
