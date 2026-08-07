# SPDX-License-Identifier: MIT
#
# Preset data adapted from voicebox (MIT) — backend/utils/effects.py
# BUILTIN_PRESETS at the commit pinned in voicebox-pin.txt. Original
# copyright (c) the voicebox authors.
"""Idempotent boot-time seeding — built-in effect presets.

The EffectPreset model + API carried `is_builtin` guards from day one,
but nothing ever inserted the built-ins (parity-audit finding F5:
/v1/effect-presets returned []). Runs on every boot; existing rows by
name are left untouched so user edits to sort order survive.
"""

from __future__ import annotations

import json
import logging

log = logging.getLogger(__name__)

BUILTIN_EFFECT_PRESETS: list[dict] = [
    {
        "name": "Robotic",
        "sort_order": 0,
        "description": "Metallic robotic voice (flanger with slow LFO and high feedback)",
        "chain": [
            {
                "type": "chorus",
                "enabled": True,
                "params": {
                    "rate_hz": 0.2,
                    "depth": 1.0,
                    "feedback": 0.35,
                    "centre_delay_ms": 7.0,
                    "mix": 0.5,
                },
            },
        ],
    },
    {
        "name": "Radio",
        "sort_order": 1,
        "description": "Thin AM-radio voice with band-pass filtering and light compression",
        "chain": [
            {"type": "highpass", "enabled": True, "params": {"cutoff_frequency_hz": 300.0}},
            {"type": "lowpass", "enabled": True, "params": {"cutoff_frequency_hz": 3500.0}},
            {
                "type": "compressor",
                "enabled": True,
                "params": {"threshold_db": -15.0, "ratio": 6.0, "attack_ms": 5.0, "release_ms": 50.0},
            },
            {"type": "gain", "enabled": True, "params": {"gain_db": 6.0}},
        ],
    },
    {
        "name": "Echo Chamber",
        "sort_order": 2,
        "description": "Spacious reverb with trailing echo",
        "chain": [
            {
                "type": "reverb",
                "enabled": True,
                "params": {
                    "room_size": 0.85,
                    "damping": 0.3,
                    "wet_level": 0.45,
                    "dry_level": 0.55,
                    "width": 1.0,
                },
            },
            {
                "type": "delay",
                "enabled": True,
                "params": {"delay_seconds": 0.25, "feedback": 0.3, "mix": 0.2},
            },
        ],
    },
    {
        "name": "Deep Voice",
        "sort_order": 99,
        "description": "Lower pitch with added warmth",
        "chain": [
            {"type": "pitch_shift", "enabled": True, "params": {"semitones": -3.0}},
            {"type": "lowpass", "enabled": True, "params": {"cutoff_frequency_hz": 6000.0}},
            {
                "type": "compressor",
                "enabled": True,
                "params": {"threshold_db": -18.0, "ratio": 3.0, "attack_ms": 10.0, "release_ms": 150.0},
            },
        ],
    },
]


def seed_builtin_effect_presets() -> None:
    """Insert any missing built-in presets. Safe to call on every boot."""
    from . import session as _db_session
    from .models import EffectPreset

    if _db_session.SessionLocal is None:
        return
    db = _db_session.SessionLocal()
    try:
        for preset in BUILTIN_EFFECT_PRESETS:
            existing = db.query(EffectPreset).filter_by(name=preset["name"]).first()
            if existing is not None:
                continue
            db.add(
                EffectPreset(
                    name=preset["name"],
                    description=preset["description"],
                    chain_json=json.dumps(preset["chain"]),
                    is_builtin=True,
                    sort_order=preset["sort_order"],
                )
            )
        db.commit()
    except Exception as e:
        log.warning("builtin effect-preset seed failed: %s", e)
        db.rollback()
    finally:
        db.close()


# ── Built-in render presets (task #88) ────────────────────────────────────
#
# The 4 delivery styles the Studio Render tab's per-chapter "Preset:"
# dropdown was designed around (docs/plans/archive/discussed-features-inventory.md).
# Global scope, NO voice binding — a preset is HOW a render sounds; WHO
# speaks comes from the block's persona. `instruct` is consumed by engines
# that declare supports_instruct_freeform and ignored by the rest; the
# numeric knobs work everywhere.

BUILTIN_RENDER_PRESETS: list[dict] = [
    {
        "name": "Narration",
        "description": "Even, steady long-form narration — the default audiobook voice.",
        "delivery": {
            "speed": 1.0,
            "pause_after": 300,
            "instruct": "Calm, steady audiobook narration. Even pacing, clear diction, no theatrics.",
        },
    },
    {
        "name": "Dramatic Dialogue",
        "description": "Heightened, emotional character dialogue.",
        "delivery": {
            "speed": 1.03,
            "pause_before": 150,
            "instruct": "Expressive, emotionally charged dialogue. Vary intensity with the line; let tension show.",
        },
    },
    {
        "name": "Quiet Reflection",
        "description": "Soft, slow, introspective passages.",
        "delivery": {
            "speed": 0.94,
            "gain_db": -1.0,
            "pause_after": 500,
            "instruct": "Soft, intimate, introspective. Slow down, lower the energy, leave room around sentences.",
        },
    },
    {
        "name": "Action",
        "description": "Fast, urgent sequences — tight pauses, forward drive.",
        "delivery": {
            "speed": 1.08,
            "pause_after": 120,
            "instruct": "Urgent and propulsive. Quick pacing, clipped pauses, momentum from line to line.",
        },
    },
]


def seed_builtin_render_presets() -> None:
    """Insert any missing built-in render presets (global, delivery-only).
    Reseed-by-name on every boot, mirroring the effect-preset behavior."""
    from . import session as _db_session
    from .models import RenderPreset

    if _db_session.SessionLocal is None:
        return
    db = _db_session.SessionLocal()
    try:
        for preset in BUILTIN_RENDER_PRESETS:
            existing = (
                db.query(RenderPreset)
                .filter(
                    RenderPreset.name == preset["name"],
                    RenderPreset.project_id.is_(None),
                )
                .first()
            )
            if existing is not None:
                continue
            db.add(
                RenderPreset(
                    name=preset["name"],
                    project_id=None,
                    voice_id=None,
                    delivery_json=json.dumps(preset["delivery"]),
                    lexicons_json="[]",
                    description=preset["description"],
                    is_builtin=True,
                )
            )
        db.commit()
    except Exception as e:
        log.warning("builtin render-preset seed failed: %s", e)
        db.rollback()
    finally:
        db.close()


def seed_workspace() -> None:
    """Serve-time workspace seeding — the family call-site (target-tree P6).

    Everything here ran inside create_app() until 2026-08-08; it moved so
    `create_app(tmp_path)` starts from an EMPTY, unmigrated database (JW's
    pytest-isolation rationale, the family's named winner). Called by serve.py
    after create_app; tests that assert seeded content call it explicitly.
    The factory-reset path stays on its own bundle (data_admin.py →
    llm_bootstrap.reseed_shared_llm — reset semantics, no migrations).

    ORDER IS THE CONTRACT (moved verbatim from create_app):
    warm-OFF default BEFORE seed_llm (the shared insert-if-missing must skip
    JV's explicit "0"); legacy-prompt migration BEFORE seed_llm (user edits
    win over seed defaults, ruling 1); settings→DB provider migration, the
    shared seed, then the registry boots FROM THE DB — the exact order
    JustWrite uses, so `registered` flags are live from boot; tunable-lift and
    catalog-row retirement after the presets exist; effect/render presets are
    independent domain seeds and run first.
    """
    from llm_runner.llm import load_from_configs, stores
    from llm_runner.llm.seed import seed_llm

    from ..app_state import get_state
    from ..engines.llm.migrate_prompts import (
        lift_edited_tunables_into_presets,
        migrate_jv_prompts_to_shared,
    )
    from ..engines.llm.migrate_providers import migrate_settings_providers_to_db
    from ..llm_bootstrap import apply_jv_warm_default, retire_default_catalog_rows

    seed_builtin_effect_presets()
    seed_builtin_render_presets()

    apply_jv_warm_default()
    migrate_jv_prompts_to_shared()
    migrate_settings_providers_to_db(get_state().settings.get())
    seed_llm()
    lift_edited_tunables_into_presets()
    retire_default_catalog_rows()
    load_from_configs(stores.get_provider_store().list())
