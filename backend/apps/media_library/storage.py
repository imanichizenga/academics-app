"""Runtime storage clients, built from StorageConfig. No credentials live in settings.py."""
import hashlib
import os
import shutil
import threading
import time
from datetime import datetime, timedelta, timezone as dt_tz
from pathlib import Path
from urllib.parse import quote

import boto3
from botocore.config import Config
from botocore.signers import CloudFrontSigner
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from django.conf import settings
from django.core import signing

from .models import StorageConfig

_lock = threading.Lock()
_cached = (None, None)
FILE_SALT = "media-file"
PART_SALT = "media-part"


def sign_token(payload, salt=FILE_SALT, ttl=300):
    return signing.dumps({**payload, "exp": int(time.time()) + ttl}, salt=salt, compress=True)


def read_token(token, salt=FILE_SALT):
    data = signing.loads(token, salt=salt)
    if data.get("exp", 0) < time.time():
        raise signing.BadSignature("expired")
    return data


class LocalStorage:
    name = "local"
    part_size = 8 * 1024 * 1024

    def __init__(self, config):
        self.config = config
        self.root = Path(settings.MEDIA_DATA_ROOT)
        self.ttl = config.signed_url_ttl

    def _path(self, key):
        path = (self.root / key).resolve()
        if not str(path).startswith(str(self.root.resolve()) + os.sep):
            raise ValueError("bad key")
        return path

    def put_bytes(self, key, data, content_type="", public=False):
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def put_file(self, key, source, content_type="", public=False):
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, path)

    def read_bytes(self, key, length=None, public=False):
        with open(self._path(key), "rb") as fh:
            return fh.read(length) if length else fh.read()

    def download_to(self, key, dest):
        shutil.copyfile(self._path(key), dest)

    def size(self, key):
        return self._path(key).stat().st_size

    def exists(self, key, public=False):
        return self._path(key).exists()

    def delete(self, key, public=False):
        self._path(key).unlink(missing_ok=True)

    def delete_prefix(self, prefix):
        shutil.rmtree(self._path(prefix), ignore_errors=True)

    def local_path(self, key):
        return self._path(key)

    def _tmp(self, upload_id):
        return self.root / "tmp_uploads" / upload_id

    def create_multipart(self, key, mime):
        upload_id = hashlib.sha256(os.urandom(16)).hexdigest()[:32]
        self._tmp(upload_id).mkdir(parents=True)
        return upload_id

    def presign_part(self, key, upload_id, part_number):
        token = sign_token({"u": upload_id, "n": part_number}, PART_SALT, 3600 * 6)
        return f"/api/v1/media/local-part/{token}/"

    def store_part(self, upload_id, number, data):
        tmp = self._tmp(upload_id)
        if not tmp.is_dir():
            raise FileNotFoundError("upload")
        (tmp / f"{number:06d}").write_bytes(data)
        return hashlib.md5(data, usedforsecurity=False).hexdigest()

    def complete_multipart(self, key, upload_id, parts):
        tmp = self._tmp(upload_id)
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "wb") as out:
            for part in sorted(parts, key=lambda p: p["PartNumber"]):
                with open(tmp / f"{part['PartNumber']:06d}", "rb") as fh:
                    shutil.copyfileobj(fh, out)
        shutil.rmtree(tmp, ignore_errors=True)

    def abort_multipart(self, key, upload_id):
        shutil.rmtree(self._tmp(upload_id), ignore_errors=True)

    def signed_url(self, key, filename=None, attachment=False, mime="", ttl=None):
        token = sign_token({"k": key, "f": filename, "a": attachment, "m": mime}, ttl=ttl or self.ttl)
        return f"/api/v1/media/file/{token}/"

    def public_url(self, key):
        return f"/api/v1/media/public/{quote(key)}" if key else ""


class S3Storage:
    name = "s3"
    part_size = 16 * 1024 * 1024

    def __init__(self, config):
        self.config = config
        self.ttl = config.signed_url_ttl
        self.prefix = config.key_prefix.strip("/")
        self.session = boto3.session.Session(
            aws_access_key_id=config.aws_access_key_id or None,
            aws_secret_access_key=config.aws_secret_access_key or None,
            region_name=config.region or None,
        )
        self.s3 = self.session.client(
            "s3", endpoint_url=config.endpoint_url or None,
            config=Config(signature_version="s3v4", retries={"max_attempts": 3, "mode": "standard"}),
        )
        self.bucket = config.bucket

    def _k(self, key):
        return f"{self.prefix}/{key}" if self.prefix else key

    def _target(self, key, public):
        return (self.config.public_bucket if public and self.config.public_bucket else self.bucket), self._k(key)

    def put_bytes(self, key, data, content_type="", public=False):
        bucket, k = self._target(key, public)
        extra = {"ContentType": content_type} if content_type else {}
        self.s3.put_object(Bucket=bucket, Key=k, Body=data, **extra)

    def put_file(self, key, source, content_type="", public=False):
        bucket, k = self._target(key, public)
        self.s3.upload_file(str(source), bucket, k, ExtraArgs={"ContentType": content_type} if content_type else None)

    def read_bytes(self, key, length=None, public=False):
        bucket, k = self._target(key, public)
        args = {"Range": f"bytes=0-{length - 1}"} if length else {}
        return self.s3.get_object(Bucket=bucket, Key=k, **args)["Body"].read()

    def download_to(self, key, dest):
        self.s3.download_file(self.bucket, self._k(key), str(dest))

    def size(self, key):
        return self.s3.head_object(Bucket=self.bucket, Key=self._k(key))["ContentLength"]

    def exists(self, key, public=False):
        bucket, k = self._target(key, public)
        try:
            self.s3.head_object(Bucket=bucket, Key=k)
            return True
        except self.s3.exceptions.ClientError:
            return False

    def delete(self, key, public=False):
        bucket, k = self._target(key, public)
        self.s3.delete_object(Bucket=bucket, Key=k)

    def delete_prefix(self, prefix):
        pages = self.s3.get_paginator("list_objects_v2").paginate(Bucket=self.bucket, Prefix=self._k(prefix))
        for page in pages:
            keys = [{"Key": o["Key"]} for o in page.get("Contents", [])]
            if keys:
                self.s3.delete_objects(Bucket=self.bucket, Delete={"Objects": keys})

    def local_path(self, key):
        return None

    def create_multipart(self, key, mime):
        return self.s3.create_multipart_upload(Bucket=self.bucket, Key=self._k(key), ContentType=mime)["UploadId"]

    def presign_part(self, key, upload_id, part_number):
        return self.s3.generate_presigned_url(
            "upload_part",
            Params={"Bucket": self.bucket, "Key": self._k(key), "UploadId": upload_id, "PartNumber": part_number},
            ExpiresIn=3600 * 6,
        )

    def complete_multipart(self, key, upload_id, parts):
        ordered = sorted(({"PartNumber": p["PartNumber"], "ETag": p["ETag"]} for p in parts),
                         key=lambda p: p["PartNumber"])
        self.s3.complete_multipart_upload(Bucket=self.bucket, Key=self._k(key), UploadId=upload_id,
                                          MultipartUpload={"Parts": ordered})

    def abort_multipart(self, key, upload_id):
        self.s3.abort_multipart_upload(Bucket=self.bucket, Key=self._k(key), UploadId=upload_id)

    def _cloudfront_signed(self, url, ttl):
        def signer(message):
            pem = self.config.cloudfront_private_key.encode()
            key = serialization.load_pem_private_key(pem, password=None)
            return key.sign(message, padding.PKCS1v15(), hashes.SHA1())  # noqa: S303 - CloudFront requires SHA-1 RSA

        expires = datetime.now(dt_tz.utc) + timedelta(seconds=ttl)
        return CloudFrontSigner(self.config.cloudfront_key_pair_id, signer).generate_presigned_url(
            url, date_less_than=expires
        )

    def signed_url(self, key, filename=None, attachment=False, mime="", ttl=None):
        ttl = ttl or self.ttl
        disposition = None
        if filename:
            kind = "attachment" if attachment else "inline"
            disposition = f"{kind}; filename*=UTF-8''{quote(filename)}"
        cfg = self.config
        if cfg.cloudfront_domain and cfg.cloudfront_key_pair_id and cfg.cloudfront_private_key:
            url = f"https://{cfg.cloudfront_domain}/{quote(self._k(key))}"
            if disposition:
                url += f"?response-content-disposition={quote(disposition)}"
            return self._cloudfront_signed(url, ttl)
        params = {"Bucket": self.bucket, "Key": self._k(key)}
        if disposition:
            params["ResponseContentDisposition"] = disposition
        if mime:
            params["ResponseContentType"] = mime
        return self.s3.generate_presigned_url("get_object", Params=params, ExpiresIn=ttl)

    def public_url(self, key):
        if not key:
            return ""
        cfg = self.config
        if cfg.public_bucket:
            if cfg.cloudfront_domain:
                return f"https://{cfg.cloudfront_domain}/{quote(self._k(key))}"
            if cfg.endpoint_url:
                return f"{cfg.endpoint_url.rstrip('/')}/{cfg.public_bucket}/{quote(self._k(key))}"
            return f"https://{cfg.public_bucket}.s3.{cfg.region}.amazonaws.com/{quote(self._k(key))}"
        return f"/api/v1/media/public/{quote(key)}"


def build_storage(config):
    return S3Storage(config) if config.backend == "s3" and config.bucket else LocalStorage(config)


def get_storage():
    """One client per config revision: saving StorageConfig bumps updated_at and invalidates this."""
    global _cached
    config = StorageConfig.load()
    with _lock:
        stamp, client = _cached
        if stamp != (config.backend, config.updated_at):
            client = build_storage(config)
            _cached = ((config.backend, config.updated_at), client)
    return client
