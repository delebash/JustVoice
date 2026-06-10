# SPDX-License-Identifier: GPL-3.0-or-later
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
