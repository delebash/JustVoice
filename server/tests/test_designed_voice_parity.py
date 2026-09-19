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
inside the engine, after the render had started, in a message naming no voice.

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
    QWEN_FAMILY_LABELS,
    qwen_family_conflicts,
    qwen_family_for_voice,
    voice_design_instruct,
    voice_design_instruct_for_id,
    voice_synth_fields,
)

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
    from justvoice.api import generate_api, render_chapter_api

    chapter = inspect.getsource(render_chapter_api)
    assert "voice_design_instruct_for_id(st, voice_id)" in chapter
    # First argument of the chapter door's compose call.
    composed = chapter.split("composed = compose_instruct(", 1)[1]
    assert composed.lstrip().startswith("voice_design_instruct_for_id")

    generate = inspect.getsource(generate_api)
    assert generate.count("_voice_design_instruct(req.voice)") == 2
    for chunk in generate.split("composed = compose_instruct(")[1:]:
        assert chunk.lstrip().startswith("_voice_design_instruct(req.voice)")


# ── E — the cast/variant preflight ─────────────────────────────────────

def test_each_voice_names_the_checkpoint_it_needs(client) -> None:
    state = get_state()

    designed = _store(state, design_prompt="a harbour-master")
    assert qwen_family_for_voice(state, designed.id) == "vd"

    cloned = _store(state, source="cloned", name="Marius")
    state.voices.write_ref_wav(cloned.id, _wav())
    assert qwen_family_for_voice(state, cloned.id) == "base"

    trained = _store(state, source="lora", name="Alder", adapter_path="/x/adapter")
    assert qwen_family_for_voice(state, trained.id) == "base"

    # A designed voice becomes a Base voice the moment it is frozen — the
    # whole point of A, and the reason E has to run after it.
    frozen = _store(state, design_prompt="a harbour-master", name="Frozen")
    state.voices.write_ref_wav(frozen.id, _wav())
    assert qwen_family_for_voice(state, frozen.id) == "base"


def test_a_non_qwen_voice_needs_no_checkpoint(client) -> None:
    state = get_state()
    kokoro = _store(state, engine="kokoro", source="blended", name="Mix")
    assert qwen_family_for_voice(state, kokoro.id) is None
    # …and therefore never appears in a conflict list.
    _, conflicts = qwen_family_conflicts(state, [kokoro.id])
    assert conflicts == []


def test_a_mixed_cast_is_refused_before_any_line_is_rendered(client, monkeypatch) -> None:
    state = get_state()
    designed = _store(state, design_prompt="a harbour-master", name="Designed")
    cloned = _store(state, source="cloned", name="Marius")
    state.voices.write_ref_wav(cloned.id, _wav())

    from justvoice import render_core

    class _Mgr:
        def current_variant_id(self, _engine):
            return "qwen3-cv-1.7b"

        def resolved_default_variant(self, _engine):
            return "qwen3-cv-1.7b"

    monkeypatch.setattr(
        "justvoice.engines.manager.get_manager", lambda: _Mgr(), raising=False
    )
    variant, conflicts = render_core.qwen_family_conflicts(
        state, [designed.id, cloned.id]
    )
    assert variant == "qwen3-cv-1.7b"
    assert dict(conflicts) == {designed.id: "vd", cloned.id: "base"}
    # Every family in a conflict has a name a person can act on.
    assert all(fam in QWEN_FAMILY_LABELS for _, fam in conflicts)


def test_a_single_family_cast_passes(client, monkeypatch) -> None:
    state = get_state()
    a = _store(state, source="cloned", name="A")
    b = _store(state, source="cloned", name="B")
    for v in (a, b):
        state.voices.write_ref_wav(v.id, _wav())

    class _Mgr:
        def current_variant_id(self, _engine):
            return "qwen3-base-1.7b"

        def resolved_default_variant(self, _engine):
            return "qwen3-base-1.7b"

    monkeypatch.setattr(
        "justvoice.engines.manager.get_manager", lambda: _Mgr(), raising=False
    )
    from justvoice import render_core

    _, conflicts = render_core.qwen_family_conflicts(state, [a.id, b.id])
    assert conflicts == []


def test_the_mlx_variants_resolve_to_the_same_families(client, monkeypatch) -> None:
    """`qwen3-vd-1.7b-mlx` is the VoiceDesign family like its torch twin —
    the suffix must not read as a fourth checkpoint that matches nothing."""
    state = get_state()
    designed = _store(state, design_prompt="a harbour-master")

    class _Mgr:
        def current_variant_id(self, _engine):
            return "qwen3-vd-1.7b-mlx"

        def resolved_default_variant(self, _engine):
            return "qwen3-vd-1.7b-mlx"

    monkeypatch.setattr(
        "justvoice.engines.manager.get_manager", lambda: _Mgr(), raising=False
    )
    from justvoice import render_core

    _, conflicts = render_core.qwen_family_conflicts(state, [designed.id])
    assert conflicts == []


# ── C — Qwen3 has no tag vocabulary ────────────────────────────────────

def test_qwen3_does_not_claim_paralinguistic_tags() -> None:
    """Upstream ships no bracketed-tag vocabulary and the promised
    tag→instruct translation was never written, so the flag that decides
    whether `render_core` strips markup has to be False — otherwise
    `[laugh]` goes into the model's text and gets read aloud."""
    from pathlib import Path

    from justvoice.engines.qwen3 import manifest as qwen_manifest

    # The manifest is the flag the HOST reads — `render_core._tags_supported`
    # asks the manager for it, because a managed engine's own module lives in
    # a venv the host cannot import (torch et al).
    assert qwen_manifest.CAPABILITIES["paralinguistic_tags"] is False

    # The adapter's EngineMeta reports the same fact over the plugin
    # protocol, and must not drift from it. Read as text for the same reason.
    engine_src = (
        Path(qwen_manifest.__file__).with_name("engine.py").read_text(encoding="utf-8")
    )
    assert "supports_paralinguistic_tags=False," in engine_src
    assert "supports_paralinguistic_tags=True," not in engine_src


def test_engines_whose_syntax_it_actually_is_still_keep_tags() -> None:
    """Chatterbox-Turbo's `[tag]` IS its native input format — C must not
    have stripped the one engine that reads them."""
    from justvoice.engines.chatterbox import manifest as cb_manifest
    from justvoice.engines.kokoro import manifest as kokoro_manifest

    assert cb_manifest.CAPABILITIES["paralinguistic_tags"] is True
    assert kokoro_manifest.CAPABILITIES["paralinguistic_tags"] is False


def test_stripping_removes_markup_qwen_would_have_spoken() -> None:
    from justvoice.inline_tags import strip as strip_tags

    assert "[" not in strip_tags("Well [laugh] that settles it [pause:0.5s].")
