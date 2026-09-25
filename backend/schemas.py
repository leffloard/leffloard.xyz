import re
import unicodedata
from datetime import UTC, date, datetime, timedelta
from functools import cache
from typing import Any, Optional
from zoneinfo import ZoneInfo, available_timezones

from email_validator import EmailNotValidError, validate_email
from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator
from pydantic_core import PydanticCustomError

REQUEST_TYPES = ("appointment", "revision", "inquiry")
STATUSES = ("new", "confirmed", "declined", "completed")
SERVICES = ("Web Development", "Discord Bot", "Authentication System", "Loader / Desktop App", "Other")
DURATIONS = (15, 30, 45, 60)
DEFAULT_DURATION = 30
MAX_DAYS_AHEAD = 120

DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_PATTERN = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
NON_IANA_ZONES = {"localtime", "Factory"}

BODY_MESSAGES = {
    "json_invalid": "The request body must be valid JSON.",
    "missing": "The request body must be a JSON object.",
    "dict_type": "The request body must be a JSON object.",
    "model_attributes_type": "The request body must be a JSON object.",
}
TYPE_MESSAGES = {
    "missing": "This field is required.",
    "bool_type": "Must be true or false.",
    "bool_parsing": "Must be true or false.",
    "int_type": "Must be a whole number.",
    "int_parsing": "Must be a whole number.",
    "string_type": "Must be text.",
}


def invalid(message: str) -> PydanticCustomError:
    return PydanticCustomError("invalid", message)


@cache
def timezone_names() -> frozenset[str]:
    return frozenset(available_timezones() - NON_IANA_ZONES)


def clean_text(
    value: Any,
    *,
    max_length: int,
    required: bool = False,
    multiline: bool = False,
    required_message: str = "This field is required.",
) -> Optional[str]:
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise invalid("Must be text.")
    if multiline:
        value = value.replace("\r\n", "\n").replace("\r", "\n")
    value = value.strip()
    if not value:
        if required:
            raise invalid(required_message)
        return None
    allowed = "\n\t" if multiline else ""
    if any(unicodedata.category(char) == "Cc" and char not in allowed for char in value):
        raise invalid("Contains characters that are not allowed.")
    if len(value) > max_length:
        raise invalid(f"Must be {max_length} characters or fewer.")
    return value


def format_validation_errors(errors: list[dict[str, Any]]) -> list[dict[str, str]]:
    formatted: list[dict[str, str]] = []
    seen: set[str] = set()
    for error in errors:
        loc = [str(part) for part in error.get("loc", ())]
        if loc and loc[0] in ("body", "query", "path"):
            loc = loc[1:]
        kind = error.get("type", "")
        if kind == "json_invalid" or not loc:
            field = "body"
            message = BODY_MESSAGES.get(kind, error.get("msg", "Invalid request body."))
        else:
            field = ".".join(loc)
            if kind == "value_error" and "error" in error.get("ctx", {}):
                message = str(error["ctx"]["error"])
            else:
                message = TYPE_MESSAGES.get(kind, error.get("msg", "Invalid value."))
        if field not in seen:
            seen.add(field)
            formatted.append({"field": field, "message": message})
    return formatted


class RequestCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    type: Optional[str] = Field(default=None, validate_default=True)
    name: Optional[str] = Field(default=None, validate_default=True)
    email: Optional[str] = Field(default=None, validate_default=True)
    contact_handle: Optional[str] = None
    service: Optional[str] = None
    subject: Optional[str] = Field(default=None, validate_default=True)
    message: Optional[str] = Field(default=None, validate_default=True)
    project_reference: Optional[str] = Field(default=None, validate_default=True)
    timezone: Optional[str] = Field(default=None, validate_default=True)
    preferred_date: Optional[str] = Field(default=None, validate_default=True)
    preferred_time: Optional[str] = Field(default=None, validate_default=True)
    duration_minutes: Optional[int] = Field(default=None, validate_default=True)

    @field_validator("type", mode="before")
    @classmethod
    def _check_type(cls, value: Any) -> str:
        if value is None or value == "":
            raise invalid("This field is required.")
        if not isinstance(value, str) or value not in REQUEST_TYPES:
            raise invalid("Choose appointment, revision or inquiry.")
        return value

    @field_validator("name", mode="before")
    @classmethod
    def _check_name(cls, value: Any) -> Optional[str]:
        return clean_text(value, max_length=80, required=True, required_message="Please enter your name.")

    @field_validator("email", mode="before")
    @classmethod
    def _check_email(cls, value: Any) -> str:
        text = clean_text(value, max_length=254, required=True, required_message="Please enter your email address.")
        try:
            return validate_email(text, check_deliverability=False, allow_smtputf8=False).ascii_email
        except EmailNotValidError:
            raise invalid("Please enter a valid email address.") from None

    @field_validator("contact_handle", mode="before")
    @classmethod
    def _check_contact_handle(cls, value: Any) -> Optional[str]:
        return clean_text(value, max_length=80)

    @field_validator("service", mode="before")
    @classmethod
    def _check_service(cls, value: Any) -> Optional[str]:
        text = clean_text(value, max_length=80)
        if text is not None and text not in SERVICES:
            raise invalid("Please choose one of the listed services.")
        return text

    @field_validator("subject", mode="before")
    @classmethod
    def _check_subject(cls, value: Any) -> Optional[str]:
        return clean_text(value, max_length=120, required=True, required_message="Please enter a subject.")

    @field_validator("message", mode="before")
    @classmethod
    def _check_message(cls, value: Any) -> Optional[str]:
        return clean_text(value, max_length=4000, required=True, multiline=True, required_message="Please enter a message.")

    @field_validator("project_reference", mode="before")
    @classmethod
    def _check_project_reference(cls, value: Any, info: ValidationInfo) -> Optional[str]:
        return clean_text(
            value,
            max_length=120,
            required=info.data.get("type") == "revision",
            required_message="Please enter the project or order name.",
        )

    @field_validator("timezone", mode="before")
    @classmethod
    def _check_timezone(cls, value: Any, info: ValidationInfo) -> Optional[str]:
        if info.data.get("type") != "appointment":
            return None
        text = clean_text(value, max_length=64, required=True, required_message="Please choose a time zone.")
        if text not in timezone_names():
            raise invalid("Please choose a valid time zone.")
        return text

    @field_validator("preferred_date", mode="before")
    @classmethod
    def _check_preferred_date(cls, value: Any, info: ValidationInfo) -> Optional[str]:
        if info.data.get("type") != "appointment":
            return None
        text = clean_text(value, max_length=32, required=True, required_message="Please choose a date.")
        if not DATE_PATTERN.match(text):
            raise invalid("Please use the YYYY-MM-DD date format.")
        try:
            day = date.fromisoformat(text)
        except ValueError:
            raise invalid("Please choose a valid date.") from None
        zone_name = info.data.get("timezone")
        today = datetime.now(ZoneInfo(zone_name) if zone_name else UTC).date()
        if day < today:
            raise invalid("The date cannot be in the past.")
        if day > today + timedelta(days=MAX_DAYS_AHEAD):
            raise invalid(f"Please choose a date within the next {MAX_DAYS_AHEAD} days.")
        return text

    @field_validator("preferred_time", mode="before")
    @classmethod
    def _check_preferred_time(cls, value: Any, info: ValidationInfo) -> Optional[str]:
        if info.data.get("type") != "appointment":
            return None
        text = clean_text(value, max_length=32, required=True, required_message="Please choose a time.")
        if not TIME_PATTERN.match(text):
            raise invalid("Please use the 24-hour HH:MM time format.")
        return text

    @field_validator("duration_minutes", mode="before")
    @classmethod
    def _check_duration(cls, value: Any, info: ValidationInfo) -> Optional[int]:
        if info.data.get("type") != "appointment":
            return None
        if value is None or value == "":
            return DEFAULT_DURATION
        if isinstance(value, str) and value.strip().isdigit():
            value = int(value.strip())
        if isinstance(value, bool) or not isinstance(value, int) or value not in DURATIONS:
            raise invalid("Please choose 15, 30, 45 or 60 minutes.")
        return value


class RequestUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    status: Optional[str] = None
    admin_note: Optional[str] = None
    scheduled_at: Optional[str] = None
    notify_client: bool = False
    client_message: Optional[str] = None

    @field_validator("status", mode="before")
    @classmethod
    def _check_status(cls, value: Any) -> Optional[str]:
        if value is None:
            return None
        if not isinstance(value, str) or value not in STATUSES:
            raise invalid("Choose new, confirmed, declined or completed.")
        return value

    @field_validator("admin_note", mode="before")
    @classmethod
    def _check_admin_note(cls, value: Any) -> Optional[str]:
        if value is None:
            return None
        return clean_text(value, max_length=2000, multiline=True) or ""

    @field_validator("scheduled_at", mode="before")
    @classmethod
    def _check_scheduled_at(cls, value: Any) -> Optional[str]:
        text = clean_text(value, max_length=64)
        if text is None:
            return None
        try:
            moment = datetime.fromisoformat(text)
        except ValueError:
            raise invalid("Use an ISO 8601 date and time, e.g. 2026-10-01T14:30:00+03:00.") from None
        if moment.utcoffset() is None:
            raise invalid("Include a UTC offset, e.g. 2026-10-01T14:30:00+03:00.")
        return moment.astimezone(UTC).isoformat()

    @field_validator("client_message", mode="before")
    @classmethod
    def _check_client_message(cls, value: Any) -> Optional[str]:
        return clean_text(value, max_length=2000, multiline=True)


class LoginBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    password: Optional[str] = Field(default=None, validate_default=True)

    @field_validator("password", mode="before")
    @classmethod
    def _check_password(cls, value: Any) -> str:
        if not isinstance(value, str) or not value:
            raise invalid("Please enter the password.")
        if len(value) > 1024:
            raise invalid("The password is too long.")
        return value
