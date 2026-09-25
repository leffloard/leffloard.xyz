import asyncio
import logging
import re
import smtplib
import ssl
from datetime import UTC, datetime
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid, parseaddr
from typing import Any, Optional
from zoneinfo import ZoneInfo

import httpx

from config import Settings

logger = logging.getLogger(__name__)

OWNER_NAME = "Mert Kaan Koparan"
TITLES = {
    "appointment": "New appointment request",
    "revision": "New revision request",
    "inquiry": "New inquiry",
}
TYPE_LABELS = {
    "appointment": "appointment request",
    "revision": "revision request",
    "inquiry": "inquiry",
}
COLORS = {"appointment": 0x22D3EE, "revision": 0xF59E0B, "inquiry": 0xA78BFA}
STATUS_PHRASES = {
    "new": "is waiting for review",
    "confirmed": "has been confirmed",
    "declined": "has been declined",
    "completed": "has been marked as completed",
}

DISCORD_DESCRIPTION_LIMIT = 3000
DISCORD_FIELD_LIMIT = 1024
WEBHOOK_TIMEOUT_SECONDS = 10
SMTP_TIMEOUT_SECONDS = 20

MARKDOWN_CHARACTERS = re.compile(r"([\\`*_~|\[\]()<>#])")
LIST_MARKERS = re.compile(r"(?m)^(\s*)([-+])(?=\s)")
MASS_MENTIONS = re.compile(r"@(everyone|here)", re.IGNORECASE)


class WebhookError(Exception):
    pass


def truncate(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def discord_safe(text: str, limit: int = DISCORD_FIELD_LIMIT) -> str:
    text = MARKDOWN_CHARACTERS.sub(r"\\\1", text)
    text = LIST_MARKERS.sub(r"\1\\\2", text)
    text = MASS_MENTIONS.sub("@​\\1", text)
    return truncate(text, limit)


def appointment_start(doc: dict[str, Any]) -> Optional[datetime]:
    try:
        naive = datetime.fromisoformat(f"{doc['preferred_date']}T{doc['preferred_time']}")
        return naive.replace(tzinfo=ZoneInfo(doc["timezone"]))
    except (KeyError, TypeError, ValueError):
        return None


def describe_slot(doc: dict[str, Any]) -> str:
    return f"{doc['preferred_date']} {doc['preferred_time']} ({doc['timezone']}), {doc['duration_minutes']} minutes"


def build_discord_payload(doc: dict[str, Any], site_url: str) -> dict[str, Any]:
    fields = [
        {"name": "Name", "value": discord_safe(doc["name"]), "inline": True},
        {"name": "Email", "value": discord_safe(doc["email"]), "inline": True},
    ]
    if doc.get("contact_handle"):
        fields.append({"name": "Contact", "value": discord_safe(doc["contact_handle"]), "inline": True})
    if doc.get("service"):
        fields.append({"name": "Service", "value": discord_safe(doc["service"]), "inline": True})
    if doc["type"] == "appointment":
        value = discord_safe(describe_slot(doc))
        start = appointment_start(doc)
        if start is not None:
            value += f"\n<t:{int(start.timestamp())}:F> in your time zone"
        fields.append({"name": "Preferred time", "value": value, "inline": False})
    if doc.get("project_reference"):
        fields.append({"name": "Project", "value": discord_safe(doc["project_reference"]), "inline": False})
    fields.append({"name": "Subject", "value": discord_safe(doc["subject"]), "inline": False})
    if site_url:
        fields.append({"name": "Manage", "value": f"[Open the admin panel]({site_url}/admin)", "inline": False})

    embed: dict[str, Any] = {
        "title": TITLES[doc["type"]],
        "color": COLORS[doc["type"]],
        "description": discord_safe(doc["message"], DISCORD_DESCRIPTION_LIMIT),
        "fields": fields,
        "footer": {"text": f"Request {doc['id']}"},
        "timestamp": doc["created_at"],
    }
    if site_url:
        embed["url"] = f"{site_url}/admin"
    return {"embeds": [embed], "allowed_mentions": {"parse": []}}


def request_summary(doc: dict[str, Any]) -> list[str]:
    lines = [f"Name: {doc['name']}", f"Email: {doc['email']}"]
    if doc.get("contact_handle"):
        lines.append(f"Contact: {doc['contact_handle']}")
    if doc.get("service"):
        lines.append(f"Service: {doc['service']}")
    if doc["type"] == "appointment":
        lines.append(f"Preferred time: {doc['preferred_date']} {doc['preferred_time']} ({doc['timezone']})")
        start = appointment_start(doc)
        if start is not None:
            lines.append(f"In UTC: {start.astimezone(UTC):%Y-%m-%d %H:%M} UTC")
        lines.append(f"Duration: {doc['duration_minutes']} minutes")
    if doc.get("project_reference"):
        lines.append(f"Project: {doc['project_reference']}")
    lines.append(f"Subject: {doc['subject']}")
    return lines


def new_email(settings: Settings, to: str, subject: str, body: str, reply_to: str = "") -> EmailMessage:
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.smtp_from
    message["To"] = to
    if reply_to:
        message["Reply-To"] = reply_to
    message["Date"] = formatdate(usegmt=True)
    sender_domain = parseaddr(settings.smtp_from)[1].rpartition("@")[2] or "localhost"
    message["Message-ID"] = make_msgid(domain=sender_domain)
    message.set_content(body)
    return message


def build_owner_email(doc: dict[str, Any], settings: Settings) -> EmailMessage:
    title = TITLES[doc["type"]]
    received = datetime.fromisoformat(doc["created_at"]).astimezone(UTC)
    lines = [title, "", *request_summary(doc), "", "Message:", doc["message"], "", f"Request ID: {doc['id']}"]
    lines.append(f"Received: {received:%Y-%m-%d %H:%M} UTC")
    if settings.site_url:
        lines.append(f"Admin panel: {settings.site_url}/admin")
    lines += ["", f"Reply to this email to answer {doc['name']} directly."]
    return new_email(
        settings,
        to=settings.notify_email_to,
        subject=f"{title} from {doc['name']}: {doc['subject']}",
        body="\n".join(lines) + "\n",
        reply_to=formataddr((doc["name"], doc["email"])),
    )


def format_scheduled_time(doc: dict[str, Any]) -> Optional[str]:
    if not doc.get("scheduled_at"):
        return None
    moment = datetime.fromisoformat(doc["scheduled_at"])
    zone_name = doc.get("timezone") or "UTC"
    try:
        local = moment.astimezone(ZoneInfo(zone_name))
    except (KeyError, ValueError):
        zone_name, local = "UTC", moment.astimezone(UTC)
    return f"{local:%A}, {local.day} {local:%B %Y} at {local:%H:%M} ({zone_name})"


def build_client_email(doc: dict[str, Any], settings: Settings, client_message: Optional[str]) -> EmailMessage:
    label = TYPE_LABELS[doc["type"]]
    status = doc["status"]
    lines = [f"Hi {doc['name']},", "", f'Your {label} "{doc["subject"]}" {STATUS_PHRASES[status]}.']
    scheduled = format_scheduled_time(doc)
    if scheduled:
        lines += ["", f"Scheduled time: {scheduled}"]
        if doc.get("duration_minutes"):
            lines.append(f"Duration: {doc['duration_minutes']} minutes")
    if client_message:
        lines += ["", client_message]
    lines += ["", "If you have any questions, simply reply to this email.", "", "Best regards,", OWNER_NAME]
    if settings.site_url:
        lines.append(settings.site_url)
    return new_email(
        settings,
        to=formataddr((doc["name"], doc["email"])),
        subject=f"Your {label}: {status}",
        body="\n".join(lines) + "\n",
        reply_to=settings.notify_email_to,
    )


async def post_webhook(url: str, payload: dict[str, Any]) -> None:
    async with httpx.AsyncClient(timeout=WEBHOOK_TIMEOUT_SECONDS) as client:
        response = await client.post(url, json=payload)
    if response.status_code >= 300:
        raise WebhookError(f"Discord answered HTTP {response.status_code}: {response.text[:300]}")


def deliver_email(settings: Settings, message: EmailMessage) -> None:
    context = ssl.create_default_context()
    if settings.smtp_security == "ssl":
        server = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=SMTP_TIMEOUT_SECONDS, context=context)
    else:
        server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=SMTP_TIMEOUT_SECONDS)
    with server:
        if settings.smtp_security == "starttls":
            server.starttls(context=context)
        if settings.smtp_username:
            server.login(settings.smtp_username, settings.smtp_password)
        server.send_message(message)


async def send_email(settings: Settings, message: EmailMessage) -> None:
    await asyncio.to_thread(deliver_email, settings, message)


async def notify_new_request(doc: dict[str, Any], settings: Settings) -> None:
    if settings.discord_enabled:
        try:
            await post_webhook(settings.discord_webhook_url, build_discord_payload(doc, settings.site_url))
        except Exception as exc:
            logger.error("Discord notification for request %s failed: %s", doc["id"], exc)
    if settings.owner_email_enabled:
        try:
            await send_email(settings, build_owner_email(doc, settings))
        except Exception as exc:
            logger.error("Email notification for request %s failed: %s", doc["id"], exc)


async def notify_client(doc: dict[str, Any], settings: Settings, client_message: Optional[str]) -> bool:
    try:
        await send_email(settings, build_client_email(doc, settings, client_message))
    except Exception as exc:
        logger.error("Client email for request %s failed: %s", doc["id"], exc)
        return False
    return True
