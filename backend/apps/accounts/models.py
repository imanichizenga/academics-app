import uuid

from django.contrib.auth.models import AbstractUser, UserManager as DjangoUserManager
from django.db import models

from apps.core.phone import normalize_phone


class UserManager(DjangoUserManager):
    def create_superuser(self, username=None, email=None, password=None, **extra):
        extra.setdefault("role", "admin")
        extra.setdefault("phone", username)
        return super().create_superuser(username, email, password, **extra)

    def create_student(self, phone, password=None, **extra):
        phone = normalize_phone(phone)
        user = self.model(username=phone, phone=phone, **extra)
        user.set_password(password) if password else user.set_unusable_password()
        user.save()
        return user


class User(AbstractUser):
    class Role(models.TextChoices):
        ADMIN = "admin", "Admin"
        EDITOR = "editor", "Editor"
        STUDENT = "student", "Student"

    class Source(models.TextChoices):
        SELF_SIGNUP = "self_signup", "Self signup"
        AUTO_CREATED = "auto_created_by_payment", "Created by payment"
        ADMIN_CREATED = "admin_created", "Created by admin"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    phone = models.CharField(max_length=12, unique=True)
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.STUDENT, db_index=True)
    must_change_password = models.BooleanField(default=False)
    last_seen = models.DateTimeField(null=True, blank=True)
    source = models.CharField(max_length=30, choices=Source.choices, default=Source.SELF_SIGNUP, db_index=True)
    token_version = models.PositiveIntegerField(default=0)
    language = models.CharField(max_length=2, choices=[("en", "English"), ("sw", "Kiswahili")], blank=True)
    updated_at = models.DateTimeField(auto_now=True)
    objects = UserManager()

    @property
    def created_at(self):
        return self.date_joined

    @property
    def is_staff_role(self):
        return self.role in (self.Role.ADMIN, self.Role.EDITOR)

    @property
    def display_name(self):
        return self.get_full_name() or f"•••{self.phone[-3:]}"

    def __str__(self):
        return self.get_full_name() or self.username
