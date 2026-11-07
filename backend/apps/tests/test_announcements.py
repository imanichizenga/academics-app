"""Announcements: only switched-on, in-window ones reach visitors, and the admin's input is checked."""
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.core.models import Announcement

URL = "/api/v1/admin/announcements/"


def live_ids(client):
    return [a["id"] for a in client.get("/api/v1/site/").json()["announcements"]]


def test_only_live_announcements_are_public(client):
    now = timezone.now()
    on = Announcement.objects.create(title="New lessons", is_active=True)
    Announcement.objects.create(title="Draft")
    Announcement.objects.create(title="Later", is_active=True, starts_at=now + timedelta(hours=1))
    Announcement.objects.create(title="Over", is_active=True, ends_at=now - timedelta(minutes=1))
    window = Announcement.objects.create(title="Now", is_active=True, starts_at=now - timedelta(hours=1),
                                         ends_at=now + timedelta(hours=1))
    assert sorted(live_ids(client)) == sorted([str(on.pk), str(window.pk)])


def test_public_payload_has_display_fields(client):
    Announcement.objects.create(title="Hi", title_sw="Habari", tone="promo", placement="home", audience="guests",
                                link_url="/pricing", link_label="See plans", is_active=True)
    item = client.get("/api/v1/site/").json()["announcements"][0]
    assert {k: item[k] for k in ("title_sw", "tone", "placement", "audience", "link_url", "dismissible")} == {
        "title_sw": "Habari", "tone": "promo", "placement": "home", "audience": "guests", "link_url": "/pricing",
        "dismissible": True}
    assert item["version"]


def test_admin_publishes_toggles_and_deletes(client, admin):
    client.login_as(admin)
    res = client.post(URL, {"title": "Exam tips", "body": "New this week", "is_active": True}, format="json")
    assert res.status_code == 201 and res.json()["state"] == "live"
    pk = res.json()["id"]
    assert live_ids(client) == [pk]
    assert client.patch(f"{URL}{pk}/", {"is_active": False}, format="json").json()["state"] == "off"
    assert live_ids(client) == []
    assert client.delete(f"{URL}{pk}/").status_code == 204
    from apps.core.models import AuditLog

    assert set(AuditLog.objects.values_list("action", flat=True)) >= {"announcement.create", "announcement.update",
                                                                      "announcement.delete"}


def test_scheduled_state(client, admin):
    client.login_as(admin)
    start = (timezone.now() + timedelta(days=1)).isoformat()
    res = client.post(URL, {"title": "Soon", "is_active": True, "starts_at": start}, format="json")
    assert res.json()["state"] == "scheduled"


@pytest.mark.parametrize("link", ["javascript:alert(1)", "//evil.example", "ftp://x"])
def test_link_must_be_safe(client, admin, link):
    client.login_as(admin)
    assert client.post(URL, {"title": "x", "link_url": link}, format="json").status_code == 400


def test_end_after_start(client, admin):
    client.login_as(admin)
    now = timezone.now()
    body = {"title": "x", "starts_at": now.isoformat(), "ends_at": (now - timedelta(hours=1)).isoformat()}
    assert client.post(URL, body, format="json").status_code == 400


def test_only_admins_manage(client, editor):
    client.login_as(editor)
    assert client.post(URL, {"title": "x"}, format="json").status_code == 403
