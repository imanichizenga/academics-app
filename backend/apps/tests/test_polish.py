"""The fix-and-polish pass: login formats, maintenance, reconciliation, receipts and paywall data."""
import uuid
from datetime import timedelta
from unittest import mock

import pytest
from django.utils import timezone

from apps.accounts.models import User
from apps.core.models import SiteSettings
from apps.media_library.models import MediaAsset
from apps.payments import tasks
from apps.payments.models import Order

from .conftest import make_content, make_user

PHONE = "255713456789"
FORMATS = ["0713456789", "0713 456 789", "713456789", "255713456789", "255 713 456 789", "+255713456789",
           "+255 713 456 789"]


def auto_user():
    user = User.objects.create_student(PHONE, PHONE, must_change_password=True, source="auto_created_by_payment")
    return user


def login(client, password):
    return client.post("/api/v1/auth/login/", {"phone": PHONE, "password": password}, format="json")


@pytest.mark.parametrize("typed", FORMATS)
def test_starter_password_accepts_how_students_type_it(client, typed):
    auto_user()
    response = login(client, typed)
    assert response.status_code == 200
    assert response.data["user"]["must_change_password"] is True


def test_fallback_success_clears_failures_and_does_not_lock(client):
    auto_user()
    for _ in range(7):
        assert login(client, "wrong-guess").status_code == 401
    assert login(client, "0713456789").status_code == 200
    assert login(client, "wrong-guess").status_code == 401
    assert login(client, "0713 456 789").status_code == 200


@pytest.mark.parametrize("typed", FORMATS)
def test_fallback_ends_once_password_is_changed(client, typed):
    user = auto_user()
    user.set_password("a-private-password-1")
    user.must_change_password = False
    user.save()
    assert login(client, typed).status_code == 401


def test_fallback_needs_the_starter_password_to_still_be_the_phone(client):
    user = auto_user()
    user.set_password("temporary-from-teacher-1")  # must_change_password stays on, as after an admin reset
    user.save()
    assert login(client, "0713456789").status_code == 401
    assert login(client, "temporary-from-teacher-1").status_code == 200


def test_fallback_does_not_accept_another_number(client):
    auto_user()
    assert login(client, "0713456788").status_code == 401


def test_checking_sms_reset_availability_is_never_throttled(client):
    assert all(client.get("/api/v1/auth/otp/request/").status_code == 200 for _ in range(30))


# ---------- item 4: the paywall error carries enough to open the right checkout ----------
def test_paywall_error_for_subscribers_only_file(client):
    content = make_content(price=None)
    asset = MediaAsset.objects.create(content=content, kind="pdf", original_filename="a.pdf", size=10, mime="application/pdf",
                                      storage_key="a.pdf", status="ready")
    response = client.get(f"/api/v1/media/{asset.pk}/download/")
    assert response.status_code == 403
    error = response.data["error"]
    assert error["code"] == "paywall"
    assert error["content"]["price"] is None
    assert error["content"]["included_in_subscription"] is True


# ---------- item 6: maintenance ----------
@pytest.fixture
def maintenance():
    site = SiteSettings.objects.get_or_create(pk=1)[0]
    site.maintenance_mode = True
    site.save()
    return site


def test_maintenance_blocks_student_apis(client, maintenance, free, student):
    for path in ("/api/v1/catalog/home/", f"/api/v1/catalog/contents/{free.slug}/", "/api/v1/orders/mine/"):
        response = client.get(path)
        assert response.status_code == 503, path
        assert response.json()["code"] == "maintenance"
    client.login_as(student)
    assert client.get("/api/v1/catalog/home/").status_code == 503


@pytest.mark.parametrize("role", ["admin", "editor"])
def test_maintenance_lets_staff_browse(client, maintenance, role):
    client.login_as(make_user("255712000099", role))
    assert client.get("/api/v1/catalog/home/").status_code == 200


def test_maintenance_keeps_the_way_in_open(client, maintenance, student):
    assert client.get("/api/health/").status_code == 200
    assert client.get("/api/v1/site/").json()["maintenance_mode"] is True
    assert client.post("/api/v1/auth/login/", {"phone": student.phone, "password": "correct-horse-9"},
                       format="json").status_code == 200
    assert client.get("/api/v1/auth/otp/request/").status_code == 200


def test_maintenance_lets_payments_finish(client, maintenance):
    order_id = uuid.uuid4()
    assert client.get(f"/api/v1/orders/{order_id}/status/").status_code == 404  # reached the view
    assert client.post(f"/api/v1/orders/{order_id}/claim/", {"claim_token": "x"}, format="json").status_code == 403
    assert client.post("/api/payments/webhooks/snippe/", b"{}", content_type="application/json").status_code != 503


def test_maintenance_off_changes_nothing(client, free):
    assert client.get("/api/v1/catalog/home/").status_code == 200


# ---------- item 7: reconciliation ----------
def pending_order(**extra):
    defaults = dict(id=uuid.uuid4(), phone="255712000050", first_name="A", last_name="B", order_type="subscription",
                    amount=1000, idempotency_key=uuid.uuid4().hex[:30],
                    expires_at=timezone.now() - timedelta(hours=1))
    return Order.objects.create(**{**defaults, **extra})


def test_reconcile_expires_orders_that_never_reached_snippe(gateway):
    order = pending_order()
    tasks.reconcile_pending_orders()
    order.refresh_from_db()
    assert order.status == "expired"


def test_reconcile_asks_snippe_about_hosted_orders_instead_of_expiring_them(gateway):
    order = pending_order(snippe_session_reference="sess_1", method="hosted_checkout")

    def paid(target):
        Order.objects.filter(pk=target.pk).update(status="completed")
        return "completed"

    with mock.patch("apps.payments.tasks.services.reconcile", side_effect=paid) as check:
        tasks.reconcile_pending_orders()
    check.assert_called_once()
    order.refresh_from_db()
    assert order.status == "completed"


# ---------- item 9: receipts ----------
def paid_order(user, **extra):
    return pending_order(user=user, status="completed", paid_at=timezone.now(), item_title="Algebra", amount=5000,
                         phone="255713456789", first_name="Asha", last_name="M", payment_provider="mpesa",
                         payment_channel="mobile_money", external_reference="SEL1", **extra)


def test_owner_sees_receipt_with_masked_phone(client, student):
    order = paid_order(student)
    client.login_as(student)
    data = client.get(f"/api/v1/orders/{order.pk}/receipt/").data
    assert data["item_title"] == "Algebra" and data["amount"] == 5000
    assert data["customer_name"] == "Asha M"
    assert data["phone_masked"] == "0713 ••• 789"
    assert data["number"].startswith(f"R{timezone.now():%Y}-")
    assert data["external_reference"] == "SEL1"


def test_receipt_is_private(client, student, admin, editor):
    order = paid_order(student)
    url = f"/api/v1/orders/{order.pk}/receipt/"
    assert client.get(url).status_code in (401, 403)
    client.login_as(make_user("255712000077"))
    assert client.get(url).status_code == 404
    client.login_as(editor)
    assert client.get(url).status_code == 404  # editors never see money
    client.login_as(admin)
    assert client.get(url).status_code == 200


def test_no_receipt_for_unpaid_or_test_orders(client, student):
    client.login_as(student)
    unpaid = pending_order(user=student)
    assert client.get(f"/api/v1/orders/{unpaid.pk}/receipt/").status_code == 404
    test_order = paid_order(student)
    Order.objects.filter(pk=test_order.pk).update(order_type="gateway_test")
    assert client.get(f"/api/v1/orders/{test_order.pk}/receipt/").status_code == 404


# ---------- item 10 and 20: public fields ----------
def test_site_exposes_teacher_but_no_secrets(client):
    site = SiteSettings.objects.get_or_create(pk=1)[0]
    site.teacher_name, site.teacher_subjects = "Mwalimu", ["Physics"]
    site.contact_whatsapp = "255754000001"
    site.save()
    data = client.get("/api/v1/site/").json()
    assert data["teacher"]["name"] == "Mwalimu" and data["teacher"]["subjects"] == ["Physics"]
    assert data["contact_whatsapp"] == "255754000001"


def test_language_is_saved_per_user(client, student):
    client.login_as(student)
    assert client.patch("/api/v1/auth/me/", {"language": "sw"}, format="json").data["user"]["language"] == "sw"
    assert client.patch("/api/v1/auth/me/", {"language": "fr"}, format="json").status_code == 400
