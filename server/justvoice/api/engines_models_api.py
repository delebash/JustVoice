"""Engine lifecycle — install / load / unload / uninstall + install jobs.

Dispatches between the new plugin manager (engines with `manifest.py`) and
the legacy in-process registry (currently only external OpenAI-compatible
engines). The branch lives in each route so the route shapes stay the same.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter
from pydantic import BaseModel

from ..app_state import get_state
from ..engines.catalog import known_engines
from ..engines.manager import get_manager
from ..engines.model_catalog import models_for, recommend_for_vram
from ..errors import bad_request, not_found, service_unavailable
from ..engines.shared_venv import detect_gpu
from ..installer import cancel as cancel_install
from ..installer import (
    pip_uninstall_engine_deps,
    spawn_install,
    spawn_managed_install,
    spawn_shared_venv_setup,
    uninstall_engine,
)
from ..models import (
    InstallRequest,
    InstallResponse,
    JobStatus,
    LoadRequest,
    LoadResponse,
    UninstallResponse,
    UnloadResponse,
)
from ..paths import models_root

log = logging.getLogger(__name__)
router = APIRouter(tags=["engines"])


def _is_managed(engine_id: str) -> bool:
    return get_manager().get_manifest(engine_id) is not None


@router.post("/v1/engines/{id}/install", response_model=InstallResponse, status_code=202)
async def install_engine(id: str, req: InstallRequest) -> InstallResponse:
    """Install model files + Python deps for the engine.

    Managed engines (have a `manifest.py`) get the new uv-based venv +
    declarative install pipeline. Legacy engines (only external-openai-tts
    has any registry presence now) raise — there's nothing to install.
    """
    st = get_state()

    if _is_managed(id):
        job_id = spawn_managed_install(st, id)
        return InstallResponse(engine_id=id, model_variant="managed", job_id=job_id)

    # Legacy in-process path (currently dormant — no built-in legacy engines
    # remain after the kokoro port). Keep it around so the route doesn't
    # blow up if something registers a non-manifest engine in the future.
    if not any(e.id == id for e in known_engines()):
        raise not_found(f"Unknown engine: {id}")
    variants = models_for(id)
    if not variants:
        raise not_found(f"No model variants for engine {id}")

    if req.model_variant:
        chosen = next((v for v in variants if v.id == req.model_variant), None)
        if not chosen:
            raise not_found(f"Unknown model variant '{req.model_variant}' for engine '{id}'")
    else:
        from ..system_info import detect

        info = detect()
        vram = max((g.vram_mb for g in info.gpus if g.vram_mb), default=None)
        best_fit, _, _ = recommend_for_vram(id, vram)
        chosen = best_fit or variants[0]

    model_dir = models_root(st.data_dir) / id
    job_id = spawn_install(st, id, chosen, model_dir)
    return InstallResponse(engine_id=id, model_variant=chosen.id, job_id=job_id)


@router.post("/v1/engines/{id}/load", response_model=LoadResponse)
async def load_engine(id: str, req: LoadRequest) -> LoadResponse:
    st = get_state()

    if _is_managed(id):
        mgr = get_manager()
        try:
            mgr.load(id, device=req.device, variant=req.model_variant)
        except Exception as e:
            raise service_unavailable(f"engine load failed: {e}")
        # Clear the in-process current marker so it doesn't conflict with
        # the managed engine claim.
        st.engines.clear_current()
        return LoadResponse(engine_id=id, device=req.device, model_variant=req.model_variant)

    # Legacy in-process path — used by external-openai-tts.
    engine = st.engines.get(id)
    if engine is None:
        raise not_found(
            f"Engine '{id}' is not installed. POST /v1/engines/{id}/install first."
        )
    # If a managed engine is loaded, unload it first — only one engine at a time.
    mgr = get_manager()
    if mgr.current_id():
        mgr.unload()
    try:
        engine.load(req.device, req.model_variant)
    except Exception as e:
        raise service_unavailable(f"engine load failed: {e}")
    st.engines.set_current(id)
    return LoadResponse(engine_id=id, device=req.device, model_variant=req.model_variant)


@router.post("/v1/engines/{id}/cancel-load")
async def cancel_engine_load(id: str) -> dict:
    """Signal an in-flight `POST /v1/engines/{id}/load` to abort. The
    load loop checks the cancel flag at safe points (between shared-venv
    setup, model download, subprocess spawn, and child `/load`) and
    raises 'cancelled by user' which surfaces back as a 503 to the
    original load request. Subprocess is killed if already spawned, so
    no VRAM keeps being consumed after the cancel."""
    if not _is_managed(id):
        # In-process engines (external-openai-tts) — load is synchronous;
        # no cancel hook needed because there's nothing to interrupt.
        return {"engine_id": id, "cancelled": False, "reason": "engine is not managed; nothing to cancel"}
    mgr = get_manager()
    cancelled = mgr.request_cancel_load(id)
    return {"engine_id": id, "cancelled": cancelled}


class UnloadRequest(BaseModel):
    """Optional body: when `kind` is supplied (Phase 2 / Slice 1),
    only the engine in that kind's slot is unloaded. Other-kind slots
    stay loaded — required for the speaker-attribution workflow where
    an LLM + TTS engine need to be resident at the same time.

    Omitting the body or sending {} preserves the legacy behavior of
    unloading every loaded engine.
    """
    kind: str | None = None


@router.post("/v1/engines/unload", response_model=UnloadResponse)
async def unload_engine(body: UnloadRequest | None = None) -> UnloadResponse:
    st = get_state()
    mgr = get_manager()
    requested_kind = body.kind if body else None

    if requested_kind:
        previous_managed = mgr.current_for(requested_kind)
        previous_inproc = None
    else:
        previous_managed = mgr.current_id()
        previous_inproc = st.engines.current()
    previous = previous_managed or previous_inproc

    if previous_managed:
        mgr.unload(kind=requested_kind)
    if previous_inproc and not requested_kind:
        engine = st.engines.get(previous_inproc)
        if engine:
            try:
                engine.unload()
            except Exception as e:
                log.warning("engine.unload() returned error: %s", e)
        st.engines.clear_current()

    return UnloadResponse(previous_engine=previous)


@router.delete("/v1/engines/{id}", response_model=UninstallResponse)
async def uninstall_engine_endpoint(
    id: str, uninstall_deps: bool = False
) -> UninstallResponse:
    """Remove install-created files. For managed engines, rmtree
    `.venv/models/voices/state`; nothing escapes the engine's folder. For
    legacy engines, remove model files and (optionally) pip-uninstall the
    engine's deps from the shared interpreter.
    """
    st = get_state()

    if _is_managed(id):
        mgr = get_manager()
        result = mgr.uninstall(id)
        return UninstallResponse(
            engine_id=id,
            model_files_removed=bool(result.get("removed")),
            pip_packages_removed=[],  # Managed engines have their own venv — nothing to surgical-uninstall.
        )

    # Legacy path.
    if not any(e.id == id for e in known_engines()):
        raise not_found(f"Unknown engine: {id}")
    model_dir = models_root(st.data_dir) / id
    removed = uninstall_engine(st, id, model_dir)
    deps_removed: list[str] = []
    if uninstall_deps:
        deps_removed = pip_uninstall_engine_deps(id)
    return UninstallResponse(
        engine_id=id, model_files_removed=removed, pip_packages_removed=deps_removed
    )


@router.get("/v1/jobs/{job_id}", response_model=JobStatus)
async def get_job(job_id: str) -> JobStatus:
    st = get_state()
    data = st.job_get(job_id)
    if not data:
        raise not_found(f"job {job_id}")
    return JobStatus.model_validate(data)


@router.post("/v1/engines/setup", status_code=202)
async def setup_shared_engines() -> dict:
    """Start (or restart) the one-time shared-venv setup. Returns a job_id
    that the GUI polls via /v1/jobs/{id}. Idempotent — re-running just
    re-checks the package set.

    The shared venv contains torch + every shared engine's Python deps in
    one interpreter. Once it's set up, each shared engine's per-engine
    Install button only downloads model files — fast.
    """
    st = get_state()
    job_id = spawn_shared_venv_setup(st)
    return {"job_id": job_id}


@router.get("/v1/engines/setup")
async def get_setup_status() -> dict:
    """Return shared-venv readiness + the detected GPU vendor / torch index.

    The GUI's "Set up engines" button uses this to decide whether to show
    "Set up engines" (not ready) or "Re-run setup" (already ready)."""
    from ..engines.manager import shared_venv_exists, SHARED_VENV_DIR, _current_os_label

    vendor, index_url, label = detect_gpu()
    return {
        "ready": shared_venv_exists(),
        "venv_path": str(SHARED_VENV_DIR),
        "current_os": _current_os_label(),
        "gpu_vendor": vendor,
        "gpu_label": label,
        "torch_index_url": index_url,
    }


@router.delete("/v1/jobs/{job_id}", status_code=202)
async def cancel_job(job_id: str) -> dict:
    """Signal an in-flight install job to abort at its next safe checkpoint.

    Works for both managed and legacy installs — both consult
    installer._is_cancelled(job_id) at their inner loops.
    """
    st = get_state()
    data = st.job_get(job_id)
    if not data:
        raise not_found(f"job {job_id}")
    cancel_install(job_id)
    return {"cancelled": job_id}
