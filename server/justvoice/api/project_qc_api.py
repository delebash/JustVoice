# SPDX-License-Identifier: GPL-3.0-or-later
"""/v1/projects/{id}/qc + /v1/projects/{id}/export_m4b — Phase 3 endpoints.

QC: per-chapter loudness report against the ACX bounds the analyzer can
measure (peak <= -3 dBFS true-peak proxy, RMS in [-23, -18] dBFS as an
RMS-dBFS approximation of the LUFS window, plus clipping). Noise floor
isn't measured yet — reported as "not measured", never silently passed.

M4B: assembles every scene's default takes (250 ms inter-block gap) into
one PCM stream per chapter, resamples to a common rate, writes chapter
markers (FFMETADATA), and shells out to ffmpeg for the AAC/M4B mux —
same shell-out pattern as mastering.py. 501 when ffmpeg is missing.
"""

from __future__ import annotations

import logging
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..audio.analyzer import analyze
from ..audio.wav import parse_wav_header, write_wav_container
from ..database import get_db
from ..database.models import Block, Generation, Project, Scene, Take
from ..errors import not_found
from ..mastering import have_ffmpeg

log = logging.getLogger(__name__)

router = APIRouter(tags=["projects"])

# ACX bounds (the analyzer measures dBFS, not LUFS — RMS dBFS is the
# standard proxy; the response labels it as such).
ACX_PEAK_MAX_DBFS = -3.0
ACX_RMS_MIN_DBFS = -23.0
ACX_RMS_MAX_DBFS = -18.0
INTER_BLOCK_SILENCE_MS = 250


class QcSceneRow(BaseModel):
    scene_id: str
    title: Optional[str]
    position: int
    blocks_total: int
    blocks_rendered: int
    duration_sec: float
    peak_dbfs: Optional[float]
    rms_dbfs: Optional[float]
    clipping_ratio: Optional[float]
    peak_ok: Optional[bool]
    rms_ok: Optional[bool]
    complete: bool


class QcReport(BaseModel):
    project_id: str
    project_name: str
    scenes: list[QcSceneRow]
    overall_pass: bool
    notes: list[str]


def _default_take_wavs(db: Session, scene_id: str) -> tuple[list[bytes], int, int]:
    """(wav_bytes_per_rendered_block, blocks_total, blocks_rendered)."""
    blocks = (
        db.query(Block)
        .filter(Block.scene_id == scene_id)
        .order_by(Block.position)
        .all()
    )
    wavs: list[bytes] = []
    rendered = 0
    for b in blocks:
        take = (
            db.query(Take)
            .filter(Take.block_id == b.id, Take.is_default == True)  # noqa: E712
            .first()
        )
        if not take:
            continue
        gen = db.query(Generation).filter(Generation.id == take.generation_id).first()
        if not gen or not gen.audio_path or not Path(gen.audio_path).exists():
            continue
        wavs.append(Path(gen.audio_path).read_bytes())
        rendered += 1
    return wavs, len(blocks), rendered


@router.get("/v1/projects/{project_id}/qc", response_model=QcReport)
async def project_qc(project_id: str, db: Session = Depends(get_db)) -> QcReport:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise not_found(f"project {project_id}")
    scenes = (
        db.query(Scene)
        .filter(Scene.project_id == project_id)
        .order_by(Scene.position)
        .all()
    )

    rows: list[QcSceneRow] = []
    for s in scenes:
        wavs, total, rendered = _default_take_wavs(db, s.id)
        peak = rms = clip = None
        duration = 0.0
        for w in wavs:
            try:
                a = analyze(w)
            except Exception:
                continue
            duration += a.format.duration_sec
            p = a.loudness.peak_dbfs
            r = a.loudness.rms_dbfs
            c = a.loudness.clipping_ratio
            peak = p if peak is None else max(peak, p)
            rms = r if rms is None else max(rms, r)  # report the LOUDEST block
            clip = c if clip is None else max(clip, c)
        rows.append(
            QcSceneRow(
                scene_id=s.id,
                title=s.title,
                position=s.position,
                blocks_total=total,
                blocks_rendered=rendered,
                duration_sec=round(duration, 2),
                peak_dbfs=round(peak, 2) if peak is not None else None,
                rms_dbfs=round(rms, 2) if rms is not None else None,
                clipping_ratio=clip,
                peak_ok=(peak <= ACX_PEAK_MAX_DBFS) if peak is not None else None,
                rms_ok=(ACX_RMS_MIN_DBFS <= rms <= ACX_RMS_MAX_DBFS) if rms is not None else None,
                complete=total > 0 and rendered == total,
            )
        )

    overall = bool(rows) and all(r.complete and r.peak_ok and r.rms_ok for r in rows)
    return QcReport(
        project_id=project_id,
        project_name=project.name,
        scenes=rows,
        overall_pass=overall,
        notes=[
            "Levels measured in dBFS (RMS as LUFS proxy). ACX bounds: peak <= -3 dB, RMS -23..-18 dB.",
            "Noise floor is not measured yet — verify <= -60 dB RMS externally before submission.",
            "Run chapters through the ACX mastering preset (Audio Tools) if a level check fails.",
        ],
    )


def _read_pcm(wav: bytes) -> tuple[np.ndarray, int]:
    """16-bit PCM WAV → (mono float32 array, sample_rate)."""
    fmt, offset, size = parse_wav_header(wav)
    pcm = np.frombuffer(wav[offset : offset + size], dtype="<i2").astype(np.float32) / 32767.0
    if fmt.channels > 1:
        pcm = pcm.reshape(-1, fmt.channels).mean(axis=1)
    return pcm, fmt.sample_rate


@router.get("/v1/projects/{project_id}/export_m4b")
async def export_m4b(project_id: str, db: Session = Depends(get_db)):
    if not have_ffmpeg():
        raise HTTPException(
            status_code=501,
            detail="M4B export needs ffmpeg on PATH — install it and retry.",
        )
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise not_found(f"project {project_id}")
    scenes = (
        db.query(Scene)
        .filter(Scene.project_id == project_id)
        .order_by(Scene.position)
        .all()
    )

    from scipy.signal import resample_poly

    target_sr = 44100
    chapters: list[tuple[str, np.ndarray]] = []
    for s in scenes:
        wavs, _total, rendered = _default_take_wavs(db, s.id)
        if not rendered:
            continue
        gap = np.zeros(int(target_sr * INTER_BLOCK_SILENCE_MS / 1000), dtype=np.float32)
        parts: list[np.ndarray] = []
        for w in wavs:
            pcm, sr = _read_pcm(w)
            if sr != target_sr:
                pcm = resample_poly(pcm, target_sr, sr).astype(np.float32)
            if parts:
                parts.append(gap)
            parts.append(pcm)
        chapters.append((s.title or f"Chapter {s.position + 1}", np.concatenate(parts)))

    if not chapters:
        raise HTTPException(
            status_code=409,
            detail="No rendered chapters — render blocks (with default takes) first.",
        )

    # One concatenated PCM stream + FFMETADATA chapter marks.
    meta_lines = [";FFMETADATA1", f"title={project.name}"]
    cursor_ms = 0
    full: list[np.ndarray] = []
    for title, pcm in chapters:
        dur_ms = int(len(pcm) / target_sr * 1000)
        meta_lines += [
            "[CHAPTER]",
            "TIMEBASE=1/1000",
            f"START={cursor_ms}",
            f"END={cursor_ms + dur_ms}",
            f"title={title}",
        ]
        cursor_ms += dur_ms
        full.append(pcm)
    pcm_all = np.concatenate(full)
    wav_all = write_wav_container(
        (np.clip(pcm_all, -1.0, 1.0) * 32767.0).astype("<i2").tobytes(), target_sr, 1
    )

    tmp = Path(tempfile.mkdtemp(prefix="jv-m4b-"))
    wav_path = tmp / "book.wav"
    meta_path = tmp / "chapters.txt"
    out_path = tmp / f"{project.name or 'audiobook'}.m4b".replace("/", "_")
    wav_path.write_bytes(wav_all)
    meta_path.write_text("\n".join(meta_lines), encoding="utf-8")

    cmd = [
        "ffmpeg", "-y",
        "-i", str(wav_path),
        "-i", str(meta_path),
        "-map_metadata", "1",
        "-c:a", "aac", "-b:a", "64k",
        "-f", "mp4",  # m4b is mp4 with an .m4b extension
        str(out_path),
    ]
    result = subprocess.run(cmd, capture_output=True, timeout=1800)
    if result.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=f"ffmpeg failed: {result.stderr.decode(errors='ignore')[-400:]}",
        )

    return FileResponse(
        out_path,
        media_type="audio/mp4",
        filename=out_path.name,
    )
