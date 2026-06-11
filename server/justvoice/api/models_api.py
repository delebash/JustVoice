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
    variants = models_for(id)
    # Engines redesign: per-model on-disk flag drives the verb shown
    # (Download vs Load/Delete). HF-cache probe; non-HF urls stay None.
    from ..hf_cache import is_hf_repo_cached, repo_from_url

    for v in variants:
        repo = repo_from_url(v.files[0].url) if v.files else None
        if repo:
            v.on_disk = is_hf_repo_cached(repo)
    return ModelsListResponse(engine_id=id, variants=variants)


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
