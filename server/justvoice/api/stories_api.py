# SPDX-License-Identifier: GPL-3.0-or-later
"""/v1/stories — multi-track timeline list + create.

Backs the Stories view's sidebar (list / search / + New). Timeline item
editing (clip placement, trim, volume) lands with the Stories editor
work; for now items are returned read-only so the timeline can render
existing rows.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..database.models import Story, StoryItem
from ..errors import bad_request

router = APIRouter(tags=["stories"])


class StoryItemRow(BaseModel):
    id: str
    generation_id: Optional[str] = None
    track: int
    start_time_ms: int
    trim_start_ms: int
    trim_end_ms: int
    volume: float
    duration: Optional[float] = None


class StoryRow(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    project_id: Optional[str] = None
    created_at: datetime
    items: list[StoryItemRow] = []


class StoriesResponse(BaseModel):
    stories: list[StoryRow]


class StoryCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    project_id: Optional[str] = None


def _row(story: Story, items: list[StoryItem]) -> StoryRow:
    return StoryRow(
        id=story.id,
        name=story.name,
        description=story.description,
        project_id=story.project_id,
        created_at=story.created_at,
        items=[
            StoryItemRow(
                id=i.id,
                generation_id=i.generation_id,
                track=i.track,
                start_time_ms=i.start_time_ms,
                trim_start_ms=i.trim_start_ms,
                trim_end_ms=i.trim_end_ms,
                volume=i.volume,
                duration=i.duration,
            )
            for i in items
        ],
    )


@router.get("/v1/stories", response_model=StoriesResponse, summary="List stories with timeline items")
async def list_stories(db: Session = Depends(get_db)) -> StoriesResponse:
    stories = db.query(Story).order_by(Story.created_at.desc()).all()
    out: list[StoryRow] = []
    for s in stories:
        items = (
            db.query(StoryItem)
            .filter(StoryItem.story_id == s.id)
            .order_by(StoryItem.track, StoryItem.start_time_ms)
            .all()
        )
        out.append(_row(s, items))
    return StoriesResponse(stories=out)


@router.post("/v1/stories", response_model=StoryRow, summary="Create an empty story")
async def create_story(body: StoryCreateRequest, db: Session = Depends(get_db)) -> StoryRow:
    name = (body.name or "").strip()
    if not name:
        raise bad_request("story name must not be empty")
    story = Story(name=name, description=body.description, project_id=body.project_id)
    db.add(story)
    db.commit()
    db.refresh(story)
    return _row(story, [])
