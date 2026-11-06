import logging
from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from . import processing
from .models import MediaAsset, StorageConfig
from .storage import get_storage

log = logging.getLogger(__name__)


@shared_task
def process_asset(asset_id):
    asset = MediaAsset.objects.get(pk=asset_id)
    try:
        processing.process(asset)
    except Exception as exc:  # the admin sees this and can retry
        log.exception("Processing failed for asset %s", asset_id)
        MediaAsset.objects.filter(pk=asset_id).update(status=MediaAsset.Status.FAILED, error_message=str(exc)[:500])


@shared_task
def poll_mediaconvert_jobs():
    assets = MediaAsset.objects.filter(status=MediaAsset.Status.PROCESSING).exclude(transcode_job_id="")
    if not assets.exists():
        return
    config = StorageConfig.load()
    client = processing.mediaconvert_client(config)
    storage = get_storage()
    for asset in assets:
        job = client.get_job(Id=asset.transcode_job_id)["Job"]
        status = job["Status"]
        if status == "COMPLETE":
            processing.finish_mediaconvert(asset, storage)
        elif status in ("ERROR", "CANCELED"):
            MediaAsset.objects.filter(pk=asset.pk).update(
                status=MediaAsset.Status.FAILED, error_message=str(job.get("ErrorMessage") or status)[:500])
        else:
            MediaAsset.objects.filter(pk=asset.pk).update(processing_progress=job.get("JobPercentComplete") or 1)


@shared_task
def cleanup_abandoned_uploads():
    storage = get_storage()
    stale = MediaAsset.objects.filter(status=MediaAsset.Status.UPLOADING,
                                      created_at__lt=timezone.now() - timedelta(hours=48))
    for asset in stale:
        try:
            storage.abort_multipart(asset.storage_key, asset.upload_id)
        except Exception:  # already gone on the storage side
            log.info("Abort failed for asset %s", asset.pk)
        asset.delete()
