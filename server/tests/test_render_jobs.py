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
from llm_runner.platform import install_error_handlers

pytest_plugins = ["tests.conftest_db"]

_TERMINAL = ("completed", "failed", "cancelled")


def _fake_state():
    return SimpleNamespace(
        personas=SimpleNamespace(get=lambda pid: None),
        engines=SimpleNamespace(current=lambda: "fake-engine"),
        voices=SimpleNamespace(get=lambda vid: None),
    )


@pytest.fixture
def job_env(tmp_db, monkeypatch):
    """Point render_jobs at the test DB + a fake app state."""
    factory, _ = tmp_db
    monkeypatch.setattr(db_session_mod, "SessionLocal", factory)
    monkeypatch.setattr(app_state_mod, "get_state", _fake_state)
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
    monkeypatch.setattr(ev, "_render_block_production", lambda st, p, b: b"\x00" * 100)

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
    finally:
        db.close()


def test_failed_block_is_isolated(job_env, monkeypatch):
    factory = job_env
    project_id, _, block_ids = _seed_project(factory, ["Fine.", "BOOM"])

    def render(st, persona, block):
        if block.text == "BOOM":
            raise RuntimeError("engine exploded")
        return b"\x00" * 100

    monkeypatch.setattr(ev, "_render_block_production", render)
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

    def flaky(st, persona, block):
        calls.append(block.text)
        if block.text == "BOOM" and calls.count("BOOM") == 1:
            raise RuntimeError("first attempt fails")
        return b"\x00" * 100

    monkeypatch.setattr(ev, "_render_block_production", flaky)
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

    def slow(st, persona, block):
        entered.set()
        release.wait(5)
        return b"\x00" * 100

    monkeypatch.setattr(ev, "_render_block_production", slow)
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
    monkeypatch.setattr(ev, "_render_block_production", lambda st, p, b: b"\x00" * 100)

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
