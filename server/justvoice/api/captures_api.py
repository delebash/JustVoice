# SPDX-License-Identifier: MIT
#
# Route surface adapted from voicebox (MIT) — backend/routes/captures.py +
# routes/transcription.py at the commit pinned in voicebox-pin.txt,
# rewritten on JustVoice's managed-engine architecture (Whisper runs in
# the stt-slot subprocess; refinement routes through the LLM provider
# dispatch). Original copyright (c) the voicebox authors.
"""/v1/captures + /v1/transcribe — the dictation backend (parity gaps
G1/G2). The desktop hotkey records audio and POSTs it here; headless
callers upload files. The Capture row stores BOTH the raw Whisper output
and the post-refinement transcript so the UI can toggle between them.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..app_state import get_state
from ..database import get_db
from ..database.models import Capture
from ..errors import bad_request, not_found
from ..media_paths import media_file, store_media_path
from ..refinement import RefinementFlags, refine_transcript

log = logging.getLogger(__name__)

router = APIRouter(tags=["captures"])

_UPLOAD_CHUNK = 1024 * 1024
_MAX_UPLOAD_MB = 200


def _captures_dir() -> Path:
    d = get_state().data_dir / "captures"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _stt_transcribe(audio_path: str, language: str | None) -> str:
    """Transcribe via the stt-slot engine; auto-load whisper if installed."""
    from ..engines.manager import get_manager

    mgr = get_manager()
    settings = get_state().settings.get()
    if mgr.loaded_for("stt") is None:
        status = mgr.status("whisper")
        if status == "installed":
            log.info("captures: auto-loading whisper (%s) on first use", settings.captures.stt_model)
            mgr.load("whisper", device="auto", variant=settings.captures.stt_model)
        else:
            raise bad_request(
                f"STT engine 'whisper' is {status} — install it on the Engines tab first"
            )
    lang = language or settings.captures.language
    return mgr.transcribe(
        {"audio_path": audio_path, "language": None if lang in ("", "auto") else lang}
    )


def _maybe_refine(raw: str, flags: RefinementFlags) -> tuple[str | None, str | None]:
    """Refine if a provider is available. Returns (refined, model) or
    (None, None) — refinement failure never loses the raw transcript."""
    try:
        settings = get_state().settings.get()
        refined, model = refine_transcript(raw, flags, settings=settings)
        return refined, model
    except Exception as e:
        log.warning("captures: refinement skipped: %s", e)
        return None, None


class CaptureRow(BaseModel):
    id: str
    source: str
    language: Optional[str]
    duration_ms: Optional[int]
    transcript: Optional[str]
    raw_transcript: Optional[str]
    refinement_flags: dict
    audio_url: str
    pinned: bool = False
    created_at: datetime


class CaptureList(BaseModel):
    captures: list[CaptureRow]
    total: int


def _row(c: Capture) -> CaptureRow:
    return CaptureRow(
        id=c.id,
        source=c.source,
        language=c.language,
        duration_ms=c.duration_ms,
        transcript=c.transcript,
        raw_transcript=c.raw_transcript,
        refinement_flags=json.loads(c.refinement_flags_json) if c.refinement_flags_json else {},
        audio_url=f"/v1/captures/{c.id}/audio",
        pinned=bool(c.pinned),
        created_at=c.created_at,
    )


class UpdateCaptureRequest(BaseModel):
    pinned: Optional[bool] = None


@router.patch("/v1/captures/{capture_id}", response_model=CaptureRow)
async def update_capture(
    capture_id: str, body: UpdateCaptureRequest, db: Session = Depends(get_db)
) -> CaptureRow:
    """Pin/unpin (parity: the journeys mock pins repeated phrases)."""
    c = db.query(Capture).filter(Capture.id == capture_id).first()
    if not c:
        raise not_found(f"capture {capture_id}")
    if body.pinned is not None:
        c.pinned = body.pinned
    db.commit()
    db.refresh(c)
    return _row(c)


@router.post("/v1/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: str | None = Form(None),
) -> dict:
    """Stateless transcription — upload audio, get text. No Capture row."""
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        total = 0
        while chunk := await file.read(_UPLOAD_CHUNK):
            total += len(chunk)
            if total > _MAX_UPLOAD_MB * 1024 * 1024:
                raise bad_request(f"upload exceeds {_MAX_UPLOAD_MB} MB")
            tmp.write(chunk)
        tmp_path = Path(tmp.name)
    try:
        text = _stt_transcribe(str(tmp_path), language)
        return {"text": text, "language": language}
    finally:
        tmp_path.unlink(missing_ok=True)


@router.post("/v1/captures", response_model=CaptureRow, status_code=201)
async def create_capture(
    file: UploadFile = File(...),
    source: str = Form("upload"),
    language: str | None = Form(None),
    db: Session = Depends(get_db),
) -> CaptureRow:
    """Upload a recording → transcribe → (optionally) refine → persist."""
    if source not in ("mic", "system_audio", "upload"):
        raise bad_request("source must be mic | system_audio | upload")

    capture = Capture(audio_path="", source=source, language=language)
    db.add(capture)
    db.flush()

    dest = _captures_dir() / f"{capture.id}.wav"
    total = 0
    with dest.open("wb") as out:
        while chunk := await file.read(_UPLOAD_CHUNK):
            total += len(chunk)
            if total > _MAX_UPLOAD_MB * 1024 * 1024:
                dest.unlink(missing_ok=True)
                raise bad_request(f"upload exceeds {_MAX_UPLOAD_MB} MB")
            out.write(chunk)
    # Stored RELATIVE to the data root so a Change-folder move doesn't
    # orphan the file (see media_paths).
    capture.audio_path = store_media_path(dest)

    raw = _stt_transcribe(str(dest), language)
    capture.raw_transcript = raw

    settings = get_state().settings.get()
    flags = RefinementFlags(
        smart_cleanup=settings.captures.smart_cleanup,
        self_correction=settings.captures.self_correction,
        preserve_technical=settings.captures.preserve_technical,
    )
    capture.refinement_flags_json = json.dumps(flags.to_dict())
    if settings.captures.auto_refine:
        refined, _model = _maybe_refine(raw, flags)
        capture.transcript = refined if refined is not None else raw
    else:
        capture.transcript = raw

    db.commit()
    db.refresh(capture)
    return _row(capture)


@router.get("/v1/captures", response_model=CaptureList)
async def list_captures(
    limit: int = 50, offset: int = 0, db: Session = Depends(get_db)
) -> CaptureList:
    q = db.query(Capture).order_by(Capture.created_at.desc())
    total = q.count()
    rows = q.offset(max(0, offset)).limit(max(1, min(200, limit))).all()
    return CaptureList(captures=[_row(c) for c in rows], total=total)


@router.get("/v1/captures/{capture_id}", response_model=CaptureRow)
async def get_capture(capture_id: str, db: Session = Depends(get_db)) -> CaptureRow:
    c = db.query(Capture).filter(Capture.id == capture_id).first()
    if not c:
        raise not_found(f"capture {capture_id}")
    return _row(c)


@router.get("/v1/captures/{capture_id}/audio")
async def get_capture_audio(capture_id: str, db: Session = Depends(get_db)) -> FileResponse:
    c = db.query(Capture).filter(Capture.id == capture_id).first()
    if not c:
        raise not_found(f"capture {capture_id}")
    p = media_file(c.audio_path)
    if not p.is_file():
        raise not_found(f"audio missing from disk: {c.audio_path}")
    return FileResponse(path=str(p), media_type="audio/wav", filename=f"{capture_id}.wav")


@router.delete("/v1/captures/{capture_id}")
async def delete_capture(capture_id: str, db: Session = Depends(get_db)) -> dict:
    c = db.query(Capture).filter(Capture.id == capture_id).first()
    if not c:
        raise not_found(f"capture {capture_id}")
    if c.audio_path:
        media_file(c.audio_path).unlink(missing_ok=True)
    db.delete(c)
    db.commit()
    return {"deleted": True}


class RefineBody(BaseModel):
    smart_cleanup: bool | None = None
    self_correction: bool | None = None
    preserve_technical: bool | None = None


@router.post("/v1/captures/{capture_id}/refine", response_model=CaptureRow)
async def refine_capture(
    capture_id: str, body: RefineBody, db: Session = Depends(get_db)
) -> CaptureRow:
    """Re-run refinement on the stored RAW transcript with (possibly new)
    flags. The raw transcript is never overwritten."""
    c = db.query(Capture).filter(Capture.id == capture_id).first()
    if not c:
        raise not_found(f"capture {capture_id}")
    if not c.raw_transcript:
        raise bad_request("capture has no raw transcript to refine")

    settings = get_state().settings.get()
    prev = RefinementFlags.from_dict(
        json.loads(c.refinement_flags_json) if c.refinement_flags_json else None
    )
    flags = RefinementFlags(
        smart_cleanup=prev.smart_cleanup if body.smart_cleanup is None else body.smart_cleanup,
        self_correction=prev.self_correction if body.self_correction is None else body.self_correction,
        preserve_technical=(
            prev.preserve_technical if body.preserve_technical is None else body.preserve_technical
        ),
    )
    refined, _model = refine_transcript(c.raw_transcript, flags, settings=settings)
    c.transcript = refined
    c.refinement_flags_json = json.dumps(flags.to_dict())
    db.commit()
    db.refresh(c)
    return _row(c)


@router.post("/v1/captures/{capture_id}/retranscribe", response_model=CaptureRow)
async def retranscribe_capture(
    capture_id: str, language: str | None = None, db: Session = Depends(get_db)
) -> CaptureRow:
    """Re-run STT on the stored audio (e.g. after switching Whisper sizes),
    then re-apply the capture's refinement flags."""
    c = db.query(Capture).filter(Capture.id == capture_id).first()
    if not c:
        raise not_found(f"capture {capture_id}")
    if not c.audio_path or not media_file(c.audio_path).is_file():
        raise bad_request("capture audio missing from disk")

    raw = _stt_transcribe(str(media_file(c.audio_path)), language or c.language)
    c.raw_transcript = raw
    flags = RefinementFlags.from_dict(
        json.loads(c.refinement_flags_json) if c.refinement_flags_json else None
    )
    settings = get_state().settings.get()
    if settings.captures.auto_refine:
        refined, _model = _maybe_refine(raw, flags)
        c.transcript = refined if refined is not None else raw
    else:
        c.transcript = raw
    db.commit()
    db.refresh(c)
    return _row(c)
