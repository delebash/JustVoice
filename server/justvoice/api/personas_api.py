"""/v1/personas CRUD + where each persona is used.

A persona is a finished spoken voice in the library (2026-09-29): it plays
speakers — the people in a book — and one persona can play many. So "used"
means the speakers it plays, in which books."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..app_state import get_state
from ..database import get_db
from ..database.models import Project, Speaker
from ..errors import bad_request, conflict, not_found
from ..models import CreatePersonaRequest, Persona, PersonaList
from .extraction_api import RunUsage

router = APIRouter(tags=["personas"])


@router.get("/v1/personas", response_model=PersonaList)
async def list_personas() -> PersonaList:
    return PersonaList(personas=get_state().personas.list())


class PersonaSpeakerUsage(BaseModel):
    """One speaker this persona plays."""

    project_id: str
    project_name: str
    speaker_id: str
    speaker_name: str
    lines: int = 0


class PersonaUsageMap(BaseModel):
    usage: dict[str, list[PersonaSpeakerUsage]]


def _usage(db: Session, persona_id: str | None = None) -> dict[str, list[PersonaSpeakerUsage]]:
    from ._speaker_helpers import speaker_line_counts

    q = (
        db.query(Speaker.persona_id, Speaker.id, Speaker.name, Project.id, Project.name)
        .join(Project, Project.id == Speaker.project_id)
        .filter(Speaker.persona_id.isnot(None))
    )
    if persona_id is not None:
        q = q.filter(Speaker.persona_id == persona_id)
    rows = q.all()
    counts: dict[str, dict[str, int]] = {}
    usage: dict[str, list[PersonaSpeakerUsage]] = {}
    for pid, sid, sname, project_id, project_name in rows:
        if project_id not in counts:
            counts[project_id] = speaker_line_counts(db, project_id)
        usage.setdefault(pid, []).append(PersonaSpeakerUsage(
            project_id=project_id, project_name=project_name,
            speaker_id=sid, speaker_name=sname, lines=counts[project_id].get(sid, 0),
        ))
    for entries in usage.values():
        entries.sort(key=lambda u: (u.project_name.lower(), u.speaker_name.lower()))
    return usage


@router.get("/v1/personas/usage", response_model=PersonaUsageMap)
async def persona_usage(db: Session = Depends(get_db)) -> PersonaUsageMap:
    """{persona_id: [the speakers it plays, with their book]} — the Personas
    page's "Used by" column and filters."""
    return PersonaUsageMap(usage=_usage(db))


class PersonaUsageDetailResponse(BaseModel):
    persona_id: str
    speakers: list[PersonaSpeakerUsage]
    total_lines: int


@router.get(
    "/v1/personas/{persona_id}/usage-detail",
    response_model=PersonaUsageDetailResponse,
)
async def persona_usage_detail(
    persona_id: str, db: Session = Depends(get_db)
) -> PersonaUsageDetailResponse:
    """The speakers one persona plays, each with its book and lines — the
    persona editor's "Used by" panel."""
    if get_state().personas.get(persona_id) is None:
        raise not_found(f"persona {persona_id}")
    speakers = _usage(db, persona_id).get(persona_id, [])
    speakers.sort(key=lambda u: -u.lines)
    return PersonaUsageDetailResponse(
        persona_id=persona_id,
        speakers=speakers,
        total_lines=sum(u.lines for u in speakers),
    )


def _persona_name(name: str | None, *, besides: str | None = None) -> str:
    """The name a persona may have, or a refusal (decided 2026-09-29): a persona
    must have a name, and names are unique across the library — case and extra
    spaces don't count. A persona is a voice in the library, so its name is the
    library's; a person's per-book name lives on the speaker. The exact-name
    auto-cast (`_speaker_helpers.persona_named`) depends on it."""
    from ._speaker_helpers import same_name

    clean = " ".join((name or "").split())
    if not clean:
        raise bad_request("A persona needs a name.")
    want = same_name(clean)
    for p in get_state().personas.list():
        if p.id != besides and same_name(p.name) == want:
            raise conflict(
                f'A persona called "{p.name}" already exists. Persona names are unique — '
                "rename one of them first."
            )
    return clean


@router.post("/v1/personas", response_model=Persona, status_code=201)
async def create_persona(body: CreatePersonaRequest) -> Persona:
    return get_state().personas.create(
        _persona_name(body.name),
        body.voice_id,
        body.default_delivery,
        voice_instruct=body.voice_instruct,
        engine_override=body.engine_override,
        lexicon_id=body.lexicon_id,
        llm_rewrite_enabled=body.llm_rewrite_enabled,
        llm_model=body.llm_model,
        language=body.language,
        avatar_path=body.avatar_path,
        note=body.note,
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
    if get_state().personas.get(id) is None:
        raise not_found(f"persona {id}")
    p = get_state().personas.update(
        id,
        name=_persona_name(body.name, besides=id),
        voice_id=body.voice_id,
        default_delivery=body.default_delivery,
        voice_instruct=body.voice_instruct,
        engine_override=body.engine_override,
        lexicon_id=body.lexicon_id,
        llm_rewrite_enabled=body.llm_rewrite_enabled,
        llm_model=body.llm_model,
        language=body.language,
        avatar_path=body.avatar_path,
        note=body.note,
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
    # Every persona deletes the same way (2026-09-29: no built-in personas).
    # The speakers it played lose their persona (SET NULL) and keep their
    # lines — the render stops on them until Cast gives them another.
    if not get_state().personas.delete(id):
        raise not_found(f"persona {id}")
    return {"deleted": True}


class ComposeResponse(BaseModel):
    text: str
    persona_id: str
    note: str | None = None  # diagnostic note if compose was stubbed
    # §16: every AI response carries the run's usage (found violated 2026-08-08
    # by the AI-call-convention pass — the counts were in `resp` and dropped).
    usage: RunUsage | None = None


class RewriteRequest(BaseModel):
    text: str


class RewriteResponse(BaseModel):
    original: str
    rewritten: str
    persona_id: str
    note: str | None = None
    usage: RunUsage | None = None  # §16, same as ComposeResponse


def _require_persona_with_note(persona_id: str):
    """Shared guard for /compose + /rewrite — both need a persona with a
    note on how it sounds (Generate has no book, so no speaker's "Who they
    are" to read). Raises 404 / 400 as appropriate."""
    from fastapi import HTTPException

    persona = get_state().personas.get(persona_id)
    if not persona:
        raise not_found(f"persona {persona_id}")
    if not (persona.note and persona.note.strip()):
        raise HTTPException(
            status_code=400,
            detail=(
                f"{persona.name} has no note on how it sounds — write one on the "
                "Personas page to use Compose / Rewrite."
            ),
        )
    return persona


@router.post(
    "/v1/personas/{id}/compose",
    response_model=ComposeResponse,
    summary="Generate a fresh in-character line via LLM",
)
async def compose_with_note(id: str) -> ComposeResponse:
    """LLM-fills a line of dialogue in the persona's voice (its note).

    Drives the Compose button in the Generate view's floating bar.
    Runs through the shared run path — the `compose` template row + its
    engine preset (F1 Phase 2; the pin-era routing died).
    """
    from fastapi import HTTPException

    from llm_runner.llm import LLMNotConfiguredError

    from ..engines.llm.run import run_feature

    persona = _require_persona_with_note(id)
    # The template row owns the wording ({{personality}} in the system half —
    # the variable keeps its name; its value is the persona's note since
    # 2026-09-29);
    # the old hardcoded temperature=0.9 lives on its preset (p_compose —
    # ruling 9; its seeded 300 cap died in the caps ruling 2026-08-07).
    try:
        resp = run_feature("compose", {"personality": persona.note.strip()})
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM call failed: {e}")
    return ComposeResponse(
        text=resp.text.strip(),
        persona_id=id,
        note=None,
        usage=RunUsage(
            prompt_tokens=resp.prompt_tokens,
            completion_tokens=resp.completion_tokens,
            model=resp.model,
        ),
    )


@router.post(
    "/v1/personas/{id}/rewrite",
    response_model=RewriteResponse,
    summary="Rewrite the supplied text in the persona's voice (preview-then-accept)",
)
async def rewrite_in_character(id: str, body: RewriteRequest) -> RewriteResponse:
    """Take the user's text + the persona's note, return a rewritten version
    in that voice for preview. (Script's "Rewrite in character" reads a
    speaker's "Who they are" instead — /v1/speakers/{id}/rewrite.) The user accepts (text replaces
    the textarea) or rejects (original preserved) before sending to TTS.

    NEVER an automatic render-time hook — see plan Q3. Always explicit.
    Runs through the shared run path — the `persona_rewrite` template row +
    its engine preset (F1 Phase 2; the pin-era routing died).
    """
    from fastapi import HTTPException

    from llm_runner.llm import LLMNotConfiguredError

    from ..engines.llm.run import run_feature

    persona = _require_persona_with_note(id)
    if not body.text.strip():
        raise HTTPException(
            status_code=400,
            detail="rewrite requires non-empty text",
        )

    # The template row owns the wording ({{personality}} system + {{text}}
    # user); temperature lives on p_voiced_edit. No token cap (caps ruling
    # 2026-08-07).
    try:
        resp = run_feature(
            "persona_rewrite",
            {"personality": persona.note.strip(), "text": body.text},
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
        usage=RunUsage(
            prompt_tokens=resp.prompt_tokens,
            completion_tokens=resp.completion_tokens,
            model=resp.model,
        ),
    )
