# SPDX-License-Identifier: GPL-3.0-or-later
"""/v1/stories — multi-track timeline CRUD.

Backed by the Story + StoryItem tables that have existed since the
Phase 1.5 SQLite migration but had no HTTP surface (StoriesView errored
on every load). v1 scope: list / create / get / delete + item listing.
Clip arrangement (move / trim / volume) lands with the interactive
timeline editor.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..database.models import Generation, Story, StoryItem
from ..errors import not_found

router = APIRouter(tags=["stories"])


class StoryItemResponse(BaseModel):
    id: str
    generation_id: Optional[str]
    track: int
    start_time_ms: int
    trim_start_ms: int
    trim_end_ms: int
    volume: float
    duration: Optional[float]
    text: Optional[str] = None

    class Config:
        from_attributes = True


class StoryResponse(BaseModel):
    id: str
    project_id: Optional[str]
    name: str
    description: Optional[str]
    created_at: datetime
    items: list[StoryItemResponse] = []


class StoryList(BaseModel):
    stories: list[StoryResponse]


class CreateStoryRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    project_id: Optional[str] = None


def _story_response(db: Session, story: Story) -> StoryResponse:
    rows = (
        db.query(StoryItem)
        .filter(StoryItem.story_id == story.id)
        .order_by(StoryItem.track, StoryItem.start_time_ms)
        .all()
    )
    items: list[StoryItemResponse] = []
    for r in rows:
        item = StoryItemResponse.model_validate(r)
        if r.generation_id:
            gen = db.query(Generation).filter(Generation.id == r.generation_id).first()
            if gen:
                item.text = (gen.text or "")[:120]
        items.append(item)
    return StoryResponse(
        id=story.id,
        project_id=story.project_id,
        name=story.name,
        description=story.description,
        created_at=story.created_at,
        items=items,
    )


@router.get("/v1/stories", response_model=StoryList)
async def list_stories(db: Session = Depends(get_db)) -> StoryList:
    rows = db.query(Story).order_by(Story.created_at.desc()).all()
    return StoryList(stories=[_story_response(db, s) for s in rows])


@router.post("/v1/stories", response_model=StoryResponse)
async def create_story(
    body: CreateStoryRequest, db: Session = Depends(get_db)
) -> StoryResponse:
    story = Story(name=body.name, description=body.description, project_id=body.project_id)
    db.add(story)
    db.commit()
    db.refresh(story)
    return _story_response(db, story)


@router.get("/v1/stories/{story_id}", response_model=StoryResponse)
async def get_story(story_id: str, db: Session = Depends(get_db)) -> StoryResponse:
    story = db.query(Story).filter(Story.id == story_id).first()
    if not story:
        raise not_found(f"story {story_id}")
    return _story_response(db, story)


@router.delete("/v1/stories/{story_id}")
async def delete_story(story_id: str, db: Session = Depends(get_db)) -> dict:
    story = db.query(Story).filter(Story.id == story_id).first()
    if not story:
        raise not_found(f"story {story_id}")
    db.delete(story)
    db.commit()
    return {"deleted": True, "id": story_id}
