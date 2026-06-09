# SPDX-License-Identifier: GPL-3.0-or-later
"""Server-sent event streams — per-generation status + per-model download.

Subscribed by:
- useGenerationProgress (auto-play on complete + history invalidation)
- useModelDownloadToast (toast progress bar tied to download)
- DictateWindow agent-speak cycle (MCP voicebox.speak playback)
"""

from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..database import Generation, get_db


router = APIRouter(tags=["streams"])


SSE_POLL_INTERVAL_S = 0.5
SSE_TIMEOUT_S = 600  # 10 min hard cap on any single subscription


async def _stream_generation_status(generation_id: str, db: Session) -> AsyncIterator[bytes]:
    """Poll the generation status until it terminates (completed/failed/cancelled)
    or the timeout fires. Yields SSE-formatted text frames.

    Terminal statuses: completed / failed / cancelled / not_found.
    """
    elapsed = 0.0
    last_status: str | None = None
    while elapsed < SSE_TIMEOUT_S:
        gen = db.query(Generation).filter(Generation.id == generation_id).first()
        if gen is None:
            payload = json.dumps({"id": generation_id, "status": "not_found"})
            yield f"data: {payload}\n\n".encode("utf-8")
            return
        status = gen.status
        if status != last_status:
            payload = json.dumps(
                {
                    "id": gen.id,
                    "status": status,
                    "duration": gen.duration_sec,
                    "error": gen.error,
                    "source": gen.source,
                }
            )
            yield f"data: {payload}\n\n".encode("utf-8")
            last_status = status
        if status in ("completed", "failed", "cancelled"):
            return
        await asyncio.sleep(SSE_POLL_INTERVAL_S)
        elapsed += SSE_POLL_INTERVAL_S


@router.get("/v1/generate/{generation_id}/status")
async def generation_status_stream(
    generation_id: str, db: Session = Depends(get_db)
) -> StreamingResponse:
    return StreamingResponse(
        _stream_generation_status(generation_id, db),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # nginx
        },
    )


async def _stream_model_download(model_name: str) -> AsyncIterator[bytes]:
    """Poll the in-process progress manager for this model's download state."""
    try:
        from ..utils.progress import get_progress_manager  # type: ignore
    except Exception:
        payload = json.dumps({"model_name": model_name, "status": "error", "error": "progress manager unavailable"})
        yield f"data: {payload}\n\n".encode("utf-8")
        return
    pm = get_progress_manager()
    elapsed = 0.0
    last_payload: str | None = None
    while elapsed < SSE_TIMEOUT_S:
        entry = pm.get(model_name)
        if entry is None:
            payload = json.dumps({"model_name": model_name, "status": "not_found"})
            yield f"data: {payload}\n\n".encode("utf-8")
            return
        payload = json.dumps(
            {
                "model_name": model_name,
                "status": entry.get("status", "downloading"),
                "current": int(entry.get("current", 0)),
                "total": int(entry.get("total", 0)),
                "progress": float(entry.get("progress", 0.0)),
                "filename": entry.get("filename"),
                "error": entry.get("error"),
            }
        )
        if payload != last_payload:
            yield f"data: {payload}\n\n".encode("utf-8")
            last_payload = payload
        if entry.get("status") in ("complete", "error"):
            return
        await asyncio.sleep(SSE_POLL_INTERVAL_S)
        elapsed += SSE_POLL_INTERVAL_S


@router.get("/v1/models/progress/{model_name}")
async def model_progress_stream(model_name: str) -> StreamingResponse:
    return StreamingResponse(
        _stream_model_download(model_name),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
