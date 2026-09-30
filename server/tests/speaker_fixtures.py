# SPDX-License-Identifier: MIT
"""Test helper: a line's speaker, played by a given persona.

Since 2026-09-29 a line points at a speaker (a person in the book) and the
speaker at its persona (the voice). Render tests that used to put a persona id
straight on a block get the same effect through `speaker_played_by`.
"""

from __future__ import annotations

from justvoice.database.models import Scene, Speaker


def speaker_played_by(db, scene_id: str, persona_id: str | None) -> str | None:
    """The id of this book's speaker played by `persona_id`, created on first
    use. None for None: a line with no speaker. The persona may live only in a
    test's fake store — `tmp_db` does not enforce foreign keys."""
    if persona_id is None:
        return None
    project_id = db.get(Scene, scene_id).project_id
    found = (
        db.query(Speaker)
        .filter(Speaker.project_id == project_id, Speaker.persona_id == persona_id)
        .first()
    )
    if found is not None:
        return found.id
    speaker = Speaker(project_id=project_id, name=f"Speaker {persona_id}", persona_id=persona_id)
    db.add(speaker)
    db.flush()
    return speaker.id
