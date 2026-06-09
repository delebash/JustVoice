"""POST /v1/generate — single-line synthesis.

Dispatches voice lookup + synth through either the manager (managed
engines) or the legacy in-process registry (external engines). Both
paths return audio/wav bytes; the manager's subprocess produces a
complete WAV already, so we just pass it through.
"""

from __future__ import annotations

import io
import wave

from fastapi import APIRouter, Response

from ..app_state import get_state
from ..engines.base import SynthRequest
from ..engines.manager import get_manager
from ..errors import bad_request, internal, not_found
from ..models import GenerateRequest

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
    """
    mgr = get_manager()
    body = {
        "voice_id": req.voice,
        "text": req.text,
        "language": req.language,
        "delivery": req.delivery.model_dump(exclude_none=True) if req.delivery else {},
        "seed": req.seed,
        "audio_prompt_path": audio_prompt_path,
    }
    try:
        audio_bytes, meta = mgr.synth(engine_id, body)
    except Exception as e:
        raise internal(f"engine synthesize: {e}")
    # Manager passes through whatever the engine returned. Convert raw PCM
    # → WAV here so the host's response is always audio/wav.
    if not meta.get("is_wav_container"):
        sr = meta.get("sample_rate") or 24000
        channels = meta.get("channels") or 1
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(channels)
            w.setsampwidth(2)
            w.setframerate(sr)
            w.writeframes(audio_bytes)
        audio_bytes = buf.getvalue()
    return Response(content=audio_bytes, media_type="audio/wav")


def _generate_via_inprocess(engine_id: str, req: GenerateRequest) -> Response:
    """Synth via a legacy in-process engine (external-openai-tts today)."""
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

    synth_req = SynthRequest(
        voice_id=req.voice,
        text=req.text,
        language=req.language,
        delivery=req.delivery.model_dump(exclude_none=True) if req.delivery else {},
        seed=req.seed,
    )

    try:
        out = engine.synthesize(synth_req)
    except Exception as e:
        raise internal(f"engine synthesize: {e}")

    if not out.is_wav_container:
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(out.channels)
            w.setsampwidth(2)
            w.setframerate(out.sample_rate)
            w.writeframes(out.bytes)
        wav_bytes = buf.getvalue()
    else:
        wav_bytes = out.bytes

    return Response(content=wav_bytes, media_type="audio/wav")
