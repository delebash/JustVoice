# SPDX-License-Identifier: MIT
# SPDX-FileCopyrightText: 2024 Jamie Pine and voicebox contributors
# SPDX-FileCopyrightText: 2026 JustVoice contributors
#
# Originally from https://github.com/jamiepine/voicebox/blob/b35b90961d5bc83a8b4e96e8b6ccde2a03152ff9/backend/utils/chunked_tts.py
# (commit pinned in voicebox-pin.txt at repo root).
# Ported to JustVoice on 2026-06-08. Modifications by JustVoice contributors
# are licensed under MIT as part of the combined JustVoice work. The
# MIT permission notice (LICENSES/MIT.txt) continues to apply to upstream-derived
# portions.
"""Chunked TTS generation utilities.

Splits long text into sentence-boundary chunks; each piece is spoken by any
TTS backend, and the pieces are joined by the DSP program (`dsp_client.join`,
by the PIECE_JOIN_* rules below — the joins themselves moved to our audio.cpp
fork's `audiocpp_dsp` on 2026-10-07). All logic is engine-agnostic.

Short text (≤ max_chunk_chars) uses the single-shot fast path with zero
overhead.

Tunables live in settings.json per CLAUDE.md "no hardcoded operator-tunable
values" rule:
    settings.generation.max_chunk_chars  (default 800)
    settings.generation.crossfade_ms     (default 50)
"""

from __future__ import annotations

import logging
import re
from typing import List


logger = logging.getLogger("justvoice.audio.chunked")


# Default chunk size in characters. Can be overridden per-request.
DEFAULT_MAX_CHUNK_CHARS = 800

# Common abbreviations that should NOT be treated as sentence endings.
# Lowercase for case-insensitive matching.
_ABBREVIATIONS = frozenset(
    {
        "mr",
        "mrs",
        "ms",
        "dr",
        "prof",
        "sr",
        "jr",
        "st",
        "ave",
        "blvd",
        "inc",
        "ltd",
        "corp",
        "dept",
        "est",
        "approx",
        "vs",
        "etc",
        "e.g",
        "i.e",
        "a.m",
        "p.m",
        "u.s",
        "u.s.a",
        "u.k",
    }
)

# Paralinguistic tags (e.g. [laugh], [sigh]) used by Chatterbox Turbo.
# The splitter must never cut inside one of these.
_PARA_TAG_RE = re.compile(r"\[[^\]]*\]")


def split_text_into_chunks(text: str, max_chars: int = DEFAULT_MAX_CHUNK_CHARS) -> List[str]:
    """Split *text* at natural boundaries into chunks of at most *max_chars*.

    Priority: sentence-end (`.!?` not preceded by an abbreviation and not
    inside brackets) → clause boundary (`;:,—`) → whitespace → hard cut.

    Paralinguistic tags like `[laugh]` are treated as atomic and will not
    be split across chunks.
    """
    text = text.strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]

    chunks: List[str] = []
    remaining = text

    while remaining:
        remaining = remaining.lstrip()
        if not remaining:
            break
        if len(remaining) <= max_chars:
            chunks.append(remaining)
            break

        segment = remaining[:max_chars]

        # Try sentence-end → clause-boundary → whitespace → safe hard cut.
        split_pos = _find_last_sentence_end(segment)
        if split_pos == -1:
            split_pos = _find_last_clause_boundary(segment)
        if split_pos == -1:
            split_pos = segment.rfind(" ")
        if split_pos == -1:
            split_pos = _safe_hard_cut(segment, max_chars)

        chunk = remaining[: split_pos + 1].strip()
        if chunk:
            chunks.append(chunk)
        remaining = remaining[split_pos + 1 :]

    return chunks


def _find_last_sentence_end(text: str) -> int:
    """Return the index of the last sentence-ending punctuation in *text*.

    Skips periods that follow common abbreviations (`Dr.`, `Mr.`, etc.) and
    periods inside bracket tags (`[laugh]`). Handles CJK sentence-ending
    punctuation (`。！？`).
    """
    best = -1
    # ASCII sentence ends.
    for m in re.finditer(r"[.!?](?:\s|$)", text):
        pos = m.start()
        char = text[pos]
        if char == ".":
            # Walk backwards to find the preceding word.
            word_start = pos - 1
            while word_start >= 0 and text[word_start].isalpha():
                word_start -= 1
            word = text[word_start + 1 : pos].lower()
            if word in _ABBREVIATIONS:
                continue
            # Skip decimal numbers (digit immediately before the period).
            if word_start >= 0 and text[word_start].isdigit():
                continue
        if _inside_bracket_tag(text, pos):
            continue
        best = pos
    # CJK sentence-ending punctuation.
    for m in re.finditer(r"[。！？]", text):
        if m.start() > best:
            best = m.start()
    return best


def _find_last_clause_boundary(text: str) -> int:
    """Return the index of the last clause-boundary punctuation."""
    best = -1
    for m in re.finditer(r"[;:,—](?:\s|$)", text):
        pos = m.start()
        if _inside_bracket_tag(text, pos):
            continue
        best = pos
    return best


def _inside_bracket_tag(text: str, pos: int) -> bool:
    """Return True if *pos* falls inside a `[...]` tag."""
    for m in _PARA_TAG_RE.finditer(text):
        if m.start() < pos < m.end():
            return True
    return False


def _safe_hard_cut(segment: str, max_chars: int) -> int:
    """Find a hard-cut position that doesn't split a `[tag]`."""
    cut = max_chars - 1
    for m in _PARA_TAG_RE.finditer(segment):
        if m.start() < cut < m.end():
            return m.start() - 1 if m.start() > 0 else cut
    return cut


#: Where two pieces of one line meet, the quiet on both sides is cut down to this
#: (decided 2026-10-07): each piece arrives with its model's own padding — Kokoro
#: ~715 ms after and ~265 ms before — so a long line held ~0.9-1 s gaps where it was
#: cut, against the ~260 ms Kokoro pauses at a sentence end inside a piece (median of
#: 214 on The Ninth Facet). "Quiet" is judged the way that pause was measured: 10 ms
#: windows under PIECE_JOIN_SILENCE_DBFS. A per-sample −70 dBFS left a faint fade on
#: top, and the joins measured 440-480 ms. The rule is applied in `audiocpp_dsp`
#: (`dsp_client.join` / `stream_join` send these values): where `a` ends and `b`
#: begins in silence, that silence is cut down to the pause — half from each side,
#: the rest from whichever has more — and the two meet without a crossfade; a join
#: already that short, or a piece with no sound, gets the short crossfade. A streamed
#: piece holds back its trailing quiet and one crossfade window for the next seam.
PIECE_JOIN_PAUSE_MS = 260
PIECE_JOIN_SILENCE_DBFS = -60.0
WINDOW_MS = 10
