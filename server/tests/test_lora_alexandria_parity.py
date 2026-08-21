# SPDX-License-Identifier: MIT
"""Pins for the 2026-08-21 Alexandria-parity build.

Covers the pieces that silently produce a WORSE result when they break:
the ZIP interchange (a dataset that half-imports trains a half-voice),
built-in adapter installs, the Preparer's per-run threshold overrides,
and the lexicon IPA splice (a wrong splice mispronounces every render).
"""

from __future__ import annotations

import base64
import io
import json
import math
import struct
import zipfile

import pytest

SR = 24000


def _tone(seconds: float, freq: int = 220) -> bytes:
    n = int(SR * seconds)
    return b"".join(
        struct.pack("<h", int(12000 * math.sin(2 * math.pi * freq * i / SR)))
        for i in range(n)
    )


def _wav(pcm: bytes) -> bytes:
    return (
        b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt "
        + struct.pack("<IHHIIHH", 16, 1, 1, SR, SR * 2, 2, 16)
        + b"data" + struct.pack("<I", len(pcm))
    ) + pcm


def _b64(pcm: bytes) -> str:
    return base64.b64encode(_wav(pcm)).decode()


def _clips() -> list[dict]:
    return [
        {"wav_b64": _b64(_tone(2.0)), "transcript": "the first line"},
        {"wav_b64": _b64(_tone(1.2, 260)), "transcript": "the second line"},
    ]


# ── ZIP round-trip ───────────────────────────────────────────────────────


def test_zip_round_trip_preserves_clips_and_reference(tmp_path):
    from justvoice.storage import training_datasets as td

    rec = td.create_dataset(tmp_path, "rt", _clips(), language="de", ref_index=1)
    payload = td.build_zip(tmp_path, rec.id)
    assert payload is not None

    z = zipfile.ZipFile(io.BytesIO(payload))
    names = set(z.namelist())
    assert "metadata.jsonl" in names
    assert "ref.wav" in names and "ref_text.txt" in names
    assert z.read("ref_text.txt").decode() == "the second line"

    back = td.import_zip(tmp_path, "rt-back", payload, language="de")
    assert back.clip_count == 2
    assert back.origin == "uploaded"
    # ref.wav matched clip 2 byte-for-byte → the reference survives the trip.
    assert back.ref_index == 1
    assert back.ref_transcript == "the second line"
    samples = td.load_samples(tmp_path, back.id)
    assert [s["transcript"] for s in samples] == ["the first line", "the second line"]


def test_zip_import_accepts_alexandrias_layout(tmp_path):
    """A hand-built ZIP in Alexandria's exact shape — subdirectory paths,
    no record.json, no ref files — imports cleanly."""
    from justvoice.storage import training_datasets as td

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(
            "my_dataset/metadata.jsonl",
            json.dumps({"audio_filepath": "sample_000.wav", "text": "hello there"}) + "\n",
        )
        z.writestr("my_dataset/sample_000.wav", _wav(_tone(1.5)))
    rec = td.import_zip(tmp_path, "alex", buf.getvalue())
    assert rec.clip_count == 1
    assert td.load_samples(tmp_path, rec.id)[0]["transcript"] == "hello there"


@pytest.mark.parametrize(
    "build, message_part",
    [
        (lambda: b"not a zip", "not a ZIP"),
        (lambda: _empty_zip(), "no metadata.jsonl"),
        (lambda: _zip_without_clips(), "none of the clips"),
    ],
)
def test_zip_import_refuses_bad_archives_with_reasons(tmp_path, build, message_part):
    from justvoice.storage import training_datasets as td

    with pytest.raises(ValueError, match=message_part):
        td.import_zip(tmp_path, "bad", build())


def _empty_zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("readme.txt", "nothing here")
    return buf.getvalue()


def _zip_without_clips() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("metadata.jsonl", json.dumps({"audio_filepath": "gone.wav", "text": "x"}) + "\n")
    return buf.getvalue()


# ── Built-in adapters ────────────────────────────────────────────────────


class _FakeVoices:
    def __init__(self):
        self.records = []

    def list(self):
        return self.records

    def create(self, rec):
        rec = rec.model_copy(update={"id": f"voice_{len(self.records)}"})
        self.records.append(rec)
        return rec


class _FakeState:
    def __init__(self, data_dir):
        self.data_dir = data_dir
        self.voices = _FakeVoices()


def _adapter_zip(*names: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for n in names:
            z.writestr(n, b"weights")
    return buf.getvalue()


def _entry() -> dict:
    return {
        "id": "test-voice", "name": "Testa", "gender": "female",
        "description": "a test narrator", "engine": "qwen3",
        "variant": "qwen3-base-1.7b", "language": "en",
        "epochs": 9, "final_loss": 4.17, "sample_count": 61,
        "url": "https://example.invalid/testa.zip", "size_bytes": 7,
    }


def test_builtin_download_installs_and_mints_the_voice(tmp_path, monkeypatch):
    from justvoice import training_builtin as tb

    monkeypatch.setattr(tb, "BUILTIN_ADAPTERS", [_entry()])
    state = _FakeState(tmp_path)

    listed = tb.list_builtin(state)
    assert listed[0]["downloaded"] is False

    good = _adapter_zip("adapter_model.safetensors", "ref_sample.wav", "training_meta.json")
    result = tb.download(state, "test-voice", fetch=lambda url: good)
    assert result["downloaded"] is True
    assert result["voice_id"] == "voice_0"

    v = state.voices.records[0]
    assert v.source == "lora"
    assert v.name == "Testa"
    assert (tb.builtin_dir(tmp_path, "test-voice") / "ref_sample.wav").is_file()

    # Idempotent: a second download returns the SAME voice, mints nothing.
    again = tb.download(state, "test-voice", fetch=lambda url: (_ for _ in ()).throw(AssertionError("refetched")))
    assert again["voice_id"] == "voice_0"
    assert len(state.voices.records) == 1


def test_builtin_download_refuses_a_zip_that_cannot_render(tmp_path, monkeypatch):
    """ref_sample.wav + training_meta.json are what the engine replays as
    the voice prompt — an adapter without them is unusable and must be
    refused at install, not discovered at first render."""
    from justvoice import training_builtin as tb

    monkeypatch.setattr(tb, "BUILTIN_ADAPTERS", [_entry()])
    state = _FakeState(tmp_path)
    bad = _adapter_zip("adapter_model.safetensors")  # weights only
    with pytest.raises(ValueError, match="ref_sample.wav"):
        tb.download(state, "test-voice", fetch=lambda url: bad)
    assert state.voices.records == []


# ── Preparer per-run overrides ───────────────────────────────────────────


def test_prepare_one_honours_the_run_overrides(tmp_path, monkeypatch):
    """A run's Min SNR override must beat the settings default. The clip is
    clean (high SNR); an absurd 200 dB floor must drop it — proving the
    override, not the default, is what gated."""
    from justvoice import training_prep

    class _V:
        min_sample_duration_secs = 1.0
        max_sample_duration_secs = 60.0
        min_snr_db = 15.0
        min_transcript_confidence = 0.85
        split_silence_secs = 0.4

    class _T:
        validation = _V()

    class _S:
        training = _T()

    class _Settings:
        def get(self):
            return _S()

    class _State:
        settings = _Settings()

    monkeypatch.setattr(training_prep, "_STATE", dict(training_prep._STATE))
    import justvoice.app_state as app_state
    monkeypatch.setattr(app_state, "get_state", lambda: _State())

    # Two tones around a real 0.6 s silence: the split measures the
    # noise floor from that gap, so every chunk carries a real SNR the
    # 200 dB override can fail. A continuous tone would measure None
    # (= unknown, ungated by design) and prove nothing.
    # Quiet ROOM TONE, not digital zeros: a noise floor of exactly 0
    # cannot be divided by, so the splitter treats it as unmeasurable
    # and the SNR stays unknown (= ungated). Amplitude 5 is far under
    # the silence threshold and yields a real ~64 dB SNR for the 200 dB
    # override to fail.
    silence = struct.pack("<h", 5) * int(SR * 0.6)
    pcm = _tone(1.5) + silence + _tone(1.5)
    chunks, _err = training_prep._prepare_one(
        _wav(pcm), "en", "[test]", min_snr_db=200.0
    )
    assert chunks, "the recording should split into at least one clip"
    assert all(not c["accepted"] for c in chunks)
    assert "SNR" in chunks[0]["reason"] and "200" in chunks[0]["reason"]


# ── Lexicon IPA ──────────────────────────────────────────────────────────


def _fake_phonemize(seg: str) -> str:
    return " ".join(f"[{w}]" for w in seg.split())


def test_ipa_splice_replaces_only_the_mapped_word():
    from justvoice.engines.kokoro import ipa

    out = ipa.splice("I visited Worcester today", {"Worcester": "wˈʊstər"}, _fake_phonemize)
    assert out is not None
    assert "wˈʊstər" in out
    assert "[I]" in out and "[today]" in out       # neighbours phonemized
    assert "[Worcester]" not in out                 # the word itself never is


def test_ipa_splice_is_case_insensitive_but_boundary_exact():
    from justvoice.engines.kokoro import ipa

    out = ipa.splice("WORCESTER sauce", {"worcester": "wˈʊstər"}, _fake_phonemize)
    assert out and "wˈʊstər" in out
    # Worcestershire is a DIFFERENT word — it must not half-match.
    out2 = ipa.splice("Worcestershire sauce", {"Worcester": "wˈʊstər"}, _fake_phonemize)
    assert out2 is None


def test_ipa_splice_fails_safe():
    from justvoice.engines.kokoro import ipa

    def boom(seg):
        raise RuntimeError("espeak died")

    # Phonemizer failure → None → the engine renders plain text instead
    # of crashing the line.
    assert ipa.splice("hello Worcester", {"Worcester": "w"}, boom) is None
    assert ipa.splice("no mapped words here", {"Worcester": "w"}, _fake_phonemize) is None
    assert ipa.splice("anything", {}, _fake_phonemize) is None


def test_apply_lexicons_routes_ipa_and_alias_by_capability():
    from justvoice.models import Lexicon, LexiconEntry
    from justvoice.render_core import _apply_lexicons

    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    lex = Lexicon(
        id="lx1", name="test", created_at=now, updated_at=now,
        entries=[
            LexiconEntry(grapheme="Worcester", phoneme_ipa="wˈʊstər"),
            LexiconEntry(grapheme="Dr.", alias="Doctor"),
        ],
    )

    class _Lexicons:
        def get(self, lid):
            return lex if lid == "lx1" else None

    class _State:
        lexicons = _Lexicons()

    # IPA-capable engine: alias substitutes text, IPA goes to the map.
    text, ipa_map = _apply_lexicons(
        "Dr. Smith of Worcester", ["lx1"], _State(), ipa_capable=True
    )
    assert text == "Doctor Smith of Worcester"
    assert ipa_map == {"Worcester": "wˈʊstər"}

    # Engine that cannot take phonemes: the IPA entry does nothing —
    # a guessed pronunciation beats reading IPA letters aloud.
    text, ipa_map = _apply_lexicons(
        "Dr. Smith of Worcester", ["lx1"], _State(), ipa_capable=False
    )
    assert text == "Doctor Smith of Worcester"
    assert ipa_map == {}
