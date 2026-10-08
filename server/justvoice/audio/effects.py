# SPDX-License-Identifier: MIT
"""Effects pipeline (Slice 6 of the Profile-kill plan).

The render path runs the persona's chain on every line it speaks:

  TTS WAV  →  Persona.effects_chain  →  the line's audio

`apply_effects_chain()` is the public entrypoint. Given the WAV bytes
produced by the engine and a (possibly empty) chain spec, it returns a
new WAV byte string with the chain applied. The effects themselves run in
`audiocpp_dsp`, the DSP program built from our audio.cpp fork
(audio/dsp_client.py; moved there from numpy on 2026-10-07, proven output
for output against the Python it replaced).

Chain shape: a JSON-serializable list of dicts, each `{type, params}`
where `type` is one of the keys below and `params` are that effect's
keyword arguments:

  - "reverb"     → room_size, damping, wet_level, dry_level, width, freeze_mode
  - "chorus"     → rate_hz, depth, centre_delay_ms, feedback, mix
  - "distortion" → drive_db
  - "gain"       → gain_db
  - "compressor" → threshold_db, ratio, attack_ms, release_ms
  - "pitch_shift"→ semitones
  - "delay"      → delay_seconds, feedback, mix
  - "highpass"   → cutoff_frequency_hz
  - "lowpass"    → cutoff_frequency_hz
  - "eq_low"     → cutoff_frequency_hz, gain_db, q   (low shelf)
  - "eq_mid"     → cutoff_frequency_hz, gain_db, q   (peaking)
  - "eq_high"    → cutoff_frequency_hz, gain_db, q   (high shelf)

Those parameter names are unchanged from the previous implementation, on
purpose: chains are persisted in the database and in user presets, and a
rename would have silently invalidated every one of them.

Unknown types, entries switched off, and parameters an effect doesn't take
are skipped — never an error; a value that isn't a number fails that effect
alone. Nothing in a chain can fail a render.

The "EQ (3-band)" effect in the UI is sugar for the three eq_* primitives
above; the modal expands a single EQ entry into three chain rows.

`effects_chain_hash()` returns a deterministic sha256 of the resolved
chain (persona + preset). The render cache key includes this hash so a
cache hit only fires when the same chain would produce identical audio —
which is why `DSP_VERSION` is part of the hash input. Changing the DSP
without bumping it would serve audio rendered by the OLD code out of cache
next to audio rendered by the new, indistinguishably.
"""

from __future__ import annotations

import hashlib
import json
import logging

log = logging.getLogger(__name__)

#: Folded into the render cache key: bump it whenever the effects' output changes. "dsp1" is
#: the numpy effects, which audiocpp_dsp reproduces sample for sample.
DSP_VERSION = "dsp1"

#: A chain with a pitch shift is also keyed by what does the shifting — Signalsmith Stretch
#: moved from python-stretch to 1.4.0 inside audiocpp_dsp on 2026-10-07 and its output
#: changed, so only those chains' cached takes render again.
PITCH_ENGINE = "ss-1.4.0"


def chain_entries(chain: list[dict] | None) -> list[dict]:
    """The usable entries of a stored chain, in order (a chain is a list of
    `{type, params}` dicts; anything else in it is skipped)."""
    return [p for p in (chain or []) if isinstance(p, dict)]


def apply_effects_chain(wav_bytes: bytes, chain: list[dict]) -> bytes:
    """Apply `chain` to `wav_bytes`, return new WAV bytes.

    If the chain is empty (or every entry is unusable), returns the input
    unchanged. Bytes in → bytes out; the sample rate and channels are
    preserved, and the audio comes back as 16-bit PCM."""
    from .dsp_client import apply_effects

    return apply_effects(wav_bytes, chain)


def _has_pitch_shift(chain: list) -> bool:
    return any(isinstance(e, dict) and str(e.get("type") or "").lower() == "pitch_shift" for e in chain)


def effects_chain_hash(chain: list[dict] | None) -> str:
    """Deterministic sha256 of the resolved chain.

    Used by the render cache key so two requests with identical effects
    chains share a cache entry. Empty chain → constant short hash for
    cache hits across "no effects" cases.

    `DSP_VERSION` is part of the payload because the cache's promise is
    "same key → same audio", and that is a claim about the CODE as much as
    the chain. Changing the DSP without changing the key would serve takes
    rendered by the previous implementation alongside new ones, in the same
    project, with nothing to distinguish them.
    """
    if not chain:
        return "noeffects"
    payload = json.dumps(chain, sort_keys=True, separators=(",", ":"))
    version = f"{DSP_VERSION}+{PITCH_ENGINE}" if _has_pitch_shift(chain) else DSP_VERSION
    payload = f"{version}|{payload}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]
