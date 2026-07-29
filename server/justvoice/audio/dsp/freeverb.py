# SPDX-License-Identifier: MIT
# SPDX-FileCopyrightText: 2026 JustVoice contributors
"""Reverb — Freeverb (Schroeder/Moorer), 8 parallel combs into 4 series allpasses.

This is a port of the SAME algorithm the effect it replaces was already
running. JUCE's `Reverb` class is documented as "based on the technique and
tunings used in FreeVerb", and Jezar (Dreampoint) released Freeverb into the
public domain in June 2000 — so this is not a lookalike, it is the original,
reached directly instead of through a GPL wrapper.

That matters for one practical reason: **saved user chains keep sounding the
same.** Every constant below is the tuning JUCE uses, not a plausible
substitute:

    feedback = room_size * 0.28 + 0.7        (scaleroom / offsetroom)
    damp     = damping   * 0.4               (scaledamp)
    wet      = wet_level * 3                 (wetScaleFactor)
    dry      = dry_level * 2                 (dryScaleFactor)
    wet1     = 0.5 * wet * (1 + width)
    wet2     = 0.5 * wet * (1 - width)
    gain     = 0.015                         (fixed input gain)

Get those scalings wrong and `room_size=0.5` quietly means a different room
than it did yesterday, which is exactly the kind of silent drift a chain
stored in the database cannot survive.

Delay lengths are the 44.1 kHz tunings scaled by `sr/44100` with integer
division, as JUCE does — the engines emit at 22.05k/24k/48k, and an unscaled
port would give a different room per engine.
"""

from __future__ import annotations

import numpy as np
from scipy.signal import lfilter

from ._util import from_rows, to_rows

# Jezar's tunings, at 44.1 kHz.
COMB_TUNINGS = (1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617)
ALLPASS_TUNINGS = (556, 441, 341, 225)
STEREO_SPREAD = 23

FIXED_GAIN = 0.015
WET_SCALE = 3.0
DRY_SCALE = 2.0
ROOM_SCALE = 0.28
ROOM_OFFSET = 0.7
DAMP_SCALE = 0.4


def _scaled(tuning: int, sr: int) -> int:
    """JUCE's integer rescale of a 44.1 kHz tuning to the actual rate."""
    return max(1, (int(sr) * int(tuning)) // 44100)


def _comb(x: np.ndarray, d: int, damp: float, feedback: float) -> np.ndarray:
    """Lowpass-damped feedback comb.

    Per sample:  out = buf[n-d]; last = out*(1-damp) + last*damp;
                 buf[n] = in + last*feedback

    The `last` recursion looks like it forces sample-at-a-time processing,
    but within one d-sized block its INPUT (`buf[n-d]`) is entirely known,
    so it is just a one-pole over a known signal — an exact `lfilter` with
    carried state. No approximation anywhere in here.
    """
    rows, n = to_rows(x, d)
    out_rows = np.empty_like(rows)
    write_prev = np.zeros(d, dtype=np.float64)
    b = np.array([1.0 - damp])
    a = np.array([1.0, -damp])
    zi = np.zeros(1, dtype=np.float64)
    for r in range(rows.shape[0]):
        read = write_prev
        out_rows[r] = read
        last, zi = lfilter(b, a, read, zi=zi)
        write_prev = rows[r] + last * feedback
    return from_rows(out_rows, n)


def _allpass(x: np.ndarray, d: int) -> np.ndarray:
    """Schroeder allpass, fixed 0.5 feedback (as in Freeverb and JUCE)."""
    rows, n = to_rows(x, d)
    out_rows = np.empty_like(rows)
    write_prev = np.zeros(d, dtype=np.float64)
    for r in range(rows.shape[0]):
        bufout = write_prev
        out_rows[r] = bufout - rows[r]
        write_prev = rows[r] + bufout * 0.5
    return from_rows(out_rows, n)


def _tank(mono_in: np.ndarray, sr: int, spread: int, damp: float, feedback: float) -> np.ndarray:
    """One channel's reverb tank: 8 parallel combs summed, then 4 allpasses in series."""
    acc = np.zeros_like(mono_in)
    for tuning in COMB_TUNINGS:
        acc += _comb(mono_in, _scaled(tuning + spread, sr), damp, feedback)
    for tuning in ALLPASS_TUNINGS:
        acc = _allpass(acc, _scaled(tuning + spread, sr))
    return acc


def reverb(x: np.ndarray, sr: int, *, room_size: float = 0.5, damping: float = 0.5,
           wet_level: float = 0.33, dry_level: float = 0.4, width: float = 1.0,
           freeze_mode: float = 0.0) -> np.ndarray:
    """Freeverb. `x` is (channels, n); output is the same shape and length.

    Output length equals input length — the tail is truncated exactly as the
    reference does. That is not an oversight: block offsets, M4B chapter
    marks and the per-block export manifest are all computed from render
    lengths, and a reverb that returned extra samples would shift every one
    of them.
    """
    room_size = float(np.clip(room_size, 0.0, 1.0))
    damping = float(np.clip(damping, 0.0, 1.0))
    width = float(np.clip(width, 0.0, 1.0))

    frozen = float(freeze_mode) >= 0.5
    if frozen:
        # Freeze holds the tail forever: no damping, unity feedback, and the
        # input gate shut so nothing new enters the tank.
        damp, feedback, gain = 0.0, 1.0, 0.0
    else:
        damp = damping * DAMP_SCALE
        feedback = room_size * ROOM_SCALE + ROOM_OFFSET
        gain = FIXED_GAIN

    wet = float(wet_level) * WET_SCALE
    dry = float(dry_level) * DRY_SCALE
    wet1 = 0.5 * wet * (1.0 + width)
    wet2 = 0.5 * wet * (1.0 - width)

    src = x.astype(np.float64, copy=False)
    if src.shape[0] == 1:
        mono_in = src[0] * gain
        out = _tank(mono_in, sr, 0, damp, feedback)
        # Mono has no cross-channel term, so wet2 does not apply.
        return (out * wet1 + src[0] * dry).reshape(1, -1)

    # Stereo (or more): the tank is fed the channel SUM, then the two tanks
    # are cross-mixed by width. Channels beyond the first two pass through
    # the same left/right treatment pairwise.
    left, right = src[0], src[1]
    mono_in = (left + right) * gain
    out_l = _tank(mono_in, sr, 0, damp, feedback)
    out_r = _tank(mono_in, sr, STEREO_SPREAD, damp, feedback)

    result = np.empty_like(src)
    result[0] = out_l * wet1 + out_r * wet2 + left * dry
    result[1] = out_r * wet1 + out_l * wet2 + right * dry
    for ch in range(2, src.shape[0]):
        result[ch] = out_l * wet1 + out_r * wet2 + src[ch] * dry
    return result
