# SPDX-License-Identifier: MIT
"""Integrated loudness (ITU-R BS.1770) through pyloudnorm, as its README documents it, and
each take's length."""

from pathlib import Path

import pyloudnorm as pyln
import soundfile as sf


def measure(wav: Path) -> dict[str, float | None]:
    data, rate = sf.read(str(wav))
    meter = pyln.Meter(rate)  # BS.1770 meter
    # BS.1770 gates in 400 ms blocks: a take shorter than one block has no integrated loudness
    # (pyloudnorm refuses it) — a broken take, its loudness left empty.
    try:
        loudness = float(meter.integrated_loudness(data))
    except ValueError:
        loudness = None
    return {
        "loudness_lufs": loudness,
        "duration_s": len(data) / rate,
    }
