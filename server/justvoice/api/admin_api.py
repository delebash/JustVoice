# SPDX-License-Identifier: GPL-3.0-or-later
"""POST /v1/admin/factory-reset — wipe to as-new-install (testing tier 3).

Deletes every DB row (projects, scenes, blocks, takes, generations,
captures, bindings, …) AND the file-backed stores (personas, voices,
lexicons, project JSON, training jobs, generation audio — mid-Phase-1.5
these still live as files, so the DB wipe alone left them alive),
clears the render cache, and resets settings.json to defaults — keeping
only the server host/port section so the running instance stays
reachable. Downloaded engine models on disk are NOT deleted (multi-GB;
remove via Engines).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter
from sqlalchemy import inspect, text
from pydantic import BaseModel

from ..app_state import get_state
from ..database import session as db_session
from ..database.migrations import run_migrations
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

    # 1. The database resets the way a fresh install creates it: delete
    # the SQLite file and re-run init_db (create_all + migrations +
    # seeds). Guarantees the post-reset schema is byte-identical to a
    # new install — dropping tables in-place kept legacy drift alive
    # (user-hit three times on 2026-06-12). Falls back to dropping
    # tables when the DB isn't the module's file-backed one (tests).
    cleared = 0
    db_path = db_session._db_path
    file_recreated = False
    if db_path is not None and db_session.engine is not None:
        db_session.engine.dispose()
        data_dir = db_path.parent
        for suffix in ("", "-wal", "-shm"):
            p = db_path.parent / (db_path.name + suffix)
            try:
                p.unlink(missing_ok=True)
            except OSError as e:
                log.warning("factory reset: could not delete %s: %s", p, e)
        # Windows can hold the file open across dispose() — only count
        # this path as done when the file is actually gone; otherwise
        # fall through to dropping tables in place.
        file_recreated = not db_path.exists()
        db_session.engine = None
        db_session.SessionLocal = None
        db_session._db_path = None
        db_session.init_db(data_dir)
        from ..database.seed import seed_builtin_effect_presets, seed_builtin_render_presets
        if file_recreated:
            seed_builtin_effect_presets()
            seed_builtin_render_presets()
            cleared = len(Base.metadata.tables)
        else:
            log.warning("factory reset: DB file locked — dropping tables in place instead")
    if not file_recreated and db_session.SessionLocal is not None:
        factory = db_session.SessionLocal
        _s = factory()
        try:
            bind = _s.get_bind()
        finally:
            _s.close()
        with bind.connect() as conn:
            if bind.dialect.name == "sqlite":
                conn.execute(text("PRAGMA foreign_keys=OFF"))
            for name in inspect(bind).get_table_names():
                conn.execute(text(f'DROP TABLE IF EXISTS "{name}"'))
                cleared += 1
            conn.commit()
        Base.metadata.create_all(bind=bind)
        run_migrations(bind)
        from ..database.seed import seed_builtin_effect_presets, seed_builtin_render_presets
        seed_builtin_effect_presets()
        seed_builtin_render_presets()

    # 2. File-backed stores. Mid-Phase-1.5 personas/voices/lexicons/
    # projects/training still live as JSON files + in-memory caches —
    # the DB wipe alone leaves them all alive (user-hit 2026-06-12:
    # personas survived reset). Blow away the dirs and re-instantiate
    # the stores so the caches drop too. Engine model downloads stay.
    import shutil

    from ..paths import (
        generations_root,
        lexicons_root,
        personas_root,
        projects_root,
        training_root,
        voices_root,
    )
    from ..storage.lexicons import LexiconStore
    from ..storage.personas import PersonaStore
    from ..storage.projects import ProjectStore
    from ..storage.training_jobs import TrainingRegistry
    from ..storage.voices import VoiceStore

    state_data_dir = getattr(state, "data_dir", None)
    if state_data_dir is not None:
        for root_fn in (
            personas_root,
            voices_root,
            lexicons_root,
            projects_root,
            training_root,
            generations_root,
        ):
            try:
                shutil.rmtree(root_fn(state_data_dir), ignore_errors=True)
            except Exception as e:  # noqa: BLE001 — reset keeps going
                log.warning("factory reset: could not clear %s: %s", root_fn.__name__, e)
        state.personas = PersonaStore(state_data_dir)
        state.voices = VoiceStore(state_data_dir)
        state.lexicons = LexiconStore(state_data_dir)
        state.projects = ProjectStore(state_data_dir)
        state.training = TrainingRegistry(state_data_dir)

    # 3. Render cache — memory + disk.
    cache = getattr(state, "_render_cache", None)
    if cache is not None:
        try:
            cache.clear()
        except Exception as e:
            log.warning("factory reset: cache clear failed: %s", e)

    # 4. Settings to defaults; the live server section survives so the
    #    instance stays reachable on its current host/port.
    current = state.settings.get()
    state.settings.set(Settings(server=current.server))

    log.warning("FACTORY RESET executed — %d tables cleared", cleared)
    return FactoryResetResponse(reset=True, tables_cleared=cleared)
