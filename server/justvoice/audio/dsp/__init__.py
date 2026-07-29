# SPDX-License-Identifier: MIT
# SPDX-FileCopyrightText: 2026 JustVoice contributors
"""The effects DSP — twelve primitives over numpy, no native audio dependency.

This package exists to delete one GPL dependency. It implements exactly the
twelve effects the render path actually calls; it is NOT a general audio
framework and should not grow into one by accident.

**Contracts every effect here obeys**

1. Signature is `fn(x, sr, **params) -> np.ndarray`, where `x` is
   `(channels, n_samples)` float. Parameter NAMES match the chain specs
   already stored in the database, so no migration is needed.
2. **Output length equals input length.** Always. Reverb and delay tails are
   truncated rather than extending the buffer. Downstream code computes
   block offsets, M4B chapter marks and export manifests from render
   lengths — an effect that returned extra samples would silently shift all
   of them.
3. No effect raises on bad parameters. Out-of-range values are clamped and
   degenerate settings return the input untouched; a chain must never be
   able to take down a render.

**Where this is expected to match the previous implementation exactly**, and
where it is not, is deliberate and tested accordingly:

  * `gain`, `distortion`, the five filters, `delay` — same published maths,
    verified NUMERICALLY in `test_dsp_parity.py`.
  * `reverb` — same algorithm (Freeverb) with the same tunings, so it should
    track closely; see `freeverb.py`.
  * `compressor`, `chorus` — standard topologies, deliberately not
    bit-matched; verified STRUCTURALLY in `test_dsp_bite.py`.
  * `pitch_shift` — Signalsmith Stretch (MIT), which is a different and
    generally better engine than the one it replaces.

`DSP_VERSION` is folded into the render cache key. **Bump it whenever a
change here alters output**, or cached takes rendered by the old code will
be served alongside new ones with no way to tell them apart.
"""

from __future__ import annotations

import logging

import numpy as np

from .biquad import high_shelf, highpass, low_shelf, lowpass, peak
from .delays import chorus, delay
from .dynamics import compressor
from .freeverb import reverb

log = logging.getLogger(__name__)

DSP_VERSION = "dsp1"


def gain(x: np.ndarray, sr: int, *, gain_db: float = 0.0) -> np.ndarray:
    """Level trim."""
    return x * (10.0 ** (float(gain_db) / 20.0))


def distortion(x: np.ndarray, sr: int, *, drive_db: float = 25.0) -> np.ndarray:
    """Soft clipping via a tanh waveshaper."""
    return np.tanh(x * (10.0 ** (float(drive_db) / 20.0)))


def pitch_shift(x: np.ndarray, sr: int, *, semitones: float = 0.0) -> np.ndarray:
    """Shift pitch, preserving duration, via Signalsmith Stretch (MIT).

    Imported lazily: it is a native extension, and the cold paths that never
    pitch-shift should not pay for loading it.

    If the package is missing the audio passes through UNCHANGED and the
    failure is logged at ERROR. That is the same "a chain never kills a
    render" rule the rest of this package follows — but it is a real
    install fault, so it is logged loudly rather than as a warning.
    """
    semitones = float(semitones)
    if abs(semitones) < 1e-6:
        return x
    try:
        import python_stretch as ps
    except ImportError:
        log.error(
            "effects: pitch_shift needs the 'python-stretch' package, which is not "
            "installed — audio passed through unshifted. Install it: pip install python-stretch"
        )
        return x

    stretch = ps.Signalsmith.Stretch()
    stretch.preset(int(x.shape[0]), int(sr))
    stretch.setTransposeSemitones(semitones)
    out = np.ascontiguousarray(stretch.process(np.ascontiguousarray(x, dtype=np.float32)))

    # Trust but verify the length contract — a silent off-by-N here would
    # desync every downstream offset, and that is expensive to debug later.
    n = x.shape[-1]
    if out.shape[-1] != n:
        out = out[..., :n] if out.shape[-1] > n else np.pad(
            out, ((0, 0), (0, n - out.shape[-1]))
        )
    return out


#: Chain `type` string -> effect callable. `effects.py` resolves against this
#: and skips anything it does not recognise, exactly as before.
EFFECTS = {
    "reverb": reverb,
    "chorus": chorus,
    "distortion": distortion,
    "gain": gain,
    "compressor": compressor,
    "pitch_shift": pitch_shift,
    "delay": delay,
    "highpass": highpass,
    "lowpass": lowpass,
    "eq_low": low_shelf,
    "eq_mid": peak,
    "eq_high": high_shelf,
}

__all__ = ["EFFECTS", "DSP_VERSION", "gain", "distortion", "pitch_shift",
           "reverb", "chorus", "compressor", "delay",
           "highpass", "lowpass", "low_shelf", "peak", "high_shelf"]
