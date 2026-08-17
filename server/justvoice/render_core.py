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
from .audio.effects import apply_effects_chain, effects_chain_hash
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


def resolve_audio_prompt_for_stored(state: AppState, stored) -> str | None:
    """For cloned / imported voices, the absolute path of the reference WAV
    so an engine subprocess can read it as `audio_prompt_path`; None for
    preset/designed voices (no reference clip)."""
    if stored.source not in ("cloned", "imported"):
        return None
    path = state.voices.ref_wav_path(stored.id)
    if not path.is_file():
        return None
    return str(path.resolve())


def _tags_supported(state: AppState, engine_id: str) -> bool | None:
    """Does this engine keep paralinguistic tags? Registry backends answer
    from meta; managed plugins from their manifest CAPABILITIES. None =
    the engine exists nowhere (a render would 404)."""
    engine = state.engines.get(engine_id)
    if engine is not None:
        return bool(engine.meta.supports_paralinguistic_tags)
    try:
        from .engines.manager import get_manager

        manifest = get_manager().get_manifest(engine_id)
    except Exception:
        return None
    if manifest is None:
        return None
    return bool(manifest.capabilities.get("paralinguistic_tags"))


def _emotion_tagset(engine_id: str) -> Any | None:
    """The emotion tag set of the variant that will actually render, or None.

    `Delivery.emotion` has two possible expressions and the engine decides
    which: engines that take freeform prose get it folded into `instruct` by
    `delivery_merge.compose_instruct` up at the API layer, and engines with an
    emotion token vocabulary get it compiled into the text here. Today that
    second group is Chatterbox **Turbo** alone.

    Variant-precise on purpose. Turbo and Multilingual are one engine id and
    one adapter but two tokenizers — Multilingual has no such tokens and would
    read `[angry]` aloud as a word. `capability_details.lookup()` already walks
    variant ids down to their base row, so asking it about the LOADED variant
    (or, when nothing is loaded yet, the one `render_line` would auto-load)
    resolves Turbo's row for Turbo and Multilingual's tokenless row for
    Multilingual.
    """
    from .engines.capability_details import lookup as lookup_capability

    probe_ids: list[str] = []
    try:
        from .engines.manager import get_manager

        mgr = get_manager()
        probe_ids.append(mgr.current_variant_id(engine_id) or mgr.resolved_default_variant(engine_id))
    except Exception:
        # Registry backends and test fakes have no manager; the engine id is
        # then the only thing to go on, which is correct for them.
        pass
    probe_ids.append(engine_id)

    for pid in probe_ids:
        if not pid:
            continue
        detail = lookup_capability(pid)
        if detail is None:
            continue
        for tagset in detail.inline_tags:
            if tagset.category == "emotion" and tagset.value_map:
                return tagset
        # The row resolved and simply has no emotion vocabulary. Do NOT fall
        # through to the base engine's row — that is how Multilingual would
        # inherit Turbo's tags.
        return None
    return None


def _apply_emotion_tag(text: str, delivery: dict[str, Any], tagset: Any | None) -> str:
    """Prefix this line with the engine's tag for `delivery.emotion`.

    Line-level, so it goes at the front: the emotion is the state the whole
    line is spoken in, unlike a non-verbal sound, which is positional and the
    author types where they want it.

    Silent no-op in three cases, all deliberate: the engine has no emotion
    vocabulary, no emotion is set, or the value is not in this engine's map.
    `neutral` maps to the empty string and so lands in that last case — it is
    expressible precisely by adding nothing.
    """
    if tagset is None:
        return text
    value = delivery.get("emotion")
    if not value:
        return text
    tag = (tagset.value_map or {}).get(value)
    if not tag:
        return text
    return f"{tagset.syntax.format(value=tag)} {text}"


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
    effects: list[dict] | None = None,
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
    tags_supported = _tags_supported(state, engine_id)
    if tags_supported is None:
        return None
    effective_text = text
    if not tags_supported:
        effective_text = strip_tags(effective_text)
    effective_text = _apply_lexicons(effective_text, lexicons, state)
    # After the lexicon, never before — a lexicon entry must not be able to
    # rewrite the inside of a tag we just generated.
    effective_text = _apply_emotion_tag(effective_text, delivery, _emotion_tagset(engine_id))
    key = (
        CacheKeyBuilder()
        .with_engine(engine_id, VERSION)
        .with_voice(voice)
        .with_text(effective_text)
        .with_language(language)
        .with_seed(seed)
        .with_delivery_json(canonical_json(delivery))
        .with_lexicons(lexicons)
        .with_effects_chain(effects_chain_hash(effects))
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
    effects: list[dict] | None = None,
    cache_scope: str = "default",
    use_cache: bool = True,
) -> RenderedLine:
    """Render one line.

    `effects` is the RESOLVED chain (persona → render preset, cascaded by
    `audio.effects.resolve_chain`) for this line. It is applied to the audio
    here and it is part of the cache key, so two lines that differ only in
    their chain never share an entry — and editing a persona's chain
    invalidates exactly the blocks that persona speaks. Chapter renders left
    this out entirely until 2026-08-15: effects existed, the editor saved
    them, and only the single-line `/v1/generate` path ever applied them.
    """
    settings = state.settings.get()
    delivery = delivery or {}
    lexicons = lexicons or []
    effects = effects or []

    if len(text) > settings.limits.text_max_chars:
        raise bad_request(
            f"text length {len(text)} > limit {settings.limits.text_max_chars}"
        )

    engine_id = _resolve_engine_for_voice(state, voice)
    if engine_id is None:
        raise not_found(f"voice {voice}")
    # Registry backends (external providers + test fakes) win; managed
    # plugin engines never sit in the registry and route via the manager
    # below (the 2026-08-08 §7d fix — before it, every managed voice 404'd
    # here and the whole multi-line render family was cloud-only).
    engine = state.engines.get(engine_id)
    manifest = None
    if engine is None:
        from .engines.manager import get_manager

        manifest = get_manager().get_manifest(engine_id)
        if manifest is None:
            raise not_found(f"engine {engine_id}")

    # Inline-tag stripping for engines that don't support paralinguistic cues
    effective_text = text
    tags_supported = (
        bool(engine.meta.supports_paralinguistic_tags)
        if engine is not None
        else bool(manifest.capabilities.get("paralinguistic_tags"))
    )
    if not tags_supported:
        effective_text = strip_tags(effective_text)
    effective_text = _apply_lexicons(effective_text, lexicons, state)
    # Kept in lockstep with `probe_line_cached` — the two derive the same key
    # and any transform added to one has to land in the other or the probe
    # starts lying about what is cached.
    effective_text = _apply_emotion_tag(effective_text, delivery, _emotion_tagset(engine_id))

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
        .with_effects_chain(effects_chain_hash(effects))
        .finish()
    )

    cache = getattr(state, "_render_cache", None)
    if cache_enabled and cache is not None:
        cached = cache.get(cache_scope, cache_key)
        if cached:
            sr, ch, pcm = unpack_pcm_with_format(cached)
            return RenderedLine(pcm=pcm, sample_rate=sr, channels=ch, effective_delivery=delivery)

    # Auto-load on first synthesize + the per-door synth call. Registry
    # backends keep their object door; managed engines load through the
    # manager and synth via its HTTP proxy.
    if engine is not None:
        if not engine.ready():
            try:
                engine.load("auto", None)
                state.engines.set_current(engine_id)
            except Exception as e:
                raise bad_request(
                    f"engine '{engine_id}' failed to load on first use: {e}. "
                    f"Try POST /v1/engines/{engine_id}/load with explicit device + model_variant."
                )

        def _synth_piece(piece: str) -> tuple[bytes, int | None, int]:
            out = engine.synthesize(
                SynthRequest(
                    voice_id=voice,
                    text=piece,
                    language=language,
                    delivery=delivery,
                    seed=seed,
                )
            )
            piece_pcm = strip_wav_header(out.bytes) if out.is_wav_container else out.bytes
            return piece_pcm, out.sample_rate, out.channels
    else:
        from .engines.manager import get_manager

        mgr = get_manager()
        if mgr.current_for(manifest.kind) != engine_id:
            try:
                mgr.load(engine_id, device="auto")
            except Exception as e:
                raise bad_request(
                    f"engine '{engine_id}' failed to load on first use: {e}. "
                    f"Load it on the Engines tab first, or POST /v1/engines/{engine_id}/load."
                )
        audio_prompt_path = None
        stored = state.voices.get(voice)
        if stored is not None:
            audio_prompt_path = resolve_audio_prompt_for_stored(state, stored)

        def _synth_piece(piece: str) -> tuple[bytes, int | None, int]:
            audio_bytes, meta = mgr.synth(
                engine_id,
                {
                    "voice_id": voice,
                    "text": piece,
                    "language": language,
                    "delivery": delivery,
                    "seed": seed,
                    "audio_prompt_path": audio_prompt_path,
                },
            )
            piece_pcm = (
                strip_wav_header(audio_bytes) if meta.get("is_wav_container") else audio_bytes
            )
            return piece_pcm, meta.get("sample_rate") or 24000, meta.get("channels") or 1

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
            try:
                piece_pcm, piece_sr, piece_ch = _synth_piece(piece)
            except Exception as e:
                raise internal(f"engine synthesize (chunked): {e}")
            samples = np.frombuffer(piece_pcm, dtype="<i2").astype(np.float32) / 32767.0
            pcm_chunks.append(samples)
            chunk_sr = piece_sr
            chunk_ch = piece_ch
        merged = concatenate_audio_chunks(pcm_chunks, chunk_sr or 22050, crossfade_ms=crossfade_ms)
        # Back to int16 PCM bytes.
        pcm = (np.clip(merged, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
        out_sample_rate = chunk_sr or 22050
        out_channels = chunk_ch
    else:
        try:
            pcm, out_sample_rate, out_channels = _synth_piece(effective_text)
        except Exception as e:
            raise internal(f"engine synthesize: {e}")

    # Post-render gain
    if delivery.get("gain_db"):
        gain = float(delivery["gain_db"])
        gain = max(-24.0, min(12.0, gain))
        pcm = apply_gain_db(pcm, gain)

    # Post-render pitch. `capability_details` advertises pitch_post_process
    # on every engine that has no native transposer, and GenerateView enables
    # its pitch slider on that flag — but nothing ever applied the value: no
    # engine reads `delivery.pitch` and the host did not either, so the
    # control was inert everywhere (2026-08-17 audit). Applied here, before
    # the effects chain, because pitch is part of how the line was spoken
    # while the chain sits on top of the finished line.
    if delivery.get("pitch"):
        semitones = max(-12.0, min(12.0, float(delivery["pitch"])))
        if semitones:
            shifted = apply_effects_chain(
                write_wav_container(pcm, out_sample_rate, out_channels),
                [{"type": "pitch_shift", "params": {"semitones": semitones}}],
            )
            pcm = strip_wav_header(shifted)

    # Effects chain, after gain (gain is part of the delivery this line was
    # spoken with; the chain sits on top of the finished line). Same function
    # the single-line path calls — one implementation, one sound.
    if effects:
        wet = apply_effects_chain(
            write_wav_container(pcm, out_sample_rate, out_channels), effects
        )
        pcm = strip_wav_header(wet)

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


def _pause_ms(line: RenderedLine, key: str) -> int | None:
    """`pause_before` / `pause_after` off a rendered line's delivery."""
    raw = (line.effective_delivery or {}).get(key)
    if raw is None:
        return None
    try:
        return max(0, int(raw))
    except (TypeError, ValueError):
        return None


def concat_lines(lines: list[RenderedLine], silence_ms: int = 250) -> RenderedLine:
    """Concatenate rendered lines with silence between them.

    `silence_ms` is the project's gap. A line's own `pause_after` and the next
    line's `pause_before` override it for that join: blank means "as the
    project", a value means this join is special — the same
    only-show-what-differs rule the line table uses.

    Until 2026-08-17 this used the project gap unconditionally, so every
    per-line pause in the app — the Generate slider, the delivery overlay, and
    the `pause_after_ms` every import adapter parses — was stored and silently
    ignored.

    Resamples mismatched sample-rate lines via numpy linear interpolation.
    """
    if not lines:
        raise ValueError("no lines")
    sr = lines[0].sample_rate
    ch = lines[0].channels
    out_pcm = io.BytesIO()

    def silence(ms: int) -> bytes:
        return b"\x00\x00" * (int((ms / 1000) * sr) * ch)

    for i, line in enumerate(lines):
        if line.sample_rate != sr or line.channels != ch:
            # Fallback: just append regardless; mastering layer can resample.
            log.warning(
                "concat: line %d has format mismatch (sr=%d, ch=%d); appending raw",
                i,
                line.sample_rate,
                line.channels,
            )
        if i > 0:
            after = _pause_ms(lines[i - 1], "pause_after")
            before = _pause_ms(line, "pause_before")
            gap = silence_ms if after is None and before is None else (after or 0) + (before or 0)
            if gap > 0:
                out_pcm.write(silence(gap))
        out_pcm.write(line.pcm)
    return RenderedLine(
        pcm=out_pcm.getvalue(),
        sample_rate=sr,
        channels=ch,
        effective_delivery={},
    )
