# SPDX-License-Identifier: GPL-3.0-or-later
"""/v1/captures — the dictation pipeline's HTTP surface.

Flow (shape follows voicebox's captures route, adapted to JustVoice's
engine-pool architecture — see /voicebox-pin.txt for the reference):

    webview records WAV → POST /v1/captures (multipart)
        → audio saved under $DATA_DIR/captures/<id>.<ext>
        → Whisper (KIND="stt" managed engine) transcribes
        → Capture row persisted (raw_transcript)
    POST /v1/captures/{id}/refine → pinned LLM cleans the transcript
    POST /v1/captures/{id}/retranscribe → fresh STT pass (new size/lang)
    GET  /v1/captures/{id}/audio → original audio playback

When no STT engine is loaded, POST /v1/captures kicks off a background
Whisper load (using settings.captures.stt_model) and returns 503 with
`loading: true` so the UI can show progress and retry.
"""

from __future__ import annotations

import json
import logging
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..app_state import get_state
from ..database import get_db
from ..database.models import Capture
from ..engines.llm.dispatch import LLMNotConfiguredError
from ..engines.manager import get_manager
from ..errors import not_found
from ..refinement import RefinementFlags, refine_transcript

log = logging.getLogger(__name__)

router = APIRouter(tags=["captures"])

UPLOAD_CHUNK_SIZE = 1024 * 1024
VALID_SOURCES = {"dictation", "recording", "file", "mic", "system_audio", "upload"}
ALLOWED_SUFFIXES = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".webm"}

# One background whisper load at a time.
_stt_load_lock = threading.Lock()
_stt_loading = False


def _captures_dir() -> Path:
    d = get_state().data_dir / "captures"
    d.mkdir(parents=True, exist_ok=True)
    return d


class RefinementFlagsModel(BaseModel):
    smart_cleanup: bool = True
    self_correction: bool = True
    preserve_technical: bool = True


class CaptureResponse(BaseModel):
    id: str
    audio_path: str
    source: str
    language: Optional[str]
    duration_ms: Optional[int]
    transcript: Optional[str]
    raw_transcript: Optional[str]
    refinement_flags: Optional[RefinementFlagsModel] = None
    created_at: datetime

    class Config:
        from_attributes = True


class CaptureList(BaseModel):
    captures: list[CaptureResponse]
    total: int


class CaptureRefineRequest(BaseModel):
    flags: Optional[RefinementFlagsModel] = None


class CaptureRetranscribeRequest(BaseModel):
    model: Optional[str] = None
    language: Optional[str] = None


def _to_response(row: Capture) -> CaptureResponse:
    flags = None
    if row.refinement_flags_json:
        try:
            flags = RefinementFlagsModel(**json.loads(row.refinement_flags_json))
        except (ValueError, TypeError):
            flags = None
    return CaptureResponse(
        id=row.id,
        audio_path=row.audio_path,
        source=row.source,
        language=row.language,
        duration_ms=row.duration_ms,
        transcript=row.transcript,
        raw_transcript=row.raw_transcript,
        refinement_flags=flags,
        created_at=row.created_at,
    )


def _wav_duration_ms(data: bytes) -> int | None:
    try:
        from ..audio.wav import parse_wav_header

        fmt, _offset, _size = parse_wav_header(data)
        return int(fmt.duration_sec * 1000)
    except Exception:
        return None


def _resolve_stt_provider():
    """The active STT route (plan D4): None → local Whisper; otherwise the
    matching engines.external_stt entry. Unknown id → 422 with a pointer
    at the Engines → STT tab."""
    settings = get_state().settings.get()
    provider_id = getattr(settings.captures, "stt_provider", "local-whisper")
    if not provider_id or provider_id == "local-whisper":
        return None
    for cfg in getattr(settings.engines, "external_stt", []):
        if cfg.id == provider_id:
            return cfg
    raise HTTPException(
        status_code=422,
        detail=(
            f"captures.stt_provider points at unknown STT provider {provider_id!r}. "
            "Register it on the Engines → STT tab or switch back to Local Whisper."
        ),
    )


async def _transcribe(audio_path: str, language: str | None) -> str:
    """One dispatcher for both transcription call sites: local Whisper
    (existing load-gate + manager path) or an online provider (no local
    model involved at all)."""
    import asyncio

    cfg = _resolve_stt_provider()
    if cfg is None:
        _ensure_stt_loaded()
        return await asyncio.to_thread(
            get_manager().transcribe, audio_path, language
        )
    from ..engines.stt_external import transcribe_external

    return await asyncio.to_thread(transcribe_external, cfg, audio_path, language)


def _ensure_stt_loaded() -> None:
    """Raise an HTTPException unless a KIND=stt engine is loaded.

    If Whisper exists in the catalog but isn't loaded, start a background
    load (first call downloads the model into the HF cache) and surface
    503 + loading:true so the client can poll and retry.
    """
    global _stt_loading
    mgr = get_manager()
    if mgr.loaded_for("stt") is not None:
        return
    if "whisper" not in mgr.manifests():
        raise HTTPException(
            status_code=409,
            detail="Whisper STT engine isn't available in the engine catalog.",
        )
    size = get_state().settings.get().captures.stt_model
    with _stt_load_lock:
        if not _stt_loading:
            _stt_loading = True

            def _load():
                global _stt_loading
                try:
                    mgr.load("whisper", device="auto", variant=size)
                except Exception as e:
                    log.warning("background whisper load failed: %s", e)
                finally:
                    _stt_loading = False

            threading.Thread(target=_load, name="whisper-load", daemon=True).start()
    raise HTTPException(
        status_code=503,
        detail={
            "message": f"Whisper ({size}) is loading — first run downloads the model. Retry shortly.",
            "loading": True,
        },
    )


@router.post("/v1/captures", response_model=CaptureResponse)
async def create_capture(
    file: UploadFile = File(...),
    source: str = Form("recording"),
    language: str | None = Form(None),
    db: Session = Depends(get_db),
):
    """Upload audio, run STT, persist the capture."""
    if source not in VALID_SOURCES:
        raise HTTPException(status_code=400, detail=f"invalid source {source!r}")
    chunks = []
    while chunk := await file.read(UPLOAD_CHUNK_SIZE):
        chunks.append(chunk)
    audio_bytes = b"".join(chunks)
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="uploaded file is empty")

    settings = get_state().settings.get().captures
    resolved_language = language if language is not None else settings.language
    if resolved_language == "auto":
        resolved_language = None

    capture_id = uuid.uuid4().hex
    suffix = Path(file.filename or "capture.wav").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        suffix = ".wav"
    audio_path = _captures_dir() / f"{capture_id}{suffix}"
    audio_path.write_bytes(audio_bytes)

    try:
        transcript = await _transcribe(str(audio_path), resolved_language)
    except HTTPException:
        audio_path.unlink(missing_ok=True)
        raise
    except Exception as e:
        audio_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"transcription failed: {e}")

    row = Capture(
        id=capture_id,
        audio_path=str(audio_path),
        source=source,
        language=resolved_language,
        duration_ms=_wav_duration_ms(audio_bytes) if suffix == ".wav" else None,
        raw_transcript=transcript,
        transcript=transcript,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    # Auto-refine when configured and an LLM is wired. Failure is
    # non-fatal — the raw transcript is already persisted.
    if settings.auto_refine and transcript.strip():
        try:
            flags = RefinementFlags(
                smart_cleanup=settings.smart_cleanup,
                self_correction=settings.self_correction,
                preserve_technical=settings.preserve_technical,
            )
            refined, _model = await refine_transcript(transcript, flags)
            row.transcript = refined
            row.refinement_flags_json = json.dumps(flags.to_dict())
            db.commit()
            db.refresh(row)
        except LLMNotConfiguredError:
            pass
        except Exception as e:
            log.warning("auto-refine failed for capture %s: %s", capture_id, e)

    return _to_response(row)


@router.get("/v1/captures", response_model=CaptureList)
async def list_captures(limit: int = 100, db: Session = Depends(get_db)) -> CaptureList:
    total = db.query(Capture).count()
    rows = (
        db.query(Capture)
        .order_by(Capture.created_at.desc())
        .limit(max(1, min(500, limit)))
        .all()
    )
    return CaptureList(captures=[_to_response(r) for r in rows], total=total)


@router.get("/v1/captures/{capture_id}/audio")
async def get_capture_audio(capture_id: str, db: Session = Depends(get_db)):
    row = db.query(Capture).filter(Capture.id == capture_id).first()
    if not row:
        raise not_found(f"capture {capture_id}")
    path = Path(row.audio_path)
    if not path.exists():
        raise not_found(f"audio for capture {capture_id}")
    return FileResponse(path, media_type="audio/wav", filename=f"capture_{capture_id}{path.suffix}")


@router.post("/v1/captures/{capture_id}/refine", response_model=CaptureResponse)
async def refine_capture(
    capture_id: str,
    body: CaptureRefineRequest,
    db: Session = Depends(get_db),
):
    row = db.query(Capture).filter(Capture.id == capture_id).first()
    if not row:
        raise not_found(f"capture {capture_id}")
    if not (row.raw_transcript or "").strip():
        raise HTTPException(status_code=400, detail="capture has no transcript to refine")

    settings = get_state().settings.get().captures
    if body.flags is not None:
        flags = RefinementFlags(**body.flags.model_dump())
    else:
        flags = RefinementFlags(
            smart_cleanup=settings.smart_cleanup,
            self_correction=settings.self_correction,
            preserve_technical=settings.preserve_technical,
        )

    try:
        refined, _model = await refine_transcript(row.raw_transcript, flags)
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"refinement failed: {e}")

    row.transcript = refined
    row.refinement_flags_json = json.dumps(flags.to_dict())
    db.commit()
    db.refresh(row)
    return _to_response(row)


@router.post("/v1/captures/{capture_id}/retranscribe", response_model=CaptureResponse)
async def retranscribe_capture(
    capture_id: str,
    body: CaptureRetranscribeRequest,
    db: Session = Depends(get_db),
):
    row = db.query(Capture).filter(Capture.id == capture_id).first()
    if not row:
        raise not_found(f"capture {capture_id}")
    path = Path(row.audio_path)
    if not path.exists():
        raise HTTPException(status_code=410, detail=f"audio for capture {capture_id} is gone")

    language = body.language
    if language == "auto":
        language = None

    try:
        transcript = await _transcribe(str(path), language)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"transcription failed: {e}")

    row.raw_transcript = transcript
    # Refined text is stale after a fresh STT pass.
    row.transcript = transcript
    row.refinement_flags_json = None
    if language:
        row.language = language
    db.commit()
    db.refresh(row)
    return _to_response(row)


@router.delete("/v1/captures/{capture_id}")
async def delete_capture(capture_id: str, db: Session = Depends(get_db)) -> dict:
    row = db.query(Capture).filter(Capture.id == capture_id).first()
    if not row:
        raise not_found(f"capture {capture_id}")
    try:
        Path(row.audio_path).unlink(missing_ok=True)
    except OSError:
        pass
    db.delete(row)
    db.commit()
    return {"deleted": True, "id": capture_id}
