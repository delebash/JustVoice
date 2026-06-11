# SPDX-License-Identifier: GPL-3.0-or-later
"""Shared persona creation — the dual-write in ONE place.

Mid-Phase-1.5 the personas API serves the file store while ProjectPersona
FKs the SQLite row, so every creation path (import materializer, Script
discovered-speaker promotion) must write both with the same id. Keeping
the logic here stops the two paths drifting.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from ..database.models import Persona, ProjectPersona


def ensure_project_persona(
    db: Session,
    persona_store,
    project_id: str,
    *,
    name: str,
    bio: str | None,
    imported_from: str,
    imported_id: str,
) -> tuple[str, bool]:
    """Create-or-reuse a persona by (imported_from, imported_id) and link
    it to the project. Returns (persona_id, created).

    Idempotent per project: an existing ProjectPersona link is not
    duplicated; a missing file-store twin is self-healed.
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
            db.add(ProjectPersona(project_id=project_id, persona_id=existing.id))
        if persona_store is not None and persona_store.get(existing.id) is None:
            persona_store.create(
                name=existing.name,
                voice_id="",
                bio=existing.bio,
                imported_from=existing.imported_from,
                imported_id=existing.imported_id,
                id=existing.id,
            )
        return existing.id, False

    persona = Persona(name=name, bio=bio, imported_from=imported_from, imported_id=imported_id)
    db.add(persona)
    db.flush()
    db.add(ProjectPersona(project_id=project_id, persona_id=persona.id))
    if persona_store is not None:
        persona_store.create(
            name=name,
            voice_id="",
            bio=bio,
            imported_from=imported_from,
            imported_id=imported_id,
            id=persona.id,
        )
    return persona.id, True
