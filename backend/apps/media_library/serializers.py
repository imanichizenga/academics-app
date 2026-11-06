from rest_framework import serializers

from apps.catalog.serializers import public_url

from .models import MediaAsset, StorageConfig


class AssetSerializer(serializers.ModelSerializer):
    thumbnail_url = serializers.SerializerMethodField()
    usage_count = serializers.SerializerMethodField()
    uploaded_by_name = serializers.CharField(source="uploaded_by.get_full_name", default="", read_only=True)

    class Meta:
        model = MediaAsset
        fields = ["id", "kind", "original_filename", "size", "mime", "checksum", "page_count", "duration", "width",
                  "height", "thumbnail_url", "status", "processing_progress", "error_message", "requires_access",
                  "created_at", "usage_count", "content", "uploaded_by_name"]
        read_only_fields = [f for f in fields if f not in ("requires_access", "content")]

    def get_thumbnail_url(self, obj):
        return public_url(obj.thumbnail)

    def get_usage_count(self, obj):
        return usage(obj).count()


def usage(asset):
    from apps.payments.access import asset_contents

    return asset_contents(asset)


class StorageConfigSerializer(serializers.ModelSerializer):
    aws_secret_access_key = serializers.CharField(write_only=True, required=False, allow_blank=True)
    cloudfront_private_key = serializers.CharField(write_only=True, required=False, allow_blank=True)
    aws_secret_access_key_masked = serializers.SerializerMethodField()
    cloudfront_private_key_masked = serializers.SerializerMethodField()
    updated_by_name = serializers.CharField(source="updated_by.get_full_name", default="", read_only=True)

    class Meta:
        model = StorageConfig
        exclude = ["id"]
        read_only_fields = ["last_tested_at", "last_test_status", "last_test_report", "updated_by", "updated_at"]

    def get_aws_secret_access_key_masked(self, obj):
        from apps.core.fields import mask_secret

        return mask_secret(obj.aws_secret_access_key)

    def get_cloudfront_private_key_masked(self, obj):
        return "••••••••" if obj.cloudfront_private_key else ""

    def update(self, instance, validated):
        for secret in ("aws_secret_access_key", "cloudfront_private_key"):
            if not validated.get(secret):
                validated.pop(secret, None)
        return super().update(instance, validated)
