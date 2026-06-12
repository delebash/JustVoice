# SPDX-License-Identifier: GPL-3.0-or-later
"""/v1/presets — named bundles of voice + delivery + master target + lexicons.

Lets the audiobook producer lock ACX consistency across 30 chapters,
or the game-dev lock per-character reproducibility across 200 NPCs.
ACX rejects books for mastering inconsistency between chapters — this
endpoint prevents that class of error.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Optional, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import Persona, RenderPreset, get_db
from ..errors import not_found, conflict, bad_request


router = APIRouter(tags=["presets"])


MasterTarget = Literal["acx", "inaudio", "podcast", "youtube", "none"]


class RenderPresetResponse(BaseModel):
    id: str
    name: str
    project_id: Optional[str]
    # Optional persona binding — null means "delivery-only style", the
    # block/request supplies the voice at render time.
    voice_id: Optional[str]
    is_builtin: bool = False
    delivery: dict
    effects_chain: list[dict]
    master: Optional[MasterTarget]
    lexicons: list[str]
    seed: Optional[int]
    cache_scope: str
    description: Optional[str]
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_orm(cls, row: RenderPreset) -> "RenderPresetResponse":
        chain_raw = row.effects_chain
        try:
            chain = json.loads(chain_raw) if chain_raw else []
            if not isinstance(chain, list):
                chain = []
        except (json.JSONDecodeError, TypeError):
            chain = []
        return cls(
            id=row.id,
            name=row.name,
            project_id=row.project_id,
            voice_id=row.voice_id,
            is_builtin=bool(row.is_builtin),
            delivery=json.loads(row.delivery_json or "{}"),
            effects_chain=chain,
            master=row.master,  # type: ignore
            lexicons=json.loads(row.lexicons_json or "[]"),
            seed=row.seed,
            cache_scope=row.cache_scope,
            description=row.description,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )


class RenderPresetList(BaseModel):
    presets: list[RenderPresetResponse]


class CreateRenderPresetRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    voice_id: Optional[str] = None
    delivery: dict = Field(default_factory=dict)
    effects_chain: list[dict] = Field(default_factory=list)
    master: Optional[MasterTarget] = None
    lexicons: list[str] = []
    seed: Optional[int] = None
    cache_scope: str = "default"
    project_id: Optional[str] = None
    description: Optional[str] = None


class UpdateRenderPresetRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    voice_id: Optional[str] = None
    delivery: Optional[dict] = None
    effects_chain: Optional[list[dict]] = None
    master: Optional[MasterTarget] = None
    lexicons: Optional[list[str]] = None
    seed: Optional[int] = None
    cache_scope: Optional[str] = None
    description: Optional[str] = None


def _check_voice(voice_id: Optional[str], db: Session) -> None:
    """Friendly 400 instead of a raw FOREIGN KEY IntegrityError 500
    (user-hit 2026-06-12 — persona file-store/DB split-brain made the UI
    send a persona id the personas table didn't have)."""
    if not voice_id:
        return
    if not db.query(Persona).filter(Persona.id == voice_id).first():
        raise bad_request(
            f"voice_id {voice_id!r} is not a known persona — "
            "leave it empty for a delivery-only preset"
        )


@router.get("/v1/presets", response_model=RenderPresetList)
async def list_presets(
    project_id: Optional[str] = None, db: Session = Depends(get_db)
) -> RenderPresetList:
    q = db.query(RenderPreset)
    if project_id is not None:
        # project_id="" means global presets (null in DB).
        q = q.filter(RenderPreset.project_id == (project_id or None))
    rows = q.order_by(RenderPreset.created_at).all()
    return RenderPresetList(presets=[RenderPresetResponse.from_orm(r) for r in rows])


@router.post("/v1/presets", response_model=RenderPresetResponse, status_code=201)
async def create_preset(
    body: CreateRenderPresetRequest, db: Session = Depends(get_db)
) -> RenderPresetResponse:
    # Unique (project_id, name) — enforce app-side too (the DB index is
    # belt-and-suspenders).
    existing = (
        db.query(RenderPreset)
        .filter(RenderPreset.project_id == body.project_id, RenderPreset.name == body.name)
        .first()
    )
    if existing:
        scope = f"project {body.project_id}" if body.project_id else "global"
        raise conflict(f"preset name '{body.name}' already exists in {scope}")
    _check_voice(body.voice_id, db)
    preset = RenderPreset(
        name=body.name,
        project_id=body.project_id,
        voice_id=body.voice_id or None,
        delivery_json=json.dumps(body.delivery),
        effects_chain=json.dumps(body.effects_chain) if body.effects_chain else None,
        master=body.master,
        lexicons_json=json.dumps(body.lexicons),
        seed=body.seed,
        cache_scope=body.cache_scope,
        description=body.description,
    )
    db.add(preset)
    db.commit()
    db.refresh(preset)
    return RenderPresetResponse.from_orm(preset)


@router.patch("/v1/presets/{preset_id}", response_model=RenderPresetResponse)
async def update_preset(
    preset_id: str, body: UpdateRenderPresetRequest, db: Session = Depends(get_db)
) -> RenderPresetResponse:
    preset = db.query(RenderPreset).filter(RenderPreset.id == preset_id).first()
    if not preset:
        raise not_found(f"preset {preset_id}")
    if body.name is not None:
        preset.name = body.name
    if body.voice_id is not None:
        # "" clears the binding back to delivery-only (JSON null means
        # "field not sent" in the PATCH shape, so empty-string is the
        # explicit clear signal).
        _check_voice(body.voice_id, db)
        preset.voice_id = body.voice_id or None
    if body.delivery is not None:
        preset.delivery_json = json.dumps(body.delivery)
    if body.effects_chain is not None:
        preset.effects_chain = json.dumps(body.effects_chain) if body.effects_chain else None
    if body.master is not None:
        preset.master = body.master
    if body.lexicons is not None:
        preset.lexicons_json = json.dumps(body.lexicons)
    if body.seed is not None:
        preset.seed = body.seed
    if body.cache_scope is not None:
        preset.cache_scope = body.cache_scope
    if body.description is not None:
        preset.description = body.description
    db.commit()
    db.refresh(preset)
    return RenderPresetResponse.from_orm(preset)


@router.delete("/v1/presets/{preset_id}")
async def delete_preset(preset_id: str, db: Session = Depends(get_db)) -> dict:
    preset = db.query(RenderPreset).filter(RenderPreset.id == preset_id).first()
    if not preset:
        raise not_found(f"preset {preset_id}")
    db.delete(preset)
    db.commit()
    return {"deleted": True}


def resolve_preset(preset_id: str, db: Session) -> RenderPreset:
    """Helper for /v1/generate to expand preset_id into render params."""
    preset = db.query(RenderPreset).filter(RenderPreset.id == preset_id).first()
    if not preset:
        raise not_found(f"preset {preset_id}")
    return preset
