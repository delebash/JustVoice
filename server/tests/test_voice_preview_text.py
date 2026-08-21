# SPDX-License-Identifier: MIT
"""POST /v1/voices/{id}/preview with your own line + knobs (Slice B).

The audition panel types a line and turns knobs, so the endpoint grew an
optional `{text, delivery}` body and a small rendered-audition cache. The
rules under test:

  * your text reaches the synth, and a repeat listen is served from cache
    rather than paid for again;
  * changing ANY knob is a different sound, so it is a different key;
  * a chapter pasted into the audition box is refused with a readable
    message rather than synthesized;
  * no body at all is still the canned audition, byte-for-byte.
"""

from __future__ import annotations

import pytest
from fastapi import Response
from fastapi.testclient import TestClient

from justvoice.api import voice_preview_api
from justvoice.app import create_app


@pytest.fixture()
def client(tmp_path):
    app = create_app(data_dir=tmp_path)
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture()
def synth_calls(monkeypatch):
    """Stand in for the manager synth seam; records every request that got
    as far as an actual render."""
    import justvoice.api.generate_api as gen
    from justvoice.engines import manager as mgr_mod

    monkeypatch.setattr(mgr_mod.get_manager(), "current_id", lambda: "kokoro")
    # Kokoro moved to per-engine venv isolation (2026-08-19, the numpy>=2
    # clash) — is_installed now probes engines/kokoro/.venv, which no test
    # machine has. These tests exercise the audition surface, not install
    # state; before the move they only passed by riding the dev machine's
    # shared venv.
    monkeypatch.setattr(
        mgr_mod.EngineManifest, "is_installed", property(lambda self: True)
    )
    calls: list[tuple[str, dict]] = []

    async def fake_via_manager(engine_id, req, voice_fields=None):
        calls.append((req.text, req.delivery.model_dump(exclude_none=True) if req.delivery else {}))
        return Response(content=b"RIFFfake", media_type="audio/wav")

    monkeypatch.setattr(gen, "_generate_via_manager", fake_via_manager)
    return calls


def test_custom_text_renders_then_serves_from_cache(client, synth_calls):
    body = {"text": "The fog came in over the pier."}

    first = client.post("/v1/voices/af_heart/preview", json=body)
    assert first.status_code == 200, first.text
    assert synth_calls == [("The fog came in over the pier.", {})]

    before = voice_preview_api.audition_cache_hits
    second = client.post("/v1/voices/af_heart/preview", json=body)

    assert second.status_code == 200
    assert second.content == first.content
    assert voice_preview_api.audition_cache_hits == before + 1
    # The second listen never reached the engine.
    assert len(synth_calls) == 1


def test_a_changed_knob_is_a_different_audition(client, synth_calls):
    client.post("/v1/voices/af_heart/preview", json={"text": "Same line.", "delivery": {"speed": 1.0}})
    client.post("/v1/voices/af_heart/preview", json={"text": "Same line.", "delivery": {"speed": 1.4}})

    assert len(synth_calls) == 2
    assert synth_calls[0][1] == {"speed": 1.0}
    assert synth_calls[1][1] == {"speed": 1.4}


def test_engine_private_knobs_survive_the_trip(client, synth_calls):
    """Engines read their own knobs from `delivery.engine`, so the subdict
    has to reach the synth intact — dropping it is how a turned knob ends up
    changing nothing."""
    client.post(
        "/v1/voices/af_heart/preview",
        json={"text": "Line.", "delivery": {"speed": 1.1, "engine": {"exaggeration": 1.4}}},
    )

    assert synth_calls[0][1] == {"speed": 1.1, "engine": {"exaggeration": 1.4}}


def test_key_ignores_delivery_key_order(client, synth_calls):
    client.post(
        "/v1/voices/af_heart/preview",
        json={"text": "Same line.", "delivery": {"speed": 1.1, "pitch": 2}},
    )
    client.post(
        "/v1/voices/af_heart/preview",
        json={"text": "Same line.", "delivery": {"pitch": 2, "speed": 1.1}},
    )

    # Same sound, one render — the key canonicalizes the dict.
    assert len(synth_calls) == 1


def test_a_pasted_chapter_is_refused_readably(client, synth_calls):
    from justvoice.app_state import get_state

    limits = get_state().settings.get().limits
    too_long = "x" * (max(300, limits.text_max_chars) + 1)

    r = client.post("/v1/voices/af_heart/preview", json={"text": too_long})

    assert r.status_code == 400
    assert "not a chapter" in r.text
    assert synth_calls == []


def test_no_body_is_still_the_canned_audition(client, synth_calls):
    r = client.post("/v1/voices/af_heart/preview")

    assert r.status_code == 200, r.text
    assert synth_calls == [(voice_preview_api.PREVIEW_LINE_DEFAULT, {})]


def test_the_floor_holds_when_the_operator_clamps_generation(client, synth_calls):
    """An operator who clamps generation to a short line still gets a usable
    audition — the floor is what keeps the panel from becoming unusable."""
    r = client.patch("/v1/settings", json={"limits": {"text_max_chars": 40}})
    assert r.status_code == 200, r.text

    line = "y" * 250  # over the operator's limit, under the audition floor
    r = client.post("/v1/voices/af_heart/preview", json={"text": line})

    assert r.status_code == 200, r.text
    assert synth_calls == [(line, {})]
