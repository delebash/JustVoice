"""/v1/cache/* — stats + clear + recent entries."""

from __future__ import annotations


from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..app_state import get_state
from ..database.models import Generation
from ..database.session import get_db
from ..errors import bad_request
from ..media_paths import media_file
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
    """Clear cached renders, optionally limited by scope and/or age.

    Cache entries are hash-keyed, so scope + age are the only filters the
    cache layer can honor. voice_id / engine / favorited are DECLARED here
    purely to reject them loudly: before 2026-06-13 they were silently
    dropped, which turned every filtered prune into a full wipe.
    Voice/engine/favorite pruning operates on DELETE /v1/generations.
    """
    unsupported = {
        k: v
        for k, v in {
            "voice_id": voice_id,
            "engine": engine,
            "favorited": favorited,
        }.items()
        if v is not None
    }
    if unsupported:
        raise bad_request(
            f"Unsupported cache filter(s) {sorted(unsupported)}: cache entries "
            "are hash-keyed and carry no voice/engine/favorite identity. "
            "Use DELETE /v1/generations with these filters instead."
        )
    st = get_state()
    cache = getattr(st, "_render_cache", None)
    removed = 0
    if cache is not None:
        removed = cache.clear(scope, older_than_days=older_than_days)
    return {
        "cleared": True,
        "scope": scope,
        "older_than_days": older_than_days,
        "removed": removed,
    }


class RecentCacheEntry(BaseModel):
    id: str
    engine: str
    voice: str
    text_preview: str
    size_bytes: int
    created_at: str


class RecentCacheResponse(BaseModel):
    entries: list[RecentCacheEntry]


@router.get("/v1/cache/recent", response_model=RecentCacheResponse)
async def recent_entries(limit: int = 15, db: Session = Depends(get_db)) -> RecentCacheResponse:
    """Latest completed generations — the human-readable face of the
    cache (raw cache keys are hashes; the generation row carries the
    engine/voice/text that produced them). Delete rows via
    DELETE /v1/generations/{id}."""
    st = get_state()
    rows = (
        db.query(Generation)
        .filter(Generation.status == "completed")
        .order_by(Generation.created_at.desc())
        .limit(max(1, min(limit, 100)))
        .all()
    )
    out: list[RecentCacheEntry] = []
    for g in rows:
        size = 0
        if g.audio_path:
            try:
                size = media_file(g.audio_path).stat().st_size
            except OSError:
                size = 0
        persona = st.personas.get(g.persona_id) if g.persona_id else None
        out.append(RecentCacheEntry(
            id=g.id,
            engine=g.engine or "?",
            voice=(persona.name if persona else (g.profile_id or "—")),
            text_preview=(g.text or "")[:80],
            size_bytes=size,
            created_at=g.created_at.isoformat() if g.created_at else "",
        ))
    return RecentCacheResponse(entries=out)
