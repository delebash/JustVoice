# SPDX-License-Identifier: MIT
"""Tests for the chunked TTS splitter + concatenator (Phase 3 lift)."""

from __future__ import annotations

import numpy as np

from justvoice.audio.chunked import (
    concatenate_audio_chunks,
    split_text_into_chunks,
)


def test_short_text_is_one_chunk():
    chunks = split_text_into_chunks("Just a sentence.", max_chars=800)
    assert chunks == ["Just a sentence."]


def test_splits_at_sentence_boundary():
    text = "First sentence. Second sentence. Third sentence."
    chunks = split_text_into_chunks(text, max_chars=20)
    # Each chunk should end at a sentence boundary, none over the cap.
    for c in chunks:
        assert len(c) <= 25  # max_chars + small overhead from trailing space
    assert "".join(chunks).replace(" ", "") == text.replace(" ", "")


def test_does_not_split_abbreviation():
    """Periods inside abbreviations like 'Dr.' or 'Mr.' do not end a sentence."""
    text = "Dr. Smith met Mr. Jones at the café. They had tea."
    chunks = split_text_into_chunks(text, max_chars=30)
    # Neither "Dr." nor "Mr." should be its own chunk.
    assert not any(c == "Dr." for c in chunks)
    assert not any(c == "Mr." for c in chunks)


def test_does_not_split_paralinguistic_tag():
    """[laugh], [sigh] etc. are atomic — never split across chunks."""
    text = "Once upon a time [laugh] there was a wolf."
    chunks = split_text_into_chunks(text, max_chars=20)
    # The tag should be intact in whichever chunk it lands in.
    full = "".join(chunks)
    assert "[laugh]" in full


def test_concatenate_with_crossfade_no_clicks():
    """Crossfading two short chunks should produce a smooth boundary."""
    sr = 44100
    a = np.ones(sr // 10, dtype=np.float32) * 0.5  # 100ms tone
    b = np.ones(sr // 10, dtype=np.float32) * 0.5
    merged = concatenate_audio_chunks([a, b], sample_rate=sr, crossfade_ms=20)
    # Without crossfade the concat would be 2*len(a). With 20ms overlap it's less.
    expected_min = len(a) + len(b) - int(sr * 0.020)
    assert expected_min - 10 <= len(merged) <= len(a) + len(b)
    # No discontinuity over the crossfade region — adjacent samples differ by
    # at most a small fade amount.
    diffs = np.diff(merged)
    assert float(np.max(np.abs(diffs))) < 0.1


def test_empty_input_returns_empty_array():
    out = concatenate_audio_chunks([], sample_rate=44100)
    assert out.size == 0
    assert out.dtype == np.float32


def _piece(sr, lead_ms, sound_ms, tail_ms):
    """A piece as a model hands it over: silence, sound, silence."""
    z = lambda ms: np.zeros(int(sr * ms / 1000), dtype=np.float32)  # noqa: E731
    return np.concatenate([z(lead_ms), np.full(int(sr * sound_ms / 1000), 0.3, dtype=np.float32), z(tail_ms)])


def _gaps_ms(x, sr):
    quiet = np.abs(x) <= 10 ** (-60 / 20)
    out, i = [], int(np.argmax(~quiet))
    last = len(x) - int(np.argmax(~quiet[::-1]))
    while i < last:
        if quiet[i]:
            j = i
            while j < last and quiet[j]:
                j += 1
            out.append(round((j - i) / sr * 1000))
            i = j
        else:
            i += 1
    return out


def test_pieces_meet_at_the_piece_pause_not_their_padding():
    """2026-10-07: a long line's pieces kept their padding — ~1 s gaps mid-line."""
    from justvoice.audio.chunked import PIECE_JOIN_PAUSE_MS

    sr = 24000
    a, b = _piece(sr, 265, 1000, 715), _piece(sr, 265, 1000, 715)
    merged = concatenate_audio_chunks([a, b], sample_rate=sr, crossfade_ms=50)
    # Quiet is judged in 10 ms windows, so the join lands within a window or two of the pause.
    (gap,) = _gaps_ms(merged, sr)
    assert PIECE_JOIN_PAUSE_MS <= gap <= PIECE_JOIN_PAUSE_MS + 20
    # The line's own lead and tail stay: trimming them is the chapter join's job.
    assert round(len(merged) / sr * 1000) == 265 + 1000 + gap + 1000 + 715


def test_a_join_already_short_is_left_as_it_is():
    sr = 24000
    a, b = _piece(sr, 0, 500, 60), _piece(sr, 40, 500, 0)
    merged = concatenate_audio_chunks([a, b], sample_rate=sr, crossfade_ms=50)
    assert _gaps_ms(merged, sr) == [100]
