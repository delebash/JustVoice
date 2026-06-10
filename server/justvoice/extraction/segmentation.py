# SPDX-License-Identifier: MIT AND GPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 JustWrite contributors
# SPDX-FileCopyrightText: 2026 JustVoice contributors

"""Paragraph segmentation — split each paragraph by quote marks into
alternating narration / dialogue segments.

Lifted from JustWrite speakerAttribution.js. Single quotes are ignored
(apostrophe false-positive avoidance). Both straight (" ") and curly
(“ ”) quotes are recognized.
"""

from __future__ import annotations

import re

# Match either pair of curly quotes OR a straight quote span.
# Greedy enough to capture multi-sentence dialogue inside one set of
# quotes; not greedy enough to swallow the next paragraph.
_DIALOGUE_PATTERN = re.compile(
    r"“([^“”]*?)”"   # curly
    r"|“([^“”]*?)$"        # curly, unclosed at line end
    r'|"([^"]*?)"',                       # straight
    re.DOTALL,
)


def split_into_paragraphs(text: str) -> list[str]:
    """Split a chapter / scene blob into paragraphs.

    JustWrite's pipeline expects newline-delimited paragraphs. Multiple
    blank lines collapse to one separator.
    """
    raw = re.split(r"\n\s*\n", text.strip())
    return [p.strip() for p in raw if p.strip()]


def segment_paragraphs(
    paragraphs: list[str],
    *,
    start_dialogue_id: int = 0,
) -> list[dict]:
    """Walk paragraphs and emit a flat list of segments.

    Each segment is `{kind, text, paragraph_idx}` where kind is
    "narration" or "dialogue". Dialogue segments also carry a
    chapter-wide `dialogue_id` integer (D1, D2, ...) that anchors
    and the LLM both reference.

    `start_dialogue_id` lets a caller continue numbering across multiple
    scene calls (the LLM prompt is scene-scoped today, but a future
    cross-scene attribution would pass the running counter).
    """
    segments: list[dict] = []
    next_did = start_dialogue_id

    for p_idx, para in enumerate(paragraphs):
        last_end = 0
        for m in _DIALOGUE_PATTERN.finditer(para):
            # Narration BEFORE this dialogue span (if any).
            if m.start() > last_end:
                narration = para[last_end:m.start()].strip()
                if narration:
                    segments.append({
                        "kind": "narration",
                        "text": narration,
                        "paragraph_idx": p_idx,
                    })
            # The dialogue itself.
            dialogue = next(
                (g for g in (m.group(1), m.group(2), m.group(3)) if g is not None),
                "",
            ).strip()
            if dialogue:
                segments.append({
                    "kind": "dialogue",
                    "text": dialogue,
                    "paragraph_idx": p_idx,
                    "dialogue_id": next_did,
                })
                next_did += 1
            last_end = m.end()
        # Trailing narration after the last dialogue (or whole paragraph
        # when there's no dialogue at all).
        tail = para[last_end:].strip()
        if tail:
            segments.append({
                "kind": "narration",
                "text": tail,
                "paragraph_idx": p_idx,
            })

    return segments
