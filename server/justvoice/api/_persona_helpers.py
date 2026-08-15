# SPDX-License-Identifier: MIT
"""Shared persona creation for import/promotion paths.

Post-Phase-1.5 flip (2026-06-12): PersonaStore reads the same SQLite
rows this helper writes, so the old dual-write (DB row + file-store
twin with the same id) is gone — one INSERT is the whole story.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from ..database.models import Persona, ProjectPersona


def ensure_project_persona(
    db: Session,
    project_id: str,
    *,
    name: str,
    personality: str | None,
    imported_from: str,
    imported_id: str,
) -> tuple[str, bool]:
    """Create-or-reuse a persona by (imported_from, imported_id) and link
    it to the project. Returns (persona_id, created).

    Idempotent per project: an existing ProjectPersona link is not
    duplicated.
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
        return existing.id, False

    # Everything an importer knows about a character is character-sheet
    # material. `voice_instruct` stays empty on import: "female, age 34,
    # protagonist" is a casting hint, not a delivery instruction — the user
    # writes that one (2026-08-15 split).
    persona = Persona(
        name=name, personality=personality, imported_from=imported_from, imported_id=imported_id
    )
    db.add(persona)
    db.flush()
    db.add(ProjectPersona(project_id=project_id, persona_id=persona.id))
    return persona.id, True
