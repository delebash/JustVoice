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
    lex = get_state().lexicons.create(
        body.name,
        body.entries,
        scope=body.scope,
        description=body.description,
        project_id=body.project_id,
        persona_id=body.persona_id,
    )
    if lex.scope == "project" and lex.project_id:
        _choose_for_book_with_none(lex.project_id, lex.id)
    return lex


def _choose_for_book_with_none(project_id: str, lexicon_id: str) -> None:
    """A book-scoped lexicon made for a book that has none chosen becomes the
    book's lexicon (Overview → Pronunciation lexicon), the way an import's
    does (projects_api._materialize_lexicon). Decided 2026-09-30: until then
    a lexicon made by hand here did nothing until someone found Overview's
    row. A book that already has one keeps it."""
    from ..database import session as db_session
    from ..database.models import Project

    db = db_session.SessionLocal()
    try:
        project = db.get(Project, project_id)
        if project is not None and not project.default_lexicon_id:
            project.default_lexicon_id = lexicon_id
            db.commit()
    finally:
        db.close()


@router.get("/v1/lexicons/{id}", response_model=Lexicon)
async def get_lexicon(id: str) -> Lexicon:
    lex = get_state().lexicons.get(id)
    if not lex:
        raise not_found(f"lexicon {id}")
    return lex


@router.put("/v1/lexicons/{id}", response_model=Lexicon)
async def update_lexicon(id: str, body: CreateLexiconRequest) -> Lexicon:
    lex = get_state().lexicons.update(id, body.entries, name=body.name)
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
