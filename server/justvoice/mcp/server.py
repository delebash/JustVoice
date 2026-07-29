# SPDX-License-Identifier: MIT
#
# Adapted from voicebox (MIT) — backend/mcp_server/server.py at the commit
# pinned in voicebox-pin.txt. JustVoice keeps the on_event-driven default
# lifespan, so mounting composes FastMCP's session manager around it rather
# than replacing create_app's lifespan. Original copyright (c) the voicebox
# authors.
"""Construct the FastMCP server and mount it on the FastAPI app.

The MCP endpoint lives at ``/mcp`` (Streamable HTTP transport). Modern MCP
clients (Claude Code, Cursor, Windsurf, VS Code MCP extensions) connect
directly via URL::

    claude mcp add justvoice --transport http \
        --url http://127.0.0.1:17494/mcp \
        --header "X-JustVoice-Client-Id: claude-code"
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastmcp import FastMCP
from starlette.routing import Route

from .context import ClientIdMiddleware
from .tools import register_tools

log = logging.getLogger(__name__)


class _RootPathShim:
    """Forward a bare `/mcp` request into the MCP app as path "/"."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") == "http":
            scope = dict(scope)
            scope["path"] = "/"
            scope["raw_path"] = b"/"
        await self.app(scope, receive, send)


def build_mcp_server() -> FastMCP:
    """Create the FastMCP instance with JustVoice tools registered."""
    mcp = FastMCP(
        name="justvoice",
        instructions=(
            "JustVoice is a local voice production server. Use "
            "`justvoice.speak` to render text in a voice (returns an "
            "audio URL), and the `list_*` tools to discover voices and "
            "personas."
        ),
    )
    register_tools(mcp)
    return mcp


def mount_into(app: FastAPI) -> None:
    """Attach the MCP app to ``app`` at ``/mcp``, install the client-id
    middleware, and splice FastMCP's session manager into the lifespan.

    FastMCP's Streamable HTTP transport REQUIRES its session manager to run
    inside the ASGI lifespan. create_app uses on_event handlers (served by
    Starlette's default lifespan), so we wrap the existing context instead
    of replacing it.
    """
    mcp = build_mcp_server()
    mcp_app = mcp.http_app(path="/", transport="http")

    # ClientIdMiddleware must run before FastMCP so the ContextVar is set
    # by the time tool handlers execute. Starlette composes middlewares
    # outermost-first, so adding here on the parent app is correct.
    app.add_middleware(ClientIdMiddleware)
    app.mount("/mcp", mcp_app)
    # Agent configs use the bare `/mcp` URL, which Starlette's Mount regex
    # ("^/mcp(/.*)$") never matches — it would fall through to the root
    # StaticFiles and 405. An exact-path ASGI route catches it and forwards
    # with the path the MCP app's internal router expects.
    app.router.routes.insert(
        0, Route("/mcp", _RootPathShim(mcp_app), methods=["GET", "POST", "DELETE"])
    )

    existing_lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def _with_mcp(app_):
        async with existing_lifespan(app_):
            async with mcp_app.router.lifespan_context(mcp_app):
                yield

    app.router.lifespan_context = _with_mcp
    log.info("MCP: mounted at /mcp (FastMCP)")
