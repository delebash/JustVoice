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
    EngineVramResponse,
    Feature,
    Prerequisites,
    VramClaim,
    VramEvent,
    VramReservation,
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

    mgr = get_manager()
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
        # The RESOLVED default (parity batch 2026-08-06): the user's
        # Set-as-default override layered over the manifest's — so the UI's
        # "Default ✓" badge and a no-variant load can never disagree.
        default_variant_id=mgr.resolved_default_variant(manifest.id) or manifest.default_variant_id,
        # Phase 2 / Slice 1 — kind + current_variant_id surface so the
        # EnginesView dropdown can group by tab + label "Loaded: <v>".
        kind=manifest.kind,
        kinds=manifest.kinds,
        current_variant_id=mgr.current_variant_id(manifest.id),
        isolation=manifest.isolation,
        supported_oses=manifest.supported_oses,
        weights_license=manifest.weights_license,
        attribution=manifest.attribution,
        # The 2026-08-13 VRAM wiring (Q2): the device the load actually
        # resolved to, straight from the one load door.
        resolved_device=mgr.resolved_device_for(manifest.id),
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
    #    servers). Not in any static catalog. self_hosted comes from the
    #    provider config (item 9) so badges + tab placement stay honest.
    ext_cfg = {c.id: c for c in st.settings.get().engines.external}
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
                self_hosted=bool(getattr(ext_cfg.get(eid), "self_hosted", False)),
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


def _on_demand_claim() -> tuple[VramClaim | None, str | None]:
    """Q3's standing "AI model (loads on demand)" line — the ROUTED DEFAULT's
    predicted footprint. The layers that can name a local model: the routing
    default (the store the warm boot gates on) and the per-feature production
    configs (Lab presets carry provider+model). The claim itself comes from
    the kit's `preview_fit` four-arm resolver (P5-5's hand-rolled ladder is
    SUPERSEDED — resident-live → measured → computed → declared). Several
    distinct local models → the largest claim (the honest worst-case
    on-demand load). Everything named is cloud → "cloud-routed"; nothing
    named anywhere → "not-configured" — the strip says which, instead of
    showing a number that will never load."""
    try:
        from llm_runner.llm import stores
        from llm_runner.runner.lifecycle import get_service

        from ..engines.llm.run import jv_llm_config

        local_models: set[str] = set()
        named_any = False
        d = stores.get_routing_store().get_routing().default
        if getattr(d, "llmId", ""):
            named_any = True
            if d.llmId == "local-llamacpp" and getattr(d, "model", ""):
                local_models.add(d.model)
        for cfg in jv_llm_config().production_configs or []:
            pid = getattr(cfg, "providerId", "") or ""
            if not pid:
                continue
            named_any = True
            if pid == "local-llamacpp" and getattr(cfg, "model", ""):
                local_models.add(cfg.model)
        if not local_models:
            return None, "cloud-routed" if named_any else "not-configured"
        svc = get_service()
        best: VramClaim | None = None
        for mid in sorted(local_models):
            try:
                claim = (svc.preview_fit(mid) or {}).get("claim") or {}
            except Exception:  # noqa: BLE001 — one bad row must not kill the strip
                continue
            if not claim:
                continue
            c = VramClaim(
                model=mid,
                vram_mb=int(claim.get("vramMb") or 0),
                ram_mb=int(claim.get("ramMb") or 0),
                source=str(claim.get("source") or "computed"),
                matches=int(claim.get("matches") or 0),
            )
            if best is None or c.vram_mb > best.vram_mb:
                best = c
        return (best, None) if best is not None else (None, "not-configured")
    except Exception:  # noqa: BLE001 — the strip must render even if routing is mid-boot
        return None, "unavailable"


@router.get(
    "/v1/engines/vram",
    response_model=EngineVramResponse,
    summary="The memory budget strip: arbiter snapshot + on-demand claim + eviction events",
)
async def get_engine_vram(events_since: int = 0) -> EngineVramResponse:
    """The 2026-08-13 VRAM wiring (Q3/Q4): ONE endpoint reading the shared
    arbiter — total / committed / remaining for the box's budget pool
    (mem_arch says whether that pool is a card's VRAM or the one shared
    memory pool), each resident booking with its kind + §13.1 provenance,
    the busy kinds, the on-demand LLM claim, and eviction events newer than
    `events_since` (the client toasts them and keeps the last seq)."""
    try:
        from llm_runner.runner.arbiter import get_arbiter

        arb = get_arbiter()
    except Exception:  # noqa: BLE001 — no shared stack in this process
        raise HTTPException(status_code=503, detail="the shared LLM stack is not mounted")
    # The manager's cached hardware snapshot — never re-probe per poll
    # (detect shells out to nvidia-smi).
    mgr = get_manager()
    hw = mgr._hardware()
    snap = arb.snapshot(hw) if hw is not None else arb.snapshot()
    claim, claim_reason = _on_demand_claim()
    # The measured pool state (the 2026-08-13 redesign — the strip shows
    # REALITY, the same number nvidia-smi would print, never ledger
    # arithmetic). TTL-cached inside the manager, so the 4 s poll never
    # spawns a probe subprocess per tick. `other_mb` = measured use the
    # ledger can't attribute (other apps, OS) — shown as its own row.
    used = mgr.pool_used_mb()
    other = max(0, used - snap["committed_mb"]) if used is not None else 0
    return EngineVramResponse(
        mem_arch=snap["mem_arch"],
        total_mb=snap["vram_total_mb"],
        committed_mb=snap["committed_mb"],
        remaining_mb=snap["remaining_mb"],
        used_mb=used,
        other_mb=other,
        reservations=[VramReservation(**r) for r in snap["reservations"]],
        busy_kinds=snap["busy_kinds"],
        claim=claim,
        claim_reason=claim_reason,
        events=[VramEvent(**e) for e in arb.events_since(events_since)],
    )


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
