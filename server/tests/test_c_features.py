# SPDX-License-Identifier: MIT
"""Pins for the C-features go (2026-08-21): word alignment + captions,
the pronunciation scan, and voice bundles.

Each pins the pure core whose silent failure would produce a WRONG
artifact rather than an error: captions that drift, a scan that misses
the protagonist, a bundle that half-imports.
"""

from __future__ import annotations

import struct
import math
import zipfile
import io
from datetime import datetime, timezone
from pathlib import Path

import pytest

# ── Alignment ────────────────────────────────────────────────────────────


def test_alignment_matched_words_take_hypothesis_timing():
    from justvoice.alignment import align_known_text

    hyp = [
        {"word": "the", "start": 0.0, "end": 0.2},
        {"word": "ancient", "start": 0.2, "end": 0.8},
        {"word": "library", "start": 0.8, "end": 1.4},
    ]
    out = align_known_text("The ancient library", hyp, total_duration=1.5)
    assert [w["word"] for w in out] == ["The", "ancient", "library"]
    assert out[1]["start"] == 0.2 and out[1]["end"] == 0.8


def test_alignment_survives_an_asr_misread():
    """The whole point of aligning KNOWN text: Whisper hears "Wooster",
    the caption still says Worcester — with real timing interpolated
    between its matched neighbours."""
    from justvoice.alignment import align_known_text

    hyp = [
        {"word": "he", "start": 0.0, "end": 0.3},
        {"word": "visited", "start": 0.3, "end": 0.9},
        {"word": "Wooster", "start": 0.9, "end": 1.5},   # misread
        {"word": "today", "start": 1.5, "end": 2.0},
    ]
    out = align_known_text("He visited Worcester today", hyp, total_duration=2.0)
    w = out[2]
    assert w["word"] == "Worcester"
    assert 0.9 <= w["start"] < w["end"] <= 1.5  # interpolated inside its slot
    assert out[3]["start"] == 1.5  # the neighbour keeps its own timing


def test_alignment_is_monotonic_even_with_garbage_hypothesis():
    from justvoice.alignment import align_known_text

    out = align_known_text(
        "one two three four", [{"word": "zzz", "start": 5.0, "end": 5.1}],
        total_duration=4.0,
    )
    assert len(out) == 4
    for a, b in zip(out, out[1:]):
        assert a["end"] <= b["start"] or abs(a["end"] - b["start"]) < 1e-9
    assert all(w["end"] >= w["start"] for w in out)


def test_alignment_punctuation_does_not_break_matching():
    from justvoice.alignment import align_known_text

    hyp = [{"word": "hello", "start": 0.1, "end": 0.5},
           {"word": "world", "start": 0.5, "end": 1.0}]
    out = align_known_text('"Hello, world!"', hyp, total_duration=1.0)
    assert out[0]["word"] == '"Hello,'
    assert out[0]["start"] == 0.1  # matched despite quotes and comma


# ── Captions ─────────────────────────────────────────────────────────────


def _words(n, step=0.4):
    return [{"word": f"w{i}", "start": i * step, "end": (i + 1) * step} for i in range(n)]


def test_cues_break_on_length_and_gap():
    from justvoice.captions import group_cues

    cues = group_cues(_words(14))
    assert all(len(c["text"]) <= 60 for c in cues)
    assert len(cues) >= 2
    # A long pause forces a cue break even mid-count.
    words = _words(3) + [{"word": "later", "start": 10.0, "end": 10.4}]
    cues = group_cues(words)
    assert cues[-1]["text"] == "later"


def test_vtt_and_srt_formats():
    from justvoice.captions import to_srt, to_vtt

    words = [{"word": "hello", "start": 0.0, "end": 1.5},
             {"word": "there", "start": 1.5, "end": 3661.25}]
    vtt = to_vtt(words)
    assert vtt.startswith("WEBVTT")
    assert "00:00:00.000 -->" in vtt
    srt = to_srt(words)
    assert srt.splitlines()[0] == "1"
    assert "," in srt.split(" --> ")[0]  # SRT uses comma milliseconds
    assert "01:01:01" in srt  # 3661 s formats as h:m:s


# ── Pronunciation scan ───────────────────────────────────────────────────


def test_scan_finds_mid_sentence_names_only():
    from justvoice.pronunciation import scan_names

    texts = [
        "Elara crossed the square. The baker waved at Elara.",
        "Nobody had seen Brindlewood so quiet. Quiet suited it.",
    ]
    words = {w["word"]: w["count"] for w in scan_names(texts, covered=set())}
    assert words.get("Elara") == 2          # mid-sentence occurrence qualifies it
    assert words.get("Brindlewood") == 1
    # "Quiet" starts a sentence AND appears lowercase — an ordinary word.
    assert "Quiet" not in words
    assert "The" not in words and "Nobody" not in words


def test_scan_respects_lexicon_coverage():
    from justvoice.pronunciation import scan_names

    texts = ["They followed Elara to Brindlewood."]
    out = scan_names(texts, covered={"elara"})
    assert [w["word"] for w in out] == ["Brindlewood"]


def test_scan_respects_multiword_coverage_but_flags_lone_parts():
    """Review R2: "Mara Vance" in the lexicon covers exactly that phrase —
    its words must not re-flag inside it, while a LONE "Mara" elsewhere is
    genuinely uncovered (the render entry only matches the full phrase) and
    still surfaces."""
    from justvoice.pronunciation import scan_names

    texts = ["They met Mara Vance at the mill. Later Mara smiled at Vance."]
    out = {w["word"]: w["count"] for w in scan_names(texts, covered={"Mara Vance"})}
    assert out == {"Mara": 1, "Vance": 1}  # only the lone occurrences


def test_scan_orders_by_frequency():
    from justvoice.pronunciation import scan_names

    texts = ["Ask Wren. Tell Wren everything, and bring Alder to Wren."]
    out = scan_names(texts, covered=set())
    assert [w["word"] for w in out] == ["Wren", "Alder"]


# ── Voice bundles ────────────────────────────────────────────────────────

SR = 24000


def _wav(seconds=1.0):
    pcm = b"".join(
        struct.pack("<h", int(9000 * math.sin(2 * math.pi * 220 * i / SR)))
        for i in range(int(SR * seconds))
    )
    return (
        b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt "
        + struct.pack("<IHHIIHH", 16, 1, 1, SR, SR * 2, 2, 16)
        + b"data" + struct.pack("<I", len(pcm))
    ) + pcm


class _FakeVoices:
    def __init__(self, root: Path):
        self.root = root
        self.records = {}

    def get(self, vid):
        return self.records.get(vid)

    def create(self, rec):
        rec = rec.model_copy(update={"id": f"voice_{len(self.records)}"})
        self.records[rec.id] = rec
        return rec

    def ref_wav_path(self, vid):
        return self.root / vid / "ref.wav"

    def write_ref_wav(self, vid, data):
        p = self.ref_wav_path(vid)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)


def _rec(**kw):
    from justvoice.models import VoiceRecord

    now = datetime.now(timezone.utc)
    base = dict(id="", engine="chatterbox", source="cloned", name="Marius",
                language="en-US", transcript="hello", created_at=now, updated_at=now)
    base.update(kw)
    return VoiceRecord(**base)


def test_bundle_round_trip_carries_the_clip(tmp_path):
    from justvoice.voice_bundle import build_bundle, import_bundle

    store = _FakeVoices(tmp_path)
    v = store.create(_rec())
    store.write_ref_wav(v.id, _wav())

    payload, filename = build_bundle(store, v.id)
    assert filename == "Marius.jvvoice.zip"
    z = zipfile.ZipFile(io.BytesIO(payload))
    assert set(z.namelist()) == {"voice.json", "ref.wav"}

    back = import_bundle(store, payload, known_engines={"chatterbox"})
    assert back.name == "Marius" and back.engine == "chatterbox"
    assert store.ref_wav_path(back.id).is_file()


def test_bundle_refuses_missing_engine_with_the_reason(tmp_path):
    from justvoice.voice_bundle import build_bundle, import_bundle

    store = _FakeVoices(tmp_path)
    v = store.create(_rec())
    store.write_ref_wav(v.id, _wav())
    payload, _ = build_bundle(store, v.id)
    with pytest.raises(ValueError, match="chatterbox"):
        import_bundle(store, payload, known_engines={"kokoro"})


def test_bundle_refuses_lora_and_preset(tmp_path):
    from justvoice.voice_bundle import build_bundle

    store = _FakeVoices(tmp_path)
    v = store.create(_rec(source="lora", adapter_path="/x"))
    with pytest.raises(ValueError, match="adapter"):
        build_bundle(store, v.id)


def test_bundle_refuses_a_clip_voice_without_its_clip(tmp_path):
    """A cloned voice whose bundle lost ref.wav must refuse, not import a
    voice that can never render."""
    from justvoice.voice_bundle import build_bundle, import_bundle

    store = _FakeVoices(tmp_path)
    v = store.create(_rec())
    store.write_ref_wav(v.id, _wav())
    payload, _ = build_bundle(store, v.id)

    # Strip ref.wav out of the archive.
    src = zipfile.ZipFile(io.BytesIO(payload))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("voice.json", src.read("voice.json"))
    with pytest.raises(ValueError, match="reference clip"):
        import_bundle(store, buf.getvalue(), known_engines={"chatterbox"})


def test_blended_bundle_needs_no_clip_but_needs_its_vector(tmp_path):
    from justvoice.voice_bundle import build_bundle, import_bundle

    store = _FakeVoices(tmp_path)
    v = store.create(_rec(engine="kokoro", source="blended",
                          embedding=[0.1, 0.2], transcript=None))
    payload, _ = build_bundle(store, v.id)
    back = import_bundle(store, payload, known_engines={"kokoro"})
    assert back.embedding == [0.1, 0.2]


# ── Pocket TTS manifest facts ────────────────────────────────────────────


def test_pocket_manifest_facts():
    from justvoice.engines.pocket_tts import manifest as m

    assert m.ID == "pocket-tts" and m.KIND == "tts"
    assert m.ISOLATION == "venv"
    assert m.LICENSE == "MIT" and m.WEIGHTS_LICENSE == "CC-BY-4.0"
    assert m.CAPABILITIES["voice_cloning"] is True
    assert m.REQUIREMENTS["cpu_adequate"] is True
    v = m.VARIANTS[0]
    # The HF tree's exact bytes (read 2026-08-21) — a drifted number here
    # means someone re-typed instead of re-reading.
    assert v["sources"][0]["size_bytes"] == 235_798_071
    assert v["sources"][0]["hf_repo"] == "kyutai/pocket-tts"
    assert set(v["languages"]) == {"en", "fr", "de", "pt", "it", "es"}
    assert any(s["kind"] == "torch" for s in m.INSTALL)
    assert any("pocket-tts==2.1.0" in s.get("packages", []) for s in m.INSTALL if s["kind"] == "pip")


def test_pocket_capability_row_has_no_invented_knobs():
    from justvoice.engines.capability_details import lookup

    cap = lookup("pocket-tts")
    assert cap is not None
    assert cap.supports_voice_cloning is True
    assert cap.knobs == []  # upstream has no controls — a knob here is fiction
