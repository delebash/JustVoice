# SPDX-License-Identifier: GPL-3.0-or-later
"""Podcast script import — speaker-labeled markdown/text (mock #podcast/2).

The podcast way-in (CONCEPTS §1/§3): a script where each paragraph names
its speaker:

    SARAH: Welcome back to Signal and Noise. [warm]
    **JIN:** Mave, your team just shipped a codec...
    — Mid-roll marker —

Recognized label forms: `NAME:` / `**NAME:**` / `[NAME]:` at line start
(1–3 words, allowing letters/digits/space/'/./-). Unknown labels become
characters; consecutive unlabeled paragraphs continue the current
speaker. `## Heading` lines split episodes/segments into scenes.
Paralinguistic tags like [laughs] stay in the text — engines that
support them perform them (CONCEPTS §17 keeps that contract).
"""

from __future__ import annotations

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

SOURCE_ID = "podcast_markdown"

# SARAH:  /  **SARAH:**  /  [SARAH]:   — captures the name.
_LABEL_RE = re.compile(
    r"^\s*(?:\*\*|\[)?([A-Za-z][A-Za-z0-9 .'\-]{0,40}?)(?:\]|\*\*)?\s*:\s*(?:\*\*)?\s*(.*)$"
)
_HEADING_RE = re.compile(r"^(#{1,3})\s+(.*\S)\s*$")
# Lines that are clearly markers, not speech: — Intro theme —, --- etc.
_MARKER_RE = re.compile(r"^\s*(?:—|-{3,}|\*{3,}|_{3,})")


def _slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return s[:64] or "speaker"


def _looks_like_label(name: str) -> bool:
    """Heuristic guard: 'SARAH' yes; 'The thing about codecs' no.
    Labels are short and either ALL-CAPS or Title Case ≤3 words."""
    words = name.strip().split()
    if not words or len(words) > 3:
        return False
    if name.strip().isupper():
        return True
    return all(w[0].isupper() for w in words if w)


def parse(raw: bytes, *, filename: str | None = None) -> StandardImport:
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise bad_request("podcast_markdown import: file is not UTF-8 text") from None

    characters: OrderedDict[str, StandardCharacter] = OrderedDict()
    scenes: list[StandardScene] = []
    current_scene: StandardScene | None = None
    current_speaker: str | None = None
    scene_count = 0
    line_no = 0

    def ensure_scene(title: str | None) -> StandardScene:
        nonlocal current_scene, scene_count
        scene_count += 1
        current_scene = StandardScene(
            id=_slug(title or f"segment_{scene_count}"),
            title=title or f"Segment {scene_count}",
            kind="segment",
            lines=[],
        )
        scenes.append(current_scene)
        return current_scene

    for para in re.split(r"\n\s*\n", text):
        para = para.strip()
        if not para:
            continue
        line_no += 1

        m = _HEADING_RE.match(para.splitlines()[0])
        if m:
            ensure_scene(m.group(2))
            rest = "\n".join(para.splitlines()[1:]).strip()
            if not rest:
                continue
            para = rest

        if _MARKER_RE.match(para):
            # Music/ad markers ride along as narrator-less direction lines.
            if current_scene is None:
                ensure_scene(None)
            current_scene.lines.append(
                StandardLine(
                    character_id=None,
                    text=para,
                    delivery={"marker": True},
                    source_ref=f"md:p{line_no}",
                )
            )
            continue

        body = re.sub(r"\s+", " ", para).strip()
        m = _LABEL_RE.match(para)
        if m and _looks_like_label(m.group(1)):
            name = re.sub(r"\s+", " ", m.group(1)).strip()
            cid = _slug(name)
            if cid not in characters:
                characters[cid] = StandardCharacter(id=cid, name=name.title() if name.isupper() else name)
            current_speaker = cid
            body = m.group(2).strip()
            if not body:
                continue

        if current_scene is None:
            ensure_scene(None)
        current_scene.lines.append(
            StandardLine(
                character_id=current_speaker,
                text=body,
                source_ref=f"md:p{line_no}",
            )
        )

    scenes = [s for s in scenes if s.lines]
    if not scenes:
        raise bad_request("podcast_markdown import: no script content found")

    warnings: list[str] = []
    if not characters:
        warnings.append(
            "no speaker labels detected (NAME: / **NAME:** at paragraph start) — "
            "every line imported unattributed"
        )

    name = filename.rsplit("/", 1)[-1].rsplit(".", 1)[0] if filename else "Imported episode"
    return StandardImport(
        source=SOURCE_ID,
        project=StandardProject(name=name, kind="podcast", language="en-US"),
        characters=list(characters.values()),
        scenes=scenes,
        warnings=warnings,
    )
