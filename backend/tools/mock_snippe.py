#!/usr/bin/env python3
"""A local stand-in for the Snippe API, for development and e2e tests. Never deploy this.

Follows the documented API shapes. A payment completes after MOCK_DELAY seconds and fires a signed
webhook, unless its phone ends in 0000 (declined) or 1111 (stays pending). Payouts behave the same way,
draw down the mock balance, and charge 1% (at least TZS 500).
"""
import hashlib
import hmac
import json
import os
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SECRET = os.environ.get("MOCK_WEBHOOK_SECRET", "whsec_mock")
KEY = os.environ.get("MOCK_API_KEY", "snp_mock_key_for_development")
DELAY = float(os.environ.get("MOCK_DELAY", "2"))
PORT = int(os.environ.get("MOCK_PORT", "9100"))
PAYMENTS = {}
IDEMPOTENT = {}
PAYOUTS = {}
BALANCE = {"value": int(os.environ.get("MOCK_BALANCE", "125000"))}
MIN_PAYOUT = 5000


def payout_fee(amount):
    return max(500, amount // 100)


def deliver(url, event_type, data):
    import urllib.request

    body = json.dumps({"id": f"evt_{uuid.uuid4().hex[:12]}", "type": event_type, "api_version": "2026-01-25",
                       "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"), "data": data}).encode()
    stamp = str(int(time.time()))
    signature = hmac.new(SECRET.encode(), f"{stamp}.".encode() + body, hashlib.sha256).hexdigest()
    request = urllib.request.Request(url, data=body, headers={
        "Content-Type": "application/json", "X-Webhook-Event": event_type,
        "X-Webhook-Timestamp": stamp, "X-Webhook-Signature": signature})
    try:
        urllib.request.urlopen(request, timeout=10)
    except Exception as exc:
        print("webhook delivery failed:", exc)


def payout_view(p):
    money = lambda v: {"value": v, "currency": "TZS"}  # noqa: E731
    return {"reference": p["reference"], "object": "payout", "status": p["status"], "amount": money(p["amount"]),
            "fees": money(p["fee"]), "total": money(p["amount"] + p["fee"]), "channel": {"type": p["channel"]},
            "recipient": p["recipient"], "metadata": p["metadata"], "failure_reason": p.get("failure_reason"),
            "external_reference": p.get("external_reference")}


def fire_payout(reference):
    time.sleep(DELAY)
    p = PAYOUTS[reference]
    if (p["recipient"].get("phone") or "").endswith("1111"):
        return
    if (p["recipient"].get("phone") or "").endswith("0000"):
        p["status"], p["failure_reason"] = "failed", "Recipient wallet rejected the transfer"
        BALANCE["value"] += p["amount"] + p["fee"]
    else:
        p["status"], p["external_reference"] = "completed", "PO" + uuid.uuid4().hex[:9].upper()
    if p.get("webhook_url"):
        deliver(p["webhook_url"], f"payout.{p['status']}", payout_view(p))


def fire(reference):
    time.sleep(DELAY)
    payment = PAYMENTS[reference]
    if payment["phone"].endswith("1111"):
        return
    declined = payment["phone"].endswith("0000")
    payment["status"] = "failed" if declined else "completed"
    data = {"reference": reference, "status": payment["status"],
            "amount": {"value": payment["amount"], "currency": "TZS"},
            "channel": {"type": "mobile_money", "provider": "mpesa"},
            "customer": {"phone": "+" + payment["phone"]}, "metadata": payment["metadata"]}
    if declined:
        data["failure_reason"] = "Transaction declined by user"
    else:
        data["external_reference"] = "SEL" + uuid.uuid4().hex[:9].upper()
    body = json.dumps({"id": f"evt_{uuid.uuid4().hex[:12]}", "type": f"payment.{payment['status']}",
                       "api_version": "2026-01-25", "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                       "data": data}).encode()
    stamp = str(int(time.time()))
    signature = hmac.new(SECRET.encode(), f"{stamp}.".encode() + body, hashlib.sha256).hexdigest()
    import urllib.request

    request = urllib.request.Request(payment["webhook_url"], data=body, headers={
        "Content-Type": "application/json", "X-Webhook-Event": f"payment.{payment['status']}",
        "X-Webhook-Timestamp": stamp, "X-Webhook-Signature": signature})
    try:
        urllib.request.urlopen(request, timeout=10)
    except Exception as exc:
        print("webhook delivery failed:", exc)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send(self, code, payload):
        raw = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def fail(self, code, error_code, message):
        self.send(code, {"status": "error", "code": code, "error_code": error_code, "message": message})

    def ok(self, data, code=200):
        self.send(code, {"status": "success", "code": code, "data": data})

    def authed(self):
        if self.headers.get("Authorization") != f"Bearer {KEY}":
            self.fail(401, "unauthorized", "invalid or missing API key")
            return False
        return True

    def do_GET(self):
        if not self.authed():
            return
        if self.path == "/v1/payments/balance":
            money = {"currency": "TZS", "value": BALANCE["value"]}
            return self.ok({"object": "balance", "api_version": "2026-01-25", "available": money, "balance": money})
        if self.path.startswith("/v1/payouts/fee"):
            amount = int(self.path.split("amount=", 1)[-1].split("&")[0] or 0)
            fee = payout_fee(amount)
            return self.ok({"amount": amount, "fee_amount": fee, "total_amount": amount + fee, "currency": "TZS"})
        if self.path.startswith("/v1/payouts/"):
            payout = PAYOUTS.get(self.path.rsplit("/", 1)[1])
            return self.ok(payout_view(payout)) if payout else self.fail(404, "not_found", "payout not found")
        if self.path.startswith("/v1/payouts"):
            items = [payout_view(p) for p in reversed(PAYOUTS.values())]
            return self.ok({"total": len(items), "items": items[:50]})
        if self.path.startswith("/v1/payments/"):
            payment = PAYMENTS.get(self.path.rsplit("/", 1)[1])
            if payment is None:
                return self.fail(404, "not_found", "payment not found")
            return self.ok({"reference": payment["reference"], "status": payment["status"], "object": "payment",
                            "amount": {"currency": "TZS", "value": payment["amount"]}})
        self.fail(404, "not_found", "not found")

    def do_POST(self):
        if not self.authed():
            return
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        if self.path.endswith("/push"):
            return self.ok({"status": "pending"})
        if self.path == "/v1/payouts/send":
            return self.send_payout(body)
        if self.path != "/v1/payments":
            return self.fail(404, "not_found", "not found")
        amount = (body.get("details") or {}).get("amount")
        if not amount:
            return self.fail(400, "validation_error", "amount is required")
        key = self.headers.get("Idempotency-Key", "")
        if len(key) > 30:
            return self.fail(500, "PAY_001", "Failed to initiate payment")
        if key in IDEMPOTENT:
            return self.ok(IDEMPOTENT[key], 201)
        reference = f"pi_{uuid.uuid4().hex[:12]}"
        PAYMENTS[reference] = {"reference": reference, "status": "pending", "amount": amount,
                               "phone": body["phone_number"], "metadata": body.get("metadata") or {},
                               "webhook_url": body.get("webhook_url")}
        data = {"reference": reference, "status": "pending", "object": "payment", "payment_type": "mobile",
                "amount": {"currency": "TZS", "value": amount}, "api_version": "2026-01-25",
                "expires_at": time.strftime("%Y-%m-%dT%H:%M:%S.000000000Z", time.gmtime(time.time() + 14400))}
        IDEMPOTENT[key] = data
        threading.Thread(target=fire, args=(reference,), daemon=True).start()
        self.ok(data, 201)

    def send_payout(self, body):
        key = self.headers.get("Idempotency-Key", "")
        if key and key in IDEMPOTENT:
            return self.ok(IDEMPOTENT[key], 201)
        amount = int(body.get("amount") or 0)
        if amount < MIN_PAYOUT:
            return self.fail(400, "validation_error", f"minimum payout is {MIN_PAYOUT} TZS")
        fee = payout_fee(amount)
        if amount + fee > BALANCE["value"]:
            return self.fail(400, "insufficient_balance", "insufficient balance")
        if body.get("channel") == "mobile":
            recipient = {"name": body.get("recipient_name"), "phone": str(body.get("recipient_phone") or "")}
        else:
            recipient = {"name": body.get("recipient_name"), "bank": body.get("recipient_bank"),
                         "account": body.get("recipient_account")}
        BALANCE["value"] -= amount + fee
        reference = f"po_{uuid.uuid4().hex[:12]}"
        PAYOUTS[reference] = {"reference": reference, "status": "pending", "amount": amount, "fee": fee,
                              "channel": body.get("channel"), "recipient": recipient,
                              "metadata": body.get("metadata") or {}, "webhook_url": body.get("webhook_url")}
        data = payout_view(PAYOUTS[reference])
        if key:
            IDEMPOTENT[key] = data
        threading.Thread(target=fire_payout, args=(reference,), daemon=True).start()
        self.ok(data, 201)


if __name__ == "__main__":
    print(f"Mock Snippe on :{PORT} key={KEY}")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
