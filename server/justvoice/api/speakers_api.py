# SPDX-License-Identifier: MIT
"""/v1/projects/{id}/speakers, /v1/speakers/{id} — the people in a book.

Decided 2026-09-29: a speaker is a person in one book (name, "Also called",
who they are); Cast gives each speaker a persona — the finished voice, from
the library — and one persona can play many speakers. These routes replace the
project ↔ persona cast link (`/v1/projects/{id}/cast`), which is gone.

The narrator is a speaker holding the "narrator" role, one per book; no book
gets one on its own (+ Add Narrator, or a book's own "Narrator" character).
"""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..database.models import Block, Persona, Project, Scene, Speaker, SpeakerCorrection
from ..errors import bad_request, not_found
from ..models import CreateSpeakerRequest, SpeakerList, UpdateSpeakerRequest
from ..models import Speaker as SpeakerOut
from ._speaker_helpers import (
    clean_aliases,
    ensure_speaker,
    move_narration,
    narrator_speaker_id,
    persona_named,
    refuse_same_name,
    same_name,
    speaker_aliases,
    speaker_line_counts,
)
from .extraction_api import RunUsage

router = APIRouter(tags=["speakers"])


def _out(s: Speaker, names: dict[str, str], counts: dict[str, int]) -> SpeakerOut:
    return SpeakerOut(
        id=s.id,
        project_id=s.project_id,
        name=s.name,
        aliases=speaker_aliases(s),
        description=s.description,
        persona_id=s.persona_id,
        persona_name=names.get(s.persona_id) if s.persona_id else None,
        role_label=s.role_label,
        lines=counts.get(s.id, 0),
    )


def list_speakers(db: Session, project_id: str) -> list[SpeakerOut]:
    """The book's speakers, most lines first (the narrator's narration
    counts), then by name."""
    rows = db.query(Speaker).filter(Speaker.project_id == project_id).all()
    ids = {s.persona_id for s in rows if s.persona_id}
    names = dict(db.query(Persona.id, Persona.name).filter(Persona.id.in_(ids))) if ids else {}
    counts = speaker_line_counts(db, project_id)
    out = [_out(s, names, counts) for s in rows]
    out.sort(key=lambda s: (-s.lines, s.name.lower()))
    return out


def _one(db: Session, s: Speaker) -> SpeakerOut:
    names = {}
    if s.persona_id:
        p = db.get(Persona, s.persona_id)
        names = {p.id: p.name} if p else {}
    return _out(s, names, speaker_line_counts(db, s.project_id))


def _project(db: Session, project_id: str) -> Project:
    p = db.query(Project).filter(Project.id == project_id).first()
    if p is None:
        raise not_found(f"project {project_id}")
    return p


def _persona_or_404(db: Session, persona_id: str) -> None:
    if db.get(Persona, persona_id) is None:
        raise not_found(f"persona {persona_id}")


@router.get("/v1/projects/{project_id}/speakers", response_model=SpeakerList)
async def get_speakers(project_id: str, db: Session = Depends(get_db)) -> SpeakerList:
    _project(db, project_id)
    return SpeakerList(speakers=list_speakers(db, project_id))


@router.post("/v1/projects/{project_id}/speakers", response_model=SpeakerOut, status_code=201)
async def add_speaker(
    project_id: str, body: CreateSpeakerRequest, db: Session = Depends(get_db)
) -> SpeakerOut:
    """Cast's ＋ Add: a speaker by name. Refused when the book already has
    that name; cast with the persona of exactly its name unless one is given."""
    _project(db, project_id)
    if body.persona_id:
        _persona_or_404(db, body.persona_id)
    speaker, _ = ensure_speaker(
        db, project_id, name=body.name, description=body.description,
        aliases=body.aliases, unique=True,
    )
    if body.persona_id:
        speaker.persona_id = body.persona_id
    db.commit()
    db.refresh(speaker)
    return _one(db, speaker)


@router.patch("/v1/speakers/{speaker_id}", response_model=SpeakerOut)
async def update_speaker(
    speaker_id: str, body: UpdateSpeakerRequest, db: Session = Depends(get_db)
) -> SpeakerOut:
    """Rename, "Also called", "Who they are", and the cast — the persona that
    plays them (`persona_id: null` un-casts). A rename is refused when the
    book already has a speaker by the new name."""
    s = db.get(Speaker, speaker_id)
    if s is None:
        raise not_found(f"speaker {speaker_id}")
    sent = body.model_fields_set
    if body.name is not None:
        name = " ".join(body.name.split())
        if same_name(name) != same_name(s.name):
            refuse_same_name(db, s.project_id, name, besides=s.id)
        s.name = name
    if body.aliases is not None:
        kept = clean_aliases(body.aliases, s.name)
        s.aliases = json.dumps(kept) if kept else None
    elif body.name is not None:
        # A rename can make an alias the speaker's own name — drop it.
        kept = clean_aliases(speaker_aliases(s), s.name)
        s.aliases = json.dumps(kept) if kept else None
    if "description" in sent:
        s.description = (body.description or "").strip() or None
    if "persona_id" in sent:
        if body.persona_id:
            _persona_or_404(db, body.persona_id)
        s.persona_id = body.persona_id or None
    db.commit()
    db.refresh(s)
    return _one(db, s)


@router.delete("/v1/speakers/{speaker_id}")
async def delete_speaker(speaker_id: str, db: Session = Depends(get_db)) -> dict:
    """Remove a speaker from the book. Their lines go back to no speaker and
    their saved fixes forget them; the persona that played them stays in the
    library. (Studio asks first — decided 2026-09-29.)"""
    s = db.get(Speaker, speaker_id)
    if s is None:
        raise not_found(f"speaker {speaker_id}")
    scene_ids = [sid for (sid,) in db.query(Scene.id).filter(Scene.project_id == s.project_id)]
    lines = 0
    if scene_ids:
        lines = (
            db.query(Block)
            .filter(Block.scene_id.in_(scene_ids), Block.speaker_id == s.id)
            .update({Block.speaker_id: None}, synchronize_session=False)
        )
    db.query(SpeakerCorrection).filter(SpeakerCorrection.speaker_id == s.id).update(
        {SpeakerCorrection.speaker_id: None}, synchronize_session=False)
    db.delete(s)
    db.commit()
    return {"deleted": True, "lines": lines}


@router.post("/v1/projects/{project_id}/speakers/uncast", response_model=SpeakerList)
async def uncast_all(project_id: str, db: Session = Depends(get_db)) -> SpeakerList:
    """Cast's ✕ Clear cast: every speaker loses its persona. The speakers stay."""
    _project(db, project_id)
    db.query(Speaker).filter(Speaker.project_id == project_id).update(
        {Speaker.persona_id: None}, synchronize_session=False)
    db.commit()
    return SpeakerList(speakers=list_speakers(db, project_id))


# ── The narrator ─────────────────────────────────────────────────────────


class SetNarratorRequest(BaseModel):
    speaker_id: str


class NarratorResponse(SpeakerList):
    # Narration lines that moved to the narrator.
    moved_lines: int = 0


@router.put("/v1/projects/{project_id}/narrator", response_model=NarratorResponse)
async def set_narrator(
    project_id: str, body: SetNarratorRequest, db: Session = Depends(get_db)
) -> NarratorResponse:
    """Make one speaker the book's narrator (any speaker can be — a
    first-person narrator narrates AND speaks, one voice). The role comes off
    whoever held it; narration follows it (`move_narration`)."""
    _project(db, project_id)
    s = db.get(Speaker, body.speaker_id)
    if s is None or s.project_id != project_id:
        raise bad_request("That speaker isn't in this book.")
    old_id = narrator_speaker_id(db, project_id)
    if old_id == s.id and s.role_label == "narrator":
        return NarratorResponse(speakers=list_speakers(db, project_id))
    db.query(Speaker).filter(
        Speaker.project_id == project_id, Speaker.role_label == "narrator", Speaker.id != s.id
    ).update({Speaker.role_label: None}, synchronize_session=False)
    s.role_label = "narrator"
    moved = move_narration(db, project_id, s.id, old_id)
    db.commit()
    return NarratorResponse(speakers=list_speakers(db, project_id), moved_lines=moved)


@router.post("/v1/projects/{project_id}/narrator", response_model=NarratorResponse, status_code=201)
async def ensure_narrator(project_id: str, db: Session = Depends(get_db)) -> NarratorResponse:
    """Studio Cast's "+ Add Narrator". Idempotent: a book that has a narrator
    comes back unchanged. Else a speaker called Narrator takes the role, or a
    new speaker "Narrator" is made — cast with the persona of exactly that name
    when there is one. Narration with no speaker then moves to it."""
    _project(db, project_id)
    has_role = (
        db.query(Speaker.id)
        .filter(Speaker.project_id == project_id, Speaker.role_label == "narrator")
        .first()
    )
    if has_role is not None:
        return NarratorResponse(speakers=list_speakers(db, project_id))
    existing = next(
        (s for s in db.query(Speaker).filter(Speaker.project_id == project_id)
         if same_name(s.name) == "narrator"),
        None,
    )
    if existing is None:
        existing, _ = ensure_speaker(
            db, project_id, name="Narrator",
            description="The book's narrator: reads everything that is not a speaker's line.",
        )
    existing.role_label = "narrator"
    moved = move_narration(db, project_id, existing.id, None)
    db.commit()
    return NarratorResponse(speakers=list_speakers(db, project_id), moved_lines=moved)


# ── Rewrite in character (Script's right-click) ──────────────────────────


class SpeakerRewriteRequest(BaseModel):
    text: str


class SpeakerRewriteResponse(BaseModel):
    original: str
    rewritten: str
    speaker_id: str
    usage: RunUsage | None = None


@router.post(
    "/v1/speakers/{speaker_id}/rewrite",
    response_model=SpeakerRewriteResponse,
    summary="Rewrite a line in the speaker's character (preview-then-accept)",
)
async def rewrite_as_speaker(
    speaker_id: str, body: SpeakerRewriteRequest, db: Session = Depends(get_db)
) -> SpeakerRewriteResponse:
    """Script's "Rewrite in character": the speaker's "Who they are" is the
    character (it moved off the persona 2026-09-29). Same `persona_rewrite`
    template row as Generate's Rewrite, which reads a persona's note instead."""
    from llm_runner.llm import LLMNotConfiguredError

    from ..engines.llm.run import run_feature

    s = db.get(Speaker, speaker_id)
    if s is None:
        raise not_found(f"speaker {speaker_id}")
    who = (s.description or "").strip()
    if not who:
        raise HTTPException(
            status_code=400,
            detail=f"{s.name} has nothing under Who they are — write it on Cast to rewrite in character.",
        )
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="rewrite requires non-empty text")
    try:
        resp = run_feature("persona_rewrite", {"personality": who, "text": body.text})
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM call failed: {e}")
    return SpeakerRewriteResponse(
        original=body.text,
        rewritten=resp.text.strip(),
        speaker_id=speaker_id,
        usage=RunUsage(
            prompt_tokens=resp.prompt_tokens,
            completion_tokens=resp.completion_tokens,
            model=resp.model,
        ),
    )


__all__ = ["router", "list_speakers", "persona_named"]
