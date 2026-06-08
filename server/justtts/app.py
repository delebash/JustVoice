"""FastAPI application factory.

Boots the AppState (engine registry + stores + training registry),
walks installed model dirs to register real engines, registers any
configured external engines, then mounts every router.

The GUI (Vue 3 SPA) is served from /ui/ via StaticFiles.
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from .api import (
    analyzer_api,
    engines_api,
    external_api,
    generate_api,
    health,
    lexicons_api,
    models_api,
    personas_api,
    settings_api,
    system_api,
    voices_api,
)
from .app_state import AppState, set_state
from .auth import BearerAuthMiddleware
from .engines.external_openai import ExternalOpenAiTtsBackend
from .engines.kokoro import KokoroBackend
from .errors import ApiError, api_exception_handler, http_exception_handler
from .paths import default_data_dir, models_root
from .version import API_VERSION, PRODUCT, VERSION

log = logging.getLogger(__name__)


def create_app(data_dir: Path | None = None) -> FastAPI:
    data_dir = data_dir or default_data_dir()
    state = AppState(data_dir)
    set_state(state)
    _register_existing_engines(state, data_dir)
    _register_external_engines(state)

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

    # CORS
    if settings.cors.origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors.origins,
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
    app.include_router(settings_api.router)
    app.include_router(voices_api.router)
    app.include_router(personas_api.router)
    app.include_router(lexicons_api.router)
    app.include_router(engines_api.router)
    app.include_router(models_api.router)
    app.include_router(generate_api.router)
    app.include_router(analyzer_api.router)
    app.include_router(external_api.router)

    # GUI — single-file Vue SPA at gui/index.html
    gui_dir = Path("gui")
    if gui_dir.is_dir():
        app.mount("/ui", StaticFiles(directory=str(gui_dir), html=True), name="ui")

        @app.get("/", include_in_schema=False)
        async def root_redirect():
            return RedirectResponse("/ui/")

    return app


def _register_existing_engines(state: AppState, data_dir: Path) -> None:
    """Walk installed model dirs + register the real engine for each.

    Mirrors the Rust ``register_existing_engines`` function.
    """
    settings = state.settings.get()
    # Kokoro: check the override path first, then the default
    override = settings.engines.kokoro.model_dir_override
    default_dir = models_root(data_dir) / "kokoro"
    kokoro_dir = Path(override) if override else default_dir
    kokoro = KokoroBackend(kokoro_dir)
    if kokoro.model_files_present():
        state.engines.register(kokoro)
        log.info("Kokoro registered from %s", kokoro_dir)
    else:
        log.info(
            "Kokoro model files not found under %s — install via /v1/engines/kokoro/install or set engines.kokoro.model_dir_override",
            kokoro_dir,
        )


def _register_external_engines(state: AppState) -> None:
    """Register any configured external OpenAI-compatible TTS servers."""
    settings = state.settings.get()
    for cfg in settings.engines.external:
        backend = ExternalOpenAiTtsBackend(
            id=cfg.id,
            name=cfg.name,
            base_url=cfg.base_url,
            api_key=cfg.api_key,
            model=cfg.model,
            voices=cfg.voices,
            response_format=cfg.response_format,
        )
        state.engines.register(backend)
        log.info(
            "external OpenAI-compatible engine registered: id=%s base_url=%s",
            cfg.id,
            cfg.base_url,
        )
