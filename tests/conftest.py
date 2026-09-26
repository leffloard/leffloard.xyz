import atexit
import os
import shutil
import tempfile
from pathlib import Path
from types import SimpleNamespace

import bcrypt
import pytest

FRONTEND_DIST = Path(tempfile.mkdtemp(prefix="leffloard-dist-"))
atexit.register(shutil.rmtree, FRONTEND_DIST, ignore_errors=True)
(FRONTEND_DIST / "index.html").write_text("<!doctype html><title>leffloard</title><div id=\"root\"></div>\n")
(FRONTEND_DIST / "assets").mkdir()
(FRONTEND_DIST / "assets" / "index-abc123.js").write_text("console.log('leffloard');\n")
(FRONTEND_DIST / "robots.txt").write_text("User-agent: *\nAllow: /\n")

os.environ["FRONTEND_DIST"] = str(FRONTEND_DIST)
os.environ["CORS_ORIGINS"] = "https://frontend.example"

from fastapi.testclient import TestClient  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

import notify  # noqa: E402
import security  # noqa: E402
import server  # noqa: E402
from config import Settings  # noqa: E402

ADMIN_PASSWORD = "correct horse battery staple"
ADMIN_PASSWORD_HASH = bcrypt.hashpw(ADMIN_PASSWORD.encode(), bcrypt.gensalt(rounds=4)).decode()
ADMIN_JWT_SECRET = "test-secret-" + "x" * 40
DISCORD_WEBHOOK_URL = "https://discord.test/api/webhooks/1/token"
SITE_URL = "https://leffloard.test"

REAL_POST_WEBHOOK = notify.post_webhook
REAL_DELIVER_EMAIL = notify.deliver_email


def make_settings(**overrides) -> Settings:
    values = dict(
        site_url=SITE_URL,
        admin_password_hash=ADMIN_PASSWORD_HASH,
        admin_jwt_secret=ADMIN_JWT_SECRET,
        discord_webhook_url=DISCORD_WEBHOOK_URL,
        smtp_host="smtp.leffloard.test",
        smtp_port=587,
        smtp_username="mailer@leffloard.test",
        smtp_password="app-password",
        smtp_from="leffloard.xyz <mailer@leffloard.test>",
        smtp_security="starttls",
        notify_email_to="owner@leffloard.test",
        frontend_dist=FRONTEND_DIST,
    )
    values.update(overrides)
    return Settings(**values)


@pytest.fixture(autouse=True)
def app_state(monkeypatch):
    monkeypatch.setattr(server, "db", AsyncMongoMockClient()["leffloard_test"])
    monkeypatch.setattr(server, "settings", make_settings())
    monkeypatch.setattr(server, "submission_limiter", security.RateLimiter(5, 600))
    monkeypatch.setattr(server, "login_limiter", security.RateLimiter(5, 900))


@pytest.fixture(autouse=True)
def outbox(monkeypatch):
    sent = SimpleNamespace(webhooks=[], emails=[])

    async def fake_post_webhook(url, payload):
        sent.webhooks.append({"url": url, "payload": payload})

    def fake_deliver_email(settings, message):
        sent.emails.append(message)

    monkeypatch.setattr(notify, "post_webhook", fake_post_webhook)
    monkeypatch.setattr(notify, "deliver_email", fake_deliver_email)
    return sent


@pytest.fixture
def configure(monkeypatch):
    def apply(**overrides) -> Settings:
        settings = make_settings(**overrides)
        monkeypatch.setattr(server, "settings", settings)
        return settings

    return apply


@pytest.fixture
def api():
    with TestClient(server.app) as client:
        yield client


@pytest.fixture
def unlimited(monkeypatch):
    monkeypatch.setattr(server, "submission_limiter", security.RateLimiter(10_000, 600))


@pytest.fixture
def token(api):
    response = api.post("/api/admin/login", json={"password": ADMIN_PASSWORD})
    assert response.status_code == 200, response.text
    return response.json()["token"]


@pytest.fixture
def admin(api, token):
    api.headers["Authorization"] = f"Bearer {token}"
    return api
