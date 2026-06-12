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
