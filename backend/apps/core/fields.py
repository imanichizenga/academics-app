from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.db import models


def fernet():
    return Fernet(settings.FIELD_ENCRYPTION_KEY.encode())


class EncryptedTextField(models.TextField):
    """Text stored as a Fernet token. Python code sees plaintext; the database never does."""

    def from_db_value(self, value, expression, connection):
        if not value:
            return value
        try:
            return fernet().decrypt(value.encode()).decode()
        except InvalidToken:
            # A rotated FIELD_ENCRYPTION_KEY makes old values unreadable: treat as unset, and let
            # the diagnostics report a missing secret instead of crashing every admin page.
            return ""

    def get_prep_value(self, value):
        if value in (None, ""):
            return value
        return fernet().encrypt(str(value).encode()).decode()


def mask_secret(value, prefix=""):
    if not value:
        return ""
    return f"{prefix}••••••••{value[-4:]}"
