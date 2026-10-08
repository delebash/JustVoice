"""Delivery overlay — per-line knobs (speed/pitch/gain/pause/emotion/instruct).

The overlay is optional per render — every field defaults to "engine's
own default behavior". Post-render speed (when the model did not pace
itself), gain and pitch are applied to the finished line by the DSP program
(render_core.line_shape → audio/dsp_client.py); everything else is passed to
the engine and the engine chooses how to honor it.
"""

from __future__ import annotations

from typing import Any


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
