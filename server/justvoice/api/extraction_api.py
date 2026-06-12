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
import re

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
    # Raw LLM reply text — Speaker Lab's "Raw" tab. None when the call
    # was anchors-only / no dialogue.
    raw_llm: str | None = None


def _resolve_corrections(project_id: str, db: Session, *, limit: int = 12) -> list[dict]:
    """Look up the top-N most-recent SpeakerCorrection rows for the
    project. Phase 5 feedback loop — these inject into the LLM prompt
    via prompts.format_corrections as worked examples.
    """
    from ..database.models import SpeakerCorrection

    rows = (
        db.query(SpeakerCorrection)
        .filter(SpeakerCorrection.project_id == project_id)
        .order_by(SpeakerCorrection.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "text_snippet": r.text_snippet,
            "character_id": r.character_id or "unknown",
        }
        for r in rows
    ]


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
    corrections = body.corrections if body.corrections is not None else _resolve_corrections(scene.project_id, db)

    settings = get_state().settings.get()
    # AI-features redesign: the ACTIVE production config (promoted from
    # Speaker Lab) wins outright — model AND prompts — unless the body
    # explicitly overrides (the Lab itself passes explicit values via the
    # text endpoint, not this scene endpoint).
    from ..engines.llm.dispatch import active_production_config

    cfg = active_production_config(settings, "speaker_attribution")
    req = AnalyzeRequest(
        text=body.text,
        characters=characters,
        corrections=corrections,
        tier=body.tier or (cfg.tier if cfg else None),
        propagate=body.propagate,
        use_floor=body.use_floor,
        model=(cfg.model or None) if cfg else None,
        temperature=cfg.temperature if cfg else None,
        system_prompt=cfg.system_prompt if cfg else None,
    )

    try:
        raw_out: dict = {}
        rows = analyze_scene(settings=settings, request=req, raw_out=raw_out)
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
        raw_llm=raw_out.get("llm_text"),
        rows=[AttributionRowResponse(**row.__dict__) for row in rows],
        tier_used=tier.name,
        confidence_floor=tier.confidence_floor,
    )


class AnalyzeTextRequest(BaseModel):
    """Speaker-Lab body — analyze raw text without a scene id. Caller
    supplies the cast directly + the same tuning flags as the scene-
    scoped endpoint."""

    text: str
    characters: list[dict] = []
    corrections: list[dict] = []
    tier: str | None = None
    propagate: bool = True
    use_floor: bool = True
    # Speaker Lab per-column overrides (None = pin/tier defaults).
    model: str | None = None
    temperature: float | None = None
    system_prompt: str | None = None


@router.post(
    "/v1/extraction/analyze-text",
    response_model=AnalyzeSceneResponse,
    summary="Run speaker attribution on free-form text (Speaker Lab)",
)
async def analyze_text_endpoint(body: AnalyzeTextRequest) -> AnalyzeSceneResponse:
    """No scene id — for the Speaker Lab + ad-hoc analysis. Returns the
    same AnalyzeSceneResponse shape with scene_id="(adhoc)".
    """
    settings = get_state().settings.get()
    req = AnalyzeRequest(
        text=body.text,
        characters=body.characters,
        corrections=body.corrections,
        tier=body.tier,
        propagate=body.propagate,
        use_floor=body.use_floor,
        model=body.model,
        temperature=body.temperature,
        system_prompt=body.system_prompt,
    )
    try:
        raw_out: dict = {}
        rows = analyze_scene(settings=settings, request=req, raw_out=raw_out)
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        log.exception("extraction pipeline failed")
        raise HTTPException(status_code=502, detail=f"extraction failed: {e}")

    from ..engines.llm.dispatch import resolve_tier

    tier = resolve_tier(settings, "speaker_attribution")
    if body.tier and body.tier in {"guided", "direct", "reasoned"}:
        from ..engines.llm.tiers import TIERS

        tier = TIERS[body.tier]

    return AnalyzeSceneResponse(
        scene_id="(adhoc)",
        raw_llm=raw_out.get("llm_text"),
        rows=[AttributionRowResponse(**row.__dict__) for row in rows],
        tier_used=tier.name,
        confidence_floor=tier.confidence_floor,
    )


# ── Speaker-correction management (Phase 5) ──────────────────────────────


class CorrectionsCountResponse(BaseModel):
    project_id: str
    count: int


@router.get(
    "/v1/projects/{project_id}/corrections/count",
    response_model=CorrectionsCountResponse,
)
async def count_corrections(project_id: str, db: Session = Depends(get_db)) -> CorrectionsCountResponse:
    from ..database.models import SpeakerCorrection

    n = db.query(SpeakerCorrection).filter(SpeakerCorrection.project_id == project_id).count()
    return CorrectionsCountResponse(project_id=project_id, count=n)


@router.delete("/v1/projects/{project_id}/corrections")
async def clear_corrections(project_id: str, db: Session = Depends(get_db)) -> dict:
    from ..database.models import SpeakerCorrection

    deleted = (
        db.query(SpeakerCorrection)
        .filter(SpeakerCorrection.project_id == project_id)
        .delete()
    )
    db.commit()
    return {"deleted": deleted}

# ── Speaker identification — discovered-speakers banner (CONCEPTS §3) ──


class DiscoverSpeakersRequest(BaseModel):
    text: str


class SpeakerCandidateOut(BaseModel):
    name: str
    role_hint: str | None = None
    approx_lines: int | None = None


class DiscoverSpeakersResponse(BaseModel):
    scene_id: str
    candidates: list[SpeakerCandidateOut]


@router.post(
    "/v1/scenes/{scene_id}/discover-speakers",
    response_model=DiscoverSpeakersResponse,
    summary="Find speaking characters not yet in the project cast",
)
async def discover_speakers_endpoint(
    scene_id: str,
    body: DiscoverSpeakersRequest,
    db: Session = Depends(get_db),
) -> DiscoverSpeakersResponse:
    """Identification, not attribution: proposes NEW speakers as a review
    list for the Script tab banner. Nothing is created here — promotion
    is POST /v1/projects/{id}/personas/promote."""
    from ..extraction.identify import identify_speakers

    scene = db.query(Scene).filter(Scene.id == scene_id).first()
    if scene is None:
        raise not_found(f"scene {scene_id}")
    known = [c.get("name", "") for c in _resolve_cast(scene_id, db)]
    settings = get_state().settings.get()
    try:
        candidates = identify_speakers(body.text, known, settings=settings)
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        log.exception("speaker identification failed")
        raise HTTPException(status_code=502, detail=f"identification failed: {e}")
    return DiscoverSpeakersResponse(
        scene_id=scene_id,
        candidates=[
            SpeakerCandidateOut(
                name=c.name, role_hint=c.role_hint, approx_lines=c.approx_lines
            )
            for c in candidates
        ],
    )


class PromoteCandidate(BaseModel):
    name: str
    bio: str | None = None


class PromoteSpeakersRequest(BaseModel):
    candidates: list[PromoteCandidate]


class PromoteSpeakersResponse(BaseModel):
    created: list[str]
    reused: list[str]


@router.post(
    "/v1/projects/{project_id}/personas/promote",
    response_model=PromoteSpeakersResponse,
    summary="Promote discovered speakers to personas in this project's cast",
)
async def promote_speakers_endpoint(
    project_id: str,
    body: PromoteSpeakersRequest,
    db: Session = Depends(get_db),
) -> PromoteSpeakersResponse:
    from ..database.models import Project
    from ._persona_helpers import ensure_project_persona

    if db.query(Project).filter(Project.id == project_id).first() is None:
        raise not_found(f"project {project_id}")
    created: list[str] = []
    reused: list[str] = []
    for cand in body.candidates:
        slug = re.sub(r"[^a-z0-9]+", "_", cand.name.lower()).strip("_") or "speaker"
        pid, was_created = ensure_project_persona(
            db,
            project_id,
            name=cand.name,
            bio=cand.bio,
            imported_from="discovered",
            imported_id=slug,
        )
        (created if was_created else reused).append(pid)
    db.commit()
    return PromoteSpeakersResponse(created=created, reused=reused)
