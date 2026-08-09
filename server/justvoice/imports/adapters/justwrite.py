# SPDX-License-Identifier: MIT
"""JustWrite book import adapter — the `.zip` JustWrite actually exports.

JustWrite exports a book as `<Title>.zip`, unzipping to `<Title>/book.json`
plus a `<Title>/images/` folder (justwrite-app `api/book_transfer_api.py`).
The zip exists only to carry image FILES, because their bytes live in
JustWrite's database as rows whose ids are local to one machine; the content
contract is `book.json`, the snapshot JustWrite's `book_io.assemble()` emits:

    {
      "project":    {"title", "author", "subtitle", "genre", "premise", ...},
      "parts":      [{"id", "title", "chapters": [{"id", "num", "title", ...}]}],
      "scenes":     {"<chapterId>": [{"id", "title", "body"}]},
      "characters": [{"id", "name", "gender", "age", "pronouns", "role",
                      "oneLiner", "aliases", ...}],
      ...plus JustWrite planning data JustVoice ignores: strands, notes,
      worldbuilding, statuses, events, AI artifacts, trash.
    }

A scene `body` is rich-editor HTML (TipTap StarterKit), one row per scene. The
`* * *` a reader sees BETWEEN scenes is generated at display time by
JustWrite's renderer (`stores/project.js` chapterBody) and is never stored, so
nothing here stitches chapters or strips separators — this reads the scene rows
straight. A stray in-body `.scene-mark` paragraph is dropped by `skip_classes`
(JustWrite's seed data carries them, and a narrator must not read asterisks).

What JustVoice takes: chapter order and titles, the prose, and the character
roster (the reason to prefer this over the generic `book_prose` adapter). What
it cannot take is per-line speaker attribution — JustWrite does not compute it,
and `docs/dev/design-decisions.md` §3 puts attribution on this side — so lines
arrive speakerless and Script's Analyze discovers the speakers.

Before 2026-08-08 this adapter parsed a `"schema": "justwrite/v1"` document
that JustWrite has never produced; the string existed only inside two archived
plan docs. The zip is, and always was, the real handoff.
"""

from __future__ import annotations

import io
import json
import zipfile
from typing import Any

from ...errors import bad_request
from ..standard_schema import (
    StandardCharacter,
    StandardImport,
    StandardLine,
    StandardProject,
    StandardScene,
)
from .book_prose import html_blocks

SOURCE_ID = "justwrite"

# JustWrite's editor separator, when it survives inside a single scene's body.
_SKIP_CLASSES = frozenset({"scene-mark"})

# How many chapter names a warning lists before it summarizes the rest.
_WARN_NAME_CAP = 5


def _find_book_json(zf: zipfile.ZipFile) -> str | None:
    """`<folder>/book.json`, or a bare `book.json`. Shallowest match wins —
    mirrors JustWrite's own reader so a nested stray cannot hijack it."""
    names = [
        n
        for n in zf.namelist()
        if n == "book.json" or (n.endswith("/book.json") and n.count("/") == 1)
    ]
    return min(names, key=len) if names else None


def _read_book(raw: bytes) -> tuple[dict[str, Any], int]:
    """`(snapshot, ignored_image_count)` from the exported zip or a bare
    `book.json` (someone who unzipped it first). Zip detection is the `PK`
    magic, the same sniff `book_prose.parse` uses for EPUB/DOCX."""
    if raw[:2] == b"PK":
        try:
            zf = zipfile.ZipFile(io.BytesIO(raw))
        except zipfile.BadZipFile as e:
            raise bad_request(f"justwrite import: not a readable zip ({e})") from e
        with zf:
            name = _find_book_json(zf)
            if name is None:
                raise bad_request(
                    "justwrite import: this zip has no book.json — export ONE BOOK "
                    "from JustWrite, not a whole-server backup"
                )
            payload = zf.read(name)
            image_dir = name[: -len("book.json")] + "images/"
            images = sum(
                1
                for info in zf.infolist()
                if not info.is_dir() and info.filename.startswith(image_dir)
            )
    else:
        payload, images = raw, 0

    try:
        doc = json.loads(payload.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise bad_request(
            f"justwrite import: book.json is not valid UTF-8 JSON ({e})"
        ) from e
    if not isinstance(doc, dict):
        raise bad_request("justwrite import: book.json must be a JSON object")
    if "parts" not in doc and "scenes" not in doc:
        raise bad_request(
            "justwrite import: this is not a JustWrite book — expected 'parts' and "
            "'scenes'. A payload already in JustVoice's shape imports as "
            "'justvoice_standard'."
        )
    return doc, images


def _voice_hint(c: dict[str, Any]) -> str | None:
    """Casting bias from JustWrite's character sheet — advisory only; the
    operator picks the real voice when the project is committed."""
    parts = [str(c.get("gender") or "").strip()]
    age = c.get("age")
    if isinstance(age, int) and age > 0:
        parts.append(f"age {age}")
    parts.append(str(c.get("role") or "").strip())
    return ", ".join(p for p in parts if p) or None


def _notes(c: dict[str, Any]) -> str | None:
    """The character's one-liner, plus aliases — aliases matter for narration
    because the same person is addressed by several names in the prose."""
    bits: list[str] = []
    one_liner = str(c.get("oneLiner") or "").strip()
    if one_liner:
        bits.append(one_liner)
    aliases = [str(a).strip() for a in (c.get("aliases") or []) if str(a).strip()]
    if aliases:
        bits.append("Also known as: " + ", ".join(aliases))
    return " · ".join(bits) or None


def parse(raw: bytes, *, filename: str | None = None) -> StandardImport:
    doc, image_count = _read_book(raw)

    proj = doc.get("project") or {}
    project = StandardProject(
        name=str(proj.get("title") or "Untitled"),
        kind="audiobook",
        description=str(proj.get("premise") or "").strip() or None,
        # book.json carries no language field — the operator sets it per project.
        language="en-US",
    )

    characters = [
        StandardCharacter(
            id=str(c["id"]),
            name=str(c.get("name") or c["id"]),
            voice_hint=_voice_hint(c),
            notes=_notes(c),
        )
        for c in (doc.get("characters") or [])
        if isinstance(c, dict) and c.get("id")
    ]

    # One JustVoice scene per JustWrite CHAPTER, in `parts[].chapters[]` order:
    # JustVoice has no chapter entity (Project -> Scene -> Block) and renders
    # per scene, so the chapter is the deliverable unit. JustWrite's scenes
    # become ordered runs of lines inside it, their boundary preserved in
    # source_ref.
    scenes_by_chapter = doc.get("scenes") or {}
    scenes: list[StandardScene] = []
    empty_chapters: list[str] = []
    seen = 0
    for part in doc.get("parts") or []:
        if not isinstance(part, dict):
            continue
        for ch in part.get("chapters") or []:
            if not isinstance(ch, dict):
                continue
            seen += 1
            chapter_id = str(ch.get("id") or "") or f"chapter-{seen}"
            title = (
                str(ch.get("title") or "").strip() or f"Chapter {ch.get('num') or seen}"
            )
            lines: list[StandardLine] = []
            for scene in scenes_by_chapter.get(chapter_id) or []:
                if not isinstance(scene, dict):
                    continue
                scene_id = str(scene.get("id") or "")
                # The scene TITLE is deliberately not narrated: it is a
                # JustWrite planning label, not published prose.
                blocks = html_blocks(
                    scene.get("body") or "", skip_classes=_SKIP_CLASSES
                )
                for index, (_kind, text) in enumerate(blocks):
                    lines.append(
                        StandardLine(
                            character_id=None,
                            text=text,
                            source_ref=f"chapter:{chapter_id}#scene:{scene_id}#block:{index}",
                        )
                    )
            if not lines:
                empty_chapters.append(title)
                continue
            scenes.append(
                StandardScene(id=chapter_id, title=title, kind="chapter", lines=lines)
            )

    if not scenes:
        raise bad_request(
            "justwrite import: no readable text — every chapter in this book is empty"
        )

    # Import states what it DID, never what to do next. Lines arriving without a
    # speaker is the normal, expected result — attribution is a separate step the
    # operator runs from Studio's Script tab when they choose to, and nothing
    # here nudges them toward it.
    warnings: list[str] = []
    if empty_chapters:
        shown = ", ".join(empty_chapters[:_WARN_NAME_CAP])
        extra = len(empty_chapters) - _WARN_NAME_CAP
        more = f" (+{extra} more)" if extra > 0 else ""
        warnings.append(
            f"{len(empty_chapters)} chapter(s) had no text and were skipped: {shown}{more}"
        )
    if image_count:
        warnings.append(
            f"{image_count} image file(s) in the zip were ignored — JustVoice "
            "imports prose and cast, not JustWrite's planning images"
        )

    return StandardImport(
        source=SOURCE_ID,
        project=project,
        characters=characters,
        scenes=scenes,
        # A JustWrite book carries no pronunciation lexicon.
        lexicon_entries=[],
        warnings=warnings,
    )
