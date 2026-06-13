# SPDX-License-Identifier: GPL-3.0-or-later
"""/v1/captures — dictation / system-audio recording list.

Backs the Captures view's history table and the Overview dashboard's
capture count. Rows are written by the capture pipeline (Tauri hotkey →
Whisper → refinement); this API is read-only list for now.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..database.models import Capture

router = APIRouter(tags=["captures"])


class CaptureRow(BaseModel):
    id: str
    audio_path: str
    source: str
    language: Optional[str] = None
    duration_ms: Optional[int] = None
    transcript: Optional[str] = None
    raw_transcript: Optional[str] = None
    created_at: datetime


class CapturesResponse(BaseModel):
    captures: list[CaptureRow]
    total: int


@router.get("/v1/captures", response_model=CapturesResponse, summary="List captures, newest first")
async def list_captures(limit: int = 50, db: Session = Depends(get_db)) -> CapturesResponse:
    total = db.query(Capture).count()
    rows = (
        db.query(Capture)
        .order_by(Capture.created_at.desc())
        .limit(max(1, min(500, limit)))
        .all()
    )
    return CapturesResponse(
        captures=[
            CaptureRow(
                id=r.id,
                audio_path=r.audio_path,
                source=r.source,
                language=r.language,
                duration_ms=r.duration_ms,
                transcript=r.transcript,
                raw_transcript=r.raw_transcript,
                created_at=r.created_at,
            )
            for r in rows
        ],
        total=total,
    )
