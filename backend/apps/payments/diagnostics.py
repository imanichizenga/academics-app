"""Step-by-step gateway checks. The UI calls one step at a time, so each result shows live."""
import json
import logging
import time
import uuid
from urllib.parse import urlparse

import requests
from django.conf import settings
from django.utils import timezone

from . import services
from .models import PaymentGatewayConfig
from .snippe import SnippeClient, SnippeError, sign

log = logging.getLogger(__name__)
STEPS = ["config", "auth", "probe", "webhook", "hosted"]
REQUIRED = ("config", "auth", "probe")
TITLES = {
    "config": "Configuration is complete",
    "auth": "Connect and authenticate",
    "probe": "Permission to create payments",
    "webhook": "Webhook signature self-test",
    "hosted": "Hosted checkout (optional)",
}


def result(key, status, detail, fix=""):
    return {"key": key, "title": TITLES[key], "status": status, "detail": detail, "fix": fix,
            "at": timezone.now().isoformat()}


def check_config(cfg):
    problems = []
    if not cfg.api_key:
        problems.append("API key is missing")
    elif not cfg.api_key.startswith("snp_"):
        problems.append("API key should start with snp_")
    if not cfg.webhook_secret:
        problems.append("Webhook signing secret is missing")
    parsed = urlparse(cfg.api_base_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        problems.append("API base URL is not a valid URL")
    if problems:
        return result("config", "fail", "; ".join(problems),
                      "Create a key in the Snippe dashboard under Settings → API Keys, and copy the secret from "
                      "Settings → Webhook Secret.")
    return result("config", "ok", "API key, webhook secret and URL look right.")


def check_auth(cfg):
    try:
        data = SnippeClient(cfg).balance()
    except SnippeError as exc:
        if exc.status == 401:
            return result("auth", "fail", "API key invalid or expired.",
                          "Create a new key in the dashboard. Test keys do not work against production.")
        if exc.status == 403:
            return result("auth", "fail", "Key lacks the collection:read scope.",
                          "Create a key with the collection:read and collection:create scopes.")
        return result("auth", "fail", str(exc), "Check the base URL, and https://snippe-status.instatus.com/ for outages.")
    available = data.get("available") or {}
    return result("auth", "ok", f"Connected. Available balance: {available.get('currency', 'TZS')} "
                                f"{available.get('value', 0):,}.")


def check_probe(cfg):
    """Sends a deliberately invalid body. Snippe rejects it during validation, so no money can move."""
    try:
        data = SnippeClient(cfg).create_payment({"payment_type": "mobile"}, f"probe{uuid.uuid4().hex[:24]}")
    except SnippeError as exc:
        if exc.status == 400 or exc.error_code == "validation_error":
            return result("probe", "ok", "Snippe rejected our test body as invalid, which proves the key may create "
                                         "payments. No payment was made.")
        if exc.status == 403:
            return result("probe", "fail", "Key lacks the collection:create scope.",
                          "Create a key with the collection:create scope.")
        if exc.status == 401:
            return result("probe", "fail", "API key invalid or expired.", "Replace the API key.")
        return result("probe", "warn", f"Unexpected response ({exc.status}: {exc.error_code}). The scope could not be "
                                       "confirmed.", "Use the live test payment below to confirm.")
    return result("probe", "warn", f"Snippe accepted an invalid body (reference {data.get('reference')}). The behaviour "
                                   "differs from the docs.", "Check this reference in the dashboard.")


def check_webhook(cfg):
    body = json.dumps({"id": f"evt_selftest_{uuid.uuid4().hex[:12]}", "type": "diagnostic.ping",
                       "api_version": "2026-01-25", "data": {}}).encode()
    timestamp = str(int(time.time()))
    url = services.webhook_url()
    host = urlparse(url).hostname or ""
    try:
        response = requests.post(url, data=body, timeout=10, headers={
            "Content-Type": "application/json", "X-Webhook-Event": "diagnostic.ping",
            "X-Webhook-Timestamp": timestamp, "X-Webhook-Signature": sign(cfg.webhook_secret, timestamp, body),
        })
    except requests.RequestException as exc:
        return result("webhook", "fail", f"Could not reach {url}: {type(exc).__name__}.",
                      "Check PUBLIC_API_URL, and that the backend is reachable at that address.")
    if response.status_code != 200:
        return result("webhook", "fail", f"The endpoint answered {response.status_code}, so the signature did not "
                                         "verify.", "Check that the stored secret matches the Snippe dashboard.")
    if host in ("localhost", "127.0.0.1") or host.endswith(".local"):
        return result("webhook", "warn", "The signature verifies, but this address is not public, so Snippe cannot "
                                         "reach it.", "Set PUBLIC_API_URL to your public HTTPS address before going live.")
    return result("webhook", "ok", f"The signature verifies at {url}.")


def check_hosted(cfg):
    """The docs describe a JWT for sessions, so whether a snp_ key works is settled here, at runtime."""
    if cfg.default_method == PaymentGatewayConfig.Method.USSD and not cfg.session_token:
        return result("hosted", "skip", "Not in use. Customers pay by USSD push.")
    try:
        SnippeClient(cfg).list_sessions()
    except SnippeError as exc:
        return result("hosted", "warn", f"Sessions refused this credential ({exc.status}). Hosted checkout stays off "
                                        "and customers use USSD push.", "Add a session JWT from Snippe, then test again.")
    return result("hosted", "ok", "Sessions accepted this credential, so hosted checkout is available.")


CHECKS = {"config": check_config, "auth": check_auth, "probe": check_probe, "webhook": check_webhook,
          "hosted": check_hosted}


def run_step(cfg, key):
    outcome = CHECKS[key](cfg)
    report = cfg.last_test_report if key != "config" else {}
    report = {**(report or {}), key: outcome}
    cfg.last_test_report = report
    fields = ["last_test_report"]
    if key == STEPS[-1]:
        passed = all(report.get(k, {}).get("status") in ("ok", "warn") for k in REQUIRED)
        if not all(report.get(k, {}).get("status") == "ok" for k in ("config", "auth")):
            passed = False
        report["hosted_checkout_ok"] = report.get("hosted", {}).get("status") == "ok"
        cfg.last_tested_at = timezone.now()
        cfg.last_test_status = "passed" if passed else "failed"
        if not passed:
            cfg.is_enabled = False
            fields.append("is_enabled")
        fields += ["last_tested_at", "last_test_status"]
    cfg.save(update_fields=fields)
    return outcome


__all__ = ["settings"]
