"""Audio analyzer — format + loudness + A/B comparison."""

from __future__ import annotations

import hashlib
import math

import numpy as np

from ..models import (
    AudioAnalysis,
    ComparisonReport,
    LoudnessStats,
    WavFormat as WavFormatModel,
)
from .wav import parse_wav_header


def _compute_loudness(pcm_bytes: bytes, sample_rate: int = 0) -> LoudnessStats:
    if len(pcm_bytes) < 2:
        return LoudnessStats(
            peak_dbfs=-math.inf,
            rms_dbfs=-math.inf,
            crest_factor_db=0.0,
            silence_ratio=1.0,
            clipping_ratio=0.0,
        )
    samples = np.frombuffer(pcm_bytes, dtype="<i2").astype(np.float64)
    abs_samples = np.abs(samples)
    peak = int(abs_samples.max())
    rms = math.sqrt(float(np.mean(samples * samples)))

    max_i16 = 32767.0
    peak_dbfs = 20.0 * math.log10(peak / max_i16) if peak > 0 else -math.inf
    rms_dbfs = 20.0 * math.log10(rms / max_i16) if rms > 0 else -math.inf
    crest = peak_dbfs - rms_dbfs if math.isfinite(peak_dbfs) and math.isfinite(rms_dbfs) else 0.0
    silence_threshold = 32
    silence_ratio = float((abs_samples < silence_threshold).sum()) / len(samples)
    clipping_ratio = float((abs_samples >= 32760).sum()) / len(samples)

    # SNR estimate (2026-08-20, for the training gates): 50 ms frame RMS,
    # noise floor = the 10th-percentile frame, signal = the 90th. An
    # ESTIMATE with a documented blind spot: on CONTINUOUS audio with no
    # quiet frames (dense speech, a steady tone) the "floor" percentile
    # lands on the signal itself and the ratio collapses toward 1 — a
    # falsely terrible number. So a floor within 6 dB of the signal
    # returns None (unknown) rather than a low value; the gates skip
    # unknowns. Found live 2026-08-20: silence-split chunks read 0 dB.
    snr_db: float | None = None
    if sample_rate > 0:
        frame = max(1, int(sample_rate * 0.05))
        n_frames = len(samples) // frame
        if n_frames >= 4:
            framed = samples[: n_frames * frame].reshape(n_frames, frame)
            frame_rms = np.sqrt(np.mean(framed * framed, axis=1))
            noise = float(np.percentile(frame_rms, 10))
            signal = float(np.percentile(frame_rms, 90))
            if noise > 0 and signal / noise >= 2.0:
                snr_db = 20.0 * math.log10(signal / noise)

    return LoudnessStats(
        peak_dbfs=peak_dbfs,
        rms_dbfs=rms_dbfs,
        crest_factor_db=crest,
        silence_ratio=silence_ratio,
        clipping_ratio=clipping_ratio,
        snr_db=snr_db,
    )


def analyze(buf: bytes) -> AudioAnalysis:
    fmt, data_off, data_size = parse_wav_header(buf)
    pcm = buf[data_off : data_off + data_size]
    loudness = _compute_loudness(pcm, fmt.sample_rate)
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
        _, ao, asz = parse_wav_header(a_buf)
        _, bo, bsz = parse_wav_header(b_buf)
        length = min(asz, bsz)
        n = length // 2
        if n > 0:
            sa = np.frombuffer(a_buf[ao : ao + length], dtype="<i2").astype(np.float64)
            sb = np.frombuffer(b_buf[bo : bo + length], dtype="<i2").astype(np.float64)
            diff = sb - sa
            sample_rmse = float(math.sqrt(np.mean((diff / 32767.0) ** 2)))
            max_sample_delta = float(np.abs(diff).max() / 32767.0)
            pct_identical_samples = float((diff == 0).sum() / n)

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
