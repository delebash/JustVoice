# SPDX-License-Identifier: MIT
"""The speech runtime's per-model options a user can set — set on each model row of Speech
engines, saved in `engine_overrides[engine].runtime_options[model]`, and passed as the model's
session options when it is registered (audit 2026-10-04 §13.5, batch 5h).

Only options whose effect was measured are offered; every value is one audio.cpp accepts
(checked in our copy's source). A session option is read when the model loads, so a change
reloads a loaded model.

Measured on Qwen3-TTS CustomVoice 1.7B, a 752-character line in 200-character pieces, on an
8 GB card (docs/dev/RESEARCH.md §2.1): `perf_mode=flash_attention` 194 MB less at the peak and
9 % faster, a different take for the same seed; `conv_weight_type=f16` 492 MB less, the audio
2.04 dB (log-spectral) from the 32-bit take — close. `mem_saver` changed nothing there, so it
is not offered.

Each option has the app's `default` (what a model loads with when nothing is set) and audio.cpp's
own `runtime_default` (never sent). They differ for Decoder weights: the user could not tell 16-bit
from 32-bit by ear (2026-10-04, a CustomVoice line at the same seed), so 16-bit is the default and
is sent to every Qwen3 model unless 32-bit is chosen on its row.
"""

from __future__ import annotations

from typing import Any

# family → the options offered for its models. `only_8bit`: audio.cpp accepts it only with
# Q8_0 weights (`qwen3_tts.perf_mode=flash_attention is supported only with Q8_0 GGUF weights`,
# ../audio.cpp/src/models/qwen3_tts/session.cpp).
OFFERED: dict[str, list[dict[str, Any]]] = {
    "qwen3_tts": [
        {
            "key": "qwen3_tts.perf_mode",
            "label": "Attention",
            "choices": [("off", "Exact"), ("flash_attention", "Flash attention")],
            "default": "off",
            "runtime_default": "off",
            "only_8bit": True,
            "hint": "Flash attention: about 9 % faster and 0.2 GB less at the peak; the same "
                    "seed gives a different take.",
        },
        {
            "key": "qwen3_tts.conv_weight_type",
            "label": "Decoder weights",
            "choices": [("f16", "16-bit"), ("f32", "32-bit")],
            "default": "f16",
            "runtime_default": "f32",
            "only_8bit": False,
            "hint": "16-bit: about 0.5 GB less at the peak than 32-bit; no difference heard.",
        },
    ],
}


def _is_8bit(row: dict) -> bool:
    # The catalog's own mark: every 8-bit row's id ends "-q8" (`release.sixteen_bit` swaps it
    # for the 16-bit sibling's). A file name is not one — Base 1.7B's is "…-q8_0_v2.gguf".
    return str(row.get("id", "")).endswith("-q8")


def offered_for(row: dict) -> list[dict[str, Any]]:
    """The options a manifest row's model takes."""
    family = (row.get("audiocpp") or {}).get("family")
    return [o for o in OFFERED.get(family, []) if not o["only_8bit"] or _is_8bit(row)]


def saved_for(engine_id: str, variant_id: str) -> dict[str, str]:
    """What the user set for this model (only non-default values are kept)."""
    try:
        from ...app_state import get_state

        ov = get_state().settings.get().engines.engine_overrides.get(engine_id)
    except Exception:  # noqa: BLE001 — no app state (unit tests): nothing set
        return {}
    return dict((ov.runtime_options.get(variant_id) or {}) if ov else {})


def chosen_for(engine_id: str, row: dict) -> dict[str, str]:
    """Every option the row takes, at the value it loads with: what the user saved, else the
    app's default. A value saved for an option the row no longer offers is dropped."""
    saved = saved_for(engine_id, row["id"])
    out: dict[str, str] = {}
    for o in offered_for(row):
        value = saved.get(o["key"])
        out[o["key"]] = value if value in {c for c, _l in o["choices"]} else o["default"]
    return out


def session_options_for(engine_id: str, row: dict) -> dict[str, str]:
    """What `_entries_for` passes at registration: each chosen value that isn't audio.cpp's own
    default (16-bit Decoder weights is sent unless 32-bit is chosen)."""
    runtime_default = {o["key"]: o["runtime_default"] for o in offered_for(row)}
    return {k: v for k, v in chosen_for(engine_id, row).items() if v != runtime_default[k]}


def validate(row: dict, values: dict[str, str]) -> dict[str, str]:
    """`values` checked against what the row offers; values at the app's default dropped (nothing
    saved = the default). Raises ValueError naming the first bad key or value."""
    offered = {o["key"]: o for o in offered_for(row)}
    out: dict[str, str] = {}
    for key, value in values.items():
        opt = offered.get(key)
        if opt is None:
            raise ValueError(f"{row.get('name', row['id'])} has no runtime option {key}")
        allowed = [c for c, _l in opt["choices"]]
        if value not in allowed:
            raise ValueError(f"{opt['label']} must be one of {', '.join(allowed)}")
        if value != opt["default"]:
            out[key] = value
    return out


def describe(engine_id: str, row: dict) -> list[dict[str, Any]]:
    """The row's offered options with their current values — the model row reads this."""
    chosen = chosen_for(engine_id, row)
    return [{"key": o["key"], "label": o["label"], "hint": o["hint"], "default": o["default"],
             "choices": [{"value": c, "label": lbl} for c, lbl in o["choices"]],
             "value": chosen[o["key"]]}
            for o in offered_for(row)]
