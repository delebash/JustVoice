# SPDX-License-Identifier: MIT
"""Built-in effect presets must exist after boot (parity-audit fix) and
every type they use must be buildable by the effects chain."""

from __future__ import annotations

import json


def test_builtins_seeded_and_buildable(tmp_path) -> None:
    from justvoice.app import create_app

    create_app(data_dir=tmp_path)

    from justvoice.database import get_db
    from justvoice.database.models import EffectPreset

    db = next(get_db())
    try:
        rows = db.query(EffectPreset).filter(EffectPreset.is_builtin).all()
        names = {r.name for r in rows}
        assert {"Robotic", "Radio", "Echo Chamber", "Deep Voice"} <= names

        # Every preset chain must build into pedalboard plugins — catches
        # the missing-chorus case (Robotic silently became a no-op).
        from justvoice.audio.effects import _build_plugins

        for r in rows:
            chain = json.loads(r.chain_json)
            plugins = _build_plugins(chain)
            enabled = [e for e in chain if e.get("enabled", True)]
            assert len(plugins) == len(enabled), f"{r.name}: {len(plugins)} != {len(enabled)}"
    finally:
        db.close()


def test_disabled_effects_are_skipped() -> None:
    from justvoice.audio.effects import _build_plugins

    chain = [
        {"type": "gain", "enabled": False, "params": {"gain_db": 6.0}},
        {"type": "gain", "enabled": True, "params": {"gain_db": 3.0}},
        {"type": "gain", "params": {"gain_db": 1.0}},  # default = enabled
    ]
    assert len(_build_plugins(chain)) == 2
