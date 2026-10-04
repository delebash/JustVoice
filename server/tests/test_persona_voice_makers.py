# SPDX-License-Identifier: MIT
"""The server side of the persona page's voice makers (decided 2026-10-04,
docs/plans/2026-10-04-persona-voice-making.md §3).

A persona makes its own voice: Clone, Design and Blend open on the persona's
page, and a voice not kept yet is heard *as this persona* — its language,
standing delivery, emotion, lexicon, pace, pitch, gain and effects — through
the same planning and text preparation a chapter line gets. Under test:

  * an unsaved design is planned with its description first, then the
    persona's standing delivery;
  * the candidate preview speaks the prepared line, holds the take as the
    model spoke it, and returns that take shaped by the persona;
  * a design's take can be kept on any clone model and stays a design;
  * the clip check measures length and how far speech stands above noise;
  * a designed voice sends its description.
"""

from __future__ import annotations

import asyncio
import base64
import math

import numpy as np
import pytest
from fastapi.testclient import TestClient

from justvoice import persona_render, voice_model
from justvoice.api import voice_preview_api as vp
from justvoice.app import create_app
from justvoice.app_state import get_state
from justvoice.audio.wav import parse_wav_header, write_wav_container
from justvoice.models import PersonaDraft


@pytest.fixture()
def client(tmp_path):
    return TestClient(create_app(data_dir=tmp_path), raise_server_exceptions=False)


def _tone_wav(seconds: float = 1.0, amplitude: float = 0.2, sample_rate: int = 24000) -> bytes:
    t = np.arange(int(seconds * sample_rate)) / sample_rate
    pcm = (np.sin(2 * math.pi * 220 * t) * amplitude * 32767).astype("<i2").tobytes()
    return write_wav_container(pcm, sample_rate, 1)


def _pcm(wav: bytes) -> np.ndarray:
    _fmt, offset, size = parse_wav_header(wav)
    return np.frombuffer(wav[offset:offset + size], dtype="<i2").astype(np.float64)


# ── Planning an unsaved voice ─────────────────────────────────────────────

def test_an_unsaved_design_is_planned_with_its_description_first(client):
    st = get_state()
    vm = voice_model.describe(st, "qwen3", "qwen3-vd", "en")
    plan = persona_render.plan_line(
        st, PersonaDraft(voice_instruct="Slow, unbothered.", language="en"), text=".",
        candidate=persona_render.Candidate(vm, "A gravel-voiced harbour-master", "en"),
    )
    assert plan.voice is None and plan.model == "qwen3-vd"
    assert plan.delivery["instruct"] == "A gravel-voiced harbour-master. Slow, unbothered"
    assert plan.language == "en"


# ── Hearing it as the persona ─────────────────────────────────────────────

def test_an_unsaved_voice_is_heard_as_the_persona_and_its_take_is_held(client, monkeypatch):
    raw = _tone_wav()
    heard: list[dict] = []

    async def fake_synth(body, engine, **kw):
        heard.append(kw)
        return raw, 24000, 1

    monkeypatch.setattr(vp, "synth_candidate", fake_synth)
    r = client.post("/v1/personas/preview-candidate", json={
        "persona": {
            "language": "en", "voice_instruct": "Slow, unbothered.",
            "effects_chain": [{"type": "gain", "params": {"gain_db": 6}}],
        },
        "candidate": {
            "engine": "qwen3", "model": "qwen3-vd", "source": "designed",
            "prompt": "A gravel-voiced harbour-master", "language": "en",
        },
        "text": "Mind the rope.",
    })
    assert r.status_code == 200, r.text
    body = r.json()

    # The model was sent the line as a chapter would send it, in the persona's words.
    sent = heard[-1]
    assert sent["text"] == "Mind the rope." and sent["language"] == "en"
    assert sent["delivery"]["instruct"] == "A gravel-voiced harbour-master. Slow, unbothered"

    # The take is held as the model spoke it — that is what Keep saves …
    entry = asyncio.run(vp._get_preview(body["preview_id"]))
    assert entry is not None and entry.wav_bytes == raw
    assert entry.payload["preview_text"] == "Mind the rope." and entry.payload["prompt"]

    # … and what plays is that take shaped by the persona (here, +6 dB).
    shaped = _pcm(base64.b64decode(body["wav_b64"]))
    assert np.abs(shaped).max() > np.abs(_pcm(raw)).max() * 1.5


def test_an_unsaved_voice_without_its_material_is_refused(client):
    r = client.post("/v1/personas/preview-candidate", json={
        "persona": {"language": "en"},
        "candidate": {"engine": "qwen3", "model": "qwen3-vd", "source": "designed"},
    })
    assert r.status_code == 400 and "prompt" in r.text


# ── Keeping a design's take on another model ──────────────────────────────

def _held(source: str, **payload) -> str:
    return asyncio.run(vp.store_candidate(source, payload, _tone_wav()))[0]


def test_a_designs_take_is_kept_on_another_clone_model_and_stays_a_design(client):
    pid = _held("designed", engine="qwen3", model="qwen3-vd", prompt="A harbour-master",
                preview_text="Mind the rope.", language="en")
    r = client.post(f"/v1/voices/preview/{pid}/save", json={"name": "Harbour-master", "model": "voxcpm2"})
    assert r.status_code == 200, r.text
    vid = r.json()["voice_id"]

    rec = get_state().voices.get(vid)
    assert (rec.engine, rec.model, rec.source) == ("voxcpm2", "voxcpm2", "designed")
    assert rec.design_prompt == "A harbour-master" and rec.transcript == "Mind the rope."
    assert get_state().voices.ref_wav_path(vid).exists()

    dto = client.get(f"/v1/voices/{vid}").json()
    assert dto["model"] == "voxcpm2" and dto["directed_by"] == "words"
    assert dto["design_prompt"] == "A harbour-master"


def test_only_a_design_moves_and_only_onto_a_model_that_clones(client):
    clip = base64.b64encode(_tone_wav()).decode()
    cloned = _held("cloned", engine="chatterbox", model="chatterbox-turbo", ref_wav_b64=clip, language="en")
    r = client.post(f"/v1/voices/preview/{cloned}/save", json={"name": "Marius", "model": "voxcpm2"})
    assert r.status_code == 400 and "design" in r.text

    designed = _held("designed", engine="qwen3", model="qwen3-vd", prompt="A voice", language="en")
    r = client.post(f"/v1/voices/preview/{designed}/save", json={"name": "Nope", "model": "kokoro"})
    assert r.status_code == 400 and "clip" in r.text


# ── The clip check ────────────────────────────────────────────────────────

def _speech_and_room(noise: float, seconds: float = 3.0, sample_rate: int = 16000) -> str:
    """Bursts of 'speech' (a loud tone) over a room of steady noise."""
    rng = np.random.default_rng(7)
    n = int(seconds * sample_rate)
    t = np.arange(n) / sample_rate
    room = rng.normal(0.0, noise, n)
    talking = (np.sin(2 * math.pi * 2.0 * t) > 0.2).astype(np.float64)
    speech = np.sin(2 * math.pi * 180 * t) * 0.3 * 32767 * talking
    pcm = np.clip(room + speech, -32767, 32767).astype("<i2").tobytes()
    return base64.b64encode(write_wav_container(pcm, sample_rate, 1)).decode()


def test_the_clip_check_measures_length_and_how_far_speech_stands_above_noise(client):
    clean = client.post("/v1/voices/clip-check", json={"wav_b64": _speech_and_room(noise=8)}).json()
    assert clean["seconds"] == 3.0
    assert clean["noise_margin_db"] > 40

    noisy = client.post("/v1/voices/clip-check", json={"wav_b64": _speech_and_room(noise=3000)}).json()
    assert noisy["noise_margin_db"] < 25


def test_the_clip_check_wants_a_wav(client):
    r = client.post("/v1/voices/clip-check", json={"wav_b64": base64.b64encode(b"ID3 not a wav").decode()})
    assert r.status_code == 400


# ── A designed voice sends its description ────────────────────────────────

def test_a_designed_voice_sends_its_description_and_a_clone_none(client):
    designed = client.post("/v1/voices/design", json={
        "engine": "qwen3", "model": "qwen3-vd", "name": "Old Crow",
        "prompt": "A dry, cracked old voice", "language": "en",
    })
    assert designed.status_code == 201, designed.text
    assert designed.json()["design_prompt"] == "A dry, cracked old voice"

    cloned = client.post("/v1/voices/clone", json={
        "engine": "chatterbox", "model": "chatterbox-multilingual", "name": "Marius",
        "ref_wav_b64": base64.b64encode(_tone_wav()).decode(), "language": "en",
    })
    assert cloned.status_code == 201, cloned.text
    assert cloned.json()["design_prompt"] is None
