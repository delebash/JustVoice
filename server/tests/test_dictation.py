# SPDX-License-Identifier: GPL-3.0-or-later
"""Dictation pipeline tests — captures API with a faked STT engine, plus
the refinement loop-stripper ported from voicebox (see voicebox-pin.txt).
"""

from __future__ import annotations

import io
import struct
from typing import Generator

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from justvoice.api import captures_api
from justvoice.database import get_db
from justvoice.errors import ApiError, api_exception_handler, http_exception_handler
from justvoice.refinement import (
    RefinementFlags,
    build_refinement_prompt,
    collapse_repetitive_artifacts,
)

pytest_plugins = ["tests.conftest_db"]


# ── refinement unit tests ─────────────────────────────────────────────


def test_collapse_single_word_loop():
    out = collapse_repetitive_artifacts("before URL URL URL URL URL URL URL after")
    assert "URL" not in out
    assert out.startswith("before") and out.endswith("after")


def test_collapse_phrase_loop():
    text = "intro " + "thanks for watching " * 8 + "outro"
    out = collapse_repetitive_artifacts(text)
    assert "thanks for watching" not in out
    assert "intro" in out and "outro" in out


def test_rhetorical_repetition_preserved():
    text = "no, no, no, no, no I will not"
    assert collapse_repetitive_artifacts(text) == text


def test_prompt_includes_only_enabled_sections():
    p = build_refinement_prompt(RefinementFlags(smart_cleanup=True, self_correction=False, preserve_technical=False))
    assert "Remove disfluencies" in p
    assert "changes their mind" not in p
    none = build_refinement_prompt(RefinementFlags(False, False, False))
    assert "Return the transcript unchanged" in none


# ── captures API with fake STT ────────────────────────────────────────


def _tiny_wav() -> bytes:
    sr, n = 16000, 1600  # 0.1 s of silence
    pcm = b"\x00\x00" * n
    return (
        b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVE"
        + b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, sr, sr * 2, 2, 16)
        + b"data" + struct.pack("<I", len(pcm)) + pcm
    )


class _FakeManager:
    def __init__(self):
        self.loaded = True

    def loaded_for(self, kind):
        return object() if (kind == "stt" and self.loaded) else None

    def manifests(self):
        return {"whisper": object()}

    def transcribe(self, audio_path, language=None):
        return "um hello world"


@pytest.fixture
def api_client(tmp_db, tmp_path, monkeypatch) -> Generator[tuple[TestClient, object], None, None]:
    from justvoice.app_state import AppState, set_state
    from justvoice.database import session as dbs

    # Fresh DB binding for the AppState stores; the HTTP layer uses the
    # tmp_db session via dependency override.
    monkeypatch.setattr(dbs, "engine", None)
    monkeypatch.setattr(dbs, "SessionLocal", None)
    monkeypatch.setattr(dbs, "_db_path", None)
    set_state(AppState(tmp_path))

    fake = _FakeManager()
    monkeypatch.setattr(captures_api, "get_manager", lambda: fake)

    SessionFactory, _ = tmp_db

    def _override_get_db():
        db = SessionFactory()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(captures_api.router)
    app.add_exception_handler(ApiError, api_exception_handler)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client, fake


def test_capture_upload_transcribes_and_persists(api_client, tmp_path):
    client, _fake = api_client
    r = client.post(
        "/v1/captures",
        files={"file": ("capture.wav", io.BytesIO(_tiny_wav()), "audio/wav")},
        data={"source": "recording"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["raw_transcript"] == "um hello world"
    assert body["transcript"] == "um hello world"
    assert body["duration_ms"] == 100
    # Audio landed on disk under the AppState data dir.
    assert (tmp_path / "captures").glob("*.wav")

    # List + audio round-trip.
    assert client.get("/v1/captures").json()["total"] == 1
    audio = client.get(f"/v1/captures/{body['id']}/audio")
    assert audio.status_code == 200

    # Delete removes row + file.
    assert client.delete(f"/v1/captures/{body['id']}").status_code == 200
    assert client.get("/v1/captures").json()["total"] == 0


def test_capture_upload_when_no_stt_loaded_returns_503(api_client):
    client, fake = api_client
    fake.loaded = False
    r = client.post(
        "/v1/captures",
        files={"file": ("c.wav", io.BytesIO(_tiny_wav()), "audio/wav")},
    )
    assert r.status_code == 503
    assert "loading" in r.text


def test_capture_empty_upload_400(api_client):
    client, _ = api_client
    r = client.post("/v1/captures", files={"file": ("c.wav", io.BytesIO(b""), "audio/wav")})
    assert r.status_code == 400
