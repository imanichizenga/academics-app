import re

import phonenumbers


class InvalidPhone(ValueError):
    pass


def normalize_phone(raw):
    """Accept 07XX, 06XX, +255, 255 (with spaces or dashes) and return 255XXXXXXXXX."""
    digits = re.sub(r"[\s\-().]", "", str(raw or ""))
    if digits.startswith("00"):
        digits = "+" + digits[2:]
    if digits.startswith("255"):
        digits = "+" + digits
    try:
        parsed = phonenumbers.parse(digits, "TZ")
    except phonenumbers.NumberParseException as exc:
        raise InvalidPhone("Enter a valid Tanzanian phone number.") from exc
    if parsed.country_code != 255 or not phonenumbers.is_valid_number(parsed):
        raise InvalidPhone("Enter a valid Tanzanian phone number.")
    if phonenumbers.number_type(parsed) not in (
        phonenumbers.PhoneNumberType.MOBILE,
        phonenumbers.PhoneNumberType.FIXED_LINE_OR_MOBILE,
    ):
        raise InvalidPhone("Enter a Tanzanian mobile number.")
    return f"255{parsed.national_number}"
