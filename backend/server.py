import asyncio
import logging
import re
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import PurePath
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, BackgroundTasks, Body, Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import ValidationError
from pymongo import ReturnDocument
from pymongo.errors import PyMongoError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.cors import CORSMiddleware
from starlette.types import Scope

import notify
import security
from config import ROOT_DIR, load_settings
from schemas import REQUEST_TYPES, STATUSES, LoginBody, RequestCreate, RequestUpdate, format_validation_errors

load_dotenv(ROOT_DIR / '.env')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

settings = load_settings()
client = AsyncIOMotorClient(settings.mongo_url, serverSelectionTimeoutMS=10_000)
db = client[settings.db_name]

submission_limiter = security.RateLimiter(limit=5, window_seconds=10 * 60)
login_limiter = security.RateLimiter(limit=5, window_seconds=15 * 60)

SEARCH_FIELDS = ("name", "email", "subject", "project_reference")
NOT_FOUND = "Request not found."


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds")


def field_error(location: str, field: str, message: str) -> RequestValidationError:
    return RequestValidationError([{"loc": (location, field), "msg": message, "type": "invalid"}])


def honeypot_filled(value: Any) -> bool:
    if value is None:
        return False
    return not isinstance(value, str) or bool(value.strip())


@asynccontextmanager
async def lifespan(app: FastAPI):
    for problem in settings.problems:
        logger.warning(problem)
    logger.info(
        "Admin panel: %s",
        "enabled" if settings.admin_enabled else "disabled (set ADMIN_PASSWORD_HASH and ADMIN_JWT_SECRET)",
    )
    logger.info("Discord notifications: %s", "enabled" if settings.discord_enabled else "disabled")
    logger.info("Email notifications: %s", "enabled" if settings.owner_email_enabled else "disabled")
    try:
        await db.requests.create_index("id", unique=True)
        await db.requests.create_index("status")
        await db.requests.create_index("created_at")
    except PyMongoError as exc:
        logger.error(
            "Could not reach MongoDB to create indexes (%s). Check MONGO_URL and that the database is running.", exc
        )
    yield
    client.close()


app = FastAPI(
    title="leffloard.xyz API",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
    swagger_ui_oauth2_redirect_url="/api/docs/oauth2-redirect",
)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": format_validation_errors(list(exc.errors()))})


@app.exception_handler(PyMongoError)
async def database_error_handler(request: Request, exc: PyMongoError) -> JSONResponse:
    logger.error("Database error during %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(
        status_code=503, content={"detail": "The service is temporarily unavailable. Please try again later."}
    )


@app.exception_handler(Exception)
async def unexpected_error_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=500, content={"detail": "Internal server error."})


def require_admin_configured() -> None:
    if not settings.admin_enabled:
        raise HTTPException(status_code=503, detail="Admin panel is not configured.")


def require_admin(request: Request) -> None:
    require_admin_configured()
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token or not security.token_is_valid(token, settings.admin_jwt_secret):
        raise HTTPException(status_code=401, detail="Not authenticated.", headers={"WWW-Authenticate": "Bearer"})


def optional_choice(value: Optional[str], choices: tuple[str, ...], field: str) -> Optional[str]:
    value = (value or "").strip()
    if not value:
        return None
    if value not in choices:
        raise field_error("query", field, f"Choose one of: {', '.join(choices)}.")
    return value


api_router = APIRouter(prefix="/api")
admin_router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])


@api_router.get("/health")
async def health():
    return {"ok": True}


@api_router.post("/requests", status_code=201)
async def create_request(request: Request, background_tasks: BackgroundTasks, payload: dict[str, Any] = Body(...)):
    if honeypot_filled(payload.get("website")):
        return {"id": str(uuid.uuid4()), "status": "new", "created_at": now_iso()}

    try:
        data = RequestCreate.model_validate(payload)
    except ValidationError as exc:
        raise RequestValidationError(exc.errors()) from None

    retry_after = submission_limiter.hit(security.client_ip(request, settings.trust_proxy))
    if retry_after:
        raise HTTPException(
            status_code=429,
            detail="Too many requests. Please try again later.",
            headers={"Retry-After": str(retry_after)},
        )

    created_at = now_iso()
    doc = {
        "id": str(uuid.uuid4()),
        **data.model_dump(),
        "status": "new",
        "created_at": created_at,
        "updated_at": created_at,
        "admin_note": "",
        "scheduled_at": None,
        "history": [],
    }
    await db.requests.insert_one(dict(doc))
    background_tasks.add_task(notify.notify_new_request, doc, settings)
    return {"id": doc["id"], "status": doc["status"], "created_at": created_at}


@api_router.post("/admin/login", dependencies=[Depends(require_admin_configured)])
async def admin_login(request: Request, body: LoginBody):
    ip = security.client_ip(request, settings.trust_proxy)
    retry_after = login_limiter.hit(ip)
    if retry_after:
        raise HTTPException(
            status_code=429,
            detail="Too many login attempts. Please try again later.",
            headers={"Retry-After": str(retry_after)},
        )
    if not await asyncio.to_thread(security.password_matches, body.password, settings.admin_password_hash):
        raise HTTPException(status_code=401, detail="Incorrect password.")
    login_limiter.release(ip)
    token, expires_at = security.issue_token(settings.admin_jwt_secret)
    return {"token": token, "expires_at": expires_at.isoformat()}


@admin_router.get("/me")
async def admin_me():
    return {"notifications": {"discord": settings.discord_enabled, "email": settings.owner_email_enabled}}


@admin_router.get("/requests")
async def list_requests(
    status: Optional[str] = Query(None),
    request_type: Optional[str] = Query(None, alias="type"),
    q: Optional[str] = Query(None, max_length=200),
    page: int = Query(1, ge=1, le=100_000),
    limit: int = Query(20, ge=1, le=100),
):
    status = optional_choice(status, STATUSES, "status")
    request_type = optional_choice(request_type, REQUEST_TYPES, "type")
    query: dict[str, Any] = {}
    if request_type:
        query["type"] = request_type
    search = (q or "").strip()
    if search:
        pattern = re.escape(search)
        query["$or"] = [{field: {"$regex": pattern, "$options": "i"}} for field in SEARCH_FIELDS]

    counts = dict.fromkeys(STATUSES, 0)
    async for row in db.requests.aggregate([{"$match": query}, {"$group": {"_id": "$status", "count": {"$sum": 1}}}]):
        if row["_id"] in counts:
            counts[row["_id"]] = row["count"]

    if status:
        query["status"] = status
    total = await db.requests.count_documents(query)
    cursor = (
        db.requests.find(query, {"_id": 0})
        .sort([("created_at", -1), ("_id", -1)])
        .skip((page - 1) * limit)
        .limit(limit)
    )
    items = await cursor.to_list(length=limit)
    return {"items": items, "total": total, "counts": counts}


@admin_router.get("/requests/{request_id}")
async def get_request(request_id: str):
    doc = await db.requests.find_one({"id": request_id}, {"_id": 0})
    if doc is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return doc


@admin_router.patch("/requests/{request_id}")
async def update_request(request_id: str, update: RequestUpdate):
    doc = await db.requests.find_one({"id": request_id}, {"_id": 0})
    if doc is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)

    changes: dict[str, Any] = {}
    if update.status is not None and update.status != doc["status"]:
        changes["status"] = update.status
    if update.admin_note is not None and update.admin_note != doc.get("admin_note", ""):
        changes["admin_note"] = update.admin_note
    if "scheduled_at" in update.model_fields_set:
        if update.scheduled_at is not None and doc["type"] != "appointment":
            raise field_error("body", "scheduled_at", "Only appointments can be scheduled.")
        if update.scheduled_at != doc.get("scheduled_at"):
            changes["scheduled_at"] = update.scheduled_at

    if changes:
        changes["updated_at"] = now_iso()
        operation: dict[str, Any] = {"$set": changes}
        if "status" in changes:
            operation["$push"] = {
                "history": {"status": changes["status"], "from": doc["status"], "at": changes["updated_at"]}
            }
        doc = await db.requests.find_one_and_update(
            {"id": request_id}, operation, projection={"_id": 0}, return_document=ReturnDocument.AFTER
        )
        if doc is None:
            raise HTTPException(status_code=404, detail=NOT_FOUND)

    client_notified = False
    if update.notify_client and settings.smtp_enabled:
        client_notified = await notify.notify_client(doc, settings, update.client_message)
    return {**doc, "client_notified": client_notified}


@admin_router.delete("/requests/{request_id}", status_code=204)
async def delete_request(request_id: str):
    result = await db.requests.delete_one({"id": request_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return Response(status_code=204)


app.include_router(api_router)
app.include_router(admin_router)


class FrontendFiles(StaticFiles):
    """Serves the built frontend, answering unknown paths with index.html so client-side routes survive a reload."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        if PurePath(path).parts[:1] == ("api",):
            raise StarletteHTTPException(status_code=404)
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404:
                raise
            path = "index.html"
            response = await super().get_response(path, scope)
        if path == "index.html":
            response.headers["Cache-Control"] = "no-cache"
        elif PurePath(path).parts[:1] == ("assets",):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


if (settings.frontend_dist / "index.html").is_file():
    app.mount("/", FrontendFiles(directory=settings.frontend_dist), name="frontend")
    logger.info("Serving the frontend from %s", settings.frontend_dist)
else:
    logger.info("No frontend build found at %s; serving the API only.", settings.frontend_dist)

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
        max_age=600,
    )
