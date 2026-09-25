import math
import threading
import time
from collections import deque
from datetime import UTC, datetime, timedelta
from typing import Callable

import bcrypt
import jwt
from fastapi import Request

TOKEN_TTL = timedelta(hours=12)
TOKEN_ALGORITHM = "HS256"
TOKEN_SUBJECT = "admin"
BCRYPT_MAX_BYTES = 72


class RateLimiter:
    """Sliding-window limiter keyed by client address, safe to share across threads and tasks."""

    def __init__(self, limit: int, window_seconds: float, clock: Callable[[], float] = time.monotonic):
        self.limit = limit
        self.window = window_seconds
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()
        self._next_sweep = clock() + window_seconds

    def hit(self, key: str) -> int:
        """Record an attempt. Returns 0 when allowed, otherwise the seconds to wait before retrying."""
        now = self._clock()
        with self._lock:
            if now >= self._next_sweep:
                self._sweep(now)
            hits = self._hits.setdefault(key, deque())
            self._prune(hits, now)
            if len(hits) >= self.limit:
                return max(1, math.ceil(hits[0] + self.window - now))
            hits.append(now)
            return 0

    def release(self, key: str) -> None:
        """Forget the most recent attempt for `key`, e.g. after a successful login."""
        with self._lock:
            hits = self._hits.get(key)
            if hits:
                hits.pop()

    def _prune(self, hits: deque[float], now: float) -> None:
        while hits and hits[0] <= now - self.window:
            hits.popleft()

    def _sweep(self, now: float) -> None:
        for key in list(self._hits):
            self._prune(self._hits[key], now)
            if not self._hits[key]:
                del self._hits[key]
        self._next_sweep = now + self.window


def client_ip(request: Request, trust_proxy: bool) -> str:
    if trust_proxy:
        forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        if forwarded:
            return forwarded
    return request.client.host if request.client else "unknown"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def password_matches(password: str, password_hash: str) -> bool:
    candidate = password.encode("utf-8")
    try:
        matches = bcrypt.checkpw(candidate[:BCRYPT_MAX_BYTES], password_hash.encode("ascii"))
    except ValueError:
        return False
    return matches and len(candidate) <= BCRYPT_MAX_BYTES


def issue_token(secret: str) -> tuple[str, datetime]:
    issued_at = datetime.now(UTC).replace(microsecond=0)
    expires_at = issued_at + TOKEN_TTL
    token = jwt.encode(
        {"sub": TOKEN_SUBJECT, "iat": issued_at, "exp": expires_at},
        secret,
        algorithm=TOKEN_ALGORITHM,
    )
    return token, expires_at


def token_is_valid(token: str, secret: str) -> bool:
    try:
        claims = jwt.decode(
            token,
            secret,
            algorithms=[TOKEN_ALGORITHM],
            options={"require": ["sub", "iat", "exp"]},
        )
    except jwt.PyJWTError:
        return False
    return claims.get("sub") == TOKEN_SUBJECT
