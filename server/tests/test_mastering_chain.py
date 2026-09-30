# SPDX-License-Identifier: MIT
"""The ACX mastering chain, run for real: a mastered chapter must pass the
app's own ACX QC limits (RMS -23..-18 dBFS, peak <= -3 dBFS).

Found 2026-09-29 on a live render: `dynaudnorm` ran after `loudnorm` and
renormalised toward a 0.95 peak, so an "acx" chapter measured -16.8 LUFS with
its peak at -0.5 dBFS — mastered, and failing ACX. Skipped without ffmpeg.
"""

from __future__ import annotations

import math
import random
import struct

import pytest

from justvoice.audio.analyzer import analyze
from justvoice.mastering import have_ffmpeg, master_to_wav
from justvoice.models import MasterPresetSettings

pytestmark = pytest.mark.skipif(not have_ffmpeg(), reason="ffmpeg not on PATH")

RATE = 44_100


def _speechlike(seconds: float) -> bytes:
    """Mono 16-bit PCM: voiced-band tones under a syllable-rate envelope, in
    loud and quiet passages — the dynamics a narrated chapter has."""
    rnd = random.Random(7)
    freqs = [(180, 0.5), (360, 0.3), (720, 0.2), (1500, 0.12), (2800, 0.06)]
    out = bytearray()
    for i in range(int(seconds * RATE)):
        t = i / RATE
        passage = 0.9 if int(t // 4) % 2 == 0 else 0.25        # loud / quiet, 4 s each
        syllable = 0.5 + 0.5 * math.sin(2 * math.pi * 4.0 * t)  # ~4 syllables a second
        tone = sum(a * math.sin(2 * math.pi * f * t) for f, a in freqs)
        s = passage * syllable * tone + rnd.uniform(-0.01, 0.01)
        out += struct.pack("<h", max(-32767, min(32767, int(s * 20000))))
    return bytes(out)


def test_acx_master_passes_the_acx_qc_limits():
    wav = master_to_wav(_speechlike(24.0), RATE, 1, preset_name="acx", presets=MasterPresetSettings())
    loud = analyze(wav).loudness
    assert loud.peak_dbfs <= -3.0, loud
    assert -23.0 <= loud.rms_dbfs <= -18.0, loud
