# SPDX-License-Identifier: MIT
"""A voice knows its model (persona redesign P1, 2026-10-03).

Until this, a voice stored only its engine: a Chatterbox Turbo clone and a
Multilingual clone were the same voice to the app, and tags, knobs and the
render followed whichever model happened to be loaded. Now every voice names
the model that speaks it — one server answer (`voice_model.py`) for the
Voices table, the persona editor, Cast and the render.

docs/plans/2026-10-03-persona-redesign.md §5.2, §5.5, §6.3 P1.
"""

from __future__ import annotations

import base64
import math
import struct

import pytest
from fastapi.testclient import TestClient

from justvoice import voice_model as vmod
from justvoice.app import create_app
from justvoice.app_state import get_state

SR = 24000


def _wav(seconds: float) -> bytes:
    pcm = b"".join(
        struct.pack("<h", int(8000 * math.sin(2 * math.pi * 220 * i / SR)))
        for i in range(int(SR * seconds))
    )
    return (
        b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt "
        + struct.pack("<IHHIIHH", 16, 1, 1, SR, SR * 2, 2, 16)
        + b"data" + struct.pack("<I", len(pcm)) + pcm
    )


@pytest.fixture()
def client(tmp_path):
    app = create_app(data_dir=tmp_path)
    return TestClient(app, raise_server_exceptions=False)


def _voices(client) -> dict:
    r = client.get("/v1/voices")
    assert r.status_code == 200, r.text
    return {v["id"]: v for v in r.json()["voices"]}


# ── Every voice ships what speaks it ──────────────────────────────────────

def test_a_qwen3_speaker_is_directed_in_words_and_speaks_many_languages(client):
    sohee = _voices(client)["Sohee"]
    assert sohee["model"] == "qwen3-cv"
    assert sohee["directed_by"] == "words"
    assert "ko" in sohee["speaks"] and "en" in sohee["speaks"]
    assert len(sohee["speaks"]) > 1
    assert "CustomVoice" in sohee["model_name"]


def test_a_kokoro_voice_speaks_only_its_own_language(client):
    heart = _voices(client)["af_heart"]
    assert heart["model"] == "kokoro"
    assert heart["directed_by"] == "sliders"
    assert heart["speaks"] == [heart["language"]]


def test_a_clone_stores_the_model_it_was_made_for(client):
    r = client.post("/v1/voices/clone", json={
        "engine": "chatterbox", "model": "chatterbox-multilingual", "name": "Marius",
        "ref_wav_b64": base64.b64encode(_wav(6)).decode(), "language": "en",
    })
    assert r.status_code == 201, r.text
    v = r.json()
    assert v["model"] == "chatterbox-multilingual"
    assert v["directed_by"] == "sliders"
    assert len(v["speaks"]) > 1
    assert get_state().voices.get(v["id"]).model == "chatterbox-multilingual"


def test_a_clone_without_a_model_gets_the_engines_default_cloning_model(client):
    r = client.post("/v1/voices/clone", json={
        "engine": "qwen3", "name": "Mara", "transcript": "Hello there.",
        "ref_wav_b64": base64.b64encode(_wav(4)).decode(),
    })
    assert r.status_code == 201, r.text
    # CustomVoice is Qwen3's default model but cannot clone; Base can.
    assert r.json()["model"] == "qwen3-base"


def test_a_model_that_cannot_do_it_is_refused_by_name(client):
    r = client.post("/v1/voices/clone", json={
        "engine": "qwen3", "model": "qwen3-cv", "name": "X",
        "ref_wav_b64": base64.b64encode(_wav(4)).decode(),
    })
    assert r.status_code == 400
    assert "can't clone" in r.json()["detail"]
    r = client.post("/v1/voices/clone", json={
        "engine": "qwen3", "model": "kokoro", "name": "X",
        "ref_wav_b64": base64.b64encode(_wav(4)).decode(),
    })
    assert r.status_code == 400
    assert "not a qwen3 model" in r.json()["detail"]


def test_a_designed_voice_without_its_clip_is_voicedesign_and_with_it_base(client):
    r = client.post("/v1/voices/design", json={
        "engine": "qwen3", "name": "Harbourmaster", "prompt": "a gravel-voiced harbour-master",
    })
    assert r.status_code == 201, r.text
    v = r.json()
    assert v["model"] == "qwen3-vd"
    assert v["directed_by"] == "words"
    # Clip wins: freeze its preview and it speaks on Base, directed by nothing.
    get_state().voices.write_ref_wav(v["id"], _wav(3))
    again = _voices(client)[v["id"]]
    assert again["model"] == "qwen3-base"
    assert again["directed_by"] == "sliders"


# ── Copy to another model ─────────────────────────────────────────────────

def _clone(client, seconds=6.0, **extra):
    body = {
        "engine": "chatterbox", "model": "chatterbox-multilingual", "name": "Marius",
        "ref_wav_b64": base64.b64encode(_wav(seconds)).decode(), "language": "en",
    }
    body.update(extra)
    r = client.post("/v1/voices/clone", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_copying_a_clip_to_another_model_makes_a_second_voice(client):
    src = _clone(client)
    r = client.post(f"/v1/voices/{src['id']}/copy", json={
        "model": "qwen3-base", "xvector_only": True,
    })
    assert r.status_code == 201, r.text
    copy = r.json()
    assert copy["id"] != src["id"]
    assert copy["engine"] == "qwen3" and copy["model"] == "qwen3-base"
    assert copy["name"] == "Marius (Qwen3-TTS Base)"
    st = get_state()
    assert st.voices.ref_wav_path(copy["id"]).read_bytes() == st.voices.ref_wav_path(src["id"]).read_bytes()
    assert st.voices.get(copy["id"]).xvector_only is True


def test_qwen3_base_needs_the_clips_words_or_skip_the_words(client):
    src = _clone(client)
    r = client.post(f"/v1/voices/{src['id']}/copy", json={"model": "qwen3-base"})
    assert r.status_code == 400
    assert "Skip the words" in r.json()["detail"]
    r = client.post(f"/v1/voices/{src['id']}/copy", json={
        "model": "qwen3-base", "transcript": "The tide turned below the floorboards.",
    })
    assert r.status_code == 201, r.text


def test_a_model_that_cannot_clone_is_refused(client):
    src = _clone(client)
    r = client.post(f"/v1/voices/{src['id']}/copy", json={"model": "qwen3-cv"})
    assert r.status_code == 400
    assert "can't clone" in r.json()["detail"]


def test_a_voice_with_no_clip_cannot_be_copied(client):
    r = client.post("/v1/voices/design", json={
        "engine": "qwen3", "name": "Wren", "prompt": "a bright young voice",
    })
    r = client.post(f"/v1/voices/{r.json()['id']}/copy", json={"model": "voxcpm2"})
    assert r.status_code == 400
    assert "no clip" in r.json()["detail"]


def test_turbo_and_nano_need_a_clip_longer_than_five_seconds(client, monkeypatch):
    """Turbo isn't in the pinned runtime yet, so its catalog row is put in."""
    real = vmod.models_of_engine
    monkeypatch.setattr(vmod, "models_of_engine", lambda e: real(e) + (
        ["chatterbox-turbo"] if e == "chatterbox" else []))
    src = _clone(client, seconds=4.0)
    r = client.post(f"/v1/voices/{src['id']}/copy", json={"model": "chatterbox-turbo"})
    assert r.status_code == 400
    assert "longer than 5 seconds" in r.json()["detail"]
    assert "4.0 s" in r.json()["detail"]


# ── The variant a render loads ────────────────────────────────────────────

def test_the_variant_follows_the_model_and_keeps_the_size(monkeypatch):
    class _Mgr:
        def current_for(self, kind):
            return None

        def current_variant_id(self, e):
            return None

        def resolved_default_variant(self, e):
            return "qwen3-cv-0.6b-q8"

        def manifests(self):
            from justvoice.engines.manager import discover_engines

            return discover_engines()

        def get_manifest(self, e):
            return self.manifests().get(e)

    monkeypatch.setattr("justvoice.engines.manager.get_manager", lambda: _Mgr())
    monkeypatch.setattr(vmod, "_on_disk", lambda e, v: v in {"qwen3-base-1.7b-q8", "qwen3-base-0.6b-q8"})
    # The user's 0.6B default is CustomVoice; a Base voice gets Base 0.6B.
    assert vmod.variant_for_model("qwen3", "qwen3-base") == "qwen3-base-0.6b-q8"
    # Nothing of the family on disk: the same pick among its catalog rows,
    # and the load fetches the file.
    monkeypatch.setattr(vmod, "_on_disk", lambda e, v: False)
    assert vmod.variant_for_model("qwen3", "qwen3-vd").startswith("qwen3-vd-")


def test_pocket_picks_its_model_by_language(monkeypatch):
    monkeypatch.setattr(vmod, "_on_disk", lambda e, v: True)
    assert vmod.variant_for_model("pocket", "pocket", "de-DE").startswith("pocket-de-")
    with pytest.raises(vmod.ModelUnavailable):
        vmod.variant_for_model("pocket", "pocket", "ja")
