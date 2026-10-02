# SPDX-License-Identifier: MIT
"""/v1/engines/{id}/models — installable model variants.

The `/models/recommended` endpoint died 2026-08-14 (the measured redesign's
second rethink): it ranked variants by scaffold-invented per-variant
`vram_mb` conclusions, and its one renderer read was a field it never
returned. A no-choice install resolves through
`model_catalog.default_variant_for` instead.

Every speech model lives in the speech cache (`speech_cache.py`). Until the
2026-10-01 switch a model could also count as downloaded from an engine's own
legacy folder or a Hugging Face cache; both probes went with the per-engine
environments — and the HF one would now be wrong outright, because every
variant comes from the one `audio-cpp/audio.cpp-gguf` repository, so one cached
file would have marked them all downloaded."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from ..engines.model_catalog import models_for
from ..errors import conflict, not_found
from ..models import ModelsListResponse

router = APIRouter(tags=["engines"])


def _annotate_placement(engine_id: str, variants) -> None:
    """Where each model runs, or would run now, and why; its CPU speed (CPU placement,
    2026-10-02 — docs/plans/2026-10-02-cpu-placement.md §8)."""
    from ..engines.manager import get_manager

    mgr = get_manager()
    m = mgr.get_manifest(engine_id)
    kind = m.kind
    loaded = mgr.current_variant_id(engine_id) if mgr.status(engine_id) == "loaded" else None
    for v in variants:
        v.placement = mgr._user_placement(engine_id, v.id)
        v.cpu_realtime, v.cpu_realtime_here = mgr.cpu_speed(kind, engine_id, v.id)
        if v.id == loaded:
            v.runs_on = "cpu" if (mgr.resolved_device_for(engine_id) or "") == "cpu" else "gpu"
            v.runs_on_reason = mgr.placement_reason_for(engine_id)
        else:
            v.runs_on, v.runs_on_reason, _unload = mgr.placement_for(m, kind, v.id)


# Plain `def`: placement reads the graphics card (a device query) — thread pool, not
# the event loop.
@router.get("/v1/engines/{id}/models", response_model=ModelsListResponse)
def list_models(id: str) -> ModelsListResponse:
    # Validate against the manager's discovered manifests — the ONE catalog
    # (the parallel static list was excised 2026-08-14).
    from ..engines.manager import get_manager

    if get_manager().get_manifest(id) is None:
        raise not_found(f"engine {id}")
    variants = models_for(id)
    # The per-model on-disk flag drives the verb shown (Download vs Load/Delete):
    # the speech cache's files.json, every file present at its recorded size.
    from ..app_state import get_state
    from ..speech_cache import variant_dir, variant_on_disk

    st = get_state()
    for v in variants:
        v.on_disk = variant_on_disk(st.data_dir, id, v.id)
        if v.on_disk:
            # local_dir rides along for the desktop "Open folder" verb —
            # resolved HERE so the layout knowledge stays server-side.
            v.local_dir = str(variant_dir(st.data_dir, id, v.id))
    _annotate_placement(id, variants)
    return ModelsListResponse(engine_id=id, variants=variants)


class PlacementBody(BaseModel):
    placement: Literal["auto", "gpu", "cpu"]


@router.put("/v1/engines/{id}/models/{variant_id}/placement")
def set_model_placement(id: str, variant_id: str, body: PlacementBody) -> dict:
    """Where one model runs: Auto, the graphics card, or the CPU — saved per model in
    `engine_overrides[id].placements`. A loaded model is not moved here: the answer's
    `moves` says it would now run elsewhere, and the next load of it (the app reloads it)
    puts it there."""
    from ..app_state import get_state
    from ..engines.manager import get_manager
    from ..models import EngineOverrides

    mgr = get_manager()
    m = mgr.get_manifest(id)
    if m is None:
        raise not_found(f"engine {id}")
    if not any(v.id == variant_id for v in models_for(id)):
        raise not_found(f"variant {variant_id} on engine {id}")
    store = get_state().settings
    cur = store.get()
    ov = cur.engines.engine_overrides.get(id) or EngineOverrides()
    if body.placement == "auto":
        ov.placements.pop(variant_id, None)
    else:
        ov.placements[variant_id] = body.placement
    cur.engines.engine_overrides[id] = ov
    store.set(cur)
    runs_on, why, _unload = mgr.placement_for(m, m.kind, variant_id)
    loaded = mgr.status(id) == "loaded" and mgr.current_variant_id(id) == variant_id
    now = ("cpu" if (mgr.resolved_device_for(id) or "") == "cpu" else "gpu") if loaded else None
    return {"engine_id": id, "variant_id": variant_id, "placement": body.placement,
            "runs_on": runs_on, "runs_on_reason": why, "loaded": loaded,
            "moves": bool(loaded and now != runs_on)}


@router.post("/v1/engines/speech-cache/clear")
async def clear_speech_cache() -> dict:
    """Delete every downloaded speech model (the whole speech cache) to
    reclaim disk — the Settings Disk-usage panel's per-store clear verb
    (phase ④), one grammar with the kit's LLM `models-cache/clear`. SAFE BY
    DESIGN: the catalog rows come from the manifests, so each model simply
    re-downloads the next time it's loaded. Refuses with
    `{ok: false, detail: "unload engines first"}` (HTTP 200) while any
    engine is loaded — a resident model's file is open in the runtime
    (and Windows can't unlink an open file); unload, then retry.
    On success returns `{ok: true, bytes}`."""
    import shutil

    from llm_runner.platform.disk_api import dir_size

    from ..app_state import get_state
    from ..engines.manager import get_manager
    from ..paths import speech_cache_root

    mgr = get_manager()
    if any(mgr.status(eid) == "loaded" for eid in mgr.manifests()):
        return {"ok": False, "detail": "unload engines first"}
    root = speech_cache_root(get_state().data_dir)
    freed = 0
    if root.exists():
        freed = dir_size(root)
        shutil.rmtree(root, ignore_errors=True)
    return {"ok": True, "bytes": freed}


@router.delete("/v1/engines/{id}/models/{variant_id}")
async def delete_model(id: str, variant_id: str) -> dict:
    """Delete one model's downloaded file(s) — the per-model 'Delete downloaded
    model' verb. The engine and its other variants stay."""
    import shutil

    from ..app_state import get_state
    from ..speech_cache import variant_dir, variant_on_disk

    variant = next((v for v in models_for(id) if v.id == variant_id), None)
    if variant is None:
        raise not_found(f"variant {variant_id} on engine {id}")
    st = get_state()
    if not variant_on_disk(st.data_dir, id, variant_id):
        raise not_found(f"{variant_id} has no downloaded files")
    vdir = variant_dir(st.data_dir, id, variant_id)
    shutil.rmtree(vdir, ignore_errors=True)
    if vdir.exists():
        # A file the runtime still holds open (Windows refuses the delete).
        raise conflict(f"{variant_id}'s files are still in use and were not deleted — "
                       f"unload the model and try again ({vdir})")
    return {"deleted": True, "engine_id": id, "variant_id": variant_id, "path": str(vdir)}
