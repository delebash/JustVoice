# SPDX-License-Identifier: MIT
"""Caption files from word timings — WebVTT and SRT.

The consumer half of word-level alignment (C1): timed words group into
readable cues and format as the two caption dialects every player takes.
Grouping is by readability, not by sentence detection: a cue closes at
~42 characters (the captioning industry's one-line limit), at 7 words, or
at a pause longer than a second — whichever comes first.
"""

from __future__ import annotations

_MAX_CUE_CHARS = 42
_MAX_CUE_WORDS = 7
_GAP_BREAK_SECS = 1.0


def group_cues(words: list[dict]) -> list[dict]:
    """[{word,start,end}] → [{text,start,end}] cues."""
    cues: list[dict] = []
    cur: list[dict] = []

    def flush():
        if cur:
            cues.append(
                {
                    "text": " ".join(w["word"] for w in cur),
                    "start": cur[0]["start"],
                    "end": cur[-1]["end"],
                }
            )
            cur.clear()

    for w in words:
        if cur:
            length = sum(len(x["word"]) + 1 for x in cur) + len(w["word"])
            gap = w["start"] - cur[-1]["end"]
            if length > _MAX_CUE_CHARS or len(cur) >= _MAX_CUE_WORDS or gap > _GAP_BREAK_SECS:
                flush()
        cur.append(w)
    flush()
    return cues


def _ts(seconds: float, *, sep: str) -> str:
    ms = round(seconds * 1000)
    h, rem = divmod(ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


def to_vtt(words: list[dict]) -> str:
    out = ["WEBVTT", ""]
    for cue in group_cues(words):
        out.append(f"{_ts(cue['start'], sep='.')} --> {_ts(cue['end'], sep='.')}")
        out.append(cue["text"])
        out.append("")
    return "\n".join(out)


def to_srt(words: list[dict]) -> str:
    out = []
    for i, cue in enumerate(group_cues(words), 1):
        out.append(str(i))
        out.append(f"{_ts(cue['start'], sep=',')} --> {_ts(cue['end'], sep=',')}")
        out.append(cue["text"])
        out.append("")
    return "\n".join(out)
