import asyncio
import email
import email.policy
import json
import sys
import uuid
from datetime import UTC, date, datetime, timedelta
from email.message import EmailMessage
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import httpx
import jwt
import pytest
from fastapi.testclient import TestClient
from pymongo.errors import ServerSelectionTimeoutError

import config
import hash_password
import notify
import security
import server
from tests.conftest import (
    ADMIN_JWT_SECRET,
    ADMIN_PASSWORD,
    DISCORD_WEBHOOK_URL,
    REAL_DELIVER_EMAIL,
    REAL_POST_WEBHOOK,
    SITE_URL,
    make_settings,
)


def today_in(zone: str = "UTC") -> date:
    return datetime.now(ZoneInfo(zone)).date()


def future_date(days: int = 7, zone: str = "Europe/Istanbul") -> str:
    return (today_in(zone) + timedelta(days=days)).isoformat()


def appointment(**overrides):
    payload = {
        "type": "appointment",
        "name": "Ada Lovelace",
        "email": "ada@example.com",
        "contact_handle": "ada#0001",
        "service": "Web Development",
        "subject": "Kickoff call",
        "message": "Let's plan the new landing page.",
        "preferred_date": future_date(),
        "preferred_time": "14:30",
        "timezone": "Europe/Istanbul",
        "duration_minutes": 45,
        "website": "",
    }
    payload.update(overrides)
    return payload


def revision(**overrides):
    payload = {
        "type": "revision",
        "name": "Grace Hopper",
        "email": "grace@example.com",
        "subject": "Change the hero colours",
        "message": "Please make the hero section darker.",
        "project_reference": "Order #1042 - Portfolio",
    }
    payload.update(overrides)
    return payload


def inquiry(**overrides):
    payload = {
        "type": "inquiry",
        "name": "Alan Turing",
        "email": "alan@example.com",
        "subject": "Discord bot pricing",
        "message": "How much would a moderation bot cost?",
    }
    payload.update(overrides)
    return payload


def field_errors(response) -> dict[str, str]:
    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    assert isinstance(detail, list)
    for item in detail:
        assert set(item) == {"field", "message"}
        assert isinstance(item["message"], str) and item["message"]
    return {item["field"]: item["message"] for item in detail}


def stored(request_id: str):
    return asyncio.run(server.db.requests.find_one({"id": request_id}, {"_id": 0}))


def stored_count() -> int:
    return asyncio.run(server.db.requests.count_documents({}))


def email_body(message: EmailMessage) -> str:
    return message.get_content()


# Public endpoints


def test_health(api):
    response = api.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True}


@pytest.mark.parametrize(("method", "path"), [("get", "/api/"), ("post", "/api/status"), ("get", "/api/status")])
def test_template_endpoints_are_gone(api, method, path):
    response = api.request(method.upper(), path, json={"client_name": "x"})
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")
    assert stored_count() == 0


def test_create_appointment_stores_document(api):
    response = api.post("/api/requests", json=appointment(extra_field="ignored"))
    assert response.status_code == 201, response.text
    body = response.json()
    assert set(body) == {"id", "status", "created_at"}
    assert uuid.UUID(body["id"]).version == 4
    assert body["status"] == "new"
    created = datetime.fromisoformat(body["created_at"])
    assert created.utcoffset() == timedelta(0)
    assert abs(datetime.now(UTC) - created) < timedelta(seconds=10)

    doc = stored(body["id"])
    assert doc == {
        "id": body["id"],
        "type": "appointment",
        "name": "Ada Lovelace",
        "email": "ada@example.com",
        "contact_handle": "ada#0001",
        "service": "Web Development",
        "subject": "Kickoff call",
        "message": "Let's plan the new landing page.",
        "project_reference": None,
        "timezone": "Europe/Istanbul",
        "preferred_date": future_date(),
        "preferred_time": "14:30",
        "duration_minutes": 45,
        "status": "new",
        "created_at": body["created_at"],
        "updated_at": body["created_at"],
        "admin_note": "",
        "scheduled_at": None,
        "history": [],
    }


def test_create_inquiry_with_only_required_fields(api):
    response = api.post("/api/requests", json=inquiry())
    assert response.status_code == 201, response.text
    doc = stored(response.json()["id"])
    assert doc["type"] == "inquiry"
    for key in ("contact_handle", "service", "project_reference", "preferred_date", "preferred_time", "timezone", "duration_minutes"):
        assert doc[key] is None


def test_appointment_fields_are_ignored_for_other_types(api):
    response = api.post(
        "/api/requests",
        json=inquiry(preferred_date="not a date", preferred_time="99:99", timezone="Nowhere", duration_minutes=7),
    )
    assert response.status_code == 201, response.text
    doc = stored(response.json()["id"])
    assert doc["preferred_date"] is None and doc["timezone"] is None and doc["duration_minutes"] is None


def test_strings_are_stripped_and_empty_optionals_become_null(api):
    response = api.post(
        "/api/requests",
        json=inquiry(name="  Alan Turing  ", subject="\tPricing ", message="\n Hello \n", contact_handle="   ", service=""),
    )
    assert response.status_code == 201, response.text
    doc = stored(response.json()["id"])
    assert doc["name"] == "Alan Turing"
    assert doc["subject"] == "Pricing"
    assert doc["message"] == "Hello"
    assert doc["contact_handle"] is None
    assert doc["service"] is None


def test_revision_requires_project_reference(api):
    errors = field_errors(api.post("/api/requests", json=revision(project_reference="  ")))
    assert set(errors) == {"project_reference"}
    assert api.post("/api/requests", json=revision()).status_code == 201


def test_appointment_requires_date_time_and_timezone(api):
    payload = appointment()
    for key in ("preferred_date", "preferred_time", "timezone"):
        del payload[key]
    errors = field_errors(api.post("/api/requests", json=payload))
    assert set(errors) == {"preferred_date", "preferred_time", "timezone"}


def test_common_required_fields(api):
    errors = field_errors(api.post("/api/requests", json={}))
    assert set(errors) == {"type", "name", "email", "subject", "message"}
    assert errors["name"] == "Please enter your name."


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("type", "meeting"),
        ("type", 3),
        ("name", "x" * 81),
        ("name", 42),
        ("email", "not-an-email"),
        ("email", "a" * 245 + "@example.com"),
        ("email", "Ada <ada@example.com>"),
        ("contact_handle", "x" * 81),
        ("service", "Hacking"),
        ("subject", "x" * 121),
        ("subject", "   "),
        ("message", "x" * 4001),
        ("message", ""),
        ("project_reference", "x" * 121),
    ],
)
def test_field_rules(api, field, value):
    errors = field_errors(api.post("/api/requests", json=revision(**{field: value})))
    assert field in errors


def test_limits_are_inclusive(api, unlimited):
    payload = inquiry(name="n" * 80, subject="s" * 120, message="m" * 4000, contact_handle="c" * 80)
    assert api.post("/api/requests", json=payload).status_code == 201
    assert api.post("/api/requests", json=revision(project_reference="p" * 120)).status_code == 201


@pytest.mark.parametrize("service", ["Web Development", "Discord Bot", "Authentication System", "Loader / Desktop App", "Other"])
def test_every_listed_service_is_accepted(api, unlimited, service):
    assert api.post("/api/requests", json=inquiry(service=service)).status_code == 201


@pytest.mark.parametrize(
    ("field", "value"),
    [("name", "Ada\x00"), ("subject", "\x1b[31mred"), ("email", "ada@example.com\x7f"), ("contact_handle", "a\u0085da")],
)
def test_control_characters_are_rejected(api, field, value):
    errors = field_errors(api.post("/api/requests", json=appointment(**{field: value})))
    assert field in errors


def test_message_allows_newlines_and_tabs_but_not_other_control_characters(api):
    response = api.post("/api/requests", json=inquiry(message="Line one\r\nLine two\n\tindented"))
    assert response.status_code == 201
    assert stored(response.json()["id"])["message"] == "Line one\nLine two\n\tindented"
    assert "message" in field_errors(api.post("/api/requests", json=inquiry(message="Ring \x07 bell")))


def test_date_bounds(api, unlimited):
    zone = "UTC"
    today = today_in(zone)

    def submit(day):
        return api.post("/api/requests", json=appointment(timezone=zone, preferred_date=day.isoformat()))

    assert submit(today).status_code == 201
    assert submit(today + timedelta(days=120)).status_code == 201
    assert field_errors(submit(today - timedelta(days=1)))["preferred_date"] == "The date cannot be in the past."
    assert "120 days" in field_errors(submit(today + timedelta(days=121)))["preferred_date"]


def test_date_bounds_use_the_client_timezone(api, unlimited):
    for zone in ("Pacific/Kiritimati", "Pacific/Pago_Pago"):
        local_today = today_in(zone)
        ok = api.post("/api/requests", json=appointment(timezone=zone, preferred_date=local_today.isoformat()))
        assert ok.status_code == 201, ok.text
        past = api.post(
            "/api/requests", json=appointment(timezone=zone, preferred_date=(local_today - timedelta(days=1)).isoformat())
        )
        assert "preferred_date" in field_errors(past)


@pytest.mark.parametrize("value", ["2026/10/01", "01-10-2026", "2026-02-30", "20261001", "tomorrow", 20261001])
def test_bad_dates(api, value):
    assert "preferred_date" in field_errors(api.post("/api/requests", json=appointment(preferred_date=value)))


@pytest.mark.parametrize("value", ["24:00", "7:30", "14:30:00", "14:60", "2pm", ""])
def test_bad_times(api, value):
    assert "preferred_time" in field_errors(api.post("/api/requests", json=appointment(preferred_time=value)))


def test_midnight_is_a_valid_time(api):
    assert api.post("/api/requests", json=appointment(preferred_time="00:00")).status_code == 201


@pytest.mark.parametrize("value", ["Mars/Olympus_Mons", "europe/istanbul", "../../etc/passwd", "localtime", "+03:00", "x" * 65])
def test_bad_timezones(api, value):
    assert "timezone" in field_errors(api.post("/api/requests", json=appointment(timezone=value)))


def test_duration(api, unlimited):
    payload = appointment()
    del payload["duration_minutes"]
    assert stored(api.post("/api/requests", json=payload).json()["id"])["duration_minutes"] == 30
    for minutes in (15, 30, 45, 60):
        response = api.post("/api/requests", json=appointment(duration_minutes=minutes))
        assert stored(response.json()["id"])["duration_minutes"] == minutes
    for bad in (20, 0, 90, True, "long"):
        assert "duration_minutes" in field_errors(api.post("/api/requests", json=appointment(duration_minutes=bad)))


def test_invalid_json_and_non_object_bodies(api):
    response = api.post("/api/requests", content=b"{not json", headers={"content-type": "application/json"})
    assert field_errors(response) == {"body": "The request body must be valid JSON."}
    response = api.post("/api/requests", json=["not", "an", "object"])
    assert field_errors(response) == {"body": "The request body must be a JSON object."}


def test_honeypot_returns_fake_success_and_stores_nothing(api, outbox):
    response = api.post("/api/requests", json=appointment(website="https://spam.example"))
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "new"
    assert uuid.UUID(body["id"]).version == 4
    assert stored_count() == 0
    assert outbox.webhooks == [] and outbox.emails == []


def test_honeypot_is_never_stored(api):
    response = api.post("/api/requests", json=inquiry(website="   "))
    assert response.status_code == 201
    assert "website" not in stored(response.json()["id"])


def test_rate_limit(api):
    for _ in range(5):
        assert api.post("/api/requests", json=inquiry()).status_code == 201
    response = api.post("/api/requests", json=inquiry())
    assert response.status_code == 429
    assert response.json() == {"detail": "Too many requests. Please try again later."}
    assert int(response.headers["retry-after"]) > 0
    assert stored_count() == 5


def test_rate_limit_ignores_forwarded_for_unless_proxy_is_trusted(api, configure):
    for index in range(5):
        headers = {"X-Forwarded-For": f"203.0.113.{index}"}
        assert api.post("/api/requests", json=inquiry(), headers=headers).status_code == 201
    assert api.post("/api/requests", json=inquiry(), headers={"X-Forwarded-For": "198.51.100.1"}).status_code == 429

    configure(trust_proxy=True)
    for _ in range(5):
        headers = {"X-Forwarded-For": "198.51.100.7, 10.0.0.1"}
        assert api.post("/api/requests", json=inquiry(), headers=headers).status_code == 201
    assert api.post("/api/requests", json=inquiry(), headers={"X-Forwarded-For": "198.51.100.7"}).status_code == 429
    assert api.post("/api/requests", json=inquiry(), headers={"X-Forwarded-For": "198.51.100.8"}).status_code == 201


def test_rate_limiter_window_and_release():
    now = [1000.0]
    limiter = security.RateLimiter(2, 60, clock=lambda: now[0])
    assert limiter.hit("a") == 0
    assert limiter.hit("a") == 0
    assert limiter.hit("a") == 60
    assert limiter.hit("b") == 0
    now[0] += 30
    assert limiter.hit("a") == 30
    limiter.release("a")
    assert limiter.hit("a") == 0
    now[0] += 61
    assert limiter.hit("a") == 0
    assert "b" not in limiter._hits


# Notifications


def test_new_request_notifies_discord_and_email(api, outbox):
    response = api.post("/api/requests", json=appointment())
    request_id = response.json()["id"]

    assert len(outbox.webhooks) == 1
    webhook = outbox.webhooks[0]
    assert webhook["url"] == DISCORD_WEBHOOK_URL
    payload = webhook["payload"]
    assert payload["allowed_mentions"] == {"parse": []}
    assert "content" not in payload
    [embed] = payload["embeds"]
    assert embed["title"] == "New appointment request"
    assert embed["url"] == f"{SITE_URL}/admin"
    assert embed["description"] == "Let's plan the new landing page."
    assert request_id in embed["footer"]["text"]
    fields = {field["name"]: field["value"] for field in embed["fields"]}
    assert fields["Name"] == "Ada Lovelace"
    assert fields["Email"] == "ada@example.com"
    assert fields["Contact"] == "ada\\#0001"
    assert fields["Service"] == "Web Development"
    assert future_date() in fields["Preferred time"]
    assert "14:30" in fields["Preferred time"] and "Europe/Istanbul" in fields["Preferred time"]
    assert "45 minutes" in fields["Preferred time"]
    assert "<t:" in fields["Preferred time"]
    assert fields["Subject"] == "Kickoff call"
    assert f"{SITE_URL}/admin" in fields["Manage"]

    [message] = outbox.emails
    assert message["To"] == "owner@leffloard.test"
    assert message["From"].addresses[0].addr_spec == "mailer@leffloard.test"
    assert message["Reply-To"] == "Ada Lovelace <ada@example.com>"
    assert message["Subject"] == "New appointment request from Ada Lovelace: Kickoff call"
    body = email_body(message)
    for expected in (
        "Name: Ada Lovelace",
        "Email: ada@example.com",
        "Contact: ada#0001",
        "Service: Web Development",
        f"Preferred time: {future_date()} 14:30 (Europe/Istanbul)",
        "Duration: 45 minutes",
        "Subject: Kickoff call",
        "Let's plan the new landing page.",
        f"Request ID: {request_id}",
        f"{SITE_URL}/admin",
    ):
        assert expected in body


def test_revision_and_inquiry_notification_titles(api, outbox):
    api.post("/api/requests", json=revision())
    api.post("/api/requests", json=inquiry())
    titles = [webhook["payload"]["embeds"][0]["title"] for webhook in outbox.webhooks]
    assert titles == ["New revision request", "New inquiry"]
    revision_fields = {field["name"]: field["value"] for field in outbox.webhooks[0]["payload"]["embeds"][0]["fields"]}
    assert revision_fields["Project"] == "Order \\#1042 - Portfolio"
    assert "Preferred time" not in revision_fields
    assert "Project: Order #1042 - Portfolio" in email_body(outbox.emails[0])
    assert outbox.emails[1]["Subject"] == "New inquiry from Alan Turing: Discord bot pricing"


def test_admin_link_is_omitted_without_site_url(api, outbox, configure):
    configure(site_url="")
    api.post("/api/requests", json=inquiry())
    embed = outbox.webhooks[0]["payload"]["embeds"][0]
    assert "url" not in embed
    assert "Manage" not in {field["name"] for field in embed["fields"]}
    assert "/admin" not in email_body(outbox.emails[0])


@pytest.mark.parametrize(
    ("overrides", "discord", "email"),
    [
        ({"discord_webhook_url": ""}, False, True),
        ({"smtp_host": ""}, True, False),
        ({"notify_email_to": ""}, True, False),
        ({"discord_webhook_url": "", "smtp_host": ""}, False, False),
    ],
)
def test_unconfigured_channels_are_skipped(api, outbox, configure, overrides, discord, email):
    configure(**overrides)
    assert api.post("/api/requests", json=inquiry()).status_code == 201
    assert len(outbox.webhooks) == int(discord)
    assert len(outbox.emails) == int(email)


def test_notification_failures_do_not_affect_the_request(api, outbox, monkeypatch):
    async def broken_webhook(url, payload):
        raise httpx.ConnectError("discord is down")

    monkeypatch.setattr(notify, "post_webhook", broken_webhook)
    response = api.post("/api/requests", json=inquiry())
    assert response.status_code == 201
    assert stored(response.json()["id"]) is not None
    assert len(outbox.emails) == 1

    def broken_smtp(settings, message):
        raise OSError("smtp is down")

    monkeypatch.setattr(notify, "deliver_email", broken_smtp)
    assert api.post("/api/requests", json=inquiry()).status_code == 201


def test_discord_payload_neutralises_mentions_and_markdown(api, outbox):
    message = "@everyone @HERE look [click me](https://evil.example) <@123456> **bold** `code`\n# Heading\n> quote\n- item"
    api.post("/api/requests", json=inquiry(name="@everyone", subject="[x](https://evil.example)", message=message))
    payload = outbox.webhooks[0]["payload"]
    assert payload["allowed_mentions"] == {"parse": []}
    dumped = json.dumps(payload, ensure_ascii=False)
    assert "@everyone" not in dumped.lower()
    assert "@here" not in dumped.lower()
    assert "](https://evil.example)" not in dumped
    assert "<@123456>" not in dumped
    embed = payload["embeds"][0]
    assert "\\[click me\\]\\(https://evil.example\\)" in embed["description"]
    assert "\\*\\*bold\\*\\*" in embed["description"]
    assert "\\# Heading" in embed["description"]
    assert "\\> quote" in embed["description"]
    assert "\\- item" in embed["description"]


def test_discord_payload_respects_size_limits(api, outbox):
    api.post("/api/requests", json=appointment(message="*_" * 2000, subject="_" * 120, name="*" * 80))
    embed = outbox.webhooks[0]["payload"]["embeds"][0]
    assert len(embed["description"]) <= 4096
    assert all(len(field["value"]) <= 1024 and len(field["name"]) <= 256 for field in embed["fields"])
    total = len(embed["title"]) + len(embed["description"]) + len(embed["footer"]["text"])
    total += sum(len(field["name"]) + len(field["value"]) for field in embed["fields"])
    assert total <= 6000
    assert len(embed["fields"]) <= 25


def test_post_webhook_raises_on_error_status(monkeypatch):
    calls = []

    def handler(request):
        calls.append(json.loads(request.content))
        return httpx.Response(204 if len(calls) == 1 else 400, text="bad embed")

    original = httpx.AsyncClient
    monkeypatch.setattr(notify.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    asyncio.run(REAL_POST_WEBHOOK(DISCORD_WEBHOOK_URL, {"embeds": []}))
    with pytest.raises(notify.WebhookError, match="400"):
        asyncio.run(REAL_POST_WEBHOOK(DISCORD_WEBHOOK_URL, {"embeds": []}))
    assert calls == [{"embeds": []}, {"embeds": []}]


def non_ascii_doc(subject: str) -> dict:
    return {
        "id": "abc",
        "type": "inquiry",
        "name": "Şükrü Öztürk",
        "email": "sukru@example.com",
        "subject": subject,
        "message": "Merhaba, çalışma saatleriniz nedir?",
        "status": "confirmed",
        "created_at": "2026-09-25T21:27:15.399+00:00",
        "scheduled_at": None,
    }


def roundtrip(message: EmailMessage) -> EmailMessage:
    return email.message_from_bytes(message.as_bytes(), policy=email.policy.default)


def test_emails_encode_non_ascii_text():
    settings = make_settings()
    doc = non_ascii_doc("Görüşme")
    owner = roundtrip(notify.build_owner_email(doc, settings))
    assert owner["Subject"] == "New inquiry from Şükrü Öztürk: Görüşme"
    assert owner["Reply-To"].addresses[0].display_name == "Şükrü Öztürk"
    assert "Merhaba, çalışma saatleriniz nedir?" in owner.get_content()
    client = roundtrip(notify.build_client_email(doc, settings, "Teşekkürler"))
    assert client["To"].addresses[0].display_name == "Şükrü Öztürk"
    assert "Teşekkürler" in client.get_content()


@pytest.mark.skipif(sys.version_info < (3, 13), reason="CPython < 3.13 drops a space when folding encoded words")
def test_long_non_ascii_subject_survives_folding():
    subject = "Bot için görüşme ve çok uzun bir konu satırı " * 2
    owner = roundtrip(notify.build_owner_email(non_ascii_doc(subject.strip()), make_settings()))
    assert owner["Subject"] == f"New inquiry from Şükrü Öztürk: {subject.strip()}"


class FakeSMTP:
    instances: list["FakeSMTP"] = []

    def __init__(self, host, port, timeout=None, context=None):
        self.host, self.port, self.context = host, port, context
        self.actions = []
        FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.actions.append("quit")

    def starttls(self, context=None):
        self.actions.append("starttls")

    def login(self, username, password):
        self.actions.append(("login", username, password))

    def send_message(self, message):
        self.actions.append(("send", message["To"]))


class FakeSMTPSSL(FakeSMTP):
    pass


@pytest.mark.parametrize(
    ("security_mode", "username", "expected_class", "expected_actions"),
    [
        ("starttls", "mailer", FakeSMTP, ["starttls", ("login", "mailer", "secret"), ("send", "x@example.com"), "quit"]),
        ("ssl", "mailer", FakeSMTPSSL, [("login", "mailer", "secret"), ("send", "x@example.com"), "quit"]),
        ("none", "", FakeSMTP, [("send", "x@example.com"), "quit"]),
    ],
)
def test_deliver_email_uses_configured_security(monkeypatch, security_mode, username, expected_class, expected_actions):
    FakeSMTP.instances = []
    monkeypatch.setattr(notify.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(notify.smtplib, "SMTP_SSL", FakeSMTPSSL)
    settings = make_settings(smtp_security=security_mode, smtp_username=username, smtp_password="secret", smtp_port=2525)
    message = notify.new_email(settings, to="x@example.com", subject="Hi", body="Hello")
    REAL_DELIVER_EMAIL(settings, message)
    [smtp] = FakeSMTP.instances
    assert type(smtp) is expected_class
    assert (smtp.host, smtp.port) == ("smtp.leffloard.test", 2525)
    assert smtp.actions == expected_actions


# Admin authentication


@pytest.mark.parametrize("overrides", [{"admin_password_hash": ""}, {"admin_jwt_secret": ""}])
def test_admin_is_unavailable_when_not_configured(api, configure, overrides):
    configure(**overrides)
    expected = {"detail": "Admin panel is not configured."}
    for method, path, body in (
        ("POST", "/api/admin/login", {"password": ADMIN_PASSWORD}),
        ("GET", "/api/admin/me", None),
        ("GET", "/api/admin/requests", None),
        ("GET", "/api/admin/requests/abc", None),
        ("PATCH", "/api/admin/requests/abc", {"status": "confirmed"}),
        ("DELETE", "/api/admin/requests/abc", None),
    ):
        response = api.request(method, path, json=body)
        assert response.status_code == 503, (method, path)
        assert response.json() == expected


def test_login_success(api):
    response = api.post("/api/admin/login", json={"password": ADMIN_PASSWORD})
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"token", "expires_at"}
    expires_at = datetime.fromisoformat(body["expires_at"])
    assert timedelta(hours=11, minutes=59) < expires_at - datetime.now(UTC) <= timedelta(hours=12)
    claims = jwt.decode(body["token"], ADMIN_JWT_SECRET, algorithms=["HS256"])
    assert claims["exp"] == int(expires_at.timestamp())


def test_login_failures(api):
    assert api.post("/api/admin/login", json={"password": "wrong"}).status_code == 401
    assert api.post("/api/admin/login", json={"password": ADMIN_PASSWORD + "x" * 80}).status_code == 401
    assert "password" in field_errors(api.post("/api/admin/login", json={}))
    assert "password" in field_errors(api.post("/api/admin/login", json={"password": ""}))


def test_login_rate_limit(api):
    for _ in range(3):
        assert api.post("/api/admin/login", json={"password": ADMIN_PASSWORD}).status_code == 200
    for _ in range(5):
        assert api.post("/api/admin/login", json={"password": "guess"}).status_code == 401
    response = api.post("/api/admin/login", json={"password": ADMIN_PASSWORD})
    assert response.status_code == 429
    assert response.json() == {"detail": "Too many login attempts. Please try again later."}
    assert int(response.headers["retry-after"]) > 0


def test_password_matches_handles_long_and_invalid_input():
    password_hash = security.hash_password("short")
    assert security.password_matches("short", password_hash)
    assert not security.password_matches("short" + "x" * 100, password_hash)
    exact = "y" * 72
    assert not security.password_matches(exact + "z", security.hash_password(exact))
    assert not security.password_matches("short", "not-a-hash")


def expired_token() -> str:
    past = datetime.now(UTC) - timedelta(hours=13)
    return jwt.encode({"sub": "admin", "iat": past, "exp": past + timedelta(hours=12)}, ADMIN_JWT_SECRET, algorithm="HS256")


@pytest.mark.parametrize(
    "authorization",
    [
        None,
        "",
        "Bearer",
        "Bearer not-a-jwt",
        "Basic YWRtaW46YWRtaW4=",
        "Bearer " + jwt.encode({"sub": "admin", "iat": 0, "exp": 4_000_000_000}, "another-secret-" + "y" * 40, algorithm="HS256"),
        "Bearer " + jwt.encode({"sub": "someone", "iat": 0, "exp": 4_000_000_000}, ADMIN_JWT_SECRET, algorithm="HS256"),
        "Bearer " + jwt.encode({"sub": "admin", "iat": 0}, ADMIN_JWT_SECRET, algorithm="HS256"),
        "expired",
    ],
)
def test_admin_requires_valid_token(api, authorization):
    if authorization == "expired":
        authorization = f"Bearer {expired_token()}"
    headers = {"Authorization": authorization} if authorization is not None else {}
    for method, path in (("GET", "/api/admin/me"), ("GET", "/api/admin/requests"), ("DELETE", "/api/admin/requests/x")):
        response = api.request(method, path, headers=headers)
        assert response.status_code == 401
        assert response.json() == {"detail": "Not authenticated."}
        assert response.headers["www-authenticate"] == "Bearer"


def test_token_is_rejected_after_secret_rotation(api, token, configure):
    configure(admin_jwt_secret="rotated-secret-" + "z" * 40)
    assert api.get("/api/admin/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_admin_me_reports_notification_channels(admin, configure):
    assert admin.get("/api/admin/me").json() == {"notifications": {"discord": True, "email": True}}
    configure(discord_webhook_url="", notify_email_to="")
    assert admin.get("/api/admin/me").json() == {"notifications": {"discord": False, "email": False}}


# Admin request management


def seed(api) -> dict[str, str]:
    ids = {}
    for key, payload in (
        ("appointment", appointment(name="Ada Lovelace", subject="Kickoff call")),
        ("revision", revision(name="Grace Hopper", project_reference="Shop (v2.0)")),
        ("inquiry", inquiry(name="Alan Turing", email="ALAN@Example.com")),
        ("second_inquiry", inquiry(name="Barbara Liskov", email="barbara@example.org", subject="Loader app")),
    ):
        response = api.post("/api/requests", json=payload)
        assert response.status_code == 201
        ids[key] = response.json()["id"]
    return ids


def test_list_newest_first_with_counts(admin, unlimited):
    ids = seed(admin)
    body = admin.get("/api/admin/requests").json()
    assert body["total"] == 4
    assert [item["id"] for item in body["items"]] == [
        ids["second_inquiry"],
        ids["inquiry"],
        ids["revision"],
        ids["appointment"],
    ]
    assert body["counts"] == {"new": 4, "confirmed": 0, "declined": 0, "completed": 0}
    assert all("_id" not in item for item in body["items"])


def test_list_filters_search_and_pagination(admin, unlimited):
    ids = seed(admin)
    admin.patch(f"/api/admin/requests/{ids['revision']}", json={"status": "confirmed"})
    admin.patch(f"/api/admin/requests/{ids['inquiry']}", json={"status": "declined"})

    def listing(**params):
        response = admin.get("/api/admin/requests", params=params)
        assert response.status_code == 200, response.text
        return response.json()

    confirmed = listing(status="confirmed")
    assert [item["id"] for item in confirmed["items"]] == [ids["revision"]]
    assert confirmed["total"] == 1
    assert confirmed["counts"] == {"new": 2, "confirmed": 1, "declined": 1, "completed": 0}

    inquiries = listing(type="inquiry")
    assert {item["id"] for item in inquiries["items"]} == {ids["inquiry"], ids["second_inquiry"]}
    assert inquiries["counts"] == {"new": 1, "confirmed": 0, "declined": 1, "completed": 0}

    assert [item["id"] for item in listing(q="alan@EXAMPLE")["items"]] == [ids["inquiry"]]
    assert [item["id"] for item in listing(q="kickoff")["items"]] == [ids["appointment"]]
    assert [item["id"] for item in listing(q="(v2.0)")["items"]] == [ids["revision"]]
    assert listing(q="v2x0")["total"] == 0
    assert listing(q=".*")["total"] == 0
    assert listing(q="liskov", status="new")["total"] == 1
    assert listing(status="", type="", q="")["total"] == 4

    page_one = listing(limit=3, page=1)
    page_two = listing(limit=3, page=2)
    assert len(page_one["items"]) == 3 and len(page_two["items"]) == 1
    assert page_one["total"] == page_two["total"] == 4
    assert page_two["items"][0]["id"] == ids["appointment"]
    assert listing(limit=3, page=5)["items"] == []


@pytest.mark.parametrize(
    ("params", "field"),
    [({"status": "archived"}, "status"), ({"type": "call"}, "type"), ({"page": 0}, "page"), ({"limit": 101}, "limit"), ({"limit": "x"}, "limit")],
)
def test_list_rejects_bad_query(admin, params, field):
    assert field in field_errors(admin.get("/api/admin/requests", params=params))


def test_get_single_request(admin):
    request_id = admin.post("/api/requests", json=revision()).json()["id"]
    response = admin.get(f"/api/admin/requests/{request_id}")
    assert response.status_code == 200
    assert response.json()["project_reference"] == "Order #1042 - Portfolio"
    assert "_id" not in response.json()
    missing = admin.get("/api/admin/requests/does-not-exist")
    assert missing.status_code == 404
    assert missing.json() == {"detail": "Request not found."}


def test_patch_status_note_and_schedule(admin, outbox):
    request_id = admin.post("/api/requests", json=appointment()).json()["id"]
    created = stored(request_id)
    outbox.emails.clear()

    response = admin.patch(
        f"/api/admin/requests/{request_id}",
        json={"status": "confirmed", "admin_note": "  Bring the brand guide.\nCall on Discord  ", "scheduled_at": "2026-10-01T14:30:00+03:00"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "confirmed"
    assert body["admin_note"] == "Bring the brand guide.\nCall on Discord"
    assert body["scheduled_at"] == "2026-10-01T11:30:00+00:00"
    assert body["client_notified"] is False
    assert body["updated_at"] > created["updated_at"]
    [entry] = body["history"]
    assert entry["status"] == "confirmed" and entry["from"] == "new"
    assert entry["at"] == body["updated_at"]
    assert outbox.emails == []
    assert stored(request_id) == {key: value for key, value in body.items() if key != "client_notified"}

    same = admin.patch(f"/api/admin/requests/{request_id}", json={"status": "confirmed"}).json()
    assert len(same["history"]) == 1
    assert same["updated_at"] == body["updated_at"]

    done = admin.patch(f"/api/admin/requests/{request_id}", json={"status": "completed", "scheduled_at": None, "admin_note": ""}).json()
    assert [item["status"] for item in done["history"]] == ["confirmed", "completed"]
    assert done["history"][1]["from"] == "confirmed"
    assert done["scheduled_at"] is None
    assert done["admin_note"] == ""


def test_patch_accepts_utc_z_suffix(admin):
    request_id = admin.post("/api/requests", json=appointment()).json()["id"]
    body = admin.patch(f"/api/admin/requests/{request_id}", json={"scheduled_at": "2026-10-01T09:00:00Z"}).json()
    assert body["scheduled_at"] == "2026-10-01T09:00:00+00:00"


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"status": "archived"}, "status"),
        ({"admin_note": "x" * 2001}, "admin_note"),
        ({"client_message": "x" * 2001}, "client_message"),
        ({"scheduled_at": "2026-10-01T14:30:00"}, "scheduled_at"),
        ({"scheduled_at": "next friday"}, "scheduled_at"),
        ({"notify_client": "maybe"}, "notify_client"),
    ],
)
def test_patch_validation(admin, payload, field):
    request_id = admin.post("/api/requests", json=appointment()).json()["id"]
    assert field in field_errors(admin.patch(f"/api/admin/requests/{request_id}", json=payload))


def test_only_appointments_can_be_scheduled(admin):
    request_id = admin.post("/api/requests", json=inquiry()).json()["id"]
    errors = field_errors(admin.patch(f"/api/admin/requests/{request_id}", json={"scheduled_at": "2026-10-01T09:00:00Z"}))
    assert errors == {"scheduled_at": "Only appointments can be scheduled."}
    assert admin.patch(f"/api/admin/requests/{request_id}", json={"scheduled_at": None}).status_code == 200


def test_patch_unknown_request(admin):
    response = admin.patch("/api/admin/requests/nope", json={"status": "confirmed"})
    assert response.status_code == 404
    assert response.json() == {"detail": "Request not found."}


def test_patch_notifies_client(admin, outbox):
    request_id = admin.post("/api/requests", json=appointment()).json()["id"]
    outbox.emails.clear()
    response = admin.patch(
        f"/api/admin/requests/{request_id}",
        json={
            "status": "confirmed",
            "scheduled_at": "2026-10-01T11:30:00Z",
            "notify_client": True,
            "client_message": "See you on Google Meet.",
        },
    )
    assert response.status_code == 200
    assert response.json()["client_notified"] is True
    [message] = outbox.emails
    assert message["To"] == "Ada Lovelace <ada@example.com>"
    assert message["Reply-To"] == "owner@leffloard.test"
    assert message["Subject"] == "Your appointment request: confirmed"
    body = email_body(message)
    assert 'Your appointment request "Kickoff call" has been confirmed.' in body
    assert "Thursday, 1 October 2026 at 14:30 (Europe/Istanbul)" in body
    assert "Duration: 45 minutes" in body
    assert "See you on Google Meet." in body
    assert SITE_URL in body


def test_patch_client_email_for_other_types(admin, outbox):
    request_id = admin.post("/api/requests", json=revision()).json()["id"]
    outbox.emails.clear()
    body = admin.patch(f"/api/admin/requests/{request_id}", json={"status": "declined", "notify_client": True}).json()
    assert body["client_notified"] is True
    assert outbox.emails[0]["Subject"] == "Your revision request: declined"
    assert "Scheduled time" not in email_body(outbox.emails[0])


def test_patch_client_notification_without_smtp_or_on_failure(admin, outbox, configure, monkeypatch):
    request_id = admin.post("/api/requests", json=appointment()).json()["id"]
    outbox.emails.clear()
    configure(smtp_host="")
    body = admin.patch(f"/api/admin/requests/{request_id}", json={"status": "confirmed", "notify_client": True}).json()
    assert body["client_notified"] is False
    assert body["status"] == "confirmed"
    assert outbox.emails == []

    configure()

    def broken_smtp(settings, message):
        raise OSError("smtp is down")

    monkeypatch.setattr(notify, "deliver_email", broken_smtp)
    response = admin.patch(f"/api/admin/requests/{request_id}", json={"notify_client": True})
    assert response.status_code == 200
    assert response.json()["client_notified"] is False


def test_delete(admin):
    request_id = admin.post("/api/requests", json=inquiry()).json()["id"]
    response = admin.delete(f"/api/admin/requests/{request_id}")
    assert response.status_code == 204
    assert response.content == b""
    assert admin.get(f"/api/admin/requests/{request_id}").status_code == 404
    assert admin.delete(f"/api/admin/requests/{request_id}").status_code == 404


# Errors, CORS and the single-server frontend


class BrokenCollection:
    def __init__(self, error: Exception, index_error: Exception | None = None):
        self.error = error
        self.index_error = index_error

    async def create_index(self, *args, **kwargs):
        if self.index_error:
            raise self.index_error

    async def insert_one(self, *args, **kwargs):
        raise self.error

    async def find_one(self, *args, **kwargs):
        raise self.error


def test_database_errors_do_not_leak_details(token, monkeypatch):
    error = ServerSelectionTimeoutError("localhost:27017: connection refused, Timeout: 10s")
    monkeypatch.setattr(server, "db", SimpleNamespace(requests=BrokenCollection(error, index_error=error)))
    with TestClient(server.app) as client:
        response = client.post("/api/requests", json=inquiry())
        assert response.status_code == 503
        assert response.json() == {"detail": "The service is temporarily unavailable. Please try again later."}
        assert "27017" not in response.text
        assert client.get("/api/health").json() == {"ok": True}


def test_unexpected_errors_return_generic_json(token, monkeypatch):
    monkeypatch.setattr(server, "db", SimpleNamespace(requests=BrokenCollection(RuntimeError("secret internals"))))
    with TestClient(server.app, raise_server_exceptions=False) as client:
        response = client.get("/api/admin/requests/x", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 500
    assert response.json() == {"detail": "Internal server error."}
    assert "secret internals" not in response.text and "Traceback" not in response.text


def test_cors(api):
    allowed = api.options(
        "/api/requests",
        headers={"Origin": "https://frontend.example", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"},
    )
    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "https://frontend.example"
    assert "access-control-allow-credentials" not in allowed.headers
    denied = api.options(
        "/api/requests",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
    )
    assert "access-control-allow-origin" not in denied.headers


@pytest.mark.parametrize("path", ["/", "/pricing", "/blog/1", "/admin", "/admin/requests/abc", "/assets/missing.js"])
def test_spa_routes_serve_index(api, path):
    response = api.get(path)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert '<div id="root"></div>' in response.text
    assert response.headers["cache-control"] == "no-cache"


def test_real_files_are_served(api):
    script = api.get("/assets/index-abc123.js")
    assert script.status_code == 200
    assert script.text == "console.log('leffloard');\n"
    assert "javascript" in script.headers["content-type"]
    assert "immutable" in script.headers["cache-control"]
    robots = api.get("/robots.txt")
    assert robots.status_code == 200 and robots.text.startswith("User-agent")


@pytest.mark.parametrize(("method", "path"), [("GET", "/api/unknown"), ("GET", "/api"), ("POST", "/api/unknown"), ("GET", "/api/admin/unknown/x")])
def test_unknown_api_paths_stay_json(api, method, path):
    response = api.request(method, path)
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")
    assert response.json() == {"detail": "Not Found"}


def test_path_traversal_is_not_served(api):
    response = api.get("/..%2F..%2Fetc%2Fpasswd")
    assert "root:" not in response.text


# Configuration and tooling


def test_load_settings(monkeypatch, tmp_path):
    for name in list(config.os.environ):
        if name.startswith(("SMTP_", "ADMIN_", "DISCORD_", "SITE_", "NOTIFY_", "TRUST_", "CORS_", "FRONTEND_")):
            monkeypatch.delenv(name)
    settings = config.load_settings()
    assert not settings.admin_enabled and not settings.discord_enabled and not settings.owner_email_enabled
    assert settings.problems == ()
    assert settings.frontend_dist == (config.ROOT_DIR.parent / "frontend" / "dist").resolve()

    monkeypatch.setenv("ADMIN_PASSWORD_HASH", security.hash_password("pw"))
    monkeypatch.setenv("ADMIN_JWT_SECRET", "s" * 32)
    monkeypatch.setenv("SMTP_HOST", "smtp.gmail.com")
    monkeypatch.setenv("SMTP_USERNAME", "me@gmail.com")
    monkeypatch.setenv("SMTP_SECURITY", "SSL")
    monkeypatch.setenv("NOTIFY_EMAIL_TO", "me@gmail.com")
    monkeypatch.setenv("SITE_URL", "leffloard.xyz/")
    monkeypatch.setenv("CORS_ORIGINS", "https://a.example/, https://b.example")
    monkeypatch.setenv("TRUST_PROXY", "1")
    monkeypatch.setenv("FRONTEND_DIST", str(tmp_path))
    settings = config.load_settings()
    assert settings.admin_enabled and settings.owner_email_enabled
    assert (settings.smtp_security, settings.smtp_port, settings.smtp_from) == ("ssl", 465, "me@gmail.com")
    assert settings.site_url == "https://leffloard.xyz"
    assert settings.cors_origins == ("https://a.example", "https://b.example")
    assert settings.trust_proxy is True
    assert settings.frontend_dist == tmp_path.resolve()

    monkeypatch.setenv("ADMIN_PASSWORD_HASH", "plain-text-password")
    monkeypatch.setenv("ADMIN_JWT_SECRET", "too-short")
    monkeypatch.setenv("SMTP_SECURITY", "tls")
    settings = config.load_settings()
    assert not settings.admin_enabled and not settings.smtp_enabled
    assert len(settings.problems) == 3


def test_settings_repr_hides_secrets():
    text = repr(make_settings(mongo_url="mongodb+srv://user:hunter2@cluster.example", smtp_password="app-password"))
    for secret in ("hunter2", "app-password", "test-secret-", "discord.test", "$2b$"):
        assert secret not in text


def test_hash_password_cli(monkeypatch, capsys):
    answers = iter(["s3cret-passphrase", "s3cret-passphrase"])
    monkeypatch.setattr(hash_password.getpass, "getpass", lambda prompt="": next(answers))
    monkeypatch.setattr(sys, "argv", ["hash_password.py", "--secret"])
    assert hash_password.main() == 0
    lines = dict(line.split("=", 1) for line in capsys.readouterr().out.splitlines() if "=" in line)
    assert security.password_matches("s3cret-passphrase", lines["ADMIN_PASSWORD_HASH"])
    assert config.BCRYPT_HASH_PATTERN.match(lines["ADMIN_PASSWORD_HASH"])
    assert len(lines["ADMIN_JWT_SECRET"]) >= 32


def test_hash_password_cli_rejects_mismatch(monkeypatch, capsys):
    answers = iter(["first-password", "second-password"])
    monkeypatch.setattr(hash_password.getpass, "getpass", lambda prompt="": next(answers))
    monkeypatch.setattr(sys, "argv", ["hash_password.py"])
    assert hash_password.main() == 1
    assert "ADMIN_PASSWORD_HASH" not in capsys.readouterr().out
