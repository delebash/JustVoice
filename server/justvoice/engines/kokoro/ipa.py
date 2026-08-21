# SPDX-License-Identifier: MIT
"""Per-word IPA splicing for Kokoro — the lexicon's pronunciation column,
finally reaching the audio.

Kokoro renders phonemes, not letters; its own reader (espeak) guesses
pronunciations, and the lexicon's ``phoneme_ipa`` entries are the operator
saying "this word is /wˈʊstər/, stop guessing". The host collects those
entries into ``delivery.ipa_map`` (render_core._apply_lexicons); this
module splices them into the phoneme stream:

    text  ──split on the mapped words──►  segments
    segments the map does not cover  ──engine's own phonemizer──►  phonemes
    segments it does cover           ──the given IPA, verbatim──►  phonemes
    joined  ──►  one phoneme line  ──►  create(..., is_phonemes=True)

Pure by design — the phonemizer arrives as a callable — so the splice is
testable from the host env, where kokoro-onnx and espeak do not exist.
"""

from __future__ import annotations

import re
from collections.abc import Callable


def splice(
    text: str,
    ipa_map: dict[str, str],
    phonemize: Callable[[str], str],
) -> str | None:
    """One phoneme line for `text`, with the mapped words pronounced as
    given and everything else phonemized by `phonemize`.

    Matching is case-insensitive on word boundaries — "worcester",
    "Worcester" and "WORCESTER" all take the mapped pronunciation, but
    "Worcestershire" never does (that word needs its own entry). Longer
    graphemes match first so a multi-word entry beats its own substring.

    Returns None when nothing matched or the phonemizer failed — the
    caller falls back to the plain-text path, because a render that
    ignores one lexicon entry beats a render that crashes.
    """
    entries = [(g.strip(), p.strip()) for g, p in ipa_map.items() if g.strip() and p.strip()]
    if not entries or not text.strip():
        return None
    entries.sort(key=lambda e: len(e[0]), reverse=True)

    pattern = re.compile(
        r"\b(" + "|".join(re.escape(g) for g, _ in entries) + r")\b",
        re.IGNORECASE,
    )
    by_lower = {g.lower(): ipa for g, ipa in entries}

    parts = pattern.split(text)
    if len(parts) == 1:
        return None  # no mapped word in this line

    out: list[str] = []
    try:
        for part in parts:
            if not part:
                continue
            ipa = by_lower.get(part.lower())
            if ipa is not None:
                out.append(ipa)
            elif part.strip():
                phonemes = phonemize(part).strip()
                if phonemes:
                    out.append(phonemes)
    except Exception:
        return None  # phonemizer failure → plain-text fallback, never a crash
    return " ".join(out) or None
