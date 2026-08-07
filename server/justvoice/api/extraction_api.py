# SPDX-License-Identifier: MIT
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
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from llm_runner.llm import LLMNotConfiguredError

from ..app_state import get_state
from ..database import get_db
from ..database.models import Persona, ProjectPersona, Scene
from ..errors import not_found
from ..extraction import AnalyzeRequest, analyze_scene
from ..extraction.pipeline import auto_route

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
    # Per-run route force; None = Auto. Renamed from `tier` in the
    # tier-debris cleanup (2026-08-07); an unknown value 422s loudly.
    route: Literal["guided", "direct"] | None = None
    propagate: bool = True
    use_floor: bool = True


class RunUsage(BaseModel):
    """The run's usage numbers (§16 — every AI response carries them; the
    server always had them, the responses just didn't). 0 = unreported."""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    duration_ms: int = 0
    model: str = ""


class AnalyzeSceneResponse(BaseModel):
    scene_id: str
    rows: list[AttributionRowResponse]
    route_used: str
    # Why that route ran (the restore's no-silent-state rule): "forced"
    # (per-run override) | "auto".
    route_source: str = "auto"
    confidence_floor: float
    # Raw LLM reply text — Speaker Lab's "Raw" tab. None when the call
    # was anchors-only / no dialogue.
    raw_llm: str | None = None
    # None when no LLM call ran (anchors-only / no dialogue).
    usage: RunUsage | None = None


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
    # Route precedence lives in ONE place (pipeline.pick_route): the body's
    # explicit route (a per-run override) > Auto. The pipeline reports the
    # pick that RAN via raw_out — never re-derived here.
    req = AnalyzeRequest(
        text=body.text,
        characters=characters,
        corrections=corrections,
        route=body.route,
        propagate=body.propagate,
        use_floor=body.use_floor,
    )

    try:
        raw_out: dict = {}
        rows = analyze_scene(settings=settings, request=req, raw_out=raw_out)
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        log.exception("extraction pipeline failed")
        raise HTTPException(status_code=502, detail=f"extraction failed: {e}")

    return AnalyzeSceneResponse(
        scene_id=scene_id,
        raw_llm=raw_out.get("llm_text"),
        rows=[AttributionRowResponse(**row.__dict__) for row in rows],
        route_used=raw_out.get("route", "guided"),
        route_source=raw_out.get("route_source", "auto"),
        confidence_floor=raw_out.get("floor", 0.7),
        usage=raw_out.get("usage"),
    )


class AnalyzeTextRequest(BaseModel):
    """Speaker-Lab body — analyze raw text without a scene id. Caller
    supplies the cast directly + the same tuning flags as the scene-
    scoped endpoint.

    Corrections (Part 5, 2026-08-06 — the typed box died: corrections only
    exist by fixing real results): pass `project_id` and the run uses that
    project's STORED corrections through the same resolver production uses;
    an explicit non-empty `corrections` list still wins (API compat)."""

    text: str
    characters: list[dict] = []
    corrections: list[dict] = []
    project_id: str | None = None
    # Per-run route force (a card's Lab run always sends its own); None =
    # Auto. Renamed from `tier` (2026-08-07); an unknown value 422s loudly.
    route: Literal["guided", "direct"] | None = None
    propagate: bool = True
    use_floor: bool = True
    # Lab per-column overrides (None = preset/route defaults). camelCase
    # to match the shared LLM-config contract the renderer sends.
    providerId: str | None = None
    model: str | None = None
    temperature: float | None = None
    systemPrompt: str | None = None
    userPrompt: str | None = None
    confidence_floor: float | None = None
    # The column's remaining tunables (Part 2, 2026-08-06 — the controls are
    # REAL): pass straight through to the shared run path, same as any
    # feature. None/[] = the resolved preset's values.
    think: bool | None = None
    reasoningEffort: str | None = None
    maxTokens: int | None = None
    topP: float | None = None
    samplers: list[dict] = []


@router.post(
    "/v1/extraction/analyze-text",
    response_model=AnalyzeSceneResponse,
    summary="Run speaker attribution on free-form text (Speaker Lab)",
)
async def analyze_text_endpoint(
    body: AnalyzeTextRequest, db: Session = Depends(get_db)
) -> AnalyzeSceneResponse:
    """No scene id — for the Speaker Lab + ad-hoc analysis. Returns the
    same AnalyzeSceneResponse shape with scene_id="(adhoc)".
    """
    corrections = body.corrections
    if not corrections and body.project_id:
        # The open project's stored corrections, exactly like production
        # (Part 5 — same resolver, same top-12, zero drift).
        corrections = _resolve_corrections(body.project_id, db)
    settings = get_state().settings.get()
    req = AnalyzeRequest(
        text=body.text,
        characters=body.characters,
        corrections=corrections,
        route=body.route,
        propagate=body.propagate,
        use_floor=body.use_floor,
        model=body.model,
        temperature=body.temperature,
        system_prompt=body.systemPrompt,
        user_prompt=body.userPrompt,
        confidence_floor=body.confidence_floor,
        provider_id=body.providerId,
        think=body.think,
        reasoning_effort=body.reasoningEffort,
        max_tokens=body.maxTokens,
        top_p=body.topP,
        samplers=body.samplers,
    )
    try:
        raw_out: dict = {}
        rows = analyze_scene(settings=settings, request=req, raw_out=raw_out)
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        log.exception("extraction pipeline failed")
        raise HTTPException(status_code=502, detail=f"extraction failed: {e}")

    return AnalyzeSceneResponse(
        scene_id="(adhoc)",
        raw_llm=raw_out.get("llm_text"),
        rows=[AttributionRowResponse(**row.__dict__) for row in rows],
        route_used=raw_out.get("route", "guided"),
        route_source=raw_out.get("route_source", "auto"),
        confidence_floor=raw_out.get("floor", 0.7),
        usage=raw_out.get("usage"),
    )


# ── Lab config — the truth the Speaker Lab displays ──────────────────────


class ExtractionRouteInfo(BaseModel):
    name: str
    label: str
    confidence_floor: float


class AutoCheckInfo(BaseModel):
    """One line of Auto's shown work: the rule, the model it judged (that
    card's OWN model — no hidden anchor), and whether it passed."""

    route: str
    model: str
    passed: bool
    rule: str


class ExtractionConfigResponse(BaseModel):
    """Everything the attribution Lab + the Auto row need to SHOW what the
    pipeline will actually do: the TWO routes (Guided · Direct — Reasoned
    died in the tier-debris cleanup 2026-08-07), their prompt bodies, the
    user-prompt template, the editable size rule, and Auto's current pick
    with its work (judged against that card's own model — the Lab and
    Studio report it; the Auto pane itself is plain words + the size line,
    per the Auto simplification 2026-08-06). The server is the single
    source of truth — the UI never duplicates prompt text or re-derives
    the pick. Production always runs Auto."""

    routes: list[ExtractionRouteInfo]
    # {"guided": <full body>, "direct": <full body>}
    system_prompts: dict[str, str]
    user_template: str
    # The editable size rule (settings.extraction.direct_min_b).
    direct_min_b: float = 14.0
    # Auto's pick right now + the readout lines that justify it.
    auto_picked: str = "guided"
    auto_checks: list[AutoCheckInfo] = []


@router.get(
    "/v1/extraction/config",
    response_model=ExtractionConfigResponse,
    summary="The two routes + prompt bodies + Auto's pick and its work (the attribution Lab + Auto row)",
)
async def extraction_config() -> ExtractionConfigResponse:
    from llm_runner.llm import stores

    from ..extraction.pipeline import ROUTE_FLOORS, ROUTES

    # Prompt truth = the SHARED template rows (the same rows the run renders).
    _store = stores.get_prompt_store()
    rows = {name: _store.get(f"speaker_attribution.{name}") for name in ROUTES}

    settings = get_state().settings.get()
    picked, checks = auto_route(settings.extraction.direct_min_b)

    return ExtractionConfigResponse(
        routes=[
            ExtractionRouteInfo(
                name=name,
                label=name.capitalize(),
                confidence_floor=ROUTE_FLOORS[name],
            )
            for name in ROUTES
        ],
        system_prompts={name: (r.system if r else "") for name, r in rows.items()},
        user_template=rows["guided"].user_template if rows["guided"] else "",
        direct_min_b=settings.extraction.direct_min_b,
        auto_picked=picked,
        auto_checks=[AutoCheckInfo(**c) for c in checks],
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


def record_correction(db: Session, project_id: str, text_snippet: str, character_id: str) -> None:
    """THE one correction writer (parity batch 2026-08-06): the Studio block-PATCH
    side effect and the Lab's reassign both call this — same row shape, same
    200-per-project cap (oldest dropped), so the two doors can't drift."""
    from ..database.models import SpeakerCorrection

    db.add(SpeakerCorrection(
        project_id=project_id,
        text_snippet=(text_snippet or "")[:400],
        character_id=character_id,
    ))
    # SessionLocal runs autoflush=False — without this flush the overflow query
    # can't see the row just added and the cap drifts one past 200 forever.
    db.flush()
    overflow = (
        db.query(SpeakerCorrection)
        .filter(SpeakerCorrection.project_id == project_id)
        .order_by(SpeakerCorrection.created_at.desc())
        .offset(200)
        .all()
    )
    for row in overflow:
        db.delete(row)


class CorrectionIn(BaseModel):
    text_snippet: str
    character_id: str


@router.post("/v1/projects/{project_id}/corrections")
async def add_correction(
    project_id: str, body: CorrectionIn, db: Session = Depends(get_db)
) -> dict:
    """The Lab's reassign door (parity batch 2026-08-06): a corrected speaker in
    the attribution Lab writes correction memory exactly as Studio's block
    reassign does — record_correction is the shared implementation.
    character_id must be a REAL persona (the FK the table carries) — the Lab's
    typed cast uses synthetic ids, which teach nothing and are refused here."""
    if db.query(Persona).filter(Persona.id == body.character_id).first() is None:
        raise HTTPException(
            status_code=404, detail=f"persona {body.character_id} not found"
        )
    record_correction(db, project_id, body.text_snippet, body.character_id)
    db.commit()
    n = _count_project_corrections(db, project_id)
    return {"ok": True, "count": n}


def _count_project_corrections(db: Session, project_id: str) -> int:
    from ..database.models import SpeakerCorrection

    return db.query(SpeakerCorrection).filter(SpeakerCorrection.project_id == project_id).count()

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
    # The run's usage (§16) — None only if the call never ran.
    usage: RunUsage | None = None


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
        raw_out: dict = {}
        candidates = identify_speakers(body.text, known, settings=settings, raw_out=raw_out)
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
        usage=raw_out.get("usage"),
    )


class DiscoverTextRequest(BaseModel):
    """The attribution Lab's discovery body — the identify twin of
    AnalyzeTextRequest (free-form text, no scene). The camelCase override
    fields are the Lab column's pins, same contract as analyze-text."""

    text: str
    known_characters: list[str] = []
    providerId: str | None = None
    model: str | None = None
    temperature: float | None = None
    systemPrompt: str | None = None
    userPrompt: str | None = None
    # The column's remaining tunables (Part 2, 2026-08-06) — same contract as
    # analyze-text.
    think: bool | None = None
    reasoningEffort: str | None = None
    maxTokens: int | None = None
    topP: float | None = None
    samplers: list[dict] = []


@router.post(
    "/v1/extraction/discover-speakers",
    response_model=DiscoverSpeakersResponse,
    summary="Find speaking characters in free-form text (the attribution Lab)",
)
async def discover_text_endpoint(body: DiscoverTextRequest) -> DiscoverSpeakersResponse:
    """No scene id — the Lab's discovery door (parity batch 2026-08-06),
    beside /v1/extraction/analyze-text. Same identify pipeline as the Script
    banner; candidates are a review list, nothing is created."""
    from ..extraction.identify import identify_speakers

    overrides = {
        "providerId": body.providerId,
        "model": body.model,
        "temperature": body.temperature,
        "system": body.systemPrompt,
        "userTemplate": body.userPrompt,
        "think": body.think,
        "reasoningEffort": body.reasoningEffort,
        "maxTokens": body.maxTokens,
        "topP": body.topP,
        "samplers": body.samplers or None,
    }
    overrides = {k: v for k, v in overrides.items() if v is not None}

    def run_fn(action: str, variables: dict):
        from ..engines.llm.run import run_feature

        return run_feature(action, variables, **overrides)

    settings = get_state().settings.get()
    try:
        raw_out: dict = {}
        candidates = identify_speakers(
            body.text, body.known_characters, settings=settings, run_fn=run_fn,
            raw_out=raw_out,
        )
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        log.exception("speaker identification failed")
        raise HTTPException(status_code=502, detail=f"identification failed: {e}")
    return DiscoverSpeakersResponse(
        scene_id="(adhoc)",
        candidates=[
            SpeakerCandidateOut(
                name=c.name, role_hint=c.role_hint, approx_lines=c.approx_lines
            )
            for c in candidates
        ],
        usage=raw_out.get("usage"),
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
