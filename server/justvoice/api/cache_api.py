"""/v1/cache/* — stats + clear."""

from __future__ import annotations

from fastapi import APIRouter

from ..app_state import get_state
from ..models import CacheStats

router = APIRouter(tags=["cache"])


@router.get("/v1/cache/stats", response_model=CacheStats)
async def get_stats() -> CacheStats:
    st = get_state()
    cache = getattr(st, "_render_cache", None)
    if cache is None:
        return CacheStats(
            total_entries_on_disk=0,
            total_bytes_on_disk=0,
            memory_entries=0,
            memory_bytes=0,
        )
    return cache.stats()


@router.post("/v1/cache/clear")
async def clear_cache(scope: str | None = None) -> dict:
    st = get_state()
    cache = getattr(st, "_render_cache", None)
    if cache is not None:
        cache.clear(scope)
    return {"cleared": True, "scope": scope}
