# SPDX-License-Identifier: MIT
"""Tests for audio analyzer — peak / RMS / clipping / silence detection."""

from __future__ import annotations

import math

from justvoice.audio.analyzer import analyze, compare


def test_sine_wave_has_expected_peak(sine_wav: bytes) -> None:
    a = analyze(sine_wav)
    # 0.5 amplitude => peak ~= -6 dBFS
    assert -7.5 < a.loudness.peak_dbfs < -5.0
    # RMS of a sine at 0.5 amplitude is 0.5/sqrt(2) ~ 0.354 => -9 dBFS
    assert -10.5 < a.loudness.rms_dbfs < -8.0


def test_silence_detected(silence_wav: bytes) -> None:
    a = analyze(silence_wav)
    assert a.loudness.silence_ratio == 1.0
    assert a.loudness.peak_dbfs == -math.inf
    assert a.loudness.clipping_ratio == 0.0


def test_fullscale_detects_clipping(fullscale_wav: bytes) -> None:
    a = analyze(fullscale_wav)
    assert a.loudness.clipping_ratio > 0.9
    # Peak is at the +/- 32767 ceiling => 0 dBFS
    assert a.loudness.peak_dbfs > -0.01


def test_compare_identical_wavs_reports_identical(sine_wav: bytes) -> None:
    rep = compare(sine_wav, sine_wav)
    assert rep.identical
    assert rep.verdict == "identical"
    assert rep.sample_rmse is None or rep.sample_rmse == 0.0


def test_compare_different_wavs_reports_unrelated(sine_wav: bytes, fullscale_wav: bytes) -> None:
    rep = compare(sine_wav, fullscale_wav)
    assert not rep.identical
    assert rep.verdict in {"different", "unrelated"}
    assert rep.sample_rmse is not None
    assert rep.sample_rmse > 0.05


def test_analyze_reports_duration(sine_wav: bytes) -> None:
    a = analyze(sine_wav)
    assert abs(a.format.duration_sec - 1.0) < 0.001
    assert a.format.sample_rate == 44_100
    assert a.format.channels == 1
