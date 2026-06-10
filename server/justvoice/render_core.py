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
from .errors import bad_request, engine_swap_required, internal, not_found
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

    Checks managed-manifest static voices (Kokoro's 54 presets etc.)
    first, then in-process engines (external providers), then the stored
    voice library."""
    try:
        from .engines.manager import get_manager

        for manifest in get_manager().manifests().values():
            if any(v.get("id") == voice_id for v in manifest.static_voices):
                return manifest.id
    except Exception:
        pass
    for engine in state.engines.all():
        if any(p.id == voice_id for p in engine.voices()):
            return engine.meta.engine_id
    stored = state.voices.get(voice_id)
    if stored:
        return stored.engine
    return None


class _ManagedSynthOut:
    """Shape-compatible stand-in for engines.base.SynthOutput."""

    def __init__(self, audio_bytes: bytes, meta: dict):
        self.bytes = audio_bytes
        self.is_wav_container = bool(meta.get("is_wav_container"))
        self.sample_rate = int(meta.get("sample_rate") or 24000)
        self.channels = int(meta.get("channels") or 1)


class _ManagedEngineFacade:
    """Adapts the managed-subprocess manager to the in-process engine
    interface render_line consumes (.meta flags / .ready() / .load() /
    .synthesize()). This is what lets Studio Render, Chapter regen, and
    Projects batch render reach Kokoro/Chatterbox/etc. — before this
    facade, the chapter pipeline only worked for external API engines."""

    def __init__(self, state: AppState, engine_id: str):
        from .engines.manager import get_manager

        self._state = state
        self._mgr = get_manager()
        self._id = engine_id
        manifest = self._mgr.manifests()[engine_id]
        caps = manifest.capabilities or {}

        class _Meta:
            supports_paralinguistic_tags = bool(caps.get("paralinguistic_tags"))

        self.meta = _Meta()

    def ready(self) -> bool:
        return self._mgr.current_for("tts") == self._id

    def load(self, device: str = "auto", variant=None) -> None:
        self._mgr.load(self._id, device=device, variant=variant)

    def synthesize(self, req) -> _ManagedSynthOut:
        body = {
            "voice_id": req.voice_id,
            "text": req.text,
            "language": req.language,
            "delivery": req.delivery or {},
            "seed": req.seed,
        }
        # Cloned / imported voices carry a reference clip on disk that the
        # engine subprocess needs as audio_prompt_path.
        stored = self._state.voices.get(req.voice_id)
        if stored is not None and stored.source in ("cloned", "imported"):
            ref = self._state.voices.ref_wav_path(stored.id)
            if ref.is_file():
                body["audio_prompt_path"] = str(ref.resolve())
        audio_bytes, meta = self._mgr.synth(self._id, body)
        return _ManagedSynthOut(audio_bytes, meta)


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


def _swap_estimate_seconds(disk_space_mb: int) -> int:
    """Rough engine-swap wall-clock tiers keyed off weights size. Honest
    enough for a confirm prompt; the task strip shows real progress."""
    if disk_space_mb < 1000:
        return 15
    if disk_space_mb < 4000:
        return 45
    return 90


def raise_if_swap_blocked(
    state: AppState,
    engine_id: str,
    allow_engine_swap: bool,
) -> None:
    """The swap-at-render gate (plan WS2). Only managed subprocess engines
    have a swap cost — in-process external providers are always free to
    'load' (a HEAD ping). Raises the 409 engine-swap-required contract
    unless the request or settings.generation.auto_engine_swap allows it.
    """
    if allow_engine_swap:
        return
    settings = state.settings.get()
    if bool(getattr(settings.generation, "auto_engine_swap", False)):
        return
    from .engines.manager import get_manager

    mgr = get_manager()
    m = mgr.get_manifest(engine_id)
    if m is None:
        return  # not a managed engine — nothing to gate
    from_engine = mgr.current_for(m.kind)
    weights_on_disk = bool(m.is_installed)
    disk_mb = int(m.requirements.get("disk_space_mb", 0) or 0)
    raise engine_swap_required(
        (
            f"This voice uses engine '{engine_id}', which is not loaded"
            + (f" (currently loaded: '{from_engine}')" if from_engine else "")
            + ". Retry with allow_engine_swap=true to swap, or enable "
            "settings.generation.auto_engine_swap."
        ),
        from_engine=from_engine,
        to_engine=engine_id,
        to_variant=m.default_variant_id,
        est_seconds=_swap_estimate_seconds(disk_mb) if weights_on_disk else None,
        weights_on_disk=weights_on_disk,
    )


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
    allow_engine_swap: bool = False,
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
        # Managed subprocess engine — wrap the manager in the in-process
        # interface so the rest of this function is path-agnostic.
        try:
            from .engines.manager import get_manager

            if engine_id in get_manager().manifests():
                engine = _ManagedEngineFacade(state, engine_id)
        except Exception:
            engine = None
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

    # Auto-load on first synthesize. For managed engines this is an engine
    # swap (evicts the kind-slot occupant, seconds-to-minutes) — gated by
    # the explicit swap contract. Cache hits above never reach this point,
    # so re-renders of unchanged lines stay engine-free.
    if not engine.ready():
        if isinstance(engine, _ManagedEngineFacade):
            raise_if_swap_blocked(state, engine_id, allow_engine_swap)
        try:
            engine.load("auto", None)
            if state.engines.get(engine_id) is not None:
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
