# SPDX-License-Identifier: MIT
"""Shared persona creation for import/promotion paths.

Post-Phase-1.5 flip (2026-06-12): PersonaStore reads the same SQLite
rows this helper writes, so the old dual-write (DB row + file-store
twin with the same id) is gone — one INSERT is the whole story.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from ..database.models import Persona, ProjectPersona
from ..errors import conflict


# Names are unique WITHIN A BOOK, not across the library (decided 2026-09-29):
# two books may each have a "Narrator" or a "Mother", but one cast may not hold
# two people called the same. A persona in no book has no rule. Checked when a
# persona joins a cast (Cast's add, Discover's Add) and when one is renamed;
# an import keeps the book's characters exactly as the book has them.


def same_name(name: str | None) -> str:
    """The form two names are compared in — case and extra spaces don't count."""
    return " ".join((name or "").split()).casefold()


def cast_member_named(db: Session, project_id: str, name: str, *, besides: str | None = None) -> str | None:
    """This project's cast member already called `name` (their name as
    stored), or None. `besides` is the persona being added or renamed."""
    db.flush()  # links added earlier in the same request count too
    want = same_name(name)
    rows = (
        db.query(Persona.id, Persona.name)
        .join(ProjectPersona, ProjectPersona.persona_id == Persona.id)
        .filter(ProjectPersona.project_id == project_id)
    )
    for pid, stored in rows:
        if pid != besides and same_name(stored) == want:
            return stored
    return None


def refuse_same_name(db: Session, project_id: str, name: str, *, besides: str | None = None) -> None:
    taken = cast_member_named(db, project_id, name, besides=besides)
    if taken is not None:
        raise conflict(
            f'This book already has someone called "{taken}". Names are unique within a '
            "book — rename one of them first."
        )


def ensure_project_persona(
    db: Session,
    project_id: str,
    *,
    name: str,
    personality: str | None,
    imported_from: str,
    imported_id: str,
    aliases: list[str] | None = None,
    unique_in_cast: bool = False,
) -> tuple[str, bool]:
    """Create-or-reuse a persona by (imported_from, imported_id) and link
    it to the project. Returns (persona_id, created).

    Idempotent per project: an existing ProjectPersona link is not
    duplicated. `unique_in_cast` refuses a persona whose name someone in the
    cast already has — Discover's Add passes it; an import does not.
    """
    existing = (
        db.query(Persona)
        .filter(Persona.imported_from == imported_from, Persona.imported_id == imported_id)
        .first()
    )
    if existing:
        link = (
            db.query(ProjectPersona)
            .filter(
                ProjectPersona.project_id == project_id,
                ProjectPersona.persona_id == existing.id,
            )
            .first()
        )
        if link is None:
            if unique_in_cast:
                refuse_same_name(db, project_id, existing.name, besides=existing.id)
            db.add(ProjectPersona(project_id=project_id, persona_id=existing.id))
        return existing.id, False
    if unique_in_cast:
        refuse_same_name(db, project_id, name)

    # Everything an importer knows about a character is character-sheet
    # material. `voice_instruct` stays empty on import: "female, age 34,
    # protagonist" is a casting hint, not a delivery instruction — the user
    # writes that one (2026-08-15 split).
    import json

    from ..storage.personas import clean_aliases

    kept = clean_aliases(aliases, name)
    persona = Persona(
        name=name, personality=personality, imported_from=imported_from, imported_id=imported_id,
        aliases=json.dumps(kept) if kept else None,
    )
    db.add(persona)
    db.flush()
    db.add(ProjectPersona(project_id=project_id, persona_id=persona.id))
    return persona.id, True
