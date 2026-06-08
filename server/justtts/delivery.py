"""Delivery overlay — per-line knobs (speed/pitch/gain/pause/emotion/instruct).

The overlay is optional per render — every field defaults to "engine's
own default behavior". Post-render gain is applied here as PCM
scaling; everything else is passed to the engine and the engine
chooses how to honor it.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np


def apply_gain_db(pcm: bytes, gain_db: float) -> bytes:
    """Scale 16-bit PCM by `gain_db` decibels (no ffmpeg round-trip)."""
    if abs(gain_db) < 1e-6:
        return pcm
    samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32)
    factor = 10.0 ** (gain_db / 20.0)
    samples = np.clip(samples * factor, -32768, 32767).astype("<i2")
    return samples.tobytes()


def canonical_json(delivery: dict[str, Any] | None) -> str:
    """Stable string form for cache-key hashing.

    Drops null/empty/default fields so functionally-equivalent overlays
    collide on the same key.
    """
    if not delivery:
        return ""
    import json

    canonical = {}
    for k, v in delivery.items():
        if v is None:
            continue
        if k == "speed" and abs(float(v) - 1.0) < 1e-6:
            continue
        if k == "pitch" and abs(float(v)) < 1e-6:
            continue
        if k == "pause_before" and int(v) == 0:
            continue
        if k == "pause_after" and int(v) == 0:
            continue
        if k == "gain_db" and abs(float(v)) < 1e-6:
            continue
        if k == "instruct" and not str(v).strip():
            continue
        if k == "engine" and not v:
            continue
        canonical[k] = v
    return json.dumps(canonical, sort_keys=True, separators=(",", ":"))
