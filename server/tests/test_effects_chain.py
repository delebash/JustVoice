# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for the effects chain — the WAV-in/WAV-out layer over `audio/dsp/`.

The chain's job is to be unbreakable: it is fed specs that come out of a
database and a user-facing editor, so it has to survive misspellings, stale
effect names, wrong parameter types and effects that throw, without ever
failing a render. Every one of those paths is exercised here with a
deliberately broken input, because a defensive branch that has never been
seen to trigger is indistinguishable from one that does not work.
"""

from __future__ import annotations

import io
import wave

import pytest

from justvoice.audio.effects import (
    apply_effects_chain,
    effects_chain_hash,
    parse_chain,
    resolve_chain,
)


def _frames(wav_bytes: bytes) -> int:
    with wave.open(io.BytesIO(wav_bytes), "rb") as r:
        return r.getnframes()


def _rate(wav_bytes: bytes) -> int:
    with wave.open(io.BytesIO(wav_bytes), "rb") as r:
        return r.getframerate()


# ── the chain must never break a render ──────────────────────────────────


def test_empty_chain_returns_the_input_untouched(sine_wav: bytes) -> None:
    assert apply_effects_chain(sine_wav, []) is sine_wav


def test_unknown_effect_type_is_skipped_not_raised(sine_wav: bytes) -> None:
    out = apply_effects_chain(sine_wav, [{"type": "flux_capacitor", "params": {}}])
    assert out == sine_wav  # nothing applied, nothing lost


def test_bad_parameter_name_is_skipped(sine_wav: bytes) -> None:
    # `loudness_db` is not a gain parameter. The old code let pedalboard
    # raise on the constructor; this asserts we catch it at build time.
    out = apply_effects_chain(sine_wav, [{"type": "gain", "params": {"loudness_db": 6.0}}])
    assert out == sine_wav


def test_params_of_the_wrong_type_is_skipped(sine_wav: bytes) -> None:
    out = apply_effects_chain(sine_wav, [{"type": "gain", "params": ["6db"]}])
    assert out == sine_wav


def test_disabled_entries_do_not_apply(sine_wav: bytes) -> None:
    chain = [{"type": "gain", "params": {"gain_db": 12.0}, "enabled": False}]
    assert apply_effects_chain(sine_wav, chain) == sine_wav


def test_a_throwing_effect_does_not_lose_the_render(sine_wav: bytes, monkeypatch) -> None:
    """If an effect raises mid-chain we keep the audio and log it. Losing a
    take because one knob was wrong is not an acceptable failure mode."""
    from justvoice.audio import effects as effects_mod

    def boom(x, sr, **kw):
        raise RuntimeError("synthetic failure")

    monkeypatch.setitem(effects_mod.EFFECTS, "gain", boom)
    out = apply_effects_chain(sine_wav, [{"type": "gain", "params": {}}])
    assert _frames(out) == _frames(sine_wav)


def test_undecodable_wav_is_returned_unchanged() -> None:
    junk = b"this is not a wav file"
    assert apply_effects_chain(junk, [{"type": "gain", "params": {"gain_db": 3.0}}]) == junk


# ── the contracts that downstream code depends on ────────────────────────


def test_chain_preserves_frame_count_and_sample_rate(sine_wav: bytes) -> None:
    """Export manifests, M4B chapter marks and block offsets are all derived
    from render length. An effect chain must not move them."""
    chain = [
        {"type": "reverb", "params": {"room_size": 0.8, "wet_level": 0.6}},
        {"type": "delay", "params": {"delay_seconds": 0.25, "feedback": 0.4, "mix": 0.5}},
    ]
    out = apply_effects_chain(sine_wav, chain)
    assert _frames(out) == _frames(sine_wav)
    assert _rate(out) == _rate(sine_wav)


def test_a_real_chain_actually_changes_the_audio(sine_wav: bytes) -> None:
    out = apply_effects_chain(sine_wav, [{"type": "gain", "params": {"gain_db": -12.0}}])
    assert out != sine_wav


def test_every_shipped_builtin_preset_runs_end_to_end(sine_wav: bytes) -> None:
    """The four seeded presets, taken from the seed data itself rather than
    retyped — so this fails if someone adds a preset using an effect the DSP
    does not implement, which is exactly how "Robotic" could silently have
    become a no-op."""
    from justvoice.database.seed import BUILTIN_EFFECT_PRESETS

    assert BUILTIN_EFFECT_PRESETS, "no builtin presets to check"
    for preset in BUILTIN_EFFECT_PRESETS:
        out = apply_effects_chain(sine_wav, preset["chain"])
        assert _frames(out) == _frames(sine_wav), f"{preset['name']} changed length"
        assert out != sine_wav, f"{preset['name']} did nothing"


# ── the cache key ────────────────────────────────────────────────────────


def test_chain_hash_is_stable_and_order_sensitive() -> None:
    a = [{"type": "gain", "params": {"gain_db": 3.0}}]
    b = [{"type": "gain", "params": {"gain_db": 3.0}}]
    c = [{"type": "gain", "params": {"gain_db": 4.0}}]
    assert effects_chain_hash(a) == effects_chain_hash(b)
    assert effects_chain_hash(a) != effects_chain_hash(c)
    assert effects_chain_hash([]) == "noeffects"


def test_chain_hash_changes_when_the_dsp_version_does() -> None:
    """The cache promises "same key -> same audio". That is a claim about the
    CODE, not just the chain — so a DSP change must invalidate it, or takes
    rendered by the old implementation get served next to new ones."""
    from justvoice.audio import effects as effects_mod

    chain = [{"type": "reverb", "params": {"room_size": 0.5}}]
    before = effects_chain_hash(chain)
    original = effects_mod.DSP_VERSION
    try:
        effects_mod.DSP_VERSION = "dsp-something-else"
        assert effects_chain_hash(chain) != before
    finally:
        effects_mod.DSP_VERSION = original


# ── chain resolution (unchanged behaviour, guarded) ──────────────────────


def test_preset_layers_on_top_of_persona() -> None:
    persona = [{"type": "gain", "params": {"gain_db": 1.0}}]
    preset = [{"type": "reverb", "params": {}}]
    assert resolve_chain(persona, preset) == persona + preset


@pytest.mark.parametrize("blob", [None, "", "not json", "{}", 42])
def test_parse_chain_never_raises_on_junk(blob) -> None:
    assert parse_chain(blob) == []


def test_parse_chain_accepts_json_and_lists() -> None:
    assert parse_chain('[{"type":"gain","params":{"gain_db":2}}]')[0]["type"] == "gain"
    assert parse_chain([{"type": "gain"}])[0]["type"] == "gain"
