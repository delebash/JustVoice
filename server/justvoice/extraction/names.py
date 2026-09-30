# SPDX-License-Identifier: MIT
"""Does a name found in the prose refer to a speaker the book already has?

One matcher for every place that asks it (decided 2026-09-27, Discover fixes
A / C / 1; speakers since the 2026-09-29 split): Discover dropping a proposal
for someone already in the book, and Discover's record of the speakers a
chapter names (`cast_named_in`).

What counts as the same person, most specific first:
  * the full name or any "Also called" name, compared case- and
    punctuation-blind;
  * a single word that is the speaker's first or last name ("Brick" →
    "Brick Halvorn", "Threll" → "Haldane Threll") — only for words of three
    letters or more, because "Al" or "Jo" would match half a cast.
A prefix is NOT a match: "Ode" is not "Odeline" unless someone recorded it as
an alias. Guessing there would merge different people with similar names.

Ambiguity is refused rather than guessed: when a name fits two speakers
("Vance" with Mara Vance and Edith Vance), `match` returns None and the
caller treats it as unmatched.
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


# Words a first/last-name hit never counts on: titles and the like, which
# begin names ("Old Sedge", "Mr. Armitage") and appear everywhere.
_NOT_A_NAME = {"the", "old", "young", "mr", "mrs", "miss", "ms", "dr", "sir", "lady",
               "lord", "master", "mister", "doctor", "captain", "saint", "st"}


def cast_named_in(text: str, personas: Iterable) -> list[dict]:
    """The book's speakers `text` names, for Discover's record of everyone a
    chapter names (2026-09-29) — found without the AI, so the same every scan.
    `personas` is the speakers ({id, name, aliases} dicts or rows).

    A speaker counts when its full name or an alias appears as a phrase, or
    when its first or last name (3+ letters, not a title) appears capitalised
    and belongs to no other speaker — ambiguity is refused, as in `match`.
    Returns `[{speaker_id, name, mentions, evidence}]` in order of first
    appearance; `evidence` is the sentence that first names them, trimmed."""
    pool = list(personas)
    body = text or ""
    owners: dict[str, list] = {}
    for p in pool:
        for label in _labels(p):
            words = [w for w in norm(label).split() if len(w) >= 3 and w not in _NOT_A_NAME]
            if len(norm(label).split()) >= 2:
                for w in {words[0], words[-1]} if words else set():
                    owners.setdefault(w, []).append(p)
    out = []
    for p in pool:
        spans: list[tuple[int, int]] = []
        for label in _labels(p):
            pat = r"\b" + r"\s+".join(re.escape(w) for w in label.split()) + r"\b"
            spans += [m.span() for m in re.finditer(pat, body, re.IGNORECASE)]
        for word, who in owners.items():
            if len(who) == 1 and who[0] is p:
                spans += [m.span() for m in re.finditer(r"\b" + re.escape(word.capitalize()) + r"\b", body)]
        if not spans:
            continue
        # "Mara Vance" also matches "Mara" and "Vance": one mention, not three.
        mentions, reach = 0, -1
        for s, e in sorted(spans):
            if s >= reach:
                mentions += 1
            reach = max(reach, e)
        first = min(s for s, _ in spans)
        start = max(body.rfind(".", 0, first), body.rfind("\n", 0, first)) + 1
        end = min([i for i in (body.find(".", first), body.find("\n", first)) if i >= 0] or [len(body)])
        sentence = body[start:end + 1].strip()
        if len(sentence) > 120:
            sentence = sentence[: 117].rstrip() + "…"
        pid = p.get("id") if isinstance(p, dict) else getattr(p, "id", None)
        name = p.get("name") if isinstance(p, dict) else getattr(p, "name", "")
        out.append({"speaker_id": pid, "name": name, "mentions": mentions,
                    "evidence": sentence, "_first": first})
    out.sort(key=lambda r: r.pop("_first"))
    return out
