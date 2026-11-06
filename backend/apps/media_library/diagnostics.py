"""Step-by-step storage checks, in the same one-step-per-call shape as the gateway diagnostics."""
import json
import shutil
import subprocess
import uuid

import boto3
import requests
from botocore.exceptions import BotoCoreError, ClientError
from django.conf import settings
from django.utils import timezone

from .storage import build_storage

STEPS = ["credentials", "bucket", "objects", "cors", "cloudfront", "transcoder"]
REQUIRED = ("credentials", "bucket", "objects")
TITLES = {
    "credentials": "AWS credentials are valid",
    "bucket": "Bucket exists and is reachable",
    "objects": "Write, read and delete a test object",
    "cors": "CORS allows direct browser uploads",
    "cloudfront": "CloudFront signed URLs work",
    "transcoder": "Video transcoder is available",
}


def cors_rules():
    return {"CORSRules": [{
        "AllowedOrigins": [settings.FRONTEND_URL],
        "AllowedMethods": ["GET", "PUT", "HEAD"],
        "AllowedHeaders": ["*"],
        "ExposeHeaders": ["ETag"],
        "MaxAgeSeconds": 3600,
    }]}


def result(key, status, detail, fix="", extra=None):
    return {"key": key, "title": TITLES[key], "status": status, "detail": detail, "fix": fix,
            "at": timezone.now().isoformat(), **(extra or {})}


def aws_message(exc):
    if isinstance(exc, ClientError):
        return exc.response.get("Error", {}).get("Code", "ClientError")
    return type(exc).__name__


def is_local(cfg):
    return cfg.backend != "s3"


def check_credentials(cfg):
    if is_local(cfg):
        return result("credentials", "skip", "Using local disk storage, so no credentials are needed.")
    if not cfg.aws_access_key_id or not cfg.aws_secret_access_key:
        return result("credentials", "fail", "Access key or secret is missing.", "Fill in both AWS credential fields.")
    try:
        sts = boto3.client("sts", aws_access_key_id=cfg.aws_access_key_id,
                           aws_secret_access_key=cfg.aws_secret_access_key, region_name=cfg.region or None)
        who = sts.get_caller_identity()
    except (ClientError, BotoCoreError) as exc:
        return result("credentials", "fail", f"AWS refused these credentials ({aws_message(exc)}).",
                      "Check the access key pair and that the IAM user is active.")
    return result("credentials", "ok", f"Authenticated as {who.get('Arn')}.")


def check_bucket(cfg):
    if is_local(cfg):
        return result("bucket", "skip", "Not needed for local storage.")
    if not cfg.bucket:
        return result("bucket", "fail", "No bucket name.", "Enter your private bucket name.")
    try:
        build_storage(cfg).s3.head_bucket(Bucket=cfg.bucket)
    except (ClientError, BotoCoreError) as exc:
        code = aws_message(exc)
        fix = "Create the bucket, or fix its name and region." if code in ("404", "NoSuchBucket") else (
            "Grant this user s3:ListBucket on the bucket.")
        return result("bucket", "fail", f"Cannot reach {cfg.bucket} ({code}).", fix)
    return result("bucket", "ok", f"{cfg.bucket} is reachable.")


def check_objects(cfg):
    storage = build_storage(cfg)
    key = f"diagnostics/{uuid.uuid4().hex}.txt"
    payload = b"storage diagnostics"
    try:
        storage.put_bytes(key, payload, "text/plain")
        same = storage.read_bytes(key) == payload
        storage.delete(key)
    except (ClientError, BotoCoreError, OSError) as exc:
        return result("objects", "fail", f"Failed: {aws_message(exc)}.",
                      "Grant s3:PutObject, s3:GetObject and s3:DeleteObject on the bucket.")
    if not same:
        return result("objects", "fail", "The object read back differently.", "Check the custom endpoint.")
    return result("objects", "ok", "Wrote, read and deleted a test object.")


def check_cors(cfg):
    rules = cors_rules()
    if is_local(cfg):
        return result("cors", "skip", "Local uploads go through the backend, so CORS does not apply.")
    try:
        found = build_storage(cfg).s3.get_bucket_cors(Bucket=cfg.bucket).get("CORSRules", [])
    except (ClientError, BotoCoreError) as exc:
        return result("cors", "fail", f"No CORS configuration ({aws_message(exc)}).",
                      "Apply the JSON below under Bucket → Permissions → CORS.", {"cors_json": rules})
    ok = any((settings.FRONTEND_URL in r.get("AllowedOrigins", []) or "*" in r.get("AllowedOrigins", []))
             and "PUT" in r.get("AllowedMethods", []) and "ETag" in r.get("ExposeHeaders", []) for r in found)
    if not ok:
        return result("cors", "fail", "CORS does not allow PUT with the ETag header from this site.",
                      "Apply the JSON below under Bucket → Permissions → CORS.", {"cors_json": rules})
    return result("cors", "ok", "Direct browser uploads are allowed.", extra={"cors_json": rules})


def check_cloudfront(cfg):
    if is_local(cfg) or not cfg.cloudfront_domain:
        return result("cloudfront", "skip", "CloudFront is not configured. Files use S3 signed URLs.")
    if not cfg.cloudfront_key_pair_id or not cfg.cloudfront_private_key:
        return result("cloudfront", "fail", "Key pair id or private key is missing.", "Add both from CloudFront → Key "
                                                                                      "management.")
    storage = build_storage(cfg)
    key = f"diagnostics/{uuid.uuid4().hex}.txt"
    try:
        storage.put_bytes(key, b"cloudfront", "text/plain")
        response = requests.get(storage.signed_url(key, ttl=60), timeout=15)
        storage.delete(key)
    except Exception as exc:  # key parsing, network and AWS errors all land here
        return result("cloudfront", "fail", f"Failed: {type(exc).__name__}.", "Check the private key PEM and domain.")
    if response.status_code != 200:
        return result("cloudfront", "fail", f"Signed fetch returned {response.status_code}.",
                      "Check the distribution's trusted key group and its access to the bucket.")
    return result("cloudfront", "ok", "A signed URL fetched a test object.")


def check_transcoder(cfg):
    if cfg.transcoding_engine == "ffmpeg_worker":
        if not shutil.which("ffmpeg"):
            return result("transcoder", "fail", "ffmpeg is not installed here.", "Install ffmpeg on the Celery worker.")
        version = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True, timeout=10).stdout
        return result("transcoder", "ok", version.splitlines()[0][:80] if version else "ffmpeg found.")
    if not cfg.mediaconvert_role_arn:
        return result("transcoder", "fail", "MediaConvert role ARN is missing.", "Add the IAM role MediaConvert assumes.")
    try:
        client = boto3.client("mediaconvert", aws_access_key_id=cfg.aws_access_key_id,
                              aws_secret_access_key=cfg.aws_secret_access_key,
                              region_name=cfg.mediaconvert_region or cfg.region)
        endpoints = client.describe_endpoints(MaxResults=1).get("Endpoints", [])
    except (ClientError, BotoCoreError) as exc:
        return result("transcoder", "fail", f"MediaConvert refused ({aws_message(exc)}).",
                      "Grant mediaconvert:DescribeEndpoints and mediaconvert:CreateJob.")
    return result("transcoder", "ok", f"MediaConvert reachable at {endpoints[0]['Url'] if endpoints else 'default'}.")


CHECKS = {"credentials": check_credentials, "bucket": check_bucket, "objects": check_objects, "cors": check_cors,
          "cloudfront": check_cloudfront, "transcoder": check_transcoder}


def run_step(cfg, key):
    outcome = CHECKS[key](cfg)
    report = {} if key == STEPS[0] else dict(cfg.last_test_report or {})
    report[key] = outcome
    fields = {"last_test_report": report}
    if key == STEPS[-1]:
        passed = all(report.get(k, {}).get("status") in ("ok", "skip") for k in REQUIRED)
        fields.update(last_tested_at=timezone.now(), last_test_status="passed" if passed else "failed")
    type(cfg).objects.filter(pk=cfg.pk).update(**fields)
    for name, value in fields.items():
        setattr(cfg, name, value)
    return outcome


__all__ = ["json"]
