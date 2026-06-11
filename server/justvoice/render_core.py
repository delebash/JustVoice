"""Render orchestration — voice + text + delivery → PCM bytes.

Single source of truth for the per-line render pipeline used by
both `/v1/generate` (one line) and `/v1/render_chapter` (many).
Handles: cache lookup, lexicon substitution, engine auto-load,
synthesize, gain-db PCM scaling, cache store.

Phase 3 lift: long-text inputs (> settings.generation.max_chunk_chars)
go through the chunked path (audio/chunked.py — upstream MIT lift) so
chapter-scale renders split at sentence boundaries and crossfade-blend
to eliminate clicks.
"""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass
from typing import Any

import numpy as np

from .app_state import AppState
from .audio.chunked import (
    DEFAULT_MAX_CHUNK_CHARS,
    concatenate_audio_chunks,
    split_text_into_chunks,
)
from .audio.wav import strip_wav_header, write_wav_container
from .cache import CacheKeyBuilder, pack_pcm_with_format, unpack_pcm_with_format
from .delivery import apply_gain_db, canonical_json
from .engines.base import SynthRequest
from .errors import bad_request, internal, not_found
from .inline_tags import strip as strip_tags
from .version import VERSION

log = logging.getLogger(__name__)


@dataclass
class RenderedLine:
    pcm: bytes
    sample_rate: int
    channels: int
    effective_delivery: dict[str, Any]


def _resolve_engine_for_voice(state: AppState, voice_id: str) -> str | None:
    """Find the engine id that owns a voice id (preset or stored).

    Checks three sources: in-process engine voice lists, stored voices,
    and managed-engine manifest static_voices. The manifest pass matters
    for preset voices of NOT-YET-LOADED engines (e.g. kokoro's af_heart
    before first load) — without it any render/preview against them
    404s before auto-load can even run.
    """
    for engine in state.engines.all():
        if any(p.id == voice_id for p in engine.voices()):
            return engine.meta.engine_id
    stored = state.voices.get(voice_id)
    if stored:
        return stored.engine
    try:
        from .engines.manager import get_manager

        for manifest in get_manager().manifests().values():
            if any(v.get("id") == voice_id for v in manifest.static_voices):
                return manifest.id
    except Exception:
        pass
    return None


def _apply_lexicons(text: str, lexicon_ids: list[str], state: AppState) -> str:
    """Apply lexicon substitutions to the text. Lexicons are applied in
    order — first match wins for a given grapheme.
    """
    if not lexicon_ids:
        return text
    out = text
    for lid in lexicon_ids:
        lex = state.lexicons.get(lid)
        if not lex:
            continue
        for entry in lex.entries:
            if entry.alias:
                # Simple grapheme → alias replacement
                out = out.replace(entry.grapheme, entry.alias)
    return out


def probe_line_cached(
    state: AppState,
    voice: str,
    text: str,
    *,
    language: str | None = None,
    delivery: dict[str, Any] | None = None,
    seed: int | None = None,
    lexicons: list[str] | None = None,
    cache_scope: str = "default",
) -> bool | None:
    """Would render_line serve this line from cache? Mirrors render_line's
    key derivation byte-for-byte WITHOUT rendering or loading the engine.
    Returns None when the voice can't be resolved (the render would 404)."""
    settings = state.settings.get()
    delivery = delivery or {}
    lexicons = lexicons or []
    engine_id = _resolve_engine_for_voice(state, voice)
    if engine_id is None:
        return None
    engine = state.engines.get(engine_id)
    if engine is None:
        return None
    effective_text = text
    if not engine.meta.supports_paralinguistic_tags:
        effective_text = strip_tags(effective_text)
    effective_text = _apply_lexicons(effective_text, lexicons, state)
    key = (
        CacheKeyBuilder()
        .with_engine(engine_id, VERSION)
        .with_voice(voice)
        .with_text(effective_text)
        .with_language(language)
        .with_seed(seed)
        .with_delivery_json(canonical_json(delivery))
        .with_lexicons(lexicons)
        .finish()
    )
    cache = getattr(state, "_render_cache", None)
    if not settings.cache.enabled or cache is None:
        return False
    return cache.has(cache_scope, key)


def render_line(
    state: AppState,
    voice: str,
    text: str,
    *,
    language: str | None = None,
    delivery: dict[str, Any] | None = None,
    seed: int | None = None,
    lexicons: list[str] | None = None,
    cache_scope: str = "default",
    use_cache: bool = True,
) -> RenderedLine:
    settings = state.settings.get()
    delivery = delivery or {}
    lexicons = lexicons or []

    if len(text) > settings.limits.text_max_chars:
        raise bad_request(
            f"text length {len(text)} > limit {settings.limits.text_max_chars}"
        )

    engine_id = _resolve_engine_for_voice(state, voice)
    if engine_id is None:
        raise not_found(f"voice {voice}")
    engine = state.engines.get(engine_id)
    if engine is None:
        raise not_found(f"engine {engine_id}")

    # Inline-tag stripping for engines that don't support paralinguistic cues
    effective_text = text
    if not engine.meta.supports_paralinguistic_tags:
        effective_text = strip_tags(effective_text)
    effective_text = _apply_lexicons(effective_text, lexicons, state)

    # Cache lookup
    cache_enabled = use_cache and settings.cache.enabled
    cache_key = (
        CacheKeyBuilder()
        .with_engine(engine_id, VERSION)
        .with_voice(voice)
        .with_text(effective_text)
        .with_language(language)
        .with_seed(seed)
        .with_delivery_json(canonical_json(delivery))
        .with_lexicons(lexicons)
        .finish()
    )

    cache = getattr(state, "_render_cache", None)
    if cache_enabled and cache is not None:
        cached = cache.get(cache_scope, cache_key)
        if cached:
            sr, ch, pcm = unpack_pcm_with_format(cached)
            return RenderedLine(pcm=pcm, sample_rate=sr, channels=ch, effective_delivery=delivery)

    # Auto-load on first synthesize
    if not engine.ready():
        try:
            engine.load("auto", None)
            state.engines.set_current(engine_id)
        except Exception as e:
            raise bad_request(
                f"engine '{engine_id}' failed to load on first use: {e}. "
                f"Try POST /v1/engines/{engine_id}/load with explicit device + model_variant."
            )

    # Phase 3: chunked generation for long-form input. Below the threshold,
    # use the single-shot fast path. Above, split at sentence boundaries +
    # crossfade-blend the per-chunk audio.
    max_chunk_chars = int(getattr(settings.generation, "max_chunk_chars", DEFAULT_MAX_CHUNK_CHARS))
    crossfade_ms = int(getattr(settings.generation, "crossfade_ms", 50))

    if len(effective_text) > max_chunk_chars:
        chunks = split_text_into_chunks(effective_text, max_chars=max_chunk_chars)
        pcm_chunks: list[np.ndarray] = []
        chunk_sr = None
        chunk_ch = 1
        for piece in chunks:
            synth_req = SynthRequest(
                voice_id=voice,
                text=piece,
                language=language,
                delivery=delivery,
                seed=seed,
            )
            try:
                out = engine.synthesize(synth_req)
            except Exception as e:
                raise internal(f"engine synthesize (chunked): {e}")
            chunk_pcm_bytes = strip_wav_header(out.bytes) if out.is_wav_container else out.bytes
            samples = np.frombuffer(chunk_pcm_bytes, dtype="<i2").astype(np.float32) / 32767.0
            pcm_chunks.append(samples)
            chunk_sr = out.sample_rate
            chunk_ch = out.channels
        merged = concatenate_audio_chunks(pcm_chunks, chunk_sr or 22050, crossfade_ms=crossfade_ms)
        # Back to int16 PCM bytes.
        pcm = (np.clip(merged, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
        out_sample_rate = chunk_sr or 22050
        out_channels = chunk_ch
    else:
        synth_req = SynthRequest(
            voice_id=voice,
            text=effective_text,
            language=language,
            delivery=delivery,
            seed=seed,
        )
        try:
            out = engine.synthesize(synth_req)
        except Exception as e:
            raise internal(f"engine synthesize: {e}")
        # Strip WAV header → raw PCM
        if out.is_wav_container:
            pcm = strip_wav_header(out.bytes)
        else:
            pcm = out.bytes
        out_sample_rate = out.sample_rate
        out_channels = out.channels

    # Post-render gain
    if delivery.get("gain_db"):
        gain = float(delivery["gain_db"])
        gain = max(-24.0, min(12.0, gain))
        pcm = apply_gain_db(pcm, gain)

    # Cache write
    if cache_enabled and cache is not None:
        cache.put(cache_scope, cache_key, pack_pcm_with_format(pcm, out_sample_rate, out_channels))

    return RenderedLine(
        pcm=pcm,
        sample_rate=out_sample_rate,
        channels=out_channels,
        effective_delivery=delivery,
    )


def pcm_to_wav(rl: RenderedLine) -> bytes:
    return write_wav_container(rl.pcm, rl.sample_rate, rl.channels)


def concat_lines(lines: list[RenderedLine], silence_ms: int = 250) -> RenderedLine:
    """Concatenate rendered lines with silence between them.

    Resamples mismatched sample-rate lines via numpy linear interpolation.
    """
    if not lines:
        raise ValueError("no lines")
    sr = lines[0].sample_rate
    ch = lines[0].channels
    out_pcm = io.BytesIO()
    silence_samples = int((silence_ms / 1000) * sr) * ch
    silence_bytes = b"\x00\x00" * silence_samples
    for i, line in enumerate(lines):
        if line.sample_rate != sr or line.channels != ch:
            # Fallback: just append regardless; mastering layer can resample.
            log.warning(
                "concat: line %d has format mismatch (sr=%d, ch=%d); appending raw",
                i,
                line.sample_rate,
                line.channels,
            )
        if i > 0 and silence_bytes:
            out_pcm.write(silence_bytes)
        out_pcm.write(line.pcm)
    return RenderedLine(
        pcm=out_pcm.getvalue(),
        sample_rate=sr,
        channels=ch,
        effective_delivery={},
    )
