"""/v1/personas CRUD + cross-project usage."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..app_state import get_state
from ..database import get_db
from ..database.models import Project, ProjectPersona
from ..errors import bad_request, not_found
from ..models import CreatePersonaRequest, Persona, PersonaList

router = APIRouter(tags=["personas"])


@router.get("/v1/personas", response_model=PersonaList)
async def list_personas() -> PersonaList:
    return PersonaList(personas=get_state().personas.list())


class PersonaProjectUsage(BaseModel):
    project_id: str
    project_name: str


class PersonaUsageMap(BaseModel):
    usage: dict[str, list[PersonaProjectUsage]]


@router.get("/v1/personas/usage", response_model=PersonaUsageMap)
async def persona_usage(db: Session = Depends(get_db)) -> PersonaUsageMap:
    """Return {persona_id: [{project_id, project_name}, ...]} for every
    persona referenced via ProjectPersona. Drives the Personas tab's
    library-mode "Used in N projects" badges + filter chips."""
    rows = (
        db.query(ProjectPersona.persona_id, Project.id, Project.name)
        .join(Project, Project.id == ProjectPersona.project_id)
        .all()
    )
    usage: dict[str, list[PersonaProjectUsage]] = {}
    for persona_id, project_id, project_name in rows:
        usage.setdefault(persona_id, []).append(
            PersonaProjectUsage(project_id=project_id, project_name=project_name)
        )
    return PersonaUsageMap(usage=usage)


# ── Cross-project NPC detail (Phase 7 / Slice 1) ─────────────────────────


class PersonaUsageProjectDetail(BaseModel):
    project_id: str
    project_name: str
    project_type: str
    scene_count: int  # scenes in the project that have at least one block for this persona
    line_count: int   # total blocks attributed to this persona across the project


class PersonaUsageDetailResponse(BaseModel):
    persona_id: str
    projects: list[PersonaUsageProjectDetail]
    total_lines: int


@router.get(
    "/v1/personas/{persona_id}/usage-detail",
    response_model=PersonaUsageDetailResponse,
)
async def persona_usage_detail(
    persona_id: str, db: Session = Depends(get_db)
) -> PersonaUsageDetailResponse:
    """Per-project line counts for one persona — drives the cross-project
    detail panel in PersonasView (Phase 7 / Slice 1, plan task #76)."""
    from ..database.models import Block, Scene

    persona_exists = (
        get_state().personas.get(persona_id) is not None
        or db.query(ProjectPersona).filter(ProjectPersona.persona_id == persona_id).first() is not None
    )
    if not persona_exists:
        raise not_found(f"persona {persona_id}")

    # Aggregate by project — count blocks attributed to this persona,
    # plus how many distinct scenes those blocks live in.
    rows = (
        db.query(
            Project.id,
            Project.name,
            Project.project_type,
            Scene.id.label("scene_id"),
            Block.id.label("block_id"),
        )
        .join(Scene, Scene.project_id == Project.id)
        .join(Block, Block.scene_id == Scene.id)
        .filter(Block.persona_id == persona_id)
        .all()
    )

    by_project: dict[str, dict] = {}
    for pid, pname, ptype, scene_id, _block_id in rows:
        entry = by_project.setdefault(
            pid,
            {
                "project_id": pid,
                "project_name": pname,
                "project_type": ptype,
                "scene_ids": set(),
                "line_count": 0,
            },
        )
        entry["scene_ids"].add(scene_id)
        entry["line_count"] += 1

    projects = [
        PersonaUsageProjectDetail(
            project_id=e["project_id"],
            project_name=e["project_name"],
            project_type=e["project_type"],
            scene_count=len(e["scene_ids"]),
            line_count=e["line_count"],
        )
        for e in by_project.values()
    ]
    projects.sort(key=lambda p: p.line_count, reverse=True)

    return PersonaUsageDetailResponse(
        persona_id=persona_id,
        projects=projects,
        total_lines=sum(p.line_count for p in projects),
    )


@router.post("/v1/personas", response_model=Persona, status_code=201)
async def create_persona(body: CreatePersonaRequest) -> Persona:
    return get_state().personas.create(
        body.name,
        body.voice_id,
        body.default_delivery,
        bio=body.bio,
        engine_override=body.engine_override,
        lexicon_id=body.lexicon_id,
        llm_rewrite_enabled=body.llm_rewrite_enabled,
        llm_model=body.llm_model,
        language=body.language,
        avatar_path=body.avatar_path,
        personality=body.personality,
        effects_chain=body.effects_chain,
    )


@router.get("/v1/personas/{id}", response_model=Persona)
async def get_persona(id: str) -> Persona:
    p = get_state().personas.get(id)
    if not p:
        raise not_found(f"persona {id}")
    return p


@router.put("/v1/personas/{id}", response_model=Persona)
async def update_persona(id: str, body: CreatePersonaRequest) -> Persona:
    p = get_state().personas.update(
        id,
        name=body.name,
        voice_id=body.voice_id,
        default_delivery=body.default_delivery,
        bio=body.bio,
        engine_override=body.engine_override,
        lexicon_id=body.lexicon_id,
        llm_rewrite_enabled=body.llm_rewrite_enabled,
        llm_model=body.llm_model,
        language=body.language,
        avatar_path=body.avatar_path,
        personality=body.personality,
        effects_chain=body.effects_chain,
    )
    if not p:
        raise not_found(f"persona {id}")
    return p


@router.delete("/v1/personas/{id}")
async def delete_persona(id: str) -> dict:
    persona = get_state().personas.get(id)
    if persona is None:
        raise not_found(f"persona {id}")
    if persona.is_builtin:
        # Soft sentinel — auto-created by the project lifecycle (Narrator
        # on audiobook + podcast). Rename and voice reassignment still
        # work via PUT; only the row itself is protected.
        raise bad_request(
            f"persona {id} is built-in (auto-created by its project) — it can be "
            f"renamed or reassigned, but not deleted."
        )
    if not get_state().personas.delete(id):
        raise not_found(f"persona {id}")
    return {"deleted": True}


class ComposeResponse(BaseModel):
    text: str
    persona_id: str
    note: str | None = None  # diagnostic note if compose was stubbed


class RewriteRequest(BaseModel):
    text: str


class RewriteResponse(BaseModel):
    original: str
    rewritten: str
    persona_id: str
    note: str | None = None


def _require_persona_with_personality(persona_id: str):
    """Shared guard for /compose + /rewrite — both need a persona with a
    non-empty personality field. Raises 404 / 400 as appropriate."""
    from fastapi import HTTPException

    persona = get_state().personas.get(persona_id)
    if not persona:
        raise not_found(f"persona {persona_id}")
    if not (persona.personality and persona.personality.strip()):
        raise HTTPException(
            status_code=400,
            detail=(
                f"persona {persona_id} has no personality prompt — set one "
                "to enable Compose / Rewrite."
            ),
        )
    return persona


@router.post(
    "/v1/personas/{id}/compose",
    response_model=ComposeResponse,
    summary="Generate a fresh in-character line via LLM",
)
async def compose_with_personality(id: str) -> ComposeResponse:
    """LLM-fills a line of dialogue in the persona's personality voice.

    Drives the Compose button in the Generate view's floating bar.
    Phase 2 / Slice 7 — wired to the LLM provider registry. Looks up
    settings.engines.feature_pins.compose to route the call; falls
    back to the first registered LLM if no pin set.
    """
    from fastapi import HTTPException

    from llm_runner.llm import LLMNotConfiguredError

    from ..engines.llm.run import run_feature

    persona = _require_persona_with_personality(id)
    # The template row owns the wording ({{personality}} in the system half);
    # the old hardcoded temperature=0.9 + max_tokens=300 live on its preset
    # (p_compose — ruling 9).
    try:
        resp = run_feature("compose", {"personality": persona.personality.strip()})
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM call failed: {e}")
    return ComposeResponse(text=resp.text.strip(), persona_id=id, note=None)


@router.post(
    "/v1/personas/{id}/rewrite",
    response_model=RewriteResponse,
    summary="Rewrite the supplied text in the persona's character voice (preview-then-accept)",
)
async def rewrite_in_character(id: str, body: RewriteRequest) -> RewriteResponse:
    """Take the user's text + persona.personality, return a rewritten
    in-character version for preview. The user accepts (text replaces
    the textarea) or rejects (original preserved) before sending to TTS.

    NEVER an automatic render-time hook — see plan Q3. Always explicit.
    Phase 2 / Slice 7 — wired to the LLM provider registry. Routes via
    settings.engines.feature_pins.persona_rewrite.
    """
    from fastapi import HTTPException

    from llm_runner.llm import LLMNotConfiguredError

    from ..engines.llm.run import run_feature

    persona = _require_persona_with_personality(id)
    if not body.text.strip():
        raise HTTPException(
            status_code=400,
            detail="rewrite requires non-empty text",
        )

    # The template row owns the wording ({{personality}} system + {{text}}
    # user); temperature lives on p_voiced_edit; the length-scaled token
    # budget stays a code-computed per-call value.
    try:
        resp = run_feature(
            "persona_rewrite",
            {"personality": persona.personality.strip(), "text": body.text},
            maxTokens=max(300, len(body.text) // 2 + 200),
        )
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM call failed: {e}")
    return RewriteResponse(
        original=body.text,
        rewritten=resp.text.strip(),
        persona_id=id,
        note=None,
    )
