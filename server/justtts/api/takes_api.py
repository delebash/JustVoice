# SPDX-License-Identifier: GPL-3.0-or-later
"""/v1/takes — per-block take versioning for the audiobook re-roll workflow.

Voicebox versions WHOLE generations; we version per-block so re-rendering
paragraph 47 doesn't invalidate paragraph 48.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import Take, get_db
from ..database.models import Generation
from ..errors import not_found, bad_request


router = APIRouter(tags=["takes"])


class TakeResponse(BaseModel):
    id: str
    block_id: str
    generation_id: str
    source_take_id: Optional[str]
    is_default: bool
    label: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class TakeList(BaseModel):
    takes: list[TakeResponse]
    default_take_id: Optional[str]


class UpdateTakeRequest(BaseModel):
    label: Optional[str] = None


@router.get("/v1/takes/by_block/{block_id}", response_model=TakeList)
async def list_takes_for_block(block_id: str, db: Session = Depends(get_db)) -> TakeList:
    rows = (
        db.query(Take)
        .filter(Take.block_id == block_id)
        .order_by(Take.created_at.desc())
        .all()
    )
    default = next((r.id for r in rows if r.is_default), None)
    return TakeList(takes=[TakeResponse.model_validate(r) for r in rows], default_take_id=default)


@router.post("/v1/takes/{take_id}/set_default", response_model=TakeResponse)
async def set_default_take(take_id: str, db: Session = Depends(get_db)) -> TakeResponse:
    take = db.query(Take).filter(Take.id == take_id).first()
    if not take:
        raise not_found(f"take {take_id}")
    # Clear other defaults for the same block, then mark this one.
    db.query(Take).filter(Take.block_id == take.block_id, Take.is_default == True).update(  # noqa: E712
        {"is_default": False}
    )
    take.is_default = True
    db.commit()
    db.refresh(take)
    return TakeResponse.model_validate(take)


@router.patch("/v1/takes/{take_id}", response_model=TakeResponse)
async def update_take(take_id: str, body: UpdateTakeRequest, db: Session = Depends(get_db)) -> TakeResponse:
    take = db.query(Take).filter(Take.id == take_id).first()
    if not take:
        raise not_found(f"take {take_id}")
    if body.label is not None:
        take.label = body.label
    db.commit()
    db.refresh(take)
    return TakeResponse.model_validate(take)


@router.delete("/v1/takes/{take_id}")
async def delete_take(take_id: str, db: Session = Depends(get_db)) -> dict:
    take = db.query(Take).filter(Take.id == take_id).first()
    if not take:
        raise not_found(f"take {take_id}")
    if take.is_default:
        raise bad_request("Cannot delete the default take; promote another take first.")
    db.delete(take)
    db.commit()
    return {"deleted": True}


@router.get(
    "/v1/generations/{generation_id}/audio",
    summary="Stream the WAV for a completed generation",
    responses={200: {"content": {"audio/wav": {}}}},
)
async def get_generation_audio(generation_id: str, db: Session = Depends(get_db)) -> FileResponse:
    """Return the audio file for a generation by its ID.

    Used by the take-versioning UI to play back individual takes without
    re-rendering. Only works for generations that have an audio_path on disk.
    """
    gen = db.query(Generation).filter(Generation.id == generation_id).first()
    if not gen:
        raise not_found(f"generation {generation_id}")
    if not gen.audio_path:
        raise bad_request("generation has no audio on disk (status may not be 'completed')")
    p = Path(gen.audio_path)
    if not p.is_file():
        raise not_found(f"audio file missing from disk: {gen.audio_path}")
    return FileResponse(
        path=str(p),
        media_type="audio/wav",
        filename=f"{generation_id}.wav",
    )
