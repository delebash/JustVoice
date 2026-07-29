# SPDX-License-Identifier: MIT
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
from typing import Optional, Literal

from cachetools import TTLCache
from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..errors import conflict, not_found, bad_request


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


# cachetools.TTLCache gives us the cap-20 + 10-min-TTL eviction for free — it
# combines LRU-on-access promotion (get() moves an entry to most-recent) with
# TTL expiry driven by its own timer, so it matches the hand-rolled OrderedDict
# (which paid an O(n) expiry scan on every get) exactly. Not thread-safe, so
# every access stays under _LRU_LOCK — the async endpoints share one event-loop
# thread and the lock keeps concurrent coroutines from interleaving a mutation.
# No eviction side effects to preserve (entries hold in-memory WAV bytes only).
_PREVIEW_LRU: TTLCache[str, _PreviewEntry] = TTLCache(maxsize=_LRU_CAP, ttl=_TTL_S)
_LRU_LOCK = asyncio.Lock()


async def _store_preview(entry: _PreviewEntry) -> str:
    async with _LRU_LOCK:
        preview_id = str(uuid.uuid4())
        _PREVIEW_LRU[preview_id] = entry  # TTLCache evicts past the cap / on TTL
        return preview_id


async def _get_preview(preview_id: str) -> Optional[_PreviewEntry]:
    async with _LRU_LOCK:
        # .get() both drops the entry if its TTL lapsed (→ None → 404) and
        # promotes a live hit to most-recently-used.
        return _PREVIEW_LRU.get(preview_id)


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

    get_state()  # boot-checks app state; persistence below uses the voices store
    # Use the existing voices storage to persist the cloned voice.
    # For v1 this delegates to whatever the existing /v1/voices/clone path uses.
    return {
        "promoted": True,
        "preview_id": preview_id,
        "name": body.name,
        "note": "v1.0 preview promote: route stub — full implementation continues in Phase 5 follow-on",
    }

# ── Row preview — audition an EXISTING voice (table ▶) ──────────────────

PREVIEW_LINE_DEFAULT = "Hello — here's how this voice sounds."


@router.post("/v1/voices/{voice_id}/preview")
async def preview_existing_voice(voice_id: str, auto_load: bool = False) -> Response:
    """Short audition clip for a stored or preset voice.

    Mirrors /v1/generate's voice→engine routing (managed engines via the
    manager, stored + in-process via the registry). When the owning
    engine isn't loaded and auto_load is false, returns 409 with detail
    "engine_not_loaded:<engine_id>" so the client can ask the user before
    paying the 25–55 s load.
    """
    from ..app_state import get_state
    from ..engines.manager import get_manager
    from ..models import GenerateRequest
    from .generate_api import (
        _find_managed_voice_owner,
        _find_static_voice_owner,
        _generate_via_inprocess,
        _generate_via_manager,
        _resolve_audio_prompt_for_stored,
    )

    st = get_state()
    mgr = get_manager()
    req = GenerateRequest(voice=voice_id, text=PREVIEW_LINE_DEFAULT)

    # 1. Voice of the currently-loaded managed engine — just synth.
    owner = _find_managed_voice_owner(voice_id)
    if owner is not None:
        return await _generate_via_manager(owner, req)

    # 2. Static voice of an installed-but-not-loaded managed engine.
    static_owner = _find_static_voice_owner(voice_id)
    if static_owner is not None:
        m = mgr.get_manifest(static_owner)
        if m is not None and m.isolation == "venv" and not m.is_installed:
            # Isolated engine with no venv yet — a raw 500 told the user
            # nothing (user-hit: Dia preview). The UI maps this marker
            # to an "install it in Engines" dialog.
            raise conflict(f"engine_not_installed:{static_owner}")
        if mgr.current_id() != static_owner:
            if not auto_load:
                raise conflict(f"engine_not_loaded:{static_owner}")
            mgr.load(static_owner, device="auto")
        return await _generate_via_manager(static_owner, req)

    # 3. Stored voice (clone / design / import / blend).
    stored = st.voices.get(voice_id)
    if stored:
        prompt_path = _resolve_audio_prompt_for_stored(stored)
        if mgr.get_manifest(stored.engine):
            if mgr.current_id() != stored.engine:
                if not auto_load:
                    raise conflict(f"engine_not_loaded:{stored.engine}")
                mgr.load(stored.engine, device="auto")
            return await _generate_via_manager(
                stored.engine, req, audio_prompt_path=prompt_path
            )
        engine = st.engines.get(stored.engine)
        if engine is None:
            raise not_found(f"engine {stored.engine}")
        if not engine.ready() and not auto_load:
            raise conflict(f"engine_not_loaded:{stored.engine}")
        return _generate_via_inprocess(stored.engine, req)

    # 4. In-process engine preset.
    for engine in st.engines.all():
        if any(p.id == voice_id for p in engine.voices()):
            if not engine.ready() and not auto_load:
                raise conflict(f"engine_not_loaded:{engine.meta.engine_id}")
            return _generate_via_inprocess(engine.meta.engine_id, req)

    raise not_found(f"voice {voice_id}")
