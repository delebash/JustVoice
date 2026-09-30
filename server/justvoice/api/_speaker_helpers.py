# SPDX-License-Identifier: MIT
"""The people in a book — speakers (decided 2026-09-29).

A speaker is a person in one book: a name, the other names the text uses and
who they are. Cast gives each speaker a persona — the finished voice, from the
library — and one persona can play many speakers. Until 2026-09-29 one persona
row was both halves, which is why Discover and imports made voiceless personas.

This module owns the rules every door that makes or renames a speaker shares —
Discover's Add, the imports, + Add Narrator and Cast's ＋ Add — so none of them
can drift:

* names are unique within a book (case and extra spaces don't count), except
  that an import keeps the book's characters exactly as the book has them;
* a new speaker whose name exactly matches one persona in the library arrives
  already cast with it ("Every new speaker");
* a line's voice is line → speaker → persona (`persona_for_block`).
"""

from __future__ import annotations

import json

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database.models import Block, Persona, Scene, Speaker
from ..errors import conflict


def same_name(name: str | None) -> str:
    """The form two names are compared in — case and extra spaces don't count."""
    return " ".join((name or "").split()).casefold()


def clean_aliases(aliases, name: str = "") -> list[str]:
    """Trimmed, de-duplicated (case-blind), never the speaker's own name."""
    out: list[str] = []
    seen = {same_name(name)}
    for a in aliases or []:
        a = " ".join(str(a).split())
        if a and same_name(a) not in seen:
            seen.add(same_name(a))
            out.append(a)
    return out


def speaker_aliases(s) -> list[str]:
    """A speaker row's "Also called" names."""
    raw = getattr(s, "aliases", None)
    try:
        out = json.loads(raw) if raw else []
    except (TypeError, ValueError):
        return []
    return [str(a) for a in out if str(a).strip()] if isinstance(out, list) else []


def speaker_named(db: Session, project_id: str, name: str, *, besides: str | None = None) -> str | None:
    """This book's speaker already called `name` (their name as stored), or
    None. `besides` is the speaker being renamed."""
    db.flush()  # speakers added earlier in the same request count too
    want = same_name(name)
    rows = db.query(Speaker.id, Speaker.name).filter(Speaker.project_id == project_id)
    for sid, stored in rows:
        if sid != besides and same_name(stored) == want:
            return stored
    return None


def refuse_same_name(db: Session, project_id: str, name: str, *, besides: str | None = None) -> None:
    taken = speaker_named(db, project_id, name, besides=besides)
    if taken is not None:
        raise conflict(
            f'This book already has a speaker called "{taken}". Names are unique within a '
            "book — rename one of them first."
        )


def persona_named(db: Session, name: str) -> str | None:
    """The one persona whose name is exactly `name` (case and extra spaces
    aside), or None — also None when two personas share it: ambiguity is
    refused, never guessed."""
    want = same_name(name)
    if not want:
        return None
    hits = [pid for pid, stored in db.query(Persona.id, Persona.name) if same_name(stored) == want]
    return hits[0] if len(hits) == 1 else None


def ensure_speaker(
    db: Session,
    project_id: str,
    *,
    name: str,
    description: str | None = None,
    aliases: list[str] | None = None,
    imported_from: str | None = None,
    imported_id: str | None = None,
    unique: bool = False,
) -> tuple[Speaker, bool]:
    """Create-or-reuse a speaker in this book. Returns (speaker, created).

    A re-import reuses the speaker its (imported_from, imported_id) made, so a
    book's characters are never duplicated. `unique` refuses a name the book
    already has — every door but the imports passes it. A new speaker is cast
    with the persona of exactly its name, when there is one."""
    if imported_from and imported_id:
        existing = (
            db.query(Speaker)
            .filter(
                Speaker.project_id == project_id,
                Speaker.imported_from == imported_from,
                Speaker.imported_id == imported_id,
            )
            .first()
        )
        if existing is not None:
            return existing, False
    clean = " ".join((name or "").split())
    if unique:
        refuse_same_name(db, project_id, clean)
    kept = clean_aliases(aliases, clean)
    speaker = Speaker(
        project_id=project_id,
        name=clean,
        description=(description or "").strip() or None,
        aliases=json.dumps(kept) if kept else None,
        persona_id=persona_named(db, clean),
        imported_from=imported_from,
        imported_id=imported_id,
    )
    db.add(speaker)
    db.flush()
    return speaker, True


def persona_for_block(db: Session, block) -> Persona | None:
    """The persona that voices a line: line → speaker → persona. None when
    the line has no speaker, or its speaker has no persona yet."""
    if not getattr(block, "speaker_id", None):
        return None
    speaker = db.get(Speaker, block.speaker_id)
    if speaker is None or not speaker.persona_id:
        return None
    return db.get(Persona, speaker.persona_id)


def speaker_line_counts(db: Session, project_id: str) -> dict[str, int]:
    """{speaker_id: lines with text} across the book — Cast's "61 lines", and
    what a removal says it will leave with no speaker."""
    rows = (
        db.query(Block.speaker_id, func.count(Block.id))
        .join(Scene, Scene.id == Block.scene_id)
        .filter(Scene.project_id == project_id, Block.speaker_id.isnot(None))
        .filter(func.trim(Block.text) != "")
        .group_by(Block.speaker_id)
    )
    return {sid: n for sid, n in rows}


def narrator_speaker_id(db: Session, project_id: str) -> str | None:
    """The book's narrator — the speaker holding the "narrator" role. None
    when the book has none yet (nothing makes one on its own): Analyze then
    leaves narration with no speaker.

    The role only, as Studio and Cast read it (2026-09-30, one narrator rule).
    A speaker merely CALLED Narrator used to count here too, so the server
    and the app could disagree on who narrates; an imported "Narrator"
    character gets the role at import (`adopt_book_narrator`)."""
    row = (
        db.query(Speaker.id)
        .filter(Speaker.project_id == project_id, Speaker.role_label == "narrator")
        .first()
    )
    return row[0] if row else None


def move_narration(db: Session, project_id: str, new_id: str, old_id: str | None) -> int:
    """Narration follows the narrator: every line Analyze decided is
    narration (`source == "narration"`) that belonged to the old narrator, or
    to nobody, moves to the new one. Lines you set yourself (`corrected`) stay.
    Returns how many moved. Caller commits."""
    from sqlalchemy import or_

    scene_ids = [sid for (sid,) in db.query(Scene.id).filter(Scene.project_id == project_id)]
    if not scene_ids:
        return 0
    owners = [Block.speaker_id.is_(None)]
    if old_id and old_id != new_id:
        owners.append(Block.speaker_id == old_id)
    return (
        db.query(Block)
        .filter(Block.scene_id.in_(scene_ids), Block.source == "narration", or_(*owners))
        .update({Block.speaker_id: new_id}, synchronize_session=False)
    )


# Project kinds whose import adopts the book's own "Narrator" character —
# every prose kind (custom joined 2026-09-30: an SRT or plain-text import can
# name one too). A game sheet has no prose voice.
NARRATOR_KINDS = {"audiobook", "podcast", "custom"}


def adopt_book_narrator(db: Session, project) -> None:
    """An imported book that has its own speaker called "Narrator": that
    speaker is the narrator. Nothing is ever CREATED here (decided
    2026-09-29, "i dont think each project should automatically create a
    narrator"). Runs AFTER the speakers — a manuscript may name its own
    narrator (`docs/import-and-export.md`). Caller commits."""
    if project.project_type not in NARRATOR_KINDS:
        return
    db.flush()
    if (
        db.query(Speaker.id)
        .filter(Speaker.project_id == project.id, Speaker.role_label == "narrator")
        .first()
    ):
        return
    for s in db.query(Speaker).filter(Speaker.project_id == project.id):
        if same_name(s.name) == "narrator":
            s.role_label = "narrator"
            return
