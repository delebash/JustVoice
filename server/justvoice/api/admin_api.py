# SPDX-License-Identifier: GPL-3.0-or-later
"""POST /v1/admin/factory-reset — wipe to as-new-install (testing tier 3).

Deletes every DB row (projects, scenes, blocks, takes, generations,
personas, lexicons, captures, bindings, …), clears the render cache,
and resets settings.json to defaults — keeping only the server
host/port section so the running instance stays reachable. Downloaded
engine models on disk are NOT deleted (multi-GB; remove via Engines).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter
from pydantic import BaseModel

from ..app_state import get_state
from ..database import session as db_session
from ..database.models import Base
from ..models import Settings

log = logging.getLogger(__name__)
router = APIRouter(tags=["admin"])


# ── Log ring (Settings → Logs preview) ───────────────────────────────
# The server logs to stdout; nothing on disk to tail. A bounded ring
# handler on the root logger keeps the last N lines for the UI.
class _RingHandler(logging.Handler):
    def __init__(self, capacity: int = 500):
        super().__init__()
        self.capacity = capacity
        self.lines: list[str] = []
        self.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s"))

    def emit(self, record: logging.LogRecord) -> None:
        try:
            self.lines.append(self.format(record))
            if len(self.lines) > self.capacity:
                del self.lines[: len(self.lines) - self.capacity]
        except Exception:  # noqa: BLE001 — logging must never raise
            pass


_ring = _RingHandler()


def install_log_ring() -> None:
    """Idempotent — called from create_app()."""
    root = logging.getLogger()
    if _ring not in root.handlers:
        root.addHandler(_ring)


class LogTailResponse(BaseModel):
    text: str
    lines: int


@router.get("/v1/logs/tail", response_model=LogTailResponse)
async def logs_tail(lines: int = 80) -> LogTailResponse:
    lines = max(1, min(lines, _ring.capacity))
    tail = _ring.lines[-lines:]
    return LogTailResponse(text="\n".join(tail), lines=len(tail))


class FactoryResetResponse(BaseModel):
    reset: bool
    tables_cleared: int
    note: str = "Engine model downloads were kept — delete them from Engines if needed."


@router.post("/v1/admin/factory-reset", response_model=FactoryResetResponse)
async def factory_reset() -> FactoryResetResponse:
    state = get_state()

    # 1. Every DB table, children first (FK order).
    cleared = 0
    factory = db_session.SessionLocal
    if factory is not None:
        db = factory()
        try:
            for table in reversed(Base.metadata.sorted_tables):
                db.execute(table.delete())
                cleared += 1
            db.commit()
        finally:
            db.close()

    # 2. Render cache — memory + disk.
    cache = getattr(state, "_render_cache", None)
    if cache is not None:
        try:
            cache.clear()
        except Exception as e:
            log.warning("factory reset: cache clear failed: %s", e)

    # 3. Settings to defaults; the live server section survives so the
    #    instance stays reachable on its current host/port.
    current = state.settings.get()
    state.settings.set(Settings(server=current.server))

    log.warning("FACTORY RESET executed — %d tables cleared", cleared)
    return FactoryResetResponse(reset=True, tables_cleared=cleared)
