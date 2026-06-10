# SPDX-License-Identifier: GPL-3.0-or-later
"""POST /v1/scenes/{id}/analyze — speaker attribution.

Phase 3 / Slice 1 of the Profile-kill plan. Runs the extraction
pipeline against scene text, returns attribution rows ready for the
Studio Script tab to render. Does NOT auto-persist the result as Block
rows — the user reviews + corrects before clicking "Apply", which
calls POST /v1/scenes/{id}/blocks separately.

When no LLM provider is registered, returns HTTP 501 with the
actionable message from LLMNotConfiguredError.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..app_state import get_state
from ..database import get_db
from ..database.models import Persona, ProjectPersona, Scene
from ..engines.llm.dispatch import LLMNotConfiguredError
from ..errors import not_found
from ..extraction import AnalyzeRequest, analyze_scene

log = logging.getLogger(__name__)

router = APIRouter(tags=["extraction"])


class AttributionRowResponse(BaseModel):
    paragraph_idx: int
    kind: str
    text: str
    speaker: str
    confidence: float
    source: str
    floored_from: str | None = None
    llm_speaker: str | None = None
    llm_confidence: float | None = None


class AnalyzeSceneRequest(BaseModel):
    """Body for POST /v1/scenes/{id}/analyze.

    `text` is the raw scene prose to attribute. `characters` defaults to
    the project's cast (via ProjectPersona) when omitted. `corrections`
    defaults to the most-recent SpeakerCorrection rows for the project
    once Slice 2 lands.
    """

    text: str
    characters: list[dict] | None = None
    corrections: list[dict] | None = None
    tier: str | None = None
    propagate: bool = True
    use_floor: bool = True


class AnalyzeSceneResponse(BaseModel):
    scene_id: str
    rows: list[AttributionRowResponse]
    tier_used: str
    confidence_floor: float


def _resolve_cast(scene_id: str, db: Session) -> list[dict]:
    """Look up the project's cast (via ProjectPersona) for `scene_id`."""
    scene = db.query(Scene).filter(Scene.id == scene_id).first()
    if scene is None:
        return []
    rows = (
        db.query(Persona)
        .join(ProjectPersona, ProjectPersona.persona_id == Persona.id)
        .filter(ProjectPersona.project_id == scene.project_id)
        .all()
    )
    return [
        {
            "id": p.id,
            "name": p.name,
            "bio": p.bio,
            "role": None,
            "gender": None,  # Persona schema doesn't carry these fields
            "pronouns": None,  # today; Phase 4 / Slice 4 (Smart-assign)
            "aliases": [],   # adds them.
        }
        for p in rows
    ]


@router.post(
    "/v1/scenes/{scene_id}/analyze",
    response_model=AnalyzeSceneResponse,
    summary="Run speaker attribution on a scene",
)
async def analyze_scene_endpoint(
    scene_id: str,
    body: AnalyzeSceneRequest,
    db: Session = Depends(get_db),
) -> AnalyzeSceneResponse:
    scene = db.query(Scene).filter(Scene.id == scene_id).first()
    if scene is None:
        raise not_found(f"scene {scene_id}")

    characters = body.characters if body.characters is not None else _resolve_cast(scene_id, db)
    corrections = body.corrections or []

    settings = get_state().settings.get()
    req = AnalyzeRequest(
        text=body.text,
        characters=characters,
        corrections=corrections,
        tier=body.tier,
        propagate=body.propagate,
        use_floor=body.use_floor,
    )

    try:
        rows = analyze_scene(settings=settings, request=req)
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        log.exception("extraction pipeline failed")
        raise HTTPException(status_code=502, detail=f"extraction failed: {e}")

    # Echo back which tier ran so the UI can show "auto-routed to Reasoned"
    # in the Studio Script tab header.
    from ..engines.llm.dispatch import resolve_tier

    tier = resolve_tier(settings, "speaker_attribution")
    if body.tier and body.tier in {"guided", "direct", "reasoned"}:
        from ..engines.llm.tiers import TIERS

        tier = TIERS[body.tier]

    return AnalyzeSceneResponse(
        scene_id=scene_id,
        rows=[AttributionRowResponse(**row.__dict__) for row in rows],
        tier_used=tier.name,
        confidence_floor=tier.confidence_floor,
    )
