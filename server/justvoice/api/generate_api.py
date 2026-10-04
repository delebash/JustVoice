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

import numpy as np
from fastapi import APIRouter, Response

from ..app_state import get_state
from ..audio.chunked import (
    DEFAULT_MAX_CHUNK_CHARS,
    concatenate_audio_chunks,
    split_text_into_chunks,
)
from ..audio.effects import apply_effects_chain
from ..audio.wav import parse_wav_header, strip_wav_header, write_wav_container
from ..delivery_merge import compose_instruct, merge_delivery
from ..engines.base import SynthRequest
from ..engines.manager import TermsRequired, get_manager
from ..errors import bad_request, internal, not_found
from ..models import GenerateRequest


def _samples_from_chunk_bytes(audio_bytes: bytes, is_wav: bool) -> np.ndarray:
    """Decode one chunk's bytes (PCM or WAV) → float32 samples in [-1, 1]."""
    pcm = strip_wav_header(audio_bytes) if is_wav else audio_bytes
    return np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32767.0


def _finish_line(
    pcm: bytes, sample_rate: int, channels: int, delivery: dict, engine_id: str, effects: list[dict],
    model: str | None = None,
) -> bytes:
    """A finished line's PCM → the WAV Generate returns: Speed, Gain and Pitch
    through the chapter render's own function, then the effects chain. Until
    2026-10-02 this path applied only the chain, so Generate's Speed (on
    every engine but Kokoro and KittenTTS), Pitch and Gain did nothing."""
    from ..render_core import apply_line_delivery, speed_native

    pcm = apply_line_delivery(
        pcm, sample_rate, channels, delivery,
        speed_native=speed_native(get_state(), engine_id, model),
    )
    return apply_effects_chain(write_wav_container(pcm, sample_rate, channels), effects)


def _read_through_lexicons(st, engine_id: str, req: GenerateRequest) -> tuple[GenerateRequest, dict]:
    """(req with its text as this engine will say it, the IPA map for its words).

    The chapter render's own steps, in its order (render_core.render_line):
    drop the [tags] this engine can't perform, then apply the lexicons the
    request names — Generate sends the selected persona's. The IPA map rides
    in the delivery. Until 2026-09-30 this path read no lexicon at all, so a
    line on Generate was said one way and the same line in a chapter another.
    The book's lexicon is not added: Generate is not a line of a book.
    """
    from ..render_core import _apply_lexicons, _line_model, _supports_phoneme_input, performable_text

    model = _line_model(st, req.voice, engine_id)
    text, ipa_map = _apply_lexicons(
        performable_text(st, engine_id, model, req.text), req.lexicons, st,
        ipa_capable=_supports_phoneme_input(model),
    )
    return req.model_copy(update={"text": text}), ipa_map


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
        _ensure_voice_model(st, managed_owner, req)
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
        _ensure_voice_model(st, static_owner, req)
        return await _generate_via_manager(static_owner, req)

    stored = st.voices.get(req.voice)
    if stored:
        # Stored voice's engine — may be managed or in-process.
        voice_fields = _voice_synth_fields(stored)
        if mgr.get_manifest(stored.engine):
            # Auto-load the voice's model if it isn't the resident one.
            _ensure_voice_model(st, stored.engine, req)
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


def _ensure_voice_model(st, engine_id: str, req: GenerateRequest) -> None:
    """Load the model the voice speaks on (voice_model.py) — a Qwen3 speaker
    needs CustomVoice even while Base is resident, a Turbo clone needs Turbo.
    The size AI Settings chose is kept."""
    from ..render_core import _line_model
    from ..voice_model import ModelUnavailable, ensure_model_loaded

    try:
        ensure_model_loaded(engine_id, _line_model(st, req.voice, engine_id), req.language)
    except ModelUnavailable as e:
        raise bad_request(str(e))
    except Exception as e:
        raise bad_request(
            f"engine '{engine_id}' failed to load on first use: {e}. "
            f"Click Load on the Engines tab first, or POST /v1/engines/{engine_id}/load."
        )


def _resolve_audio_prompt_for_stored(stored) -> str | None:
    """Thin wrapper over render_core's resolver (moved there 2026-08-08 so
    the managed render bridge shares it); voice_preview imports this name."""
    from ..render_core import resolve_audio_prompt_for_stored

    return resolve_audio_prompt_for_stored(get_state(), stored)


def _voice_synth_fields(stored) -> dict:
    """Everything the stored voice contributes to the engine call — the
    reference clip AND (2026-08-19) its transcript, a blend's style vector.
    Wrapper over render_core's single resolver."""
    from ..render_core import voice_synth_fields

    return voice_synth_fields(get_state(), stored)


def _voice_design_instruct(voice_id: str | None) -> str | None:
    """A clip-less designed voice's description, for the instruct slot.

    Prose, not a synth input, so it is deliberately NOT part of
    `_voice_synth_fields` — it composes at the API layer with the persona's
    instruction and the line's direction. Clip-wins lives in render_core.
    """
    from ..render_core import voice_design_instruct_for_id

    return voice_design_instruct_for_id(get_state(), voice_id)


async def _generate_via_manager(
    engine_id: str, req: GenerateRequest, voice_fields: dict | None = None
) -> Response:
    """Synth via the managed engine subprocess.

    `voice_fields` carries whatever the stored voice contributes to the
    call — the reference WAV path (and its transcript) for a clone, the
    style vector for a blend. The host
    resolves them so the engine subprocess never needs access to the voice
    store. See `render_core.voice_synth_fields`.

    Long text (> settings.generation.max_chunk_chars) is split at sentence
    boundaries and per-chunk results are crossfade-concatenated. This is
    the chunked-TTS path wired into the single-line generate path (was dead
    code before — render_core.py used it for chapter renders, but the /v1/
    generate route was passing long text in one shot, which truncates or
    hallucinates trailing noise on most engines).
    """
    from ..render_core import _line_model

    mgr = get_manager()
    st = get_state()
    model = _line_model(st, req.voice, engine_id)
    # Every [tag] this engine can't perform goes, as in a chapter render
    # (decided 2026-09-29) — Generate used to send the text untouched, so
    # Kokoro read "[warm]" aloud as "warm". Then the lexicons (2026-09-30).
    req, ipa_map = _read_through_lexicons(st, engine_id, req)
    from ..render_core import description_seed, is_description_voice, line_split_chars

    _cap, crossfade_ms = _chunking_params(st.settings.get())
    # Each model's own piece length (audit 2026-10-04 §13.3), as in a chapter render.
    max_chunk_chars = line_split_chars(st, engine_id, req.voice)
    describe = is_description_voice(st, req.voice)
    request_delivery = req.delivery.model_dump(exclude_none=True) if req.delivery else {}
    persona = st.personas.get(req.persona_id) if req.persona_id else None
    language = req.language
    if persona is not None:
        # The persona's settings through the ONE resolver the chapter render
        # uses (persona_render.plan_line, 2026-10-03), on the voice Generate
        # is speaking: that model's own knobs, emotion or tags and seed, the
        # direction composed, its language and effects. The request sits on
        # top. (Its lexicon is the one the request names — Generate sends the
        # persona's.)
        from ..persona_render import plan_line

        plan = plan_line(st, persona, text=req.text, request_delivery=request_delivery, voice=req.voice)
        delivery = plan.delivery
        effects = plan.effects
        language = req.language or plan.language
        persona_seed = plan.seed
    else:
        delivery = merge_delivery(request_delivery)
        # `emotion` rides on the end through the same composer the chapter
        # path uses. A clip-less DESIGNED voice leads: its description is
        # the identity, not direction, and the VoiceDesign checkpoint has
        # nothing else to go on (2026-08-22 — same seam as the chapter path,
        # so one button cannot sound different from the other).
        composed = compose_instruct(
            _voice_design_instruct(req.voice),
            delivery.get("instruct"),
            delivery.get("emotion"),
        )
        if composed:
            delivery["instruct"] = composed
        effects = []
        persona_seed = delivery.pop("seed", None)
    if ipa_map:
        delivery["ipa_map"] = ipa_map
    # A tag model's own tags for the line, then the emotion's tag — the
    # chapter render's own steps (render_core), so Generate's Turbo line says
    # its [fear] too. Generate applied neither until 2026-10-03.
    from ..render_core import _apply_emotion_tag, _apply_lead_tags, _emotion_tagset

    text_out = _apply_emotion_tag(_apply_lead_tags(req.text, delivery, model), delivery, _emotion_tagset(model))
    req = req.model_copy(update={"text": text_out})

    def _synth_one(text: str, chunk_seed: int | None):
        body = {
            "voice_id": req.voice,
            "text": text,
            "language": language,
            "delivery": delivery,
            "seed": chunk_seed,
            **(voice_fields or {}),
        }
        return mgr.synth(engine_id, body)

    # Seed resolution: the delivery's seed (the UI's authoritative location
    # since it lives next to other per-render knobs, or the persona's for
    # this model) overrides the top-level req.seed. Either path produces the
    # same per-chunk seed math below.
    effective_seed = persona_seed if persona_seed is not None else req.seed
    # A description voice is drawn from its description on every request: with no seed set it
    # gets its fixed one, and every piece of a long line keeps it — `seed + i` per piece drew
    # a different voice for each (§13.3).
    if effective_seed is None and describe:
        effective_seed = description_seed(req.voice)

    def _do() -> Response:
        try:
            if len(req.text) <= max_chunk_chars:
                audio_bytes, meta = _synth_one(req.text, effective_seed)
                pcm = strip_wav_header(audio_bytes) if meta.get("is_wav_container") else audio_bytes
                wav_bytes = _finish_line(
                    pcm, meta.get("sample_rate") or 24000, meta.get("channels") or 1,
                    delivery, engine_id, effects, model,
                )
                return Response(content=wav_bytes, media_type="audio/wav")

            # Long-form path: split → per-chunk synth → crossfade-concat → WAV
            chunks = split_text_into_chunks(req.text, max_chars=max_chunk_chars)
            pcm_chunks: list[np.ndarray] = []
            sample_rate = 24000
            channels = 1
            for i, piece in enumerate(chunks):
                # Vary seed per chunk to avoid correlated RNG artefacts while
                # staying deterministic for (text, seed) reproducibility.
                chunk_seed = (effective_seed + i) if effective_seed is not None and not describe                     else effective_seed
                audio_bytes, meta = _synth_one(piece, chunk_seed)
                sample_rate = meta.get("sample_rate") or sample_rate
                channels = meta.get("channels") or channels
                pcm_chunks.append(_samples_from_chunk_bytes(audio_bytes, bool(meta.get("is_wav_container"))))

            merged = concatenate_audio_chunks(pcm_chunks, sample_rate, crossfade_ms=crossfade_ms)
            pcm_int16 = (np.clip(merged, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
            wav_bytes = _finish_line(pcm_int16, sample_rate, channels, delivery, engine_id, effects, model)
            return Response(content=wav_bytes, media_type="audio/wav")
        except TermsRequired as e:
            raise e.api_error() from e
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
    req, ipa_map = _read_through_lexicons(st, engine_id, req)
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
    persona = st.personas.get(req.persona_id) if req.persona_id else None
    if persona is not None:
        # Same resolver as the managed path and the chapter render.
        from ..persona_render import plan_line

        plan = plan_line(st, persona, text=req.text, request_delivery=request_delivery, voice=req.voice)
        delivery = plan.delivery
        effects = plan.effects
        if req.language is None:
            req = req.model_copy(update={"language": plan.language})
    else:
        delivery = merge_delivery(request_delivery)
        # Same cascade as the non-streaming path: a clip-less designed
        # voice's description first, then whatever was asked for, then the
        # emotion.
        composed = compose_instruct(
            _voice_design_instruct(req.voice),
            delivery.get("instruct"),
            delivery.get("emotion"),
        )
        if composed:
            delivery["instruct"] = composed
        effects = []
    if ipa_map:
        delivery["ipa_map"] = ipa_map

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
            if not out.is_wav_container:
                pcm, sr, ch = out.bytes, out.sample_rate, out.channels
            else:
                # The providers' sample_rate is a placeholder — their WAV
                # header is authoritative (external_openai.py).
                try:
                    fmt, offset, size = parse_wav_header(out.bytes)
                except ValueError:
                    # Not 16-bit PCM: the delivery cannot be applied; the chain
                    # decodes what it can, as this path always did.
                    return Response(content=apply_effects_chain(out.bytes, effects), media_type="audio/wav")
                pcm, sr, ch = out.bytes[offset:offset + size], fmt.sample_rate, fmt.channels
            wav_bytes = _finish_line(pcm, sr, ch, delivery, engine_id, effects)
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
        wav_bytes = _finish_line(pcm_int16, sample_rate, channels, delivery, engine_id, effects)
        return Response(content=wav_bytes, media_type="audio/wav")
    except Exception as e:
        raise internal(f"engine synthesize: {e}")
