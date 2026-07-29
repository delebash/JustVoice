# SPDX-License-Identifier: MIT
#
# Adapted from voicebox (MIT) — backend/mcp_server/context.py at the commit
# pinned in voicebox-pin.txt. Header renamed, binding model + paths adjusted
# to JustVoice's schema. Original copyright (c) the voicebox authors.
"""Per-request client identity for MCP calls.

MCP clients identify themselves via an ``X-JustVoice-Client-Id`` HTTP header
(direct-HTTP clients set it in their MCP config). Middleware copies the value
into a ContextVar so tool implementations can read it without plumbing the
request object through every service call.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
from contextvars import ContextVar
from datetime import datetime, timezone

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

log = logging.getLogger(__name__)

# Strong refs to in-flight stamp tasks so asyncio.create_task results
# don't get garbage-collected mid-flight (cf. asyncio.create_task docs).
_pending_stamps: set[asyncio.Task] = set()

CLIENT_ID_HEADER = "X-JustVoice-Client-Id"

# Tool handlers read this to apply per-client voice bindings.
current_client_id: ContextVar[str | None] = ContextVar("current_client_id", default=None)

# Remote address of the in-flight request. Used by tools that gate
# host-filesystem access to loopback callers.
current_remote_addr: ContextVar[str | None] = ContextVar("current_remote_addr", default=None)


def request_is_loopback() -> bool:
    """True when the in-flight request originated on the loopback interface.

    Returns False if no request is in flight or the remote address can't be
    parsed — callers gating filesystem reads on this should treat that as
    "deny".
    """
    addr = current_remote_addr.get()
    if not addr:
        return False
    try:
        return ipaddress.ip_address(addr).is_loopback
    except ValueError:
        return False


# Paths whose calls act on the caller's MCP bindings — only these stamp
# last_seen_at, so the bindings UI's "last heard from" column reflects
# real MCP/speak traffic, not unrelated REST calls that set the header.
_STAMPED_PATH_PREFIXES: tuple[str, ...] = ("/mcp",)


class ClientIdMiddleware(BaseHTTPMiddleware):
    """Copy X-JustVoice-Client-Id into a ContextVar and stamp last_seen_at
    for requests that act on the caller's MCP bindings."""

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next) -> Response:
        client_id = request.headers.get(CLIENT_ID_HEADER)
        remote_addr = request.client.host if request.client else None
        client_token = current_client_id.set(client_id)
        addr_token = current_remote_addr.set(remote_addr)
        try:
            response = await call_next(request)
        finally:
            current_client_id.reset(client_token)
            current_remote_addr.reset(addr_token)

        if client_id and _is_stamped_path(request.url.path):
            _enqueue_stamp(client_id)
        return response


def _enqueue_stamp(client_id: str) -> None:
    """Fire-and-forget the SQLite write so it doesn't block the response."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        _stamp_last_seen(client_id)
        return
    task = loop.create_task(asyncio.to_thread(_stamp_last_seen, client_id))
    _pending_stamps.add(task)
    task.add_done_callback(_pending_stamps.discard)


def _is_stamped_path(path: str) -> bool:
    # Require a path boundary so a future ``/mcpfoo`` route doesn't
    # silently inherit the stamp from ``/mcp``.
    return any(path == p or path.startswith(p + "/") for p in _STAMPED_PATH_PREFIXES)


def _stamp_last_seen(client_id: str) -> None:
    """Update or create the MCPBinding row for this client_id."""
    try:
        from ..database import MCPBinding, get_db
    except Exception:
        return
    try:
        db = next(get_db())
    except Exception:
        return
    try:
        row = db.query(MCPBinding).filter(MCPBinding.client_id == client_id).first()
        if row is None:
            row = MCPBinding(client_id=client_id)
            db.add(row)
        row.last_seen_at = datetime.now(timezone.utc)
        db.commit()
    except Exception:
        log.debug("could not stamp last_seen_at for %s", client_id, exc_info=True)
        db.rollback()
    finally:
        db.close()
