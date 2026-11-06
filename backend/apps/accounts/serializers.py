from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from apps.core.phone import InvalidPhone, normalize_phone

from .models import User


class PhoneField(serializers.CharField):
    def to_internal_value(self, data):
        try:
            return normalize_phone(super().to_internal_value(data))
        except InvalidPhone as exc:
            raise serializers.ValidationError(str(exc)) from exc


class MeSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username", "phone", "first_name", "last_name", "email", "role", "must_change_password",
                  "source", "date_joined", "language"]
        read_only_fields = ["id", "username", "phone", "role", "must_change_password", "source", "date_joined"]


class LoginSerializer(serializers.Serializer):
    phone = PhoneField()
    password = serializers.CharField()


class RegisterSerializer(serializers.Serializer):
    phone = PhoneField()
    first_name = serializers.CharField(max_length=80)
    last_name = serializers.CharField(max_length=80)
    password = serializers.CharField(min_length=8)

    def validate_password(self, value):
        validate_password(value)
        return value


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(required=False, allow_blank=True)
    new_password = serializers.CharField(min_length=8)

    def validate(self, attrs):
        user = self.context["request"].user
        if not user.must_change_password and not user.check_password(attrs.get("current_password") or ""):
            raise serializers.ValidationError({"current_password": "That is not your current password."})
        if attrs["new_password"] == user.phone or user.check_password(attrs["new_password"]):
            raise serializers.ValidationError({"new_password": "Choose a password different from the current one."})
        validate_password(attrs["new_password"], user)
        return attrs


class OtpRequestSerializer(serializers.Serializer):
    phone = PhoneField()


class OtpConfirmSerializer(OtpRequestSerializer):
    code = serializers.CharField(max_length=8)
    new_password = serializers.CharField(min_length=8)
