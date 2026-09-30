# SPDX-License-Identifier: MIT
"""Dialogue tags — narration that only says who spoke ("said Marius,").

Overview's "Leave out dialogue tags" (2026-09-30,
docs/plans/2026-09-30-script-leftovers.md B4): with every speaker in their
own voice, the narrator reading "said Marius" between two of Marius's lines
only repeats what the listener already hears. A line is left out only when it
is NOTHING but a tag — who, a dialogue verb, perhaps an adverb — and sits next
to a spoken line of the same paragraph. "said Marius, turning away" is still
read, and so is any line of a chapter never analyzed (it has no paragraphs to
go by).

One function for every render path (chapter audio, M4B export, captions) and
for Script's "Left out" tag, so what Script shows is what the audio skips.
The verbs are the anchors' (anchors.DIALOGUE_VERBS), so English tags only.
"""

from __future__ import annotations

import json
import re

from .anchors import DIALOGUE_VERBS

_TITLE = r"(?:(?:Mr|Mrs|Ms|Dr|St)\.?\s|Miss\s|Sir\s|Lady\s|Lord\s|Captain\s|Master\s)?"
_NAME = _TITLE + r"[A-Z][\w’'-]*(?:\s[A-Z][\w’'-]*){0,2}"
_PRONOUN = r"(?:[Hh]e|[Ss]he|[Tt]hey|I|[Ww]e|[Yy]ou|[Ii]t)"
_THE = r"(?:[Tt]he\s[a-z][\w’'-]*(?:\s[a-z][\w’'-]*)?)"
_WHO = rf"(?:{_PRONOUN}|{_THE}|{_NAME})"
_VERB = r"(?i:" + "|".join(DIALOGUE_VERBS) + r")"
_HOW = r"(?:\s(?:[a-z]+ly|again|aloud|at\slast|at\sonce))?"
_TAG_ONLY = re.compile(
    rf"[,;:—–-]?\s*(?:{_WHO}\s{_VERB}|{_VERB}\s{_WHO}){_HOW}\s*[,.;:!?—–-]*"
)


def is_tag_only(text: str | None) -> bool:
    """Is this narration nothing but a dialogue tag?"""
    return bool(_TAG_ONLY.fullmatch((text or "").strip()))


def left_out(lines: list[dict]) -> set:
    """The ids of the lines "Leave out dialogue tags" skips.

    `lines` are a chapter's readable lines in order, each `{id, text, spoken,
    paragraph}` — `paragraph` from the analyzed text, None when there is none."""
    out = set()
    for i, ln in enumerate(lines):
        if ln["spoken"] or ln.get("paragraph") is None or not is_tag_only(ln["text"]):
            continue
        for j in (i - 1, i + 1):
            near = lines[j] if 0 <= j < len(lines) else None
            if near is not None and near["spoken"] and near.get("paragraph") == ln["paragraph"]:
                out.add(ln["id"])
                break
    return out


def left_out_blocks(blocks) -> set:
    """`left_out` over a chapter's stored blocks, in order. Blank lines and
    podcast markers are not readable lines, so they are no one's neighbour."""
    from .flags import spoken_block

    lines = []
    for b in blocks:
        if not (b.text or "").strip():
            continue
        try:
            meta = json.loads(b.metadata_json or "{}")
        except (TypeError, ValueError):
            meta = {}
        if meta.get("marker"):
            continue
        lines.append({"id": b.id, "text": b.text, "spoken": spoken_block(b.source, b.text),
                      "paragraph": meta.get("paragraph_idx")})
    return left_out(lines)
