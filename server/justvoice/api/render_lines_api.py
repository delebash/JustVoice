# SPDX-License-Identifier: MIT
"""Render's line page and chapter grid (Studio Slice 4, decided 2026-10-04;
docs/plans/2026-10-04-slice-4-render.md).

- GET  /v1/scenes/{id}/render_lines — a chapter's heard lines, each with its
  state in §8.16's words, its ★ take and how many takes it has.
- GET  /v1/projects/{id}/render_state — every chapter's counts: Render's grid,
  Studio's step card, Overview and Home.
- POST /v1/scenes/{id}/render_lines — render a chapter's lines as a render
  job: "ready" (each line with no take gets one — ⚡ Render N ready, a
  chapter's ▶ Render) or "all" (a new take for every line that can render,
  past the render cache — ↻ Re-render all).
- POST /v1/projects/{id}/lexicon — the book's lexicon for 📕 Pronunciation,
  made ("<book> names") and chosen for the book when it has none.

The rules — what a take was made from, stale, the line's own numbers — live in
line_takes.py.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel

from .. import render_jobs
from ..app_state import get_state
from ..database import session as db_session
from ..database.models import Project, Scene
from ..errors import bad_request, internal, not_found
from ..line_takes import project_render_state, scene_lines
from .render_jobs_api import RenderJobOut

router = APIRouter(tags=["generation"])


def _open_db():
    if db_session.SessionLocal is None:
        raise internal("database not initialized")
    return db_session.SessionLocal()


class LineTake(BaseModel):
    take_id: str
    generation_id: str
    seconds: float | None = None
    audio_url: str | None = None
    label: str | None = None
    new_seed: bool = False
    text: str | None = None


class RenderLine(BaseModel):
    block_id: str
    n: int
    text: str
    speaker_id: str | None = None
    spoken: bool = False
    direction: str = ""
    # What the line sets for itself (This line only): speed, pitch, gain_db, pause_after_ms —
    # set ones only — and `models`: {model: {knobs, emotion, register_tag}} (2026-10-06).
    override: dict[str, Any] = {}
    # The line ends one of the book's scenes (line_takes.scene_ends): with no pause of
    # its own, Settings' pause at a scene break follows it (2026-10-06).
    scene_end: bool = False
    # The next line is from the same paragraph (line_takes.paragraph_joins): with no
    # pause of its own, Settings' pause within a paragraph follows it (2026-10-07).
    paragraph_next: bool = False
    state: Literal["needs a speaker", "needs a voice", "ready", "rendered", "stale"]
    takes: int = 0
    live: LineTake | None = None


class RenderCounts(BaseModel):
    lines: int = 0
    needs_speaker: int = 0
    needs_voice: int = 0
    ready: int = 0
    rendered: int = 0
    stale: int = 0


class SceneRenderLines(BaseModel):
    scene_id: str
    title: str
    position: int
    lines: list[RenderLine]
    counts: RenderCounts


class ChapterRenderState(RenderCounts):
    scene_id: str
    title: str


class ProjectRenderState(BaseModel):
    project_id: str
    chapters: list[ChapterRenderState]
    totals: RenderCounts


class RenderLinesRequest(BaseModel):
    which: Literal["ready", "all"] = "ready"


class BookLexicon(BaseModel):
    lexicon_id: str
    name: str
    created: bool


@router.get("/v1/scenes/{scene_id}/render_lines", response_model=SceneRenderLines)
def get_render_lines(scene_id: str) -> SceneRenderLines:
    """Sync def on purpose: judging each take reads lexicons and the database — threadpool-run."""
    db = _open_db()
    try:
        return SceneRenderLines(**scene_lines(db, get_state(), scene_id))
    finally:
        db.close()


@router.get("/v1/projects/{project_id}/render_state", response_model=ProjectRenderState)
def get_render_state(project_id: str) -> ProjectRenderState:
    db = _open_db()
    try:
        if db.query(Project).filter(Project.id == project_id).first() is None:
            raise not_found(f"project {project_id}")
        return ProjectRenderState(**project_render_state(db, get_state(), project_id))
    finally:
        db.close()


@router.post("/v1/scenes/{scene_id}/render_lines", response_model=RenderJobOut)
def render_scene_lines(scene_id: str, req: RenderLinesRequest | None = None) -> RenderJobOut:
    """A render job over a chapter's lines (G2: every line it renders gets a
    take). "ready": the lines with no take. "all": every line that can render,
    past the render cache. Lines that can't render are left out — Render shows
    them, and the chapter's ▶ Render refuses until they can."""
    which = (req or RenderLinesRequest()).which
    db = _open_db()
    try:
        scene = db.query(Scene).filter(Scene.id == scene_id).first()
        if scene is None:
            raise not_found(f"scene {scene_id}")
        project_id = scene.project_id
        page = scene_lines(db, get_state(), scene_id)
    finally:
        db.close()
    wanted = ("ready",) if which == "ready" else ("ready", "rendered", "stale")
    ids = [line["block_id"] for line in page["lines"] if line["state"] in wanted]
    try:
        job = render_jobs.create_job(project_id, "blocks", ids, fresh=(which == "all"))
    except ValueError as e:
        raise bad_request(str(e))
    if job.total_blocks:
        render_jobs.start_job(job.id)
    return RenderJobOut(**render_jobs.job_status(job.id))


@router.post("/v1/projects/{project_id}/lexicon", response_model=BookLexicon)
def ensure_book_lexicon(project_id: str) -> BookLexicon:
    """The book's lexicon — 📕 Pronunciation opens it (decided 2026-09-30,
    project-lexicon §6 item 4). A book with none gets "<book> names", chosen as
    its lexicon (Overview → Pronunciation lexicon)."""
    st = get_state()
    db = _open_db()
    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if project is None:
            raise not_found(f"project {project_id}")
        if project.default_lexicon_id:
            lex = st.lexicons.get(project.default_lexicon_id)
            if lex is not None:
                return BookLexicon(lexicon_id=lex.id, name=lex.name, created=False)
        name = f"{project.name} names"
    finally:
        db.close()
    lex = st.lexicons.create(name=name, scope="project", project_id=project_id)
    db = _open_db()
    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        project.default_lexicon_id = lex.id
        db.commit()
    finally:
        db.close()
    return BookLexicon(lexicon_id=lex.id, name=lex.name, created=True)
