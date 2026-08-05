# SPDX-License-Identifier: MIT
"""POST /v1/admin/factory-reset — wipe to as-new-install (testing tier 3).

(The private log ring/file twins + /v1/logs routes that lived here died with
F1 Phase 2 — the shared platform helpers `install_log_ring`/`install_file_log`
+ `make_logs_router` serve logging now, wired in app.py.)

Deletes every DB row (projects, scenes, blocks, takes, generations,
captures, bindings, …) AND the file-backed stores (personas, voices,
lexicons, project JSON, training jobs, generation audio — mid-Phase-1.5
these still live as files, so the DB wipe alone left them alive),
clears the render cache, and resets settings to defaults — keeping
only the server host/port section so the running instance stays
reachable. Downloaded engine models on disk are NOT deleted (multi-GB;
remove via Engines).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import inspect, text

from ..app_state import get_state
from ..database import session as db_session
from ..database.migrations import run_migrations
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
        from ..llm_bootstrap import reseed_shared_llm
        if file_recreated:
            seed_builtin_effect_presets()
            seed_builtin_render_presets()
            # The SAME file carries the shared LLM tables — re-wire storage at
            # the NEW session factory + re-seed BOTH sets (the family's
            # dual-table reset lesson; JV's warm-OFF default re-applies).
            reseed_shared_llm(db_session.engine, db_session.SessionLocal)
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
        from ..llm_bootstrap import reseed_shared_llm
        seed_builtin_effect_presets()
        seed_builtin_render_presets()
        # Dropped-in-place path: the shared tables were dropped with the rest —
        # recreate + reseed them on the same bind.
        reseed_shared_llm(bind, db_session.SessionLocal)

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
        state.training = TrainingRegistry(state_data_dir)

    # 3. Engines — a fresh install has nothing resident. Unload every
    # managed engine slot (also clears the recorded variants) and drop
    # runtime-registered external providers; their config just got reset
    # so a fresh registry matches what the next boot would build.
    # Downloaded model files stay (multi-GB, by design).
    try:
        from ..engines.manager import get_manager

        get_manager().unload()
    except Exception as e:  # noqa: BLE001 — reset keeps going
        log.warning("factory reset: managed-engine unload failed: %s", e)
    try:
        from ..engines.registry import EngineRegistry

        registry = getattr(state, "engines", None)
        if registry is not None:
            for engine in registry.all():
                try:
                    engine.unload()
                except Exception:  # noqa: BLE001 — best-effort per engine
                    pass
            state.engines = EngineRegistry()
    except Exception as e:  # noqa: BLE001 — reset keeps going
        log.warning("factory reset: engine-registry reset failed: %s", e)

    # 4. Render cache — memory + disk.
    cache = getattr(state, "_render_cache", None)
    if cache is not None:
        try:
            cache.clear()
        except Exception as e:
            log.warning("factory reset: cache clear failed: %s", e)

    # 5. Settings to defaults; the live server section survives so the
    #    instance stays reachable on its current host/port.
    current = state.settings.get()
    state.settings.set(Settings(server=current.server))

    log.warning("FACTORY RESET executed — %d tables cleared", cleared)
    return FactoryResetResponse(reset=True, tables_cleared=cleared)
