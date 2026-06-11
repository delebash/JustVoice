# SPDX-License-Identifier: GPL-3.0-or-later
"""/v1/llm-providers — CRUD against settings.engines.llm[].

Phase 2 / Slice 3 of the Profile-kill plan. Drives the LLM tab in
EnginesView: list / add / edit / delete / ping registered LLM providers.
Persists to settings.json via SettingsStore, then re-registers the
in-memory adapter so the change takes effect immediately (no restart).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..app_state import get_state
from ..engines.llm.registry import construct, get_llm_registry
from ..errors import bad_request, not_found
from ..models import LLMProviderConfig

log = logging.getLogger(__name__)

router = APIRouter(tags=["llm"])


PROVIDER_TYPES = [
    "anthropic",
    "openai",
    "openai-compat",
    "gemini",
    "ollama",
    "deepseek",
    "openrouter",
]


class LLMProviderResponse(BaseModel):
    id: str
    name: str
    provider_type: str
    base_url: str = ""
    default_model: str = ""
    has_api_key: bool
    registered: bool  # True if the adapter is live in the registry
    timeout_seconds: int = 60


class LLMProviderList(BaseModel):
    providers: list[LLMProviderResponse]
    provider_types: list[str] = PROVIDER_TYPES


class UpsertLLMProviderRequest(BaseModel):
    id: str = Field(..., min_length=1, max_length=80)
    name: str = Field(..., min_length=1, max_length=120)
    provider_type: str
    base_url: str = ""
    # `api_key` is write-only — list responses never echo it. PATCH with
    # an empty string means "leave the existing key in place"; PATCH with
    # null means "clear the key".
    api_key: str | None = None
    default_model: str = ""
    timeout_seconds: int = 60


def _to_response(cfg: LLMProviderConfig, registered: bool) -> LLMProviderResponse:
    return LLMProviderResponse(
        id=cfg.id,
        name=cfg.name,
        provider_type=cfg.provider_type,
        base_url=cfg.base_url,
        default_model=cfg.default_model,
        has_api_key=bool(cfg.api_key),
        registered=registered,
        timeout_seconds=cfg.timeout_seconds,
    )


@router.get("/v1/llm-providers", response_model=LLMProviderList)
async def list_llm_providers() -> LLMProviderList:
    settings = get_state().settings.get()
    reg = get_llm_registry()
    registered_ids = set(reg.ids())
    out = [
        _to_response(cfg, cfg.id in registered_ids)
        for cfg in settings.engines.llm
    ]
    return LLMProviderList(providers=out)


@router.post("/v1/llm-providers", response_model=LLMProviderResponse, status_code=201)
async def create_llm_provider(body: UpsertLLMProviderRequest) -> LLMProviderResponse:
    if body.provider_type not in PROVIDER_TYPES:
        raise bad_request(
            f"unknown provider_type {body.provider_type!r}. "
            f"Allowed: {', '.join(PROVIDER_TYPES)}"
        )

    state = get_state()
    settings = state.settings.get()
    if any(p.id == body.id for p in settings.engines.llm):
        raise bad_request(f"LLM provider id {body.id!r} already exists")

    cfg = LLMProviderConfig(
        id=body.id,
        name=body.name,
        provider_type=body.provider_type,
        base_url=body.base_url,
        api_key=body.api_key or None,
        default_model=body.default_model,
        timeout_seconds=body.timeout_seconds,
    )
    settings.engines.llm.append(cfg)
    state.settings.set(settings)

    registered = False
    try:
        adapter = construct(cfg)
        get_llm_registry().register(adapter)
        registered = True
    except Exception as e:
        log.warning("LLM provider %s persisted but not registered: %s", cfg.id, e)

    return _to_response(cfg, registered)


@router.patch("/v1/llm-providers/{provider_id}", response_model=LLMProviderResponse)
async def update_llm_provider(
    provider_id: str, body: UpsertLLMProviderRequest
) -> LLMProviderResponse:
    if body.provider_type not in PROVIDER_TYPES:
        raise bad_request(
            f"unknown provider_type {body.provider_type!r}. "
            f"Allowed: {', '.join(PROVIDER_TYPES)}"
        )
    state = get_state()
    settings = state.settings.get()
    idx = next(
        (i for i, p in enumerate(settings.engines.llm) if p.id == provider_id),
        None,
    )
    if idx is None:
        raise not_found(f"LLM provider {provider_id}")
    existing = settings.engines.llm[idx]
    # api_key: empty string preserves the prior key (write-only field); None clears it.
    api_key = existing.api_key if body.api_key == "" else body.api_key
    cfg = LLMProviderConfig(
        id=existing.id,  # id is immutable; reassigning would orphan feature pins
        name=body.name,
        provider_type=body.provider_type,
        base_url=body.base_url,
        api_key=api_key,
        default_model=body.default_model,
        timeout_seconds=body.timeout_seconds,
    )
    settings.engines.llm[idx] = cfg
    state.settings.set(settings)

    # Re-register so the live adapter reflects the new config.
    reg = get_llm_registry()
    reg.deregister(cfg.id)
    registered = False
    try:
        reg.register(construct(cfg))
        registered = True
    except Exception as e:
        log.warning("LLM provider %s patched but not re-registered: %s", cfg.id, e)

    return _to_response(cfg, registered)


@router.delete("/v1/llm-providers/{provider_id}")
async def delete_llm_provider(provider_id: str) -> dict:
    state = get_state()
    settings = state.settings.get()
    idx = next(
        (i for i, p in enumerate(settings.engines.llm) if p.id == provider_id),
        None,
    )
    if idx is None:
        raise not_found(f"LLM provider {provider_id}")
    del settings.engines.llm[idx]
    state.settings.set(settings)
    get_llm_registry().deregister(provider_id)
    return {"deleted": True}


@router.post("/v1/llm-providers/{provider_id}/ping")
async def ping_llm_provider(provider_id: str) -> dict:
    adapter = get_llm_registry().get(provider_id)
    if adapter is None:
        raise not_found(f"LLM provider {provider_id} (not registered)")
    try:
        ok = adapter.ping()
    except Exception as e:
        return {"ok": False, "error": str(e)}
    return {"ok": ok}


@router.get("/v1/llm-providers/{provider_id}/models", response_model=dict)
async def list_provider_models(provider_id: str) -> dict:
    adapter = get_llm_registry().get(provider_id)
    if adapter is None:
        raise not_found(f"LLM provider {provider_id} (not registered)")
    try:
        return {"models": adapter.models()}
    except Exception as e:
        log.warning("LLM provider %s models() failed: %s", provider_id, e)
        return {"models": [], "error": str(e)}


class TierClassifyRequest(BaseModel):
    model: str


class TierClassifyResponse(BaseModel):
    model: str
    tier: str
    system_key: str
    think: bool
    confidence_floor: float


@router.post("/v1/llm-providers/classify-tier", response_model=TierClassifyResponse)
async def classify_model_tier(body: TierClassifyRequest) -> TierClassifyResponse:
    """Auto-classify a model id into a tier (Phase 2 / Slice 6).

    Settings AI Features + Speaker Lab call this to show "this model
    auto-routes to Reasoned tier" hints before the user pins a feature.
    """
    from ..engines.llm.tiers import classify, TIERS

    tier_name = classify(body.model)
    spec = TIERS[tier_name]
    return TierClassifyResponse(
        model=body.model,
        tier=spec.name,
        system_key=spec.system_key,
        think=spec.think,
        confidence_floor=spec.confidence_floor,
    )

# ── Local-server detection (QuickSetup "Ollama detected → Connect") ─────


class DetectedLocalProvider(BaseModel):
    provider_type: str          # "ollama" | "openai_compat"
    name: str
    base_url: str
    models: list[str]
    already_registered: bool


class DetectLocalResponse(BaseModel):
    detected: list[DetectedLocalProvider]


@router.get("/v1/llm-providers/detect-local", response_model=DetectLocalResponse)
async def detect_local_llm_providers() -> DetectLocalResponse:
    """Probe the well-known local LLM servers (Ollama :11434, LM Studio
    :1234). Powers the first-run "Ollama detected · <model> → Connect"
    row — detect-and-connect, never bundle (CONCEPTS §10)."""
    import httpx

    state = get_state()
    registered_urls = {
        (p.base_url or "").rstrip("/") for p in state.settings.get().engines.llm
    }
    out: list[DetectedLocalProvider] = []

    probes = [
        ("ollama", "Ollama (local)", "http://127.0.0.1:11434", "/api/tags",
         lambda d: [m.get("name", "") for m in d.get("models", [])]),
        ("openai_compat", "LM Studio (local)", "http://127.0.0.1:1234", "/v1/models",
         lambda d: [m.get("id", "") for m in d.get("data", [])]),
    ]
    for ptype, name, base, path, extract in probes:
        try:
            r = httpx.get(base + path, timeout=1.5)
            if r.status_code != 200:
                continue
            models = [m for m in extract(r.json()) if m]
            out.append(
                DetectedLocalProvider(
                    provider_type=ptype,
                    name=name,
                    base_url=base,
                    models=models,
                    already_registered=base in registered_urls,
                )
            )
        except Exception:
            continue
    return DetectLocalResponse(detected=out)

@router.get("/v1/ai-usage")
async def ai_usage() -> dict:
    """Token + duration ledger per feature (Settings → AI usage)."""
    from ..engines.llm.usage import get_ledger

    return get_ledger().snapshot()


@router.delete("/v1/ai-usage")
async def clear_ai_usage() -> dict:
    from ..engines.llm.usage import get_ledger

    get_ledger().clear()
    return {"cleared": True}

