# SPDX-License-Identifier: GPL-3.0-or-later
"""Phase 3 — take-atomic block render + project QC report."""

from __future__ import annotations

import struct
from typing import Generator

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from justvoice.api import project_qc_api, takes_api
from justvoice.database import get_db
from justvoice.database.models import Block, Generation, Project, Scene, Take
from justvoice.errors import ApiError, api_exception_handler, http_exception_handler

pytest_plugins = ["tests.conftest_db"]


def _wav(amplitude=0.1, sr=16000, secs=0.5) -> bytes:
    import math

    n = int(sr * secs)
    pcm = b"".join(
        struct.pack("<h", int(amplitude * 32767 * math.sin(2 * math.pi * 440 * i / sr)))
        for i in range(n)
    )
    return (
        b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVE"
        + b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, sr, sr * 2, 2, 16)
        + b"data" + struct.pack("<I", len(pcm)) + pcm
    )


@pytest.fixture
def api_client(tmp_db, tmp_path, monkeypatch) -> Generator[tuple[TestClient, object], None, None]:
    from justvoice.app_state import AppState, set_state
    from justvoice.database import session as dbs
    from justvoice.render_core import RenderedLine

    monkeypatch.setattr(dbs, "engine", None)
    monkeypatch.setattr(dbs, "SessionLocal", None)
    monkeypatch.setattr(dbs, "_db_path", None)
    set_state(AppState(tmp_path))

    # Fake renderer — 0.5 s of silence; the endpoint owns persistence.
    def _fake_render_line(state, voice, text, **kw):
        sr = 16000
        return RenderedLine(pcm=b"\x00\x00" * (sr // 2), sample_rate=sr, channels=1, effective_delivery=kw.get("delivery") or {})

    import justvoice.render_core as rc

    monkeypatch.setattr(rc, "render_line", _fake_render_line)

    SessionFactory, _ = tmp_db

    def _override_get_db():
        db = SessionFactory()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(takes_api.router)
    app.include_router(project_qc_api.router)
    app.add_exception_handler(ApiError, api_exception_handler)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app, raise_server_exceptions=False) as client:
        seed = SessionFactory()
        try:
            yield client, seed
        finally:
            seed.close()


def _seed_block(seed, text="Hello there.") -> Block:
    project = Project(name="Book", project_type="audiobook")
    seed.add(project)
    seed.flush()
    scene = Scene(project_id=project.id, position=0, title="Ch 1")
    seed.add(scene)
    seed.flush()
    block = Block(scene_id=scene.id, position=0, text=text)
    seed.add(block)
    seed.commit()
    return block


def test_block_render_creates_generation_and_take(api_client):
    client, seed = api_client
    block = _seed_block(seed)

    r = client.post(f"/v1/blocks/{block.id}/render", json={"voice": "af_bella"})
    assert r.status_code == 200, r.text
    body = r.json()
    # First take auto-defaults; no lineage parent.
    assert body["take"]["is_default"] is True
    assert body["take"]["source_take_id"] is None
    assert body["duration_sec"] == pytest.approx(0.5, abs=0.01)

    gen = seed.query(Generation).filter_by(id=body["generation_id"]).first()
    assert gen is not None and gen.block_id == block.id and gen.source == "chapter_render"

    # Second render: lineage chains off the default; default unchanged.
    r2 = client.post(f"/v1/blocks/{block.id}/render", json={"voice": "af_bella"})
    t2 = r2.json()["take"]
    assert t2["is_default"] is False
    assert t2["source_take_id"] == body["take"]["id"]

    # set_default=True promotes the new take.
    r3 = client.post(f"/v1/blocks/{block.id}/render", json={"voice": "af_bella", "set_default": True})
    t3 = r3.json()["take"]
    assert t3["is_default"] is True
    takes = client.get(f"/v1/takes/by_block/{block.id}").json()
    assert takes["default_take_id"] == t3["id"]
    assert len(takes["takes"]) == 3


def test_block_render_requires_voice_or_persona(api_client):
    client, seed = api_client
    block = _seed_block(seed)
    r = client.post(f"/v1/blocks/{block.id}/render", json={})
    assert r.status_code == 400
    assert "voice" in r.text


def test_qc_report(api_client, tmp_path):
    client, seed = api_client
    block = _seed_block(seed)

    # A rendered block with a real (quiet sine) WAV on disk → measurable.
    wav_path = tmp_path / "g1.wav"
    wav_path.write_bytes(_wav(amplitude=0.05))
    gen = Generation(
        block_id=block.id, text=block.text, engine="kokoro",
        status="completed", audio_path=str(wav_path), duration_sec=0.5,
    )
    seed.add(gen)
    seed.flush()
    seed.add(Take(block_id=block.id, generation_id=gen.id, is_default=True))
    seed.commit()

    project_id = seed.query(Project).first().id
    r = client.get(f"/v1/projects/{project_id}/qc")
    assert r.status_code == 200, r.text
    rep = r.json()
    assert len(rep["scenes"]) == 1
    row = rep["scenes"][0]
    assert row["complete"] is True
    assert row["blocks_rendered"] == 1
    # Quiet sine: peak well under -3 dBFS → peak_ok; RMS far below -23 → rms not ok.
    assert row["peak_ok"] is True
    assert row["rms_ok"] is False
    assert rep["overall_pass"] is False
    assert any("Noise floor" in n for n in rep["notes"])


def test_m4b_export_without_ffmpeg_501(api_client, monkeypatch):
    client, seed = api_client
    _seed_block(seed)
    project_id = seed.query(Project).first().id
    monkeypatch.setattr(project_qc_api, "have_ffmpeg", lambda: False)
    r = client.get(f"/v1/projects/{project_id}/export_m4b")
    assert r.status_code == 501
    assert "ffmpeg" in r.text
