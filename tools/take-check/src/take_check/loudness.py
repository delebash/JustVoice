# SPDX-License-Identifier: MIT
"""Integrated loudness (ITU-R BS.1770) through pyloudnorm, as its README documents it, and
each take's length."""

from pathlib import Path

import pyloudnorm as pyln
import soundfile as sf


def measure(wav: Path) -> dict[str, float]:
    data, rate = sf.read(str(wav))
    meter = pyln.Meter(rate)  # BS.1770 meter
    return {
        "loudness_lufs": float(meter.integrated_loudness(data)),
        "duration_s": len(data) / rate,
    }
