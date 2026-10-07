# SPDX-License-Identifier: MIT
"""Render jobs (Stage 2, 2026-08-08) — the RenderJob/RenderJobBlock
orchestrator over the SynthScheduler.

Pins: a job renders every block and persists Generation + default Take per
block; a failing block is ISOLATED (the rest keep rendering); resume
re-runs only unfinished blocks; cancel withdraws queued blocks at the line
boundary; the boot sweep pauses interrupted jobs; the API round-trips.
"""

from __future__ import annotations

import threading
import time
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import justvoice.app_state as app_state_mod
import justvoice.database.session as db_session_mod
import justvoice.export_voicelines as ev
import justvoice.media_paths as media_paths_mod
from justvoice import render_jobs
from justvoice.api import render_jobs_api
from justvoice.database.models import (
    Block,
    Generation,
    Project,
    RenderJob,
    RenderJobBlock,
    Scene,
    Take,
)
from justvoice.render_core import RenderedLine
from llm_runner.platform import install_error_handlers

pytest_plugins = ["tests.conftest_db"]

_TERMINAL = ("completed", "failed", "cancelled")


def _fake_state(data_dir):
    return SimpleNamespace(
        personas=SimpleNamespace(get=lambda pid: None),
        engines=SimpleNamespace(current=lambda: "fake-engine"),
        voices=SimpleNamespace(get=lambda vid: None),
        data_dir=data_dir,
    )


def _line(seed=None):
    """A rendered line as render_block_take returns it (Slice 4): audio, the
    seed and inputs key it was made from."""
    return RenderedLine(pcm=b"\x00\x00" * 50, sample_rate=24000, channels=1, effective_delivery={},
                        inputs_key="key-1", seed=seed)


@pytest.fixture
def job_env(tmp_db, monkeypatch, tmp_path):
    """Point render_jobs at the test DB + a fake app state (with a data
    folder, where a take's audio is kept)."""
    factory, _ = tmp_db
    state = _fake_state(tmp_path)
    monkeypatch.setattr(db_session_mod, "SessionLocal", factory)
    monkeypatch.setattr(app_state_mod, "get_state", lambda: state)
    monkeypatch.setattr(media_paths_mod, "get_state", lambda: state)
    return factory


def _seed_project(factory, texts):
    db = factory()
    try:
        p = Project(name="Game", project_type="game_voicelines")
        db.add(p)
        db.flush()
        s = Scene(project_id=p.id, position=0)
        db.add(s)
        db.flush()
        ids = []
        for i, text in enumerate(texts):
            b = Block(scene_id=s.id, position=i, text=text)
            db.add(b)
            db.flush()
            ids.append(b.id)
        db.commit()
        return p.id, s.id, ids
    finally:
        db.close()


def _wait_terminal(job_id, timeout=10.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        s = render_jobs.job_status(job_id)
        if s and s["status"] in _TERMINAL:
            return s
    raise AssertionError(f"job never finished: {render_jobs.job_status(job_id)}")


def test_job_completes_and_persists_takes(job_env, monkeypatch):
    factory = job_env
    project_id, _, block_ids = _seed_project(factory, ["Line one.", "Line two."])
    monkeypatch.setattr(ev, "render_block_take", lambda st, p, b, **kw: _line(seed=7))

    job = render_jobs.create_job(project_id, "blocks", block_ids)
    render_jobs.start_job(job.id)
    s = _wait_terminal(job.id)
    assert s["status"] == "completed"
    assert s["completed_blocks"] == 2
    assert s["failed_blocks"] == 0

    detail = render_jobs.job_status(job.id, include_blocks=True)
    assert all(b["status"] == "completed" for b in detail["blocks"])
    assert all(b["generation_id"] for b in detail["blocks"])

    db = factory()
    try:
        gens = db.query(Generation).all()
        assert len(gens) == 2
        assert {g.source for g in gens} == {"chapter_render"}
        assert {g.engine for g in gens} == {"fake-engine"}
        assert db.query(Take).count() == 2
        # A take keeps its audio, its seed and what it was made from, and its
        # real length (Slice 4) — 50 frames at 24 kHz, not a 16 kHz guess.
        from justvoice.media_paths import media_file

        for g in gens:
            assert g.audio_path and media_file(g.audio_path).is_file()
            assert g.seed == 7 and g.cache_key == "key-1"
            assert g.duration_sec == round(50 / 24000, 3)
    finally:
        db.close()


def test_a_new_take_is_the_only_star(job_env, monkeypatch):
    """Rendering a line again keeps the old take and makes the new one ★ —
    the old default is cleared (it wasn't before Slice 4)."""
    factory = job_env
    project_id, _, block_ids = _seed_project(factory, ["Line one."])
    monkeypatch.setattr(ev, "render_block_take", lambda st, p, b, **kw: _line())
    for _ in range(2):
        job = render_jobs.create_job(project_id, "blocks", block_ids)
        render_jobs.start_job(job.id)
        _wait_terminal(job.id)
    db = factory()
    try:
        takes = db.query(Take).filter(Take.block_id == block_ids[0]).all()
        assert len(takes) == 2
        assert sum(t.is_default for t in takes) == 1
    finally:
        db.close()


def test_a_fresh_job_renders_past_the_cache(job_env, monkeypatch):
    """↻ Re-render all is a job made with `fresh`: every block renders with use_cache=False."""
    factory = job_env
    project_id, _, block_ids = _seed_project(factory, ["Line one."])
    seen = []
    monkeypatch.setattr(ev, "render_block_take", lambda st, p, b, **kw: seen.append(kw) or _line())
    job = render_jobs.create_job(project_id, "blocks", block_ids, fresh=True)
    render_jobs.start_job(job.id)
    _wait_terminal(job.id)
    assert seen == [{"use_cache": False}]


def test_failed_block_is_isolated(job_env, monkeypatch):
    factory = job_env
    project_id, _, block_ids = _seed_project(factory, ["Fine.", "BOOM"])

    def render(st, persona, block, **kw):
        if block.text == "BOOM":
            raise RuntimeError("engine exploded")
        return _line()

    monkeypatch.setattr(ev, "render_block_take", render)
    job = render_jobs.create_job(project_id, "blocks", block_ids)
    render_jobs.start_job(job.id)
    s = _wait_terminal(job.id)
    # The failure did NOT stop the other block.
    assert s["status"] == "completed"
    assert s["completed_blocks"] == 1
    assert s["failed_blocks"] == 1

    detail = render_jobs.job_status(job.id, include_blocks=True)
    by_status = {b["status"] for b in detail["blocks"]}
    assert by_status == {"completed", "failed"}


def test_resume_reruns_only_unfinished_blocks(job_env, monkeypatch):
    factory = job_env
    project_id, _, block_ids = _seed_project(factory, ["Fine.", "BOOM"])
    calls = []

    def flaky(st, persona, block, **kw):
        calls.append(block.text)
        if block.text == "BOOM" and calls.count("BOOM") == 1:
            raise RuntimeError("first attempt fails")
        return _line()

    monkeypatch.setattr(ev, "render_block_take", flaky)
    job = render_jobs.create_job(project_id, "blocks", block_ids)
    render_jobs.start_job(job.id)
    s = _wait_terminal(job.id)
    assert s["failed_blocks"] == 1

    render_jobs.resume_job(job.id)
    s = _wait_terminal(job.id)
    assert s["status"] == "completed"
    assert s["completed_blocks"] == 2
    assert s["failed_blocks"] == 0
    # The already-completed block was NOT re-rendered on resume.
    assert calls.count("Fine.") == 1

    db = factory()
    try:
        assert db.query(Generation).count() == 2
    finally:
        db.close()


def test_cancel_withdraws_queued_blocks(job_env, monkeypatch):
    factory = job_env
    project_id, _, block_ids = _seed_project(factory, ["One.", "Two.", "Three."])
    entered = threading.Event()
    release = threading.Event()

    def slow(st, persona, block, **kw):
        entered.set()
        release.wait(5)
        return _line()

    monkeypatch.setattr(ev, "render_block_take", slow)
    job = render_jobs.create_job(project_id, "blocks", block_ids)
    render_jobs.start_job(job.id)
    assert entered.wait(5)
    render_jobs.cancel_job(job.id)
    release.set()
    s = _wait_terminal(job.id)
    assert s["status"] == "cancelled"
    assert s["completed_blocks"] <= 1

    detail = render_jobs.job_status(job.id, include_blocks=True)
    statuses = [b["status"] for b in detail["blocks"]]
    assert statuses.count("pending") >= 2  # withdrawn, resume picks them up


def test_boot_sweep_pauses_interrupted_jobs(job_env):
    factory = job_env
    project_id, _, _ = _seed_project(factory, ["One."])
    db = factory()
    try:
        db.add(RenderJob(project_id=project_id, scope="project", status="running"))
        db.commit()
    finally:
        db.close()
    assert render_jobs.sweep_stale_jobs() == 1
    db = factory()
    try:
        job = db.query(RenderJob).first()
        assert job.status == "paused"
    finally:
        db.close()


def test_empty_scope_completes_immediately(job_env):
    factory = job_env
    db = factory()
    try:
        p = Project(name="Empty", project_type="game_voicelines")
        db.add(p)
        db.commit()
        project_id = p.id
    finally:
        db.close()
    job = render_jobs.create_job(project_id, "project", [])
    assert job.status == "completed"
    assert (job.total_blocks or 0) == 0


def test_api_roundtrip(job_env, monkeypatch):
    factory = job_env
    project_id, _, block_ids = _seed_project(factory, ["One.", "Two."])
    monkeypatch.setattr(ev, "render_block_take", lambda st, p, b, **kw: _line())

    app = FastAPI()
    install_error_handlers(app, type_base="https://justvoice.dev/errors/")
    app.include_router(render_jobs_api.router)
    client = TestClient(app)

    r = client.post(
        "/v1/render_jobs",
        json={"project_id": project_id, "scope": "blocks", "scope_ids": block_ids},
    )
    assert r.status_code == 200
    job_id = r.json()["id"]

    t0 = time.time()
    body = r.json()
    while body["status"] not in _TERMINAL and time.time() - t0 < 10:
        body = client.get(f"/v1/render_jobs/{job_id}").json()
    # Always re-fetch WITH blocks — the job may already have been terminal
    # in the POST response, which carries no blocks list.
    body = client.get(f"/v1/render_jobs/{job_id}?include_blocks=true").json()
    assert body["status"] == "completed"
    assert body["completed_blocks"] == 2
    assert len(body["blocks"]) == 2

    # Validation: scene/blocks scope requires ids.
    r = client.post("/v1/render_jobs", json={"project_id": project_id, "scope": "blocks"})
    assert r.status_code == 400
    # Unknown job → 404.
    assert client.get("/v1/render_jobs/nope").status_code == 404


def test_unknown_block_ids_reject(job_env):
    factory = job_env
    project_id, _, block_ids = _seed_project(factory, ["One."])
    with pytest.raises(ValueError):
        render_jobs.create_job(project_id, "blocks", [block_ids[0], "ghost-id"])
    db = factory()
    try:
        assert db.query(RenderJobBlock).count() == 0
    finally:
        db.close()


def test_a_line_reads_rendering_while_it_renders(job_env, monkeypatch):
    """Render's progress (decided 2026-10-07): the line rendering now is marked
    running, named by its number in the chapter and its speaker; once the run
    ends nothing is current and the audio the lines made adds up."""
    from justvoice.database.models import Speaker

    factory = job_env
    project_id, _, block_ids = _seed_project(factory, ["Line one.", "Line two."])
    db = factory()
    try:
        sp = Speaker(project_id=project_id, name="Narrator")
        db.add(sp)
        db.flush()
        for b in db.query(Block).filter(Block.id.in_(block_ids)):
            b.speaker_id = sp.id
        db.commit()
    finally:
        db.close()

    seen = {}

    def render(st, p, b, **kw):
        seen[b.id] = render_jobs.job_status(job.id, include_blocks=True)
        return _line()

    monkeypatch.setattr(ev, "render_block_take", render)
    job = render_jobs.create_job(project_id, "blocks", block_ids)
    render_jobs.start_job(job.id)
    s = _wait_terminal(job.id)
    assert s["status"] == "completed"

    for n, bid in enumerate(block_ids, start=1):
        during = seen[bid]
        assert {b["block_id"]: b["status"] for b in during["blocks"]}[bid] == "running"
        assert during["current"][0] == {"block_id": bid, "n": n, "speaker": "Narrator"}
    assert s["current"] == []
    assert s["audio_seconds"] == round(2 * 50 / 24000, 2)


def test_a_waiting_job_says_what_is_ahead(job_env, monkeypatch):
    """Render's "waiting — the M4B export is rendering 1 line first" (decided
    2026-10-07): while other work holds the queue and none of the job's lines
    has started, its status names that work; once its lines run, it says
    nothing."""
    from justvoice.synth_scheduler import get_scheduler, work_owner

    factory = job_env
    project_id, _, block_ids = _seed_project(factory, ["Line one."])
    monkeypatch.setattr(ev, "render_block_take", lambda st, p, b, **kw: _line())
    gate = threading.Event()
    started = threading.Event()
    get_scheduler().submit([("?gate", lambda: (started.set(), gate.wait(10)))], owner=work_owner("the M4B export"))
    assert started.wait(5)
    try:
        job = render_jobs.create_job(project_id, "blocks", block_ids)
        render_jobs.start_job(job.id)
        t0 = time.time()
        while not render_jobs._live_handles.get(job.id) and time.time() - t0 < 5:
            time.sleep(0.01)
        waiting = render_jobs.job_status(job.id)["waiting"]
        assert waiting == {"lines": 1, "groups": [
            {"label": "the M4B export", "kind": "work", "model": None, "lines": 1}]}
    finally:
        gate.set()
    s = _wait_terminal(job.id)
    assert s["status"] == "completed"
    assert s["waiting"] is None


def test_a_deleted_line_is_skipped_not_rendered(job_env, monkeypatch):
    """Deleting a book, a chapter or a line takes its job rows with it (the
    database's cascade; this test DB doesn't enforce it, so the test deletes
    them). The queue then skips that line instead of rendering it and failing
    to save it (decided 2026-10-07)."""
    from justvoice.synth_scheduler import get_scheduler, work_owner

    factory = job_env
    project_id, _, block_ids = _seed_project(factory, ["Kept.", "Deleted."])
    rendered = []
    monkeypatch.setattr(ev, "render_block_take", lambda st, p, b, **kw: rendered.append(b.id) or _line())
    gate = threading.Event()
    started = threading.Event()
    get_scheduler().submit([("?gate", lambda: (started.set(), gate.wait(10)))], owner=work_owner("other work"))
    assert started.wait(5)
    try:
        job = render_jobs.create_job(project_id, "blocks", block_ids)
        render_jobs.start_job(job.id)
        t0 = time.time()
        while not render_jobs._live_handles.get(job.id) and time.time() - t0 < 5:
            time.sleep(0.01)
        db = factory()
        try:
            db.query(RenderJobBlock).filter(RenderJobBlock.block_id == block_ids[1]).delete()
            db.query(Block).filter(Block.id == block_ids[1]).delete()
            db.commit()
        finally:
            db.close()
    finally:
        gate.set()
    s = _wait_terminal(job.id)
    assert s["status"] == "completed"
    assert rendered == [block_ids[0]]


def test_a_line_loading_its_model_says_so(job_env, monkeypatch):
    """Render's "loading Qwen3-TTS CustomVoice — 8 s" (decided 2026-10-07): while
    the line rendering now loads its model, the job carries the model and how
    long; once the run ends it carries nothing."""
    from justvoice import voice_model

    factory = job_env
    project_id, _, block_ids = _seed_project(factory, ["Line one."])
    seen = {}

    def render(st, p, b, **kw):
        with voice_model._noting_load("qwen3", "qwen3-customvoice"):
            seen["during"] = render_jobs.job_status(job.id)
        return _line()

    monkeypatch.setattr(ev, "render_block_take", render)
    job = render_jobs.create_job(project_id, "blocks", block_ids)
    render_jobs.start_job(job.id)
    s = _wait_terminal(job.id)
    loading = seen["during"]["loading"]
    assert loading["model"] and loading["seconds"] >= 0
    assert s["loading"] is None


def test_a_line_deleted_while_it_renders_is_not_saved(job_env, monkeypatch):
    """The line in flight when its book is deleted finishes, and is dropped
    quietly instead of failing to save (2026-10-07)."""
    factory = job_env
    project_id, _, block_ids = _seed_project(factory, ["Deleted mid-render."])

    def render(st, p, b, **kw):
        db = factory()
        try:
            db.query(RenderJobBlock).filter(RenderJobBlock.block_id == b.id).delete()
            db.query(Block).filter(Block.id == b.id).delete()
            db.commit()
        finally:
            db.close()
        return _line()

    saved = []
    monkeypatch.setattr(render_jobs, "persist_block_take", lambda *a, **k: saved.append(a))
    monkeypatch.setattr(ev, "render_block_take", render)
    job = render_jobs.create_job(project_id, "blocks", block_ids)
    render_jobs.start_job(job.id)
    s = _wait_terminal(job.id)
    assert s["status"] == "completed"
    assert saved == []
