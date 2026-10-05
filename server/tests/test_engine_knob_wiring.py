# SPDX-License-Identifier: MIT
"""Every declared knob must be a knob the engine actually receives.

The 2026-08-17 audit found 13 knobs declared in `capability_details` that no
engine adapter read, and 7 the adapters read that nothing declared. Both
directions are user-visible lies: a slider that moves nothing, or a control
that exists but cannot be reached. Since the 2026-10-01 switch the "adapter"
is one function — `engines/audiocpp/slot.py: to_speech_request`, which maps our
request onto audio.cpp's — so these tests drive it directly: set every
declared knob, and the value must come out the other side.
"""

from __future__ import annotations

import pytest

from justvoice.delivery_merge import nest_engine_keys
from justvoice.engines.audiocpp.slot import to_speech_request
from justvoice.engines.capability_details import CAPABILITY_DETAILS, lookup
from justvoice.engines.manager import discover_engines
from justvoice.models import Delivery

# Capability row → a catalog variant that renders with it, and how the body
# must look for that family to take the request at all (a clone needs a clip,
# VoiceDesign a description).
ROW_VARIANT = {
    "kokoro": ("kokoro", "kokoro-82m-q8", {"voice_id": "af_heart"}),
    "chatterbox": ("chatterbox", "chatterbox-multilingual-v2-q8", {"audio_prompt_path": "/v/ref.wav"}),
    "chatterbox-multilingual": ("chatterbox", "chatterbox-multilingual-v2-q8",
                                {"audio_prompt_path": "/v/ref.wav"}),
    "qwen3": ("qwen3", "qwen3-cv-1.7b-q8", {"voice_id": "Ryan"}),
    "qwen3-cv": ("qwen3", "qwen3-cv-1.7b-q8", {"voice_id": "Ryan"}),
    "qwen3-base": ("qwen3", "qwen3-base-1.7b-q8", {"audio_prompt_path": "/v/ref.wav", "ref_text": "Hi there."}),
    "chatterbox-turbo": ("chatterbox", "chatterbox-turbo-q8", {"audio_prompt_path": "/v/ref.wav"}),
    "chatterbox-nano": ("chatterbox", "chatterbox-nano-q8", {"audio_prompt_path": "/v/ref.wav"}),
    "qwen3-vd": ("qwen3", "qwen3-vd-1.7b-q8", {"delivery": {"instruct": "A gravel voice."}}),
    "kitten": ("kitten", "kitten-mini-0.8", {"voice_id": "kitten_leo"}),
    "pocket": ("pocket", "pocket-en-q8", {"voice_id": "pocket_alba"}),
    "voxcpm2": ("voxcpm2", "voxcpm2-q8", {"audio_prompt_path": "/v/ref.wav"}),
}

# Where each knob lands in audio.cpp's request ("options.x" = inside options).
LANDS_AT = {
    "speed": "speed", "seed": "seed",
    "temperature": "options.temperature", "talker_temperature": "options.temperature",
    "exaggeration": "options.exaggeration", "cfg_weight": "options.guidance_scale",
    "repetition_penalty": "options.repetition_penalty", "top_p": "options.top_p",
    "talker_top_k": "options.top_k", "talker_top_p": "options.top_p",
    "top_k": "options.top_k",
    "cfg_value": "options.guidance_scale", "inference_timesteps": "options.num_inference_steps",
    # Audit 2026-10-04 §7 / §13.5 (5h): options audio.cpp reads that the app now offers.
    "min_p": "options.min_p", "s3gen_cfg_rate": "options.s3gen_cfg_rate",
    "subtalker_temperature": "options.subtalker_temperature",
    "subtalker_top_k": "options.subtalker_top_k", "subtalker_top_p": "options.subtalker_top_p",
    "retry_badcase_max_times": "options.retry_badcase_max_times",
    "retry_badcase_ratio_threshold": "options.retry_badcase_ratio_threshold",
}
TOP_LEVEL = {"speed", "seed"}   # canonical Delivery fields / the request's own seed


def _row(engine: str, variant: str) -> dict:
    # PENDING_VARIANTS: rows written and published that wait for the pinned runtime's feature
    # (Chatterbox Turbo / Nano on a pin before v0.9.0-jv.4) — their knobs must reach the runtime too.
    module = discover_engines()[engine].module
    rows = list(module.VARIANTS) + list(getattr(module, "PENDING_VARIANTS", []))
    return next(r for r in rows if r["id"] == variant)


def test_every_capability_row_has_a_variant_to_drive() -> None:
    assert set(ROW_VARIANT) == set(CAPABILITY_DETAILS)


@pytest.mark.parametrize("cap_id", sorted(CAPABILITY_DETAILS))
def test_every_declared_knob_reaches_the_runtime(cap_id: str) -> None:
    """No slider may exist that the engine never receives."""
    engine, variant, base = ROW_VARIANT[cap_id]
    for knob in CAPABILITY_DETAILS[cap_id].knobs:
        assert knob.key in LANDS_AT, f"{cap_id}: knob {knob.key!r} has no audio.cpp mapping"
        value = (knob.max if knob.max != knob.default else knob.min)
        body = {"text": "Hi.", "language": "en", **base}
        delivery = dict(base.get("delivery") or {})
        if knob.key == "seed":
            body["seed"] = int(value)
        elif knob.key in TOP_LEVEL:
            delivery[knob.key] = value
        else:
            delivery["engine"] = {knob.key: value}
        body["delivery"] = delivery
        req = to_speech_request(_row(engine, variant), body)
        where = LANDS_AT[knob.key]
        got = (req.get("options") or {}).get(where[8:]) if where.startswith("options.") else req.get(where)
        assert got == pytest.approx(value), f"{cap_id}: {knob.key}={value} reached audio.cpp as {got!r}"


def test_variant_lookup_walks_suffixes_not_just_the_base() -> None:
    """A manifest variant id carries a version/precision tail the capability map
    does not; the walk must reach the most specific row, not the engine's."""
    assert lookup("chatterbox-multilingual-v2-q8").engine_id == "chatterbox-multilingual"
    assert lookup("qwen3-base-1.7b-q8").engine_id == "qwen3-base"
    assert lookup("chatterbox").engine_id == "chatterbox"
    # An unrelated id with a tail falls through to nothing, not to a wrong row.
    assert lookup("totally-unknown-engine") is None


def test_every_manifest_variant_resolves_to_a_row() -> None:
    """A variant the catalog offers must reach a capability row (speech
    recognition has none by design — nothing to tune)."""
    unresolved = []
    for engine_id, m in discover_engines().items():
        if lookup(engine_id) is None:
            continue
        for variant in getattr(m.module, "VARIANTS", []) or []:
            if lookup(variant["id"]) is None:
                unresolved.append(f"{engine_id}:{variant['id']}")
    assert not unresolved, f"variant ids that reach no capability row: {unresolved}"


def test_nest_engine_keys_moves_private_knobs_under_engine() -> None:
    """Flat capability keys — the shape every UI saves — become nested."""
    out = nest_engine_keys(
        {"speed": 1.1, "gain_db": -2.0, "exaggeration": 0.7, "cfg_weight": 0.3}
    )
    assert out["speed"] == 1.1
    assert out["gain_db"] == -2.0
    assert out["engine"] == {"exaggeration": 0.7, "cfg_weight": 0.3}


def test_nest_engine_keys_keeps_an_explicit_nested_value() -> None:
    """A key written deliberately under `engine` beats the flat one."""
    out = nest_engine_keys({"exaggeration": 0.7, "engine": {"exaggeration": 0.2}})
    assert out["engine"]["exaggeration"] == 0.2


def test_nest_engine_keys_is_idempotent_and_empty_safe() -> None:
    once = nest_engine_keys({"exaggeration": 0.7, "speed": 1.0})
    assert nest_engine_keys(once) == once
    assert nest_engine_keys({}) == {}
    assert nest_engine_keys(None) == {}


def test_canonical_delivery_fields_are_never_nested() -> None:
    """Everything Delivery declares stays top-level, or engines lose it."""
    flat = {k: 1 for k in Delivery.model_fields if k != "engine"}
    out = nest_engine_keys(flat)
    assert "engine" not in out
    assert set(out) == set(flat)


def test_every_capability_row_has_its_own_display_name():
    """A picker listing two rows under one name is the duplicate this fixed
    (Nano and Turbo, the two MLX Base rows — all gone with the 2026-10-01
    switch; the rule stays for whatever row comes next)."""
    names = [d.display_name for d in CAPABILITY_DETAILS.values()]
    assert len(set(names)) == len(names), names
