"""FastAPI application factory.

Boots the AppState (engine registry + stores + training registry),
walks installed model dirs to register real engines, registers any
configured external engines, then mounts every router.

The GUI (Vue 3 SPA) is served from /ui/ via StaticFiles.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

# Shared local-LLM runner core — its own repo `just-llm-runner`, consumed as
# a git dependency (editable/path install in dev). Provides the mountable
# /v1/llm-runner/* router (manifest + detected hardware). Both apps mount the
# SAME router. See docs/plans/2026-06-16-builtin-llm-runner.md.
from llm_runner import router as llm_runner_router
from llm_runner.platform import (
    install_file_log,
    install_log_ring,
    make_disk_router,
    make_logs_router,
)

from .api import (
    active_tasks_api,
    analyzer_api,
    bulk_delete_api,
    cache_api,
    capture_readiness_api,
    captures_api,
    channels_api,
    effect_presets_api,
    engines_api,
    extraction_api,
    prefs_api,
    preset_suggest_api,
    smart_assign_api,
    engine_sources_api,
    engines_models_api,
    external_api,
    generate_api,
    health,
    lexicons_api,
    master_api,
    mcp_bindings_api,
    models_api,
    personas_api,
    phase5_api,
    project_export_api,
    projects_api,
    render_chapter_api,
    render_presets_api,
    server_auth_api,
    settings_api,
    sse_streams_api,
    system_api,
    takes_api,
    voice_preview_api,
    voices_api,
    webhooks_api,
)
from .app_state import AppState, set_state
from .auth import BearerAuthMiddleware
from .data_admin import get_data_router
from .engines.external_openai import ExternalOpenAiTtsBackend
from .engines.manager import get_manager, shutdown_manager
from .errors import ApiError, api_exception_handler, http_exception_handler
from .paths import default_data_dir
from .version import PRODUCT, VERSION

log = logging.getLogger(__name__)


def create_app(data_dir: Path | None = None) -> FastAPI:
    data_dir = data_dir or default_data_dir()

    # Server logs → in-memory ring (Settings → Logs) + a rotating file that
    # survives a crash/boot-hang. Shared platform helpers, same in every app
    # (they replaced admin_api's private twins — F1 Phase 2).
    install_log_ring()
    install_file_log(Path(data_dir) / "logs" / "justvoice.log")

    # Phase 1.5: SQLite is the primary persistence layer. init_db() runs
    # idempotent migrations + creates net-new tables. settings.json has been
    # folded into the `settings` table (SettingsStore imports any legacy file).
    from .database import init_db
    init_db(data_dir)

    # Built-in effect presets (Robotic / Radio / Echo Chamber / Deep Voice)
    # + render presets (Narration / Dramatic Dialogue / Quiet Reflection /
    # Action, task #88) — idempotent on every boot.
    from .database.seed import (
        seed_builtin_effect_presets,
        seed_builtin_render_presets,
    )

    seed_builtin_effect_presets()
    seed_builtin_render_presets()

    state = AppState(data_dir)
    set_state(state)

    # One-shot Profile → Persona migration (Slice 1 of the Profile-kill
    # rollout per the approved plan). Materializes an orphan Persona
    # record for every VoiceProfile row. Idempotent; runs until the
    # VoiceProfile table is dropped in Slice 4.
    from .database import session as _db_session
    from .database.migrate_profiles import migrate_voice_profiles_to_personas

    if _db_session.engine is not None:
        migrate_voice_profiles_to_personas(_db_session.engine, state.personas)

    _register_existing_engines(state, data_dir)
    _register_external_engines(state)
    # LLM provider REGISTRY boot moved below install_llm (convergence part 2,
    # 2026-08-01): providers live in the shared DB store now, which does not
    # exist until install_llm wires storage. See the mount block.

    settings = state.settings.get()
    app = FastAPI(
        title=PRODUCT,
        version=VERSION,
        description="An open-source TTS server built for audiobook production, useful for any TTS workload.",
        license_info={"name": "Apache-2.0", "identifier": "Apache-2.0"},
        openapi_url="/openapi.json" if settings.server.docs_enabled else None,
        docs_url="/docs" if settings.server.docs_enabled else None,
        redoc_url="/redoc" if settings.server.docs_enabled else None,
    )

    # CORS — the bundled UI is a different origin than this loopback server,
    # so without these headers the webview's fetch() calls are blocked and
    # the GUI renders empty (e.g. no engines listed). Defaults cover the dev
    # server + the packaged Tauri webview; both are operator-tunable.
    # Catch-all error envelope — MUST be registered before CORSMiddleware
    # (Starlette wraps later-added middleware outside earlier ones), so
    # unhandled exceptions become JSON 500s that flow OUT through CORS
    # and reach the browser as real errors instead of "blocked by CORS".
    # A bare @app.exception_handler(Exception) does NOT work for this:
    # Starlette runs it in ServerErrorMiddleware, outside CORS (verified
    # the hard way, 2026-06-12).
    @app.middleware("http")
    async def _error_envelope(request, call_next):  # noqa: ANN001
        try:
            return await call_next(request)
        except Exception as exc:  # noqa: BLE001 — envelope everything
            log.exception("unhandled error on %s %s", request.method, request.url.path)
            return JSONResponse(
                status_code=500,
                content={"title": "Internal Server Error", "detail": str(exc)[:300]},
            )

    if settings.cors.origins or settings.cors.origin_regex:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors.origins,
            allow_origin_regex=settings.cors.origin_regex or None,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )


    # Auth — after CORS so preflights succeed without a token
    app.add_middleware(BearerAuthMiddleware)

    # Error handlers — convert ApiError + HTTPException to RFC 7807 problem+json
    app.add_exception_handler(ApiError, api_exception_handler)
    app.add_exception_handler(HTTPException, http_exception_handler)

    # Routes
    app.include_router(health.router)
    app.include_router(system_api.router)
    app.include_router(server_auth_api.router)  # the auth door + lockout escape (family shape)
    app.include_router(settings_api.router)
    app.include_router(voices_api.router)
    app.include_router(personas_api.router)
    app.include_router(lexicons_api.router)
    app.include_router(engines_api.router)
    app.include_router(models_api.router)
    app.include_router(engines_models_api.router)
    app.include_router(engine_sources_api.router)
    app.include_router(llm_runner_router)
    # THE SHARED STACK, ONE CALL (convergence part 2, 2026-08-01; completed by
    # F1 Phase 2, 2026-08-05 — convergence part 3): the same install_llm
    # JustWrite boots through — LLM tables in JV's SQLite, DB-backed provider
    # CRUD, routing/presets/tunes/knob-catalog surface, the DB usage sink, the
    # bundled runner wired to the DB catalog (data under <data_dir>/ai-cache),
    # and now JV's OWN feature data: every action a template row, every tunable
    # on a preset, per-row Lab samples. The old jv_feature_prompts system is
    # gone (its editor router, store, seeder); edited legacy rows migrate below.
    from llm_runner.llm import install_llm, load_from_configs, stores
    from llm_runner.llm.seed import seed_llm

    from .database import session as _db_session
    from .engines.llm.migrate_prompts import (
        lift_edited_tunables_into_presets,
        migrate_jv_prompts_to_shared,
    )
    from .engines.llm.migrate_providers import migrate_settings_providers_to_db
    from .feature_catalog import FEATURE_CATALOG, PREFER_LOCAL_FEATURES
    from .seed_feature_prompts import DEFAULT_FEATURE_PROMPTS
    from .seed_presets import (
        DEFAULT_ENGINE_PRESETS,
        DEFAULT_FEATURE_PRESETS,
        DEFAULT_PRESET_ID,
        DEFAULT_TEST_SAMPLES,
        JV_CLASS_TUNE_IDENTITY,
        JV_CLASS_TUNES,
        JV_MODEL_CATALOG,
    )

    install_llm(
        app,
        engine=_db_session.engine,
        session_factory=_db_session.SessionLocal,
        feature_catalog=FEATURE_CATALOG,
        # Every JV action as a template row (ruling 9) + the preset library the
        # rows run on (one-source: presets own every tunable) + per-row Lab
        # samples. Insert-if-missing; migrated legacy edits land first.
        feature_prompts=DEFAULT_FEATURE_PROMPTS,
        engine_presets=DEFAULT_ENGINE_PRESETS,
        feature_presets=DEFAULT_FEATURE_PRESETS,
        default_preset_id=DEFAULT_PRESET_ID,
        test_samples=DEFAULT_TEST_SAMPLES,
        # The family's measured daily driver ONLY (user direction 2026-08-05).
        # Since decision ④ every app seeds its whole catalog — the kit's shared
        # DEFAULT_CATALOG is empty and the old suppress flag is gone. JV also
        # registers the driver's measured class tunes + identity below, so the
        # family's 8 GB/32 GB (and sibling-class) launch configs apply here too.
        model_catalog_extra=JV_MODEL_CATALOG,
        class_tunes_seed=JV_CLASS_TUNES,
        class_tune_identity=JV_CLASS_TUNE_IDENTITY,
        # The pin-era PREFER_LOCAL_FEATURES, as the install param (config.py's
        # mapper dies with the pins).
        prefer_local_features=PREFER_LOCAL_FEATURES,
        data_dir=data_dir,
        # Names JV in the family cache registry so a sibling app's Quick Setup
        # can offer to SHARE the engine + model cache instead of re-downloading.
        product=PRODUCT,
        # allow_key_reveal stays OFF: JV has no CSRF/origin middleware.
    )
    # JV's warm-on-startup default is OFF (ruling 2026-08-05: the TTS engines own
    # the GPU until F4's VRAM arbiter; the user can flip it on). The SHARED seed
    # inserts "1" when the row is missing and the runtime reads an absent row as
    # ON, so JV must hold an explicit "0" — written BEFORE seed_llm() so the
    # shared insert-if-missing skips it. One-time by marker: DBs seeded since
    # 2026-08-01 already carry the shared "1" (no JV surface ever exposed the
    # toggle, so it cannot be a user's choice), and a user who later flips warm
    # ON must keep that choice across boots. (Shared with factory-reset's
    # dual-seed path — llm_bootstrap.py.)
    from .llm_bootstrap import apply_jv_warm_default

    apply_jv_warm_default()
    # Legacy prompt rows: an EDITED jv_feature_prompts row migrates into the
    # shared table FIRST (before seed_llm), so the insert-if-missing seed
    # skips it — user edits win over seed defaults (ruling 1).
    migrate_jv_prompts_to_shared()
    # One-time settings→DB provider migration (idempotent by id), then the
    # shared seed (insert-if-missing), then the registry boots FROM THE DB —
    # the exact order JustWrite uses, so `registered` flags are live from boot.
    migrate_settings_providers_to_db(state.settings.get())
    seed_llm()
    # After the presets exist: a legacy row's hand-changed temperature/think
    # lifts onto its feature's assigned preset (one-time, marker-guarded).
    lift_edited_tunables_into_presets()
    # One-time: existing DBs drop the retired shared-default catalog rows so
    # the catalog matches a fresh install (the measured 26B row only).
    from .llm_bootstrap import retire_default_catalog_rows

    retire_default_catalog_rows()
    load_from_configs(stores.get_provider_store().list())

    app.include_router(generate_api.router)
    app.include_router(render_chapter_api.router)
    app.include_router(analyzer_api.router)
    app.include_router(external_api.router)
    app.include_router(cache_api.router)
    app.include_router(master_api.router)
    app.include_router(phase5_api.router)
    app.include_router(projects_api.router)

    # Phase 4a backend (DESIGN_FREEZE §5)
    app.include_router(takes_api.router)
    app.include_router(channels_api.router)
    app.include_router(mcp_bindings_api.router)
    app.include_router(active_tasks_api.router)
    app.include_router(capture_readiness_api.router)
    app.include_router(captures_api.router)
    # The shared /v1/data backup/restore/reset (family parity batch 2026-08-06 —
    # JW's donor wiring in data_admin.py; the bespoke /v1/backup + /v1/restore +
    # /v1/admin/factory-reset died with it, no old-zip compat per decision ②).
    app.include_router(get_data_router())
    # The shared platform log + disk surface (kit LogsPanel + Storage read
    # these; JV's private ring/file twins died with F1 Phase 2).
    app.include_router(make_logs_router(PRODUCT))
    app.include_router(make_disk_router(data_dir))
    app.include_router(sse_streams_api.router)
    # (projects_api is included once, in the Phase-5 block above — it was
    # registered twice until the 2026-06-13 wiring audit, W7.)

    # Phase 4a addendum (gap-decision workflow v1.0 endpoints)
    app.include_router(webhooks_api.router)
    app.include_router(render_presets_api.router)
    app.include_router(bulk_delete_api.router)
    app.include_router(voice_preview_api.router)
    app.include_router(project_export_api.router)
    app.include_router(effect_presets_api.router)
    app.include_router(prefs_api.router)
    app.include_router(extraction_api.router)
    app.include_router(smart_assign_api.router)
    app.include_router(preset_suggest_api.router)

    # MCP server — justvoice.speak / list_voices / list_personas for local
    # AI agents, mounted at /mcp (Streamable HTTP). Must mount before the
    # root StaticFiles catch-all. OPTIONAL: a venv that predates the
    # fastmcp dependency (pip install -e . not re-run after pulling) must
    # still boot the app — the Tauri shell otherwise hangs at "Server
    # starting…" forever on an import crash.
    try:
        from .mcp import mount_into as mount_mcp

        mount_mcp(app)
    except ImportError as e:
        log.warning(
            "MCP server disabled — optional dependency missing (%s). "
            "Run `pip install -e .` in server/ to enable /mcp.", e
        )
    except Exception as e:
        log.warning("MCP server failed to mount (continuing without it): %s", e)

    # Shutdown hook — make sure any running managed engine subprocess is
    # killed before the host server exits. Without this, ctrl-C in dev
    # would leave engine subprocesses orphaned.
    @app.on_event("shutdown")
    async def _shutdown_managed_engines() -> None:
        try:
            shutdown_manager()
        except Exception as e:
            log.warning("manager shutdown raised: %s", e)

    # GUI — the Vite-built Vue SPA (dist/). The Tauri webview loads this build
    # directly; serving it here lets the headless server show the same UI at
    # its own origin (same-origin fetch, no CORS dance). The build references
    # its assets at absolute /assets/... paths, so it MUST mount at root.
    # Legacy single-file GUI — kept in-repo at legacy-gui/ purely as a UX
    # reference for side-by-side comparison while the new SPA catches up.
    # Served at /legacy/ so it talks to the same v1 API (mostly compatible).
    # Mounted before the root catch-all. Not shipped in production builds.
    legacy_dir = Path(__file__).resolve().parents[2] / "legacy-gui"
    if legacy_dir.is_dir() and (legacy_dir / "index.html").is_file():
        # Bare /legacy (no trailing slash) — redirect so the link just works.
        @app.get("/legacy", include_in_schema=False)
        async def legacy_redirect():
            return RedirectResponse("/legacy/")

        app.mount(
            "/legacy", StaticFiles(directory=str(legacy_dir), html=True), name="legacy"
        )
        log.info("Legacy reference UI served from %s", legacy_dir)

    ui_dir = _locate_ui_dir()
    if ui_dir is not None:
        # /ui/ kept as a redirect for the documented headless URL.
        @app.get("/ui", include_in_schema=False)
        @app.get("/ui/", include_in_schema=False)
        async def ui_redirect():
            return RedirectResponse("/")

        # Mounted last so every /v1/... router and /docs win first.
        app.mount("/", StaticFiles(directory=str(ui_dir), html=True), name="ui")
        log.info("UI served from %s", ui_dir)
    else:
        log.warning(
            "UI build not found — headless UI disabled. Run `npm run build:vite` "
            "to produce dist/, or set JUSTVOICE_UI_DIR."
        )

    return app


def _locate_ui_dir() -> Path | None:
    """Find the Vite build output (dist/) across dev + packaged layouts."""
    candidates: list[Path] = []
    override = os.environ.get("JUSTVOICE_UI_DIR")
    if override:
        candidates.append(Path(override))
    # Source layout: server/justvoice/app.py -> parents[2] is the repo root.
    candidates.append(Path(__file__).resolve().parents[2] / "dist")
    # Packaged / cwd fallback.
    candidates.append(Path.cwd() / "dist")
    for c in candidates:
        if c.is_dir() and (c / "index.html").is_file():
            return c
    return None


def _register_existing_engines(state: AppState, data_dir: Path) -> None:
    """Boot-time engine registration.

    Managed engines (Kokoro + future ported sidecars) are handled by the
    plugin manager — discovery runs the first time `get_manager()` is
    called, which we trigger here so the catalog is populated before the
    first request. The manager doesn't auto-LOAD anything; that's the
    user's explicit action via /v1/engines/{id}/load.

    Legacy sidecar engines that haven't been ported yet still need their
    in-process registration here, gated by an `.installed` marker file
    under the data dir. Once each engine is ported to a manifest.py, its
    entry below can be removed.
    """

    # Kick off plugin discovery so the catalog is ready.
    mgr = get_manager()
    log.info(
        "plugin manager discovered %d managed engines: %s",
        len(mgr.manifests()),
        ", ".join(sorted(mgr.manifests().keys())) or "(none)",
    )

    # All built-in engines (kokoro, chatterbox, dia, tada, qwen3, luxtts,
    # moss-tts) now live as managed plugins under engines/<id>/. Higgs
    # was removed 2026-06-09 (non-commercial weight license conflicted
    # with commercial-output use cases). The legacy in-process engine
    # factory was removed
    # along with the per-engine flat-file modules. External OpenAI-compat
    # engines are still registered in `state.engines` via
    # `_register_external_engines` below — they don't need subprocess
    # isolation because they're just httpx clients.


def _register_external_engines(state: AppState) -> None:
    """Register every configured external TTS provider.

    Phase 2 / Slice 5: the `provider_type` discriminator on
    ExternalEngineConfig picks the right adapter class. Default
    "openai-compat" preserves the legacy single-pattern behavior for
    existing settings.engines.external entries.
    """
    settings = state.settings.get()
    for cfg in settings.engines.external:
        try:
            backend = _build_external_engine(cfg)
            state.engines.register(backend)
            log.info(
                "external TTS provider registered: id=%s type=%s",
                cfg.id,
                cfg.provider_type,
            )
        except Exception as e:
            log.warning(
                "external TTS provider %s skipped at boot: %s",
                cfg.id,
                e,
            )


def _build_external_engine(cfg):
    """Pick the right adapter class for cfg.provider_type."""
    pt = (cfg.provider_type or "openai-compat").lower()
    if pt in ("openai-compat", "openai-tts", "external-openai-tts"):
        # OpenAI TTS uses the same /v1/audio/speech shape as openai-compat;
        # they're the same adapter with a different default base_url.
        base_url = cfg.base_url or (
            "https://api.openai.com" if pt == "openai-tts" else ""
        )
        if not base_url:
            raise ValueError(
                f"{cfg.id}: openai-compat external engine needs a base_url"
            )
        return ExternalOpenAiTtsBackend(
            id=cfg.id,
            name=cfg.name,
            base_url=base_url,
            api_key=cfg.api_key,
            model=cfg.model or "tts-1",
            voices=cfg.voices,
            response_format=cfg.response_format,
        )
    if pt == "elevenlabs":
        from .engines.tts_providers.elevenlabs import ElevenLabsBackend

        return ElevenLabsBackend(
            id=cfg.id,
            name=cfg.name,
            api_key=cfg.api_key or "",
            model=cfg.model or "eleven_flash_v2_5",
            voices=cfg.voices,
            base_url=cfg.base_url,
            response_format=cfg.response_format,
        )
    if pt == "speechify":
        from .engines.tts_providers.speechify import SpeechifyBackend

        return SpeechifyBackend(
            id=cfg.id,
            name=cfg.name,
            api_key=cfg.api_key or "",
            model=cfg.model or "simba-multilingual",
            voices=cfg.voices,
            base_url=cfg.base_url,
            response_format=cfg.response_format,
        )
    if pt == "speechmatics":
        from .engines.tts_providers.speechmatics import SpeechmaticsBackend

        return SpeechmaticsBackend(
            id=cfg.id,
            name=cfg.name,
            api_key=cfg.api_key or "",
            model=cfg.model or "default",
            voices=cfg.voices,
            base_url=cfg.base_url,
            response_format=cfg.response_format,
        )
    if pt == "edge-tts":
        raise NotImplementedError(
            "Edge TTS adapter requires Tauri-side msedge-tts wiring — deferred"
        )
    raise ValueError(f"unknown TTS provider_type: {pt!r}")
