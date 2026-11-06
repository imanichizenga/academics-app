import boto3
import pytest
import responses
from moto import mock_aws

from apps.media_library import diagnostics as storage_diag
from apps.media_library.models import StorageConfig
from apps.payments import diagnostics as d
from apps.payments.models import PaymentGatewayConfig

API = "https://api.snippe.sh"


@pytest.fixture
def cfg(gateway):
    gateway.last_test_status = ""
    gateway.is_enabled = False
    gateway.save()
    return gateway


def test_config_step_reports_each_problem():
    cfg = PaymentGatewayConfig.load()
    cfg.api_key = "wrong"
    out = d.check_config(cfg)
    assert out["status"] == "fail" and "snp_" in out["detail"] and "secret" in out["detail"]


@responses.activate
@pytest.mark.parametrize("status,needle", [(401, "invalid or expired"), (403, "collection:read")])
def test_auth_failures_have_clear_messages(cfg, status, needle):
    responses.get(f"{API}/v1/payments/balance", status=status, json={"status": "error", "code": status, "message": "x"})
    assert needle in d.check_auth(cfg)["detail"]


@responses.activate
def test_auth_shows_balance(cfg):
    responses.get(f"{API}/v1/payments/balance", json={"status": "success", "data": {
        "available": {"currency": "TZS", "value": 6943}}})
    out = d.check_auth(cfg)
    assert out["status"] == "ok" and "6,943" in out["detail"]


@responses.activate
@pytest.mark.parametrize("status,code,expected", [
    (400, "validation_error", "ok"), (403, "insufficient_scope", "fail"), (409, "conflict", "warn")])
def test_create_probe(cfg, status, code, expected):
    responses.post(f"{API}/v1/payments", status=status, json={"status": "error", "code": status, "error_code": code,
                                                              "message": "x"})
    assert d.check_probe(cfg)["status"] == expected


def run_all(cfg):
    return [d.run_step(cfg, step)["status"] for step in d.STEPS]


@responses.activate
def test_failed_test_disables_gateway(cfg):
    cfg.is_enabled = True
    cfg.save()
    responses.get(f"{API}/v1/payments/balance", status=401, json={"status": "error", "message": "x"})
    responses.post(f"{API}/v1/payments", status=401, json={"status": "error", "message": "x"})
    responses.post("http://localhost:8000/api/payments/webhooks/snippe/", status=200, json={})
    run_all(cfg)
    cfg.refresh_from_db()
    assert cfg.last_test_status == "failed" and not cfg.is_enabled and not cfg.checkout_available


@responses.activate
def test_passing_test_allows_enable_and_local_url_warns(cfg, client, admin):
    responses.get(f"{API}/v1/payments/balance", json={"status": "success", "data": {"available": {"value": 1}}})
    responses.post(f"{API}/v1/payments", status=400, json={"status": "error", "error_code": "validation_error"})
    responses.post("http://localhost:8000/api/payments/webhooks/snippe/", status=200, json={})
    client.login_as(admin)
    res = client.patch("/api/v1/admin/settings/payments/", {"is_enabled": True}, format="json")
    assert res.status_code == 409  # not tested yet
    statuses = run_all(cfg)
    assert statuses == ["ok", "ok", "ok", "warn", "skip"]
    res = client.patch("/api/v1/admin/settings/payments/", {"is_enabled": True}, format="json")
    assert res.status_code == 200 and res.data["checkout_available"]


def test_webhook_selftest_against_real_view(cfg, client, monkeypatch):
    """Exercise the actual endpoint, so a verification regression fails this test."""
    def post(url, data, timeout, headers):
        class R:
            status_code = client.generic(
                "POST", "/api/payments/webhooks/snippe/", data, content_type="application/json",
                HTTP_X_WEBHOOK_TIMESTAMP=headers["X-Webhook-Timestamp"],
                HTTP_X_WEBHOOK_SIGNATURE=headers["X-Webhook-Signature"]).status_code
        return R

    monkeypatch.setattr(d.requests, "post", post)
    assert d.check_webhook(cfg)["status"] == "warn"  # verified, but localhost is not public


def test_new_key_clears_passed_state(gateway, client, admin):
    client.login_as(admin)
    res = client.patch("/api/v1/admin/settings/payments/", {"api_key": "snp_new_key"}, format="json")
    assert res.data["checkout_available"] is False and res.data["last_test_status"] == ""
    assert res.data["api_key_masked"].endswith("_key")


def test_secrets_never_returned_and_encrypted_at_rest(gateway, client, admin):
    from django.db import connection

    res = client.login_as(admin).get("/api/v1/admin/settings/payments/")
    assert "api_key" not in res.data and "webhook_secret" not in res.data
    assert "snp_test_key" not in str(res.data) and "whsec_test" not in str(res.data)
    with connection.cursor() as cur:
        cur.execute("select api_key, webhook_secret from payments_paymentgatewayconfig")
        raw = cur.fetchone()
    assert "snp_test_key" not in raw[0] and "whsec_test" not in raw[1]


def test_saving_blank_secret_keeps_old_one(gateway, client, admin):
    client.login_as(admin).patch("/api/v1/admin/settings/payments/", {"api_key": "", "mode_label": "live"}, format="json")
    gateway.refresh_from_db()
    assert gateway.api_key == "snp_test_key" and gateway.mode_label == "live"


def s3_config(**extra):
    cfg = StorageConfig.objects.get_or_create(pk=1)[0]
    cfg.backend, cfg.bucket, cfg.region = "s3", "private-bucket", "us-east-1"
    cfg.aws_access_key_id, cfg.aws_secret_access_key = "AKIA123", "secret"
    for key, value in extra.items():
        setattr(cfg, key, value)
    cfg.save()
    return cfg


@mock_aws
def test_s3_checks_pass_and_cors_is_detected():
    s3 = boto3.client("s3", region_name="us-east-1", aws_access_key_id="x", aws_secret_access_key="y")
    s3.create_bucket(Bucket="private-bucket")
    cfg = s3_config()
    assert storage_diag.check_credentials(cfg)["status"] == "ok"
    assert storage_diag.check_bucket(cfg)["status"] == "ok"
    assert storage_diag.check_objects(cfg)["status"] == "ok"
    missing = storage_diag.check_cors(cfg)
    assert missing["status"] == "fail" and "CORSRules" in missing["cors_json"]
    s3.put_bucket_cors(Bucket="private-bucket", CORSConfiguration=storage_diag.cors_rules())
    assert storage_diag.check_cors(cfg)["status"] == "ok"


@mock_aws
def test_missing_bucket_fails():
    assert storage_diag.check_bucket(s3_config())["status"] == "fail"


def test_local_storage_passes_out_of_the_box():
    cfg = StorageConfig.objects.get_or_create(pk=1)[0]
    statuses = [storage_diag.run_step(cfg, s)["status"] for s in storage_diag.STEPS]
    assert statuses == ["skip", "skip", "ok", "skip", "skip", "ok"]
    assert cfg.last_test_status == "passed"


@mock_aws
def test_multipart_upload_through_s3_storage():
    from apps.media_library.storage import build_storage

    boto3.client("s3", region_name="us-east-1", aws_access_key_id="x", aws_secret_access_key="y").create_bucket(
        Bucket="private-bucket")
    storage = build_storage(s3_config())
    upload = storage.create_multipart("uploads/a.pdf", "application/pdf")
    etag = storage.s3.upload_part(Bucket="private-bucket", Key="uploads/a.pdf", UploadId=upload, PartNumber=1,
                                  Body=b"%PDF-1.7 " * 10)["ETag"]
    storage.complete_multipart("uploads/a.pdf", upload, [{"PartNumber": 1, "ETag": etag}])
    assert storage.size("uploads/a.pdf") == 90
    assert "X-Amz-Signature" in storage.signed_url("uploads/a.pdf", "a.pdf", attachment=True)
