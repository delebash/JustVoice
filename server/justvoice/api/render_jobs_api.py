# SPDX-License-Identifier: MIT
"""/v1/render_jobs — persistent per-block render jobs (Stage 2 of the
2026-08-08 scheduler work; docs/plans/2026-08-08-vram-think.md §7).

Create → the runner drives every block through the SynthScheduler as its
own one-item set (engine-major grouping, per-block failure isolation) and
persists Generation + default Take per block exactly like
POST /v1/blocks/{id}/render. Poll GET for progress; cancel withdraws the
queued lines at the next boundary; resume re-runs pending + failed blocks
only. Jobs survive a server restart as rows ("paused" after the boot
sweep)."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from .. import render_jobs
from ..errors import bad_request, not_found

router = APIRouter(tags=["generation"])


class RenderJobCreate(BaseModel):
    project_id: str
    scope: str = "blocks"  # "project" | "scene" | "blocks"
    scope_ids: list[str] = Field(default_factory=list)


class RenderJobBlockOut(BaseModel):
    block_id: str
    status: str
    generation_id: str | None = None


class RenderJobLine(BaseModel):
    """A line rendering now: its number in its chapter and its speaker's name."""
    block_id: str
    n: int | None = None
    speaker: str | None = None


class RenderJobAhead(BaseModel):
    """Work ahead of a waiting job, in the order it runs: whose it is, its kind
    ("chapter" — a chapter's render; "work" — an export, a preview…), its model."""
    label: str
    kind: str
    model: str | None = None
    lines: int


class RenderJobWaiting(BaseModel):
    """What a job's next line waits behind (2026-10-07) — only while none of its
    own lines is rendering."""
    lines: int
    groups: list[RenderJobAhead] = []


class RenderJobOut(BaseModel):
    id: str
    project_id: str
    scope: str
    status: str
    total_blocks: int
    completed_blocks: int
    failed_blocks: int
    blocks: list[RenderJobBlockOut] | None = None
    # Seconds of audio the finished lines made, and the lines rendering now (2026-10-07).
    audio_seconds: float = 0.0
    current: list[RenderJobLine] = []
    waiting: RenderJobWaiting | None = None


@router.post("/v1/render_jobs", response_model=RenderJobOut)
async def create_render_job(req: RenderJobCreate) -> RenderJobOut:
    if req.scope in ("scene", "blocks") and not req.scope_ids:
        raise bad_request(f"scope_ids is required for scope {req.scope!r}")
    try:
        job = render_jobs.create_job(req.project_id, req.scope, req.scope_ids)
    except ValueError as e:
        raise bad_request(str(e))
    if job.total_blocks:
        render_jobs.start_job(job.id)
    out = render_jobs.job_status(job.id)
    return RenderJobOut(**out)


@router.get("/v1/render_jobs/{job_id}", response_model=RenderJobOut)
async def get_render_job(job_id: str, include_blocks: bool = False) -> RenderJobOut:
    out = render_jobs.job_status(job_id, include_blocks=include_blocks)
    if out is None:
        raise not_found(f"render job {job_id}")
    return RenderJobOut(**out)


@router.post("/v1/render_jobs/{job_id}/cancel", response_model=RenderJobOut)
async def cancel_render_job(job_id: str) -> RenderJobOut:
    out = render_jobs.cancel_job(job_id)
    if out is None:
        raise not_found(f"render job {job_id}")
    return RenderJobOut(**out)


@router.post("/v1/render_jobs/{job_id}/resume", response_model=RenderJobOut)
async def resume_render_job(job_id: str) -> RenderJobOut:
    out = render_jobs.resume_job(job_id)
    if out is None:
        raise not_found(f"render job {job_id}")
    return RenderJobOut(**out)
