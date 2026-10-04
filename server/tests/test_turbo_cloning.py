# SPDX-License-Identifier: MIT
"""Chatterbox Turbo and Nano clone again (gap 1, docs/plans/2026-10-03-gap-1-turbo-cloning.md):
our audio.cpp clones on Turbo from a file converted from Resemble's own checkpoint. Turbo and
Nano get their capability rows back (the pre-switch ones minus training), the slot maps a
cloned voice and refuses on an older runtime by name, and a Load warms the built-in voice so
the memory is booked."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from justvoice.engines.audiocpp import release, runtime, slot
from justvoice.engines.capability_details import CAPABILITY_DETAILS, lookup
from justvoice.render_core import _apply_emotion_tag

TURBO = {"id": "chatterbox-turbo-q8", "name": "Chatterbox Turbo (350M, English)",
         "audiocpp": {"family": "chatterbox_turbo", "task": "tts", "file": "t.gguf"}}


def test_turbo_clone_is_the_third_build_of_ours(monkeypatch):
    for tag, expect in (("v0.9.0", False), ("v0.9.0-jv.2", False), ("v0.9.0-jv.3", True), (None, False)):
        monkeypatch.setattr(runtime, "installed_tag", lambda backend=None, t=tag: t)
        assert runtime.has_feature("turbo_clone") is expect, tag
    monkeypatch.setattr(release, "TAG", "v0.9.0-jv.2")
    assert release.pinned_has("turbo_clone") is False
    monkeypatch.setattr(release, "TAG", "v0.9.0-jv.3")
    assert release.pinned_has("turbo_clone") is True


@pytest.mark.parametrize("variant, name", [
    ("chatterbox-turbo-q8", "Chatterbox Turbo"), ("chatterbox-turbo-f16", "Chatterbox Turbo"),
    ("chatterbox-nano-q8", "Chatterbox Nano"), ("chatterbox-nano-f16", "Chatterbox Nano"),
])
def test_turbo_and_nano_variants_reach_their_own_rows(variant, name):
    row = lookup(variant)
    assert row.display_name == name and row.engine_id == name.lower().replace(" ", "-")
    assert row.supports_voice_cloning is True
    # Turbo's own sampling knobs; exaggeration / CFG / min-p do nothing on Turbo.
    assert {k.key for k in row.knobs} == {"temperature", "repetition_penalty", "top_p", "top_k", "seed"}


def test_the_nineteen_tags_are_turbos_and_multilingual_keeps_none():
    tags = [t for ts in CAPABILITY_DETAILS["chatterbox-turbo"].inline_tags for t in ts.tags]
    assert len(tags) == len(set(tags)) == 19
    assert {"laugh", "clear throat", "whispering", "narration"} <= set(tags)
    assert CAPABILITY_DETAILS["chatterbox-nano"].inline_tags == CAPABILITY_DETAILS["chatterbox-turbo"].inline_tags
    assert lookup("chatterbox-multilingual-v2-q8").inline_tags == []


def test_an_emotion_compiles_to_turbos_token():
    emotion = CAPABILITY_DETAILS["chatterbox-turbo"].inline_tags[0]
    assert _apply_emotion_tag("Who's there?", {"emotion": "fearful"}, emotion).startswith("[fear]")
    assert _apply_emotion_tag("A line.", {"emotion": "sad"}, emotion) == "A line."   # no token for sad


def test_a_cloned_voice_maps_to_voice_ref_and_turbos_knobs():
    req = slot.to_speech_request(TURBO, {
        "text": "Hello there.", "seed": 7, "audio_prompt_path": "C:\\voices\\mara.wav",
        "delivery": {"temperature": 0.7, "engine": {"top_k": 500.0, "top_p": 0.9, "repetition_penalty": 1.3,
                                                     "exaggeration": 0.8, "cfg_weight": 0.3}}})
    assert req == {"model": "chatterbox-turbo-q8", "input": "Hello there.", "seed": 7,
                   "voice_ref": "C:/voices/mara.wav",
                   "options": {"repetition_penalty": 1.3, "top_p": 0.9, "top_k": 500, "temperature": 0.7}}


def test_a_voice_without_a_clip_is_refused_by_name():
    with pytest.raises(slot.AudioCppError, match="Chatterbox Turbo .* speaks only cloned voices"):
        slot.to_speech_request(TURBO, {"text": "Hi.", "voice_id": "anything"})


class _Slot(slot.AudioCppSlot):
    def __init__(self):
        self.manifest = SimpleNamespace(name="Chatterbox", id="chatterbox", module=SimpleNamespace())
        self._row = TURBO
        self.placement = "gpu"
        self.sent = []

    def is_alive(self):
        return True

    def _srv(self):
        return SimpleNamespace(speech=lambda req: self.sent.append(req) or (b"", {}))


def test_an_older_runtime_refuses_turbo_by_name(monkeypatch):
    from justvoice.engines.audiocpp import release

    monkeypatch.setattr(runtime, "has_feature", lambda name, backend=None: False)
    monkeypatch.setattr(release, "pinned_has", lambda f: True)
    r = _Slot()._synth({"text": "Hi.", "audio_prompt_path": "C:/v.wav"})
    assert r.status_code == 409 and "speech runtime update" in r.json()["detail"]
    monkeypatch.setattr(release, "pinned_has", lambda f: False)
    r = _Slot()._synth({"text": "Hi.", "audio_prompt_path": "C:/v.wav"})
    assert r.status_code == 409 and "Chatterbox Turbo and Nano voices" in r.json()["detail"]


def test_a_load_warms_the_built_in_voice():
    s = _Slot()
    s._warm()
    assert s.sent == [{"model": "chatterbox-turbo-q8", "input": "Ready.", "seed": 1}]
