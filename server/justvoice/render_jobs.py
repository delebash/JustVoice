# SPDX-License-Identifier: MIT
"""Persistent render jobs — the RenderJob/RenderJobBlock orchestrator.

The tables shipped with the v1.0 design freeze ("resumable scene/project
renders", `database/models.py`) and sat dead — no creator, no worker —
until Stage 2 of the 2026-08-08 scheduler work
(docs/plans/2026-08-08-vram-think.md §7). A job turns a set of blocks into
per-block renders driven through the SynthScheduler: every block is
submitted as its OWN one-item set, so the pool drains engine-major across
the whole job (and anything else queued) while failures stay isolated per
block — block 7 failing never costs block 8 its render.

Each finished block persists Generation + default Take exactly like the
single-block door (`persist_block_take`, shared with takes_api — one
source, they must never drift). A job survives restart as rows: the boot
sweep (`sweep_stale_jobs`) marks interrupted queued/running jobs "paused";
`resume_job` re-enqueues only the blocks that aren't completed.
"""

from __future__ import annotations

import json
import logging
import threading
from types import SimpleNamespace

from .database import session as db_session
from .database.models import (
    Block,
    Generation,
    Persona,
    RenderJob,
    RenderJobBlock,
    Scene,
    Take,
    _utcnow,
)

log = logging.getLogger(__name__)

_TERMINAL = ("completed", "failed", "cancelled")

_state_lock = threading.Lock()
_running: set[str] = set()                      # job ids with a live runner
_cancel_events: dict[str, threading.Event] = {}
_live_handles: dict[str, list] = {}             # job id → scheduler SetHandles


def _open_db():
    factory = db_session.SessionLocal
    if factory is None:
        raise RuntimeError("database not initialized")
    return factory()


# ── the one block-persistence shape ──────────────────────────────────


def persist_block_take(db, state, block, wav: bytes) -> Take:
    """Generation + default Take for one rendered block — THE single
    persistence shape, shared by POST /v1/blocks/{id}/render and the job
    runner."""
    scene = db.query(Scene).filter(Scene.id == block.scene_id).first()
    gen = Generation(
        block_id=block.id,
        persona_id=block.persona_id,
        project_id=scene.project_id if scene else None,
        chapter_id=block.scene_id,
        text=block.text,
        engine=state.engines.current() or "managed",
        status="completed",
        source="chapter_render",
        duration_sec=round((len(wav) - 44) / (2 * 16000), 3) if len(wav) > 44 else None,
    )
    db.add(gen)
    db.flush()
    take = Take(block_id=block.id, generation_id=gen.id, is_default=True)
    db.add(take)
    db.commit()
    db.refresh(take)
    return take


# ── job lifecycle ────────────────────────────────────────────────────


def _expand_scope(db, project_id: str, scope: str, scope_ids: list[str]) -> list[str]:
    """Scope → ordered block ids. "blocks" keeps the caller's order; the
    other scopes walk scene position → block position. Empty-text blocks
    are excluded everywhere (nothing to render)."""
    if scope == "blocks":
        rows = db.query(Block).filter(Block.id.in_(scope_ids)).all()
        by_id = {b.id: b for b in rows}
        missing = [i for i in scope_ids if i not in by_id]
        if missing:
            raise ValueError(f"unknown block ids: {', '.join(missing[:5])}")
        return [i for i in scope_ids if (by_id[i].text or "").strip()]
    if scope in ("scene", "project"):
        q = (
            db.query(Block)
            .join(Scene, Block.scene_id == Scene.id)
            .filter(Scene.project_id == project_id)
            .order_by(Scene.position, Block.position)
        )
        if scope == "scene":
            q = q.filter(Scene.id.in_(scope_ids))
        return [b.id for b in q.all() if (b.text or "").strip()]
    raise ValueError(f"unknown scope {scope!r}")


def create_job(project_id: str, scope: str, scope_ids: list[str] | None) -> RenderJob:
    """Create the job + its per-block rows (all pending). A job with zero
    renderable blocks is born completed — nothing to run."""
    db = _open_db()
    try:
        block_ids = _expand_scope(db, project_id, scope, scope_ids or [])
        job = RenderJob(
            project_id=project_id,
            scope=scope,
            scope_ids_json=json.dumps(scope_ids or []),
            status="queued" if block_ids else "completed",
            total_blocks=len(block_ids),
        )
        if not block_ids:
            job.finished_at = _utcnow()
        db.add(job)
        db.flush()
        for bid in block_ids:
            db.add(RenderJobBlock(job_id=job.id, block_id=bid, status="pending"))
        db.commit()
        db.refresh(job)
        return job
    finally:
        db.close()


def start_job(job_id: str) -> bool:
    """Spawn the runner thread. Idempotent — one live runner per job."""
    with _state_lock:
        if job_id in _running:
            return False
        _running.add(job_id)
        _cancel_events[job_id] = threading.Event()
    threading.Thread(
        target=_run_job, args=(job_id,), name=f"render-job-{job_id[:8]}", daemon=True
    ).start()
    return True


def cancel_job(job_id: str) -> dict | None:
    """Cancel: withdraw the job's queued lines at the next line boundary.
    A job with no live runner (queued/paused rows) goes terminal directly."""
    with _state_lock:
        live = job_id in _running
        evt = _cancel_events.get(job_id)
        handles = list(_live_handles.get(job_id, []))
    if evt is not None:
        evt.set()
    if live:
        from .synth_scheduler import get_scheduler

        scheduler = get_scheduler()
        for h in handles:
            scheduler.cancel(h.set_id)
        return job_status(job_id)
    db = _open_db()
    try:
        job = db.query(RenderJob).filter(RenderJob.id == job_id).first()
        if job is None:
            return None
        if job.status not in _TERMINAL:
            job.status = "cancelled"
            job.finished_at = _utcnow()
            db.commit()
    finally:
        db.close()
    return job_status(job_id)


def resume_job(job_id: str) -> dict | None:
    """Re-run a job's unfinished blocks (pending + failed + interrupted
    running). Completed blocks are never re-rendered. No-op on a job whose
    runner is live or whose blocks are all completed."""
    db = _open_db()
    try:
        job = db.query(RenderJob).filter(RenderJob.id == job_id).first()
        if job is None:
            return None
        with _state_lock:
            if job_id in _running:
                return job_status(job_id)
        unfinished = (
            db.query(RenderJobBlock)
            .filter(
                RenderJobBlock.job_id == job_id,
                RenderJobBlock.status.in_(["pending", "failed", "running"]),
            )
            .count()
        )
        if not unfinished:
            return job_status(job_id)
        job.status = "queued"
        job.finished_at = None
        db.commit()
    finally:
        db.close()
    start_job(job_id)
    return job_status(job_id)


def job_status(job_id: str, *, include_blocks: bool = False) -> dict | None:
    db = _open_db()
    try:
        job = db.query(RenderJob).filter(RenderJob.id == job_id).first()
        if job is None:
            return None
        out = {
            "id": job.id,
            "project_id": job.project_id,
            "scope": job.scope,
            "status": job.status,
            "total_blocks": job.total_blocks or 0,
            "completed_blocks": job.completed_blocks or 0,
            "failed_blocks": job.failed_blocks or 0,
        }
        if include_blocks:
            rows = (
                db.query(RenderJobBlock)
                .filter(RenderJobBlock.job_id == job_id)
                .all()
            )
            out["blocks"] = [
                {
                    "block_id": r.block_id,
                    "status": r.status,
                    "generation_id": r.generation_id,
                }
                for r in rows
            ]
        return out
    finally:
        db.close()


def sweep_stale_jobs() -> int:
    """Boot sweep: jobs a dead server left queued/running become 'paused'
    (their rows survive; resume re-runs the unfinished blocks)."""
    db = _open_db()
    try:
        jobs = (
            db.query(RenderJob)
            .filter(RenderJob.status.in_(["queued", "running"]))
            .all()
        )
        for j in jobs:
            j.status = "paused"
        if jobs:
            db.commit()
        return len(jobs)
    finally:
        db.close()


# ── the runner ───────────────────────────────────────────────────────


def _refresh_counters(db, job_id: str) -> None:
    job = db.query(RenderJob).filter(RenderJob.id == job_id).first()
    if job is None:
        return
    job.completed_blocks = (
        db.query(RenderJobBlock)
        .filter(RenderJobBlock.job_id == job_id, RenderJobBlock.status == "completed")
        .count()
    )
    job.failed_blocks = (
        db.query(RenderJobBlock)
        .filter(RenderJobBlock.job_id == job_id, RenderJobBlock.status == "failed")
        .count()
    )


def _run_job(job_id: str) -> None:
    from .app_state import get_state
    from .export_voicelines import _render_block_production
    from .render_core import _resolve_engine_for_voice
    from .synth_scheduler import get_scheduler

    state = get_state()
    cancel_evt = _cancel_events.get(job_id) or threading.Event()
    try:
        # Collect the work list (detached rows — attribute reads only).
        db = _open_db()
        try:
            job = db.query(RenderJob).filter(RenderJob.id == job_id).first()
            if job is None:
                return
            job.status = "running"
            if job.started_at is None:
                job.started_at = _utcnow()
            work_rows = (
                db.query(RenderJobBlock)
                .filter(
                    RenderJobBlock.job_id == job_id,
                    RenderJobBlock.status.in_(["pending", "failed", "running"]),
                )
                .all()
            )
            work: list[tuple[str, object, object, str]] = []
            for jb in work_rows:
                block = db.query(Block).filter(Block.id == jb.block_id).first()
                if block is None:
                    jb.status = "failed"
                    continue
                persona = (
                    db.query(Persona).filter(Persona.id == block.persona_id).first()
                    if block.persona_id
                    else None
                )
                voice = None
                if persona is not None:
                    store_p = state.personas.get(persona.id)
                    if store_p is not None:
                        voice = store_p.voice_id or None
                engine_id = (
                    _resolve_engine_for_voice(state, voice) if voice else None
                ) or f"?voice:{voice}"
                jb.status = "pending"
                # Plain copies, not ORM instances: this session's commit
                # expires loaded attributes, and the render/persist happen
                # in later sessions (DetachedInstanceError otherwise).
                block_data = SimpleNamespace(
                    id=block.id,
                    scene_id=block.scene_id,
                    persona_id=block.persona_id,
                    text=block.text,
                )
                persona_data = (
                    SimpleNamespace(id=persona.id, name=persona.name)
                    if persona is not None
                    else None
                )
                work.append((jb.id, block_data, persona_data, engine_id))
            _refresh_counters(db, job_id)
            db.commit()
        finally:
            db.close()

        # Submit every block as its OWN one-item set: the pool groups
        # engine-major across the whole job; a failure fails one block only.
        scheduler = get_scheduler()
        handles = []
        for jb_id, block, persona, engine_id in work:
            h = scheduler.submit(
                [(engine_id, lambda p=persona, b=block: _render_block_production(state, p, b))]
            )
            handles.append((jb_id, block, h))
        with _state_lock:
            _live_handles[job_id] = [h for _, _, h in handles]

        for jb_id, block, handle in handles:
            if cancel_evt.is_set():
                scheduler.cancel(handle.set_id)
            handle.wait()
            item = handle.items[0]
            db = _open_db()
            try:
                jb = (
                    db.query(RenderJobBlock)
                    .filter(RenderJobBlock.id == jb_id)
                    .first()
                )
                if handle.cancelled and item.error is None and item.result is None:
                    if jb is not None:
                        jb.status = "pending"  # withdrawn — resume picks it up
                    _refresh_counters(db, job_id)
                    db.commit()
                elif item.error is not None:
                    if jb is not None:
                        jb.status = "failed"
                    log.warning(
                        "render job %s: block %s failed: %s",
                        job_id, block.id, item.error,
                    )
                    _refresh_counters(db, job_id)
                    db.commit()
                else:
                    take = persist_block_take(db, state, block, item.result)
                    if jb is not None:
                        jb.status = "completed"
                        jb.generation_id = take.generation_id
                    _refresh_counters(db, job_id)
                    db.commit()
            except Exception as e:
                log.exception("render job %s: persisting block %s failed: %s", job_id, block.id, e)
                try:
                    db.rollback()
                    jb = (
                        db.query(RenderJobBlock)
                        .filter(RenderJobBlock.id == jb_id)
                        .first()
                    )
                    if jb is not None:
                        jb.status = "failed"
                    _refresh_counters(db, job_id)
                    db.commit()
                except Exception:
                    pass
            finally:
                db.close()

        db = _open_db()
        try:
            job = db.query(RenderJob).filter(RenderJob.id == job_id).first()
            if job is not None:
                job.status = "cancelled" if cancel_evt.is_set() else "completed"
                job.finished_at = _utcnow()
                _refresh_counters(db, job_id)
                db.commit()
        finally:
            db.close()
    except Exception as e:
        log.exception("render job %s crashed: %s", job_id, e)
        try:
            db = _open_db()
            try:
                job = db.query(RenderJob).filter(RenderJob.id == job_id).first()
                if job is not None and job.status not in _TERMINAL:
                    job.status = "failed"
                    job.finished_at = _utcnow()
                    db.commit()
            finally:
                db.close()
        except Exception:
            pass
    finally:
        with _state_lock:
            _running.discard(job_id)
            _cancel_events.pop(job_id, None)
            _live_handles.pop(job_id, None)
