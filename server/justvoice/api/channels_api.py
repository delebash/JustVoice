# SPDX-License-Identifier: MIT
"""/v1/channels — audio output channel configs.

Maps a persona to specific OS audio output devices. Use cases: multi-monitor
setups, route certain voices to OBS virtual mic, per-character podcast
monitoring across multiple outputs.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import Channel, PersonaChannel, get_db
from ..errors import not_found


router = APIRouter(tags=["channels"])


class ChannelResponse(BaseModel):
    id: str
    name: str
    is_default: bool
    device_ids: list[str]
    created_at: datetime

    @classmethod
    def from_orm(cls, row: Channel) -> "ChannelResponse":
        return cls(
            id=row.id,
            name=row.name,
            is_default=row.is_default,
            device_ids=json.loads(row.device_ids_json or "[]"),
            created_at=row.created_at,
        )


class ChannelList(BaseModel):
    channels: list[ChannelResponse]


class CreateChannelRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    is_default: bool = False
    device_ids: list[str] = []


class UpdateChannelRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=80)
    is_default: Optional[bool] = None
    device_ids: Optional[list[str]] = None


class PersonaChannels(BaseModel):
    channel_ids: list[str]


@router.get("/v1/channels", response_model=ChannelList)
async def list_channels(db: Session = Depends(get_db)) -> ChannelList:
    rows = db.query(Channel).order_by(Channel.created_at).all()
    return ChannelList(channels=[ChannelResponse.from_orm(r) for r in rows])


@router.post("/v1/channels", response_model=ChannelResponse, status_code=201)
async def create_channel(body: CreateChannelRequest, db: Session = Depends(get_db)) -> ChannelResponse:
    # Only one default at a time.
    if body.is_default:
        db.query(Channel).filter(Channel.is_default == True).update({"is_default": False})  # noqa: E712
    ch = Channel(
        name=body.name,
        is_default=body.is_default,
        device_ids_json=json.dumps(body.device_ids),
    )
    db.add(ch)
    db.commit()
    db.refresh(ch)
    return ChannelResponse.from_orm(ch)


@router.patch("/v1/channels/{channel_id}", response_model=ChannelResponse)
async def update_channel(
    channel_id: str, body: UpdateChannelRequest, db: Session = Depends(get_db)
) -> ChannelResponse:
    ch = db.query(Channel).filter(Channel.id == channel_id).first()
    if not ch:
        raise not_found(f"channel {channel_id}")
    if body.name is not None:
        ch.name = body.name
    if body.is_default is not None:
        if body.is_default:
            db.query(Channel).filter(Channel.is_default == True).update({"is_default": False})  # noqa: E712
        ch.is_default = body.is_default
    if body.device_ids is not None:
        ch.device_ids_json = json.dumps(body.device_ids)
    db.commit()
    db.refresh(ch)
    return ChannelResponse.from_orm(ch)


@router.delete("/v1/channels/{channel_id}")
async def delete_channel(channel_id: str, db: Session = Depends(get_db)) -> dict:
    ch = db.query(Channel).filter(Channel.id == channel_id).first()
    if not ch:
        raise not_found(f"channel {channel_id}")
    db.delete(ch)
    db.commit()
    return {"deleted": True}


@router.get("/v1/personas/{persona_id}/channels", response_model=PersonaChannels)
async def get_persona_channels(persona_id: str, db: Session = Depends(get_db)) -> PersonaChannels:
    rows = db.query(PersonaChannel).filter(PersonaChannel.persona_id == persona_id).all()
    return PersonaChannels(channel_ids=[r.channel_id for r in rows])


@router.put("/v1/personas/{persona_id}/channels", response_model=PersonaChannels)
async def set_persona_channels(
    persona_id: str, body: PersonaChannels, db: Session = Depends(get_db)
) -> PersonaChannels:
    db.query(PersonaChannel).filter(PersonaChannel.persona_id == persona_id).delete()
    for cid in body.channel_ids:
        db.add(PersonaChannel(persona_id=persona_id, channel_id=cid))
    db.commit()
    return body
