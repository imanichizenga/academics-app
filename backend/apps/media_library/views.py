import logging
import mimetypes
import re
import uuid
from pathlib import Path, PurePosixPath

from django.core import signing
from django.db.models import Q
from django.http import FileResponse, Http404, HttpResponse, HttpResponseRedirect, StreamingHttpResponse
from django.utils.http import content_disposition_header
from rest_framework import decorators, parsers, serializers, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.catalog.serializers import public_url
from apps.core.api import ApiError, IsEditorOrAdmin
from apps.core.audit import record
from apps.payments.access import can_access_asset, context_for

from . import processing, validation
from .models import MediaAsset, StorageConfig, VideoRendition
from .serializers import AssetSerializer, usage
from .storage import PART_SALT, get_storage, read_token, sign_token
from .tasks import process_asset

log = logging.getLogger(__name__)
HLS_TOKEN_TTL = 4 * 3600
HLS_SALT = "hls"
MB = 1024 * 1024


class Empty(serializers.Serializer):
    pass


def get_asset(pk):
    asset = MediaAsset.objects.select_related("content", "rendition").filter(pk=pk).first()
    if asset is None:
        raise ApiError("This file does not exist.", "not_found", 404)
    return asset


def paywall_error(content):
    extra = {}
    if content is not None:
        extra["content"] = {"id": str(content.pk), "slug": content.slug, "title": content.title,
                            "price": content.effective_price, "included_in_subscription":
                                content.included_in_subscription}
    return ApiError("This file comes with paid content.", "paywall", 403, extra)


def require_access(request, asset):
    allowed, content = can_access_asset(request.user, asset, context_for(request))
    if not allowed:
        raise paywall_error(content)


class DownloadView(APIView):
    """Short-lived attachment URL, only after the access check. Used by fileLink marks and file cards."""

    serializer_class = Empty

    def get(self, request, pk):
        asset = get_asset(pk)
        require_access(request, asset)
        ctx = context_for(request)
        blocked = not ctx.is_staff and asset.main_for.filter(allow_download=False).exists()
        if blocked or asset.status != MediaAsset.Status.READY:
            code = ("download_disabled", "The teacher has turned off downloads for this file.") if blocked else (
                "not_ready", "This file is still being prepared.")
            raise ApiError(code[1], code[0], 409 if not blocked else 403)
        url = get_storage().signed_url(asset.storage_key, asset.original_filename, attachment=True, mime=asset.mime)
        return Response({"url": url, "filename": asset.original_filename, "size": asset.size})


class ViewFileView(APIView):
    """302 to a signed inline URL. Body images point here so each load passes the access check."""

    serializer_class = Empty

    def get(self, request, pk):
        asset = get_asset(pk)
        require_access(request, asset)
        storage = get_storage()
        key = asset.storage_key
        mime = asset.mime
        width = request.query_params.get("w")
        if asset.kind == "image" and asset.variants:
            sizes = sorted(int(k) for k in asset.variants)
            best = next((w for w in sizes if width and width.isdigit() and w >= int(width)), sizes[-1])
            key, mime = asset.variants[str(best)], "image/webp"
        response = HttpResponseRedirect(storage.signed_url(key, asset.original_filename, mime=mime))
        response["Cache-Control"] = "private, max-age=60"
        return response


class PreviewView(APIView):
    """A separate short file for people without access: first pages of a PDF, first seconds of audio."""

    serializer_class = Empty

    def get(self, request, pk):
        asset = get_asset(pk)
        allowed, content = can_access_asset(request.user, asset, context_for(request))
        storage = get_storage()
        if allowed and asset.requires_access is not None:
            content = None
        if allowed:
            return Response({"url": storage.signed_url(asset.storage_key, asset.original_filename, mime=asset.mime),
                             "preview": False})
        if content is None:
            raise paywall_error(None)
        if asset.kind == "pdf":
            key = processing.pdf_preview_key(asset, max(1, content.preview_pages))
            return Response({"url": storage.signed_url(key, "preview.pdf", mime="application/pdf"), "preview": True,
                             "pages": content.preview_pages, "total_pages": asset.page_count})
        if asset.kind == "audio" and asset.preview_key:
            return Response({"url": storage.signed_url(asset.preview_key, "preview.m4a", mime="audio/mp4"),
                             "preview": True, "seconds": processing.AUDIO_PREVIEW_SECONDS})
        raise paywall_error(content)


class StreamView(APIView):
    """Issue an HLS token. Viewers without access get a token that caps playback server-side."""

    serializer_class = Empty

    def get(self, request, pk):
        asset = get_asset(pk)
        rendition = VideoRendition.objects.filter(asset=asset).first()
        if rendition is None or asset.status != MediaAsset.Status.READY:
            raise ApiError("This video is still being prepared.", "not_ready", 409)
        allowed, content = can_access_asset(request.user, asset, context_for(request))
        if not allowed and content is None:
            raise paywall_error(None)
        limit = None if allowed else max(1, content.preview_seconds)
        token = sign_token({"a": str(asset.pk), "p": limit}, HLS_SALT, HLS_TOKEN_TTL)
        return Response({
            "master": f"/api/v1/media/hls/{token}/master.m3u8", "preview_seconds": limit,
            "duration": rendition.duration, "poster": public_url(rendition.poster),
            "sprite": f"/api/v1/media/hls/{token}/sprite.jpg" if rendition.sprite else "",
            "sprite_meta": rendition.sprite_meta, "renditions": rendition.renditions,
        })


def truncate_playlist(text, seconds):
    """Cut a VOD media playlist after `seconds`, so the player sees a short video that really ends there."""
    out, elapsed, done = [], 0.0, False
    for line in text.splitlines():
        if done:
            break
        if line.startswith("#EXT-X-ENDLIST"):
            continue
        out.append(line)
        if line.startswith("#EXTINF:"):
            elapsed += float(line.split(":")[1].split(",")[0])
        elif line and not line.startswith("#") and elapsed >= seconds:
            done = True
    out.append("#EXT-X-ENDLIST")
    return "\n".join(out) + "\n"


def segment_index(path):
    match = re.search(r"(\d+)\.ts$", path)
    return int(match.group(1)) if match else None


class HlsView(APIView):
    """Single delivery point for every playlist and segment, for all storage backends.

    Playlists use relative URLs, so they resolve back here with the token intact. On S3 each segment
    becomes a 302 to a short signed URL, which needs no cookie domain shared with CloudFront.
    """

    authentication_classes = []
    serializer_class = Empty

    def get(self, request, token, path):
        try:
            data = read_token(token, HLS_SALT)
        except signing.BadSignature as exc:
            raise Http404 from exc
        pure = PurePosixPath(path)
        if ".." in pure.parts or pure.suffix not in (".m3u8", ".ts", ".jpg"):
            raise Http404
        rendition = VideoRendition.objects.filter(asset_id=data["a"]).first()
        if rendition is None:
            raise Http404
        key = f"{rendition.base_key}/{pure.as_posix()}"
        limit = data.get("p")
        storage = get_storage()
        if pure.suffix == ".m3u8":
            try:
                text = storage.read_bytes(key).decode()
            except FileNotFoundError as exc:
                raise Http404 from exc
            if limit and "#EXT-X-STREAM-INF" not in text:
                text = truncate_playlist(text, limit)
            return HttpResponse(text, content_type="application/vnd.apple.mpegurl",
                                headers={"Cache-Control": "private, max-age=30"})
        if limit and pure.suffix == ".ts":
            index = segment_index(path)
            if index is None or index * processing.HLS_SEGMENT_SECONDS >= limit + processing.HLS_SEGMENT_SECONDS:
                return HttpResponse(status=403)
        mime = "video/mp2t" if pure.suffix == ".ts" else "image/jpeg"
        return serve_or_redirect(request, storage, key, mime)


RANGE_RE = re.compile(r"bytes=(\d+)-(\d*)")


def serve_local(request, path, mime, filename=None, attachment=False):
    size = path.stat().st_size
    match = RANGE_RE.match(request.headers.get("Range", ""))
    if match:
        start, end = int(match[1]), int(match[2] or size - 1)
        end = min(end, size - 1)
        if start > end:
            return HttpResponse(status=416, headers={"Content-Range": f"bytes */{size}"})

        def chunks():
            with open(path, "rb") as fh:
                fh.seek(start)
                left = end - start + 1
                while left > 0:
                    data = fh.read(min(1024 * 256, left))
                    if not data:
                        break
                    left -= len(data)
                    yield data

        response = StreamingHttpResponse(chunks(), status=206, content_type=mime)
        response["Content-Range"] = f"bytes {start}-{end}/{size}"
        response["Content-Length"] = str(end - start + 1)
    else:
        response = FileResponse(open(path, "rb"), content_type=mime)  # noqa: SIM115 - FileResponse closes it
        response["Content-Length"] = str(size)
    response["Accept-Ranges"] = "bytes"
    if filename:
        response["Content-Disposition"] = content_disposition_header(attachment, filename)
    return response


def serve_or_redirect(request, storage, key, mime):
    local = storage.local_path(key)
    if local is None:
        return HttpResponseRedirect(storage.signed_url(key, ttl=600))
    if not local.exists():
        raise Http404
    return serve_local(request, local, mime)


class SignedFileView(APIView):
    """Local-storage stand-in for an S3 signed URL."""

    authentication_classes = []
    serializer_class = Empty

    def get(self, request, token):
        try:
            data = read_token(token)
        except signing.BadSignature as exc:
            raise Http404 from exc
        path = get_storage().local_path(data["k"])
        if path is None or not path.exists():
            raise Http404
        mime = data.get("m") or mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        return serve_local(request, path, mime, data.get("f"), bool(data.get("a")))


class PublicFileView(APIView):
    """Covers, thumbnails, logos. Only keys under public/ are reachable."""

    authentication_classes = []
    serializer_class = Empty

    def get(self, request, key):
        if not key.startswith("public/") or ".." in key:
            raise Http404
        storage = get_storage()
        local = storage.local_path(key)
        if local is None:
            return HttpResponseRedirect(storage.signed_url(key, ttl=3600))
        if not local.exists():
            raise Http404
        response = FileResponse(open(local, "rb"), content_type=mimetypes.guess_type(key)[0] or "image/webp")  # noqa: SIM115
        response["Cache-Control"] = "public, max-age=604800"
        return response


class LocalPartView(APIView):
    """Receives chunks in local mode, playing the role of S3 presigned part URLs."""

    authentication_classes = []
    parser_classes = [parsers.BaseParser]
    serializer_class = Empty

    def put(self, request, token):
        storage = get_storage()
        if storage.name != "local":
            raise Http404
        try:
            data = read_token(token, PART_SALT)
        except signing.BadSignature as exc:
            raise Http404 from exc
        try:
            etag = storage.store_part(data["u"], data["n"], request._request.body)
        except FileNotFoundError as exc:
            raise Http404 from exc
        return HttpResponse(status=200, headers={"ETag": f'"{etag}"'})


class InitUploadSerializer(serializers.Serializer):
    filename = serializers.CharField(max_length=255)
    size = serializers.IntegerField(min_value=1)
    mime = serializers.CharField(required=False, allow_blank=True)
    content = serializers.UUIDField(required=False, allow_null=True)
    replaces = serializers.UUIDField(required=False, allow_null=True)


class AdminMediaViewSet(viewsets.ModelViewSet):
    permission_classes = [IsEditorOrAdmin]
    serializer_class = AssetSerializer
    queryset = MediaAsset.objects.select_related("uploaded_by")
    filterset_fields = ["kind", "status"]
    ordering_fields = ["created_at", "size", "original_filename"]
    http_method_names = ["get", "post", "patch", "delete"]

    def get_queryset(self):
        qs = super().get_queryset().exclude(status=MediaAsset.Status.UPLOADING)
        term = self.request.query_params.get("search", "").strip()
        ids = self.request.query_params.get("ids")
        if ids:
            return super().get_queryset().filter(pk__in=ids.split(","))
        return qs.filter(Q(original_filename__icontains=term)) if term else qs

    def create(self, request):
        ser = InitUploadSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        kind = validation.kind_from_name(data["filename"])
        config = StorageConfig.load()
        if kind is None or kind not in config.allowed_types:
            raise ApiError("This file type is not allowed.", "type_not_allowed")
        limit = int(config.max_upload_mb.get(kind, 100))
        if data["size"] > limit * MB:
            raise ApiError(f"This file is too large. The limit for {kind} files is {limit} MB.", "too_large")
        storage = get_storage()
        asset_id = uuid.uuid4()
        safe_name = re.sub(r"[^\w.-]", "_", Path(data["filename"]).name)[-120:]
        key = f"uploads/{asset_id}/{safe_name}"
        asset = MediaAsset.objects.create(
            id=asset_id, uploaded_by=request.user, kind=kind, original_filename=Path(data["filename"]).name,
            storage_key=key, size=data["size"], mime=data.get("mime", ""), content_id=data.get("content"),
            upload_id=storage.create_multipart(key, data.get("mime") or "application/octet-stream"),
        )
        if data.get("replaces"):
            asset.upload_parts = {"replaces": str(data["replaces"])}
            asset.save(update_fields=["upload_parts"])
        part_size = max(storage.part_size, -(-data["size"] // 9000))
        return Response({"id": str(asset.pk), "part_size": part_size,
                         "part_count": -(-data["size"] // part_size)}, status=201)

    @decorators.action(detail=True, methods=["post"], url_path="sign-parts")
    def sign_parts(self, request, pk=None):
        asset = self._uploading(pk)
        numbers = [int(n) for n in (request.data.get("parts") or [])][:100]
        storage = get_storage()
        return Response({"urls": {n: storage.presign_part(asset.storage_key, asset.upload_id, n) for n in numbers}})

    def _uploading(self, pk):
        asset = MediaAsset.objects.filter(pk=pk, status=MediaAsset.Status.UPLOADING).first()
        if asset is None:
            raise ApiError("This upload is no longer active.", "not_found", 404)
        return asset

    @decorators.action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        asset = self._uploading(pk)
        storage = get_storage()
        parts = request.data.get("parts") or []
        storage.complete_multipart(asset.storage_key, asset.upload_id,
                                   [{"PartNumber": int(p["part"]), "ETag": p["etag"]} for p in parts])
        actual = storage.size(asset.storage_key)
        try:
            if actual != asset.size:
                raise validation.Rejected("The uploaded size does not match. Please try again.")
            kind, mime = validation.verify(asset.original_filename, storage.read_bytes(asset.storage_key, 8192))
        except validation.Rejected as exc:
            storage.delete(asset.storage_key)
            asset.delete()
            raise ApiError(str(exc), "rejected") from exc
        replaces = (asset.upload_parts or {}).get("replaces")
        asset.kind, asset.mime, asset.status = kind, mime, MediaAsset.Status.UPLOADED
        asset.upload_id, asset.upload_parts = "", {}
        asset.save()
        if replaces:
            asset = self._swap(MediaAsset.objects.get(pk=replaces), asset)
        process_asset.delay(str(asset.pk))
        record(request, "media.upload", asset)
        return Response(AssetSerializer(asset).data)

    @staticmethod
    def _swap(old, new):
        """Keep the old id, so every fileLink and embed pointing at it follows the new file."""
        storage = get_storage()
        previous = old.storage_key
        for field in ("kind", "mime", "original_filename", "storage_key", "size"):
            setattr(old, field, getattr(new, field))
        old.status, old.variants, old.preview_key, old.checksum = MediaAsset.Status.UPLOADED, {}, "", ""
        old.page_count = old.duration = None
        MediaAsset.objects.filter(pk=new.pk).delete()
        old.save()
        try:
            storage.delete(previous)
        except Exception:  # the new file is live; a stray old object is only wasted space
            log.warning("Could not delete replaced file for asset %s", old.pk)
        return old

    @decorators.action(detail=True, methods=["post"])
    def abort(self, request, pk=None):
        asset = self._uploading(pk)
        get_storage().abort_multipart(asset.storage_key, asset.upload_id)
        asset.delete()
        return Response({"ok": True})

    @decorators.action(detail=True, methods=["post"])
    def retry(self, request, pk=None):
        asset = self.get_object()
        if asset.status != MediaAsset.Status.FAILED:
            raise ApiError("Only failed items can be retried.")
        MediaAsset.objects.filter(pk=asset.pk).update(status=MediaAsset.Status.UPLOADED, error_message="",
                                                      transcode_job_id="", processing_progress=0)
        process_asset.delay(str(asset.pk))
        record(request, "media.retry", asset)
        return Response(AssetSerializer(MediaAsset.objects.get(pk=asset.pk)).data)

    @decorators.action(detail=True)
    def usages(self, request, pk=None):
        rows = usage(self.get_object()).values("id", "title", "slug", "status")
        return Response(list(rows))

    def destroy(self, request, *args, **kwargs):
        asset = self.get_object()
        count = usage(asset).count()
        if count:
            raise ApiError(f"This file is used in {count} item(s). Remove it from them first.", "in_use", 409)
        storage = get_storage()
        for key in [asset.storage_key, *asset.variants.values(), asset.preview_key]:
            if key:
                storage.delete(key)
        if asset.thumbnail:
            storage.delete(asset.thumbnail, public=True)
        if asset.kind == "video":
            storage.delete_prefix(f"videos/{asset.pk}")
        record(request, "media.delete", asset)
        asset.delete()
        return Response(status=204)


class PublicImageUploadView(APIView):
    """Covers, logos and category art. Goes through the same validation, then lands in public storage."""

    permission_classes = [IsEditorOrAdmin]
    parser_classes = [parsers.MultiPartParser]
    serializer_class = Empty

    def post(self, request):
        from PIL import Image

        file = request.FILES.get("file")
        if file is None:
            raise ApiError("Choose an image.")
        head = file.read(8192)
        file.seek(0)
        try:
            kind, _ = validation.verify(file.name, head)
        except validation.Rejected as exc:
            raise ApiError(str(exc), "rejected") from exc
        if kind != "image":
            raise ApiError("Please choose an image.", "rejected")
        with Image.open(file) as raw:
            img = raw.convert("RGBA" if raw.mode in ("RGBA", "LA", "P") else "RGB")
        storage = get_storage()
        name = uuid.uuid4().hex
        full, thumb = f"public/covers/{name}.webp", f"public/covers/{name}-w640.webp"
        storage.put_bytes(full, processing.webp(img, 1600), "image/webp", public=True)
        storage.put_bytes(thumb, processing.webp(img, 640, 78), "image/webp", public=True)
        return Response({"key": full, "thumb_key": thumb, "url": storage.public_url(full)}, status=201)
