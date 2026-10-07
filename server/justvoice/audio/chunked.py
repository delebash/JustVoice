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

Splits long text into sentence-boundary chunks, generates audio per-chunk
via any TTS backend, and concatenates with crossfade. All logic is
engine-agnostic — wraps the standard `synthesize()` interface.

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

import numpy as np


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
#: top, and the joins measured 440-480 ms.
PIECE_JOIN_PAUSE_MS = 260
PIECE_JOIN_SILENCE_DBFS = -60.0
_WINDOW_MS = 10


def _quiet_run(x: np.ndarray, sample_rate: int, *, from_end: bool) -> int:
    """How many samples at the start (or end) of `x` lie in quiet 10 ms windows."""
    w = max(1, int(sample_rate * _WINDOW_MS / 1000))
    n = len(x) // w
    if n == 0:
        return len(x)
    frames = x[: n * w].reshape(n, w) if not from_end else x[len(x) - n * w:].reshape(n, w)
    rms = np.sqrt((frames.astype(np.float64) ** 2).mean(axis=1))
    loud = np.nonzero(rms > 10 ** (PIECE_JOIN_SILENCE_DBFS / 20))[0]
    if len(loud) == 0:
        return len(x)
    return int((n - 1 - loud[-1]) * w) if from_end else int(loud[0] * w)


def join_pieces(a: np.ndarray, b: np.ndarray, sample_rate: int, crossfade_ms: int = 50) -> np.ndarray:
    """One seam: piece `a` then piece `b`, as one array.

    Where `a` ends and `b` begins in silence, that silence is cut down to
    PIECE_JOIN_PAUSE_MS — half from each side, the rest from whichever has more
    — and the two meet without a crossfade (silence against silence cannot
    click). A join already that short, or a piece with no sound, is left as it
    is, with the short crossfade. The one rule for a line's pieces and for a
    streamed audition's (decided 2026-10-07).
    """
    a = np.asarray(a, dtype=np.float32)
    b = np.asarray(b, dtype=np.float32)
    if len(b) == 0:
        return a
    tail = _quiet_run(a, sample_rate, from_end=True)
    head = _quiet_run(b, sample_rate, from_end=False)
    if tail < len(a) and head < len(b) and (tail or head):
        pause = int(sample_rate * PIECE_JOIN_PAUSE_MS / 1000)
        if tail + head > pause:
            keep_tail = min(tail, pause // 2)
            keep_head = min(head, pause - keep_tail)
            keep_tail = min(tail, pause - keep_head)
            a = a[: len(a) - (tail - keep_tail)]
            b = b[head - keep_head:]
        return np.concatenate([a, b])
    overlap = min(int(sample_rate * crossfade_ms / 1000), len(a), len(b))
    if overlap > 0:
        fade_out = np.linspace(1.0, 0.0, overlap, dtype=np.float32)
        fade_in = np.linspace(0.0, 1.0, overlap, dtype=np.float32)
        blended = a[len(a) - overlap:] * fade_out + b[:overlap] * fade_in
        return np.concatenate([a[: len(a) - overlap], blended, b[overlap:]])
    return np.concatenate([a, b])


def held_for_next_seam(pcm: np.ndarray, sample_rate: int, crossfade_ms: int = 50) -> tuple[np.ndarray, np.ndarray]:
    """A streamed piece split into what can go out now and what waits for the
    next piece: its trailing quiet and one crossfade window before it, so
    `join_pieces` can judge that seam whole."""
    quiet = _quiet_run(pcm, sample_rate, from_end=True)
    cut = max(0, len(pcm) - quiet - int(sample_rate * crossfade_ms / 1000))
    return pcm[:cut], pcm[cut:]


def concatenate_audio_chunks(
    chunks: List[np.ndarray],
    sample_rate: int,
    crossfade_ms: int = 50,
) -> np.ndarray:
    """Concatenate audio arrays, each seam by `join_pieces`.

    Each chunk is expected to be a 1-D float32 ndarray at *sample_rate* Hz.
    """
    if not chunks:
        return np.array([], dtype=np.float32)
    if len(chunks) == 1:
        return chunks[0]

    result = np.array(chunks[0], dtype=np.float32, copy=True)
    for chunk in chunks[1:]:
        if len(chunk) == 0:
            continue
        result = join_pieces(result, chunk, sample_rate, crossfade_ms)
    return result
