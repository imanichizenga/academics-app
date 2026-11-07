"""Thin client for the Snippe API, version 2026-01-25."""
import hashlib
import hmac
import logging
import time

import requests

log = logging.getLogger(__name__)
TIMEOUT = 20
WEBHOOK_TOLERANCE = 300


class SnippeError(Exception):
    def __init__(self, message, status=None, error_code=None, body=None):
        super().__init__(message)
        self.status, self.error_code, self.body = status, error_code, body or {}


class SnippeClient:
    def __init__(self, config):
        self.base = config.api_base_url.rstrip("/")
        self.key = config.api_key
        self.session_token = config.session_token or config.api_key

    def _request(self, method, path, json=None, headers=None, token=None, retries=2):
        url = f"{self.base}{path}"
        hdrs = {"Authorization": f"Bearer {token or self.key}", "Accept": "application/json", **(headers or {})}
        for attempt in range(retries + 1):
            try:
                response = requests.request(method, url, json=json, headers=hdrs, timeout=TIMEOUT)
            except requests.RequestException as exc:
                if attempt == retries:
                    raise SnippeError(f"Could not reach Snippe: {type(exc).__name__}") from exc
                time.sleep(2**attempt)
                continue
            if response.status_code == 429 or response.status_code >= 500:
                if attempt < retries:
                    reset = response.headers.get("X-Ratelimit-Reset", "")
                    time.sleep(min(int(reset), 5) if reset.isdigit() and int(reset) < 60 else 2**attempt)
                    continue
            return self._parse(response)
        raise SnippeError("Snippe did not respond")

    @staticmethod
    def _parse(response):
        try:
            body = response.json()
        except ValueError:
            body = {}
        if response.status_code >= 400 or body.get("status") == "error":
            raise SnippeError(body.get("message") or f"Snippe returned {response.status_code}",
                              response.status_code, body.get("error_code"), body)
        return body.get("data", body)

    def create_payment(self, body, idempotency_key):
        return self._request("POST", "/v1/payments", body, {"Idempotency-Key": idempotency_key})

    def get_payment(self, reference):
        return self._request("GET", f"/v1/payments/{reference}", retries=1)

    def push(self, reference):
        return self._request("POST", f"/v1/payments/{reference}/push", {}, retries=0)

    def balance(self):
        return self._request("GET", "/v1/payments/balance", retries=0)

    def payout_fee(self, amount):
        return self._request("GET", f"/v1/payouts/fee?amount={int(amount)}", retries=1)

    def send_payout(self, body, idempotency_key):
        return self._request("POST", "/v1/payouts/send", body, {"Idempotency-Key": idempotency_key}, retries=0)

    def get_payout(self, reference):
        return self._request("GET", f"/v1/payouts/{reference}", retries=1)

    def list_payouts(self, limit=50):
        return self._request("GET", f"/v1/payouts?limit={int(limit)}", retries=1)

    def create_session(self, body):
        return self._request("POST", "/api/v1/sessions", body, token=self.session_token)

    def get_session(self, reference):
        return self._request("GET", f"/api/v1/sessions/{reference}", token=self.session_token, retries=1)

    def list_sessions(self):
        return self._request("GET", "/api/v1/sessions?limit=1", token=self.session_token, retries=0)


def sign(secret, timestamp, raw_body):
    message = f"{timestamp}.".encode() + raw_body
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def verify_signature(secret, timestamp, signature, raw_body, now=None):
    """Return None when valid, or a reason string. raw_body must be the exact bytes received."""
    if not secret:
        return "no_secret"
    try:
        age = (now or time.time()) - int(timestamp)
    except (TypeError, ValueError):
        return "bad_timestamp"
    if abs(age) > WEBHOOK_TOLERANCE:
        return "stale_timestamp"
    if not signature or not hmac.compare_digest(sign(secret, timestamp, raw_body), signature):
        return "bad_signature"
    return None
