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
from ..engines.manager import get_manager
from ..errors import not_found, service_unavailable
from ..installer import cancel as cancel_install
from ..installer import (
    spawn_engine_setup,
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
async def install_engine(id: str, req: InstallRequest) -> InstallResponse:
    """Install model files + Python deps for the engine.

    Routing (one-button fix, docs/plans/2026-06-15-engines-one-button.md):
    - Managed engine + `model_variant` given → spawn_prefetch. Real model
      download with progress, HF cache for HF engines, models_dir for
      URL-tarball engines.
    - Managed engine + no `model_variant` → spawn_managed_install. Venv
      build only. Models download via a second /install call once the engine
      row exposes its variants.

    Every engine is manifest-managed; the legacy in-process install path was
    excised 2026-08-14 with the static catalog it depended on.

    Splitting the two is what stopped an engine from silently re-downloading
    its weights at Load time: an install that only built an environment used
    to report "installed" while the model files were still missing.
    """
    st = get_state()

    if _is_managed(id):
        if req.model_variant:
            try:
                job_id = spawn_prefetch(st, id, req.model_variant)
            except ValueError as e:
                raise not_found(str(e))
            return InstallResponse(engine_id=id, model_variant=req.model_variant, job_id=job_id)
        # Engine-wide setup (venv build) for isolated engines that need
        # pip deps before any model fetch can run.
        job_id = spawn_managed_install(st, id)
        return InstallResponse(engine_id=id, model_variant="managed", job_id=job_id)

    raise not_found(f"Unknown engine: {id}")


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
    load loop checks the cancel flag at safe points (between model
    download, subprocess spawn, and child `/load`) and
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
    """Remove install-created files: rmtree the engine's own
    `.venv/models/voices/state`; nothing escapes its folder.

    `uninstall_deps` is accepted and ignored — it drove a pip-uninstall from a
    SHARED interpreter for legacy in-process engines, which stopped existing
    when every engine moved to its own venv (the flag's branch was already
    unreachable; excised 2026-08-14 with the static catalog).
    """
    if _is_managed(id):
        mgr = get_manager()
        result = mgr.uninstall(id)
        return UninstallResponse(
            engine_id=id,
            model_files_removed=bool(result.get("removed")),
            pip_packages_removed=[],  # Managed engines have their own venv — nothing to surgical-uninstall.
        )

    raise not_found(f"Unknown engine: {id}")


@router.get("/v1/jobs/{job_id}", response_model=JobStatus)
async def get_job(job_id: str) -> JobStatus:
    st = get_state()
    data = st.job_get(job_id)
    if not data:
        raise not_found(f"job {job_id}")
    return JobStatus.model_validate(data)


@router.post("/v1/engines/setup", status_code=202)
async def setup_engines() -> dict:
    """Install every built-in engine that is not installed yet. Returns a
    job_id the GUI polls via /v1/jobs/{id}. Idempotent — engines already
    installed are skipped, so re-running only picks up what is missing.

    Each engine builds its own environment from its own manifest. Before
    2026-08-22 this built one shared interpreter for most engines instead;
    that is gone, along with the class of failure where one engine's install
    re-resolved another engine's pinned dependencies.
    """
    st = get_state()
    job_id = spawn_engine_setup(st)
    return {"job_id": job_id}


@router.get("/v1/engines/setup")
async def get_setup_status() -> dict:
    """How far engine setup has got, plus the wheel index this box resolves to.

    `ready` means every engine that CAN be installed here already is, so the
    GUI can offer "Set up engines" or "Re-run setup" without guessing.
    Deprecated engines and engines this OS does not support are excluded from
    both counts — offering a setup that can never complete is worse than
    offering none.

    Readiness is per engine and comes from `EngineManifest.is_installed`,
    which checks three things: the interpreter exists, it was built for this
    install location, and its package set still matches the manifest.
    """
    from ..engines.manager import _current_os_label, _detect_torch_index_url

    mgr = get_manager()
    eligible = [
        m for m in mgr.manifests().values()
        if not (m.deprecated or "").strip() and m.supports_current_os()
    ]
    pending = [m.id for m in eligible if not m.is_installed]
    index_url, label = _detect_torch_index_url()
    return {
        "ready": bool(eligible) and not pending,
        "engines_total": len(eligible),
        "engines_installed": len(eligible) - len(pending),
        "engines_pending": sorted(pending),
        "current_os": _current_os_label(),
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
