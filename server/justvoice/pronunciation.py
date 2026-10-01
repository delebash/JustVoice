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

Pure functions; the API route feeds them each line's text and the lexicon
graphemes the render reads that line with.
"""

from __future__ import annotations

import re

_TOKEN_RE = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿ][\w'’-]*", re.UNICODE)
# A token counts as "mid-sentence" unless it follows a sentence break or
# opens the text/paragraph — those positions capitalize any word.
_BREAK_RE = re.compile(r"[.!?…]\s*[\"'“”‘’)\]]*\s*$")


def scan_names(lines: list[tuple[str, frozenset[str]]]) -> list[dict]:
    """[{word, count}] — likely proper nouns no lexicon covers where they stand.

    `lines`: each line's text with its own `covered` set — the graphemes in
    the lexicons the render reads THAT line with (render_core.line_lexicons),
    matched casefolded. Per line since 2026-09-30: a persona's lexicon
    reaches only that persona's lines, so a name it holds is still unhandled
    when the narrator says it, and is counted there. A word qualifies when it
    appears capitalized somewhere a sentence didn't force the capital, never
    appears lowercase, and is at least three letters (two-letter capitals are
    almost always initials or "I" artifacts).
    """
    # A multi-word covered grapheme ("Mara Vance") covers exactly the
    # PHRASE — that is also all the render-side entry matches. Strip those
    # occurrences from the text before tokenizing, so their words don't
    # get re-flagged, while a lone "Mara" elsewhere still counts (review
    # R2, reproduced). Compiled once per distinct covered set — a book has a
    # handful (one per persona lexicon in the cast).
    prepared: dict[frozenset[str], tuple[set[str], list[re.Pattern]]] = {}

    def _prepare(covered: frozenset[str]) -> tuple[set[str], list[re.Pattern]]:
        if covered not in prepared:
            prepared[covered] = (
                {c.casefold() for c in covered},
                [
                    re.compile(r"\b" + re.escape(c) + r"\b", re.IGNORECASE)
                    for c in covered
                    if " " in c.strip()
                ],
            )
        return prepared[covered]

    lowercase_seen: set[str] = set()
    candidates: dict[str, dict] = {}  # casefold → {word, count, mid}

    for text, covered in lines:
        if not text:
            continue
        covered_cf, phrase_res = _prepare(frozenset(covered))
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
