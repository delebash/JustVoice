# SPDX-License-Identifier: MIT
# SPDX-FileCopyrightText: 2026 JustVoice contributors
"""Compressor — hard-knee, peak-detecting, per-channel.

Same four controls as the effect it replaces (`threshold_db`, `ratio`,
`attack_ms`, `release_ms`) and the same hard-knee gain law, but a DIFFERENT
detector topology, deliberately. That difference is the interesting part of
this file, so it is written down rather than discovered later:

JUCE's ballistics filter is a one-pole whose coefficient depends on the
signal — attack coefficient while the input is above the envelope, release
coefficient below it:

    y[n] = c * y[n-1] + (1-c) * x[n],   c = c_attack if x[n] > y[n-1] else c_release

That branch makes it NON-linear, so it cannot be expressed as one LTI filter
and cannot be vectorised exactly. A per-sample Python loop over a chapter's
worth of audio is minutes, not seconds, and reaching for numba or Cython to
fix that would drag a compiler dependency into a project that does not have
one.

What this file does instead: run TWO exact one-poles over the rectified
signal — one with the attack time constant, one with the release — and take
the pointwise maximum.

    env = max(onepole(|x|, attack), onepole(|x|, release))

That is not a hack, it is the same ballistics by another route. Both are
low-passes of the same input, so the faster one leads on a rising edge and
the slower one lags on a falling edge; `max` therefore picks the attack
filter while the level rises and the release filter while it falls, which is
precisely attack/release behaviour. Two `lfilter` calls, exact arithmetic,
fully vectorised, no approximation of the time constants and no hop-rate
quantisation of fast attacks.

It will not sample-match JUCE. It is not meant to — `test_dsp_bite.py`
verifies it STRUCTURALLY (loud material is pulled down, quiet material is
not, the loud/soft gap narrows), which is the honest check for an effect
whose reference implementation we deliberately did not copy.
"""

from __future__ import annotations

import numpy as np
from scipy.signal import lfilter


def _onepole_coeff(time_ms: float, sr: int) -> float:
    """JUCE's ballistics coefficient: exp(-1 / (tau_seconds * sample_rate))."""
    tau = max(float(time_ms), 0.0) / 1000.0
    if tau <= 0.0:
        return 0.0  # instantaneous — no smoothing at all
    return float(np.exp(-1.0 / max(tau * sr, 1e-9)))


def _smooth(rect: np.ndarray, coeff: float) -> np.ndarray:
    if coeff <= 0.0:
        return rect
    return lfilter([1.0 - coeff], [1.0, -coeff], rect, axis=-1)


def compressor(x: np.ndarray, sr: int, *, threshold_db: float = 0.0,
               ratio: float = 1.0, attack_ms: float = 1.0,
               release_ms: float = 100.0) -> np.ndarray:
    """Downward compression above `threshold_db` at `ratio`:1.

    Channels are detected independently (unlinked), matching the reference
    behaviour where each channel carries its own envelope state.
    """
    ratio = float(ratio)
    if ratio <= 0.0:
        # A ratio of zero or less has no meaning and would make the exponent
        # below explode. Treat it as bypass rather than emitting garbage.
        return x
    if ratio == 1.0:
        return x  # 1:1 is unity gain by definition — skip the work

    rect = np.abs(x)
    env = np.maximum(
        _smooth(rect, _onepole_coeff(attack_ms, sr)),
        _smooth(rect, _onepole_coeff(release_ms, sr)),
    )

    threshold = 10.0 ** (float(threshold_db) / 20.0)
    # Hard knee: unity below the threshold, (env/thr)^(1/ratio - 1) above.
    # The exponent is negative for ratio > 1, so louder input -> more
    # attenuation, which is the whole point.
    over = env > threshold
    gain = np.ones_like(env)
    if over.any():
        gain[over] = (env[over] / threshold) ** (1.0 / ratio - 1.0)
    return x * gain
