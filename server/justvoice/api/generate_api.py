"""POST /v1/generate — single-line synthesis.

Dispatches voice lookup + synth through either the manager (managed
engines) or the legacy in-process registry (external engines). Both
paths return audio/wav bytes.

Long text (> settings.generation.max_chunk_chars) is auto-chunked at
sentence boundaries via `audio/chunked.py` (upstream MIT lift; attribution in header). Below
the threshold, a single-shot synth call is used. Without this wrapping
some engines truncate or hallucinate trailing noise on long inputs.
"""

from __future__ import annotations

import io
import wave

import numpy as np
from fastapi import APIRouter, Response

from ..app_state import get_state
from ..audio.chunked import (
    DEFAULT_MAX_CHUNK_CHARS,
    concatenate_audio_chunks,
    split_text_into_chunks,
)
from ..audio.effects import apply_effects_chain, parse_chain, resolve_chain
from ..audio.wav import strip_wav_header, write_wav_container
from ..delivery_merge import compose_instruct, merge_delivery
from ..engines.base import SynthRequest
from ..engines.manager import get_manager
from ..errors import bad_request, internal, not_found
from ..models import GenerateRequest


def _samples_from_chunk_bytes(audio_bytes: bytes, is_wav: bool) -> np.ndarray:
    """Decode one chunk's bytes (PCM or WAV) → float32 samples in [-1, 1]."""
    pcm = strip_wav_header(audio_bytes) if is_wav else audio_bytes
    return np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32767.0


def _resolve_effects_chain(req: GenerateRequest, db) -> list[dict]:
    """Resolve the effects chain for this render: persona → preset overlay.

    Returns an empty list when no effects apply. Caller passes the result
    to `apply_effects_chain(wav_bytes, chain)` after TTS.
    """
    st = get_state()
    persona_chain: list[dict] = []
    if req.persona_id:
        persona = st.personas.get(req.persona_id)
        if persona is not None:
            persona_chain = persona.effects_chain or []

    preset_chain: list[dict] = []
    if req.preset_id:
        from ..database.models import RenderPreset

        preset = db.query(RenderPreset).filter(RenderPreset.id == req.preset_id).first()
        if preset is not None:
            preset_chain = parse_chain(preset.effects_chain)

    return resolve_chain(persona_chain, preset_chain)


def _chunking_params(settings) -> tuple[int, int]:
    """Pull max_chunk_chars + crossfade_ms from settings.generation."""
    max_chunk_chars = int(getattr(settings.generation, "max_chunk_chars", DEFAULT_MAX_CHUNK_CHARS))
    crossfade_ms = int(getattr(settings.generation, "crossfade_ms", 50))
    return max_chunk_chars, crossfade_ms

router = APIRouter(tags=["generation"])


def _find_managed_voice_owner(voice_id: str) -> str | None:
    """If `voice_id` belongs to a currently-loaded managed engine, return
    that engine_id. Otherwise None.

    We only check the LOADED managed engine (one at a time) — listing voices
    from an unloaded managed engine would require its subprocess running.
    """
    mgr = get_manager()
    cur = mgr.current_id()
    if not cur:
        return None
    try:
        voices = mgr.voices(cur)
    except Exception:
        return None
    for v in voices:
        if v.get("id") == voice_id:
            return cur
    return None


def _find_static_voice_owner(voice_id: str) -> str | None:
    """If `voice_id` is in any managed engine's manifest STATIC_VOICES, return
    that engine_id. Used to auto-load the right engine when the user picks a
    preset voice that belongs to a different (currently-unloaded) engine.

    Without this, a user with Chatterbox loaded who picks a Kokoro voice
    (af_alloy) would get a 404 — the engines' static voices show up in
    /v1/voices but only the loaded engine's are reachable via synth.
    """
    mgr = get_manager()
    for manifest in mgr.manifests().values():
        for v in manifest.static_voices:
            if v.get("id") == voice_id:
                return manifest.id
    return None


@router.post(
    "/v1/generate",
    summary="Synthesize one line → audio/wav bytes",
    responses={200: {"content": {"audio/wav": {}}}},
)
async def generate(req: GenerateRequest) -> Response:
    st = get_state()
    settings = st.settings.get()

    if len(req.text) > settings.limits.text_max_chars:
        raise bad_request(
            f"text length {len(req.text)} > limit {settings.limits.text_max_chars}"
        )

    mgr = get_manager()

    # ── Voice lookup ────────────────────────────────────────────────
    #
    # Order of precedence:
    # 1. Currently-loaded managed engine's voices.
    # 2. Stored voice → look up its engine id.
    # 3. In-process engines' voice lists.

    managed_owner = _find_managed_voice_owner(req.voice)
    if managed_owner is not None:
        return await _generate_via_manager(managed_owner, req)

    # Voice belongs to a managed engine that isn't the currently-loaded one?
    # Return a clear error rather than silently switching engines — the GUI
    # filters its dropdown to the loaded engine's voices, so reaching this
    # branch usually means an API caller passed an id from a different engine
    # by mistake.
    static_owner = _find_static_voice_owner(req.voice)
    if static_owner is not None:
        if mgr.current_id() != static_owner:
            raise bad_request(
                f"voice {req.voice!r} belongs to engine {static_owner!r} which is not "
                f"currently loaded. Load it on the Engines tab first, or pick a voice "
                f"belonging to the loaded engine."
            )
        return await _generate_via_manager(static_owner, req)

    stored = st.voices.get(req.voice)
    if stored:
        # Stored voice's engine — may be managed or in-process.
        voice_fields = _voice_synth_fields(stored)
        if mgr.get_manifest(stored.engine):
            # Auto-load the managed engine if it's installed but not loaded.
            if mgr.current_id() != stored.engine:
                try:
                    mgr.load(stored.engine, device="auto")
                except Exception as e:
                    raise bad_request(
                        f"engine '{stored.engine}' failed to load on first use: {e}. "
                        f"Click Load on the Engines tab first, or POST /v1/engines/{stored.engine}/load."
                    )
            return await _generate_via_manager(stored.engine, req, voice_fields=voice_fields)
        # In-process engine path falls through below.
        engine_id = stored.engine
    else:
        # Walk in-process engines looking for a matching preset voice id.
        engine_id = None
        for engine in st.engines.all():
            if any(p.id == req.voice for p in engine.voices()):
                engine_id = engine.meta.engine_id
                break
        if engine_id is None:
            raise not_found(f"voice {req.voice}")

    return _generate_via_inprocess(engine_id, req)


def _resolve_audio_prompt_for_stored(stored) -> str | None:
    """Thin wrapper over render_core's resolver (moved there 2026-08-08 so
    the managed render bridge shares it); voice_preview imports this name."""
    from ..render_core import resolve_audio_prompt_for_stored

    return resolve_audio_prompt_for_stored(get_state(), stored)


def _voice_synth_fields(stored) -> dict:
    """Everything the stored voice contributes to the engine call — the
    reference clip AND (2026-08-19) its transcript, a blend's style vector,
    a trained voice's adapter. Wrapper over render_core's single resolver."""
    from ..render_core import voice_synth_fields

    return voice_synth_fields(get_state(), stored)


async def _generate_via_manager(
    engine_id: str, req: GenerateRequest, voice_fields: dict | None = None
) -> Response:
    """Synth via the managed engine subprocess.

    `voice_fields` carries whatever the stored voice contributes to the
    call — the reference WAV path (and its transcript) for a clone, the
    style vector for a blend, the adapter dir for a trained voice. The host
    resolves them so the engine subprocess never needs access to the voice
    store. See `render_core.voice_synth_fields`.

    Long text (> settings.generation.max_chunk_chars) is split at sentence
    boundaries and per-chunk results are crossfade-concatenated. This is
    the chunked-TTS path wired into the single-line generate path (was dead
    code before — render_core.py used it for chapter renders, but the /v1/
    generate route was passing long text in one shot, which truncates or
    hallucinates trailing noise on most engines).
    """
    mgr = get_manager()
    st = get_state()
    max_chunk_chars, crossfade_ms = _chunking_params(st.settings.get())
    request_delivery = req.delivery.model_dump(exclude_none=True) if req.delivery else {}
    # 3-tier voice tuning merge (#88): preset > request > persona defaults.
    # Resolve persona.default_delivery via the JSON PersonaStore and pass
    # it as `tier2_overlay`.
    persona_overlay = None
    persona_instruct: str | None = None
    if req.persona_id:
        persona = st.personas.get(req.persona_id)
        if persona is not None:
            persona_overlay = persona.default_delivery or {}
            persona_instruct = (persona.voice_instruct or "").strip() or None

    from ..database.session import SessionLocal
    db = SessionLocal()
    try:
        delivery = merge_delivery(
            request_delivery,
            req.preset_id,
            db,
            tier2_overlay=persona_overlay,
        )
        # Persona.voice_instruct → delivery.instruct: a spoken-delivery
        # instruction, not an LLM rewrite. Engines that declare
        # supports_instruct_freeform (Qwen3-TTS today) consume
        # delivery["instruct"] at synth time; engines that don't, ignore it.
        # An explicit instruct in the request/preset wins the base slot over
        # the persona's. The persona's `personality` (the character sheet) is
        # NOT read here — that is the whole point of the 2026-08-15 split.
        #
        # `emotion` rides on the end through the same composer the chapter
        # path uses. Until 2026-08-17 only that path composed, so an emotion
        # set here reached nothing at all.
        composed = compose_instruct(
            delivery.get("instruct") or persona_instruct, delivery.get("emotion")
        )
        if composed:
            delivery["instruct"] = composed
        # Effects chain (Slice 6) — cascaded persona → preset.
        effects = _resolve_effects_chain(req, db)
    finally:
        db.close()

    def _synth_one(text: str, chunk_seed: int | None):
        body = {
            "voice_id": req.voice,
            "text": text,
            "language": req.language,
            "delivery": delivery,
            "seed": chunk_seed,
            **(voice_fields or {}),
        }
        return mgr.synth(engine_id, body)

    # Seed resolution: delivery.seed (the UI's authoritative location
    # since it lives next to other per-render knobs) overrides the
    # top-level req.seed. Either path produces the same per-chunk
    # seed math below.
    effective_seed = delivery.get("seed") if delivery.get("seed") is not None else req.seed

    def _do() -> Response:
        try:
            if len(req.text) <= max_chunk_chars:
                audio_bytes, meta = _synth_one(req.text, effective_seed)
                if not meta.get("is_wav_container"):
                    sr = meta.get("sample_rate") or 24000
                    channels = meta.get("channels") or 1
                    audio_bytes = write_wav_container(audio_bytes, sr, channels)
                audio_bytes = apply_effects_chain(audio_bytes, effects)
                return Response(content=audio_bytes, media_type="audio/wav")

            # Long-form path: split → per-chunk synth → crossfade-concat → WAV
            chunks = split_text_into_chunks(req.text, max_chars=max_chunk_chars)
            pcm_chunks: list[np.ndarray] = []
            sample_rate = 24000
            channels = 1
            for i, piece in enumerate(chunks):
                # Vary seed per chunk to avoid correlated RNG artefacts while
                # staying deterministic for (text, seed) reproducibility.
                chunk_seed = (effective_seed + i) if effective_seed is not None else None
                audio_bytes, meta = _synth_one(piece, chunk_seed)
                sample_rate = meta.get("sample_rate") or sample_rate
                channels = meta.get("channels") or channels
                pcm_chunks.append(_samples_from_chunk_bytes(audio_bytes, bool(meta.get("is_wav_container"))))

            merged = concatenate_audio_chunks(pcm_chunks, sample_rate, crossfade_ms=crossfade_ms)
            pcm_int16 = (np.clip(merged, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
            wav_bytes = write_wav_container(pcm_int16, sample_rate, channels)
            wav_bytes = apply_effects_chain(wav_bytes, effects)
            return Response(content=wav_bytes, media_type="audio/wav")
        except Exception as e:
            raise internal(f"engine synthesize: {e}")

    # Managed synthesis rides the scheduler as an interactive single — every
    # managed synth goes through the one synth door, and the endpoint awaits
    # instead of blocking the event loop (§7b P2-5/P2-6 of the 2026-08-08
    # plan). The scheduler lets it jump any batch at the next line boundary.
    from ..synth_scheduler import get_scheduler

    handle = get_scheduler().submit([(engine_id, _do)], interactive=True)
    await handle.wait_async()
    handle.raise_if_failed()
    return handle.items[0].result


def _generate_via_inprocess(engine_id: str, req: GenerateRequest) -> Response:
    """Synth via a legacy in-process engine (external-openai-tts today).

    Also auto-chunks long text — same threshold + crossfade as the managed
    path. Without this, single-line generates of long text via in-process
    engines silently truncate.
    """
    st = get_state()
    engine = st.engines.get(engine_id)
    if engine is None:
        raise not_found(f"engine {engine_id}")
    if not engine.ready():
        try:
            engine.load("auto", None)
            st.engines.set_current(engine_id)
        except Exception as e:
            raise bad_request(
                f"engine '{engine_id}' failed to load on first use: {e}. "
                f"Try POST /v1/engines/{engine_id}/load with explicit device + model_variant."
            )

    max_chunk_chars, crossfade_ms = _chunking_params(st.settings.get())
    request_delivery = req.delivery.model_dump(exclude_none=True) if req.delivery else {}
    persona_overlay = None
    persona_instruct: str | None = None
    if req.persona_id:
        persona = st.personas.get(req.persona_id)
        if persona is not None:
            persona_overlay = persona.default_delivery or {}
            persona_instruct = (persona.voice_instruct or "").strip() or None

    from ..database.session import SessionLocal
    db = SessionLocal()
    try:
        delivery = merge_delivery(
            request_delivery,
            req.preset_id,
            db,
            tier2_overlay=persona_overlay,
        )
        # Same cascade as the non-streaming path: the persona's spoken
        # instruction under whatever was asked for, then the emotion.
        composed = compose_instruct(
            delivery.get("instruct") or persona_instruct, delivery.get("emotion")
        )
        if composed:
            delivery["instruct"] = composed
        effects = _resolve_effects_chain(req, db)
    finally:
        db.close()

    def _synth_one(text: str, chunk_seed: int | None):
        synth_req = SynthRequest(
            voice_id=req.voice,
            text=text,
            language=req.language,
            delivery=delivery,
            seed=chunk_seed,
        )
        return engine.synthesize(synth_req)

    try:
        if len(req.text) <= max_chunk_chars:
            out = _synth_one(req.text, req.seed)
            if out.is_wav_container:
                wav_bytes = out.bytes
            else:
                buf = io.BytesIO()
                with wave.open(buf, "wb") as w:
                    w.setnchannels(out.channels)
                    w.setsampwidth(2)
                    w.setframerate(out.sample_rate)
                    w.writeframes(out.bytes)
                wav_bytes = buf.getvalue()
            wav_bytes = apply_effects_chain(wav_bytes, effects)
            return Response(content=wav_bytes, media_type="audio/wav")

        chunks = split_text_into_chunks(req.text, max_chars=max_chunk_chars)
        pcm_chunks: list[np.ndarray] = []
        sample_rate = 24000
        channels = 1
        for i, piece in enumerate(chunks):
            chunk_seed = (req.seed + i) if req.seed is not None else None
            out = _synth_one(piece, chunk_seed)
            sample_rate = out.sample_rate or sample_rate
            channels = out.channels or channels
            pcm_chunks.append(_samples_from_chunk_bytes(out.bytes, out.is_wav_container))

        merged = concatenate_audio_chunks(pcm_chunks, sample_rate, crossfade_ms=crossfade_ms)
        pcm_int16 = (np.clip(merged, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
        wav_bytes = write_wav_container(pcm_int16, sample_rate, channels)
        wav_bytes = apply_effects_chain(wav_bytes, effects)
        return Response(content=wav_bytes, media_type="audio/wav")
    except Exception as e:
        raise internal(f"engine synthesize: {e}")
