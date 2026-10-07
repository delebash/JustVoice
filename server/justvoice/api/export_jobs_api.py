# SPDX-License-Identifier: MIT
"""The book's M4B export as a job the Export panel follows (decided 2026-10-07).

`POST /v1/projects/{id}/export_m4b` renders and masters every chapter, then
encodes the book, and answers only at the end — minutes with nothing to show.
This is the same work, reported as it goes: start it, poll it (chapter 2 of 4,
then "Encoding the book"), cancel it between chapters, then fetch the file.
Jobs live in memory and a finished file in the temp folder until it is
fetched; the old door stays for anything that calls it directly.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import tempfile
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..app_state import get_state
from ..database import session as db_session
from ..database.models import Project
from ..errors import ApiError, bad_request, not_found

log = logging.getLogger(__name__)
router = APIRouter(tags=["export"])

_jobs: dict[str, dict[str, Any]] = {}


class _Cancelled(Exception):
    pass


def _public(job: dict[str, Any]) -> dict[str, Any]:
    return {k: job[k] for k in ("id", "status", "done", "total", "step", "error", "filename")}


async def _run(job: dict[str, Any], project_id: str, name: str, author: str | None) -> None:
    from ..export_audiobook import assemble_project, collect_project_line_kwargs, mux_m4b
    from ..synth_scheduler import warm_lines

    st = get_state()
    try:
        job["step"] = "Rendering the lines that have no take yet"
        await warm_lines(st, collect_project_line_kwargs(st, project_id))

        def progress(i: int, n: int, scene) -> None:
            if job["cancel"]:
                raise _Cancelled()
            job["total"] = n + 1          # every chapter, then the encode
            job["done"] = i
            job["step"] = f"Chapter {i + 1} of {n} · {scene.title or f'Chapter {scene.position + 1}'}"

        chapters = await asyncio.to_thread(assemble_project, st, project_id, progress=progress)
        if not chapters:
            raise bad_request("project has no scenes to export")
        if job["cancel"]:
            raise _Cancelled()
        job["done"] = len(chapters)
        job["step"] = "Encoding the book"
        m4b = await asyncio.to_thread(mux_m4b, chapters, name, author)
        fd, path = tempfile.mkstemp(prefix="jv-export-", suffix=".m4b")
        with os.fdopen(fd, "wb") as f:
            f.write(m4b)
        job.update(path=path, done=job["total"], step="Done", status="done")
    except _Cancelled:
        job.update(status="cancelled", step="Cancelled")
    except ApiError as e:
        job.update(status="error", error=str(e.detail))
    except Exception as e:  # noqa: BLE001 — the panel shows it; the server keeps running
        log.exception("export job %s failed", job["id"])
        job.update(status="error", error=str(e))


@router.post("/v1/projects/{project_id}/export_m4b/start")
async def start_export_m4b(project_id: str) -> dict[str, Any]:
    from ..export_audiobook import have_ffmpeg
    from .projects_api import m4b_author

    db = db_session.SessionLocal()
    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if project is None:
            raise not_found(f"project {project_id}")
        name, author = project.name, m4b_author(project)
    finally:
        db.close()
    if not have_ffmpeg():
        raise HTTPException(
            status_code=503,
            detail="ffmpeg is not installed — required for M4B export. Install ffmpeg and restart the server.",
        )
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", name or "") or "book"
    job = {"id": uuid.uuid4().hex, "status": "running", "done": 0, "total": 0, "step": "Starting",
           "error": None, "filename": f"{safe}.m4b", "path": None, "cancel": False}
    _jobs[job["id"]] = job
    # Held on the job: an unreferenced task can be collected mid-run.
    job["task"] = asyncio.create_task(_run(job, project_id, name, author))
    return _public(job)


def _job(job_id: str) -> dict[str, Any]:
    job = _jobs.get(job_id)
    if job is None:
        raise not_found(f"export job {job_id}")
    return job


@router.get("/v1/export_jobs/{job_id}")
async def get_export_job(job_id: str) -> dict[str, Any]:
    return _public(_job(job_id))


@router.post("/v1/export_jobs/{job_id}/cancel")
async def cancel_export_job(job_id: str) -> dict[str, Any]:
    job = _job(job_id)
    job["cancel"] = True
    return _public(job)


@router.get("/v1/export_jobs/{job_id}/file")
async def get_export_file(job_id: str) -> FileResponse:
    """The finished file, once; the job and its temp file go with it."""
    job = _job(job_id)
    if job["status"] != "done" or not job["path"]:
        raise bad_request(f"export job {job_id} is {job['status']}")
    path = job["path"]
    _jobs.pop(job_id, None)
    return FileResponse(path, media_type="audio/mp4", filename=job["filename"],
                        background=BackgroundTask(lambda: os.path.exists(path) and os.remove(path)))
