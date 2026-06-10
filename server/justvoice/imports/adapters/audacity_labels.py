# SPDX-License-Identifier: GPL-3.0-or-later
"""Audacity label-track import adapter.

Audacity exports label tracks as a tab-separated text file:

    0.000000\t4.250000\tFirst label text
    4.500000\t6.000000\tSecond label text

Two-column form (point labels) is also accepted:

    1.234567\tLabel text at this point

Each row becomes one line. Pause-after is the gap to the next label's
start, if known.
"""

from __future__ import annotations

import re

from ...errors import bad_request
from ..standard_schema import (
    StandardImport,
    StandardLine,
    StandardProject,
    StandardScene,
)

SOURCE_ID = "audacity_labels"

_FLOAT_RE = re.compile(r"^-?\d+(?:\.\d+)?$")


def _to_ms(s: str) -> int | None:
    if not _FLOAT_RE.match(s):
        return None
    return int(round(float(s) * 1000))


def parse(raw: bytes, *, filename: str | None = None) -> StandardImport:
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as e:
        raise bad_request(f"audacity_labels import: not valid UTF-8 ({e})") from e

    rows = [r for r in text.splitlines() if r.strip()]
    if not rows:
        raise bad_request("audacity_labels import: empty file")

    parsed: list[tuple[int | None, int | None, str]] = []
    for row_idx, row in enumerate(rows, start=1):
        cols = row.split("\t")
        # Audacity has the convention of two rows per region label (the
        # second carries frequency bounds prefixed with backslash); skip
        # rows whose first cell starts with "\".
        if cols and cols[0].startswith("\\"):
            continue
        if len(cols) >= 3:
            start = _to_ms(cols[0])
            end = _to_ms(cols[1])
            label = "\t".join(cols[2:]).strip()
        elif len(cols) == 2:
            start = _to_ms(cols[0])
            end = None
            label = cols[1].strip()
        else:
            continue
        if not label:
            continue
        parsed.append((start, end, label))

    if not parsed:
        raise bad_request("audacity_labels import: no label rows found")

    lines: list[StandardLine] = []
    for i, (start, end, label) in enumerate(parsed):
        pause_ms: int | None = None
        next_start = parsed[i + 1][0] if i + 1 < len(parsed) else None
        anchor = end if end is not None else start
        if next_start is not None and anchor is not None:
            gap = max(0, next_start - anchor)
            if gap > 0:
                pause_ms = gap
        lines.append(
            StandardLine(
                text=label,
                pause_after_ms=pause_ms,
                source_ref=f"label:{i + 1}",
            )
        )

    project_name = (filename or "Audacity labels").rsplit(".", 1)[0] or "Audacity labels"
    scene = StandardScene(id="labels", title=project_name, kind="label_track", lines=lines)
    return StandardImport(
        source=SOURCE_ID,
        project=StandardProject(name=project_name, kind="custom"),
        scenes=[scene],
    )
