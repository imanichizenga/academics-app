"""SMS adapters, one function per provider. Each raises SmsError, or returns the provider's reply.

Beem follows docs.beem.africa/openapi/sms.json. Africa's Talking follows the official Python SDK
(africastalking-python): form-encoded POST to /version1/messaging, apiKey header.
"""
import json
import re
from urllib.parse import quote

import requests

TIMEOUT = (4, 12)
BEEM_URL = "https://apisms.beem.africa"
AT_URL = "https://api.africastalking.com"
AT_SANDBOX_URL = "https://api.sandbox.africastalking.com"
AT_OK = {100, 101, 102}  # Processed, Sent, Queued


class SmsError(Exception):
    def __init__(self, message, retryable=False):
        super().__init__(message)
        self.retryable = retryable


def _call(method, url, **kwargs):
    try:
        response = requests.request(method, url, timeout=TIMEOUT, **kwargs)
    except requests.RequestException as exc:
        raise SmsError(f"Could not reach the provider: {type(exc).__name__}", retryable=True) from exc
    if response.status_code == 429 or response.status_code >= 500:
        raise SmsError(f"Provider returned HTTP {response.status_code}", retryable=True)
    return response


def _json(response):
    try:
        data = response.json()
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def _at_base(cfg):
    return (cfg.sms_base_url or (AT_SANDBOX_URL if cfg.sms_username == "sandbox" else AT_URL)).rstrip("/")


def _beem_base(cfg):
    return (cfg.sms_base_url or BEEM_URL).rstrip("/")


def _beem(cfg, to, message):
    response = _call("POST", f"{_beem_base(cfg)}/v1/send", auth=(cfg.sms_api_key, cfg.sms_api_secret), json={
        "source_addr": cfg.sms_sender_id, "encoding": 0, "message": message,
        "recipients": [{"recipient_id": 1, "dest_addr": to}]})
    data = _json(response)
    if response.ok and data.get("successful") and data.get("code") == 100 and data.get("valid", 1) > 0:
        return f"Accepted, request {data.get('request_id', '?')}"
    raise SmsError(f"Beem refused it: {data.get('message') or data.get('error') or response.status_code}")


def _africastalking(cfg, to, message):
    form = {"username": cfg.sms_username, "to": f"+{to}", "message": message, "bulkSMSMode": 1}
    if cfg.sms_sender_id:
        form["from"] = cfg.sms_sender_id
    response = _call("POST", f"{_at_base(cfg)}/version1/messaging", data=form,
                     headers={"apiKey": cfg.sms_api_key, "Accept": "application/json"})
    if not response.ok:
        raise SmsError(f"Africa's Talking refused it: HTTP {response.status_code} {response.text[:160]}")
    body = _json(response).get("SMSMessageData") or {}
    recipients = body.get("Recipients") or []
    if not recipients:
        raise SmsError(f"Africa's Talking refused it: {body.get('Message') or 'no recipients accepted'}")
    first = recipients[0]
    if first.get("statusCode") in AT_OK:
        return f"{first.get('status', 'Accepted')}, message {first.get('messageId', '?')}"
    code = first.get("statusCode") or 0
    raise SmsError(f"Africa's Talking refused it: {first.get('status') or code}", retryable=code >= 500)


def fill(template, values, escape=None):
    """Replace known {placeholders} only. Never str.format, since admins write these strings."""
    return re.sub(r"\{(\w+)\}",
                  lambda m: (escape or str)(str(values[m[1]])) if m[1] in values else m[0], template)


def _generic(cfg, to, message):
    headers = {str(k): fill(str(v), {"api_key": cfg.sms_api_key, "api_secret": cfg.sms_api_secret})
               for k, v in (cfg.generic_headers or {}).items()}
    values = {"to": to, "message": message, "sender": cfg.sms_sender_id, "api_key": cfg.sms_api_key,
              "api_secret": cfg.sms_api_secret}
    content_type = next((v for k, v in headers.items() if k.lower() == "content-type"), "")
    escape = (lambda v: json.dumps(v)[1:-1]) if "json" in content_type.lower() else quote
    url = fill(cfg.generic_url, values, quote)
    body = fill(cfg.generic_body, values, escape).encode() if cfg.generic_body else None
    response = _call(cfg.generic_method or "POST", url, headers=headers, data=body)
    if not response.ok:
        raise SmsError(f"Provider refused it: HTTP {response.status_code} {response.text[:160]}")
    return f"HTTP {response.status_code} {response.text[:160]}"


ADAPTERS = {"beem": _beem, "africastalking": _africastalking, "generic": _generic}


def send(cfg, to, message):
    """to is 255XXXXXXXXX. Secrets are scrubbed in case a provider echoes them back."""
    try:
        return scrub(cfg, ADAPTERS[cfg.sms_provider](cfg, to, message))
    except SmsError as exc:
        raise SmsError(scrub(cfg, str(exc)), exc.retryable) from exc


def check_auth(cfg):
    """Check credentials without sending anything. Returns a short status, or None when unsupported."""
    if cfg.sms_provider == "beem":
        response = _call("GET", f"{_beem_base(cfg)}/public/v1/vendors/balance",
                         auth=(cfg.sms_api_key, cfg.sms_api_secret))
        if not response.ok:
            raise SmsError(f"Beem refused the API key and secret: HTTP {response.status_code}")
        return f"Signed in. Balance: {(_json(response).get('data') or {}).get('credit_balance', '?')} credits."
    if cfg.sms_provider == "africastalking":
        response = _call("GET", f"{_at_base(cfg)}/version1/user", params={"username": cfg.sms_username},
                         headers={"apiKey": cfg.sms_api_key, "Accept": "application/json"})
        if not response.ok:
            raise SmsError(f"Africa's Talking refused the username or API key: HTTP {response.status_code}")
        return f"Signed in. Balance: {(_json(response).get('UserData') or {}).get('balance', '?')}."
    return None


def scrub(cfg, text):
    for secret in (cfg.sms_api_key, cfg.sms_api_secret):
        if secret:
            text = text.replace(secret, "••••")
    return text[:500]
