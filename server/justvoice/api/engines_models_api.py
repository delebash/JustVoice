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
from ..engines.manager import InstallError, get_manager
from ..errors import conflict, not_found, service_unavailable
from ..installer import cancel as cancel_install
from ..installer import (
    spawn_managed_install,
    spawn_prefetch,
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

log = logging.getLogger(__name__)
router = APIRouter(tags=["engines"])


def _is_managed(engine_id: str) -> bool:
    return get_manager().get_manifest(engine_id) is not None


@router.post("/v1/engines/{id}/install", response_model=InstallResponse, status_code=202)
def install_engine(id: str, req: InstallRequest) -> InstallResponse:
    """Install an engine, or download one of its models.

    - `model_variant` given → spawn_prefetch: that model's file(s) into the
      speech cache, with progress.
    - no `model_variant` → spawn_managed_install: the shared speech runtime
      (audio.cpp + eSpeak NG) — once for every engine (the 2026-10-01 switch).
    """
    st = get_state()

    if _is_managed(id):
        if req.model_variant:
            try:
                job_id = spawn_prefetch(st, id, req.model_variant)
            except ValueError as e:
                raise not_found(str(e))
            return InstallResponse(engine_id=id, model_variant=req.model_variant, job_id=job_id)
        # Engine-wide setup: the speech runtime every engine shares.
        job_id = spawn_managed_install(st, id)
        return InstallResponse(engine_id=id, model_variant="managed", job_id=job_id)

    raise not_found(f"Unknown engine: {id}")


@router.post("/v1/engines/{id}/load", response_model=LoadResponse)
def load_engine(id: str, req: LoadRequest) -> LoadResponse:
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
def cancel_engine_load(id: str) -> dict:
    """Signal an in-flight `POST /v1/engines/{id}/load` to abort. The
    load loop checks the cancel flag at safe points (between the model
    download, the runtime start, and the model warm-up) and raises
    'cancelled by user', which surfaces back as a 503 to the original load
    request. A model already in the runtime is unloaded, so no VRAM keeps
    being consumed after the cancel."""
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
def unload_engine(body: UnloadRequest | None = None) -> UnloadResponse:
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
def uninstall_engine_endpoint(id: str) -> UninstallResponse:
    """Delete every downloaded model of this engine (its speech-cache folder).
    The speech runtime is shared and stays. 409 when a file is still held open."""
    if _is_managed(id):
        mgr = get_manager()
        try:
            result = mgr.uninstall(id)
        except InstallError as e:
            raise conflict(str(e)) from e
        return UninstallResponse(
            engine_id=id,
            model_files_removed=bool(result.get("removed")),
        )

    raise not_found(f"Unknown engine: {id}")


@router.get("/v1/jobs/{job_id}", response_model=JobStatus)
async def get_job(job_id: str) -> JobStatus:
    st = get_state()
    data = st.job_get(job_id)
    if not data:
        raise not_found(f"job {job_id}")
    return JobStatus.model_validate(data)


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
