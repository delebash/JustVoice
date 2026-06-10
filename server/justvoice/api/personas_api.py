"""/v1/personas CRUD + cross-project usage."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..app_state import get_state
from ..database import get_db
from ..database.models import Project, ProjectPersona
from ..errors import not_found
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

    Currently STUBBED — JustVoice does not yet have an LLM service wired.
    The provider registry + dispatch lands in Phase 2 of the plan. Until
    then this returns a 501 with a useful diagnostic message.
    """
    from fastapi import HTTPException

    _require_persona_with_personality(id)
    raise HTTPException(
        status_code=501,
        detail=(
            "LLM service not configured. Wire an LLM provider in Settings → "
            "AI Engines to enable the Compose action. The provider registry "
            "lands in Phase 2 of the Profile-kill plan."
        ),
    )


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

    Currently STUBBED — see /compose above. Lands when Phase 2's LLM
    provider registry ships.
    """
    from fastapi import HTTPException

    _require_persona_with_personality(id)
    raise HTTPException(
        status_code=501,
        detail=(
            "LLM service not configured. Wire an LLM provider in Settings → "
            "AI Engines to enable the Rewrite action. The provider registry "
            "lands in Phase 2 of the Profile-kill plan."
        ),
    )
