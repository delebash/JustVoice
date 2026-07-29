# SPDX-License-Identifier: MIT
# SPDX-FileCopyrightText: 2026 JustVoice contributors
"""Filters — RBJ cookbook biquads and JUCE-compatible first-order sections.

These five are the ones with NOTHING to get creative about. A peaking EQ
built from the Audio EQ Cookbook coefficients is the same filter whether
pedalboard, ffmpeg, torchaudio or this file computes it — the coefficient
formulas are published, uncopyrighted, and mathematically determined. So
these are the effects where the port is expected to match pedalboard
NUMERICALLY, not merely behave similarly, and `test_dsp_parity.py` holds
them to that.

Two families here:

  * `low_shelf` / `peak` / `high_shelf` — 2nd-order (biquad), parameterised
    by cutoff, gain_db and Q, straight from the RBJ cookbook.
  * `highpass` / `lowpass` — FIRST-order, 6 dB/octave. pedalboard documents
    these as first-order, and the coefficients below are JUCE's bilinear
    forms (`makeFirstOrderHighPass` / `makeFirstOrderLowPass`), which is
    what pedalboard wraps. They are deliberately NOT Butterworth: a 2nd-order
    section here would be twice as steep and every saved user chain would
    suddenly cut more than it used to.
"""

from __future__ import annotations

import numpy as np
from scipy.signal import lfilter, sosfilt


def _sos(b0: float, b1: float, b2: float, a0: float, a1: float, a2: float) -> np.ndarray:
    """Normalise a biquad to a single second-order section for `sosfilt`."""
    return np.array([[b0 / a0, b1 / a0, b2 / a0, 1.0, a1 / a0, a2 / a0]], dtype=np.float64)


def _rbj_common(cutoff_frequency_hz: float, sr: int, q: float) -> tuple[float, float, float]:
    """w0, cos(w0), alpha — shared by every cookbook section."""
    # Clamp below Nyquist. A cutoff at or above sr/2 makes tan()/sin() blow
    # up and would emit NaNs into the render rather than failing loudly.
    f0 = float(np.clip(cutoff_frequency_hz, 1.0, sr * 0.499))
    q = max(float(q), 1e-4)
    w0 = 2.0 * np.pi * f0 / sr
    return w0, float(np.cos(w0)), float(np.sin(w0) / (2.0 * q))


def peak(x: np.ndarray, sr: int, *, cutoff_frequency_hz: float = 1000.0,
         gain_db: float = 0.0, q: float = 0.707) -> np.ndarray:
    """Peaking EQ — boost/cut a band around `cutoff_frequency_hz`."""
    w0, cos_w0, alpha = _rbj_common(cutoff_frequency_hz, sr, q)
    a_ = 10.0 ** (gain_db / 40.0)
    sos = _sos(
        1.0 + alpha * a_, -2.0 * cos_w0, 1.0 - alpha * a_,
        1.0 + alpha / a_, -2.0 * cos_w0, 1.0 - alpha / a_,
    )
    return sosfilt(sos, x, axis=-1)


def low_shelf(x: np.ndarray, sr: int, *, cutoff_frequency_hz: float = 200.0,
              gain_db: float = 0.0, q: float = 0.707) -> np.ndarray:
    """Low shelf — tilt everything below the corner."""
    w0, cos_w0, alpha = _rbj_common(cutoff_frequency_hz, sr, q)
    a_ = 10.0 ** (gain_db / 40.0)
    sqrt_a = np.sqrt(a_)
    sos = _sos(
        a_ * ((a_ + 1.0) - (a_ - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha),
        2.0 * a_ * ((a_ - 1.0) - (a_ + 1.0) * cos_w0),
        a_ * ((a_ + 1.0) - (a_ - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha),
        (a_ + 1.0) + (a_ - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha,
        -2.0 * ((a_ - 1.0) + (a_ + 1.0) * cos_w0),
        (a_ + 1.0) + (a_ - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha,
    )
    return sosfilt(sos, x, axis=-1)


def high_shelf(x: np.ndarray, sr: int, *, cutoff_frequency_hz: float = 4000.0,
               gain_db: float = 0.0, q: float = 0.707) -> np.ndarray:
    """High shelf — tilt everything above the corner."""
    w0, cos_w0, alpha = _rbj_common(cutoff_frequency_hz, sr, q)
    a_ = 10.0 ** (gain_db / 40.0)
    sqrt_a = np.sqrt(a_)
    sos = _sos(
        a_ * ((a_ + 1.0) + (a_ - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha),
        -2.0 * a_ * ((a_ - 1.0) + (a_ + 1.0) * cos_w0),
        a_ * ((a_ + 1.0) + (a_ - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha),
        (a_ + 1.0) - (a_ - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha,
        2.0 * ((a_ - 1.0) - (a_ + 1.0) * cos_w0),
        (a_ + 1.0) - (a_ - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha,
    )
    return sosfilt(sos, x, axis=-1)


def _first_order_tan(cutoff_frequency_hz: float, sr: int) -> float:
    f0 = float(np.clip(cutoff_frequency_hz, 1.0, sr * 0.499))
    return float(np.tan(np.pi * f0 / sr))


def highpass(x: np.ndarray, sr: int, *, cutoff_frequency_hz: float = 50.0) -> np.ndarray:
    """First-order high-pass, 6 dB/octave (JUCE `makeFirstOrderHighPass`)."""
    n = _first_order_tan(cutoff_frequency_hz, sr)
    b = np.array([1.0, -1.0]) / (n + 1.0)
    a = np.array([1.0, (n - 1.0) / (n + 1.0)])
    return lfilter(b, a, x, axis=-1)


def lowpass(x: np.ndarray, sr: int, *, cutoff_frequency_hz: float = 50.0) -> np.ndarray:
    """First-order low-pass, 6 dB/octave (JUCE `makeFirstOrderLowPass`)."""
    n = _first_order_tan(cutoff_frequency_hz, sr)
    b = np.array([n, n]) / (n + 1.0)
    a = np.array([1.0, (n - 1.0) / (n + 1.0)])
    return lfilter(b, a, x, axis=-1)
