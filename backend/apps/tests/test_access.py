import io
from datetime import timedelta

import pytest
from django.utils import timezone
from PIL import Image

from apps.catalog import services
from apps.catalog.renderer import render_html
from apps.core.phone import InvalidPhone, normalize_phone
from apps.media_library import views as media
from apps.media_library.models import MediaAsset
from apps.media_library.storage import get_storage
from apps.payments.models import Entitlement, SubscriptionPlan

from .conftest import make_content, make_user


@pytest.mark.parametrize("raw", ["0712345678", "712345678", "+255712345678", "255712345678", "0712 345 678",
                                 "+255 712-345-678", "00255712345678"])
def test_phone_normalises(raw):
    assert normalize_phone(raw) == "255712345678"


@pytest.mark.parametrize("raw", ["", "123", "07123", "+254712345678", "0222123456", "abc", None])
def test_phone_rejects(raw):
    with pytest.raises(InvalidPhone):
        normalize_phone(raw)


def doc(*texts):
    return {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": t}]} for t in texts]}


def test_free_needs_no_account(client, free):
    res = client.get(f"/api/v1/catalog/contents/{free.slug}/")
    assert res.status_code == 200 and res.data["has_access"]


def test_paid_body_is_cut_on_the_server(client):
    content = make_content(body_json=doc("one", "two", "SECRET-PART"), preview_blocks=2)
    services.refresh_derived(content)
    res = client.get(f"/api/v1/catalog/contents/{content.slug}/")
    assert res.data["truncated"] and "two" in res.data["body_html"]
    assert "SECRET-PART" not in str(res.data)


def test_subscription_covers_only_included_content(client, student):
    inside = make_content(body_json=doc("a"))
    outside = make_content(included_in_subscription=False)
    plan = SubscriptionPlan.objects.create(name="M", price=1000)
    Entitlement.objects.create(user=student, kind="subscription", plan=plan,
                               expires_at=timezone.now() + timedelta(days=5))
    client.login_as(student)
    assert client.get(f"/api/v1/catalog/contents/{inside.slug}/").data["has_access"]
    assert not client.get(f"/api/v1/catalog/contents/{outside.slug}/").data["has_access"]


def test_drafts_hidden_from_public(client, student, editor):
    draft = make_content(status="draft")
    assert client.get(f"/api/v1/catalog/contents/{draft.slug}/").status_code == 404
    assert client.get("/api/v1/catalog/contents/").data["count"] == 0
    assert client.login_as(editor).get(f"/api/v1/catalog/contents/{draft.slug}/").status_code == 200


def test_unlocked_filter_and_search(client, student):
    mine = make_content(title="Quadratic equations", body_json=doc("roots and factoring"))
    make_content(title="Other")
    services.refresh_derived(mine)
    Entitlement.objects.create(user=student, kind="content", content=mine)
    assert client.get("/api/v1/catalog/contents/?access=unlocked").data["count"] == 0
    client.login_as(student)
    assert client.get("/api/v1/catalog/contents/?access=unlocked").data["count"] == 1
    assert client.get("/api/v1/catalog/contents/?q=factor").data["count"] == 1  # prefix match in body
    assert client.get("/api/v1/catalog/contents/?q=zzzz").data["count"] == 0


def test_stored_xss_is_impossible():
    evil = {"type": "doc", "content": [
        {"type": "paragraph", "content": [
            {"type": "text", "text": "<script>alert(1)</script>"},
            {"type": "text", "text": "x", "marks": [{"type": "link", "attrs": {"href": "javascript:alert(1)"}}]},
            {"type": "text", "text": "y", "marks": [{"type": "textStyle", "attrs": {
                "color": "red;background:url(evil)"}}]},
        ]},
        {"type": "unknownNode", "attrs": {"onclick": "x"}, "content": [{"type": "text", "text": "gone"}]},
        {"type": "codeBlock", "attrs": {"language": '"><img src=x onerror=alert(1)>'},
         "content": [{"type": "text", "text": "</code><script>x</script>"}]},
        {"type": "videoEmbed", "attrs": {"youtubeId": '"><script>'}},
    ]}
    out = render_html(evil)
    assert "<script" not in out and "javascript:" not in out and "onerror=alert" not in out.replace("&lt;", "<").split(
        "data-language")[0]
    assert "evil" not in out and "gone" not in out


def attached(content=None, **extra):
    storage = get_storage()
    asset = MediaAsset.objects.create(kind="pdf", original_filename="book.pdf", storage_key="uploads/x/book.pdf",
                                      status="ready", mime="application/pdf", size=9, **extra)
    storage.put_bytes(asset.storage_key, b"%PDF-1.4 x")
    if content:
        content.referenced_assets.add(asset)
    return asset


def test_file_link_paywall_then_download(client, student, paid):
    asset = attached(paid)
    url = f"/api/v1/media/{asset.pk}/download/"
    res = client.get(url)
    assert res.status_code == 403
    assert res.data["error"]["code"] == "paywall" and res.data["error"]["content"]["slug"] == paid.slug
    Entitlement.objects.create(user=student, kind="content", content=paid)
    res = client.login_as(student).get(url)
    assert res.status_code == 200
    file = client.get(res.data["url"])
    assert file.status_code == 200
    assert 'attachment; filename="book.pdf"' in file["Content-Disposition"]


def test_free_content_file_needs_no_login(client, free):
    assert client.get(f"/api/v1/media/{attached(free).pk}/download/").status_code == 200


def test_orphan_files_are_refused(client):
    assert client.get(f"/api/v1/media/{attached().pk}/download/").status_code == 403


def test_signed_url_expires(client, free):
    res = client.get(f"/api/v1/media/{attached(free).pk}/download/")
    from freezegun import freeze_time

    with freeze_time(timezone.now() + timedelta(seconds=301)):
        assert client.get(res.data["url"]).status_code == 404


def test_download_toggle_enforced(client, free):
    asset = attached(free)
    free.main_asset, free.allow_download = asset, False
    free.save()
    res = client.get(f"/api/v1/media/{asset.pk}/download/")
    assert res.status_code == 403 and res.data["error"]["code"] == "download_disabled"


def test_range_requests(client, free):
    asset = attached(free)
    url = client.get(f"/api/v1/media/{asset.pk}/download/").data["url"]
    res = client.get(url, HTTP_RANGE="bytes=0-3")
    assert res.status_code == 206 and b"".join(res.streaming_content) == b"%PDF"


def test_public_endpoint_cannot_reach_private_keys(client, free):
    asset = attached(free)
    assert client.get(f"/api/v1/media/public/{asset.storage_key}").status_code == 404


PLAYLIST = "#EXTM3U\n#EXT-X-TARGETDURATION:6\n" + "".join(f"#EXTINF:6.0,\nseg_{i:05d}.ts\n" for i in range(10)) + \
           "#EXT-X-ENDLIST\n"


def test_preview_playlist_really_ends():
    out = media.truncate_playlist(PLAYLIST, 12)
    assert "seg_00001.ts" in out and "seg_00002.ts" not in out and out.endswith("#EXT-X-ENDLIST\n")


def test_hls_preview_blocks_later_segments(client, paid):
    from apps.media_library.models import VideoRendition

    asset = attached(paid)
    asset.kind = "video"
    asset.save()
    paid.main_asset, paid.preview_seconds = asset, 12
    paid.save()
    storage = get_storage()
    base = f"videos/{asset.pk}/hls"
    VideoRendition.objects.create(asset=asset, master_key=f"{base}/master.m3u8", base_key=base, duration=60)
    storage.put_bytes(f"{base}/720p/index.m3u8", PLAYLIST.encode())
    for i in (0, 9):
        storage.put_bytes(f"{base}/720p/seg_{i:05d}.ts", b"ts")
    meta = client.get(f"/api/v1/media/{asset.pk}/stream/").data
    assert meta["preview_seconds"] == 12
    prefix = meta["master"].rsplit("/", 1)[0]
    assert "seg_00003" not in client.get(f"{prefix}/720p/index.m3u8").content.decode()
    assert client.get(f"{prefix}/720p/seg_00000.ts").status_code == 200
    assert client.get(f"{prefix}/720p/seg_00009.ts").status_code == 403
    assert client.get(f"{prefix}/../../secret.m3u8").status_code == 404


def upload(client, name, data):
    created = client.post("/api/v1/admin/media/", {"filename": name, "size": len(data)}, format="json")
    assert created.status_code == 201, created.data
    pk = created.data["id"]
    urls = client.post(f"/api/v1/admin/media/{pk}/sign-parts/", {"parts": [1]}, format="json").data["urls"]
    res = client.put(urls[1], data, content_type="application/octet-stream")
    return client.post(f"/api/v1/admin/media/{pk}/complete/", {
        "parts": [{"part": 1, "etag": res["ETag"]}]}, format="json")


def png_bytes():
    buf = io.BytesIO()
    Image.new("RGB", (800, 600), "red").save(buf, "PNG")
    return buf.getvalue()


def test_upload_processes_an_image(client, editor):
    client.login_as(editor)
    res = upload(client, "photo.png", png_bytes())
    assert res.status_code == 200, res.data
    asset = MediaAsset.objects.get(pk=res.data["id"])
    assert asset.status == "ready" and asset.mime == "image/png" and "480" in asset.variants and asset.thumbnail


@pytest.mark.parametrize("name,data", [("notes.pdf", b"MZ\x90\x00 pretend exe"), ("photo.jpg", b"#!/bin/sh\nrm -rf /"),
                                       ("book.pdf", b"just plain text"), ("run.exe", b"MZ")])
def test_upload_rejects_by_magic_bytes(client, editor, name, data):
    client.login_as(editor)
    if name.endswith(".exe"):
        created = client.post("/api/v1/admin/media/", {"filename": name, "size": len(data)}, format="json")
        assert created.status_code == 400
        return
    res = upload(client, name, data)
    assert res.status_code == 400 and res.data["error"]["code"] == "rejected"
    assert not MediaAsset.objects.exists()


def test_size_limit_from_config(client, editor):
    res = client.login_as(editor).post("/api/v1/admin/media/", {"filename": "a.png", "size": 10**9}, format="json")
    assert res.data["error"]["code"] == "too_large"


def test_delete_blocked_while_in_use(client, editor, paid):
    asset = attached(paid)
    assert client.login_as(editor).delete(f"/api/v1/admin/media/{asset.pk}/").status_code == 409


ADMIN_ONLY = ["/api/v1/admin/users/", "/api/v1/admin/orders/", "/api/v1/admin/plans/", "/api/v1/admin/audit/",
              "/api/v1/admin/settings/site/", "/api/v1/admin/settings/payments/", "/api/v1/admin/settings/storage/"]
EDITOR_OK = ["/api/v1/admin/contents/", "/api/v1/admin/media/", "/api/v1/admin/comments/",
             "/api/v1/admin/categories/", "/api/v1/admin/dashboard/"]


@pytest.mark.parametrize("url", ADMIN_ONLY + EDITOR_OK)
def test_permission_matrix(client, student, editor, admin, url):
    assert client.get(url).status_code in (401, 403)
    assert Session_get(client, student, url) == 403
    assert Session_get(client, editor, url) == (200 if url in EDITOR_OK else 403)
    assert Session_get(client, admin, url) == 200


def Session_get(client, user, url):
    return client.login_as(user).get(url).status_code


def test_dashboard_hides_money_from_editors(client, editor):
    assert "revenue_30d" not in client.login_as(editor).get("/api/v1/admin/dashboard/").data


def test_csrf_required_on_cookie_writes(client, student):
    client.login_as(student)
    client.credentials()
    res = client.patch("/api/v1/auth/me/", {"first_name": "X"}, format="json")
    assert res.status_code == 403


def test_forced_password_change_gate(client):
    user = make_user("255754111222", must_change_password=True)
    res = client.post("/api/v1/auth/login/", {"phone": "0754111222", "password": "correct-horse-9"}, format="json")
    assert res.status_code == 200 and res.data["user"]["must_change_password"]
    csrf = res.cookies["csrf_token"].value
    client.credentials(HTTP_X_CSRF_TOKEN=csrf)
    blocked = client.get("/api/v1/access/mine/")
    assert blocked.status_code == 403 and blocked.data["error"]["code"] == "password_change_required"
    weak = client.post("/api/v1/auth/change-password/", {"new_password": "12345678"}, format="json")
    assert weak.status_code == 400
    ok = client.post("/api/v1/auth/change-password/", {"new_password": "a-much-better-pass"}, format="json")
    assert ok.status_code == 200 and not ok.data["user"]["must_change_password"]
    client.credentials(HTTP_X_CSRF_TOKEN=ok.cookies["csrf_token"].value)
    assert client.get("/api/v1/access/mine/").status_code == 200
    user.refresh_from_db()
    assert user.check_password("a-much-better-pass")


def test_logout_everywhere_kills_old_tokens(client, student):
    other = type(client)().login_as(student)
    client.login_as(student)
    assert client.post("/api/v1/auth/logout-all/").status_code == 200
    assert other.get("/api/v1/access/mine/").status_code in (401, 403)


def test_refresh_rotates_and_blacklists(client, student):
    res = client.post("/api/v1/auth/login/", {"phone": student.phone, "password": "correct-horse-9"}, format="json")
    old = res.cookies["refresh"].value
    assert client.post("/api/v1/auth/refresh/").status_code == 200
    client.cookies["refresh"] = old
    assert client.post("/api/v1/auth/refresh/").status_code == 401


def test_view_as_student_is_read_only(client, admin, student):
    client.login_as(admin)
    assert client.post(f"/api/v1/admin/users/{student.pk}/impersonate/").status_code == 200
    assert client.get("/api/v1/auth/me/").data["user"]["phone"] == student.phone
    assert client.patch("/api/v1/auth/me/", {"first_name": "X"}, format="json").status_code == 403


def test_last_admin_cannot_be_removed(client, admin):
    client.login_as(admin)
    other = make_user("255754333444", "admin")
    res = client.patch(f"/api/v1/admin/users/{admin.pk}/", {"role": "student"}, format="json")
    assert res.status_code == 409
    assert client.patch(f"/api/v1/admin/users/{other.pk}/", {"role": "student"}, format="json").status_code == 200


def test_category_depth_and_delete_guard(client, editor, category):
    from apps.catalog.models import Category

    client.login_as(editor)
    sub = Category.objects.create(name="Algebra", parent=category)
    res = client.post("/api/v1/admin/categories/", {"name": "Deep", "parent": str(sub.pk)}, format="json")
    assert res.status_code == 400
    content = make_content(category=sub)
    res = client.delete(f"/api/v1/admin/categories/{category.pk}/")
    assert res.status_code == 409 and res.data["error"]["code"] == "category_in_use"
    target = Category.objects.create(name="Science")
    res = client.delete(f"/api/v1/admin/categories/{category.pk}/?reassign_to={target.pk}")
    assert res.status_code == 204
    content.refresh_from_db()
    assert content.category == target


def test_comment_rules(client, student, free):
    url = f"/api/v1/contents/{free.pk}/comments/"
    assert client.post(url, {"body": "hi"}, format="json").status_code == 401
    client.login_as(student)
    res = client.post(url, {"body": "Great lesson"}, format="json")
    assert res.status_code == 201
    assert client.post(url, {"body": "Great lesson"}, format="json").data["error"]["code"] == "duplicate"
    spam = client.post(url, {"body": "casino http://a http://b http://c"}, format="json")
    assert spam.data["status"] == "spam"
    assert client.get(url).data["count"] == 1
    free.refresh_from_db()
    assert free.comment_count == 1


def test_view_dedupes_per_day(client, free):
    url = f"/api/v1/contents/{free.pk}/view/"
    assert client.post(url, HTTP_X_DEVICE_ID="d1").data["counted"]
    assert not client.post(url, HTTP_X_DEVICE_ID="d1").data["counted"]
    free.refresh_from_db()
    assert free.view_count == 1


def test_openapi_schema_builds(client):
    assert client.get("/api/schema/").status_code == 200


def test_new_content_slug_follows_first_real_title_then_stays(client, editor):
    client.login_as(editor)
    pk = client.post("/api/v1/admin/contents/", {"title": ""}, format="json").data["id"]
    res = client.patch(f"/api/v1/admin/contents/{pk}/", {"title": "Fractions made easy"}, format="json")
    assert res.data["slug"] == "fractions-made-easy"
    res = client.patch(f"/api/v1/admin/contents/{pk}/", {"title": "Renamed", "status": "published"}, format="json")
    assert res.data["slug"] == "fractions-made-easy"


def test_purchased_content_cannot_be_deleted(client, editor, student, paid):
    Entitlement.objects.create(user=student, kind="content", content=paid)
    client.login_as(editor)
    res = client.delete(f"/api/v1/admin/contents/{paid.pk}/")
    assert res.status_code == 409 and res.data["error"]["code"] == "has_buyers"
    assert client.post("/api/v1/admin/contents/bulk/", {"ids": [str(paid.pk)], "action": "delete"},
                       format="json").status_code == 409
    assert Entitlement.objects.filter(content=paid).exists()


def test_failed_logins_lock_the_phone_across_ips(client, student, settings):
    from rest_framework.settings import api_settings

    api_settings.DEFAULT_THROTTLE_RATES["login"] = "1000/min"
    url, body = "/api/v1/auth/login/", {"phone": student.phone, "password": "wrong"}
    try:
        for i in range(8):
            assert client.post(url, body, format="json", HTTP_X_FORWARDED_FOR=f"10.0.0.{i}").status_code == 401
        good = {**body, "password": "correct-horse-9"}
        assert client.post(url, good, format="json", HTTP_X_FORWARDED_FOR="10.9.9.9").status_code == 429
    finally:
        api_settings.DEFAULT_THROTTLE_RATES["login"] = "10/min"


def test_throttle_ignores_forged_forwarded_for(client, student):
    url, body = "/api/v1/auth/login/", {"phone": "255754999000", "password": "x"}
    codes = [client.post(url, body, format="json", HTTP_X_FORWARDED_FOR=f"1.2.3.{i}, 9.9.9.9").status_code
             for i in range(12)]
    assert 429 in codes


def test_progress_on_unknown_content_is_404(client, student):
    url = "/api/v1/contents/00000000-0000-0000-0000-000000000000/progress/"
    assert client.login_as(student).put(url, {"percent": 5}, format="json").status_code == 404
