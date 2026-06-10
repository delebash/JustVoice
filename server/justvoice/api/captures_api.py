# SPDX-License-Identifier: GPL-3.0-or-later
"""/v1/captures — dictation / recording history.

Backed by the Capture table from the Phase 1.5 SQLite migration. The
capture *pipeline* (mic → Whisper → LLM refine) is desktop-side and
still in progress; this surface lets the Captures tab list, inspect,
and delete whatever rows exist instead of erroring on every load.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..database.models import Capture
from ..errors import not_found

router = APIRouter(tags=["captures"])


class CaptureResponse(BaseModel):
    id: str
    audio_path: str
    source: str
    language: Optional[str]
    duration_ms: Optional[int]
    transcript: Optional[str]
    raw_transcript: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class CaptureList(BaseModel):
    captures: list[CaptureResponse]
    total: int


@router.get("/v1/captures", response_model=CaptureList)
async def list_captures(limit: int = 100, db: Session = Depends(get_db)) -> CaptureList:
    total = db.query(Capture).count()
    rows = (
        db.query(Capture)
        .order_by(Capture.created_at.desc())
        .limit(max(1, min(500, limit)))
        .all()
    )
    return CaptureList(
        captures=[CaptureResponse.model_validate(r) for r in rows], total=total
    )


@router.delete("/v1/captures/{capture_id}")
async def delete_capture(capture_id: str, db: Session = Depends(get_db)) -> dict:
    row = db.query(Capture).filter(Capture.id == capture_id).first()
    if not row:
        raise not_found(f"capture {capture_id}")
    db.delete(row)
    db.commit()
    return {"deleted": True, "id": capture_id}
