# SPDX-License-Identifier: MIT
# SPDX-FileCopyrightText: 2026 JustVoice contributors
"""Delay and chorus — the two modulated/feedback delay lines.

Both are the same primitive with different knobs: read the signal back some
number of samples ago, mix it in, optionally feed it round again. Delay's
read point is fixed; chorus's wanders under an LFO, which is what turns a
copy into a thickening.

Both use the block recursion from `_util` — see that module for why a
feedback line vectorises at all.
"""

from __future__ import annotations

import numpy as np

from ._util import from_rows, to_rows


def delay(x: np.ndarray, sr: int, *, delay_seconds: float = 0.5,
          feedback: float = 0.0, mix: float = 0.5) -> np.ndarray:
    """Fixed-time echo with optional regeneration."""
    d = int(round(max(float(delay_seconds), 0.0) * sr))
    if d < 1:
        return x  # a zero-sample delay is a no-op, not an error
    fb = float(np.clip(feedback, 0.0, 0.999))  # >=1 would run away
    mix = float(np.clip(mix, 0.0, 1.0))

    out = np.empty_like(x)
    for ch in range(x.shape[0]):
        rows, n = to_rows(x[ch].astype(np.float64), d)
        wet_rows = np.empty_like(rows)
        # `prev` is the delay line one block back — i.e. exactly the samples
        # this block reads at x[n-d].
        prev = np.zeros(d, dtype=np.float64)
        for r in range(rows.shape[0]):
            read = prev
            written = rows[r] + fb * read
            wet_rows[r] = read
            prev = written
        wet = from_rows(wet_rows, n)
        out[ch] = x[ch] * (1.0 - mix) + wet * mix
    return out


#: At full depth the delay swings +/-50% around the centre. Defining the
#: swing this way rather than +/-100% matters for more than taste: the
#: feedback path below can only be blocked as coarsely as the SHORTEST delay
#: the LFO ever reaches, and a swing to zero would collapse that block to one
#: sample — a per-sample Python loop, i.e. minutes per chapter. The shipped
#: "Robotic" preset uses depth=1.0 with feedback, so this is the live path,
#: not a hypothetical.
_MAX_SWING = 0.5


def chorus(x: np.ndarray, sr: int, *, rate_hz: float = 1.0, depth: float = 0.25,
           centre_delay_ms: float = 7.0, feedback: float = 0.0,
           mix: float = 0.5) -> np.ndarray:
    """LFO-modulated short delay — one detuned copy layered under the dry signal.

    A standard modulated-delay chorus, not a bit-match of any particular
    implementation. Verified structurally (output must differ from input and
    stay bounded), same reasoning as the compressor.
    """
    mix = float(np.clip(mix, 0.0, 1.0))
    fb = float(np.clip(feedback, 0.0, 0.95))
    depth = float(np.clip(depth, 0.0, 1.0))
    centre = max(float(centre_delay_ms), 0.0) / 1000.0 * sr
    if centre < 1.0:
        return x

    n = x.shape[-1]
    swing = _MAX_SWING * depth
    t = np.arange(n, dtype=np.float64) / sr
    delay_samples = centre * (1.0 + swing * np.sin(2.0 * np.pi * float(rate_hz) * t))
    min_delay = max(1, int(np.floor(centre * (1.0 - swing))))
    max_delay = int(np.ceil(centre * (1.0 + swing))) + 2

    idx = np.arange(n, dtype=np.float64)
    read_pos = idx - delay_samples
    out = np.empty_like(x)

    for ch in range(x.shape[0]):
        src = x[ch].astype(np.float64)
        if fb <= 0.0:
            # No feedback: the line only ever reads the dry input, so the
            # whole modulated read is one vectorised interpolation.
            wet = np.interp(read_pos, idx, src, left=0.0, right=0.0)
        else:
            # With feedback the line reads its own past output, so it is built
            # a block at a time. Block size is `min_delay`, which guarantees
            # every read in a block lands strictly before that block starts.
            buf = np.zeros(n, dtype=np.float64)
            for start in range(0, n, min_delay):
                stop = min(start + min_delay, n)
                if start == 0:
                    buf[start:stop] = src[start:stop]
                    continue
                # Interpolate over only the window the reads can reach, not
                # the whole buffer — the naive version is quadratic in n.
                lo = max(0, start - max_delay)
                read = np.interp(
                    read_pos[start:stop], idx[lo:start], buf[lo:start], left=0.0, right=0.0
                )
                buf[start:stop] = src[start:stop] + fb * read
            wet = np.interp(read_pos, idx, buf, left=0.0, right=0.0)
        out[ch] = src * (1.0 - mix) + wet * mix
    return out
