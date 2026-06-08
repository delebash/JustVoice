"""POST /v1/generate — single-line synthesis."""

from __future__ import annotations

import io
import wave

from fastapi import APIRouter, Response

from ..app_state import get_state
from ..engines.base import SynthRequest
from ..errors import bad_request, internal, not_found
from ..models import GenerateRequest

router = APIRouter(tags=["generation"])


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

    # Find which engine owns this voice
    engine_id: str | None = None
    for engine in st.engines.all():
        if any(p.id == req.voice for p in engine.voices()):
            engine_id = engine.meta.engine_id
            break
    if engine_id is None:
        # Could be a stored voice — look up via voice store
        stored = st.voices.get(req.voice)
        if stored:
            engine_id = stored.engine
    if engine_id is None:
        raise not_found(f"voice {req.voice}")

    engine = st.engines.get(engine_id)
    if engine is None:
        raise not_found(f"engine {engine_id}")
    if not engine.ready():
        # Auto-load on first synthesize
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

    # If the engine returns raw PCM, wrap with WAV header.
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
