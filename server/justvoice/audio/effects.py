# SPDX-License-Identifier: GPL-3.0-or-later
"""Pedalboard-backed effects pipeline (Slice 6 of the Profile-kill plan).

The render path cascades:

  Persona.effects_chain  →  RenderPreset.effects_chain (overlay)  →  TTS WAV

`apply_effects_chain()` is the public entrypoint. Given the WAV bytes
produced by the engine and a (possibly empty) chain spec, it returns a
new WAV byte string with the chain applied.

Chain shape: a JSON-serializable list of dicts, each `{type, params}`
where `type` is one of the keys below and `params` matches the
corresponding pedalboard primitive's constructor kwargs:

  - "reverb"     → Reverb(room_size, damping, wet_level, dry_level, width)
  - "distortion" → Distortion(drive_db)
  - "gain"       → Gain(gain_db)
  - "compressor" → Compressor(threshold_db, ratio, attack_ms, release_ms)
  - "pitch_shift"→ PitchShift(semitones)
  - "delay"      → Delay(delay_seconds, feedback, mix)
  - "highpass"   → HighpassFilter(cutoff_frequency_hz)
  - "lowpass"    → LowpassFilter(cutoff_frequency_hz)
  - "eq_low"     → LowShelfFilter(cutoff_frequency_hz, gain_db, q)
  - "eq_mid"     → PeakFilter(cutoff_frequency_hz, gain_db, q)
  - "eq_high"    → HighShelfFilter(cutoff_frequency_hz, gain_db, q)

Unknown types are logged and skipped — never an error. Bad params are
clamped to the primitive's accepted range by pedalboard itself.

The "EQ (3-band)" effect in the UI is sugar for the three eq_* primitives
above; the modal expands a single EQ entry into three chain rows.

`effects_chain_hash()` returns a deterministic sha256 of the resolved
chain (persona + preset). The render cache key includes this hash so a
cache hit only fires when the same chain would produce identical audio.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import wave

import numpy as np

log = logging.getLogger(__name__)


def _pedalboard():
    """Lazy import — pedalboard pulls in some native deps; skip the cost
    on cold paths that never apply effects."""
    import pedalboard

    return pedalboard


def _build_plugins(chain: list[dict]) -> list:
    pb = _pedalboard()
    plugins = []
    for entry in chain or []:
        if not isinstance(entry, dict):
            continue
        kind = (entry.get("type") or "").lower()
        params = entry.get("params") or {}
        try:
            if kind == "reverb":
                plugins.append(pb.Reverb(**params))
            elif kind == "distortion":
                plugins.append(pb.Distortion(**params))
            elif kind == "gain":
                plugins.append(pb.Gain(**params))
            elif kind == "compressor":
                plugins.append(pb.Compressor(**params))
            elif kind == "pitch_shift":
                plugins.append(pb.PitchShift(**params))
            elif kind == "delay":
                plugins.append(pb.Delay(**params))
            elif kind == "highpass":
                plugins.append(pb.HighpassFilter(**params))
            elif kind == "lowpass":
                plugins.append(pb.LowpassFilter(**params))
            elif kind == "eq_low":
                plugins.append(pb.LowShelfFilter(**params))
            elif kind == "eq_mid":
                plugins.append(pb.PeakFilter(**params))
            elif kind == "eq_high":
                plugins.append(pb.HighShelfFilter(**params))
            else:
                log.warning("effects: unknown effect type %r — skipped", kind)
        except (TypeError, ValueError) as e:
            log.warning("effects: %s skipped (bad params): %s", kind, e)
    return plugins


def resolve_chain(
    persona_chain: list[dict] | None,
    preset_chain: list[dict] | None,
) -> list[dict]:
    """Cascade order (lowest precedence first): persona → preset.

    Both are appended in order — the chain reads left-to-right at render
    time. The preset's effects layer ON TOP of the persona's; if you want
    a preset to REPLACE the persona chain, leave the preset chain blank
    in the editor and the persona's chain runs alone, OR use a wrap effect
    upstream.
    """
    out: list[dict] = []
    if persona_chain:
        out.extend(p for p in persona_chain if isinstance(p, dict))
    if preset_chain:
        out.extend(p for p in preset_chain if isinstance(p, dict))
    return out


def apply_effects_chain(wav_bytes: bytes, chain: list[dict]) -> bytes:
    """Apply `chain` to `wav_bytes`, return new WAV bytes.

    If the chain is empty (or every entry is invalid), returns the input
    unchanged. Bytes in → bytes out; the wave container and sample-rate
    metadata are preserved.
    """
    if not chain:
        return wav_bytes
    plugins = _build_plugins(chain)
    if not plugins:
        return wav_bytes

    # Decode WAV → float samples
    try:
        with wave.open(io.BytesIO(wav_bytes), "rb") as r:
            channels = r.getnchannels()
            sample_rate = r.getframerate()
            sample_width = r.getsampwidth()
            n_frames = r.getnframes()
            raw = r.readframes(n_frames)
    except wave.Error as e:
        log.warning("effects: cannot decode WAV (%s) — skipping chain", e)
        return wav_bytes

    if sample_width == 2:
        samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32767.0
    elif sample_width == 4:
        # 32-bit PCM (rare but possible)
        samples = np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483647.0
    else:
        log.warning("effects: unsupported sample width %s — skipping chain", sample_width)
        return wav_bytes

    if channels > 1:
        samples = samples.reshape(-1, channels).T  # shape: (channels, n_frames)
    else:
        samples = samples.reshape(1, -1)

    pb = _pedalboard()
    board = pb.Pedalboard(plugins)
    processed = board(samples, sample_rate)

    # Re-encode → 16-bit PCM WAV (engine outputs vary; normalize to 16-bit out).
    if processed.ndim == 1:
        processed = processed.reshape(1, -1)
    out_channels = processed.shape[0]
    interleaved = processed.T.reshape(-1)  # (frames, channels) → flat
    clipped = np.clip(interleaved, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype("<i2").tobytes()

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(out_channels)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm)
    return buf.getvalue()


def effects_chain_hash(chain: list[dict] | None) -> str:
    """Deterministic sha256 of the resolved chain.

    Used by the render cache key so two requests with identical effects
    chains share a cache entry. Empty chain → constant short hash for
    cache hits across "no effects" cases.
    """
    if not chain:
        return "noeffects"
    payload = json.dumps(chain, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def parse_chain(blob: str | list | None) -> list[dict]:
    """Tolerant parser — accept JSON string OR already-decoded list.

    Returns [] on any malformation.
    """
    if not blob:
        return []
    if isinstance(blob, list):
        return [e for e in blob if isinstance(e, dict)]
    if isinstance(blob, str):
        try:
            v = json.loads(blob)
        except (json.JSONDecodeError, TypeError):
            return []
        if isinstance(v, list):
            return [e for e in v if isinstance(e, dict)]
    return []
