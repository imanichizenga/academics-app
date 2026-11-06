import json
import time

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.accounts.authentication import issue_session
from apps.accounts.models import User
from apps.catalog.models import Category, Content
from apps.payments.models import PaymentGatewayConfig, SubscriptionPlan
from apps.payments.snippe import sign

SECRET = "whsec_test"


@pytest.fixture(autouse=True)
def isolated(settings, tmp_path, db):
    cache.clear()
    settings.CELERY_TASK_ALWAYS_EAGER = True
    settings.CELERY_TASK_EAGER_PROPAGATES = False
    settings.MEDIA_DATA_ROOT = tmp_path / "media"
    settings.AUTH_COOKIE_SECURE = False
    from config.celery import app

    app.conf.task_always_eager = True
    yield
    cache.clear()


class Session(APIClient):
    """A client that behaves as a browser: session cookies, and the CSRF header on writes."""

    def login_as(self, user):
        from rest_framework.response import Response

        response = Response()
        issue_session(response, user)
        for key, morsel in response.cookies.items():
            self.cookies[key] = morsel.value
        self.credentials(HTTP_X_CSRF_TOKEN=response.cookies["csrf_token"].value)
        return self


@pytest.fixture
def client():
    return Session()


def make_user(phone="255712000001", role="student", **extra):
    return User.objects.create_student(phone, "correct-horse-9", role=role, first_name="Test", last_name="User", **extra)


@pytest.fixture
def student():
    return make_user()


@pytest.fixture
def admin():
    return make_user("255712000002", "admin")


@pytest.fixture
def editor():
    return make_user("255712000003", "editor")


@pytest.fixture
def category():
    return Category.objects.create(name="Maths")


def make_content(**extra):
    defaults = dict(title="Paid lesson", slug=f"lesson-{Content.objects.count()}", status="published",
                    access_level="paid", price=2000, published_at="2026-01-01T00:00:00Z")
    defaults.update(extra)
    return Content.objects.create(**defaults)


@pytest.fixture
def paid():
    return make_content()


@pytest.fixture
def free():
    return make_content(title="Free lesson", access_level="free", price=None)


@pytest.fixture
def plan():
    return SubscriptionPlan.objects.create(name="Monthly", price=10000, duration_days=30)


@pytest.fixture
def gateway():
    cfg = PaymentGatewayConfig.load()
    cfg.api_key, cfg.webhook_secret = "snp_test_key", SECRET
    cfg.is_enabled, cfg.last_test_status = True, "passed"
    cfg.save()
    return cfg


def webhook_post(client, event, *, timestamp=None, secret=SECRET, signature=None):
    raw = json.dumps(event).encode()
    timestamp = str(timestamp or int(time.time()))
    return client.generic(
        "POST", "/api/payments/webhooks/snippe/", raw, content_type="application/json",
        HTTP_X_WEBHOOK_EVENT=event.get("type", ""), HTTP_X_WEBHOOK_TIMESTAMP=timestamp,
        HTTP_X_WEBHOOK_SIGNATURE=signature or sign(secret, timestamp, raw),
    )


def completed_event(reference, amount, event_id="evt_1"):
    return {"id": event_id, "type": "payment.completed", "api_version": "2026-01-25", "data": {
        "reference": reference, "external_reference": "SEL1", "status": "completed",
        "amount": {"value": amount, "currency": "TZS"}, "channel": {"type": "mobile_money", "provider": "mpesa"},
        "customer": {"phone": "+255754000111"}, "metadata": {}}}
