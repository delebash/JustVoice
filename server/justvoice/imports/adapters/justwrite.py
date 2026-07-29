# SPDX-License-Identifier: MIT
"""JustWrite manuscript import adapter.

JustWrite exports a manuscript as a single JSON document that pins the
JustWrite↔JustVoice boundary (see CONTRACT.md). The expected shape:

    {
      "schema": "justwrite/v1",
      "book": { "title": str, "author": str, "language": str,
                "description": str | null },
      "characters": [ { "id": str, "name": str, "voice_hint": str | null,
                        "notes": str | null }, ... ],
      "chapters": [
        { "id": str, "title": str | null,
          "lines": [ { "character_id": str | null,
                       "text": str,
                       "delivery": dict | null,
                       "pause_after_ms": int | null }, ... ]
        }, ...
      ],
      "lexicon": [ { "grapheme": str, "phoneme_ipa": str | null,
                     "alias": str | null }, ... ]
    }

This is the load-bearing adapter — the rest of JustWrite's automation
assumes this shape. Any change here must preserve the existing field
mapping.
"""

from __future__ import annotations

import json
from typing import Any

from ...errors import bad_request
from ..standard_schema import (
    StandardCharacter,
    StandardImport,
    StandardLexiconEntry,
    StandardLine,
    StandardProject,
    StandardScene,
)

SOURCE_ID = "justwrite"


def parse(raw: bytes, *, filename: str | None = None) -> StandardImport:
    try:
        doc: dict[str, Any] = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise bad_request(f"justwrite import: not valid UTF-8 JSON ({e})") from e

    if not isinstance(doc, dict):
        raise bad_request("justwrite import: top-level must be a JSON object")

    book = doc.get("book") or {}
    if not isinstance(book, dict) or not book.get("title"):
        raise bad_request("justwrite import: missing book.title")

    project = StandardProject(
        name=str(book.get("title")),
        kind="audiobook",
        description=book.get("description"),
        language=book.get("language") or "en-US",
    )

    characters = [
        StandardCharacter(
            id=str(c["id"]),
            name=str(c.get("name") or c["id"]),
            voice_hint=c.get("voice_hint"),
            notes=c.get("notes"),
        )
        for c in (doc.get("characters") or [])
        if isinstance(c, dict) and c.get("id")
    ]

    scenes: list[StandardScene] = []
    for idx, ch in enumerate(doc.get("chapters") or []):
        if not isinstance(ch, dict):
            continue
        scene = StandardScene(
            id=str(ch.get("id") or f"chapter-{idx + 1}"),
            title=ch.get("title"),
            kind="chapter",
            lines=[
                StandardLine(
                    character_id=line.get("character_id"),
                    text=str(line.get("text") or ""),
                    delivery=line.get("delivery"),
                    pause_after_ms=line.get("pause_after_ms"),
                    source_ref=f"chapter:{ch.get('id') or idx + 1}#line:{li}",
                )
                for li, line in enumerate(ch.get("lines") or [])
                if isinstance(line, dict) and line.get("text")
            ],
        )
        scenes.append(scene)

    lexicon = [
        StandardLexiconEntry(
            grapheme=str(e["grapheme"]),
            phoneme_ipa=e.get("phoneme_ipa"),
            alias=e.get("alias"),
        )
        for e in (doc.get("lexicon") or [])
        if isinstance(e, dict) and e.get("grapheme")
    ]

    return StandardImport(
        source=SOURCE_ID,
        project=project,
        characters=characters,
        scenes=scenes,
        lexicon_entries=lexicon,
    )
