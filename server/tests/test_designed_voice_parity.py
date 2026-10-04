# SPDX-License-Identifier: MIT
"""Designed voices reach an engine — frozen as a clone, or dynamic as prose.

Three defects landed together on 2026-08-22, all of them in the gap between
"the Designer works" and "a designed voice renders":

**A — the save discarded the audio.** `save_preview` held the rendered
preview in `entry.wav_bytes` and wrote `ref.wav` only for a clone's uploaded
clip, so the one artifact that could have pinned a designed identity was
dropped on the floor. VoiceDesign re-invents the speaker on every call, so
without the freeze a chapter drifted speaker by speaker.

**J — the description reached nothing.** `voice_synth_fields` documented that
a designed voice's description "rides `delivery.instruct` through
compose_instruct, like any other prose". No call site implemented it. A saved
designed voice contributed literally nothing to a render, and on the
VoiceDesign checkpoint the engine refused the line outright whenever the
persona's own instruct field was empty.

**E — a mixed cast failed per line.** Qwen3 keeps one checkpoint resident, so
a cast mixing preset (CustomVoice), cloned (Base) and clip-less designed
(VoiceDesign) voices cannot render in one pass. It used to discover this deep
inside the engine, after the render had started, in a message naming no voice;
from 2026-08-22 the chapter refused up front; since 2026-10-03 every voice
names its model (voice_model.py) and the chapter renders model by model.

Also here: **C**, the paralinguistic-tag flag Qwen3 never earned.
"""

from __future__ import annotations

import inspect
import math
import struct
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app
from justvoice.app_state import get_state
from justvoice.database.seed import seed_workspace
from justvoice.models import VoiceRecord
from justvoice.render_core import (
    voice_design_instruct,
    voice_design_instruct_for_id,
    voice_synth_fields,
)
from justvoice.voice_model import model_key, model_of_variant, voice_model

SR = 24000


@pytest.fixture()
def client(tmp_path):
    app = create_app(data_dir=tmp_path)
    seed_workspace()
    return TestClient(app, raise_server_exceptions=False)


def _wav(seconds: float = 0.25) -> bytes:
    pcm = b"".join(
        struct.pack("<h", int(9000 * math.sin(2 * math.pi * 220 * i / SR)))
        for i in range(int(SR * seconds))
    )
    return (
        b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt "
        + struct.pack("<IHHIIHH", 16, 1, 1, SR, SR * 2, 2, 16)
        + b"data" + struct.pack("<I", len(pcm)) + pcm
    )


def _store(state, **kw) -> VoiceRecord:
    now = datetime.now(timezone.utc)
    base = dict(
        id="", engine="qwen3", source="designed", name="Harbourmaster",
        language="en-US", created_at=now, updated_at=now,
    )
    base.update(kw)
    return state.voices.create(VoiceRecord(**base))


# ── A — the freeze bridge ──────────────────────────────────────────────

def _seed_designed_preview(wav: bytes, **payload_extra) -> str:
    """Put a rendered designed candidate in the preview LRU and return its id.

    Goes in directly rather than through POST /v1/voices/preview because that
    door needs a loaded engine to render; what is under test is what `save`
    does with audio it already has.
    """
    from justvoice.api import voice_preview_api as vp

    payload = {
        "engine": "qwen3",
        "source": "designed",
        "prompt": "a gravel-voiced harbour-master in his seventies, unhurried",
        "preview_text": "The tide turns at four, and not a minute later.",
        "language": "en-US",
    }
    payload.update(payload_extra)
    entry = vp._PreviewEntry(source="designed", payload=payload, wav_bytes=wav)
    preview_id = "prv_test_designed"
    vp._PREVIEW_LRU[preview_id] = entry
    return preview_id


def test_saving_a_designed_preview_freezes_its_clip(client) -> None:
    """The audio the Designer just rendered becomes the voice's ref.wav."""
    preview_id = _seed_designed_preview(_wav())

    r = client.post(
        f"/v1/voices/preview/{preview_id}/save", json={"name": "Harbourmaster"}
    )
    assert r.status_code == 200, r.text
    voice_id = r.json()["voice_id"]

    state = get_state()
    assert state.voices.ref_wav_path(voice_id).is_file()
    assert state.voices.ref_wav_path(voice_id).read_bytes() == _wav()


def test_a_frozen_designed_voice_keeps_the_line_its_clip_speaks(client) -> None:
    """`transcript` is what makes the clip an ICL clone source, and for a
    designed voice that text is `preview_text`, not the clone field."""
    preview_id = _seed_designed_preview(_wav())
    r = client.post(
        f"/v1/voices/preview/{preview_id}/save", json={"name": "Harbourmaster"}
    )
    rec = get_state().voices.get(r.json()["voice_id"])
    assert rec.transcript == "The tide turns at four, and not a minute later."
    # The description survives too — export requires it, the table shows it,
    # and it is the provenance of a voice with no recording behind it.
    assert rec.design_prompt.startswith("a gravel-voiced harbour-master")


def test_a_frozen_designed_voice_renders_as_a_clone(client) -> None:
    """Clip wins: once frozen, the identity comes from the audio."""
    preview_id = _seed_designed_preview(_wav())
    r = client.post(
        f"/v1/voices/preview/{preview_id}/save", json={"name": "Harbourmaster"}
    )
    state = get_state()
    rec = state.voices.get(r.json()["voice_id"])

    fields = voice_synth_fields(state, rec)
    assert fields["audio_prompt_path"].endswith("ref.wav")
    assert fields["ref_text"] == "The tide turns at four, and not a minute later."
    # …and its description must NOT also be spoken as direction.
    assert voice_design_instruct(state, rec) is None


# ── J — the clip-less half stays dynamic ───────────────────────────────

def test_a_clipless_designed_voice_contributes_its_description(client) -> None:
    state = get_state()
    rec = _store(state, design_prompt="a gravel-voiced harbour-master, unhurried")
    assert voice_design_instruct(state, rec) == (
        "a gravel-voiced harbour-master, unhurried"
    )
    assert voice_design_instruct_for_id(state, rec.id) == (
        "a gravel-voiced harbour-master, unhurried"
    )
    # It has no clip, so it contributes no synth inputs at all.
    assert voice_synth_fields(state, rec) == {}


def test_only_designed_voices_contribute_a_description(client) -> None:
    state = get_state()
    cloned = _store(state, source="cloned", design_prompt="ignored")
    assert voice_design_instruct(state, cloned) is None
    assert voice_design_instruct_for_id(state, "no-such-voice") is None
    assert voice_design_instruct_for_id(state, None) is None
    assert voice_design_instruct(state, None) is None


def test_an_empty_description_is_not_an_instruct(client) -> None:
    state = get_state()
    blank = _store(state, design_prompt="   ")
    assert voice_design_instruct(state, blank) is None
    none = _store(state, design_prompt=None)
    assert voice_design_instruct(state, none) is None


def test_both_render_doors_put_the_description_first() -> None:
    """Most specific LAST: the description is identity, so it leads — ahead
    of the persona's standing instruction, the emotion and the line's own
    direction. Source-level, matching `test_emotion_wiring`'s convention,
    because composing correctly needs a loaded engine to observe end to end.
    """
    from justvoice import persona_render
    from justvoice.api import generate_api, render_chapter_api

    # Every persona line is planned by the one resolver (2026-10-03); the
    # chapter door calls it, and its compose call leads with the description.
    assert "plan_line(" in inspect.getsource(render_chapter_api)
    resolver = inspect.getsource(persona_render)
    composed = resolver.split("composed = compose_instruct(", 1)[1]
    assert composed.lstrip().startswith("voice_design_instruct_for_id(state, voice_id)")

    generate = inspect.getsource(generate_api)
    assert generate.count("_voice_design_instruct(req.voice)") == 2
    for chunk in generate.split("composed = compose_instruct(")[1:]:
        assert chunk.lstrip().startswith("_voice_design_instruct(req.voice)")


# ── E — every voice names its model ────────────────────────────────────

def test_each_voice_names_the_model_it_needs(client) -> None:
    state = get_state()

    designed = _store(state, design_prompt="a harbour-master")
    assert voice_model(state, designed.id).model == "qwen3-vd"

    cloned = _store(state, source="cloned", name="Marius")
    state.voices.write_ref_wav(cloned.id, _wav())
    assert voice_model(state, cloned.id).model == "qwen3-base"

    # A designed voice becomes a Base voice the moment it is frozen — the
    # whole point of A, and the reason E has to run after it. Clip wins over
    # anything stored.
    frozen = _store(state, design_prompt="a harbour-master", name="Frozen", model="qwen3-vd")
    state.voices.write_ref_wav(frozen.id, _wav())
    assert voice_model(state, frozen.id).model == "qwen3-base"


def test_a_preset_speaks_on_its_own_model(client) -> None:
    state = get_state()
    assert voice_model(state, "Sohee").model == "qwen3-cv"
    kokoro = _store(state, engine="kokoro", source="blended", name="Mix")
    assert voice_model(state, kokoro.id).model == "kokoro"


def test_a_mixed_cast_groups_by_model_instead_of_refusing(client) -> None:
    """The scheduler's key is the model, so a chapter with a designed voice,
    a clone and a Qwen3 speaker renders each model's lines together — one
    swap per model — where it used to refuse the whole chapter."""
    state = get_state()
    designed = _store(state, design_prompt="a harbour-master", name="Designed")
    cloned = _store(state, source="cloned", name="Marius")
    state.voices.write_ref_wav(cloned.id, _wav())
    keys = {model_key(state, v) for v in (designed.id, cloned.id, "Sohee")}
    assert keys == {"qwen3:qwen3-vd", "qwen3:qwen3-base", "qwen3:qwen3-cv"}


def test_the_mlx_variants_resolve_to_the_same_families() -> None:
    """`qwen3-vd-1.7b-mlx` is the VoiceDesign family like its torch twin —
    the suffix must not read as a fourth checkpoint that matches nothing."""
    assert model_of_variant("qwen3-vd-1.7b-mlx") == "qwen3-vd"
    assert model_of_variant("qwen3-base-0.6b-q8") == "qwen3-base"
    assert model_of_variant("chatterbox-turbo-f16") == "chatterbox-turbo"


# ── C — Qwen3 has no tag vocabulary ────────────────────────────────────

def test_no_engine_claims_paralinguistic_tags_on_the_runtime() -> None:
    """The flag decides whether `render_core` strips bracketed markup — True on
    an engine that cannot read it puts `[laugh]` into the text, read aloud.
    Qwen3 never had a tag vocabulary; Chatterbox Turbo, whose native syntax tags
    ARE, is not on the speech runtime yet (switch plan §5), so no engine claims
    them today."""
    from justvoice.engines.manager import discover_engines

    for engine_id, m in discover_engines().items():
        assert m.capabilities.get("paralinguistic_tags", False) is False, engine_id


def test_stripping_removes_markup_qwen_would_have_spoken() -> None:
    from justvoice.inline_tags import strip as strip_tags

    assert "[" not in strip_tags("Well [laugh] that settles it [pause:0.5s].")
