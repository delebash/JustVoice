# SPDX-License-Identifier: MIT
"""CSV-lines import adapter.

Useful for game studios + podcasters who track dialogue in
spreadsheets. Expected columns (header row required, case-insensitive):

    scene,character,text,delivery,pause_after_ms

Only `text` is mandatory. `scene` groups rows into a StandardScene
(missing -> "default"). `delivery` is parsed as JSON if present, else
treated as a free-form instruct string.
"""

from __future__ import annotations

import csv
import io
import json
import re
from collections import OrderedDict

from ...errors import bad_request
from ..standard_schema import (
    StandardCharacter,
    StandardImport,
    StandardLine,
    StandardProject,
    StandardScene,
)

SOURCE_ID = "csv_lines"


def _slug(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")
    return s or "x"


def parse(raw: bytes, *, filename: str | None = None) -> StandardImport:
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as e:
        raise bad_request(f"csv_lines import: not valid UTF-8 ({e})") from e

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise bad_request("csv_lines import: no header row")
    headers = {h.strip().lower(): h for h in reader.fieldnames}
    if "text" not in headers:
        raise bad_request("csv_lines import: missing required 'text' column")

    def col(row: dict[str, str], key: str) -> str | None:
        h = headers.get(key)
        if h is None:
            return None
        v = row.get(h)
        return v.strip() if isinstance(v, str) and v.strip() else None

    scenes_by_id: OrderedDict[str, StandardScene] = OrderedDict()
    chars_by_id: OrderedDict[str, StandardCharacter] = OrderedDict()
    row_no = 1
    for row in reader:
        row_no += 1
        line_text = col(row, "text")
        if not line_text:
            continue

        scene_label = col(row, "scene") or "default"
        scene_id = _slug(scene_label)
        scene = scenes_by_id.get(scene_id)
        if scene is None:
            scene = StandardScene(id=scene_id, title=scene_label, kind="scene", lines=[])
            scenes_by_id[scene_id] = scene

        char_name = col(row, "character")
        char_id: str | None = None
        if char_name:
            char_id = _slug(char_name)
            if char_id not in chars_by_id:
                chars_by_id[char_id] = StandardCharacter(id=char_id, name=char_name)

        delivery_raw = col(row, "delivery")
        delivery_obj: dict | None = None
        if delivery_raw:
            try:
                parsed = json.loads(delivery_raw)
                if isinstance(parsed, dict):
                    delivery_obj = parsed
                else:
                    delivery_obj = {"instruct": delivery_raw}
            except json.JSONDecodeError:
                delivery_obj = {"instruct": delivery_raw}

        pause_raw = col(row, "pause_after_ms")
        pause_ms: int | None = None
        if pause_raw:
            try:
                pause_ms = int(pause_raw)
            except ValueError:
                pass

        # Stable line id — the game build consumes audio BY THIS ID, and
        # re-imports match rows on it (CONCEPTS §1/§3). Falls back to the
        # row number when the sheet has no id column.
        line_id = col(row, "id") or col(row, "line_id") or col(row, "dialogue_id")
        scene.lines.append(
            StandardLine(
                character_id=char_id,
                text=line_text,
                delivery=delivery_obj,
                pause_after_ms=pause_ms,
                source_ref=line_id or f"row:{row_no}",
            )
        )

    if not scenes_by_id:
        raise bad_request("csv_lines import: no data rows with text")

    project_name = (filename or "CSV import").rsplit(".", 1)[0] or "CSV import"
    return StandardImport(
        source=SOURCE_ID,
        project=StandardProject(name=project_name, kind="game_voicelines"),
        characters=list(chars_by_id.values()),
        scenes=list(scenes_by_id.values()),
    )
