# SPDX-License-Identifier: MIT
# SPDX-FileCopyrightText: 2024-2026 JustWrite contributors
# SPDX-FileCopyrightText: 2026 JustVoice contributors

"""Paragraph segmentation — split each paragraph by speech marks into
alternating narration / dialogue segments.

Lifted from JustWrite speakerAttribution.js, which read double quotes only.
A book's speech marks are one of four styles (2026-09-30, Overview →
Speech marks): "double" (“ ” and straight "), "single" (‘ ’ and straight '),
"guillemets" (« » and » «) and "german" („ “ and „ ”). A project picks one
or leaves it on Auto, and Auto takes each chapter's main mark by counting
(`detect_marks`). One style at a time: a book's other marks are quotes
inside a speech, never speech of their own.

Single quotes double as apostrophes, so in single mode a speech opens only at
a word's start and closes only where no letter follows — the apostrophe in
don’t never ends one. A trailing apostrophe inside speech (‘the boys’ bikes’)
still closes it early; Script's Split and Merge fix that line by hand.
"""

from __future__ import annotations

import re

SPEECH_MARKS = ("double", "single", "guillemets", "german")

# A single-quoted speech opens with ‘ or ' at a word's start — the paragraph's
# start, or after a space, bracket, dash or double quote — never on an elision
# ('tis, 'em, rock 'n' roll, the '90s), and something must follow it.
_SQ_OPEN = (
    r"(?<![^\s(\[—–\"“])[‘']"
    r"(?!(?i:tis|twas|twere|twill|em|cause|cos|til|till|round|nuff|n)\b|\d)(?=\S)"
)
# ...and closes with ’ or ' after something, where no letter or digit follows.
_SQ_CLOSE = r"(?<=\S)[’'](?!\w)"

# Each style's dialogue spans. Greedy enough to capture multi-sentence
# dialogue inside one set of marks; not greedy enough to swallow the next
# paragraph.
#
# A speech that runs over several paragraphs opens a mark on each one and
# closes only the last, so a mark that opens and never closes is speech to
# the paragraph's end — for straight quotes too (2026-09-29). Without the
# straight branch, The Speckled Band with its quotes straightened lost 14
# paragraphs of speech, 1,247 of 6,473 spoken words, to the Narrator.
_PATTERNS = {
    "double": re.compile(
        r"“([^“”]*?)”"          # curly
        r"|“([^“”]*?)$"         # curly, unclosed at the paragraph's end
        r'|"([^"]*?)"'          # straight
        r'|"([^"]*?)$',         # straight, unclosed
        re.DOTALL,
    ),
    "single": re.compile(
        _SQ_OPEN + r"(.*?)" + _SQ_CLOSE
        + r"|" + _SQ_OPEN + r"(.*)$",   # unclosed
        re.DOTALL,
    ),
    "guillemets": re.compile(
        r"«([^«»]*?)»"          # French, Italian, Spanish…
        r"|«([^«»]*?)$"         # unclosed
        r"|»([^«»]*?)«",        # German, Danish: pointing inward
        re.DOTALL,
    ),
    "german": re.compile(
        r"„([^„“”]*?)[“”]"      # „…“ German, „…” Polish, Hungarian…
        r"|„([^„“”]*?)$",       # unclosed
        re.DOTALL,
    ),
}
# The groups of each pattern that match a speech left open.
_UNCLOSED = {"double": (2, 4), "single": (2,), "guillemets": (2,), "german": (2,)}

# The marks a stored dialogue line keeps around its words, by style — the
# pairs `extraction_api._block_text` looks for in the analyzed text.
QUOTE_PAIRS = {
    "double": (("“", "”"), ('"', '"')),
    "single": (("‘", "’"), ("'", "'"), ("‘", "'"), ("'", "’")),
    "guillemets": (("«", "»"), ("»", "«")),
    "german": (("„", "“"), ("„", "”")),
}

_OPENS_SPEECH = re.compile(r"\s*(?:[“\"«»„]|" + _SQ_OPEN + r")")


_FIRST_MARK = re.compile(r"(?P<double>[“\"])|(?P<guillemets>[«»])|(?P<german>„)|(?P<single>" + _SQ_OPEN + r")")


def detect_marks(text: str) -> str:
    """The style a text's speech uses: the one whose mark comes first in the
    most paragraphs. Only the first counts — a speech's own mark always opens
    before any quote inside it, so Helen quoting her sister ‘…’ inside her “…”
    never outvotes the speech, and a German closing “ never reads as an
    English opening one. A tie, or no speech at all, is "double"."""
    counts = dict.fromkeys(SPEECH_MARKS, 0)
    for para in split_into_paragraphs(text):
        m = _FIRST_MARK.search(para)
        if m:
            counts[m.lastgroup] += 1
    best = max(SPEECH_MARKS, key=lambda k: counts[k])   # ties keep SPEECH_MARKS order
    return best if counts[best] else "double"


def resolve_marks(setting: str | None, text: str) -> str:
    """A project's Speech marks setting for this text: a style as set, and
    Auto (or anything unknown) read from the text."""
    return setting if setting in SPEECH_MARKS else detect_marks(text)


def opens_speech(text: str | None) -> bool:
    """Does a stored line start with a speech mark of any style? A dialogue
    block keeps its marks, so this is how a line nothing decided (yours, an
    import's) is known to be speech."""
    return bool(_OPENS_SPEECH.match(text or ""))


def left_open(paragraph: str, marks: str | None = None) -> bool:
    """Does a speech open in this paragraph and never close — carrying on
    into the next one?"""
    style = marks if marks in SPEECH_MARKS else detect_marks(paragraph)
    last = None
    for last in _PATTERNS[style].finditer(paragraph):
        pass
    return last is not None and any(last.group(g) is not None for g in _UNCLOSED[style])


def strip_marks(text: str) -> str:
    """A stored dialogue line's words without the marks around them — what the
    segmenter hands on for the same span. A mark left open stays off too."""
    t = text.strip()
    pairs = [p for style in QUOTE_PAIRS.values() for p in style]
    opener = next((o for o, _c in pairs if t.startswith(o)), None)
    if opener is None:
        return t
    inner = t[len(opener):]
    closer = next((c for o, c in pairs if o == opener and inner.endswith(c)), "")
    return inner[: len(inner) - len(closer)].strip()


def segments_from_lines(lines: list[dict]) -> list[dict]:
    """Segments for a chapter already cut into lines — each line one segment,
    in order, so the rows that come back map onto the lines one to one.

    A line is `{text, spoken, paragraph}`: `paragraph` is the analyzed text's
    paragraph it came from (None for a line added by hand). Neighbouring lines
    of one paragraph read as one again — the anchors and the three-in-a-row
    check are same-paragraph only — and a line with no paragraph is its own.
    Paragraphs are renumbered 0..n-1, as the pipeline counts them."""
    segments: list[dict] = []
    p_idx = -1
    prev = object()
    next_did = 0
    for ln in lines:
        para = ln.get("paragraph")
        if para is None or para != prev:
            p_idx += 1
        prev = para
        if ln.get("spoken"):
            segments.append({"kind": "dialogue", "text": strip_marks(ln["text"]),
                             "paragraph_idx": p_idx, "dialogue_id": next_did})
            next_did += 1
        else:
            segments.append({"kind": "narration", "text": ln["text"].strip(), "paragraph_idx": p_idx})
    return segments


def paragraphs_of(segments: list[dict]) -> list[str]:
    """The paragraphs a ready-cut segment list reads as, 0..n-1."""
    by: dict[int, list[str]] = {}
    for s in segments:
        by.setdefault(s["paragraph_idx"], []).append(s["text"])
    return [" ".join(by[i]) for i in sorted(by)]


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
    marks: str | None = None,
) -> list[dict]:
    """Walk paragraphs and emit a flat list of segments.

    Each segment is `{kind, text, paragraph_idx}` where kind is
    "narration" or "dialogue". Dialogue segments also carry a
    chapter-wide `dialogue_id` integer (D1, D2, ...) that anchors
    and the LLM both reference.

    `marks` is the speech-mark style (`SPEECH_MARKS`); None reads it from
    these paragraphs (Auto). A caller segmenting one paragraph at a time
    passes the chapter's, since one paragraph is too little to read it from.

    `start_dialogue_id` lets a caller continue numbering across multiple
    scene calls (the LLM prompt is scene-scoped today, but a future
    cross-scene attribution would pass the running counter).
    """
    segments: list[dict] = []
    next_did = start_dialogue_id
    pattern = _PATTERNS[marks if marks in SPEECH_MARKS else detect_marks("\n\n".join(paragraphs))]

    for p_idx, para in enumerate(paragraphs):
        last_end = 0
        for m in pattern.finditer(para):
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
                (g for g in m.groups() if g is not None),
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
