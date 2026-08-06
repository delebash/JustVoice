# SPDX-License-Identifier: MIT
"""Host wiring for the shared data backup/restore/reset router
(`llm_runner.platform.make_data_router`) — JW's `data_admin.py` is the donor,
adopted here by the family parity batch (2026-08-06). The bespoke
`/v1/backup` + `/v1/restore` (backup_api.py) and `/v1/admin/factory-reset`
(admin_api.py) died with it — NO old-zip compatibility, decision ②.

- Backup/restore cover BOTH bases on the one SQLite file (JV's domain tables +
  the shared `LlmBase`) plus the SEVEN file-backed content roots below. The
  engine/model caches stay out — downloads re-fetch.
- The include-audio choice (decision ①) is the kit DataManagement options seam:
  the UI sends `?exclude=generations,captures` and the shared backup route
  skips those dirs. (The old UI sent `include_audio` to a route that read
  `include_generations` — the toggle was silently ignored; found at this
  adoption.)
- `run_reset` IS the factory reset — the one implementation, moved whole from
  admin_api.py (its route retired; POST /v1/data/reset serves it now).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter
from sqlalchemy import inspect, text

from llm_runner.llm import LlmBase
from llm_runner.platform import make_data_router

from .app_state import get_state
from .database import session as db_session
from .database.migrations import run_migrations
from .database.models import Base
from .models import Settings

log = logging.getLogger(__name__)


def _stop_ai_engines_best_effort() -> None:
    """Clean slate for everything AI-resident (the family rule, 2026-07-11: no
    child keeps running under pre-reset/pre-restore config while the UI claims
    the new one is active): the shared LLM runner's children + VRAM ledger, the
    managed TTS engine slots, and any runtime-registered external engines.
    Best-effort throughout — a reset/restore must never fail on teardown."""
    try:
        from llm_runner.runner.lifecycle import get_service

        get_service().stop()
    except Exception:  # noqa: BLE001
        pass
    try:
        from .engines.manager import get_manager

        get_manager().unload()
    except Exception as e:  # noqa: BLE001
        log.warning("engine teardown: managed-engine unload failed: %s", e)
    try:
        from .engines.registry import EngineRegistry

        state = get_state()
        registry = getattr(state, "engines", None)
        if registry is not None:
            for engine in registry.all():
                try:
                    engine.unload()
                except Exception:  # noqa: BLE001 — best-effort per engine
                    pass
            state.engines = EngineRegistry()
    except Exception as e:  # noqa: BLE001
        log.warning("engine teardown: engine-registry reset failed: %s", e)


def _asset_dirs() -> dict:
    """The SEVEN content roots a backup carries (paths.py-verified; models/
    storage/cache roots stay out — multi-GB downloads re-fetch). `captures`
    has its own root (captures_api.py) — dictation recordings are user data."""
    from .paths import (
        generations_root,
        lexicons_root,
        personas_root,
        projects_root,
        training_root,
        voices_root,
    )

    data_dir = getattr(get_state(), "data_dir", None)
    if data_dir is None:
        return {}
    return {
        "voices": voices_root(data_dir),
        "personas": personas_root(data_dir),
        "lexicons": lexicons_root(data_dir),
        "projects": projects_root(data_dir),
        "generations": generations_root(data_dir),
        "training": training_root(data_dir),
        "captures": data_dir / "captures",
    }


def run_factory_reset() -> int:
    """Wipe to as-new-install — the one reset implementation (moved WHOLE from
    admin_api.py; POST /v1/data/reset runs it now). Returns tables cleared.

    Deletes every DB row (projects, scenes, blocks, takes, generations,
    captures, bindings, …) AND the file-backed stores (personas, voices,
    lexicons, project JSON, training jobs, generation audio, capture
    recordings), clears the render cache, and resets settings to defaults —
    keeping only the server host/port section so the running instance stays
    reachable. Downloaded engine models on disk are NOT deleted (multi-GB;
    remove via the AI page)."""
    state = get_state()

    # 0. Unload everything AI-resident FIRST, while the config it was spawned
    # from still exists (JW's donor lesson; the old body only unloaded the TTS
    # slots, and only AFTER the DB was already gone).
    _stop_ai_engines_best_effort()

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
        from .database.seed import seed_builtin_effect_presets, seed_builtin_render_presets
        from .llm_bootstrap import reseed_shared_llm
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
        from .database.seed import seed_builtin_effect_presets, seed_builtin_render_presets
        from .llm_bootstrap import reseed_shared_llm
        seed_builtin_effect_presets()
        seed_builtin_render_presets()
        # Dropped-in-place path: the shared tables were dropped with the rest —
        # recreate + reseed them on the same bind.
        reseed_shared_llm(bind, db_session.SessionLocal)

    # 2. File-backed stores. Mid-Phase-1.5 personas/voices/lexicons/
    # projects/training still live as JSON files + in-memory caches —
    # the DB wipe alone leaves them all alive (user-hit 2026-06-12:
    # personas survived reset). Blow away the dirs and re-instantiate
    # the stores so the caches drop too. Captures audio joins the wipe
    # (the as-new-install promise: their DB rows die above, and orphaned
    # WAVs are not a fresh install). Engine model downloads stay.
    import shutil

    from .paths import (
        generations_root,
        lexicons_root,
        personas_root,
        projects_root,
        training_root,
        voices_root,
    )
    from .storage.lexicons import LexiconStore
    from .storage.personas import PersonaStore
    from .storage.training_jobs import TrainingRegistry
    from .storage.voices import VoiceStore

    state_data_dir = getattr(state, "data_dir", None)
    if state_data_dir is not None:
        for root in (
            personas_root(state_data_dir),
            voices_root(state_data_dir),
            lexicons_root(state_data_dir),
            projects_root(state_data_dir),
            training_root(state_data_dir),
            generations_root(state_data_dir),
            state_data_dir / "captures",
        ):
            try:
                shutil.rmtree(root, ignore_errors=True)
            except Exception as e:  # noqa: BLE001 — reset keeps going
                log.warning("factory reset: could not clear %s: %s", root, e)
        state.personas = PersonaStore(state_data_dir)
        state.voices = VoiceStore(state_data_dir)
        state.lexicons = LexiconStore(state_data_dir)
        state.training = TrainingRegistry(state_data_dir)

    # 3. Render cache — memory + disk. (Engine teardown already ran in step 0.)
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
    return cleared


def get_data_router() -> APIRouter:
    return make_data_router(
        get_db_path=lambda: db_session._db_path,
        metadata=[Base.metadata, LlmBase.metadata],
        run_reset=run_factory_reset,
        asset_dirs=_asset_dirs,
        # A restore replaces routing/models/engine config under the live app —
        # same clean-slate rule as reset.
        on_replaced=_stop_ai_engines_best_effort,
    )
