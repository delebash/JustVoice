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


class RecentTakeRow(BaseModel):
    """A flat row for the History / Recent generations table.

    Mirrors voicebox's HistoryTable shape (when / voice / text preview /
    take / effects / actions). Different from `TakeResponse` above (which
    is the block-scoped take object); this is for the global Generate-view
    history table at the bottom of the page.
    """

    id: str
    when: datetime
    voice: Optional[str] = None
    text: str
    take: Optional[str] = None
    effects: Optional[str] = None
    status: str
    is_favorited: bool = False
    audio_url: Optional[str] = None


class RecentTakesResponse(BaseModel):
    takes: list[RecentTakeRow]


@router.get(
    "/v1/takes/recent",
    response_model=RecentTakesResponse,
    summary="Recent generations across the whole DB — drives Generate's History table",
)
async def list_recent_takes(limit: int = 20, db: Session = Depends(get_db)) -> RecentTakesResponse:
    """Last N generations regardless of block / project, newest first.

    Voicebox parity: matches the History tab feature at
    voicebox/app/src/components/History/HistoryTable.tsx + useHistory.ts.
    Returns a flat row shape so the Generate view's history card and a
    future dedicated History tab can both consume the same payload.
    """
    rows = (
        db.query(Generation)
        .order_by(Generation.created_at.desc())
        .limit(max(1, min(100, limit)))
        .all()
    )
    out: list[RecentTakeRow] = []
    for r in rows:
        # Take label — block_id if present (chapter context), else just the
        # status. Voicebox shows "3 of 7" but that requires lineage which
        # we don't compute here. Leave None for now; #98 will fill this in.
        take_label = None
        out.append(
            RecentTakeRow(
                id=r.id,
                when=r.created_at,
                voice=r.profile_id or None,
                text=(r.text or "")[:120],
                take=take_label,
                effects=None,
                status=r.status,
                is_favorited=bool(r.is_favorited),
                audio_url=f"/v1/generations/{r.id}/audio" if r.audio_path else None,
            )
        )
    return RecentTakesResponse(takes=out)


class LineageNode(BaseModel):
    """One link in a take's source-chain. Walks `Take.source_take_id`
    backward to the original take. UI renders this as a vertical timeline.
    """

    take_id: str
    generation_id: str
    label: Optional[str] = None
    is_default: bool = False
    created_at: datetime
    audio_url: Optional[str] = None
    text_preview: Optional[str] = None


class LineageResponse(BaseModel):
    chain: list[LineageNode]
    block_id: Optional[str] = None


@router.get(
    "/v1/takes/{take_id}/lineage",
    response_model=LineageResponse,
    summary="Walk a take's source chain back to its original (task #98)",
)
async def get_take_lineage(take_id: str, db: Session = Depends(get_db)) -> LineageResponse:
    """Returns the chain of takes ordered oldest → newest.

    A "lineage" is the source_take_id chain: each take points to the take
    it was re-rolled from. The chain ends at the original (source_take_id
    is null). Useful for the take-versioning UI to show "this is the 4th
    iteration of a line that started 2 weeks ago".
    """
    chain: list[LineageNode] = []
    visited: set[str] = set()
    cur_id: Optional[str] = take_id
    block_id: Optional[str] = None
    # Walk backward up to a sane bound — protects against accidental cycles
    # (shouldn't happen given the FK constraint, but defense in depth).
    for _ in range(50):
        if not cur_id or cur_id in visited:
            break
        visited.add(cur_id)
        take = db.query(Take).filter(Take.id == cur_id).first()
        if not take:
            break
        gen = db.query(Generation).filter(Generation.id == take.generation_id).first()
        block_id = take.block_id
        chain.append(
            LineageNode(
                take_id=take.id,
                generation_id=take.generation_id,
                label=take.label,
                is_default=bool(take.is_default),
                created_at=take.created_at,
                audio_url=(f"/v1/generations/{gen.id}/audio" if gen and gen.audio_path else None),
                text_preview=((gen.text or "")[:120] if gen else None),
            )
        )
        cur_id = take.source_take_id
    # Reverse so oldest (root) comes first — easier for UI to render as a top-to-bottom timeline.
    chain.reverse()
    return LineageResponse(chain=chain, block_id=block_id)


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
