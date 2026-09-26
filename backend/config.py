import os
import re
from dataclasses import dataclass, field
from pathlib import Path

ROOT_DIR = Path(__file__).parent

SMTP_SECURITY_MODES = ("starttls", "ssl", "none")
DEFAULT_SMTP_PORTS = {"starttls": 587, "ssl": 465, "none": 25}
MIN_JWT_SECRET_LENGTH = 32
DEFAULT_MONGO_URL = "mongodb://localhost:27017"
DEFAULT_DB_NAME = "leffloard"
BCRYPT_HASH_PATTERN = re.compile(r"^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$")
MAX_TRUSTED_PROXIES = 5


def _env(name: str) -> str:
    return os.environ.get(name, "").strip()


@dataclass(frozen=True)
class Settings:
    mongo_url: str = field(default=DEFAULT_MONGO_URL, repr=False)
    db_name: str = DEFAULT_DB_NAME
    cors_origins: tuple[str, ...] = ()
    site_url: str = ""
    admin_password_hash: str = field(default="", repr=False)
    admin_jwt_secret: str = field(default="", repr=False)
    discord_webhook_url: str = field(default="", repr=False)
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = field(default="", repr=False)
    smtp_from: str = ""
    smtp_security: str = "starttls"
    notify_email_to: str = ""
    trusted_proxies: int = 0
    frontend_dist: Path = ROOT_DIR.parent / "frontend" / "dist"
    problems: tuple[str, ...] = field(default=(), compare=False)

    @property
    def admin_enabled(self) -> bool:
        return bool(self.admin_password_hash and self.admin_jwt_secret)

    @property
    def discord_enabled(self) -> bool:
        return bool(self.discord_webhook_url)

    @property
    def smtp_enabled(self) -> bool:
        return bool(self.smtp_host and self.smtp_from)

    @property
    def owner_email_enabled(self) -> bool:
        return self.smtp_enabled and bool(self.notify_email_to)


def _trusted_proxies(value: str, problems: list[str]) -> int:
    value = value.lower()
    if value in ("", "0", "false", "no", "off"):
        return 0
    if value in ("true", "yes", "on"):
        return 1
    if value.isdigit() and int(value) <= MAX_TRUSTED_PROXIES:
        return int(value)
    problems.append(
        f"TRUST_PROXY must be 0 or the number of proxies in front of the app (1-{MAX_TRUSTED_PROXIES}). "
        "Rate limiting uses the connecting address."
    )
    return 0


def load_settings() -> Settings:
    problems: list[str] = []

    password_hash = _env("ADMIN_PASSWORD_HASH")
    if password_hash and not BCRYPT_HASH_PATTERN.match(password_hash):
        problems.append(
            "ADMIN_PASSWORD_HASH is not a bcrypt hash; generate one with hash_password.py. "
            "The admin panel is disabled."
        )
        password_hash = ""

    jwt_secret = _env("ADMIN_JWT_SECRET")
    if jwt_secret and len(jwt_secret) < MIN_JWT_SECRET_LENGTH:
        problems.append(
            f"ADMIN_JWT_SECRET must be at least {MIN_JWT_SECRET_LENGTH} characters long. "
            "The admin panel is disabled."
        )
        jwt_secret = ""

    discord_webhook_url = _env("DISCORD_WEBHOOK_URL")
    if discord_webhook_url and not discord_webhook_url.startswith("https://"):
        problems.append("DISCORD_WEBHOOK_URL must start with https://. Discord notifications are disabled.")
        discord_webhook_url = ""

    smtp_host = _env("SMTP_HOST")
    smtp_security = _env("SMTP_SECURITY").lower() or "starttls"
    if smtp_security not in SMTP_SECURITY_MODES:
        problems.append(
            f"SMTP_SECURITY must be one of {', '.join(SMTP_SECURITY_MODES)}. Email notifications are disabled."
        )
        smtp_host = ""
        smtp_security = "starttls"

    smtp_port = DEFAULT_SMTP_PORTS[smtp_security]
    raw_port = _env("SMTP_PORT")
    if raw_port:
        if raw_port.isdigit() and 0 < int(raw_port) < 65536:
            smtp_port = int(raw_port)
        else:
            problems.append("SMTP_PORT must be a port number. Email notifications are disabled.")
            smtp_host = ""

    smtp_username = _env("SMTP_USERNAME")
    smtp_from = _env("SMTP_FROM") or smtp_username
    if smtp_host and not smtp_from:
        problems.append("Set SMTP_FROM (or SMTP_USERNAME) to send email notifications.")

    site_url = _env("SITE_URL").rstrip("/")
    if site_url and not site_url.startswith(("http://", "https://")):
        site_url = f"https://{site_url}"

    trusted_proxies = _trusted_proxies(_env("TRUST_PROXY"), problems)

    frontend_dist = Path(_env("FRONTEND_DIST") or ROOT_DIR.parent / "frontend" / "dist")
    if not frontend_dist.is_absolute():
        frontend_dist = ROOT_DIR / frontend_dist

    return Settings(
        mongo_url=_env("MONGO_URL") or DEFAULT_MONGO_URL,
        db_name=_env("DB_NAME") or DEFAULT_DB_NAME,
        cors_origins=tuple(origin.strip().rstrip("/") for origin in _env("CORS_ORIGINS").split(",") if origin.strip()),
        site_url=site_url,
        admin_password_hash=password_hash,
        admin_jwt_secret=jwt_secret,
        discord_webhook_url=discord_webhook_url,
        smtp_host=smtp_host,
        smtp_port=smtp_port,
        smtp_username=smtp_username,
        smtp_password=os.environ.get("SMTP_PASSWORD", ""),
        smtp_from=smtp_from,
        smtp_security=smtp_security,
        notify_email_to=_env("NOTIFY_EMAIL_TO"),
        trusted_proxies=trusted_proxies,
        frontend_dist=frontend_dist.resolve(),
        problems=tuple(problems),
    )

