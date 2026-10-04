"""/v1/personas CRUD + where each persona is used.

A persona is a finished spoken voice in the library (2026-09-29): it plays
speakers — the people in a book — and one persona can play many. So "used"
means the speakers it plays, in which books."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..app_state import get_state
from ..database import get_db
from ..database.models import Block, Generation, Lexicon, MCPBinding, Project, Speaker
from ..errors import bad_request, conflict, not_found
from ..models import (
    CreatePersonaRequest,
    MergePersonaRequest,
    Persona,
    PersonaDelivery,
    PersonaList,
    PersonaView,
    PersonaPreviewRequest,
    UpdatePersonaRequest,
)
from .extraction_api import RunUsage

router = APIRouter(tags=["personas"])


@router.get("/v1/personas", response_model=PersonaList)
async def list_personas() -> PersonaList:
    st = get_state()
    seen: dict = {}
    return PersonaList(personas=[_view(st, p, seen) for p in st.personas.list()])


def _view(st, persona: Persona, seen: dict | None = None) -> PersonaView:
    """The persona plus its voice's facts (`PersonaView`). `seen` caches each
    voice's model across a list — many personas share one voice."""
    from ..persona_render import persona_language
    from ..voice_model import voice_language, voice_model

    seen = {} if seen is None else seen
    vid = persona.voice_id
    if vid and vid not in seen:
        try:
            seen[vid] = (voice_model(st, vid), voice_language(st, vid))
        except Exception:  # noqa: BLE001 — a voice nothing owns any more shows no facts
            seen[vid] = (None, None)
    vm, own = seen.get(vid, (None, None)) if vid else (None, None)
    return PersonaView(
        **persona.model_dump(),
        model=vm.model if vm else None,
        model_name=vm.name if vm else None,
        directed_by=vm.directed_by if vm else None,
        speaks=persona_language(persona, vm, own) if vm else None,
    )


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
    # Of those lines, how many carry a written direction of their own — what
    # the editor warns about when a new voice's model can't perform it
    # ("18 carry a written direction — Chatterbox Turbo won't perform them").
    directed_lines: int = 0


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
    directed = 0
    if speakers:
        directed = (
            db.query(Block)
            .filter(Block.speaker_id.in_([u.speaker_id for u in speakers]))
            .filter(Block.direction.isnot(None), Block.direction != "")
            .count()
        )
    return PersonaUsageDetailResponse(
        persona_id=persona_id,
        speakers=speakers,
        total_lines=sum(u.lines for u in speakers),
        directed_lines=directed,
    )


class StockLineResponse(BaseModel):
    language: str | None
    text: str


@router.get("/v1/personas/stock-line", response_model=StockLineResponse)
async def persona_stock_line(language: str | None = None) -> StockLineResponse:
    """The persona editor's "↻ Stock line" — one sentence in the persona's
    language where one is written, else English (persona_render.STOCK_LINES)."""
    from ..persona_render import stock_line

    return StockLineResponse(language=language, text=stock_line(language))


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


def _checked_language(voice_id: str | None, language: str | None, *, keep_if_spoken: str | None = None) -> str:
    """The language a persona on `voice_id` is saved with (2026-10-03).

    Asked for → it must be one the voice's model speaks. Not asked for → the
    language it had (`keep_if_spoken`) if the voice still speaks it, else
    the voice's own. Where the voice or model allows one language (a Kokoro
    voice, Kitten, Turbo) that is the only answer."""
    from ..voice_model import speaks_language, voice_language, voice_model

    st = get_state()
    vm = voice_model(st, voice_id) if voice_id else None
    if vm is None:
        return (language or keep_if_spoken or "en").strip() or "en"
    if language:
        if vm.speaks and not speaks_language(vm, language):
            spoken = ", ".join(vm.speaks)
            raise bad_request(
                f"{vm.name} can't speak {language} with this voice — it speaks {spoken}."
            )
        return language
    if len(vm.speaks) == 1:
        return vm.speaks[0]
    if keep_if_spoken and speaks_language(vm, keep_if_spoken):
        return keep_if_spoken
    own = voice_language(st, voice_id)
    if own and (not vm.speaks or speaks_language(vm, own)):
        return own
    return vm.speaks[0] if vm.speaks else (own or "en")


def _checked_voice(voice_id: str | None) -> str | None:
    from ..voice_model import voice_model

    if not voice_id:
        return None
    if voice_model(get_state(), voice_id) is None:
        raise bad_request("That voice doesn't exist any more — pick another one.")
    return voice_id


def _checked_delivery(delivery: PersonaDelivery) -> PersonaDelivery:
    from ..persona_render import check_delivery

    problems = check_delivery(delivery)
    if problems:
        raise bad_request("; ".join(problems))
    return delivery


@router.post("/v1/personas", response_model=PersonaView, status_code=201)
async def create_persona(body: CreatePersonaRequest) -> PersonaView:
    voice_id = _checked_voice(body.voice_id)
    st = get_state()
    return _view(st, st.personas.create(
        _persona_name(body.name),
        voice_id,
        _checked_delivery(body.default_delivery),
        voice_instruct=body.voice_instruct,
        lexicon_id=body.lexicon_id,
        llm_rewrite_enabled=body.llm_rewrite_enabled,
        llm_model=body.llm_model,
        language=_checked_language(voice_id, body.language),
        avatar_path=body.avatar_path,
        note=body.note,
        effects_chain=body.effects_chain,
    ))


@router.get("/v1/personas/{id}", response_model=PersonaView)
async def get_persona(id: str) -> PersonaView:
    st = get_state()
    p = st.personas.get(id)
    if not p:
        raise not_found(f"persona {id}")
    return _view(st, p)


@router.patch("/v1/personas/{id}", response_model=PersonaView)
async def update_persona(id: str, body: UpdatePersonaRequest) -> PersonaView:
    """Change what was sent: a field left out stays, a field sent as null is
    cleared (2026-10-03 — this replaced a PUT that could not clear)."""
    current = get_state().personas.get(id)
    if current is None:
        raise not_found(f"persona {id}")
    sent = body.model_fields_set
    fields: dict = {}
    if "name" in sent:
        fields["name"] = _persona_name(body.name, besides=id)
    if "voice_id" in sent:
        fields["voice_id"] = _checked_voice(body.voice_id)
    voice_id = fields.get("voice_id", current.voice_id)
    if "language" in sent or "voice_id" in sent:
        fields["language"] = _checked_language(
            voice_id, body.language if "language" in sent else None, keep_if_spoken=current.language,
        )
    if "default_delivery" in sent:
        fields["default_delivery"] = _checked_delivery(body.default_delivery or PersonaDelivery())
    for key in ("avatar_path", "voice_instruct", "note", "effects_chain", "lexicon_id"):
        if key in sent:
            value = getattr(body, key)
            fields[key] = value.strip() or None if isinstance(value, str) else value
    p = get_state().personas.update(id, **fields)
    if not p:
        raise not_found(f"persona {id}")
    return _view(get_state(), p)


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


@router.post("/v1/personas/{id}/merge")
async def merge_persona(id: str, body: MergePersonaRequest, db: Session = Depends(get_db)) -> dict:
    """"Merge into…" (decided 2026-10-03): every speaker this persona plays
    is played by `into` from now on, and this persona goes. Its
    persona-scoped lexicons, its generations and its MCP bindings move too;
    its own settings do not — the persona merged into keeps its own."""
    st = get_state()
    source = st.personas.get(id)
    if source is None:
        raise not_found(f"persona {id}")
    if body.into == id:
        raise bad_request("A persona can't be merged into itself.")
    target = st.personas.get(body.into)
    if target is None:
        raise not_found(f"persona {body.into}")
    moved = db.query(Speaker).filter(Speaker.persona_id == id).update(
        {Speaker.persona_id: target.id}, synchronize_session=False)
    db.query(Lexicon).filter(Lexicon.persona_id == id).update(
        {Lexicon.persona_id: target.id}, synchronize_session=False)
    db.query(Generation).filter(Generation.persona_id == id).update(
        {Generation.persona_id: target.id}, synchronize_session=False)
    db.query(MCPBinding).filter(MCPBinding.persona_id == id).update(
        {MCPBinding.persona_id: target.id}, synchronize_session=False)
    db.commit()
    st.personas.delete(id)
    return {"merged": True, "into": target.id, "into_name": target.name, "speakers": moved}


@router.post(
    "/v1/personas/preview",
    summary="Hear a persona speak a line — the editor's unsaved draft or a saved one",
    responses={200: {"content": {"audio/wav": {}}}},
)
async def preview_persona(body: PersonaPreviewRequest) -> Response:
    """The persona editor's Listen and Compare, Cast's ▶ and the index's ▶
    (2026-10-03). Renders through `persona_render.plan_line` — the resolver
    the chapter render uses — so what you hear here is what the chapter
    contains. An empty line speaks the stock line in the persona's language."""
    from ..persona_render import check_delivery, plan_line, stock_line
    from ..render_core import pcm_to_wav, render_line
    from ..synth_scheduler import get_scheduler
    from ..voice_model import model_key

    st = get_state()
    if body.persona is not None:
        persona = body.persona
    elif body.persona_id:
        persona = st.personas.get(body.persona_id)
        if persona is None:
            raise not_found(f"persona {body.persona_id}")
    else:
        raise bad_request("Send the persona to hear: persona or persona_id.")
    if not persona.voice_id:
        raise bad_request("Pick a voice first — a persona with no voice has nothing to speak with.")
    problems = check_delivery(persona.default_delivery)
    if problems:
        raise bad_request("; ".join(problems))
    plan = plan_line(st, persona, text=" ", direction=body.direction, request_delivery=body.delivery)
    if not body.auto_load:
        from ..engines.manager import get_manager
        from ..voice_model import is_model_loaded, voice_model

        vm = voice_model(st, plan.voice)
        if (vm is not None and get_manager().get_manifest(vm.engine_id) is not None
                and not is_model_loaded(vm.engine_id, vm.model)):
            raise conflict(f"engine_not_loaded:{vm.engine_id}")
    text = body.text.strip() or stock_line(plan.language)
    plan.text = text

    def _do() -> bytes:
        rl = render_line(
            st, voice=plan.voice, text=plan.text, language=plan.language,
            delivery=plan.delivery, seed=plan.seed, lexicons=plan.lexicons,
            effects=plan.effects, cache_scope="persona-preview", use_cache=True,
        )
        return pcm_to_wav(rl)

    handle = get_scheduler().submit([(model_key(st, plan.voice), _do)], interactive=True)
    await handle.wait_async()
    handle.raise_if_failed()
    return Response(content=handle.items[0].result, media_type="audio/wav")


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
