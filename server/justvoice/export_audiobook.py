# SPDX-License-Identifier: GPL-3.0-or-later
"""Audiobook assembly — per-scene renders → ACX QC report / M4B export.

Replaces the BooksView toast stubs ("Export M4B", "QC report") with real
endpoints (mock #audiobook/7). Assembly reuses the production render
path (render_chapter's scene resolution + render_core), so the export
sounds exactly like the Studio Render tab's output.

Testability seams:
  - `assemble_project(state, project_id, render_scene_fn=…)` — tests
    inject a fake renderer returning synthetic WAVs.
  - `mux_m4b(...)` isolates the ffmpeg invocation; tests stub
    subprocess.run and assert the argv + FFMETADATA chapter file.
"""

from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from .audio.analyzer import analyze
from .database.models import Scene
from .database import session as db_session

log = logging.getLogger(__name__)

# ACX technical bounds (https://help.acx.com — submission requirements).
ACX_RMS_MIN_DB = -23.0
ACX_RMS_MAX_DB = -18.0
ACX_PEAK_MAX_DB = -3.0


@dataclass
class ChapterAudio:
    scene_id: str
    title: str
    wav: bytes
    duration_s: float


@dataclass
class ChapterQC:
    scene_id: str
    title: str
    duration_s: float
    rms_dbfs: float
    peak_dbfs: float
    rms_ok: bool
    peak_ok: bool

    @property
    def ok(self) -> bool:
        return self.rms_ok and self.peak_ok


def _wav_duration_s(wav: bytes) -> float:
    import io
    import wave

    with wave.open(io.BytesIO(wav), "rb") as r:
        frames = r.getnframes()
        rate = r.getframerate() or 1
        return frames / rate


def project_scenes(project_id: str) -> list[Scene]:
    db = db_session.SessionLocal()  # late-bound — survives test re-init
    try:
        return (
            db.query(Scene)
            .filter(Scene.project_id == project_id)
            .order_by(Scene.position)
            .all()
        )
    finally:
        db.close()


def assemble_project(state, project_id: str, *, render_scene_fn=None) -> list[ChapterAudio]:
    """Render every scene of the project to a mastered WAV, in order.

    `render_scene_fn(state, scene_id) -> bytes` defaults to the production
    chapter render; tests inject synthetic WAVs.
    """
    if render_scene_fn is None:
        from .api.render_chapter_api import render_scene_to_wav as render_scene_fn

    out: list[ChapterAudio] = []
    for scene in project_scenes(project_id):
        wav = render_scene_fn(state, scene.id)
        out.append(
            ChapterAudio(
                scene_id=scene.id,
                title=scene.title or f"Chapter {scene.position + 1}",
                wav=wav,
                duration_s=_wav_duration_s(wav),
            )
        )
    return out


def qc_report(chapters: list[ChapterAudio]) -> list[ChapterQC]:
    """ACX technical checks per chapter — RMS window + peak ceiling.

    Noise floor needs a room-tone span the synth pipeline doesn't have a
    locator for yet; tracked in IMPLEMENTATION_PLAN (Phase A backlog).
    """
    report: list[ChapterQC] = []
    for ch in chapters:
        a = analyze(ch.wav)
        rms = a.loudness.rms_dbfs
        peak = a.loudness.peak_dbfs
        report.append(
            ChapterQC(
                scene_id=ch.scene_id,
                title=ch.title,
                duration_s=round(ch.duration_s, 2),
                rms_dbfs=round(rms, 2),
                peak_dbfs=round(peak, 2),
                rms_ok=ACX_RMS_MIN_DB <= rms <= ACX_RMS_MAX_DB,
                peak_ok=peak <= ACX_PEAK_MAX_DB,
            )
        )
    return report


def build_ffmetadata(chapters: list[ChapterAudio], book_title: str, author: str | None) -> str:
    """FFMETADATA1 document with millisecond chapter markers."""
    lines = [";FFMETADATA1", f"title={book_title}"]
    if author:
        lines.append(f"artist={author}")
    t = 0
    for ch in chapters:
        start = int(t * 1000)
        t += ch.duration_s
        end = int(t * 1000)
        lines += [
            "",
            "[CHAPTER]",
            "TIMEBASE=1/1000",
            f"START={start}",
            f"END={end}",
            f"title={ch.title}",
        ]
    return "\n".join(lines) + "\n"


def have_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None


def mux_m4b(
    chapters: list[ChapterAudio],
    book_title: str,
    author: str | None,
    *,
    run=None,
) -> bytes:
    """Concat chapter WAVs → AAC in an .m4b container with chapter marks.

    One ffmpeg invocation: the wav inputs go through the concat demuxer,
    the FFMETADATA file supplies chapters, `-f ipod` is the m4b/m4a mux.
    """
    if not chapters:
        raise ValueError("nothing to export — no rendered chapters")
    if run is None:
        run = subprocess.run  # call-time bind so test monkeypatches apply
    with tempfile.TemporaryDirectory(prefix="jv-m4b-") as td:
        tdir = Path(td)
        concat_lines = []
        for i, ch in enumerate(chapters):
            p = tdir / f"ch{i:03d}.wav"
            p.write_bytes(ch.wav)
            concat_lines.append(f"file '{p}'")
        (tdir / "concat.txt").write_text("\n".join(concat_lines) + "\n", encoding="utf-8")
        (tdir / "chapters.txt").write_text(
            build_ffmetadata(chapters, book_title, author), encoding="utf-8"
        )
        out = tdir / "book.m4b"
        argv = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "concat", "-safe", "0", "-i", str(tdir / "concat.txt"),
            "-i", str(tdir / "chapters.txt"),
            "-map_metadata", "1",
            "-c:a", "aac", "-b:a", "128k",
            "-f", "ipod", str(out),
        ]
        proc = run(argv, capture_output=True)
        if proc.returncode != 0:
            stderr = getattr(proc, "stderr", b"") or b""
            raise RuntimeError(f"ffmpeg failed: {stderr.decode(errors='replace')[:400]}")
        return out.read_bytes()
