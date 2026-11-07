"""Withdrawals: Snippe's preflight (fee, balance), idempotent send, webhook/reconcile outcomes, and the totals."""
import json
import uuid
from datetime import timedelta

import pytest
import responses
from django.utils import timezone

from apps.payments.models import Order, Payout
from apps.payments.tasks import reconcile_pending_payouts

from .conftest import webhook_post

API = "https://api.snippe.sh"
PASSWORD = "correct-horse-9"


def ok(data, status=200):
    return {"status": "success", "code": status, "data": data}


def mock_snippe(balance=100000, fee=500, send_status=201, reference="po_abc"):
    responses.get(f"{API}/v1/payments/balance", json=ok({"available": {"value": balance, "currency": "TZS"}}))
    responses.get(f"{API}/v1/payouts/fee", json=ok({"fee_amount": fee, "total_amount": None, "currency": "TZS"}))
    if send_status < 400:
        responses.post(f"{API}/v1/payouts/send", status=send_status,
                       json=ok({"reference": reference, "status": "pending"}, send_status))
    else:
        responses.post(f"{API}/v1/payouts/send", status=send_status,
                       json={"status": "error", "message": "Recipient not supported", "error_code": "invalid"})


def paid_order(amount=10000, order_type=Order.Type.SUBSCRIPTION, paid_at=None, **extra):
    return Order.objects.create(phone="255754000111", first_name="Asha", last_name="Mushi", order_type=order_type,
                                amount=amount, status=Order.Status.COMPLETED, idempotency_key=uuid.uuid4().hex[:30],
                                paid_at=paid_at or timezone.now(), item_title="Monthly", **extra)


def withdraw(client, amount=20000, **extra):
    body = {"amount": amount, "channel": "mobile", "recipient_phone": "0754 123 456", "recipient_name": "Amani",
            "password": PASSWORD, "client_key": uuid.uuid4().hex, **extra}
    return client.post("/api/v1/admin/payouts/", body, format="json")


@pytest.fixture
def boss(client, admin, gateway):
    return client.login_as(admin)


@responses.activate
def test_withdraw_follows_snippe_contract(boss):
    mock_snippe()
    res = withdraw(boss)
    assert res.status_code == 201, res.json()
    assert res.json()["status"] == "pending"
    sent = next(c.request for c in responses.calls if c.request.url.endswith("/v1/payouts/send"))
    body = json.loads(sent.body)
    assert body["channel"] == "mobile" and body["amount"] == 20000
    assert body["recipient_phone"] == "255754123456" and body["recipient_name"] == "Amani"
    assert body["webhook_url"].endswith("/api/payments/webhooks/snippe/")
    payout = Payout.objects.get()
    assert body["metadata"] == {"payout_id": str(payout.pk)}
    assert sent.headers["Idempotency-Key"] == payout.idempotency_key and len(payout.idempotency_key) <= 30
    assert (payout.fee, payout.total, payout.snippe_reference) == (500, 20500, "po_abc")


@responses.activate
def test_bank_withdrawal(boss):
    mock_snippe()
    res = withdraw(boss, channel="bank", recipient_bank="crdb", recipient_account="0150 1234 5678")
    assert res.status_code == 201
    body = json.loads(responses.calls[-1].request.body)
    assert (body["recipient_bank"], body["recipient_account"]) == ("CRDB", "015012345678")
    assert "recipient_phone" not in body


@responses.activate
def test_same_request_key_never_pays_twice(boss):
    mock_snippe()
    key = uuid.uuid4().hex
    first, second = withdraw(boss, client_key=key), withdraw(boss, client_key=key)
    assert first.json()["id"] == second.json()["id"]
    assert Payout.objects.count() == 1
    assert sum(c.request.url.endswith("/send") for c in responses.calls) == 1


@responses.activate
def test_wrong_password_moves_no_money(boss):
    mock_snippe()
    res = withdraw(boss, password="nope")
    assert res.status_code == 403 and res.json()["error"]["code"] == "wrong_password"
    assert not Payout.objects.exists() and not responses.calls


@responses.activate
def test_balance_must_cover_amount_plus_fee(boss):
    mock_snippe(balance=20400, fee=500)
    res = withdraw(boss, amount=20000)
    assert res.status_code == 409 and res.json()["error"]["code"] == "insufficient_balance"
    assert "20,500" in res.json()["error"]["message"]
    assert not Payout.objects.exists()


@responses.activate
def test_below_minimum(boss):
    mock_snippe()
    assert withdraw(boss, amount=4999).json()["error"]["code"] == "below_minimum"


@pytest.mark.parametrize("extra", [{"recipient_phone": "123"}, {"recipient_name": " "}, {"channel": "cash"},
                                   {"channel": "bank", "recipient_bank": "", "recipient_account": "1"}])
@responses.activate
def test_destination_is_validated(boss, extra):
    mock_snippe()
    assert withdraw(boss, **extra).status_code == 400
    assert not Payout.objects.exists()


@responses.activate
def test_snippe_rejection_is_recorded_as_failed(boss):
    mock_snippe(send_status=400)
    res = withdraw(boss)
    assert res.status_code == 502 and res.json()["error"]["code"] == "payout_rejected"
    assert Payout.objects.get().status == Payout.Status.FAILED


@responses.activate
def test_network_failure_stays_pending_then_reconciles(boss):
    mock_snippe(send_status=503)
    res = withdraw(boss)
    assert res.status_code == 201 and res.json()["status"] == "pending"
    payout = Payout.objects.get()
    Payout.objects.filter(pk=payout.pk).update(created_at=timezone.now() - timedelta(minutes=3))
    responses.get(f"{API}/v1/payouts", json=ok({"total": 1, "items": [
        {"reference": "po_late", "status": "completed", "metadata": {"payout_id": str(payout.pk)}}]}))
    reconcile_pending_payouts()
    payout.refresh_from_db()
    assert (payout.status, payout.snippe_reference) == (Payout.Status.COMPLETED, "po_late")


@responses.activate
def test_scope_problem_is_explained(boss):
    responses.get(f"{API}/v1/payments/balance", json=ok({"available": {"value": 1, "currency": "TZS"}}))
    responses.get(f"{API}/v1/payouts/fee", status=403, json={"status": "error", "message": "forbidden"})
    data = boss.get("/api/v1/admin/withdrawals/summary/").json()
    assert data["ready"] is False
    check = next(c for c in data["checks"] if c["key"] == "payouts")
    assert check["status"] == "fail" and "disbursement:create" in check["fix"]


@pytest.mark.parametrize("event,status", [("payout.completed", "completed"), ("payout.failed", "failed")])
@responses.activate
def test_webhook_settles_the_payout(boss, client, event, status):
    mock_snippe()
    withdraw(boss)
    res = webhook_post(client, {"id": f"evt_{status}", "type": event,
                                "data": {"reference": "po_abc", "status": status, "failure_reason": "Declined"}})
    assert res.status_code == 200
    assert Payout.objects.get().status == status


@responses.activate
def test_reversal_after_completion_but_not_back_to_pending(boss, client):
    mock_snippe()
    withdraw(boss)
    for i, event in enumerate(("payout.completed", "payout.reversed", "payout.completed")):
        webhook_post(client, {"id": f"evt_{i}", "type": event, "data": {"reference": "po_abc"}})
    assert Payout.objects.get().status == Payout.Status.REVERSED


@responses.activate
def test_summary_separates_withdrawn_from_available(boss):
    old = timezone.now() - timedelta(days=3)
    paid_order(10000, paid_at=old)
    paid_order(3000, Order.Type.CONTENT, paid_at=old)
    paid_order(500, Order.Type.GATEWAY_TEST)  # the teacher's own test money is not earnings
    Payout.objects.create(amount=8000, fee=500, total=8500, channel="mobile", recipient_name="A",
                          recipient_phone="255754123456", status="completed", idempotency_key="po_a")
    Payout.objects.create(amount=6000, fee=500, total=6500, channel="mobile", recipient_name="A",
                          recipient_phone="255754123456", status="failed", idempotency_key="po_b")
    pending = Payout.objects.create(amount=5000, fee=500, total=5500, channel="mobile", recipient_name="A",
                                    recipient_phone="255754123456", status="pending", idempotency_key="po_c",
                                    snippe_reference="po_c")
    Payout.objects.filter(pk=pending.pk).update(created_at=old + timedelta(days=1))
    paid_order(2000, Order.Type.CONTENT)  # after the last withdrawal
    mock_snippe(balance=1500)
    data = boss.get("/api/v1/admin/withdrawals/summary/").json()
    assert data["balance"] == 1500 and data["ready"] is True
    assert data["earned"] == {"total": 15000, "count": 3, "subscriptions": 10000, "content": 5000}
    assert data["withdrawn"] == {"total": 8000, "count": 1, "fees": 500}
    assert data["pending"] == {"total": 5000, "count": 1}
    assert (data["since_last"]["total"], data["since_last"]["count"]) == (2000, 1)
    assert data["last_destination"]["recipient_phone"] == "255754123456"
    assert data["arrival_minutes"] == 30


def test_earnings_lists_payers(boss):
    paid_order(10000)
    paid_order(3000, Order.Type.CONTENT)
    paid_order(500, Order.Type.GATEWAY_TEST)
    Order.objects.create(phone="255754000999", first_name="P", last_name="Q", order_type="subscription", amount=1,
                         status="pending", idempotency_key="pend")
    rows = boss.get("/api/v1/admin/withdrawals/earnings/").json()["results"]
    assert sorted(r["amount"] for r in rows) == [3000, 10000]
    only = boss.get("/api/v1/admin/withdrawals/earnings/?order_type=content_purchase").json()["results"]
    assert [r["amount"] for r in only] == [3000]


@pytest.mark.parametrize("path", ["/api/v1/admin/withdrawals/summary/", "/api/v1/admin/payouts/",
                                  "/api/v1/admin/withdrawals/earnings/", "/api/v1/admin/withdrawals/quote/?amount=9000"])
def test_editors_cannot_see_money(client, editor, path):
    client.login_as(editor)
    assert client.get(path).status_code == 403
