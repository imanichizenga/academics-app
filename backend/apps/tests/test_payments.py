import threading
import time
from datetime import timedelta

import pytest
import responses
from django.db import connection
from django.utils import timezone

from apps.accounts.models import User
from apps.payments import services
from apps.payments.access import can_access
from apps.payments.models import Entitlement, Order, WebhookEvent
from apps.payments.tasks import expire_entitlements, reconcile_pending_orders

from .conftest import SECRET, completed_event, make_content, make_user, webhook_post

API = "https://api.snippe.sh"
BUYER = {"phone": "0754 000 111", "first_name": "Asha", "last_name": "Mushi"}


def mock_create(reference="pi_abc"):
    responses.post(f"{API}/v1/payments", status=201, json={"status": "success", "code": 201, "data": {
        "reference": reference, "status": "pending", "expires_at": "2030-01-25T05:04:54.063993853Z",
        "amount": {"currency": "TZS", "value": 2000}}})


def checkout(client, content=None, plan=None, key="k1", **extra):
    body = {**BUYER, **extra}
    if content:
        body.update(order_type="content_purchase", content=str(content.pk))
    else:
        body.update(order_type="subscription", plan=str(plan.pk))
    return client.post("/api/v1/checkout/", body, format="json", HTTP_IDEMPOTENCY_KEY=key)


@responses.activate
def test_request_matches_snippe_contract(client, paid, gateway):
    mock_create()
    res = checkout(client, paid)
    assert res.status_code == 201
    sent = responses.calls[0].request
    assert sent.headers["Authorization"] == "Bearer snp_test_key"
    assert len(sent.headers["Idempotency-Key"]) <= 30
    import json

    body = json.loads(sent.body)
    assert body["payment_type"] == "mobile"
    assert body["details"] == {"amount": 2000, "currency": "TZS"}
    assert body["phone_number"] == "255754000111"
    assert body["customer"]["email"] == "255754000111@example.com"
    assert body["webhook_url"].endswith("/api/payments/webhooks/snippe/")
    assert body["metadata"]["order_id"] == res.data["id"]
    order = Order.objects.get()
    assert order.expires_at.year == 2030  # parsed Snippe's nanosecond timestamp
    assert order.claim_token_hash != res.data["claim_token"]


@responses.activate
def test_price_comes_from_database(client, paid, gateway):
    mock_create()
    checkout(client, paid, amount=500, price=500)
    assert Order.objects.get().amount == 2000


@responses.activate
def test_double_tap_creates_one_order_and_one_charge(client, paid, gateway):
    mock_create()
    first, second = checkout(client, paid, key="same"), checkout(client, paid, key="same")
    assert first.data["id"] == second.data["id"]
    assert Order.objects.count() == 1
    assert len(responses.calls) == 1


def test_checkout_blocked_without_tested_gateway(client, paid, gateway):
    gateway.last_test_status = "failed"
    gateway.save()
    assert checkout(client, paid).status_code == 503


@responses.activate
def test_full_flow_auto_creates_account_and_logs_in(client, paid, gateway):
    mock_create("pi_flow")
    res = checkout(client, paid)
    order_id, token = res.data["id"], res.data["claim_token"]
    assert webhook_post(client, completed_event("pi_flow", 2000)).status_code == 200

    user = User.objects.get(username="255754000111")
    assert user.source == "auto_created_by_payment" and user.must_change_password
    assert user.check_password("255754000111")
    assert can_access(user, paid)
    assert client.get(f"/api/v1/orders/{order_id}/status/").data["status"] == "completed"

    claim = client.post(f"/api/v1/orders/{order_id}/claim/", {"claim_token": token}, format="json")
    assert claim.status_code == 200 and claim.data["account_created"]
    assert client.cookies["access"].value
    assert client.get("/api/v1/auth/me/").data["user"]["phone"] == "255754000111"
    detail = client.get(f"/api/v1/catalog/contents/{paid.slug}/")
    assert detail.data["has_access"] is True and detail.data["truncated"] is False

    again = client.post(f"/api/v1/orders/{order_id}/claim/", {"claim_token": token}, format="json")
    assert again.status_code == 403  # single use


@responses.activate
def test_existing_password_is_never_reset(client, paid, gateway):
    user = make_user("255754000111")
    mock_create("pi_exist")
    checkout(client, paid)
    webhook_post(client, completed_event("pi_exist", 2000))
    user.refresh_from_db()
    assert user.check_password("correct-horse-9")
    assert not user.must_change_password
    assert Order.objects.get().account_created is False


@responses.activate
def test_claim_never_opens_a_staff_account(client, paid, gateway):
    make_user("255754000111", "admin")
    mock_create("pi_staff")
    res = checkout(client, paid)
    webhook_post(client, completed_event("pi_staff", 2000))
    claim = client.post(f"/api/v1/orders/{res.data['id']}/claim/", {"claim_token": res.data["claim_token"]},
                        format="json")
    assert claim.data["login_required"] is True and "access" not in claim.cookies


@responses.activate
def test_claim_expires_and_wrong_token_refused(client, paid, gateway):
    mock_create("pi_exp")
    res = checkout(client, paid)
    webhook_post(client, completed_event("pi_exp", 2000))
    url = f"/api/v1/orders/{res.data['id']}/claim/"
    assert client.post(url, {"claim_token": "wrong"}, format="json").status_code == 403
    Order.objects.update(claim_expires_at=timezone.now() - timedelta(minutes=1))
    assert client.post(url, {"claim_token": res.data["claim_token"]}, format="json").status_code == 410


def pending(content, plan=None, phone="255754000111"):
    (order, _), _ = services.create_order(
        order_type="subscription" if plan else "content_purchase", phone=phone, first_name="A", last_name="B",
        content=None if plan else content, plan=plan)
    order.snippe_reference = f"pi_{order.pk.hex[:8]}"
    order.save()
    return order


def test_webhook_signature_valid_invalid_old(client, paid, gateway):
    order = pending(paid)
    event = completed_event(order.snippe_reference, 2000)
    assert webhook_post(client, event, secret="wrong").status_code == 401
    assert webhook_post(client, event, signature="0" * 64).status_code == 401
    assert webhook_post(client, event, timestamp=int(time.time()) - 301).status_code == 401
    order.refresh_from_db()
    assert order.status == "pending"
    assert WebhookEvent.objects.filter(signature_valid=False).count() == 3
    assert webhook_post(client, event).status_code == 200
    order.refresh_from_db()
    assert order.status == "completed"


def test_webhook_signature_uses_raw_bytes(client, paid, gateway):
    """Whitespace our JSON encoder would not produce must still verify."""
    from apps.payments.snippe import sign

    order = pending(paid)
    raw = (b'{ "id":"evt_raw",   "type":"payment.completed", "data":{"reference":"%s",'
           b'"amount":{"value":2000,"currency":"TZS"}} }' % order.snippe_reference.encode())
    stamp = str(int(time.time()))
    res = client.generic("POST", "/api/payments/webhooks/snippe/", raw, content_type="application/json",
                         HTTP_X_WEBHOOK_TIMESTAMP=stamp, HTTP_X_WEBHOOK_SIGNATURE=sign(SECRET, stamp, raw))
    assert res.status_code == 200


def test_duplicate_webhook_processed_once(client, paid, gateway):
    order = pending(paid)
    event = completed_event(order.snippe_reference, 2000)
    assert webhook_post(client, event).status_code == 200
    second = webhook_post(client, event)
    assert second.status_code == 200 and second.data["duplicate"]
    webhook_post(client, completed_event(order.snippe_reference, 2000, "evt_other"))
    assert Entitlement.objects.count() == 1


def test_wrong_amount_grants_nothing(client, paid, gateway):
    order = pending(paid)
    webhook_post(client, completed_event(order.snippe_reference, 500))
    order.refresh_from_db()
    assert order.status == "pending" and not Entitlement.objects.exists()


@pytest.mark.django_db(transaction=True)
def test_concurrent_completion_is_exactly_once(paid, gateway):
    order = pending(paid)
    results = []

    def worker():
        try:
            results.append(services.complete_order(order.pk, source="race"))
        finally:
            connection.close()

    threads = [threading.Thread(target=worker) for _ in range(4)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(results) == [False, False, False, True]
    assert Entitlement.objects.count() == 1


def test_failed_and_voided_events(client, paid, gateway):
    order = pending(paid)
    event = {"id": "evt_f", "type": "payment.failed", "data": {
        "reference": order.snippe_reference, "status": "failed", "failure_reason": "Declined by user"}}
    webhook_post(client, event)
    order.refresh_from_db()
    assert order.status == "failed" and order.failure_reason == "Declined by user"


def test_late_success_after_cancel_is_honoured(client, paid, gateway):
    order = pending(paid)
    services.close_order(order.pk, Order.Status.CANCELLED, source="customer")
    webhook_post(client, completed_event(order.snippe_reference, 2000))
    order.refresh_from_db()
    assert order.status == "completed" and Entitlement.objects.count() == 1


def test_subscription_extends_from_current_expiry(paid, plan, gateway):
    first = pending(None, plan)
    services.complete_order(first.pk, source="test")
    user = User.objects.get()
    expiry = Entitlement.objects.get().expires_at
    second = pending(None, plan)
    services.complete_order(second.pk, source="test")
    newest = Entitlement.objects.filter(user=user).order_by("-expires_at").first()
    assert newest.expires_at == expiry + timedelta(days=30)


def test_plan_price_change_keeps_paid_terms(plan, gateway):
    order = pending(None, plan)
    plan.duration_days, plan.price = 7, 99999
    plan.save()
    services.complete_order(order.pk, source="test")
    ent = Entitlement.objects.get()
    assert (ent.expires_at - timezone.now()).days >= 29


def test_lifetime_and_timed_content_access(gateway):
    timed = make_content(access_duration_days=10)
    order = pending(timed)
    services.complete_order(order.pk, source="test")
    assert Entitlement.objects.get().expires_at is not None
    life = make_content()
    services.complete_order(pending(life).pk, source="test")
    assert Entitlement.objects.get(content=life).expires_at is None


@responses.activate
def test_reconciliation_completes_and_expires(paid, gateway):
    order = pending(paid)
    stale = pending(paid, phone="255754000222")
    Order.objects.filter(pk=stale.pk).update(expires_at=timezone.now() - timedelta(hours=1))
    responses.get(f"{API}/v1/payments/{order.snippe_reference}", json={"status": "success", "data": {
        "status": "completed", "amount": {"value": 2000, "currency": "TZS"}}})
    responses.get(f"{API}/v1/payments/{stale.snippe_reference}", json={"status": "success", "data": {
        "status": "pending"}})
    reconcile_pending_orders()
    order.refresh_from_db()
    stale.refresh_from_db()
    assert order.status == "completed" and stale.status == "expired"


def test_expired_subscription_loses_access(student, gateway):
    from apps.payments.models import SubscriptionPlan

    content = make_content(included_in_subscription=True)
    plan = SubscriptionPlan.objects.create(name="M", price=1000)
    Entitlement.objects.create(user=student, kind="subscription", plan=plan,
                               expires_at=timezone.now() - timedelta(minutes=1))
    assert not can_access(student, content)
    expire_entitlements()
    assert not Entitlement.objects.get().is_active


@responses.activate
def test_resend_needs_claim_token(client, paid, gateway):
    mock_create("pi_push")
    res = checkout(client, paid)
    responses.post(f"{API}/v1/payments/pi_push/push", json={"status": "success", "data": {}})
    url = f"/api/v1/orders/{res.data['id']}/resend/"
    assert client.post(url, {"claim_token": "nope"}, format="json").status_code == 403
    assert client.post(url, {"claim_token": res.data["claim_token"]}, format="json").status_code == 200


@responses.activate
def test_logged_in_buyer_keeps_purchase_when_another_phone_pays(client, paid, gateway):
    buyer = make_user("255712345678")
    relative = make_user("255754000111")
    client.login_as(buyer)
    mock_create("pi_family")
    res = checkout(client, paid)
    webhook_post(client, completed_event("pi_family", 2000))
    assert Entitlement.objects.get().user == buyer and not Entitlement.objects.filter(user=relative).exists()
    claim = client.post(f"/api/v1/orders/{res.data['id']}/claim/", {"claim_token": res.data["claim_token"]},
                        format="json")
    assert claim.data["username"] == buyer.username
