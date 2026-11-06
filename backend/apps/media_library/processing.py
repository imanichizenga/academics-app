import hashlib
import io
import json
import logging
import shutil
import subprocess
import tempfile
from pathlib import Path

from django.utils import timezone
from PIL import Image, ImageOps

from .models import MediaAsset, StorageConfig, VideoRendition
from .storage import get_storage

log = logging.getLogger(__name__)
LADDER = [(1080, 5000, 192), (720, 2800, 128), (480, 1400, 128), (360, 800, 96)]
HLS_SEGMENT_SECONDS = 6
AUDIO_PREVIEW_SECONDS = 60
SPRITE_EVERY_SECONDS = 10


def _save(asset, **fields):
    for key, value in fields.items():
        setattr(asset, key, value)
    MediaAsset.objects.filter(pk=asset.pk).update(**fields, updated_at=timezone.now())


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def probe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        capture_output=True, text=True, timeout=120, check=True,
    )
    return json.loads(out.stdout)


def webp(img, width=None, quality=82):
    copy = img.copy()
    if width and copy.width > width:
        copy.thumbnail((width, 100000), Image.LANCZOS)
    buf = io.BytesIO()
    copy.save(buf, "WEBP", quality=quality, method=4)
    return buf.getvalue()


def process_image(asset, path, storage):
    with Image.open(path) as raw:
        img = ImageOps.exif_transpose(raw)
        img = img.convert("RGBA" if img.mode in ("RGBA", "LA", "P") else "RGB")
    variants = {}
    for width in (480, 960, 1600):
        if img.width >= width or width == 480:
            key = f"derived/{asset.pk}/w{width}.webp"
            storage.put_bytes(key, webp(img, width), "image/webp")
            variants[str(width)] = key
    thumb = f"public/thumbs/{asset.pk}.webp"
    storage.put_bytes(thumb, webp(img, 480, 78), "image/webp", public=True)
    _save(asset, width=img.width, height=img.height, variants=variants, thumbnail=thumb)


def process_pdf(asset, path, storage):
    import pypdfium2
    from pypdf import PdfReader

    pages = len(PdfReader(str(path)).pages)
    doc = pypdfium2.PdfDocument(str(path))
    try:
        pil = doc[0].render(scale=1.5).to_pil()
    finally:
        doc.close()
    thumb = f"public/thumbs/{asset.pk}.webp"
    storage.put_bytes(thumb, webp(pil.convert("RGB"), 600, 80), "image/webp", public=True)
    _save(asset, page_count=pages, thumbnail=thumb)


def pdf_preview_key(asset, pages):
    """First N pages as a real, separate file, so locked pages never leave the server."""
    from pypdf import PdfReader, PdfWriter

    storage = get_storage()
    key = f"derived/{asset.pk}/preview-{pages}.pdf"
    if storage.exists(key):
        return key
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "in.pdf"
        storage.download_to(asset.storage_key, source)
        reader, writer = PdfReader(str(source)), PdfWriter()
        for page in reader.pages[:pages]:
            writer.add_page(page)
        buf = io.BytesIO()
        writer.write(buf)
        storage.put_bytes(key, buf.getvalue(), "application/pdf")
    return key


def process_audio(asset, path, storage):
    info = probe(path)
    duration = float(info.get("format", {}).get("duration") or 0)
    with tempfile.TemporaryDirectory() as tmp:
        clip = Path(tmp) / "preview.m4a"
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", str(path), "-t", str(AUDIO_PREVIEW_SECONDS), "-vn", "-c:a", "aac",
             "-b:a", "96k", str(clip)], check=True, timeout=600,
        )
        key = f"derived/{asset.pk}/preview.m4a"
        storage.put_file(key, clip, "audio/mp4")
    _save(asset, duration=duration, preview_key=key)


def video_dims(info):
    for stream in info.get("streams", []):
        if stream.get("codec_type") == "video":
            return int(stream["width"]), int(stream["height"])
    raise ValueError("No video stream found in this file.")


def has_audio(info):
    return any(s.get("codec_type") == "audio" for s in info.get("streams", []))


def ffmpeg_command(source, out_dir, rungs, audio):
    cmd = ["ffmpeg", "-y", "-v", "error", "-progress", "pipe:1", "-i", str(source)]
    filters, maps, stream_map = [], [], []
    split = "".join(f"[v{i}]" for i in range(len(rungs)))
    filters.append(f"[0:v]split={len(rungs)}{split}")
    for i, (height, vbit, abit) in enumerate(rungs):
        filters.append(f"[v{i}]scale=-2:{height}[o{i}]")
        maps += ["-map", f"[o{i}]"]
        maps += [f"-c:v:{i}", "libx264", f"-b:v:{i}", f"{vbit}k", f"-maxrate:v:{i}", f"{int(vbit * 1.2)}k",
                 f"-bufsize:v:{i}", f"{vbit * 2}k"]
        stream_map.append(f"v:{i},a:{i},name:{height}p" if audio else f"v:{i},name:{height}p")
    for i, (_, _, abit) in enumerate(rungs if audio else []):
        maps += ["-map", "0:a:0", f"-c:a:{i}", "aac", f"-b:a:{i}", f"{abit}k", "-ac", "2"]
    cmd += ["-filter_complex", ";".join(filters), *maps,
            "-preset", "veryfast", "-g", "48", "-keyint_min", "48", "-sc_threshold", "0",
            "-force_key_frames", f"expr:gte(t,n_forced*{HLS_SEGMENT_SECONDS})",
            "-f", "hls", "-hls_time", str(HLS_SEGMENT_SECONDS), "-hls_playlist_type", "vod",
            "-hls_flags", "independent_segments", "-hls_segment_filename", str(out_dir / "%v/seg_%05d.ts"),
            "-master_pl_name", "master.m3u8", "-var_stream_map", " ".join(stream_map), str(out_dir / "%v/index.m3u8")]
    return cmd


def make_sprite(source, out_dir, duration):
    columns = 10
    count = max(1, int(duration // SPRITE_EVERY_SECONDS) + 1)
    rows = max(1, -(-count // columns))
    sprite = out_dir / "sprite.jpg"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", str(source), "-vf",
         f"fps=1/{SPRITE_EVERY_SECONDS},scale=160:90:force_original_aspect_ratio=decrease,"
         f"pad=160:90:(ow-iw)/2:(oh-ih)/2,tile={columns}x{rows}", "-frames:v", "1", "-q:v", "6", str(sprite)],
        check=True, timeout=1800,
    )
    return sprite, {"every": SPRITE_EVERY_SECONDS, "columns": columns, "rows": rows, "w": 160, "h": 90}


def transcode_ffmpeg(asset, path, storage):
    info = probe(path)
    width, height = video_dims(info)
    duration = float(info.get("format", {}).get("duration") or 0)
    rungs = [r for r in LADDER if r[0] <= height] or [LADDER[-1]]
    _save(asset, duration=duration, width=width, height=height)
    work = Path(tempfile.mkdtemp(prefix="hls-"))
    try:
        for rung in rungs:
            (work / f"{rung[0]}p").mkdir()
        proc = subprocess.Popen(ffmpeg_command(path, work, rungs, has_audio(info)), stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True)
        for line in proc.stdout:
            if line.startswith("out_time_ms=") and duration:
                try:
                    pct = int(line.split("=")[1]) / 1_000_000 / duration * 85
                except ValueError:
                    continue
                _save(asset, processing_progress=max(1, min(85, int(pct))))
        proc.wait()
        if proc.returncode:
            raise RuntimeError(f"ffmpeg failed: {proc.stderr.read()[-400:]}")
        poster = work / "poster.jpg"
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", str(min(3, duration / 3)), "-i", str(path), "-frames:v",
                        "1", "-vf", "scale=1280:-2", "-q:v", "3", str(poster)], check=True, timeout=300)
        sprite, sprite_meta = make_sprite(path, work, duration)
        base = f"videos/{asset.pk}/hls"
        files = [f for f in work.rglob("*") if f.is_file()]
        for i, file in enumerate(files):
            rel = file.relative_to(work).as_posix()
            mime = {".m3u8": "application/vnd.apple.mpegurl", ".ts": "video/mp2t", ".jpg": "image/jpeg"}[file.suffix]
            storage.put_file(f"{base}/{rel}", file, mime)
            if i % 10 == 0:
                _save(asset, processing_progress=85 + int(i / len(files) * 14))
        with Image.open(poster) as img:
            thumb = f"public/thumbs/{asset.pk}.webp"
            storage.put_bytes(thumb, webp(img.convert("RGB"), 640, 78), "image/webp", public=True)
        VideoRendition.objects.update_or_create(asset=asset, defaults={
            "master_key": f"{base}/master.m3u8", "base_key": base, "renditions": [f"{r[0]}p" for r in rungs],
            "poster": thumb, "sprite": f"{base}/sprite.jpg", "sprite_meta": sprite_meta, "duration": duration,
        })
        _save(asset, thumbnail=thumb, status=MediaAsset.Status.READY, processing_progress=100)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def mediaconvert_client(config):
    import boto3

    session = boto3.session.Session(aws_access_key_id=config.aws_access_key_id or None,
                                    aws_secret_access_key=config.aws_secret_access_key or None,
                                    region_name=config.mediaconvert_region or config.region)
    bootstrap = session.client("mediaconvert")
    endpoints = bootstrap.describe_endpoints(MaxResults=1).get("Endpoints") or []
    if endpoints:
        return session.client("mediaconvert", endpoint_url=endpoints[0]["Url"])
    return bootstrap


def mediaconvert_job(asset, config, source_s3, dest_s3):
    outputs = [{
        "NameModifier": f"_{height}p",
        "ContainerSettings": {"Container": "M3U8", "M3u8Settings": {}},
        "VideoDescription": {
            "Height": height,
            "CodecSettings": {"Codec": "H_264", "H264Settings": {
                "RateControlMode": "QVBR", "MaxBitrate": vbit * 1000, "SceneChangeDetect": "TRANSITION_DETECTION"}},
        },
        "AudioDescriptions": [{"CodecSettings": {"Codec": "AAC", "AacSettings": {
            "Bitrate": abit * 1000, "CodingMode": "CODING_MODE_2_0", "SampleRate": 48000}}}],
        "OutputSettings": {"HlsSettings": {}},
    } for height, vbit, abit in LADDER]
    return {
        "Role": config.mediaconvert_role_arn,
        "UserMetadata": {"asset_id": str(asset.pk)},
        "Settings": {
            "Inputs": [{"FileInput": source_s3, "AudioSelectors": {"Audio Selector 1": {"DefaultSelection": "DEFAULT"}},
                        "VideoSelector": {}}],
            "OutputGroups": [
                {"Name": "HLS", "OutputGroupSettings": {"Type": "HLS_GROUP_SETTINGS", "HlsGroupSettings": {
                    "Destination": f"{dest_s3}master", "SegmentLength": HLS_SEGMENT_SECONDS,
                    "MinSegmentLength": 0, "SegmentControl": "SEGMENTED_FILES"}}, "Outputs": outputs},
                {"Name": "Poster", "OutputGroupSettings": {"Type": "FILE_GROUP_SETTINGS", "FileGroupSettings": {
                    "Destination": f"{dest_s3}poster"}}, "Outputs": [{
                        "ContainerSettings": {"Container": "RAW"},
                        "VideoDescription": {"Width": 1280, "CodecSettings": {"Codec": "FRAME_CAPTURE",
                            "FrameCaptureSettings": {"FramerateNumerator": 1, "FramerateDenominator": 10,
                                                     "MaxCaptures": 2, "Quality": 80}}}}]},
            ],
        },
    }


def start_mediaconvert(asset, storage, config):
    client = mediaconvert_client(config)
    source = f"s3://{storage.bucket}/{storage._k(asset.storage_key)}"
    dest = f"s3://{storage.bucket}/{storage._k(f'videos/{asset.pk}/hls/')}"
    job = client.create_job(**mediaconvert_job(asset, config, source, dest))
    _save(asset, transcode_job_id=job["Job"]["Id"], processing_progress=1)


def finish_mediaconvert(asset, storage):
    base = f"videos/{asset.pk}/hls"
    poster_key = f"{base}/poster.0000001.jpg"
    thumb = ""
    if storage.exists(poster_key):
        with Image.open(io.BytesIO(storage.read_bytes(poster_key))) as img:
            thumb = f"public/thumbs/{asset.pk}.webp"
            storage.put_bytes(thumb, webp(img.convert("RGB"), 640, 78), "image/webp", public=True)
    VideoRendition.objects.update_or_create(asset=asset, defaults={
        "master_key": f"{base}/master.m3u8", "base_key": base, "renditions": [f"{r[0]}p" for r in LADDER],
        "poster": thumb, "duration": asset.duration or 0,
    })
    _save(asset, thumbnail=thumb, status=MediaAsset.Status.READY, processing_progress=100)


def process(asset):
    storage = get_storage()
    config = StorageConfig.load()
    _save(asset, status=MediaAsset.Status.PROCESSING, processing_progress=1, error_message="")
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / f"source{Path(asset.original_filename).suffix.lower()}"
        storage.download_to(asset.storage_key, path)
        _save(asset, checksum=sha256_file(path))
        if asset.kind == "image":
            process_image(asset, path, storage)
        elif asset.kind == "pdf":
            process_pdf(asset, path, storage)
        elif asset.kind == "audio":
            process_audio(asset, path, storage)
        elif asset.kind == "video":
            if config.transcoding_engine == "aws_mediaconvert" and storage.name == "s3":
                info = probe(path)
                _save(asset, duration=float(info.get("format", {}).get("duration") or 0))
                start_mediaconvert(asset, storage, config)
                return  # poll_mediaconvert_jobs finishes the asset
            transcode_ffmpeg(asset, path, storage)
            return
    _save(asset, status=MediaAsset.Status.READY, processing_progress=100)
