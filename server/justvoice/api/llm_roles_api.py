# SPDX-License-Identifier: GPL-3.0-or-later
"""/v1/llm-roles + /v1/production-configs — the AI-features page backend.

Roles themselves persist via PATCH /v1/settings (engines.llm_roles); this
module serves the RECOMMENDATIONS (so the UI never asks "which model is
fast?" cold) and the production-config lifecycle (Speaker Lab promote /
revert). See docs/plans/2026-06-11-engines-ai-features-implementation.md.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter
from pydantic import BaseModel

from ..app_state import get_state
from llm_runner.llm import get_llm_registry
from llm_runner.llm import spec_for
from ..errors import not_found
from ..models import ProductionConfig

router = APIRouter(tags=["llm-roles"])


class RoleCandidate(BaseModel):
    provider_id: str
    model: str
    label: str  # human line for the dropdown
    speed_class: str  # "quick" | "accuracy"
    local: bool


class RoleRecommendations(BaseModel):
    candidates: list[RoleCandidate]
    recommended_quick: RoleCandidate | None
    recommended_accuracy: RoleCandidate | None


def _candidates() -> list[RoleCandidate]:
    """Walk registered adapters + their default models and classify each
    by the tier machinery's size heuristics. Local engines outrank cloud
    in recommendations (free + private)."""
    out: list[RoleCandidate] = []
    for adapter in get_llm_registry().all():
        model = adapter.default_model
        if not model:
            continue
        tier = spec_for(model, None)
        quickish = tier.name in ("guided", "direct")
        local = adapter.provider_type in ("local", "ollama", "openai-compat", "local-llamacpp")
        out.append(
            RoleCandidate(
                provider_id=adapter.provider_id,
                model=model,
                label=f"{model} — {adapter.provider_id}"
                + (" · local" if local else " · metered"),
                speed_class="quick" if quickish else "accuracy",
                local=local,
            )
        )
    return out


@router.get("/v1/llm-roles/recommendations", response_model=RoleRecommendations)
async def role_recommendations() -> RoleRecommendations:
    cands = _candidates()

    def best(speed: str) -> RoleCandidate | None:
        pool = [c for c in cands if c.speed_class == speed]
        # local first (free + private); among locals the built-in llama.cpp
        # runner outranks the lightweight qwen3 fallback, then registry order.
        pool.sort(key=lambda c: (not c.local, c.provider_id != "local-llamacpp"))
        if pool:
            return pool[0]
        # fall back across classes rather than recommending nothing
        return (cands or [None])[0]

    return RoleRecommendations(
        candidates=cands,
        recommended_quick=best("quick"),
        recommended_accuracy=best("accuracy"),
    )


class ProductionConfigList(BaseModel):
    configs: list[ProductionConfig]


@router.get("/v1/production-configs", response_model=ProductionConfigList)
async def list_production_configs() -> ProductionConfigList:
    settings = get_state().settings.get()
    return ProductionConfigList(configs=settings.engines.production_configs)


@router.post("/v1/production-configs", response_model=ProductionConfig, status_code=201)
async def upsert_production_config(body: ProductionConfig) -> ProductionConfig:
    """Speaker Lab 'Use as production' — freezes model + prompts for a
    feature. One active config per feature; posting replaces it."""
    state = get_state()
    settings = state.settings.get()
    body.promoted_at = body.promoted_at or datetime.now(timezone.utc).isoformat()
    settings.engines.production_configs = [
        c for c in settings.engines.production_configs if c.feature != body.feature
    ] + [body]
    state.settings.set(settings)
    return body


@router.delete("/v1/production-configs/{feature}")
async def revert_production_config(feature: str) -> dict:
    """Revert a feature to Default (tier-resolved) — the mock's Revert."""
    state = get_state()
    settings = state.settings.get()
    before = len(settings.engines.production_configs)
    settings.engines.production_configs = [
        c for c in settings.engines.production_configs if c.feature != feature
    ]
    if len(settings.engines.production_configs) == before:
        raise not_found(f"no production config for feature {feature}")
    state.settings.set(settings)
    return {"reverted": True, "feature": feature}
