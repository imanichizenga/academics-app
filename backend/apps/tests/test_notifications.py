import json
import threading
from datetime import timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest import mock

import pytest
import responses
from django.core import mail
from django.core.cache import cache
from django.utils import timezone

from apps.accounts.models import User
from apps.core import notifications, sms
from apps.core.models import NotificationConfig, NotificationLog, NotificationTemplate
from apps.payments import services, tasks
from apps.payments.models import Entitlement, Order

from .conftest import completed_event, webhook_post

TO = "255713456789"


def configure(**extra):
    cfg = NotificationConfig.load()
    for key, value in {"sms_enabled": True, "sms_provider": "beem", "sms_api_key": "beem-key", "sms_api_secret": "beem-secret",
                       "sms_sender_id": "DARASA", **extra}.items():
        setattr(cfg, key, value)
    cfg.save()
    return cfg


@responses.activate
def test_beem_adapter_matches_the_documented_request():
    responses.post("https://apisms.beem.africa/v1/send", json={
        "successful": True, "request_id": "r1", "code": 100, "message": "ok", "valid": 1, "invalid": 0, "duplicates": 0,
        "opted_out": 0, "total_validated": 1})
    assert "r1" in sms.send(configure(), TO, "Hello")
    call = responses.calls[0].request
    assert json.loads(call.body) == {"source_addr": "DARASA", "encoding": 0, "message": "Hello",
                                     "recipients": [{"recipient_id": 1, "dest_addr": TO}]}
    assert call.headers["Authorization"].startswith("Basic ")


@responses.activate
def test_beem_refusal_is_not_retried():
    responses.post("https://apisms.beem.africa/v1/send", status=400, json={"code": 111, "message": "Invalid Sender ID"})
    with pytest.raises(sms.SmsError) as exc:
        sms.send(configure(), TO, "Hello")
    assert "Invalid Sender ID" in str(exc.value) and not exc.value.retryable


@responses.activate
def test_africastalking_adapter():
    responses.post("https://api.africastalking.com/version1/messaging", status=201, json={"SMSMessageData": {
        "Message": "Sent to 1/1", "Recipients": [{"statusCode": 101, "number": f"+{TO}", "status": "Success",
                                                  "messageId": "ATX1"}]}})
    cfg = configure(sms_provider="africastalking", sms_username="darasa", sms_api_key="at-key")
    assert "ATX1" in sms.send(cfg, TO, "Habari")
    call = responses.calls[0].request
    assert call.headers["apiKey"] == "at-key"
    assert "to=%2B255713456789" in call.body and "from=DARASA" in call.body and "username=darasa" in call.body


@responses.activate
def test_africastalking_sandbox_host_and_failure():
    responses.post("https://api.sandbox.africastalking.com/version1/messaging", status=201, json={"SMSMessageData": {
        "Message": "Sent to 0/1", "Recipients": [{"statusCode": 403, "status": "InvalidPhoneNumber"}]}})
    cfg = configure(sms_provider="africastalking", sms_username="sandbox")
    with pytest.raises(sms.SmsError) as exc:
        sms.send(cfg, TO, "x")
    assert "InvalidPhoneNumber" in str(exc.value)


@responses.activate
def test_generic_adapter_escapes_json_and_fills_headers():
    responses.post("https://sms.example.com/send", json={"ok": True})
    cfg = configure(sms_provider="generic", generic_url="https://sms.example.com/send", generic_method="POST",
                    generic_headers={"Content-Type": "application/json", "X-Key": "{api_key}"},
                    generic_body='{"to": "{to}", "text": "{message}", "from": "{sender}"}')
    sms.send(cfg, TO, 'Say "hi"\nnow')
    call = responses.calls[0].request
    assert call.headers["X-Key"] == "beem-key"
    assert json.loads(call.body) == {"to": TO, "text": 'Say "hi"\nnow', "from": "DARASA"}


@responses.activate
def test_generic_adapter_url_encodes_query_values():
    responses.get("https://sms.example.com/send", body="OK")
    cfg = configure(sms_provider="generic", generic_method="GET", generic_body="",
                    generic_url="https://sms.example.com/send?to={to}&text={message}")
    sms.send(cfg, TO, "a&b=c d")
    assert responses.calls[0].request.url.endswith("text=a%26b%3Dc%20d")


@responses.activate
def test_a_key_echoed_by_a_provider_never_reaches_the_log():
    responses.post("https://sms.example.com/send", status=400, body="bad key beem-key")
    cfg = configure(sms_provider="generic", generic_url="https://sms.example.com/send", generic_method="POST")
    with pytest.raises(sms.SmsError) as exc:
        sms.send(cfg, TO, "x")
    assert "beem-key" not in str(exc.value)


def test_template_fill_ignores_unknown_and_attribute_syntax():
    assert sms.fill("{a} {b} {a.__class__}", {"a": 1}) == "1 {b} {a.__class__}"


# ---------- notify ----------
@responses.activate
def test_notify_logs_a_sent_message_and_clears_the_text():
    responses.post("https://apisms.beem.africa/v1/send", json={
        "successful": True, "request_id": "r1", "code": 100, "message": "ok", "valid": 1})
    configure()
    notifications.notify("otp_code", phone=TO, code="123456")
    row = NotificationLog.objects.get()
    assert (row.status, row.template, row.channel) == ("sent", "otp_code", "sms")
    assert row.recipient_masked == "255713•••89" and TO not in row.recipient_masked
    assert row.pending_body == "" and row.pending_to == ""
    assert "123456" in json.loads(responses.calls[0].request.body)["message"]
    assert "123456" not in row.provider_response


def test_notify_when_disabled_logs_a_skip_and_sends_nothing():
    with mock.patch("apps.core.sms.requests.request") as call:
        notifications.notify("otp_code", phone=TO, code="123456")
    call.assert_not_called()
    assert NotificationLog.objects.get().status == "skipped"


@responses.activate
def test_transient_failures_retry_then_succeed():
    url = "https://apisms.beem.africa/v1/send"
    responses.post(url, status=503)
    responses.post(url, json={"successful": True, "request_id": "r2", "code": 100, "message": "ok", "valid": 1})
    configure()
    notifications.notify("otp_code", phone=TO, code="1")
    row = NotificationLog.objects.get()
    assert row.status == "sent" and row.attempts == 2


@responses.activate
def test_failure_after_all_retries_is_recorded():
    responses.post("https://apisms.beem.africa/v1/send", status=503)
    configure()
    notifications.notify("otp_code", phone=TO, code="1")
    row = NotificationLog.objects.get()
    assert row.status == "failed" and row.attempts == 5 and "503" in row.provider_response
    assert row.pending_body == ""


def test_a_queue_outage_cannot_fail_the_caller():
    configure()
    with mock.patch("apps.core.tasks.deliver_notification.delay", side_effect=ConnectionError):
        notifications.notify("otp_code", phone=TO, code="1")
    assert NotificationLog.objects.get().status == "failed"


def test_language_picks_the_kiswahili_template():
    configure()
    with mock.patch("apps.core.notifications._queue") as queue:
        notifications.notify("otp_code", phone=TO, language="sw", code="9")
    assert "msimbo" in queue.call_args.args[4]


def test_disabled_template_sends_nothing():
    configure()
    template = notifications.template_for("otp_code")
    template.is_enabled = False
    template.save()
    notifications.notify("otp_code", phone=TO, code="1")
    assert not NotificationLog.objects.exists()


def test_email_uses_the_stored_smtp_settings():
    cfg = configure(email_enabled=True, smtp_host="mail.example.com", email_from_address="hello@example.com",
                    email_from_name="Darasa", smtp_password="pw")
    with mock.patch("apps.core.notifications.get_connection") as get:
        assert "Accepted" in notifications.send_email(cfg, "a@example.com", "Hi", "Body")
    assert get.call_args.kwargs["host"] == "mail.example.com" and get.call_args.kwargs["use_tls"] is True
    assert get.return_value.send_messages.call_args.args[0][0].from_email == '"Darasa" <hello@example.com>'
    assert mail.outbox == []


# ---------- flows ----------
def test_otp_flow_end_to_end(client, student):
    configure()
    sent = {}
    with mock.patch("apps.core.sms.send", side_effect=lambda cfg, to, text: sent.update(to=to, text=text) or "ok"):
        assert client.get("/api/v1/auth/otp/request/").data["available"] is True
        assert client.post("/api/v1/auth/otp/request/", {"phone": student.phone}, format="json").status_code == 200
    code = sent["text"].split("code is ")[1][:6]
    response = client.post("/api/v1/auth/otp/confirm/", {"phone": student.phone, "code": code,
                                                         "new_password": "brand-new-pass-7"}, format="json")
    assert response.status_code == 200
    assert client.post("/api/v1/auth/login/", {"phone": student.phone, "password": "brand-new-pass-7"},
                       format="json").status_code == 200


def test_otp_unavailable_without_sms(client):
    assert client.get("/api/v1/auth/otp/request/").data["available"] is False


def test_completed_payment_sends_receipt_and_account_message(client, gateway, paid, django_capture_on_commit_callbacks):
    configure()
    (order, _), _ = services.create_order(order_type="content_purchase", phone=TO, first_name="A", last_name="B",
                                          content=paid, language="sw")
    Order.objects.filter(pk=order.pk).update(snippe_reference="ref1")
    with mock.patch("apps.core.sms.send", return_value="ok") as send, django_capture_on_commit_callbacks(execute=True):
        webhook_post(client, completed_event("ref1", order.amount))
    bodies = [call.args[2] for call in send.call_args_list]
    assert len(bodies) == 2
    assert f"/library/receipts/{order.pk}" in bodies[0] and "yamepokelewa" in bodies[0]
    assert "0713456789" in bodies[1] and "/login" in bodies[1]
    assert set(NotificationLog.objects.values_list("template", flat=True)) == {"payment_receipt", "account_created"}
    assert User.objects.get(username=TO).language == "sw"


def subscription(user, days):
    return Entitlement.objects.create(user=user, kind="subscription", expires_at=timezone.now() + timedelta(days=days))


def test_expiry_reminder_uses_configured_days(student):
    configure(reminder_days=5)
    subscription(student, 4)
    with mock.patch("apps.core.notifications.notify") as notify:
        tasks.send_expiry_reminders()
        tasks.send_expiry_reminders()
    notify.assert_called_once()
    assert notify.call_args.args[0] == "subscription_ending"


def test_renewed_subscriber_gets_no_ending_or_ended_message(student):
    configure()
    subscription(student, 2)
    subscription(student, 32)
    with mock.patch("apps.core.notifications.notify") as notify:
        tasks.send_expiry_reminders()
    assert notify.call_count == 0
    lapsed = Entitlement.objects.filter(user=student).order_by("expires_at").first()
    Entitlement.objects.filter(pk=lapsed.pk).update(expires_at=timezone.now() - timedelta(minutes=1))
    with mock.patch("apps.core.notifications.notify") as notify:
        tasks.expire_entitlements()
    notify.assert_not_called()


def test_subscription_ended_message(student):
    configure()
    entitlement = subscription(student, 1)
    Entitlement.objects.filter(pk=entitlement.pk).update(expires_at=timezone.now() - timedelta(minutes=1))
    with mock.patch("apps.core.notifications.notify") as notify:
        tasks.expire_entitlements()
    assert notify.call_args.args[0] == "subscription_ended"


# ---------- admin ----------
def test_secrets_are_encrypted_and_never_returned(client, admin):
    client.login_as(admin)
    response = client.patch("/api/v1/admin/settings/notifications/", {
        "sms_api_key": "super-secret-key", "smtp_password": "mail-password"}, format="json")
    text = json.dumps(response.data, default=str)
    assert "super-secret-key" not in text and "mail-password" not in text
    assert response.data["sms_api_key_masked"].endswith("-key")
    from django.db import connection

    with connection.cursor() as cursor:
        cursor.execute("select sms_api_key, smtp_password from core_notificationconfig")
        raw = " ".join(cursor.fetchone())
    assert "super-secret-key" not in raw and "mail-password" not in raw
    assert cache.get("singleton:NotificationConfig") is None


def test_blank_secret_keeps_the_old_one(client, admin):
    configure()
    client.login_as(admin)
    client.patch("/api/v1/admin/settings/notifications/", {"sms_api_key": ""}, format="json")
    assert NotificationConfig.load().sms_api_key == "beem-key"


def test_notification_settings_are_admin_only(client, editor, student):
    for user in (editor, student):
        client.login_as(user)
        assert client.get("/api/v1/admin/settings/notifications/").status_code == 403
        assert client.get("/api/v1/admin/notification-logs/").status_code == 403


def test_template_edit_rejects_unknown_placeholder(client, admin):
    client.login_as(admin)
    response = client.patch("/api/v1/admin/settings/notifications/templates/", {
        "key": "otp_code", "body_en": "Code {code} {secret_thing}"}, format="json")
    assert response.status_code == 400 and "secret_thing" in response.data["error"]["message"]
    ok = client.patch("/api/v1/admin/settings/notifications/templates/", {
        "key": "otp_code", "body_en": "Your code: {code}"}, format="json")
    assert ok.status_code == 200
    assert NotificationTemplate.objects.get(key="otp_code").body_en == "Your code: {code}"


def test_log_lists_masked_rows_only(client, admin):
    notifications.notify("otp_code", phone=TO, code="654321")
    client.login_as(admin)
    response = client.get("/api/v1/admin/notification-logs/")
    assert response.data["count"] == 1
    text = json.dumps(response.data, default=str)
    assert TO not in text and "654321" not in text and "pending" not in text


class MockGateway(BaseHTTPRequestHandler):
    received = []

    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        MockGateway.received.append(body.decode())
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"ok": true}')

    def log_message(self, *args):
        pass


@pytest.fixture
def mock_server():
    MockGateway.received = []
    server = HTTPServer(("127.0.0.1", 0), MockGateway)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()


def run_all(client, channel, to, steps):
    return {s: client.post("/api/v1/admin/settings/notifications/test/", {"channel": channel, "step": s, "to": to},
                           format="json").data["step"] for s in steps}


def test_admin_test_button_against_a_mock_http_server(client, admin, mock_server):
    client.login_as(admin)
    client.patch("/api/v1/admin/settings/notifications/", {
        "sms_provider": "generic", "generic_url": f"{mock_server}/sms", "generic_method": "POST",
        "generic_headers": {"Content-Type": "application/json"}, "generic_body": '{"to":"{to}","text":"{message}"}',
    }, format="json")
    result = run_all(client, "sms", "0713 456 789", ["config", "auth", "send"])
    assert [r["status"] for r in result.values()] == ["ok", "skip", "ok"]
    assert json.loads(MockGateway.received[0])["to"] == TO
    cfg = NotificationConfig.load()
    assert cfg.sms_test_status == "passed" and cfg.sms_tested_at
    assert NotificationLog.objects.get(template="test").status == "sent"


def test_test_button_reports_a_bad_setup(client, admin):
    client.login_as(admin)
    result = run_all(client, "sms", TO, ["config"])
    assert result["config"]["status"] == "fail" and "API key" in result["config"]["detail"]


@responses.activate
def test_beem_auth_step_reads_balance(client, admin):
    responses.get("https://apisms.beem.africa/public/v1/vendors/balance", json={"data": {"credit_balance": 42.0}})
    configure()
    client.login_as(admin)
    result = run_all(client, "sms", TO, ["auth"])
    assert result["auth"]["status"] == "ok" and "42" in result["auth"]["detail"]


def test_email_test_reports_connection_failure(client, admin):
    cfg = configure(smtp_host="127.0.0.1", smtp_port=1, email_from_address="a@example.com")
    assert cfg
    client.login_as(admin)
    result = run_all(client, "email", "a@example.com", ["config", "connect"])
    assert result["config"]["status"] == "ok" and result["connect"]["status"] == "fail"
    assert result["connect"]["fix"]
