"""Bearer-token authentication middleware.

Mirrors the Rust core's policy:
- empty `auth.tokens` list = no auth required, even on non-loopback binds (with a warning)
- non-empty tokens + loopback bind + `require_for_loopback=false` = loopback bypasses auth
- otherwise: every request needs `Authorization: Bearer <token>`
"""

from __future__ import annotations

import ipaddress
import logging

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from .app_state import get_state

log = logging.getLogger(__name__)


def _is_loopback(host: str) -> bool:
    if host in ("127.0.0.1", "::1", "localhost"):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


class BearerAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Skip auth for the spec endpoint + UI assets + docs UIs
        path = request.url.path
        if path.startswith(("/openapi.json", "/docs", "/redoc", "/ui", "/")) and not path.startswith("/v1"):
            return await call_next(request)

        try:
            settings = get_state().settings.get()
        except RuntimeError:
            return await call_next(request)
        tokens = settings.auth.tokens
        if not tokens:
            return await call_next(request)

        client_host = request.client.host if request.client else ""
        if _is_loopback(client_host) and not settings.auth.require_for_loopback:
            return await call_next(request)

        header = request.headers.get("authorization", "")
        if not header.startswith("Bearer "):
            return JSONResponse(
                status_code=401,
                content={
                    "type": "https://justvoice.dev/errors/unauthorized",
                    "title": "Unauthorized",
                    "status": 401,
                    "detail": "Authorization header missing or malformed",
                    "instance": request.url.path,
                },
                media_type="application/problem+json",
            )
        token = header[len("Bearer ") :].strip()
        if token not in tokens:
            return JSONResponse(
                status_code=403,
                content={
                    "type": "https://justvoice.dev/errors/forbidden",
                    "title": "Forbidden",
                    "status": 403,
                    "detail": "Bearer token not accepted",
                    "instance": request.url.path,
                },
                media_type="application/problem+json",
            )
        return await call_next(request)
