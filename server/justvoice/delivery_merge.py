# SPDX-License-Identifier: MIT
"""3-tier voice tuning merge (task #88).

Tier 1 (lowest precedence) — Engine defaults from CAPABILITY_DETAILS.
Tier 2                     — the persona overlay (caller-resolved; was
                             VoiceProfile.default_delivery before the Profile-kill).
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


def compose_instruct(*hints: Optional[str]) -> Optional[str]:
    """Join delivery hints into the ONE instruct string engines consume.

    Qwen — the only family that reads instruct — has a single upstream slot,
    so everything that shapes delivery has to arrive as one sentence. The
    ordering rule is **most specific last**: the persona says who they are,
    the emotion labels the state, the line says how this one goes.

    A lone hint passes through **verbatim**, unjoined and unstripped: a
    hand-written instruct must never be reformatted just because it happens
    to be the only one present.

    Lives here rather than in either caller because `/v1/generate` and
    `/v1/chapters/render` both compose it and drifting apart would mean the
    same persona sounds different depending on which button was pressed —
    which is exactly what happened until 2026-08-17, when only the chapter
    path composed at all and the one-off path dropped emotion on the floor.
    """
    kept = [h for h in hints if h]
    if not kept:
        return None
    if len(kept) == 1:
        return kept[0]
    return ". ".join(h.rstrip(". ") for h in kept)


def _decode_json_dict(raw: Optional[str]) -> dict:
    if not raw:
        return {}
    try:
        v = json.loads(raw)
        return v if isinstance(v, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def nest_engine_keys(delivery: dict) -> dict:
    """Move engine-private keys out of the top level and into `engine`.

    Every UI that writes delivery — `VoiceParamsModal.vue`, Generate's
    sliders, render presets — saves the capability schema's keys **flat**
    (`{"exaggeration": 0.7}`), because that is the shape the knob schema
    itself has. Every engine adapter reads them **nested**
    (`delivery["engine"]["exaggeration"]`, see `chatterbox/engine.py`,
    `qwen3/engine.py`, `luxtts/engine.py`,
    `moss_tts/engine.py`). Nothing bridged the two, so exaggeration,
    cfg_weight, repetition_penalty, min_p, t_shift, guidance_scale and the
    rest have never reached an engine — only the fields that happen to be
    canonical `Delivery` members (speed, temperature, instruct, seed,
    gain_db) ever worked.

    Fixing it here rather than in each UI means one seam, and it also
    repairs deliveries **already stored flat** in `personas.default_delivery`
    and `render_presets.delivery_json`.

    An explicit `engine` subdict still wins: a key present in both places
    keeps the nested value, since that is the one the caller wrote
    deliberately.
    """
    if not delivery:
        return {}
    from .models import Delivery  # local import — avoids a cycle at module load

    canonical = set(Delivery.model_fields)
    nested = dict(delivery.get("engine") or {})
    out: dict = {}
    for k, v in delivery.items():
        if k == "engine":
            continue
        if k in canonical:
            out[k] = v
        elif k not in nested:
            nested[k] = v
    if nested:
        out["engine"] = nested
    return out


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

    # Merge bottom-up. Each tier is normalised FIRST, so a flat
    # `exaggeration` in the persona and a nested one in the preset land in
    # the same place and the precedence above still decides the winner.
    merged = _deep_merge({}, nest_engine_keys(tier2))
    merged = _deep_merge(merged, nest_engine_keys(tier3a))
    merged = _deep_merge(merged, nest_engine_keys(tier3b))
    return merged
