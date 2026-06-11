# SPDX-License-Identifier: GPL-3.0-or-later
"""/v1/feature-pins — wire LLM features to specific provider+model+tier.

Phase 2 / Slice 7 of the Profile-kill plan. Each feature key
(compose / persona_rewrite / speaker_attribution / render_preset_suggest /
smart_assign) can be pinned independently. Compose + Rewrite endpoints
read these pins via dispatch.resolve_pin to route to the user's chosen
provider; unset features fall back to the first registered LLM.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..app_state import get_state
from ..engines.llm.registry import get_llm_registry
from ..errors import not_found
from ..models import FeaturePinConfig

log = logging.getLogger(__name__)

router = APIRouter(tags=["llm"])


# Catalog of features the dispatch knows about. The Settings AI Features
# panel renders one row per entry. Add a key here when a new LLM feature
# lands; the runtime accepts any string but unknown ones won't surface in
# the UI without an entry.
FEATURE_CATALOG = [
    {
        "key": "compose",
        "label": "Compose",
        "description": "LLM writes a fresh in-character line from a persona's personality prompt. Drives the Generate view's 🎲 Compose button.",
        "recommended_tier": "direct",
    },
    {
        "key": "persona_rewrite",
        "label": "Persona rewrite",
        "description": "Rewrites the current text in the persona's character voice for preview-then-accept. Drives the Generate view's ✏️ Rewrite button.",
        "recommended_tier": "direct",
    },
    {
        "key": "speaker_attribution",
        "label": "Speaker attribution",
        "description": "Extracts who-said-what from prose. Drives the Studio Script tab Analyze action (Phase 3).",
        "recommended_tier": "reasoned",
    },
    {
        "key": "render_preset_suggest",
        "label": "Render preset suggest",
        "description": "Classifies chapter tone and picks the matching render preset. Drives the Studio Render tab Suggest button (Phase 6).",
        "recommended_tier": "direct",
    },
    {
        "key": "show_notes",
        "label": "Show notes",
        "description": "Drafts episode show notes (summary, chapter list with speakers) from the project's segments. Drives the podcast Export surface.",
        "recommended_tier": "direct",
    },
    {
        "key": "smart_assign",
        "label": "Smart-assign",
        "description": "Matches characters to voices based on age/gender/tone/accent. Drives the Studio Cast tab Smart-assign button (Phase 4).",
        "recommended_tier": "direct",
    },
]


class FeatureCatalogEntry(BaseModel):
    key: str
    label: str
    description: str
    recommended_tier: str


class FeaturePinResponse(BaseModel):
    feature: str
    provider_id: str
    model: str = ""
    tier: str | None = None


class FeaturePinListResponse(BaseModel):
    pins: list[FeaturePinResponse]
    catalog: list[FeatureCatalogEntry]


class UpsertFeaturePinRequest(BaseModel):
    feature: str = Field(..., min_length=1, max_length=80)
    provider_id: str = Field(..., min_length=1, max_length=80)
    model: str = ""
    tier: str | None = None


@router.get("/v1/feature-pins", response_model=FeaturePinListResponse)
async def list_feature_pins() -> FeaturePinListResponse:
    settings = get_state().settings.get()
    pins = [
        FeaturePinResponse(
            feature=p.feature,
            provider_id=p.provider_id,
            model=p.model,
            tier=p.tier,
        )
        for p in settings.engines.feature_pins
    ]
    catalog = [FeatureCatalogEntry(**e) for e in FEATURE_CATALOG]
    return FeaturePinListResponse(pins=pins, catalog=catalog)


@router.put("/v1/feature-pins", response_model=FeaturePinResponse)
async def upsert_feature_pin(body: UpsertFeaturePinRequest) -> FeaturePinResponse:
    """Set (or update) the pin for `body.feature`. Idempotent — repeated
    PUTs with the same feature key overwrite the prior pin."""
    if get_llm_registry().get(body.provider_id) is None:
        raise not_found(
            f"LLM provider {body.provider_id!r} is not registered. Add it "
            f"in EnginesView's LLM tab first."
        )
    state = get_state()
    settings = state.settings.get()
    # Replace any existing pin for this feature.
    settings.engines.feature_pins = [
        p for p in settings.engines.feature_pins if p.feature != body.feature
    ]
    pin = FeaturePinConfig(
        feature=body.feature,
        provider_id=body.provider_id,
        model=body.model,
        tier=body.tier,
    )
    settings.engines.feature_pins.append(pin)
    state.settings.set(settings)
    return FeaturePinResponse(
        feature=pin.feature,
        provider_id=pin.provider_id,
        model=pin.model,
        tier=pin.tier,
    )


@router.delete("/v1/feature-pins/{feature}")
async def delete_feature_pin(feature: str) -> dict:
    state = get_state()
    settings = state.settings.get()
    before = len(settings.engines.feature_pins)
    settings.engines.feature_pins = [
        p for p in settings.engines.feature_pins if p.feature != feature
    ]
    if len(settings.engines.feature_pins) == before:
        raise not_found(f"feature pin {feature}")
    state.settings.set(settings)
    return {"deleted": True}
