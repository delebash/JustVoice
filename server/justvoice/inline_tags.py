"""Inline expression tag parser — `[laugh]`, `[pause:0.5s]`,
`[whisper]...[/whisper]`, `[speed:0.7]...[/speed]`, `[pitch:-3]...[/pitch]`.

Produces a token stream the per-engine dispatchers translate into either
native paralinguistic markers (Chatterbox-Turbo, MOSS) or instruct-field
insertions (Qwen3) or strip-with-warning (Kokoro).
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass
class TextToken:
    text: str


@dataclass
class TagToken:
    name: str        # 'laugh', 'sigh', 'cough', 'pause', 'whisper', 'speed', 'pitch', 'breath', 'gasp', 'chuckle'
    arg: str | None = None  # '0.5s' for pause, '0.7' for speed, '-3' for pitch
    open: bool | None = None  # True for [whisper], False for [/whisper], None for atomic


# Atomic tags carry one inline cue; span tags wrap a region.
ATOMIC = {"laugh", "sigh", "cough", "breath", "gasp", "chuckle", "pause"}
SPANS = {"whisper", "speed", "pitch"}

_TAG_RE = re.compile(r"\[(/?)(\w+)(?::([-\d.\w]+))?\]")


def parse(text: str) -> list[TextToken | TagToken]:
    """Tokenize `text` into a flat stream of literal-text + tag tokens."""
    tokens: list[TextToken | TagToken] = []
    pos = 0
    for m in _TAG_RE.finditer(text):
        start, end = m.span()
        if start > pos:
            tokens.append(TextToken(text=text[pos:start]))
        closing = m.group(1) == "/"
        name = m.group(2).lower()
        arg = m.group(3)
        if name in ATOMIC:
            tokens.append(TagToken(name=name, arg=arg, open=None))
        elif name in SPANS:
            tokens.append(TagToken(name=name, arg=arg, open=not closing))
        else:
            # Unknown tag — pass through as literal text
            tokens.append(TextToken(text=m.group(0)))
        pos = end
    if pos < len(text):
        tokens.append(TextToken(text=text[pos:]))
    return tokens


def strip(text: str) -> str:
    """Strip all known tags. Used by engines that don't support paralinguistic cues."""
    out: list[str] = []
    for t in parse(text):
        if isinstance(t, TextToken):
            out.append(t.text)
    return "".join(out)
