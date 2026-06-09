# SPDX-License-Identifier: GPL-3.0-or-later
"""SRT subtitle import adapter.

Parses SubRip (.srt) cue blocks of the form:

    1
    00:00:01,000 --> 00:00:04,000
    Sometimes a speaker tag is prefixed.
    NARRATOR: This is the line.

    2
    00:00:05,500 --> 00:00:08,000
    Another line.

Each cue becomes one StandardLine. If a "NAME:" prefix is present at
the start of the text the name is lifted into a StandardCharacter and
stripped from the line. All cues go into a single StandardScene.
"""

from __future__ import annotations

import re

from ...errors import bad_request
from ..standard_schema import (
    StandardCharacter,
    StandardImport,
    StandardLine,
    StandardProject,
    StandardScene,
)

SOURCE_ID = "srt"

_TIMECODE_RE = re.compile(
    r"(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*"
    r"(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})"
)
_SPEAKER_RE = re.compile(r"^\s*([A-Z][A-Z0-9 _'\-]{0,40})\s*:\s*(.+)$")


def _tc_to_ms(h: str, m: str, s: str, ms: str) -> int:
    return (int(h) * 3600 + int(m) * 60 + int(s)) * 1000 + int(ms.ljust(3, "0")[:3])


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "x"


def parse(raw: bytes, *, filename: str | None = None) -> StandardImport:
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as e:
        raise bad_request(f"srt import: not valid UTF-8 ({e})") from e

    # Normalize line endings, split on blank-line boundaries.
    blocks = re.split(r"\r?\n\r?\n+", text.strip())
    chars: dict[str, StandardCharacter] = {}
    lines: list[StandardLine] = []
    end_prev_ms: int | None = None

    for block in blocks:
        rows = [r for r in block.splitlines() if r.strip()]
        if len(rows) < 2:
            continue
        # First row is the cue index (optional). Find the timecode row.
        tc_row_idx = 0 if _TIMECODE_RE.search(rows[0]) else (1 if _TIMECODE_RE.search(rows[1] if len(rows) > 1 else "") else None)
        if tc_row_idx is None:
            continue
        match = _TIMECODE_RE.search(rows[tc_row_idx])
        if not match:
            continue
        start_ms = _tc_to_ms(*match.group(1, 2, 3, 4))
        end_ms = _tc_to_ms(*match.group(5, 6, 7, 8))
        body = "\n".join(rows[tc_row_idx + 1:]).strip()
        if not body:
            continue

        char_id: str | None = None
        sp = _SPEAKER_RE.match(body)
        if sp:
            speaker = sp.group(1).strip()
            char_id = _slug(speaker)
            if char_id not in chars:
                chars[char_id] = StandardCharacter(id=char_id, name=speaker.title())
            body = sp.group(2).strip()

        # `pause_after_ms` on the PREVIOUS line is the gap between the
        # last cue's end and this cue's start.
        if end_prev_ms is not None and lines:
            gap = max(0, start_ms - end_prev_ms)
            if gap > 0:
                lines[-1].pause_after_ms = gap
        end_prev_ms = end_ms

        lines.append(
            StandardLine(
                character_id=char_id,
                text=body,
                source_ref=f"srt:{start_ms}-{end_ms}",
            )
        )

    if not lines:
        raise bad_request("srt import: no cues found")

    project_name = (filename or "SRT import").rsplit(".", 1)[0] or "SRT import"
    scene = StandardScene(id="srt", title=project_name, kind="cue_sheet", lines=lines)
    return StandardImport(
        source=SOURCE_ID,
        project=StandardProject(name=project_name, kind="custom"),
        characters=list(chars.values()),
        scenes=[scene],
    )
