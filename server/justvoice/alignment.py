# SPDX-License-Identifier: MIT
"""Word-level alignment — attach times to the words we KNOW were spoken.

The engine-agnostic half of word timestamps (C1, 2026-08-21 go; research
in the 2026-08-21 plan doc §3): Whisper transcribes the rendered audio
with per-token timing, and this module maps that hypothesis onto the
KNOWN line text. Knowing the text is what makes this forced alignment
rather than transcription — an ASR mistake ("Wooster" for "Worcester")
must not lose the word's timing, and it doesn't: the words align by
sequence matching and every unmatched known word interpolates between its
timed neighbours.

Pure functions only — the Whisper call lives in the engine; these are
testable with fabricated hypotheses.
"""

from __future__ import annotations

import difflib
import re

_WORD_RE = re.compile(r"\S+")
_NORM_RE = re.compile(r"[^\w']+", re.UNICODE)


def split_words(text: str) -> list[str]:
    """The text's words, whitespace-split, punctuation kept (the caption
    should read as written)."""
    return _WORD_RE.findall(text or "")


def _norm(word: str) -> str:
    return _NORM_RE.sub("", word).casefold()


def align_known_text(
    known_text: str,
    hyp_words: list[dict],
    *,
    total_duration: float | None = None,
) -> list[dict]:
    """Times for every word of `known_text`.

    `hyp_words`: [{word, start, end}] — the transcriber's own words with
    times. Returns [{word, start, end}] for the KNOWN words, in order.

    Matched words take the hypothesis timing. Unmatched runs (ASR errors,
    dropped words) interpolate linearly between the nearest timed
    anchors; before the first anchor they interpolate from 0, after the
    last from `total_duration` (or the last anchor's end). A hypothesis
    with no usable overlap at all returns an even spread over the audio —
    wrong in detail but monotonic and honest about being an estimate.
    """
    known = split_words(known_text)
    if not known:
        return []
    hyp = [h for h in hyp_words if _norm(h.get("word", ""))]

    n = len(known)
    starts: list[float | None] = [None] * n
    ends: list[float | None] = [None] * n

    if hyp:
        sm = difflib.SequenceMatcher(
            a=[_norm(w) for w in known],
            b=[_norm(h["word"]) for h in hyp],
            autojunk=False,
        )
        for block in sm.get_matching_blocks():
            for k in range(block.size):
                h = hyp[block.b + k]
                starts[block.a + k] = float(h["start"])
                ends[block.a + k] = float(h["end"])

    last_time = total_duration
    if last_time is None:
        timed_ends = [e for e in ends if e is not None]
        last_time = max(timed_ends) if timed_ends else float(n)  # 1 s/word floor

    # Fill unmatched runs by linear interpolation between anchors.
    i = 0
    while i < n:
        if starts[i] is not None:
            i += 1
            continue
        run_start = i
        while i < n and starts[i] is None:
            i += 1
        run_end = i  # exclusive
        left = ends[run_start - 1] if run_start > 0 else 0.0
        right = starts[run_end] if run_end < n else last_time
        if right < left:  # a misordered anchor pair — keep it monotonic
            right = left
        span = right - left
        count = run_end - run_start
        for k in range(count):
            starts[run_start + k] = left + span * k / count
            ends[run_start + k] = left + span * (k + 1) / count

    out = []
    prev_end = 0.0
    for w, s, e in zip(known, starts, ends):
        s = max(float(s), prev_end)  # monotonic, never overlapping backwards
        e = max(float(e), s)
        out.append({"word": w, "start": round(s, 3), "end": round(e, 3)})
        prev_end = e
    return out
