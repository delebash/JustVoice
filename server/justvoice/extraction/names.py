# SPDX-License-Identifier: MIT
"""Does a name found in the prose refer to a persona we already have?

One matcher for every place that asks it (decided 2026-09-27, Discover fixes
A / C / 1): Discover dropping a proposal for someone already cast, Discover
pointing a proposal at the library persona it names ("Brick → Brick
Halvorn"), and Add learning the variant as an alias.

What counts as the same person, most specific first:
  * the full name or any alias, compared case- and punctuation-blind;
  * a single word that is the persona's first or last name ("Brick" →
    "Brick Halvorn", "Threll" → "Haldane Threll") — only for words of three
    letters or more, because "Al" or "Jo" would match half a library.
A prefix is NOT a match: "Ode" is not "Odeline" unless someone recorded it as
an alias. Guessing there would merge different people with similar names.

Ambiguity is refused rather than guessed: when a name fits two personas
("Vance" with Mara Vance and Edith Vance both in the library), `match`
returns None and the caller treats it as unmatched.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Iterable

_PUNCT = re.compile(r"[^\w\s'-]")
_SPACE = re.compile(r"\s+")


def norm(name: str) -> str:
    """Case-, accent- and punctuation-blind form of a name."""
    s = unicodedata.normalize("NFKC", name or "").replace("’", "'").casefold()
    s = _PUNCT.sub(" ", s)
    return _SPACE.sub(" ", s).strip()


def _labels(persona) -> list[str]:
    name = persona.get("name") if isinstance(persona, dict) else getattr(persona, "name", "")
    aliases = persona.get("aliases") if isinstance(persona, dict) else getattr(persona, "aliases", None)
    return [n for n in [name, *(aliases or [])] if n]


def refers_to(candidate: str, persona) -> bool:
    """True when `candidate` names `persona` — exactly, by an alias, or by its
    first or last name alone (3+ letters)."""
    c = norm(candidate)
    if not c:
        return False
    labels = [norm(x) for x in _labels(persona)]
    if c in labels:
        return True
    if " " in c or len(c) < 3:
        return False
    for label in labels:
        words = label.split()
        if len(words) >= 2 and c in (words[0], words[-1]):
            return True
    return False


def match(candidate: str, personas: Iterable) -> object | None:
    """The one persona `candidate` refers to, or None when none — or several —
    fit. An exact name/alias hit wins over a first/last-name hit."""
    pool = list(personas)
    c = norm(candidate)
    exact = [p for p in pool if c in {norm(x) for x in _labels(p)}]
    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        return None
    loose = [p for p in pool if refers_to(candidate, p)]
    return loose[0] if len(loose) == 1 else None


def is_variant(a: str, b: str) -> bool:
    """One name is the other with words added ("Sedge" / "Old Sedge") — whole
    words only, so "Ann" is not a variant of "Annabel"."""
    x, y = norm(a).split(), norm(b).split()
    if not x or not y or x == y:
        return bool(x) and x == y
    short, long_ = (x, y) if len(x) < len(y) else (y, x)
    n = len(short)
    return any(long_[i:i + n] == short for i in range(len(long_) - n + 1))


def quote_in_text(quote: str, text: str) -> bool:
    """Does `quote` appear in `text`, ignoring case, spacing and the straight/
    curly quote marks a model rewrites? (Discover fix 3: an invented quote is
    the tell of an invented name.)"""
    if not quote or not text:
        return False

    def squash(s: str) -> str:
        s = unicodedata.normalize("NFKC", s)
        for a, b in (("“", '"'), ("”", '"'), ("‘", "'"), ("’", "'"), ("—", "-"), ("–", "-")):
            s = s.replace(a, b)
        return _SPACE.sub(" ", s).casefold().strip().strip("\"'.,;:!?")

    q = squash(quote)
    return bool(q) and q in squash(text)


_SENTENCE = re.compile(r"(?<=[.!?])\s+")
_CAPWORD = re.compile(r"\b[A-Z][\w'-]{2,}")
_WORD = re.compile(r"[\w'-]+")


def named_in(text: str, personas: Iterable) -> list:
    """The personas `text` could be naming: a word of three letters or more from
    their name or an alias, or a capitalised word from inside a sentence of their
    description (where a nickname lives — "Answers to Ode."; a sentence's first
    word is skipped, or "Has" and "The" would pull in half a library), appears
    in the text as a whole word. Deliberately generous — the model decides; this
    only keeps people the chapter never mentions out of the prompt."""
    words = {w.casefold() for w in _WORD.findall(text or "")}
    out = []
    for p in personas:
        keys = [w for label in _labels(p) for w in _WORD.findall(label) if len(w) >= 3]
        desc = p.get("description") if isinstance(p, dict) else getattr(p, "description", None)
        for sentence in _SENTENCE.split((desc or "").strip()):
            keys.extend(m.group(0) for m in _CAPWORD.finditer(sentence) if m.start() > 0)
        if any(k.casefold() in words for k in keys):
            out.append(p)
    return out
