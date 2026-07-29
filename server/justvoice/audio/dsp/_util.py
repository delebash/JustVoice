# SPDX-License-Identifier: MIT
# SPDX-FileCopyrightText: 2026 JustVoice contributors
"""Block-recursion helpers.

Every recursive effect here (comb, allpass, feedback delay) reads its own
output D samples back. That is the whole trick: inside any window of D
samples, every feedback reference points at data written BEFORE the window
started, so the window can be computed with one vectorised numpy expression
instead of D scalar steps.

So we reshape the signal to `(rows, D)` and iterate over ROWS. Cost drops
from O(n) Python iterations to O(n/D) — for a comb at D=1116 that is a
~1000x reduction in interpreter overhead, which is the difference between
"usable" and "a chapter render takes an hour".

Block size is always the stage's OWN delay, never a global minimum: the
Freeverb combs are 1116-1617 samples while its allpasses are 225-556, and
running the combs at the allpass block size would waste ~5x for nothing.
"""

from __future__ import annotations

import numpy as np


def to_rows(x: np.ndarray, d: int) -> tuple[np.ndarray, int]:
    """Reshape a 1-D signal into `(rows, d)`, zero-padded to fit.

    Returns the row view and the ORIGINAL length, because every caller has
    to truncate back to it — see the length contract in `dsp/__init__.py`.
    """
    n = int(x.shape[-1])
    rows = -(-n // d)  # ceil division
    pad = rows * d - n
    if pad:
        x = np.concatenate([x, np.zeros(pad, dtype=x.dtype)])
    return x.reshape(rows, d), n


def from_rows(rows: np.ndarray, n: int) -> np.ndarray:
    """Flatten `(rows, d)` back to 1-D and truncate to the original length."""
    return rows.reshape(-1)[:n]
