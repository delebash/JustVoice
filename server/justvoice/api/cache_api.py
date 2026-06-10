"""/v1/cache/* — stats + clear + recent entries + per-entry delete."""

from __future__ import annotations

from fastapi import APIRouter

from ..app_state import get_state
from ..errors import bad_request, not_found
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
async def clear_cache(
    scope: str | None = None,
    older_than_days: float | None = None,
    voice_id: str | None = None,
    engine: str | None = None,
    favorited: str | None = None,
) -> dict:
    # Cache keys are opaque hashes — the disk layer cannot filter by voice,
    # engine, or favorite status. Reject those filters explicitly instead of
    # silently falling through to a full purge (the bug this guard replaces).
    if voice_id is not None or engine is not None or favorited is not None:
        raise bad_request(
            "Cache entries are keyed by opaque hash; pruning by voice, engine, "
            "or favorite status is not supported. Use scope or older_than_days."
        )
    st = get_state()
    cache = getattr(st, "_render_cache", None)
    if cache is None:
        return {"cleared": True, "scope": scope}
    if older_than_days is not None:
        removed = cache.prune_older_than(older_than_days)
        return {"cleared": True, "older_than_days": older_than_days, "removed": removed}
    cache.clear(scope)
    return {"cleared": True, "scope": scope}


@router.get("/v1/cache/recent")
async def recent_entries(limit: int = 50) -> dict:
    st = get_state()
    cache = getattr(st, "_render_cache", None)
    if cache is None:
        return {"entries": []}
    return {"entries": cache.entries(limit=limit)}


@router.delete("/v1/cache/entries/{entry_id:path}")
async def delete_entry(entry_id: str) -> dict:
    """Delete one cached render. `entry_id` is the `scope/key` pair returned
    by /v1/cache/recent."""
    st = get_state()
    cache = getattr(st, "_render_cache", None)
    if cache is None or "/" not in entry_id:
        raise not_found(f"cache entry {entry_id}")
    scope, _, key = entry_id.partition("/")
    if not cache.delete_entry(scope, key):
        raise not_found(f"cache entry {entry_id}")
    return {"deleted": True, "id": entry_id}
