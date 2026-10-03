# SPDX-License-Identifier: MIT
"""Kokoro's half of a lexicon's IPA (gap 3 of the audio.cpp switch).

Our copy of audio.cpp reads inline pronunciations — "[word](/phonemes/)", the markup
hexgrad/Kokoro's misaki uses: the word is spoken from the phonemes given and the rest of the
line through Kokoro's own G2P. Two jobs here:

- `to_kokoro`: a lexicon holds canonical IPA, and Kokoro's symbols are not that — it writes
  the affricates and the diphthongs as ONE symbol (ʧ, ʤ, A = eɪ, I = aɪ, W = aʊ, Y = ɔɪ,
  O = oʊ, Q = əʊ) and has no ASCII g (it is ɡ). Left as two symbols, "like" /laɪk/ would lose
  its off-glide and read "lack". A symbol Kokoro does not have is refused by the runtime,
  naming the word.
- `splice`: mark the words of a line that have an IPA entry, by the same rule the host uses to
  decide which entries a line carries (`render_core._ipa_words`): whole words, any case, the
  longest entry first, and every piece of the split that IS an entry — so a line spoken here
  and the cache key computed there always agree.
"""

from __future__ import annotations

import re

# IPA → Kokoro, longest first so "t͡ʃ" is not half-replaced by "tʃ".
_REPLACEMENTS = (
    ("t͡ʃ", "ʧ"), ("d͡ʒ", "ʤ"), ("tʃ", "ʧ"), ("dʒ", "ʤ"),
    ("eɪ", "A"), ("aɪ", "I"), ("aʊ", "W"), ("ɔɪ", "Y"), ("oʊ", "O"), ("əʊ", "Q"),
    ("ɝ", "ɜɹ"),
    ("͡", ""),   # any other tie bar
    (".", ""),        # syllable breaks — to Kokoro a "." is a full stop
    ("g", "ɡ"),
)


def to_kokoro(ipa: str) -> str:
    """Canonical IPA (with or without /…/ or […]) → Kokoro's phoneme symbols."""
    s = (ipa or "").strip()
    if len(s) >= 2 and s[0] in "/[" and s[-1] in "/]":
        s = s[1:-1]
    s = s.strip()
    for a, b in _REPLACEMENTS:
        s = s.replace(a, b)
    return s


def splice(text: str, ipa_map: dict[str, str]) -> str:
    """`text` with each word that has an IPA entry written as "[word](/kokoro phonemes/)"."""
    lookup = {g.strip().lower(): to_kokoro(p) for g, p in (ipa_map or {}).items()
              if g.strip() and (p or "").strip()}
    lookup = {k: v for k, v in lookup.items() if v}
    if not lookup or not text.strip():
        return text
    entries = sorted((g.strip() for g in ipa_map if g.strip().lower() in lookup), key=len, reverse=True)
    pattern = re.compile(r"\b(" + "|".join(re.escape(g) for g in entries) + r")\b", re.IGNORECASE)
    parts = pattern.split(text)
    if len(parts) == 1:
        return text
    return "".join(f"[{p}](/{lookup[p.lower()]}/)" if p and p.lower() in lookup else p for p in parts)
