# SPDX-License-Identifier: GPL-3.0-or-later
"""/v1/profiles — voice-profile CRUD.

The VoiceProfile model has existed in the DB schema since Phase 1.5
(task #56) but had no HTTP surface. JustVoice's UI treats profiles as
the canonical user-facing object (a profile bundles voice + language +
personality + samples + effects + lexicon). This module gives the
frontend a way to actually CRUD them. Includes a /compose stub for the
LLM-backed "write me a fresh in-character line" action — returns 501
until an LLM service is configured in settings.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..database.models import VoiceProfile
from ..errors import bad_request, not_found


router = APIRouter(tags=["profiles"])


class ProfileResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    language: str = "en"
    avatar_path: Optional[str] = None
    voice_type: str = "cloned"
    preset_engine: Optional[str] = None
    preset_voice_id: Optional[str] = None
    design_prompt: Optional[str] = None
    default_engine: Optional[str] = None
    effects_chain: list[dict] = []
    default_lexicon_id: Optional[str] = None
    personality: Optional[str] = None
    generation_count: int = 0
    sample_count: int = 0
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ProfileList(BaseModel):
    profiles: list[ProfileResponse]


class CreateProfileRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    language: str = "en"
    voice_type: str = "cloned"
    preset_engine: Optional[str] = None
    preset_voice_id: Optional[str] = None
    design_prompt: Optional[str] = None
    default_engine: Optional[str] = None
    effects_chain: Optional[list[dict]] = None
    default_lexicon_id: Optional[str] = None
    personality: Optional[str] = Field(None, max_length=2000)


class UpdateProfileRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    language: Optional[str] = None
    voice_type: Optional[str] = None
    preset_engine: Optional[str] = None
    preset_voice_id: Optional[str] = None
    design_prompt: Optional[str] = None
    default_engine: Optional[str] = None
    effects_chain: Optional[list[dict]] = None
    default_lexicon_id: Optional[str] = None
    personality: Optional[str] = Field(None, max_length=2000)


class ComposeResponse(BaseModel):
    text: str
    profile_id: str
    note: Optional[str] = None  # diagnostic note if compose was stubbed


def _to_response(p: VoiceProfile) -> ProfileResponse:
    effects = []
    if p.effects_chain:
        try:
            effects = json.loads(p.effects_chain)
        except (json.JSONDecodeError, TypeError):
            effects = []
    return ProfileResponse(
        id=p.id,
        name=p.name,
        description=p.description,
        language=p.language or "en",
        avatar_path=p.avatar_path,
        voice_type=p.voice_type,
        preset_engine=p.preset_engine,
        preset_voice_id=p.preset_voice_id,
        design_prompt=p.design_prompt,
        default_engine=p.default_engine,
        effects_chain=effects,
        default_lexicon_id=p.default_lexicon_id,
        personality=p.personality,
        generation_count=p.generation_count,
        sample_count=p.sample_count,
        created_at=p.created_at,
        updated_at=p.updated_at,
    )


@router.get("/v1/profiles", response_model=ProfileList, summary="List voice profiles")
async def list_profiles(db: Session = Depends(get_db)) -> ProfileList:
    rows = db.query(VoiceProfile).order_by(VoiceProfile.created_at.desc()).all()
    return ProfileList(profiles=[_to_response(r) for r in rows])


@router.get("/v1/profiles/{profile_id}", response_model=ProfileResponse)
async def get_profile(profile_id: str, db: Session = Depends(get_db)) -> ProfileResponse:
    p = db.query(VoiceProfile).filter(VoiceProfile.id == profile_id).first()
    if not p:
        raise not_found(f"profile {profile_id}")
    return _to_response(p)


@router.post(
    "/v1/profiles",
    response_model=ProfileResponse,
    status_code=201,
    summary="Create a voice profile",
)
async def create_profile(
    body: CreateProfileRequest, db: Session = Depends(get_db)
) -> ProfileResponse:
    existing = db.query(VoiceProfile).filter(VoiceProfile.name == body.name).first()
    if existing:
        raise bad_request(f"profile name {body.name!r} already exists")
    p = VoiceProfile(
        name=body.name,
        description=body.description,
        language=body.language,
        voice_type=body.voice_type,
        preset_engine=body.preset_engine,
        preset_voice_id=body.preset_voice_id,
        design_prompt=body.design_prompt,
        default_engine=body.default_engine,
        effects_chain=json.dumps(body.effects_chain) if body.effects_chain else None,
        default_lexicon_id=body.default_lexicon_id,
        personality=body.personality,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return _to_response(p)


@router.patch("/v1/profiles/{profile_id}", response_model=ProfileResponse)
async def update_profile(
    profile_id: str, body: UpdateProfileRequest, db: Session = Depends(get_db)
) -> ProfileResponse:
    p = db.query(VoiceProfile).filter(VoiceProfile.id == profile_id).first()
    if not p:
        raise not_found(f"profile {profile_id}")
    # Only update fields explicitly set (model_dump exclude_unset)
    updates = body.model_dump(exclude_unset=True)
    if "name" in updates:
        clash = (
            db.query(VoiceProfile)
            .filter(VoiceProfile.name == updates["name"], VoiceProfile.id != profile_id)
            .first()
        )
        if clash:
            raise bad_request(f"profile name {updates['name']!r} already exists")
    if "effects_chain" in updates:
        ec = updates.pop("effects_chain")
        p.effects_chain = json.dumps(ec) if ec else None
    for k, v in updates.items():
        setattr(p, k, v)
    db.commit()
    db.refresh(p)
    return _to_response(p)


@router.delete("/v1/profiles/{profile_id}")
async def delete_profile(profile_id: str, db: Session = Depends(get_db)) -> dict:
    p = db.query(VoiceProfile).filter(VoiceProfile.id == profile_id).first()
    if not p:
        raise not_found(f"profile {profile_id}")
    db.delete(p)
    db.commit()
    return {"deleted": True}


@router.post(
    "/v1/profiles/{profile_id}/compose",
    response_model=ComposeResponse,
    summary="Generate a fresh in-character line via LLM",
)
async def compose_with_personality(
    profile_id: str, db: Session = Depends(get_db)
) -> ComposeResponse:
    """LLM-fills a line of dialogue in the profile's personality voice.

    Drives the Compose button in the Generate view's floating bar (✨ icon,
    only shown when profile.personality is non-empty).

    Currently STUBBED — JustVoice does not yet have an LLM service wired.
    Returns a 501-equivalent ComposeResponse with a diagnostic `note` so
    the UI can render a useful "LLM not configured" message instead of
    a generic 500. Wire an OpenAI-compatible client in settings to activate.
    """
    p = db.query(VoiceProfile).filter(VoiceProfile.id == profile_id).first()
    if not p:
        raise not_found(f"profile {profile_id}")
    if not (p.personality and p.personality.strip()):
        raise bad_request(
            f"profile {profile_id} has no personality prompt — set one to enable Compose"
        )
    raise HTTPException(
        status_code=501,
        detail=(
            "LLM service not configured. Add an OpenAI-compatible endpoint to "
            "settings.llm to enable the Compose action. Profile personality is set."
        ),
    )
