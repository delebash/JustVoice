# SPDX-License-Identifier: GPL-3.0-or-later
"""/v1/effect-presets — saved pedalboard chains the user can apply
to a Persona's effects_chain from the EffectsChainEditorModal.

Slice 7 of the Profile-kill plan / Effects v1 wiring. Pairs with the
render-time effects pipeline at server/justvoice/audio/effects.py.

A preset is just a named chain + sort order + optional description.
The /catalog endpoint exposes the 11 supported effect types so the
modal can render the right parameter form per effect.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import EffectPreset, get_db
from ..errors import bad_request, not_found


router = APIRouter(tags=["effects"])


# ── Effect type catalog ──────────────────────────────────────────────────


class EffectParam(BaseModel):
    key: str
    label: str
    type: str  # "number" | "boolean"
    default: float | bool
    min: float | None = None
    max: float | None = None
    step: float | None = None


class EffectType(BaseModel):
    type: str
    label: str
    description: str
    params: list[EffectParam]


# Mirrors server/justvoice/audio/effects.py:_build_plugins. Per-effect
# parameter schemas drive the modal's input rendering.
EFFECT_CATALOG: list[EffectType] = [
    EffectType(
        type="reverb",
        label="Reverb",
        description="Space simulation — room, hall, cathedral.",
        params=[
            EffectParam(key="room_size", label="Room size", type="number", default=0.5, min=0.0, max=1.0, step=0.05),
            EffectParam(key="damping", label="Damping", type="number", default=0.5, min=0.0, max=1.0, step=0.05),
            EffectParam(key="wet_level", label="Wet", type="number", default=0.33, min=0.0, max=1.0, step=0.05),
            EffectParam(key="dry_level", label="Dry", type="number", default=0.4, min=0.0, max=1.0, step=0.05),
            EffectParam(key="width", label="Width", type="number", default=1.0, min=0.0, max=1.0, step=0.05),
        ],
    ),
    EffectType(
        type="distortion",
        label="Distortion",
        description="Asymmetric saturation — drive in dB.",
        params=[
            EffectParam(key="drive_db", label="Drive (dB)", type="number", default=25.0, min=0.0, max=60.0, step=1.0),
        ],
    ),
    EffectType(
        type="gain",
        label="Gain",
        description="Linear level adjust in dB. Use negative for cut.",
        params=[
            EffectParam(key="gain_db", label="Gain (dB)", type="number", default=0.0, min=-24.0, max=24.0, step=0.5),
        ],
    ),
    EffectType(
        type="compressor",
        label="Compressor",
        description="Reduces dynamic range — broadcast / podcast staple.",
        params=[
            EffectParam(key="threshold_db", label="Threshold (dB)", type="number", default=-16.0, min=-60.0, max=0.0, step=1.0),
            EffectParam(key="ratio", label="Ratio", type="number", default=2.5, min=1.0, max=20.0, step=0.1),
            EffectParam(key="attack_ms", label="Attack (ms)", type="number", default=1.0, min=0.1, max=200.0, step=0.5),
            EffectParam(key="release_ms", label="Release (ms)", type="number", default=100.0, min=10.0, max=2000.0, step=10.0),
        ],
    ),
    EffectType(
        type="pitch_shift",
        label="Pitch shift",
        description="Re-pitch in semitones. Wide ranges introduce artefacts.",
        params=[
            EffectParam(key="semitones", label="Semitones", type="number", default=0.0, min=-12.0, max=12.0, step=0.5),
        ],
    ),
    EffectType(
        type="delay",
        label="Delay",
        description="Echo with feedback.",
        params=[
            EffectParam(key="delay_seconds", label="Delay (s)", type="number", default=0.5, min=0.0, max=4.0, step=0.05),
            EffectParam(key="feedback", label="Feedback", type="number", default=0.0, min=0.0, max=1.0, step=0.05),
            EffectParam(key="mix", label="Mix", type="number", default=0.5, min=0.0, max=1.0, step=0.05),
        ],
    ),
    EffectType(
        type="highpass",
        label="High-pass",
        description="Cut below cutoff frequency.",
        params=[
            EffectParam(key="cutoff_frequency_hz", label="Cutoff (Hz)", type="number", default=80.0, min=20.0, max=2000.0, step=10.0),
        ],
    ),
    EffectType(
        type="lowpass",
        label="Low-pass",
        description="Cut above cutoff frequency.",
        params=[
            EffectParam(key="cutoff_frequency_hz", label="Cutoff (Hz)", type="number", default=12000.0, min=500.0, max=20000.0, step=100.0),
        ],
    ),
    EffectType(
        type="eq_low",
        label="EQ — Low shelf",
        description="Boost or cut below cutoff with shelf curve.",
        params=[
            EffectParam(key="cutoff_frequency_hz", label="Cutoff (Hz)", type="number", default=120.0, min=20.0, max=500.0, step=10.0),
            EffectParam(key="gain_db", label="Gain (dB)", type="number", default=0.0, min=-12.0, max=12.0, step=0.5),
            EffectParam(key="q", label="Q", type="number", default=0.7, min=0.1, max=4.0, step=0.1),
        ],
    ),
    EffectType(
        type="eq_mid",
        label="EQ — Mid peak",
        description="Boost or cut around centre frequency.",
        params=[
            EffectParam(key="cutoff_frequency_hz", label="Centre (Hz)", type="number", default=1000.0, min=100.0, max=8000.0, step=50.0),
            EffectParam(key="gain_db", label="Gain (dB)", type="number", default=0.0, min=-12.0, max=12.0, step=0.5),
            EffectParam(key="q", label="Q", type="number", default=1.0, min=0.1, max=4.0, step=0.1),
        ],
    ),
    EffectType(
        type="eq_high",
        label="EQ — High shelf",
        description="Boost or cut above cutoff with shelf curve.",
        params=[
            EffectParam(key="cutoff_frequency_hz", label="Cutoff (Hz)", type="number", default=4000.0, min=1000.0, max=12000.0, step=100.0),
            EffectParam(key="gain_db", label="Gain (dB)", type="number", default=0.0, min=-12.0, max=12.0, step=0.5),
            EffectParam(key="q", label="Q", type="number", default=0.7, min=0.1, max=4.0, step=0.1),
        ],
    ),
]


class EffectCatalogResponse(BaseModel):
    effects: list[EffectType]


@router.get("/v1/effects/catalog", response_model=EffectCatalogResponse)
async def effect_catalog() -> EffectCatalogResponse:
    """Return the 11 supported effect types + their parameter schemas
    for the EffectsChainEditorModal."""
    return EffectCatalogResponse(effects=EFFECT_CATALOG)


# ── Effect-chain presets (saved chains) ──────────────────────────────────


class EffectPresetResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    chain: list[dict]
    is_builtin: bool
    sort_order: int
    created_at: datetime

    @classmethod
    def from_orm(cls, row: EffectPreset) -> "EffectPresetResponse":
        try:
            chain = json.loads(row.chain_json or "[]")
        except (json.JSONDecodeError, TypeError):
            chain = []
        if not isinstance(chain, list):
            chain = []
        return cls(
            id=row.id,
            name=row.name,
            description=row.description,
            chain=chain,
            is_builtin=row.is_builtin,
            sort_order=row.sort_order,
            created_at=row.created_at,
        )


class EffectPresetList(BaseModel):
    presets: list[EffectPresetResponse]


class CreateEffectPresetRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    description: Optional[str] = Field(None, max_length=400)
    chain: list[dict] = Field(default_factory=list)
    sort_order: int = 100


class UpdateEffectPresetRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=80)
    description: Optional[str] = Field(None, max_length=400)
    chain: Optional[list[dict]] = None
    sort_order: Optional[int] = None


@router.get("/v1/effect-presets", response_model=EffectPresetList)
async def list_effect_presets(db: Session = Depends(get_db)) -> EffectPresetList:
    rows = db.query(EffectPreset).order_by(EffectPreset.sort_order, EffectPreset.created_at).all()
    return EffectPresetList(presets=[EffectPresetResponse.from_orm(r) for r in rows])


@router.post("/v1/effect-presets", response_model=EffectPresetResponse, status_code=201)
async def create_effect_preset(
    body: CreateEffectPresetRequest, db: Session = Depends(get_db)
) -> EffectPresetResponse:
    existing = db.query(EffectPreset).filter(EffectPreset.name == body.name).first()
    if existing:
        raise bad_request(f"effect preset name {body.name!r} already exists")
    p = EffectPreset(
        name=body.name,
        description=body.description,
        chain_json=json.dumps(body.chain),
        is_builtin=False,
        sort_order=body.sort_order,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return EffectPresetResponse.from_orm(p)


@router.patch("/v1/effect-presets/{preset_id}", response_model=EffectPresetResponse)
async def update_effect_preset(
    preset_id: str, body: UpdateEffectPresetRequest, db: Session = Depends(get_db)
) -> EffectPresetResponse:
    p = db.query(EffectPreset).filter(EffectPreset.id == preset_id).first()
    if not p:
        raise not_found(f"effect preset {preset_id}")
    if p.is_builtin:
        raise bad_request("built-in effect presets are read-only — duplicate and edit instead")
    if body.name is not None:
        clash = (
            db.query(EffectPreset)
            .filter(EffectPreset.name == body.name, EffectPreset.id != preset_id)
            .first()
        )
        if clash:
            raise bad_request(f"effect preset name {body.name!r} already exists")
        p.name = body.name
    if body.description is not None:
        p.description = body.description
    if body.chain is not None:
        p.chain_json = json.dumps(body.chain)
    if body.sort_order is not None:
        p.sort_order = body.sort_order
    db.commit()
    db.refresh(p)
    return EffectPresetResponse.from_orm(p)


@router.delete("/v1/effect-presets/{preset_id}")
async def delete_effect_preset(preset_id: str, db: Session = Depends(get_db)) -> dict:
    p = db.query(EffectPreset).filter(EffectPreset.id == preset_id).first()
    if not p:
        raise not_found(f"effect preset {preset_id}")
    if p.is_builtin:
        raise bad_request("built-in effect presets cannot be deleted")
    db.delete(p)
    db.commit()
    return {"deleted": True}
