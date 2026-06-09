"""POST /v1/generate — single-line synthesis.

Dispatches voice lookup + synth through either the manager (managed
engines) or the legacy in-process registry (external engines). Both
paths return audio/wav bytes.

Long text (> settings.generation.max_chunk_chars) is auto-chunked at
sentence boundaries via `audio/chunked.py` (the voicebox lift). Below
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
from ..audio.wav import strip_wav_header, write_wav_container
from ..delivery_merge import merge_delivery
from ..engines.base import SynthRequest
from ..engines.manager import get_manager
from ..errors import bad_request, internal, not_found
from ..models import GenerateRequest


def _samples_from_chunk_bytes(audio_bytes: bytes, is_wav: bool) -> np.ndarray:
    """Decode one chunk's bytes (PCM or WAV) → float32 samples in [-1, 1]."""
    pcm = strip_wav_header(audio_bytes) if is_wav else audio_bytes
    return np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32767.0


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
        prompt_path = _resolve_audio_prompt_for_stored(stored)
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
            return await _generate_via_manager(stored.engine, req, audio_prompt_path=prompt_path)
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
    """For cloned / imported voices, return the absolute path to the reference
    WAV on disk so the engine subprocess can read it as `audio_prompt_path`.
    For preset/designed voices (no reference clip), return None.
    """
    if stored.source not in ("cloned", "imported"):
        return None
    st = get_state()
    path = st.voices.ref_wav_path(stored.id)
    if not path.is_file():
        return None
    return str(path.resolve())


async def _generate_via_manager(
    engine_id: str, req: GenerateRequest, audio_prompt_path: str | None = None
) -> Response:
    """Synth via the managed engine subprocess.

    `audio_prompt_path` is filled in for cloned voices — the host resolves
    the stored voice's reference WAV path here so the engine subprocess
    can pass it to `model.generate(audio_prompt_path=…)` without needing
    its own access to the host's voice store.

    Long text (> settings.generation.max_chunk_chars) is split at sentence
    boundaries and per-chunk results are crossfade-concatenated. This is
    the voicebox lift wired into the single-line generate path (was dead
    code before — render_core.py used it for chapter renders, but the /v1/
    generate route was passing long text in one shot, which truncates or
    hallucinates trailing noise on most engines).
    """
    mgr = get_manager()
    st = get_state()
    max_chunk_chars, crossfade_ms = _chunking_params(st.settings.get())
    request_delivery = req.delivery.model_dump(exclude_none=True) if req.delivery else {}
    # 3-tier voice tuning merge (#88): preset > request > profile defaults.
    # Always runs — when profile_id / preset_id are None, returns the
    # request delivery unchanged.
    from ..database.session import SessionLocal
    db = SessionLocal()
    try:
        delivery = merge_delivery(request_delivery, req.profile_id, req.preset_id, db)
    finally:
        db.close()

    def _synth_one(text: str, chunk_seed: int | None):
        body = {
            "voice_id": req.voice,
            "text": text,
            "language": req.language,
            "delivery": delivery,
            "seed": chunk_seed,
            "audio_prompt_path": audio_prompt_path,
        }
        return mgr.synth(engine_id, body)

    try:
        if len(req.text) <= max_chunk_chars:
            audio_bytes, meta = _synth_one(req.text, req.seed)
            if not meta.get("is_wav_container"):
                sr = meta.get("sample_rate") or 24000
                channels = meta.get("channels") or 1
                audio_bytes = write_wav_container(audio_bytes, sr, channels)
            return Response(content=audio_bytes, media_type="audio/wav")

        # Long-form path: split → per-chunk synth → crossfade-concat → WAV
        chunks = split_text_into_chunks(req.text, max_chars=max_chunk_chars)
        pcm_chunks: list[np.ndarray] = []
        sample_rate = 24000
        channels = 1
        for i, piece in enumerate(chunks):
            # Vary seed per chunk to avoid correlated RNG artefacts while
            # staying deterministic for (text, seed) reproducibility.
            chunk_seed = (req.seed + i) if req.seed is not None else None
            audio_bytes, meta = _synth_one(piece, chunk_seed)
            sample_rate = meta.get("sample_rate") or sample_rate
            channels = meta.get("channels") or channels
            pcm_chunks.append(_samples_from_chunk_bytes(audio_bytes, bool(meta.get("is_wav_container"))))

        merged = concatenate_audio_chunks(pcm_chunks, sample_rate, crossfade_ms=crossfade_ms)
        pcm_int16 = (np.clip(merged, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
        wav_bytes = write_wav_container(pcm_int16, sample_rate, channels)
        return Response(content=wav_bytes, media_type="audio/wav")
    except Exception as e:
        raise internal(f"engine synthesize: {e}")


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
    from ..database.session import SessionLocal
    db = SessionLocal()
    try:
        delivery = merge_delivery(request_delivery, req.profile_id, req.preset_id, db)
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
        return Response(content=wav_bytes, media_type="audio/wav")
    except Exception as e:
        raise internal(f"engine synthesize: {e}")
