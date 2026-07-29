# SPDX-License-Identifier: MIT
"""Effects pipeline (Slice 6 of the Profile-kill plan).

The render path cascades:

  Persona.effects_chain  →  RenderPreset.effects_chain (overlay)  →  TTS WAV

`apply_effects_chain()` is the public entrypoint. Given the WAV bytes
produced by the engine and a (possibly empty) chain spec, it returns a
new WAV byte string with the chain applied.

Chain shape: a JSON-serializable list of dicts, each `{type, params}`
where `type` is one of the keys below and `params` are that effect's
keyword arguments in `audio/dsp/`:

  - "reverb"     → room_size, damping, wet_level, dry_level, width
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

Unknown types are logged and skipped — never an error. Bad params are
clamped by the effect itself; nothing in a chain can fail a render.

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
import inspect
import io
import json
import logging
import wave

import numpy as np

from .dsp import DSP_VERSION, EFFECTS

log = logging.getLogger(__name__)


def _build_plugins(chain: list[dict]) -> list:
    """Resolve a chain spec into `[(name, fn, params), ...]`, in order.

    Nothing is applied here — this only validates that each entry names a
    known effect and carries keyword arguments that effect will accept. An
    entry that fails either test is dropped with a log line, never raised,
    because a malformed chain must not be able to fail a render.
    """
    plugins: list[tuple[str, object, dict]] = []
    for entry in chain or []:
        if not isinstance(entry, dict):
            continue
        # Honor the per-effect enabled flag (upstream contract — the chain
        # editor toggles effects without removing them from the chain).
        if not entry.get("enabled", True):
            continue
        kind = (entry.get("type") or "").lower()
        params = entry.get("params") or {}
        fn = EFFECTS.get(kind)
        if fn is None:
            log.warning("effects: unknown effect type %r — skipped", kind)
            continue
        if not isinstance(params, dict):
            log.warning("effects: %s skipped (params is %s, not a dict)", kind, type(params).__name__)
            continue
        # Catch a bad keyword now rather than part-way through the chain,
        # when half the effects have already been applied.
        try:
            inspect.signature(fn).bind(None, 0, **params)
        except TypeError as e:
            log.warning("effects: %s skipped (bad params): %s", kind, e)
            continue
        plugins.append((kind, fn, params))
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

    n_in = samples.shape[-1]
    processed = samples.astype(np.float64, copy=False)
    for kind, fn, params in plugins:
        try:
            processed = fn(processed, sample_rate, **params)
        except Exception:
            # One bad effect must not lose the whole render. Log it with a
            # traceback and carry on with the audio as it stands.
            log.exception("effects: %s failed — skipped, chain continues", kind)

    # Length is a contract, not an expectation: block offsets, M4B chapter
    # marks and the per-block export manifest are all derived from render
    # lengths. Assert it here so a future effect cannot break them quietly.
    if processed.shape[-1] != n_in:
        log.error(
            "effects: chain changed length %d -> %d — trimming. This is a bug in an effect.",
            n_in, processed.shape[-1],
        )
        processed = processed[..., :n_in]

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

    `DSP_VERSION` is part of the payload because the cache's promise is
    "same key → same audio", and that is a claim about the CODE as much as
    the chain. Changing the DSP without changing the key would serve takes
    rendered by the previous implementation alongside new ones, in the same
    project, with nothing to distinguish them.
    """
    if not chain:
        return "noeffects"
    payload = json.dumps(chain, sort_keys=True, separators=(",", ":"))
    payload = f"{DSP_VERSION}|{payload}"
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
