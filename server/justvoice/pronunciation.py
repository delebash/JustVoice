# SPDX-License-Identifier: MIT
"""Pronunciation pre-flight — the names a book will mispronounce, listed
BEFORE hours of audio are rendered (C2, 2026-08-21 go).

The mechanism: proper nouns are where a text reader guesses, and a book's
character and place names are exactly the words no dictionary covers. The
scan finds capitalized words that only ever appear capitalized (a word
that also shows up lowercase is an ordinary word that merely started a
sentence), drops the ones a lexicon already covers, and returns the rest
as a worklist — most frequent first, because the name on every page is
the one that matters.

Pure functions; the API route feeds them block texts and lexicon
graphemes.
"""

from __future__ import annotations

import re

_TOKEN_RE = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿ][\w'’-]*", re.UNICODE)
# A token counts as "mid-sentence" unless it follows a sentence break or
# opens the text/paragraph — those positions capitalize any word.
_BREAK_RE = re.compile(r"[.!?…]\s*[\"'“”‘’)\]]*\s*$")


def scan_names(texts: list[str], covered: set[str]) -> list[dict]:
    """[{word, count}] — likely proper nouns not covered by a lexicon.

    `covered`: graphemes already in the attached lexicons, matched
    casefolded. A word qualifies when it appears capitalized somewhere a
    sentence didn't force the capital, never appears lowercase, and is at
    least three letters (two-letter capitals are almost always initials
    or "I" artifacts).
    """
    covered_cf = {c.casefold() for c in covered}
    # A multi-word covered grapheme ("Mara Vance") covers exactly the
    # PHRASE — that is also all the render-side entry matches. Strip those
    # occurrences from the text before tokenizing, so their words don't
    # get re-flagged, while a lone "Mara" elsewhere still counts (review
    # R2, reproduced).
    phrase_res = [
        re.compile(r"\b" + re.escape(c) + r"\b", re.IGNORECASE)
        for c in covered
        if " " in c.strip()
    ]
    lowercase_seen: set[str] = set()
    candidates: dict[str, dict] = {}  # casefold → {word, count, mid}

    for text in texts:
        if not text:
            continue
        for pr in phrase_res:
            text = pr.sub(" ", text)
        for m in _TOKEN_RE.finditer(text):
            token = m.group(0)
            at_start = m.start() == 0 or _BREAK_RE.search(text[:m.start()][-8:] or "") is not None
            cf = token.casefold()
            if token[0].islower():
                lowercase_seen.add(cf)
                continue
            if len(token) < 3 or cf in covered_cf:
                continue
            entry = candidates.setdefault(cf, {"word": token, "count": 0, "mid": False})
            entry["count"] += 1
            if not at_start:
                entry["mid"] = True

    out = [
        {"word": c["word"], "count": c["count"]}
        for cf, c in candidates.items()
        if c["mid"] and cf not in lowercase_seen
    ]
    out.sort(key=lambda w: (-w["count"], w["word"].casefold()))
    return out
