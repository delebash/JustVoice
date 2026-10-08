"""Audio analyzer — format + loudness + A/B comparison.

The header half (format, sha256) is read here; the sample half — loudness, the noise margin,
the sample-by-sample comparison — runs in `audiocpp_dsp` (audio/dsp_client.py, 2026-10-07)."""

from __future__ import annotations

import hashlib

from ..models import (
    AudioAnalysis,
    ComparisonReport,
    LoudnessStats,
    WavFormat as WavFormatModel,
)
from . import dsp_client
from .wav import parse_wav_header, write_wav_container


def _compute_loudness(wav: bytes) -> LoudnessStats:
    """Peak, RMS and crest in dBFS (-inf for silence), and the share of samples that are near
    silent (|x| < 32) or clipped (|x| ≥ 32760) — over the data chunk's samples as they lie."""
    return LoudnessStats(**dsp_client.loudness(wav))


def noise_margin_db(pcm_bytes: bytes, sample_rate: int, channels: int) -> float | None:
    """How far a clip's speech stands above its noise, in dB: the loud end of
    its 20 ms frames (90th percentile) against the quiet end (10th) — the
    pauses between words, where only the room is heard. A clean clip reads
    40 dB and more; under 25 a clone copies the hiss (Alexandria's own floor).
    None for a clip under half a second, or one that is all silence."""
    return dsp_client.noise_margin(write_wav_container(pcm_bytes, sample_rate, channels))


def analyze(buf: bytes) -> AudioAnalysis:
    fmt, _data_off, _data_size = parse_wav_header(buf)
    loudness = _compute_loudness(buf)
    return AudioAnalysis(
        sha256=hashlib.sha256(buf).hexdigest(),
        file_size_bytes=len(buf),
        format=WavFormatModel(
            sample_rate=fmt.sample_rate,
            channels=fmt.channels,
            bits_per_sample=fmt.bits_per_sample,
            sample_count=fmt.sample_count,
            duration_sec=fmt.duration_sec,
        ),
        loudness=loudness,
    )


def compare(a_buf: bytes, b_buf: bytes) -> ComparisonReport:
    a = analyze(a_buf)
    b = analyze(b_buf)

    identical = a.sha256 == b.sha256
    format_match = a.format == b.format
    peak_diff_db = b.loudness.peak_dbfs - a.loudness.peak_dbfs
    rms_diff_db = b.loudness.rms_dbfs - a.loudness.rms_dbfs
    duration_diff_sec = b.format.duration_sec - a.format.duration_sec

    sample_rmse = None
    max_sample_delta = None
    pct_identical_samples = None
    if format_match:
        d = dsp_client.sample_diff(a_buf, b_buf)
        sample_rmse = d["sample_rmse"]
        max_sample_delta = d["max_sample_delta"]
        pct_identical_samples = d["pct_identical_samples"]

    if identical:
        verdict = "identical"
    elif not format_match:
        verdict = "incomparable"
    elif sample_rmse is None:
        verdict = "incomparable"
    elif sample_rmse < 0.001:
        verdict = "near-identical"
    elif sample_rmse < 0.05:
        verdict = "similar"
    elif sample_rmse < 0.2:
        verdict = "different"
    else:
        verdict = "unrelated"

    return ComparisonReport(
        a=a,
        b=b,
        identical=identical,
        format_match=format_match,
        peak_diff_db=peak_diff_db,
        rms_diff_db=rms_diff_db,
        duration_diff_sec=duration_diff_sec,
        sample_rmse=sample_rmse,
        max_sample_delta=max_sample_delta,
        pct_identical_samples=pct_identical_samples,
        verdict=verdict,
    )
