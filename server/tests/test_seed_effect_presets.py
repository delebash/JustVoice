# SPDX-License-Identifier: MIT
"""Built-in effect presets must exist after boot (parity-audit fix) and
every type they use must be one the effects chain knows — since 2026-10-07
the chain runs in audiocpp_dsp, which passes an unknown effect through."""

from __future__ import annotations

import json
import math
from array import array


def _tone_wav() -> bytes:
    from justvoice.audio.wav import write_wav_container

    sr = 24000
    pcm = array("h", [int(0.3 * 32767 * math.sin(2 * math.pi * 220 * i / sr)) for i in range(sr // 2)])
    return write_wav_container(pcm.tobytes(), sr, 1)


def test_builtins_seeded_and_buildable(tmp_path) -> None:
    from justvoice.app import create_app
    from justvoice.database.seed import seed_workspace

    create_app(data_dir=tmp_path)
    seed_workspace()

    from justvoice.database import get_db
    from justvoice.database.models import EffectPreset

    db = next(get_db())
    try:
        rows = db.query(EffectPreset).filter(EffectPreset.is_builtin).all()
        names = {r.name for r in rows}
        assert {"Robotic", "Radio", "Echo Chamber", "Deep Voice"} <= names

        # Every enabled effect in every preset must be one the chain knows —
        # catches the missing-chorus case (Robotic silently became a no-op):
        # an unknown effect gives the audio back untouched.
        from justvoice.audio.effects import apply_effects_chain

        wav = _tone_wav()
        for r in rows:
            for entry in json.loads(r.chain_json):
                if entry.get("enabled", True):
                    assert apply_effects_chain(wav, [entry]) != wav, f"{r.name}: {entry['type']} did nothing"
    finally:
        db.close()


def test_disabled_effects_are_skipped() -> None:
    from justvoice.audio.effects import apply_effects_chain

    wav = _tone_wav()
    chain = [
        {"type": "gain", "enabled": False, "params": {"gain_db": 6.0}},
        {"type": "gain", "enabled": True, "params": {"gain_db": 3.0}},
        {"type": "gain", "params": {"gain_db": 1.0}},  # default = enabled
    ]
    assert apply_effects_chain(wav, chain) == apply_effects_chain(wav, chain[1:])
    assert apply_effects_chain(wav, chain[:1]) == wav
