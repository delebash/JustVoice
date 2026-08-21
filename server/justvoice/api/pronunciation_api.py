# SPDX-License-Identifier: MIT
"""/v1/projects/{id}/pronunciation-report — the pre-flight name scan (C2).

Walks every block of the project, finds likely proper nouns
(justvoice.pronunciation), subtracts what the project's lexicons already
cover, and returns the worklist. The Lexicons page's "Scan a book" button
is the consumer: one click turns "discover the mispronounced name in
chapter 30 of the finished audiobook" into a list you fix before
rendering.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..database.models import Block, Project, Scene
from ..database.models import Lexicon as DbLexicon
from ..database.models import LexiconEntry as DbLexiconEntry
from ..errors import not_found
from ..pronunciation import scan_names

log = logging.getLogger(__name__)

router = APIRouter(tags=["lexicons"])


@router.post(
    "/v1/projects/{project_id}/pronunciation-report",
    summary="Likely-mispronounced names not covered by the project's lexicons",
)
async def pronunciation_report(project_id: str, db: Session = Depends(get_db)) -> dict:
    project = db.query(Project).filter(Project.id == project_id).first()
    if project is None:
        raise not_found(f"project '{project_id}' not found")

    texts = [
        b.text
        for (b,) in db.query(Block)
        .join(Scene, Block.scene_id == Scene.id)
        .filter(Scene.project_id == project_id)
        .order_by(Scene.position, Block.position)
        .with_entities(Block)
        .all()
    ]

    # Everything a project-scoped lexicon (or the project default) already
    # covers — those names are solved, not worklist.
    lex_ids = {
        lx.id
        for lx in db.query(DbLexicon)
        .filter(DbLexicon.scope == "project", DbLexicon.project_id == project_id)
        .all()
    }
    if project.default_lexicon_id:
        lex_ids.add(project.default_lexicon_id)
    covered: set[str] = set()
    if lex_ids:
        covered = {
            e.word
            for e in db.query(DbLexiconEntry)
            .filter(DbLexiconEntry.lexicon_id.in_(lex_ids))
            .all()
        }

    words = scan_names(texts, covered)
    return {
        "project_id": project_id,
        "project_name": project.name,
        "blocks_scanned": len(texts),
        "covered_count": len(covered),
        "words": words,
    }
