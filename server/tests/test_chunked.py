# SPDX-License-Identifier: MIT
"""Tests for the chunked TTS splitter (Phase 3 lift) and the joins between a line's pieces —
which run in audiocpp_dsp since 2026-10-07 (audio/dsp_client.py)."""

from __future__ import annotations

from array import array

from justvoice.audio import dsp_client
from justvoice.audio.chunked import split_text_into_chunks
from justvoice.audio.wav import write_wav_container


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


def _pcm(samples) -> bytes:
    return array("h", samples).tobytes()


def _samples(pcm: bytes) -> list[int]:
    return array("h", pcm).tolist()


def test_concatenate_with_crossfade_no_clicks():
    """Crossfading two short chunks should produce a smooth boundary."""
    sr = 44100
    a = _pcm([16383] * (sr // 10))  # 100 ms at half scale
    b = _pcm([16383] * (sr // 10))
    merged = _samples(dsp_client.join([(a, sr, 1), (b, sr, 1)], 20))
    # Without crossfade the concat would be 2*len(a). With 20ms overlap it's less.
    n = sr // 10
    assert 2 * n - int(sr * 0.020) - 10 <= len(merged) <= 2 * n
    # No discontinuity over the crossfade region — adjacent samples differ by
    # at most a small fade amount.
    assert max(abs(x - y) for x, y in zip(merged, merged[1:])) < 0.1 * 32767


def test_empty_input_returns_empty_audio():
    assert dsp_client.join([], 50) == b""


def _piece(sr, lead_ms, sound_ms, tail_ms) -> bytes:
    """A piece as a model hands it over: silence, sound, silence."""
    z = lambda ms: [0] * int(sr * ms / 1000)  # noqa: E731
    return _pcm(z(lead_ms) + [int(0.3 * 32767)] * int(sr * sound_ms / 1000) + z(tail_ms))


def _gaps_ms(x: list[int], sr) -> list[int]:
    quiet = [abs(v) / 32767 <= 10 ** (-60 / 20) for v in x]
    i = quiet.index(False)
    last = len(x) - quiet[::-1].index(False)
    out = []
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
    merged = _samples(dsp_client.join([(a, sr, 1), (b, sr, 1)], 50))
    # Quiet is judged in 10 ms windows, so the join lands within a window or two of the pause.
    (gap,) = _gaps_ms(merged, sr)
    assert PIECE_JOIN_PAUSE_MS <= gap <= PIECE_JOIN_PAUSE_MS + 20
    # The line's own lead and tail stay: trimming them is the chapter join's job.
    assert round(len(merged) / sr * 1000) == 265 + 1000 + gap + 1000 + 715


def test_a_join_already_short_is_left_as_it_is():
    sr = 24000
    a, b = _piece(sr, 0, 500, 60), _piece(sr, 40, 500, 0)
    merged = _samples(dsp_client.join([(a, sr, 1), (b, sr, 1)], 50))
    assert _gaps_ms(merged, sr) == [100]


def test_a_streamed_audition_joins_its_pieces_like_a_line():
    """2026-10-07: the Voices preview streams pieces one by one; holding each piece's
    quiet back for the next seam gives exactly the line's join."""
    sr = 24000
    pieces = [_piece(sr, 265, 800, 715), _piece(sr, 265, 600, 715), _piece(sr, 265, 700, 715)]
    streamed, held = [], None
    for i, p in enumerate(pieces):
        out, held = dsp_client.stream_join(write_wav_container(p, sr, 1), held, last=i == len(pieces) - 1, crossfade_ms=50)
        streamed.append(out)
    assert b"".join(streamed) == dsp_client.join([(p, sr, 1) for p in pieces], 50)
