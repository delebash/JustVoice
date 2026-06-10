"""/v1/engines/{id}/models — installable model variants + VRAM-aware recommendation."""

from __future__ import annotations

from fastapi import APIRouter

from ..engines.catalog import known_engines
from ..engines.model_catalog import models_for, recommend_for_vram
from ..errors import not_found
from ..models import ModelsListResponse, RecommendedResponse
from ..system_info import detect

router = APIRouter(tags=["engines"])


@router.get("/v1/engines/{id}/models", response_model=ModelsListResponse)
async def list_models(id: str) -> ModelsListResponse:
    if not any(e.id == id for e in known_engines()):
        raise not_found(f"engine {id}")
    return ModelsListResponse(engine_id=id, variants=models_for(id))


@router.get("/v1/engines/{id}/models/recommended", response_model=RecommendedResponse)
async def recommended_models(id: str) -> RecommendedResponse:
    if not any(e.id == id for e in known_engines()):
        raise not_found(f"engine {id}")
    info = detect()
    vram = max((g.vram_mb for g in info.gpus if g.vram_mb), default=None)
    best_fit, fastest, would_oom = recommend_for_vram(id, vram)
    return RecommendedResponse(
        engine_id=id,
        best_fit=best_fit,
        fastest=fastest,
        would_oom=would_oom,
        detected_vram_mb=vram,
    )
