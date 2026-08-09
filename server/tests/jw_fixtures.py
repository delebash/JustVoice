# SPDX-License-Identifier: MIT
"""A JustWrite book — built the way JustWrite really exports one.

Every JustVoice test that imports "from JustWrite" builds its payload here, so
the JW→JV contract has ONE definition on this side. The shape mirrors
justwrite-app's `book_io.assemble()`: `parts[].chapters[]` for order, a `scenes`
map keyed by chapter id, and scene bodies of rich-editor HTML.

Before 2026-08-08 these fixtures used a `"schema": "justwrite/v1"` document that
JustWrite has never produced. The other half of this contract — a test on the
JustWrite side asserting it still emits these key paths — is recorded in
docs/dev/TASKS.md and not built.
"""

from __future__ import annotations

import io
import json
import zipfile
from typing import Any

Scene = dict[str, Any]
Chapter = tuple[str, str, list[Scene]]


def scene(scene_id: str, *paragraphs: str, title: str = "") -> Scene:
    """One JustWrite scene row. Its body is editor HTML — one `<p>` per
    paragraph, which is what the TipTap editor stores."""
    return {
        "id": scene_id,
        "title": title,
        "body": "".join(f"<p>{p}</p>" for p in paragraphs),
    }


def book_json(
    *,
    title: str = "Stillwater",
    author: str = "S. K. H.",
    premise: str = "",
    characters: list[dict[str, Any]] | None = None,
    chapters: list[Chapter] | None = None,
) -> dict[str, Any]:
    """A `book.json` snapshot. `chapters` is `[(id, title, [scene, ...]), ...]`."""
    if chapters is None:
        chapters = [("ch1", "One", [scene("scn1", "Hello.")])]
    if characters is None:
        characters = [
            {
                "id": "mara", "name": "Mara Vance", "main": True, "age": 34,
                "gender": "female", "pronouns": "she/her", "aliases": [],
                "lifeStatus": "alive", "oneLiner": "", "role": "", "tags": [],
            }
        ]
    return {
        "project": {
            "title": title, "author": author, "subtitle": "", "genre": "",
            "wordsGoal": 0, "dailyTarget": 0, "wordsWritten": 0,
            "startedOn": "", "deadline": "", "premise": premise,
            "coverImage": None,
        },
        "parts": [
            {
                "id": "part1",
                "title": "Part One",
                "chapters": [
                    {
                        "id": chapter_id, "num": i + 1, "title": chapter_title,
                        "words": 0, "status": "done", "strands": [],
                    }
                    for i, (chapter_id, chapter_title, _scenes) in enumerate(chapters)
                ],
            }
        ],
        "scenes": {chapter_id: scenes for chapter_id, _title, scenes in chapters},
        "characters": characters,
        # The planning data JustVoice ignores, present so tests can prove it is
        # ignored rather than assuming a minimal payload.
        "characterExtras": {}, "locations": [], "objects": [], "groups": [],
        "notes": [], "strands": [], "architecture": {}, "worldbuilding": [],
        "worldbuildingCategories": [], "tagVocabularies": {}, "images": {},
        "events": {}, "statuses": [], "trash": {}, "voiceCanonChapterIds": [],
        "worldRules": "", "savedAt": "2026-08-08T00:00:00Z",
    }


def book_zip(
    snapshot: dict[str, Any] | None = None,
    *,
    folder: str = "Stillwater",
    images: dict[str, bytes] | None = None,
) -> bytes:
    """The bytes JustWrite's export writes: `<folder>/book.json` next to a
    `<folder>/images/` folder."""
    snap = book_json() if snapshot is None else snapshot
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            f"{folder}/book.json", json.dumps(snap, ensure_ascii=False, indent=2)
        )
        for name, raw in (images or {}).items():
            zf.writestr(f"{folder}/images/{name}", raw)
    return buf.getvalue()
