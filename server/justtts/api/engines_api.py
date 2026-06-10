"""/v1/engines + /v1/engines/current — catalog + runtime engine status.

Merges three sources of truth into one response:
1. Manager-managed engines (engines/<id>/manifest.py — the new plugin model).
2. Legacy static catalog (engines.catalog.known_engines() — fallback only;
   most built-in engines are getting ported to the manager).
3. Runtime-registered in-process engines (state.engines.all() — currently
   only external OpenAI-compatible servers).

Status is derived per-engine:
- managed: manager.status(id) → not_installed | installed | loaded
- legacy:  state.engines registration + compute_status()
"""

from __future__ import annotations

from fastapi import APIRouter

from fastapi import HTTPException

from ..app_state import get_state
from ..engines.capability_details import CAPABILITY_DETAILS, lookup as lookup_capability
from ..engines.catalog import compute_status, known_engines
from ..engines.manager import EngineManifest, get_manager
from ..models import (
    CurrentEngineResponse,
    EngineCapabilitiesResponse,
    EngineCapabilityDetail,
    EngineInfo,
    EnginesListResponse,
    Feature,
    Prerequisites,
)

router = APIRouter(tags=["engines"])


# Mapping from manifest CAPABILITIES dict keys → Feature literal strings.
_CAPABILITY_TO_FEATURE: dict[str, Feature] = {
    "preset_voices": "preset_voices",
    "voice_cloning": "voice_cloning",
    "voice_design": "voice_design",
    "instruct_field": "instruct_field",
    "paralinguistic_tags": "paralinguistic_tags",
    "phoneme_override": "phoneme_override",
    "gpu_accel": "gpu_accel",
    "single_speaker_dialogue": "single_speaker_dialogue",
    "streaming_generation": "streaming_generation",
    "embedding_blending": "embedding_blending",
    "training": "training",
}


def _info_from_manifest(manifest: EngineManifest, status: str) -> EngineInfo:
    """Build an EngineInfo from a plugin manifest.

    `status` already accounts for the managed engine being loaded/installed;
    we just need to fill in the catalog metadata.
    """
    caps = manifest.capabilities
    feature_list: list[Feature] = [
        _CAPABILITY_TO_FEATURE[k]
        for k, enabled in caps.items()
        if enabled and k in _CAPABILITY_TO_FEATURE
    ]
    # Implicit GPU accel for any engine declaring CUDA / MPS / Metal in
    # gpu_runtimes — implicit GPU support if any GPU runtime is listed.
    req = manifest.requirements
    runtimes = req.get("gpu_runtimes", []) or []
    if any(r in ("cuda", "mps", "metal", "directml", "xpu", "coreml") for r in runtimes) and "gpu_accel" not in feature_list:
        feature_list.append("gpu_accel")

    return EngineInfo(
        id=manifest.id,
        name=manifest.name,
        description=manifest.description,
        backend="managed",
        capabilities=feature_list,
        prerequisites=Prerequisites(
            disk_space_mb=int(req.get("disk_space_mb", 0) or 0),
            gpu_runtimes=runtimes,
            rust_native=False,
            sidecar=False,
        ),
        status=status,
        current=False,  # filled in by caller
        is_stubbed=False,
        default_variant_id=manifest.default_variant_id,
        isolation=manifest.isolation,
        supported_oses=manifest.supported_oses,
        weights_license=manifest.weights_license,
        attribution=manifest.attribution,
    )


def _enrich_legacy(entry: EngineInfo, current_id: str | None) -> EngineInfo:
    """Fill status + current for an entry from the legacy static catalog."""
    st = get_state()
    instance = st.engines.get(entry.id)
    registered = instance is not None
    ready = instance.ready() if instance else False
    entry.status = compute_status(entry.id, registered, ready, current_id)
    entry.current = current_id == entry.id
    entry.is_stubbed = False
    return entry


def _current_id() -> str | None:
    """The id of whichever engine is loaded (managed or in-process), or None."""
    mgr = get_manager()
    return mgr.current_id() or get_state().engines.current()


@router.get("/v1/engines", response_model=EnginesListResponse, summary="Full engine catalog")
async def list_engines() -> EnginesListResponse:
    st = get_state()
    mgr = get_manager()
    cur = _current_id()

    catalog: list[EngineInfo] = []
    seen: set[str] = set()

    # 1. Managed engines (the new plugin model).
    for manifest in mgr.manifests().values():
        info = _info_from_manifest(manifest, status=mgr.status(manifest.id))
        info.current = manifest.id == cur
        catalog.append(info)
        seen.add(manifest.id)

    # 2. Legacy static catalog — only entries that don't have a manifest yet.
    #    Most engines (kokoro and the sidecar engines as they get ported) will
    #    drop out of this list once they have an engines/<id>/manifest.py.
    for entry in known_engines():
        if entry.id in seen:
            continue
        catalog.append(_enrich_legacy(entry, cur))
        seen.add(entry.id)

    # 3. Runtime-registered in-process engines (external OpenAI-compatible
    #    servers). Not in any static catalog.
    for engine in st.engines.all():
        eid = engine.meta.engine_id
        if eid in seen:
            continue
        catalog.append(
            EngineInfo(
                id=eid,
                name=engine.meta.display_name,
                description=f"Runtime-registered engine (backend: {engine.meta.backend}). Not in the static catalog.",
                backend=engine.meta.backend,
                capabilities=[],
                prerequisites=Prerequisites(),
                status=compute_status(eid, True, engine.ready(), cur),
                current=cur == eid,
                is_stubbed=False,
            )
        )
        seen.add(eid)

    return EnginesListResponse(engines=catalog, current=cur)


@router.get(
    "/v1/engines/capabilities",
    response_model=EngineCapabilitiesResponse,
    summary="Per-engine knob + inline-tag capability detail (drives Generate UI gating)",
)
async def list_engine_capabilities() -> EngineCapabilitiesResponse:
    """Return the full per-engine capability detail map.

    Keys may be either engine ids (`kokoro`, `qwen3`) or variant ids
    (`chatterbox-turbo`, `chatterbox-multilingual`) where the variant has
    materially different supported parameters from its base engine.

    The frontend should try the variant id first, then fall back to the
    base engine id — the same convention `lookup()` follows server-side.
    """
    return EngineCapabilitiesResponse(engines=dict(CAPABILITY_DETAILS))


@router.get(
    "/v1/engines/{engine_id}/capabilities",
    response_model=EngineCapabilityDetail,
    summary="Single-engine knob + inline-tag detail",
)
async def get_engine_capability(engine_id: str) -> EngineCapabilityDetail:
    detail = lookup_capability(engine_id)
    if detail is None:
        raise HTTPException(status_code=404, detail=f"No capability detail for engine {engine_id!r}")
    return detail


@router.get("/v1/engines/current", response_model=CurrentEngineResponse)
async def get_current_engine() -> CurrentEngineResponse:
    mgr = get_manager()
    cur = mgr.current_id() or get_state().engines.current()
    if cur is None:
        return CurrentEngineResponse(engine=None)

    # Managed engine?
    manifest = mgr.get_manifest(cur)
    if manifest:
        info = _info_from_manifest(manifest, status=mgr.status(cur))
        info.current = True
        return CurrentEngineResponse(engine=info)

    # Legacy / external — look up via static catalog or runtime registry.
    for entry in known_engines():
        if entry.id == cur:
            return CurrentEngineResponse(engine=_enrich_legacy(entry, cur))
    st = get_state()
    inst = st.engines.get(cur)
    if inst:
        return CurrentEngineResponse(
            engine=EngineInfo(
                id=cur,
                name=inst.meta.display_name,
                description="",
                backend=inst.meta.backend,
                capabilities=[],
                prerequisites=Prerequisites(),
                status=compute_status(cur, True, inst.ready(), cur),
                current=True,
                is_stubbed=False,
            )
        )
    return CurrentEngineResponse(engine=None)
