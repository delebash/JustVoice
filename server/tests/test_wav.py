# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for the WAV parser + container writer."""

from __future__ import annotations

import pytest

from justvoice.audio.wav import parse_wav_header, strip_wav_header, write_wav_container


def test_round_trip_preserves_pcm(synth_sine_pcm: bytes) -> None:
    wav = write_wav_container(synth_sine_pcm, sample_rate=44_100, channels=1)
    out = strip_wav_header(wav)
    assert out == synth_sine_pcm


def test_parse_returns_correct_format(synth_sine_pcm: bytes) -> None:
    wav = write_wav_container(synth_sine_pcm, 44_100, 1)
    fmt, off, size = parse_wav_header(wav)
    assert fmt.sample_rate == 44_100
    assert fmt.channels == 1
    assert fmt.bits_per_sample == 16
    assert fmt.sample_count == len(synth_sine_pcm) // 2
    assert abs(fmt.duration_sec - 1.0) < 0.001
    assert off == 44
    assert size == len(synth_sine_pcm)


def test_rejects_truncated_wav() -> None:
    with pytest.raises(ValueError, match="too small"):
        parse_wav_header(b"RIFF")


def test_rejects_non_riff() -> None:
    with pytest.raises(ValueError, match="RIFF"):
        parse_wav_header(b"NOPE" + b"\x00" * 100)


def test_write_supports_stereo(synth_sine_pcm: bytes) -> None:
    # Pretend the same PCM is stereo (each pair = one frame).
    wav = write_wav_container(synth_sine_pcm, sample_rate=44_100, channels=2)
    fmt, _, _ = parse_wav_header(wav)
    assert fmt.channels == 2
