# SPDX-License-Identifier: GPL-3.0-or-later
"""/v1/logs — tail + download of the server's rotating log file.

The file handler is attached in create_app() (data_dir/logs/justvoice.log)
so headless and Tauri-sidecar boots both produce the same file the
Settings → Logs panel reads.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from ..app_state import get_state

router = APIRouter(tags=["logs"])


def log_file_path(data_dir: Path) -> Path:
    return data_dir / "logs" / "justvoice.log"


class LogTailResponse(BaseModel):
    text: str
    path: str


@router.get("/v1/logs/tail", response_model=LogTailResponse, summary="Last N log lines")
async def tail_logs(lines: int = 80) -> LogTailResponse:
    path = log_file_path(get_state().data_dir)
    if not path.is_file():
        return LogTailResponse(text="", path=str(path))
    lines = max(1, min(2000, lines))
    # Logs rotate at a few MB — reading the whole file and slicing is fine.
    content = path.read_text(encoding="utf-8", errors="replace").splitlines()
    return LogTailResponse(text="\n".join(content[-lines:]), path=str(path))


def _filter_by_hours(raw_lines: list[str], hours: int) -> list[str]:
    """Keep lines newer than the cutoff. Lines without a parseable leading
    timestamp (tracebacks, continuations) follow the preceding line's fate
    so multi-line entries stay intact.
    """
    cutoff = datetime.now() - timedelta(hours=hours)
    out: list[str] = []
    keeping = True
    for line in raw_lines:
        ts = line[:19]  # "%(asctime)s" prefix — "YYYY-MM-DD HH:MM:SS"
        try:
            keeping = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S") >= cutoff
        except ValueError:
            pass  # continuation line — inherit `keeping`
        if keeping:
            out.append(line)
    return out


@router.get("/v1/logs/download", summary="Download recent log lines as text/plain")
async def download_logs(hours: int = 24) -> PlainTextResponse:
    path = log_file_path(get_state().data_dir)
    text = ""
    if path.is_file():
        raw = path.read_text(encoding="utf-8", errors="replace").splitlines()
        text = "\n".join(_filter_by_hours(raw, max(1, min(24 * 30, hours))))
    stamp = datetime.now().strftime("%Y-%m-%d")
    return PlainTextResponse(
        text,
        headers={"Content-Disposition": f'attachment; filename="justvoice-logs-{stamp}.txt"'},
    )
