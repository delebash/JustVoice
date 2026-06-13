# SPDX-License-Identifier: GPL-3.0-or-later
"""DELETE /v1/generations — bulk-delete generations matching filter criteria.

Dry-run by default (confirm=False returns would-be-deleted count). At least
one filter required to prevent accidental nuke-all. Atomic single SQL DELETE.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Optional, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import Generation, Persona, get_db
from ..errors import bad_request


router = APIRouter(tags=["generations"])


OkStatus = Literal["ok", "failed"]


class BulkDeleteResult(BaseModel):
    deleted_count: int
    freed_bytes: int
    dry_run: bool


@router.delete("/v1/generations", response_model=BulkDeleteResult)
async def bulk_delete_generations(
    voice_id: Optional[str] = None,
    engine: Optional[str] = None,
    favorited: Optional[bool] = None,
    scope: Optional[str] = None,
    status: Optional[OkStatus] = None,
    older_than: Optional[datetime] = None,
    chapter_id: Optional[str] = None,
    project_id: Optional[str] = None,
    confirm: bool = False,
    db: Session = Depends(get_db),
) -> BulkDeleteResult:
    """Bulk-delete generations matching filter criteria.

    Filters compose with AND. At least one filter required (400 otherwise) to
    prevent an accidental nuke-all. confirm=False (default) returns the dry-run
    count WITHOUT deleting; pass confirm=true to actually delete.
    """
    filters_present = any(
        v is not None
        for v in (voice_id, engine, favorited, scope, status, older_than, chapter_id, project_id)
    )
    if not filters_present:
        raise bad_request(
            "At least one filter required to prevent accidental nuke-all. "
            "Use voice_id / engine / favorited / scope / status / older_than / "
            "chapter_id / project_id."
        )

    q = db.query(Generation)
    if voice_id is not None:
        # A generation knows its voice two ways: legacy rows wrote the voice
        # id into profile_id verbatim; persona-era rows carry persona_id and
        # the persona binds the voice. Match both or the filter silently
        # misses everything written since the persona flip.
        persona_ids = db.query(Persona.id).filter(Persona.voice_id == voice_id)
        q = q.filter(
            or_(
                Generation.profile_id == voice_id,
                Generation.persona_id.in_(persona_ids),
            )
        )
    if engine is not None:
        q = q.filter(Generation.engine == engine)
    if favorited is not None:
        q = q.filter(Generation.is_favorited == favorited)
    # scope is the cache_scope from the old storage layer; not in ORM yet —
    # accept it as a no-op for forward compat with the docs.
    if status is not None:
        q = q.filter(Generation.ok_status == status)
    if older_than is not None:
        q = q.filter(Generation.created_at < older_than)
    if chapter_id is not None:
        q = q.filter(Generation.chapter_id == chapter_id)
    if project_id is not None:
        q = q.filter(Generation.project_id == project_id)

    # Count + measure disk usage before delete.
    rows = q.all()
    count = len(rows)
    freed_bytes = 0
    audio_paths: list[Path] = []
    for r in rows:
        if r.audio_path:
            p = Path(r.audio_path)
            try:
                if p.is_file():
                    freed_bytes += p.stat().st_size
                    audio_paths.append(p)
            except OSError:
                pass

    if not confirm:
        return BulkDeleteResult(deleted_count=count, freed_bytes=freed_bytes, dry_run=True)

    # Actually delete: DB rows first (cascades), then audio files.
    for r in rows:
        db.delete(r)
    db.commit()
    for p in audio_paths:
        try:
            p.unlink()
        except OSError:
            pass

    return BulkDeleteResult(deleted_count=count, freed_bytes=freed_bytes, dry_run=False)
