# SPDX-License-Identifier: MIT
"""Silence-split for training prep — one long recording into clips.

The Train tab's Preparer (2026-08-20): a WAV goes in, speech segments
between long-enough silences come out, each then gated and transcribed by
the endpoint. Silence uses the SAME amplitude definition as the analyzer
(`analyzer._compute_loudness`: abs sample < 32), so "silent" means one
thing across the app. The gap length and the per-clip duration bounds are
operator knobs (`settings.training.validation`), never constants here.
"""

from __future__ import annotations

import numpy as np

from .wav import parse_wav_header

# Matches analyzer.py's silence_threshold — keep the two in step.
SILENCE_AMP = 32


def split_on_silence(
    buf: bytes,
    *,
    gap_secs: float,
    max_secs: float,
) -> tuple[int, list[np.ndarray], float | None]:
    """Split a 16-bit PCM WAV at silences of at least `gap_secs`.

    Returns (sample_rate, [mono int16 chunk arrays], noise_rms). The noise
    floor is MEASURED from the silent samples this very split removes —
    the one place a principled per-chunk SNR can come from, since the
    chunks themselves contain no quiet frames afterwards (the analyzer's
    percentile estimate is blind exactly there). None when the recording
    has no silent samples, or their RMS is 0 (digital silence).
    Multichannel input is downmixed to mono (the trainers want one speaker
    on one channel). Segments longer than `max_secs` are hard-split at
    that length. Raises ValueError for non-16-bit input.
    """
    fmt, off, size = parse_wav_header(buf)
    if fmt.bits_per_sample != 16:
        raise ValueError(
            f"16-bit PCM WAV required (this file is {fmt.bits_per_sample}-bit)"
        )
    pcm = np.frombuffer(buf[off : off + size], dtype="<i2")
    if fmt.channels > 1:
        frames = len(pcm) // fmt.channels
        pcm = (
            pcm[: frames * fmt.channels]
            .reshape(-1, fmt.channels)
            .astype(np.int32)
            .mean(axis=1)
            .astype(np.int16)
        )
    if not len(pcm):
        return fmt.sample_rate, [], None

    sr = fmt.sample_rate

    # FRAME-level silence, not per-sample: real room tone has outlier
    # samples above any amplitude threshold, which shatters per-sample
    # silent runs so badly that a real recording never gets cut (found by
    # the pinned room-tone test, 2026-08-20). A 25 ms frame is silent when
    # its RMS is under the same threshold the analyzer's per-sample
    # definition uses.
    frame = max(1, int(sr * 0.025))
    n_frames = len(pcm) // frame
    if n_frames < 2:
        return sr, [pcm], None
    framed = pcm[: n_frames * frame].astype(np.float64).reshape(n_frames, frame)
    frame_rms = np.sqrt(np.mean(framed * framed, axis=1))
    silent = frame_rms < SILENCE_AMP
    gap = max(1, int(round(gap_secs * sr / frame)))  # in frames

    noise_rms: float | None = None
    if silent.any():
        quiet = framed[silent].ravel()
        rms = float(np.sqrt(np.mean(quiet * quiet)))
        noise_rms = rms if rms > 0 else None

    # Silent frame-runs long enough to be cut points.
    edges = np.diff(silent.astype(np.int8))
    run_starts = np.flatnonzero(edges == 1) + 1
    run_ends = np.flatnonzero(edges == -1) + 1
    if silent[0]:
        run_starts = np.concatenate(([0], run_starts))
    if silent[-1]:
        run_ends = np.concatenate((run_ends, [len(silent)]))
    cuts = [(s, e) for s, e in zip(run_starts, run_ends) if e - s >= gap]

    # Speech segments are what lies between the cuts (frame → sample idx;
    # the sub-frame tail beyond the last full frame rides the last segment).
    segments: list[tuple[int, int]] = []
    pos = 0
    for s, e in cuts:
        if s > pos:
            segments.append((pos * frame, s * frame))
        pos = e
    if pos * frame < len(pcm):
        segments.append((pos * frame, len(pcm)))

    max_n = max(1, int(max_secs * sr))
    out: list[np.ndarray] = []
    for a, b in segments:
        while b - a > max_n:
            out.append(pcm[a : a + max_n])
            a += max_n
        if b > a:
            out.append(pcm[a:b])
    return sr, out, noise_rms
