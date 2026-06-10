# SPDX-License-Identifier: GPL-3.0-or-later
"""/v1/active_tasks — page-refresh recovery for in-flight work.

Polled every 30s by the renderer's useRestoreActiveTasks hook. Returns the
current set of pending generations + active model downloads so the UI can
re-attach progress toasts after a window close+reopen or page refresh.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import Generation, get_db


router = APIRouter(tags=["system"])


class ActiveGeneration(BaseModel):
    task_id: str  # the generation.id
    profile_id: Optional[str]
    text_preview: str  # first 80 chars
    status: str
    created_at: datetime


class ActiveDownloadTask(BaseModel):
    model_name: str
    display_name: str
    status: str  # "downloading" | "extracting" | "complete" | "error"
    progress: float = 0.0  # 0..100
    current: int = 0
    total: int = 0


class ActiveTasksResponse(BaseModel):
    generations: list[ActiveGeneration]
    downloads: list[ActiveDownloadTask]


@router.get("/v1/active_tasks", response_model=ActiveTasksResponse)
async def get_active_tasks(db: Session = Depends(get_db)) -> ActiveTasksResponse:
    # Pending generations: anything not terminal.
    pending = (
        db.query(Generation)
        .filter(Generation.status.in_(["queued", "loading_model", "generating"]))
        .order_by(Generation.created_at.desc())
        .limit(100)
        .all()
    )
    gens = [
        ActiveGeneration(
            task_id=g.id,
            profile_id=g.profile_id,
            text_preview=(g.text or "")[:80],
            status=g.status,
            created_at=g.created_at,
        )
        for g in pending
    ]

    # Active downloads come from the in-process progress manager (if present).
    downloads: list[ActiveDownloadTask] = []
    try:
        from ..utils.progress import get_progress_manager  # type: ignore

        pm = get_progress_manager()
        for entry in pm.list_active():
            downloads.append(
                ActiveDownloadTask(
                    model_name=entry["model_name"],
                    display_name=entry.get("display_name", entry["model_name"]),
                    status=entry.get("status", "downloading"),
                    progress=float(entry.get("progress", 0.0)),
                    current=int(entry.get("current", 0)),
                    total=int(entry.get("total", 0)),
                )
            )
    except Exception:
        # Progress manager not yet wired; return empty list.
        pass

    return ActiveTasksResponse(generations=gens, downloads=downloads)
