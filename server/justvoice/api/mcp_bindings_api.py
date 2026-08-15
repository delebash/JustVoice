# SPDX-License-Identifier: MIT
"""/v1/mcp/bindings — per-client MCP voice + defaults binding.

When an Unreal editor / Claude / Cursor calls `justvoice.speak` without
specifying a voice, the per-client binding's defaults apply. Critical for
the "Unreal NPCs always use Chatterbox + persona" config.

After Slice 4 of the Profile-kill rollout the binding points at a Persona
rather than a (now-dead) VoiceProfile.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import MCPBinding, get_db
from ..errors import not_found


router = APIRouter(tags=["mcp"])


class MCPBindingResponse(BaseModel):
    client_id: str
    label: Optional[str]
    persona_id: Optional[str]
    default_engine: Optional[str]
    last_seen_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class MCPBindingList(BaseModel):
    bindings: list[MCPBindingResponse]


class UpsertMCPBindingRequest(BaseModel):
    client_id: str = Field(..., min_length=1, max_length=80)
    label: Optional[str] = None
    persona_id: Optional[str] = None
    default_engine: Optional[str] = None


@router.get("/v1/mcp/bindings", response_model=MCPBindingList)
async def list_mcp_bindings(db: Session = Depends(get_db)) -> MCPBindingList:
    rows = db.query(MCPBinding).order_by(MCPBinding.created_at).all()
    return MCPBindingList(bindings=[MCPBindingResponse.model_validate(r) for r in rows])


@router.post("/v1/mcp/bindings", response_model=MCPBindingResponse)
async def upsert_mcp_binding(
    body: UpsertMCPBindingRequest, db: Session = Depends(get_db)
) -> MCPBindingResponse:
    existing = db.query(MCPBinding).filter(MCPBinding.client_id == body.client_id).first()
    if existing:
        existing.label = body.label
        existing.persona_id = body.persona_id
        existing.default_engine = body.default_engine
        db.commit()
        db.refresh(existing)
        return MCPBindingResponse.model_validate(existing)
    binding = MCPBinding(
        client_id=body.client_id,
        label=body.label,
        persona_id=body.persona_id,
        default_engine=body.default_engine,
    )
    db.add(binding)
    db.commit()
    db.refresh(binding)
    return MCPBindingResponse.model_validate(binding)


@router.delete("/v1/mcp/bindings/{client_id}")
async def delete_mcp_binding(client_id: str, db: Session = Depends(get_db)) -> dict:
    binding = db.query(MCPBinding).filter(MCPBinding.client_id == client_id).first()
    if not binding:
        raise not_found(f"mcp binding {client_id}")
    db.delete(binding)
    db.commit()
    return {"deleted": True}
