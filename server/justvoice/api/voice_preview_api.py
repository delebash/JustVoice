# SPDX-License-Identifier: MIT
"""/v1/voices/preview — audition a candidate voice without saving it.

LRU cache in-memory holds candidate voices keyed by preview_id (cap 20,
10-min TTL). The casting-session workflow: audition 5 candidates per
character, save 1, the other 4 expire automatically. No library pollution.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import time
import uuid
from typing import Optional, Literal

from cachetools import TTLCache
from fastapi import APIRouter, Depends, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..errors import conflict, not_found, bad_request
from ..models import BlendSegment, BlendStrategy


router = APIRouter(tags=["voices"])


VoicePreviewSource = Literal["cloned", "designed", "blended", "imported"]


def _client_pinned_language(body: "VoicePreviewRequest") -> bool:
    """Did the caller actually choose a language, or is this the default?

    `language` carries a default of "en-US", so its VALUE cannot answer
    this — pydantic's model_fields_set can. The Blend tab deliberately sends
    nothing (a mix inherits its sources' language), while the Dataset
    builder and services/projects.js pin one on purpose; both must keep
    working.
    """
    return "language" in body.model_fields_set


class VoicePreviewRequest(BaseModel):
    engine: str
    source: VoicePreviewSource
    ref_wav_b64: Optional[str] = None  # for cloned / imported
    transcript: Optional[str] = None  # for cloned / imported
    xvector_only: bool = False  # clone from the speaker vector alone
    prompt: Optional[str] = None  # for designed
    source_voice_ids: Optional[list[str]] = None  # for blended
    weights: Optional[list[float]] = None  # for blended
    # Which blend strategy the audition is previewing. The audition and the
    # save must agree or you hear one voice and keep another.
    strategy: BlendStrategy = "blend"
    segments: Optional[list[BlendSegment]] = None  # for the recombine strategy
    preview_text: str = Field(
        default="The quick brown fox jumps over the lazy dog.",
        min_length=1,
        # 300 was an audition-sized cap. The Dataset builder generates real
        # training lines through this same door, and a training clip is
        # gated at settings.training.validation.max_sample_duration_secs
        # (60 s by default) — roughly 150 words, ~900 characters. 2000
        # leaves headroom for a long reference passage without letting a
        # whole chapter through.
        max_length=2000,
    )
    language: str = "en-US"
    delivery: Optional[dict] = None
    # Per-render RNG seed. Same seed + same inputs = the same voice, which
    # is what makes a generated training set coherent instead of thirty
    # different speakers (Alexandria's Dataset builder is built on this).
    # None = random, the previous always-on behaviour.
    seed: Optional[int] = None


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
        # Set by the save route so a repeated save is idempotent rather
        # than minting a second copy of the same candidate.
        self.saved_voice_id: str | None = None


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


def _resolve_blend(body: "VoicePreviewRequest", state) -> "tuple[list[float], str | None]":
    """A blend candidate's style vector, and the language it should speak.

    ONE door for both audition paths — the POST that returns a whole WAV and
    the stream ticket. They diverged once already (the POST derived a
    language while the stream hardcoded none) and that divergence is the
    tracked "blend auditions as English" defect.

    Returns (vector, language | None); None means the caller pinned a
    language and it must be left alone.
    """
    from ..engines import blending

    if not blending.supports(body.engine):
        raise bad_request(
            f"engine '{body.engine}' cannot blend — Kokoro is the blending engine."
        )

    def _resolve(vid: str):
        r = state.voices.get(vid)
        return list(r.embedding) if r and r.embedding else None

    try:
        if body.strategy == "recombine":
            sources = [s.voice_id for s in body.segments]
            vector = blending.recombine(
                body.engine,
                [(s.voice_id, s.start, s.end) for s in body.segments],
                data_dir=state.data_dir,
                resolve_stored=_resolve,
            )
        else:
            sources = list(body.source_voice_ids)
            # Same rule as the save endpoint: a mix divides by Σw, an
            # analogy keeps its magnitude.
            weights = list(body.weights)
            if body.strategy != "vector":
                total = sum(weights)
                if total <= 0:
                    raise bad_request("weights must sum to a positive value")
                weights = [w / total for w in weights]
            elif not any(weights):
                raise bad_request("every weight is zero — there is nothing to combine")
            vector = blending.blend(
                body.engine,
                sources,
                weights,
                data_dir=state.data_dir,
                resolve_stored=_resolve,
                normalize=False,  # applied above, per strategy
            )
    except LookupError as e:
        raise bad_request(str(e))
    except ValueError as e:
        raise bad_request(str(e))

    # THE FIX for "a blend of non-English voices auditions as English"
    # (tracked, code-verified 2026-08-20). The client used to send
    # language: "en-US" unconditionally, which won over the engine's own
    # per-voice fallback, so Chinese text was phonemized with English rules.
    # A pinned language still wins — the Dataset builder and
    # services/projects.js set one on purpose.
    if _client_pinned_language(body):
        return vector, None

    from .voices_api import blend_language_for

    return vector, blend_language_for(state, body.engine, sources)


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
        if body.strategy == "recombine":
            if not body.segments or len(body.segments) < 2:
                raise bad_request("recombine needs at least 2 segments")
        else:
            floor = 1 if body.strategy == "extrapolate" else 2
            if not body.source_voice_ids or len(body.source_voice_ids) < floor:
                raise bad_request(
                    f"source_voice_ids must contain >={floor} voice ID"
                    f"{'' if floor == 1 else 's'} for a {body.strategy} preview"
                )
            if not body.weights or len(body.weights) != len(body.source_voice_ids):
                raise bad_request("weights must match length of source_voice_ids")

    # Render the preview WAV. For v1 we delegate to the existing engine
    # registry's synthesize() — the engine performs the actual voice
    # cloning / blending / design work.
    from ..app_state import get_state

    state = get_state()
    # Registry backends (external providers) keep the direct path; managed
    # plugin engines route via the manager through the scheduler (§7d of the
    # 2026-08-08 plan — the registry never holds them, so the old lookup
    # 404'd every managed clone/design preview).
    engine = state.engines.get(body.engine)
    manifest = None
    if engine is None:
        from ..engines.manager import get_manager

        manifest = get_manager().get_manifest(body.engine)
        if manifest is None:
            raise not_found(f"engine {body.engine}")
    # Lazy-load a registry engine if needed (managed engines load inside
    # the scheduled call below).
    if engine is not None and not engine.ready():
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

    from ..audio.wav import write_wav_container

    # What this candidate contributes to the engine call, per source — the
    # same fields a SAVED voice contributes through
    # `render_core.voice_synth_fields`. Wired 2026-08-19: before this, a
    # blended or designed audition passed nothing but `__preview__` and the
    # engine rendered its default voice, so every candidate sounded alike.
    delivery = dict(body.delivery or {})
    extra: dict = {}
    if audio_prompt_path:
        extra["audio_prompt_path"] = audio_prompt_path
        if body.xvector_only:
            extra["xvector_only"] = True
        elif body.transcript:
            extra["ref_text"] = body.transcript
    elif body.source == "designed":
        # The description IS the instruct for a design checkpoint; a line's
        # own direction would append to it exactly as it does at render.
        delivery["instruct"] = " ".join(
            x for x in (body.prompt, delivery.get("instruct")) if x
        )
    elif body.source == "blended":
        vector, lang = _resolve_blend(body, state)
        extra["voice_vector"] = vector
        if lang is not None:
            body.language = lang

    if engine is not None:
        req = SynthRequest(
            voice_id="__preview__",
            text=body.preview_text,
            language=body.language,
            delivery=delivery,
            seed=body.seed,
            **extra,
        )
        try:
            out = engine.synthesize(req)
        except Exception as e:
            raise bad_request(f"preview synthesize failed: {e}")

        # Wrap raw PCM in a WAV container if needed.
        if out.is_wav_container:
            wav_bytes = out.bytes
        else:
            wav_bytes = write_wav_container(out.bytes, out.sample_rate, out.channels)
        sample_rate = out.sample_rate
        channels = out.channels
    else:
        from ..engines.manager import get_manager
        from ..synth_scheduler import get_scheduler

        mgr = get_manager()
        kind = manifest.kind

        def _do() -> tuple[bytes, int, int]:
            if mgr.current_for(kind) != body.engine:
                mgr.load(body.engine, device="auto")
            audio_bytes, meta = mgr.synth(
                body.engine,
                {
                    "voice_id": "__preview__",
                    "text": body.preview_text,
                    "language": body.language,
                    "delivery": delivery,
                    "seed": body.seed,
                    **extra,
                },
            )
            sr = meta.get("sample_rate") or 24000
            ch = meta.get("channels") or 1
            if meta.get("is_wav_container"):
                return audio_bytes, sr, ch
            return write_wav_container(audio_bytes, sr, ch), sr, ch

        handle = get_scheduler().submit([(body.engine, _do)], interactive=True)
        await handle.wait_async()
        if handle.error is not None:
            raise bad_request(f"preview synthesize failed: {handle.error}")
        wav_bytes, sample_rate, channels = handle.items[0].result

    duration_sec = len(wav_bytes) / (sample_rate * channels * 2)

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

    # Implemented 2026-08-19 (the acquisition build). This route used to
    # return {"promoted": True, …, "note": "route stub"} without writing
    # anything — a Save button that reported success and lost the voice.
    from datetime import datetime, timezone

    from ..app_state import get_state
    from ..models import BlendRecipe, VoiceRecord

    state = get_state()
    payload = entry.payload or {}

    # Idempotent on preview_id: a second save returns the first record.
    already = entry.saved_voice_id
    if already:
        rec = state.voices.get(already)
        if rec:
            return {"promoted": True, "preview_id": preview_id, "voice_id": rec.id,
                    "name": rec.name, "source": rec.source}

    now = datetime.now(timezone.utc)
    # The recipe stored here must match what POST /v1/voices/blend would
    # store for the same inputs, or the same mix reached through two doors
    # dedups as two voices. Shares are normalized; an analogy is not.
    strategy = payload.get("strategy") or "blend"
    segments = [BlendSegment(**s) for s in (payload.get("segments") or [])]
    weights = list(payload.get("weights") or [])
    if strategy == "recombine":
        recipe_sources = [s.voice_id for s in segments]
        recipe_weights: list[float] = []
    else:
        recipe_sources = list(payload.get("source_voice_ids") or [])
        total = sum(weights)
        recipe_weights = (
            [w / total for w in weights] if strategy != "vector" and total else weights
        )
    record = VoiceRecord(
        id="",
        engine=payload.get("engine", ""),
        source=entry.source,
        name=body.name,
        language=payload.get("language") or "en",
        gender=body.gender,
        transcript=payload.get("transcript"),
        design_prompt=payload.get("prompt"),
        sample_count=0,
        blend_recipe=(
            BlendRecipe(
                strategy=strategy,
                sources=recipe_sources,
                weights=recipe_weights,
                segments=segments or None,
            )
            if entry.source == "blended" and (weights or segments)
            else None
        ),
        created_at=now,
        updated_at=now,
    )
    created = state.voices.create(record)

    # The reference clip travels with a cloned/imported voice — without it
    # the saved voice has no timbre source and every later render fails.
    ref_b64 = payload.get("ref_wav_b64")
    if ref_b64:
        try:
            state.voices.write_ref_wav(created.id, base64.b64decode(ref_b64))
        except Exception as e:
            state.voices.delete(created.id)
            raise bad_request(f"could not store the reference clip: {e}")

    # A blend's vector is recomputed from its recipe rather than carried in
    # the preview payload — same inputs, same arithmetic, and it stays
    # correct if the voice pack was reinstalled between audition and save.
    if entry.source == "blended" and record.blend_recipe:
        from ..engines import blending

        _resolve = lambda vid: (  # noqa: E731
            list(r.embedding) if (r := state.voices.get(vid)) and r.embedding else None
        )
        recipe = record.blend_recipe
        try:
            if recipe.strategy == "recombine":
                vector = blending.recombine(
                    created.engine,
                    [(s.voice_id, s.start, s.end) for s in (recipe.segments or [])],
                    data_dir=state.data_dir,
                    resolve_stored=_resolve,
                )
            else:
                # The recipe's weights are already in their final form —
                # normalized for a mix, raw for an analogy — so the combine
                # must not divide again.
                vector = blending.blend(
                    created.engine,
                    list(recipe.sources),
                    list(recipe.weights),
                    data_dir=state.data_dir,
                    resolve_stored=_resolve,
                    normalize=False,
                )
            state.voices.update(created.id, embedding=vector)
        except (LookupError, NotImplementedError, ValueError) as e:
            state.voices.delete(created.id)
            raise bad_request(f"could not save the blend: {e}")

    entry.saved_voice_id = created.id
    return {
        "promoted": True,
        "preview_id": preview_id,
        "voice_id": created.id,
        "name": created.name,
        "source": created.source,
    }

# ── Row preview — audition an EXISTING voice (table ▶) ──────────────────

PREVIEW_LINE_DEFAULT = "Hello — here's how this voice sounds."

# Minimum audition length the endpoint always accepts, whatever
# `limits.text_max_chars` is set to. An operator who clamps generation to a
# short line still gets a usable audition; the cap only ever rises from here.
AUDITION_TEXT_FLOOR = 300


class AuditionRequest(BaseModel):
    """Optional body for the row preview.

    Both fields optional, and an ABSENT body is the canned audition —
    the ▶ button in the voice library posts nothing and behaves exactly as
    it did before this body existed.
    """

    text: Optional[str] = None
    delivery: Optional[dict] = None


# ── Rendered-audition cache ──────────────────────────────────────────────
#
# Auditioning is a listen-tweak-listen loop, so the same (voice, line,
# knobs) triple gets asked for repeatedly — and on a slot-coupled engine
# each miss is a real synth. Keyed on exactly what changes the audio;
# 10-minute TTL because a re-cloned voice keeps its id, so a stale hit has
# to age out on its own.
_AUDITION_CAP = 32
_AUDITION_TTL_S = 10 * 60
_AUDITION_CACHE: TTLCache[str, tuple[bytes, str]] = TTLCache(
    maxsize=_AUDITION_CAP, ttl=_AUDITION_TTL_S
)
_AUDITION_LOCK = asyncio.Lock()

# Test hook — counts served-from-cache responses. Nothing in the app reads it.
audition_cache_hits = 0


def audition_cache_key(voice_id: str, text: str, delivery: Optional[dict]) -> str:
    """sha1 over the three things that change the audio. Delivery is
    canonicalized (sorted keys, no whitespace) so key order can't split one
    logical request across two cache entries."""
    canonical = json.dumps(delivery or {}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha1(f"{voice_id}\x00{text}\x00{canonical}".encode("utf-8")).hexdigest()


def _reset_audition_cache() -> None:
    """Tests only."""
    global audition_cache_hits
    _AUDITION_CACHE.clear()
    audition_cache_hits = 0


# ── Streaming an UNSAVED candidate ───────────────────────────────────────
# The stream door addresses a voice by id, and a candidate has no id until
# you keep it — which is why the Blend tab waited for a whole WAV on every
# iteration while the library streamed. A ticket is a short-lived stand-in
# id: POST the recipe once, then stream against the ticket exactly as if it
# were a voice. 10 minutes matches the preview LRU's TTL.
_STREAM_TICKETS: TTLCache[str, dict] = TTLCache(maxsize=64, ttl=_TTL_S)


def _audition_language(voice_id: str) -> str | None:
    """The language an audition should render in, or None to let the engine
    use the voice's own catalog language.

    A preset resolves correctly inside the engine (its id carries its
    language), so None is right there. A STORED voice does not: a blend is
    minted `voice_<hex>`, the engine's lookup misses, and it falls back to
    en-US — so a saved Mandarin blend streamed as English, the same defect
    as the pre-save audition and on the same day. render_core's
    voice_synth_fields deliberately carries only synth INPUTS (clip, vector,
    adapter), so the language has to come from the record here.
    """
    ticket = _STREAM_TICKETS.get(voice_id)
    if ticket:
        return ticket.get("language")
    from ..app_state import get_state

    rec = get_state().voices.get(voice_id)
    return rec.language if rec and rec.language else None


def _resolve_audition_target(voice_id: str, auto_load: bool):
    """ONE voice→engine routing door for both audition endpoints (POST
    /preview and GET /preview/stream) — the same four tiers the POST
    endpoint always had, factored so the streaming path can't drift:

    1. voice of the currently-loaded managed engine,
    2. static voice of an installed managed engine (load-on-consent),
    3. stored voice (clone / design / import / blend / trained),
    4. in-process engine preset.

    Returns ("managed" | "inprocess", engine_id, voice_fields | None);
    raises the same 409 engine_not_installed/_not_loaded conflicts the
    client dialogs key on.
    """
    from ..app_state import get_state
    from ..engines.manager import get_manager
    from .generate_api import (
        _find_managed_voice_owner,
        _find_static_voice_owner,
        _voice_synth_fields,
    )

    st = get_state()
    mgr = get_manager()

    # Tier 0 — a stream ticket standing in for a candidate that has no id
    # yet. Everything downstream treats it as an ordinary voice.
    ticket = _STREAM_TICKETS.get(voice_id)
    if ticket:
        engine_id = ticket["engine_id"]
        m = mgr.get_manifest(engine_id)
        if m is not None:
            if m.isolation == "venv" and not m.is_installed:
                raise conflict(f"engine_not_installed:{engine_id}")
            if mgr.current_id() != engine_id:
                if not auto_load:
                    raise conflict(f"engine_not_loaded:{engine_id}")
                mgr.load(engine_id, device="auto")
            return ("managed", engine_id, ticket["voice_fields"])
        return ("inprocess", engine_id, ticket["voice_fields"])

    owner = _find_managed_voice_owner(voice_id)
    if owner is not None:
        return ("managed", owner, None)

    static_owner = _find_static_voice_owner(voice_id)
    if static_owner is not None:
        m = mgr.get_manifest(static_owner)
        if m is not None and m.isolation == "venv" and not m.is_installed:
            # Isolated engine with no venv yet — a raw 500 told the user
            # nothing (user-hit on an isolated engine's preview). The UI
            # maps this to an "install it in Engines" dialog.
            raise conflict(f"engine_not_installed:{static_owner}")
        if mgr.current_id() != static_owner:
            if not auto_load:
                raise conflict(f"engine_not_loaded:{static_owner}")
            mgr.load(static_owner, device="auto")
        return ("managed", static_owner, None)

    stored = get_state().voices.get(voice_id)
    if stored:
        voice_fields = _voice_synth_fields(stored)
        if mgr.get_manifest(stored.engine):
            if mgr.current_id() != stored.engine:
                if not auto_load:
                    raise conflict(f"engine_not_loaded:{stored.engine}")
                mgr.load(stored.engine, device="auto")
            return ("managed", stored.engine, voice_fields)
        engine = st.engines.get(stored.engine)
        if engine is None:
            raise not_found(f"engine {stored.engine}")
        if not engine.ready() and not auto_load:
            raise conflict(f"engine_not_loaded:{stored.engine}")
        return ("inprocess", stored.engine, None)

    for engine in st.engines.all():
        if any(p.id == voice_id for p in engine.voices()):
            if not engine.ready() and not auto_load:
                raise conflict(f"engine_not_loaded:{engine.meta.engine_id}")
            return ("inprocess", engine.meta.engine_id, None)

    raise not_found(f"voice {voice_id}")


def _streaming_wav_header(sample_rate: int, channels: int) -> bytes:
    """A 44-byte PCM16 WAV header with the streaming convention's sizes
    (0xFFFFFFFF): the byte count isn't known until the render finishes.
    Players read it as "PCM until the connection closes"."""
    import struct

    byte_rate = sample_rate * channels * 2
    return (
        b"RIFF" + struct.pack("<I", 0xFFFFFFFF) + b"WAVE"
        + b"fmt " + struct.pack(
            "<IHHIIHH", 16, 1, channels, sample_rate, byte_rate,
            channels * 2, 16,
        )
        + b"data" + struct.pack("<I", 0xFFFFFFFF)
    )


class StreamTicketResponse(BaseModel):
    ticket: str
    expires_at: float


@router.post(
    "/v1/voices/preview/stream-ticket",
    response_model=StreamTicketResponse,
    summary="Mint a short-lived id so an unsaved candidate can be streamed",
)
async def mint_stream_ticket(body: VoicePreviewRequest) -> StreamTicketResponse:
    """Two steps, because an <audio src> can only issue a GET.

    The stream door addresses a voice by id; a candidate you are still
    tuning has no id until you keep it. So the recipe is POSTed once, its
    style vector is computed here (the expensive part is the render, not
    this), and the ticket that comes back is passed to
    GET /v1/voices/{ticket}/preview/stream like any voice id.

    Blend-only for now: a clone or a design needs its reference clip on the
    engine call, which the ticket does not carry.
    """
    if body.source != "blended":
        raise bad_request(
            "stream tickets are for blend candidates; clone and design "
            "auditions use POST /v1/voices/preview"
        )

    from ..app_state import get_state

    state = get_state()
    vector, lang = _resolve_blend(body, state)

    ticket = f"tkt_{uuid.uuid4().hex}"
    _STREAM_TICKETS[ticket] = {
        "engine_id": body.engine,
        "voice_fields": {"voice_vector": vector},
        "language": lang if lang is not None else body.language,
    }
    return StreamTicketResponse(ticket=ticket, expires_at=time.time() + _TTL_S)


@router.get("/v1/voices/{voice_id}/preview/stream")
async def stream_voice_audition(
    voice_id: str, text: str = "", auto_load: bool = False
) -> Response:
    """Pipelined audition (streaming phase 1, 2026-08-19): the line splits
    into sentence-sized pieces (settings.generation.stream_piece_chars),
    each renders through the same doors as POST /preview, and every piece
    hits the wire as it finishes — playback starts after the FIRST piece
    instead of the whole render. Pieces join with the same crossfade math
    as the chunked long-form path, held back one crossfade window so the
    seam is blended before it is sent.

    Same routing, same text cap, same audition cache as POST /preview —
    a completed stream fills the cache, and a cache hit answers with the
    finished WAV in one piece. This is HOST-side pipelining; engine-native
    token streaming is a separate tracked item.

    An <audio src> cannot send Authorization, so a tokened remote setup
    falls back to the POST door client-side (the audio element errors and
    the existing dialog path takes over). A client disconnect stops the
    render at the next piece boundary.
    """
    import numpy as np

    from ..app_state import get_state
    from ..audio.chunked import split_text_into_chunks
    from ..audio.wav import parse_wav_header, strip_wav_header, write_wav_container
    from ..models import GenerateRequest
    from .generate_api import _generate_via_inprocess, _generate_via_manager

    global audition_cache_hits

    st = get_state()
    text = (text or "").strip() or PREVIEW_LINE_DEFAULT
    cap = max(AUDITION_TEXT_FLOOR, st.settings.get().limits.text_max_chars)
    if len(text) > cap:
        raise bad_request(
            f"audition text is {len(text)} characters, limit {cap} — "
            f"previews are for a line or two, not a chapter."
        )

    # Same key as a body-less POST of this line — the two doors share the
    # cache, so a streamed listen makes the next POST instant and vice versa.
    # A TICKET is skipped: it names one unsaved candidate, so every entry
    # would be a permanent miss taking a slot from a real voice.
    key = None if voice_id in _STREAM_TICKETS else audition_cache_key(voice_id, text, {})
    if key is not None:
        async with _AUDITION_LOCK:
            hit = _AUDITION_CACHE.get(key)
        if hit is not None:
            audition_cache_hits += 1
            return Response(content=hit[0], media_type=hit[1])

    kind, engine_id, voice_fields = _resolve_audition_target(voice_id, auto_load)
    audition_lang = _audition_language(voice_id)

    gen = st.settings.get().generation
    piece_chars = max(80, int(getattr(gen, "stream_piece_chars", 200)))
    crossfade_ms = int(getattr(gen, "crossfade_ms", 50))
    pieces = split_text_into_chunks(text, max_chars=piece_chars) or [text]

    async def _wav_stream():
        sr = 0
        channels = 1
        tail: np.ndarray | None = None  # held-back crossfade window
        emitted: list[bytes] = []  # int16 bytes, for the cache

        def _to_i16(x: np.ndarray) -> bytes:
            return (np.clip(x, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()

        for idx, piece in enumerate(pieces):
            # language: a stored voice's own, a ticket's derived one, or
            # None so a preset resolves inside the engine. Omitting it
            # made every stored blend stream as en-US.
            req = GenerateRequest(voice=voice_id, text=piece, language=audition_lang)
            if kind == "managed":
                resp = await _generate_via_manager(
                    engine_id, req, voice_fields=voice_fields
                )
            else:
                resp = _generate_via_inprocess(engine_id, req)
            wav = bytes(resp.body)
            fmt, _, _ = parse_wav_header(wav)
            pcm = (
                np.frombuffer(strip_wav_header(wav), dtype="<i2").astype(np.float32)
                / 32767.0
            )

            if sr == 0:
                sr = fmt.sample_rate
                channels = fmt.channels
                yield _streaming_wav_header(sr, channels)
            elif fmt.sample_rate != sr:
                # One engine, one audition — a rate change mid-stream would
                # be silent chipmunking. Refuse loudly instead.
                raise RuntimeError(
                    f"audition stream: sample rate changed mid-piece "
                    f"({sr} → {fmt.sample_rate})"
                )

            xf = int(sr * crossfade_ms / 1000)
            if tail is not None:
                # Same math as concatenate_audio_chunks, one seam at a time:
                # blend the held tail's end with this piece's head.
                overlap = min(xf, len(tail), len(pcm))
                if overlap > 0:
                    fade_out = np.linspace(1.0, 0.0, overlap, dtype=np.float32)
                    fade_in = np.linspace(0.0, 1.0, overlap, dtype=np.float32)
                    blended = tail[len(tail) - overlap:] * fade_out + pcm[:overlap] * fade_in
                    pcm = np.concatenate([tail[: len(tail) - overlap], blended, pcm[overlap:]])
                else:
                    pcm = np.concatenate([tail, pcm])
            # Hold back one crossfade window for the NEXT seam — except on
            # the last piece, which flushes whole.
            if idx < len(pieces) - 1 and xf > 0 and len(pcm) > xf:
                tail = pcm[-xf:]
                out = pcm[:-xf]
            else:
                tail = None
                out = pcm
            if len(out):
                chunk = _to_i16(out)
                emitted.append(chunk)
                yield chunk

        if tail is not None and len(tail):
            chunk = _to_i16(tail)
            emitted.append(chunk)
            yield chunk

        # The full render exists now — cache it with a REAL header so the
        # next play of this line is instant and scrubbable.
        if sr and emitted:
            wav_bytes = write_wav_container(b"".join(emitted), sr, channels)
            async with _AUDITION_LOCK:
                _AUDITION_CACHE[key] = (wav_bytes, "audio/wav")

    return StreamingResponse(_wav_stream(), media_type="audio/wav")


@router.post("/v1/voices/{voice_id}/preview")
async def preview_existing_voice(
    voice_id: str, auto_load: bool = False, body: Optional[AuditionRequest] = None
) -> Response:
    """Short audition clip for a stored or preset voice.

    Mirrors /v1/generate's voice→engine routing (managed engines via the
    manager, stored + in-process via the registry). When the owning
    engine isn't loaded and auto_load is false, returns 409 with detail
    "engine_not_loaded:<engine_id>" so the client can ask the user before
    paying the 25–55 s load.

    POST an optional `{text, delivery}` body to hear YOUR line with YOUR
    knobs instead of the canned sentence — the audition panel's whole
    point (Slice B). No body = the canned audition, unchanged.
    """
    from ..app_state import get_state
    from ..models import Delivery, GenerateRequest
    from .generate_api import _generate_via_inprocess, _generate_via_manager

    global audition_cache_hits

    st = get_state()

    text = (body.text if body else None) or ""
    text = text.strip() or PREVIEW_LINE_DEFAULT
    cap = max(AUDITION_TEXT_FLOOR, st.settings.get().limits.text_max_chars)
    if len(text) > cap:
        raise bad_request(
            f"audition text is {len(text)} characters, limit {cap} — "
            f"previews are for a line or two, not a chapter."
        )

    delivery_raw = (body.delivery if body else None) or {}
    # Only fields the Delivery shape actually carries; an unknown key would
    # 422 the whole audition over a typo in a knob name.
    delivery = {k: v for k, v in delivery_raw.items() if k in Delivery.model_fields and v is not None}

    key = audition_cache_key(voice_id, text, delivery)
    async with _AUDITION_LOCK:
        hit = _AUDITION_CACHE.get(key)
    if hit is not None:
        audition_cache_hits += 1
        return Response(content=hit[0], media_type=hit[1])

    req = GenerateRequest(
        voice=voice_id, text=text, delivery=Delivery(**delivery) if delivery else None
    )

    async def _render() -> Response:
        # Routing lives in _resolve_audition_target — ONE door shared with
        # GET /preview/stream (factored 2026-08-19, behaviour unchanged).
        kind, engine_id, voice_fields = _resolve_audition_target(voice_id, auto_load)
        if kind == "managed":
            return await _generate_via_manager(engine_id, req, voice_fields=voice_fields)
        return _generate_via_inprocess(engine_id, req)

    resp = await _render()
    if resp.body:
        async with _AUDITION_LOCK:
            _AUDITION_CACHE[key] = (bytes(resp.body), resp.media_type or "audio/wav")
    return resp
