"""GET /v1/system/info — OS / CPU / RAM / GPU / runtime detection.
POST /v1/shutdown — stop this server cleanly (the desktop shell's close)."""

from __future__ import annotations

import logging
import os
import threading

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool

from ..app_state import get_state
from ..errors import forbidden
from ..models import SystemInfo
from ..system_info import detect

router = APIRouter(tags=["system"])
log = logging.getLogger(__name__)

#: A clean exit that stalls (a stuck request, a hung engine) still ends this
#: many seconds after /v1/shutdown answered.
_EXIT_DEADLINE_S = 10.0


@router.get("/v1/system/info", response_model=SystemInfo, summary="Hardware + runtime detection")
async def get_system_info() -> SystemInfo:
    info = detect()
    # data_dir rides along so the desktop shell can open on-disk
    # artifacts (the rotating log file) at their real location (W4 rev).
    info.data_dir = str(get_state().data_dir)
    return info


def _is_loopback(host: str) -> bool:
    return host in ("127.0.0.1", "::1", "localhost")


@router.post("/v1/shutdown", summary="Stop this server cleanly (from this machine only)")
async def shutdown_server(request: Request) -> dict:
    """The desktop shell calls this when its window closes (2026-09-29).
    Engines are stopped first — each one's GPU memory is released at once —
    then the server exits. The shell hard-kills only when this doesn't answer
    in a few seconds; before this route, a hard kill was the only close there
    was, and it skipped every cleanup hook.

    From this machine only. Nothing exits when the app wasn't started by
    `justvoice-server serve` (a test client, an embedding host): the engines
    are still stopped, and the answer says so."""
    host = request.client.host if request.client else ""
    if not _is_loopback(host):
        raise forbidden("The server can only be shut down from this machine.")
    from ..engines.manager import shutdown_manager

    log.info("shutdown requested from %s — stopping engines, then exiting", host)
    await run_in_threadpool(shutdown_manager)
    server = getattr(request.app.state, "uvicorn_server", None)
    if server is None:
        return {"ok": True, "exiting": False}
    server.should_exit = True
    stopper = threading.Timer(_EXIT_DEADLINE_S, os._exit, args=(0,))
    stopper.daemon = True
    stopper.start()
    return {"ok": True, "exiting": True}
