"""/v1/personas CRUD."""

from __future__ import annotations

from fastapi import APIRouter

from ..app_state import get_state
from ..errors import not_found
from ..models import CreatePersonaRequest, Persona, PersonaList

router = APIRouter(tags=["personas"])


@router.get("/v1/personas", response_model=PersonaList)
async def list_personas() -> PersonaList:
    return PersonaList(personas=get_state().personas.list())


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
    )
    if not p:
        raise not_found(f"persona {id}")
    return p


@router.delete("/v1/personas/{id}")
async def delete_persona(id: str) -> dict:
    if not get_state().personas.delete(id):
        raise not_found(f"persona {id}")
    return {"deleted": True}
