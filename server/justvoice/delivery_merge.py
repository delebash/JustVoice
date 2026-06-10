# SPDX-License-Identifier: GPL-3.0-or-later
"""3-tier voice tuning merge (task #88).

Tier 1 (lowest precedence) — Engine defaults from CAPABILITY_DETAILS.
Tier 2                     — VoiceProfile.default_delivery JSON.
Tier 3 (highest precedence)— RenderPreset.delivery_overlay OR request.delivery.

`merge_delivery()` collapses these into one effective delivery dict that
the engine receives. Higher-precedence dicts win on key conflict; missing
keys fall through. Engine-specific subdicts (`delivery.engine.*`) merge at
the inner-key level too.

Why a dedicated module: the merge is called from BOTH /v1/generate (single-
line) AND /v1/chapters/render (chapter batch), and the tier ordering must
match exactly across both. One place to look when debugging "why is my
exaggeration override being ignored."
"""

from __future__ import annotations

import json
import logging
from typing import Optional

from sqlalchemy.orm import Session

from .database.models import RenderPreset


logger = logging.getLogger("justvoice.delivery-merge")


def _decode_json_dict(raw: Optional[str]) -> dict:
    if not raw:
        return {}
    try:
        v = json.loads(raw)
        return v if isinstance(v, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def _deep_merge(base: dict, overlay: dict) -> dict:
    """Merge `overlay` into `base`, recursing into nested dicts.

    Overlay wins on conflict. Non-dict values are replaced wholesale.
    Lists are NOT merged element-wise (overlay's list replaces base's).
    """
    out = dict(base) if base else {}
    if not overlay:
        return out
    for k, v in overlay.items():
        if v is None:
            continue
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def merge_delivery(
    request_delivery: Optional[dict],
    preset_id: Optional[str],
    db: Session,
    tier2_overlay: Optional[dict] = None,
) -> dict:
    """Collapse the 3 tiers into a single effective delivery dict.

    Precedence (highest first):
      preset.delivery > request.delivery > tier2_overlay (persona)

    Caller is responsible for resolving persona.default_delivery from
    PersonaStore and passing it as `tier2_overlay`. The legacy
    profile_id lookup was removed in Slice 4 of the Profile-kill rollout.

    Returns the merged delivery dict (or empty {} if nothing supplied).
    """
    # Tier 2 — persona overlay (caller-resolved)
    tier2: dict = tier2_overlay or {}

    # Tier 3a — request.delivery (set by the caller per-request)
    tier3a: dict = request_delivery or {}

    # Tier 3b — render preset (project- or global-scoped)
    tier3b: dict = {}
    if preset_id:
        preset = db.query(RenderPreset).filter(RenderPreset.id == preset_id).first()
        if preset and preset.delivery_json:
            tier3b = _decode_json_dict(preset.delivery_json)
        elif not preset:
            logger.warning("merge_delivery: preset %s not found, skipping Tier-3 preset", preset_id)

    # Merge bottom-up.
    merged = _deep_merge({}, tier2)
    merged = _deep_merge(merged, tier3a)
    merged = _deep_merge(merged, tier3b)
    return merged
