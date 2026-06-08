"""Engine lifecycle — install / load / unload / uninstall + install jobs."""

from __future__ import annotations

import logging

from fastapi import APIRouter

from ..app_state import get_state
from ..engines.catalog import known_engines
from ..engines.model_catalog import models_for, recommend_for_vram
from ..errors import bad_request, not_found, service_unavailable
from ..installer import spawn_install, uninstall_engine
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


@router.post("/v1/engines/{id}/install", response_model=InstallResponse, status_code=202)
async def install_engine(id: str, req: InstallRequest) -> InstallResponse:
    st = get_state()
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
        # Recommend
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
    engine = st.engines.get(id)
    if engine is None:
        raise not_found(
            f"Engine '{id}' is not installed. POST /v1/engines/{id}/install first."
        )
    try:
        engine.load(req.device, req.model_variant)
    except Exception as e:
        raise service_unavailable(f"engine load failed: {e}")
    st.engines.set_current(id)
    return LoadResponse(engine_id=id, device=req.device, model_variant=req.model_variant)


@router.post("/v1/engines/unload", response_model=UnloadResponse)
async def unload_engine() -> UnloadResponse:
    st = get_state()
    previous = st.engines.current()
    if previous:
        engine = st.engines.get(previous)
        if engine:
            try:
                engine.unload()
            except Exception as e:
                log.warning("engine.unload() returned error: %s", e)
    st.engines.clear_current()
    return UnloadResponse(previous_engine=previous)


@router.delete("/v1/engines/{id}", response_model=UninstallResponse)
async def uninstall_engine_endpoint(id: str) -> UninstallResponse:
    st = get_state()
    if not any(e.id == id for e in known_engines()):
        raise not_found(f"Unknown engine: {id}")
    model_dir = models_root(st.data_dir) / id
    removed = uninstall_engine(st, id, model_dir)
    return UninstallResponse(engine_id=id, model_files_removed=removed)


@router.get("/v1/jobs/{job_id}", response_model=JobStatus)
async def get_job(job_id: str) -> JobStatus:
    st = get_state()
    data = st.job_get(job_id)
    if not data:
        raise not_found(f"job {job_id}")
    return JobStatus.model_validate(data)
