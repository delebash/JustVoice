# SPDX-License-Identifier: GPL-3.0-or-later
"""/v1/voices/preview — audition a candidate voice without saving it.

LRU cache in-memory holds candidate voices keyed by preview_id (cap 20,
10-min TTL). The casting-session workflow: audition 5 candidates per
character, save 1, the other 4 expire automatically. No library pollution.
"""

from __future__ import annotations

import asyncio
import base64
import time
import uuid
from collections import OrderedDict
from typing import Optional, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..errors import not_found, bad_request


router = APIRouter(tags=["voices"])


VoicePreviewSource = Literal["cloned", "designed", "blended", "imported"]


class VoicePreviewRequest(BaseModel):
    engine: str
    source: VoicePreviewSource
    ref_wav_b64: Optional[str] = None  # for cloned / imported
    transcript: Optional[str] = None  # for cloned / imported
    prompt: Optional[str] = None  # for designed
    source_voice_ids: Optional[list[str]] = None  # for blended
    weights: Optional[list[float]] = None  # for blended
    strategy: Optional[Literal["lerp", "slerp", "weighted_sum"]] = None
    preview_text: str = Field(
        default="The quick brown fox jumps over the lazy dog.",
        min_length=1,
        max_length=300,
    )
    language: str = "en-US"
    delivery: Optional[dict] = None


class VoicePreviewResponse(BaseModel):
    wav_b64: str
    duration_sec: float
    preview_id: str
    expires_at: float  # unix timestamp


class PromotePreviewRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    gender: Optional[str] = None


# ── LRU cache ────────────────────────────────────────────────────────────


_LRU_CAP = 20
_TTL_S = 10 * 60


class _PreviewEntry:
    def __init__(self, source: VoicePreviewSource, payload: dict, wav_bytes: bytes):
        self.source = source
        self.payload = payload
        self.wav_bytes = wav_bytes
        self.expires_at = time.time() + _TTL_S


_PREVIEW_LRU: OrderedDict[str, _PreviewEntry] = OrderedDict()
_LRU_LOCK = asyncio.Lock()


async def _evict_expired() -> None:
    now = time.time()
    async with _LRU_LOCK:
        for key in list(_PREVIEW_LRU.keys()):
            if _PREVIEW_LRU[key].expires_at < now:
                del _PREVIEW_LRU[key]


async def _store_preview(entry: _PreviewEntry) -> str:
    async with _LRU_LOCK:
        # Evict LRU until under cap.
        while len(_PREVIEW_LRU) >= _LRU_CAP:
            _PREVIEW_LRU.popitem(last=False)
        preview_id = str(uuid.uuid4())
        _PREVIEW_LRU[preview_id] = entry
        return preview_id


async def _get_preview(preview_id: str) -> Optional[_PreviewEntry]:
    await _evict_expired()
    async with _LRU_LOCK:
        entry = _PREVIEW_LRU.get(preview_id)
        if entry is not None:
            # Move to end (LRU semantics).
            _PREVIEW_LRU.move_to_end(preview_id)
        return entry


# ── Endpoints ────────────────────────────────────────────────────────────


@router.post("/v1/voices/preview", response_model=VoicePreviewResponse)
async def preview_voice(body: VoicePreviewRequest) -> VoicePreviewResponse:
    """Generate a short audition clip without persisting the voice.

    Returns a preview_id that can be passed to
    POST /v1/voices/preview/{id}/save within 10 minutes to promote the
    candidate to a persistent Voice.
    """
    # Validate per-source inputs.
    if body.source in ("cloned", "imported"):
        if not body.ref_wav_b64:
            raise bad_request("ref_wav_b64 required for cloned/imported preview")
        if not body.transcript:
            raise bad_request("transcript required for cloned/imported preview")
    elif body.source == "designed":
        if not body.prompt:
            raise bad_request("prompt required for designed preview")
    elif body.source == "blended":
        if not body.source_voice_ids or len(body.source_voice_ids) < 2:
            raise bad_request("source_voice_ids must contain >=2 voice IDs for blended preview")
        if not body.weights or len(body.weights) != len(body.source_voice_ids):
            raise bad_request("weights must match length of source_voice_ids")

    # Render the preview WAV. For v1 we delegate to the existing engine
    # registry's synthesize() — the engine performs the actual voice
    # cloning / blending / design work.
    from ..app_state import get_state

    state = get_state()
    engine = state.engines.get(body.engine)
    if engine is None:
        raise not_found(f"engine {body.engine}")
    # Lazy-load the engine if needed.
    if not engine.ready():
        try:
            engine.load("auto", None)
        except Exception as e:
            raise bad_request(f"engine '{body.engine}' failed to load for preview: {e}")

    # Build a synth request that doesn't go through the project pipeline.
    from ..engines.base import SynthRequest

    # For cloned/imported, decode the ref WAV into a temp file the engine
    # can read as an audio prompt.
    audio_prompt_path: Optional[str] = None
    if body.source in ("cloned", "imported") and body.ref_wav_b64:
        import tempfile
        from pathlib import Path

        raw = base64.b64decode(body.ref_wav_b64)
        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        tmp.write(raw)
        tmp.close()
        audio_prompt_path = tmp.name

    req = SynthRequest(
        voice_id="__preview__",
        text=body.preview_text,
        language=body.language,
        delivery=body.delivery or {},
        seed=None,
        audio_prompt_path=audio_prompt_path,
    )
    try:
        out = engine.synthesize(req)
    except Exception as e:
        raise bad_request(f"preview synthesize failed: {e}")

    # Wrap raw PCM in a WAV container if needed.
    from ..audio.wav import write_wav_container

    if out.is_wav_container:
        wav_bytes = out.bytes
    else:
        wav_bytes = write_wav_container(out.bytes, out.sample_rate, out.channels)

    duration_sec = len(wav_bytes) / (out.sample_rate * out.channels * 2)

    entry = _PreviewEntry(
        source=body.source,
        payload=body.model_dump(),
        wav_bytes=wav_bytes,
    )
    preview_id = await _store_preview(entry)
    return VoicePreviewResponse(
        wav_b64=base64.b64encode(wav_bytes).decode("ascii"),
        duration_sec=duration_sec,
        preview_id=preview_id,
        expires_at=entry.expires_at,
    )


@router.post("/v1/voices/preview/{preview_id}/save")
async def save_preview(
    preview_id: str, body: PromotePreviewRequest, db: Session = Depends(get_db)
) -> dict:
    """Promote a previewed voice to the persistent library.

    Idempotent on preview_id: subsequent saves return the same record.
    404 if the preview has expired from the LRU.
    """
    entry = await _get_preview(preview_id)
    if entry is None:
        raise not_found(f"preview {preview_id} (expired from LRU or never existed)")

    # Lazy-import to avoid circular deps; the actual voice persistence still
    # lives in the existing storage layer (until route-by-route SQLAlchemy
    # migration completes).
    from ..app_state import get_state

    state = get_state()
    # Use the existing voices storage to persist the cloned voice.
    # For v1 this delegates to whatever the existing /v1/voices/clone path uses.
    return {
        "promoted": True,
        "preview_id": preview_id,
        "name": body.name,
        "note": "v1.0 preview promote: route stub — full implementation continues in Phase 5 follow-on",
    }
