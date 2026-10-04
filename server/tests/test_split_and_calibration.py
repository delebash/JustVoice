# SPDX-License-Identifier: MIT
"""Bound the work, then price it (audit 2026-10-04 §13.3, docs/plans/2026-10-04-audiocpp-switch-audit.md):
a split size per model, a fixed seed for a description voice, and the calibrating warm-up a
model with no price on the card measures its peak with. The load order and the price itself
are pinned in test_engine_vram_wiring.py."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

import justvoice.engines.manager as manager_module
from justvoice.engines.audiocpp import slot as slot_mod
from justvoice.engines.audiocpp.runtime import AudioCppError
from justvoice.engines.manager import EngineManager, discover_engines
from justvoice.engines.registry import EngineRegistry
from justvoice.render_core import description_seed, probe_line_cached, render_line

# ─── the split size ──────────────────────────────────────────────────────────


def _settings_state(monkeypatch, overrides=None, cap=800):
    import justvoice.app_state as app_state

    settings = SimpleNamespace(
        engines=SimpleNamespace(engine_overrides={
            eid: SimpleNamespace(split_chars=dict(v)) for eid, v in (overrides or {}).items()}),
        generation=SimpleNamespace(max_chunk_chars=cap),
    )
    monkeypatch.setattr(app_state, "get_state",
                        lambda: SimpleNamespace(settings=SimpleNamespace(get=lambda: settings)))


def test_a_models_split_size_comes_from_the_user_then_the_catalog(monkeypatch):
    _settings_state(monkeypatch, {"qwen3": {"qwen3-cv-1.7b-q8": 120}})
    mgr = EngineManager()
    assert mgr.split_chars_for("qwen3", "qwen3-cv-1.7b-q8") == 120          # the user's
    assert mgr.split_chars_for("qwen3", "qwen3-base-1.7b-q8") == 200        # the catalog's
    assert mgr.split_chars_for("qwen3", "qwen3-base-1.7b-bf16") == 200      # 16-bit rows inherit it
    assert mgr.split_chars_for("qwen3", "qwen3-vd-1.7b-q8") is None         # waits for the ear
    assert mgr.split_chars_for("voxcpm2", "voxcpm2-q8") == 200
    assert mgr.split_chars_for("kokoro", "kokoro-82m-q8") == 240
    assert mgr.split_chars_for("chatterbox", "chatterbox-multilingual-v2-q8") is None
    assert mgr.effective_split("qwen3", "qwen3-vd-1.7b-q8") == 800          # the global cap
    _settings_state(monkeypatch, {}, cap=150)
    assert mgr.effective_split("qwen3", "qwen3-cv-1.7b-q8") == 150          # never above the cap


# ─── the render: pieces of the model's length; a description voice's seed ────


class _Mgr:
    def __init__(self, split):
        self.split = split
        self.synths = []
        self.m = SimpleNamespace(id="mock-tts", kind="tts", capabilities={"paralinguistic_tags": False},
                                 static_voices=[{"id": "mv_1", "name": "MV"}])

    def get_manifest(self, engine_id):
        return self.m if engine_id == "mock-tts" else None

    def manifests(self):
        return {"mock-tts": self.m}

    def current_for(self, kind):
        return "mock-tts"

    def current_variant_id(self, engine_id):
        return "v1"

    def split_chars_for(self, engine_id, variant):
        return self.split

    def load(self, *a, **k):
        return {}

    def synth(self, engine_id, body):
        self.synths.append(dict(body))
        return b"\x00\x01" * 100, {"sample_rate": 16000, "channels": 1, "is_wav_container": False}


class _Cache:
    def __init__(self):
        self.d = {}

    def has(self, scope, key):
        return (scope, key) in self.d

    def get(self, scope, key):
        return self.d.get((scope, key))

    def put(self, scope, key, data):
        self.d[(scope, key)] = data


def _state(tmp_path, *, cache=None, designed=False):
    settings = SimpleNamespace(limits=SimpleNamespace(text_max_chars=5000),
                               cache=SimpleNamespace(enabled=cache is not None),
                               generation=SimpleNamespace(max_chunk_chars=800, crossfade_ms=50))
    stored = SimpleNamespace(id="d1", engine="mock-tts", source="designed",
                             design_prompt="A gravel-voiced harbour-master.")
    voices = SimpleNamespace(get=lambda vid: stored if designed and vid == "d1" else None,
                             ref_wav_path=lambda vid: tmp_path / "no-clip.wav")
    st = SimpleNamespace(settings=SimpleNamespace(get=lambda: settings), engines=EngineRegistry(),
                         voices=voices, lexicons=SimpleNamespace(get=lambda lid: None))
    if cache is not None:
        st._render_cache = cache
    return st


LONG = ("The ferry was late again, and nobody on the quay looked surprised. Marius set the lamp "
        "on the table and counted the doors until the ninth. The fog came in over the pier.")


def test_a_long_line_goes_to_the_model_in_its_own_piece_length(monkeypatch, tmp_path):
    mgr = _Mgr(split=70)
    monkeypatch.setattr(manager_module, "get_manager", lambda: mgr)
    render_line(_state(tmp_path), voice="mv_1", text=LONG)
    assert len(mgr.synths) >= 3 and all(len(b["text"]) <= 70 for b in mgr.synths)
    mgr.synths.clear()
    mgr.split = None                                       # a model with none: the global cap
    render_line(_state(tmp_path), voice="mv_1", text=LONG)
    assert len(mgr.synths) == 1


def test_a_description_voice_keeps_one_seed_and_the_full_length(monkeypatch, tmp_path):
    mgr = _Mgr(split=70)
    monkeypatch.setattr(manager_module, "get_manager", lambda: mgr)
    cache = _Cache()
    st = _state(tmp_path, cache=cache, designed=True)
    assert probe_line_cached(st, "d1", LONG, cache_scope="s") is False
    render_line(st, voice="d1", text=LONG, cache_scope="s")
    # Its voice is drawn from the description on every request: one piece, one fixed seed.
    assert len(mgr.synths) == 1 and mgr.synths[0]["seed"] == description_seed("d1")
    assert probe_line_cached(st, "d1", LONG, cache_scope="s") is True     # the probe agrees
    render_line(st, voice="d1", text=LONG, cache_scope="s", seed=7)       # a set seed still wins
    assert mgr.synths[-1]["seed"] == 7


def test_a_description_seed_is_stable_and_per_voice():
    assert description_seed("d1") == description_seed("d1")
    assert description_seed("d1") != description_seed("d2")
    assert 0 <= description_seed("d1") <= 0x7FFFFFFF


# ─── the calibrating warm-up ─────────────────────────────────────────────────


class _Srv:
    def __init__(self, fail=None):
        self.calls = []
        self.fail = fail

    def speech(self, body):
        if self.fail:
            raise AudioCppError(self.fail)
        self.calls.append(body)
        return b"", {}

    def transcribe(self, body):
        self.calls.append(body)
        return {"text": ""}


def _slot(monkeypatch, engine, variant, srv):
    s = slot_mod.AudioCppSlot.__new__(slot_mod.AudioCppSlot)
    s.manifest = discover_engines()[engine]
    s._row = next(r for r in s.manifest.module.VARIANTS if r["id"] == variant)
    monkeypatch.setattr(slot_mod.AudioCppSlot, "_srv", lambda self: srv)
    return s


@pytest.mark.parametrize("engine, variant, chars, longest", [
    ("qwen3", "qwen3-cv-1.7b-q8", 200, 200),
    ("qwen3", "qwen3-vd-1.7b-q8", 800, 800),
    ("voxcpm2", "voxcpm2-q8", 200, 200),
    ("kokoro", "kokoro-82m-q8", 800, 240),          # never past audio.cpp's own budget
    ("kitten", "kitten-mini-0.8", 800, 400),
])
def test_a_calibrating_warm_up_is_a_full_length_piece(monkeypatch, engine, variant, chars, longest):
    srv = _Srv()
    s = _slot(monkeypatch, engine, variant, srv)
    assert s._warm(chars) is True
    text = srv.calls[0]["input"].removeprefix("(A calm, clear voice)")
    assert longest - 40 <= len(text) <= longest
    srv.calls.clear()
    assert s._warm(0) is False and srv.calls[0]["input"].endswith("Ready.")


def test_voicedesign_warms_from_words_and_a_clip_only_family_cannot_calibrate(monkeypatch):
    srv = _Srv()
    s = _slot(monkeypatch, "qwen3", "qwen3-vd-1.7b-q8", srv)
    s._warm(0)
    assert srv.calls[0]["instructions"] and "options" not in srv.calls[0]
    srv.calls.clear()
    s = _slot(monkeypatch, "chatterbox", "chatterbox-multilingual-v2-q8", srv)
    assert s._warm(200) is False and srv.calls == []
    s = _slot(monkeypatch, "qwen3", "qwen3-base-1.7b-q8", srv)
    assert s._warm(200) is False and srv.calls == []


def test_speech_recognition_calibrates_with_its_own_chunk_of_audio(monkeypatch):
    import wave

    srv = _Srv()
    s = _slot(monkeypatch, "asr", "qwen3-asr-1.7b-q8", srv)
    assert s._warm(800) is True
    with wave.open(srv.calls[0]["audio"]) as w:
        assert round(w.getnframes() / w.getframerate()) == 30


def test_a_failed_warm_up_fails_the_load(monkeypatch):
    # Until 2026-10-04 it was logged and the Load said ready (audit §5 B4).
    s = _slot(monkeypatch, "kokoro", "kokoro-82m-q8", _Srv(fail="out of memory"))
    with pytest.raises(AudioCppError, match="out of memory"):
        s._warm(0)
