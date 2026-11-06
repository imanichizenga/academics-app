from django.apps import AppConfig


class Cfg(AppConfig):
    name = "apps.engagement"
    default_auto_field = "django.db.models.BigAutoField"

    def ready(self):
        from . import signals  # noqa: F401
