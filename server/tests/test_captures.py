# SPDX-License-Identifier: MIT
"""Captures backend (parity gaps G1/G2) — upload→transcribe→refine flow
with the STT engine faked (no models in CI). Refinement's deterministic
pre-pass is tested directly."""

from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient
from llm_runner.llm import LLMNotConfiguredError

from justvoice.app import create_app
from justvoice.database.seed import seed_workspace


@pytest.fixture()
def client(tmp_path, monkeypatch):
    app = create_app(data_dir=tmp_path)
    seed_workspace()
    # Fake the engine round-trip — STT correctness is the engine's concern;
    # here we test the API contract.
    monkeypatch.setattr(
        "justvoice.api.captures_api._stt_transcribe",
        lambda audio_path, language: "um hello hello world",
    )
    # No LLM provider in CI — refinement must degrade to the raw transcript.
    return TestClient(app, raise_server_exceptions=False)


def _wav() -> bytes:
    return b"RIFF0000WAVEfmt "


def test_transcribe_stateless(client) -> None:
    r = client.post("/v1/transcribe", files={"file": ("a.wav", io.BytesIO(_wav()), "audio/wav")})
    assert r.status_code == 200
    assert r.json()["text"] == "um hello hello world"


def test_capture_crud_and_refine_degrades(client, monkeypatch) -> None:
    # The behaviour under test is "refinement unavailable -> fall back to raw",
    # so the unavailability is FORCED rather than assumed. This previously leaned
    # on "no provider registered in CI" being true of the machine, which made it
    # pass for the wrong reason — and it failed the moment this box had a working
    # local LLM, because refinement really ran and returned "Hello, hello world."
    # instead of the raw text.
    import llm_runner.llm.dispatch as dispatch

    def refuse(*_a, **_kw):
        raise LLMNotConfiguredError("no LLM provider registered")

    monkeypatch.setattr(dispatch, "chat", refuse)

    r = client.post(
        "/v1/captures",
        files={"file": ("a.wav", io.BytesIO(_wav()), "audio/wav")},
        data={"source": "upload"},
    )
    assert r.status_code == 201, r.text
    row = r.json()
    # auto_refine is on but refinement cannot reach a provider — the transcript
    # must fall back to raw, never None.
    assert row["raw_transcript"] == "um hello hello world"
    assert row["transcript"] == "um hello hello world"
    assert row["refinement_flags"]["smart_cleanup"] is True

    lst = client.get("/v1/captures").json()
    assert lst["total"] == 1

    audio = client.get(row["audio_url"])
    assert audio.status_code == 200 and audio.content.startswith(b"RIFF")

    rt = client.post(f"/v1/captures/{row['id']}/retranscribe")
    assert rt.status_code == 200

    d = client.delete(f"/v1/captures/{row['id']}")
    assert d.status_code == 200
    assert client.get("/v1/captures").json()["total"] == 0


def test_collapse_repetitive_artifacts() -> None:
    from justvoice.refinement import collapse_repetitive_artifacts as collapse

    # 6+ token loop dropped; rhetorical 5x kept.
    assert collapse("ok URL URL URL URL URL URL done") == "ok done"
    assert "no, no, no, no, no" in collapse("I said no, no, no, no, no to that")
    # character-level CJK loop
    assert collapse("end 谢谢观看谢谢观看谢谢观看谢谢观看谢谢观看谢谢观看 fin") == "end fin"
    # emphasized single letters survive (2-char lower bound)
    assert collapse("wooooooow") == "wooooooow"


def test_compose_refinement_system_toggles(tmp_path) -> None:
    # F1 Phase 2: the system assembles from the TEMPLATE ROWS (refine.base +
    # enabled section rows); the no-sections identity line lives in the base
    # row itself, so flags-all-off still states it.
    from fastapi.testclient import TestClient

    from justvoice.app import create_app
    from justvoice.refinement import RefinementFlags, compose_refinement_system

    TestClient(create_app(data_dir=tmp_path), raise_server_exceptions=False)
    seed_workspace()
    all_on = compose_refinement_system(RefinementFlags())
    assert "self" in all_on.lower() and "technical" in all_on.lower()
    none_on = compose_refinement_system(
        RefinementFlags(smart_cleanup=False, self_correction=False, preserve_technical=False)
    )
    assert "return the transcript unchanged" in none_on.lower()
    assert "technical" not in none_on.lower()
