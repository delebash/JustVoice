"""/v1/lexicons CRUD."""

from __future__ import annotations

from fastapi import APIRouter

from ..app_state import get_state
from ..errors import not_found
from ..models import CreateLexiconRequest, Lexicon, LexiconEntry, LexiconList

router = APIRouter(tags=["lexicons"])


@router.get("/v1/lexicons", response_model=LexiconList)
async def list_lexicons() -> LexiconList:
    return LexiconList(lexicons=get_state().lexicons.list())


@router.post("/v1/lexicons", response_model=Lexicon, status_code=201)
async def create_lexicon(body: CreateLexiconRequest) -> Lexicon:
    return get_state().lexicons.create(
        body.name,
        body.entries,
        scope=body.scope,
        description=body.description,
        project_id=body.project_id,
        persona_id=body.persona_id,
    )


@router.get("/v1/lexicons/{id}", response_model=Lexicon)
async def get_lexicon(id: str) -> Lexicon:
    lex = get_state().lexicons.get(id)
    if not lex:
        raise not_found(f"lexicon {id}")
    return lex


@router.put("/v1/lexicons/{id}", response_model=Lexicon)
async def update_lexicon(id: str, body: CreateLexiconRequest) -> Lexicon:
    lex = get_state().lexicons.update(id, body.entries)
    if not lex:
        raise not_found(f"lexicon {id}")
    return lex


@router.delete("/v1/lexicons/{id}")
async def delete_lexicon(id: str) -> dict:
    if not get_state().lexicons.delete(id):
        raise not_found(f"lexicon {id}")
    return {"deleted": True}


@router.post("/v1/lexicons/{id}/entries", response_model=Lexicon)
async def append_entry(id: str, entry: LexiconEntry) -> Lexicon:
    lex = get_state().lexicons.append_entry(id, entry)
    if not lex:
        raise not_found(f"lexicon {id}")
    return lex
