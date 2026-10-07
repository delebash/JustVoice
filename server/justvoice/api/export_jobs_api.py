# SPDX-License-Identifier: MIT
"""The book's exports as jobs the Export panel follows (decided 2026-10-07).

`POST /v1/projects/{id}/export_m4b` renders and masters every chapter, then
encodes the book, and answers only at the end — minutes with nothing to show.
These are the same work, reported as it goes: start one, poll it (chapter 2 of
4, then "Encoding the book"), cancel it between chapters, then fetch the file.

* M4B — the book, one file with chapter marks.
* Chapter audio — a zip of each chapter joined (`chapters/NN Title.wav`) and
  mastered to the book's target (`masters/NN Title.wav`): what Export's
  "per-chapter WAV + masters (zip)" always said, and what its button handed
  over the project package instead of until 2026-10-07. The package itself
  (`GET /v1/projects/{id}/export`) is Overview's, and stays as it is.

Jobs live in memory and a finished file in the temp folder until it is
fetched; the old M4B door stays for anything that calls it directly.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import tempfile
import uuid
import zipfile
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


def _safe(name: str | None, fallback: str) -> str:
    return re.sub(r"[^A-Za-z0-9._ -]+", "_", name or "").strip() or fallback


def _chapter_step(job: dict[str, Any], i: int, n: int, scene) -> str:
    if job["cancel"]:
        raise _Cancelled()
    job["done"] = i
    return f"Chapter {i + 1} of {n} · {scene.title or f'Chapter {scene.position + 1}'}"


async def _warm(project_id: str, job: dict[str, Any]) -> None:
    from ..export_audiobook import collect_project_line_kwargs
    from ..synth_scheduler import warm_lines, work_owner

    st = get_state()
    job["step"] = "Rendering the lines that have no take yet"
    what = "the M4B export" if job["media_type"] == "audio/mp4" else "the chapter WAVs export"
    await warm_lines(st, collect_project_line_kwargs(st, project_id), owner=work_owner(what))


def _m4b(job: dict[str, Any], project_id: str, name: str, author: str | None) -> str:
    from ..export_audiobook import assemble_project, mux_m4b

    def progress(i: int, n: int, scene) -> None:
        job["total"] = n + 1          # every chapter, then the encode
        job["step"] = _chapter_step(job, i, n, scene)

    chapters = assemble_project(get_state(), project_id, progress=progress)
    if not chapters:
        raise bad_request("project has no scenes to export")
    if job["cancel"]:
        raise _Cancelled()
    job["done"] = len(chapters)
    job["step"] = "Encoding the book"
    m4b = mux_m4b(chapters, name, author)
    fd, path = tempfile.mkstemp(prefix="jv-export-", suffix=".m4b")
    with os.fdopen(fd, "wb") as f:
        f.write(m4b)
    return path


def _chapters_zip(job: dict[str, Any], project_id: str) -> str:
    from ..export_audiobook import project_scenes
    from .render_chapter_api import render_scene_to_wav

    st = get_state()
    scenes = project_scenes(project_id)
    if not scenes:
        raise bad_request("project has no scenes to export")
    job["total"] = len(scenes)
    fd, path = tempfile.mkstemp(prefix="jv-export-", suffix=".zip")
    os.close(fd)
    try:
        # Stored, not deflated: WAV barely compresses, and a book is hundreds of MB.
        with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as zf:
            for i, scene in enumerate(scenes):
                job["step"] = _chapter_step(job, i, len(scenes), scene)
                title = _safe(scene.title, f"Chapter {scene.position + 1}")
                name = f"{i + 1:02d} {title}.wav"
                zf.writestr(f"chapters/{name}", render_scene_to_wav(st, scene.id, master=False))
                zf.writestr(f"masters/{name}", render_scene_to_wav(st, scene.id, master=True))
    except BaseException:
        os.path.exists(path) and os.remove(path)
        raise
    return path


async def _run(job: dict[str, Any], project_id: str, build) -> None:
    try:
        await _warm(project_id, job)
        path = await asyncio.to_thread(build)
        job.update(path=path, done=job["total"], step="Done", status="done")
    except _Cancelled:
        job.update(status="cancelled", step="Cancelled")
    except ApiError as e:
        job.update(status="error", error=str(e.detail))
    except Exception as e:  # noqa: BLE001 — the panel shows it; the server keeps running
        log.exception("export job %s failed", job["id"])
        job.update(status="error", error=str(e))


def _project(project_id: str) -> tuple[str, str | None]:
    from .projects_api import m4b_author

    db = db_session.SessionLocal()
    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if project is None:
            raise not_found(f"project {project_id}")
        return project.name, m4b_author(project)
    finally:
        db.close()


def _need_ffmpeg(what: str) -> None:
    from ..export_audiobook import have_ffmpeg

    if not have_ffmpeg():
        raise HTTPException(
            status_code=503,
            detail=f"ffmpeg is not installed — required for {what}. Install ffmpeg and restart the server.",
        )


def _start(project_id: str, filename: str, media_type: str, build) -> dict[str, Any]:
    job = {"id": uuid.uuid4().hex, "status": "running", "done": 0, "total": 0, "step": "Starting",
           "error": None, "filename": filename, "media_type": media_type, "path": None, "cancel": False}
    _jobs[job["id"]] = job
    # Held on the job: an unreferenced task can be collected mid-run.
    job["task"] = asyncio.create_task(_run(job, project_id, lambda: build(job)))
    return _public(job)


@router.post("/v1/projects/{project_id}/export_m4b/start")
async def start_export_m4b(project_id: str) -> dict[str, Any]:
    name, author = _project(project_id)
    _need_ffmpeg("M4B export")
    return _start(project_id, f"{_safe(name, 'book').replace(' ', '_')}.m4b", "audio/mp4",
                  lambda job: _m4b(job, project_id, name, author))


@router.post("/v1/projects/{project_id}/export_chapters/start")
async def start_export_chapters(project_id: str) -> dict[str, Any]:
    name, _author = _project(project_id)
    _need_ffmpeg("mastered chapters")
    return _start(project_id, f"{_safe(name, 'book').replace(' ', '_')}_chapters.zip", "application/zip",
                  lambda job: _chapters_zip(job, project_id))


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
    return FileResponse(path, media_type=job["media_type"], filename=job["filename"],
                        background=BackgroundTask(lambda: os.path.exists(path) and os.remove(path)))
