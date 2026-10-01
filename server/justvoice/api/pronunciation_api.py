# SPDX-License-Identifier: MIT
"""/v1/projects/{id}/pronunciation-report — the pre-flight name scan (C2).

Walks every block of the project, finds likely proper nouns
(justvoice.pronunciation), subtracts what the render already handles on
each line, and returns the worklist. The Lexicons page's "Scan a book"
button is the consumer: one click turns "discover the mispronounced name in
chapter 30 of the finished audiobook" into a list you fix before rendering.

"Handled" is read per line, with the lexicons the render reads that line
with (render_core.line_lexicons — the book's chosen lexicon, then the
persona's that speaks the line), since 2026-09-30. It used to count every
book-scoped lexicon of the project, chosen or not, while the render read
none of them: a name could be "handled" and still be said wrong.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..database.models import Block, Persona, Project, Scene, Speaker
from ..database.models import LexiconEntry as DbLexiconEntry
from ..errors import not_found
from ..pronunciation import scan_names
from ..render_core import line_lexicons

log = logging.getLogger(__name__)

router = APIRouter(tags=["lexicons"])


@router.post(
    "/v1/projects/{project_id}/pronunciation-report",
    summary="Likely-mispronounced names the render doesn't already handle",
)
async def pronunciation_report(project_id: str, db: Session = Depends(get_db)) -> dict:
    project = db.query(Project).filter(Project.id == project_id).first()
    if project is None:
        raise not_found(f"project '{project_id}' not found")

    blocks = (
        db.query(Block.text, Block.speaker_id)
        .join(Scene, Block.scene_id == Scene.id)
        .filter(Scene.project_id == project_id)
        .order_by(Scene.position, Block.position)
        .all()
    )

    # line → speaker → persona → its lexicon, the render's own chain.
    persona_of = dict(
        db.query(Speaker.id, Speaker.persona_id).filter(Speaker.project_id == project_id)
    )
    cast = {pid for pid in persona_of.values() if pid}
    lexicon_of = (
        dict(db.query(Persona.id, Persona.lexicon_id).filter(Persona.id.in_(cast)))
        if cast else {}
    )

    # A row counts as handled even while its pronunciation is blank — the
    # scan's job is "which names have no row yet".
    words_in: dict[str, set[str]] = {}

    def _covered(lexicon_ids: list[str]) -> frozenset[str]:
        for lid in lexicon_ids:
            if lid not in words_in:
                words_in[lid] = {
                    word
                    for (word,) in db.query(DbLexiconEntry.word).filter(
                        DbLexiconEntry.lexicon_id == lid
                    )
                }
        return frozenset().union(*(words_in[lid] for lid in lexicon_ids))

    lines = [
        (
            text,
            _covered(line_lexicons(
                project.default_lexicon_id, lexicon_of.get(persona_of.get(speaker_id))
            )),
        )
        for text, speaker_id in blocks
    ]

    words = scan_names(lines)
    return {
        "project_id": project_id,
        "project_name": project.name,
        "blocks_scanned": len(lines),
        "covered_count": len(set().union(*words_in.values())) if words_in else 0,
        "words": words,
    }
