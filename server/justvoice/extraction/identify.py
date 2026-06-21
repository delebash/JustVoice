# SPDX-License-Identifier: GPL-3.0-or-later
"""Speaker identification — "who exists in this text?"

Distinct from attribution ("who speaks THIS line?") per CONCEPTS.md §3/§13:
identification runs rarely (once per chapter/import), proposes NEW
characters as a review list, and never commits anything itself. The
client shows the candidates in the Script tab's discovered-speakers
banner; promotion to personas is an explicit user action.

The LLM output contract is a JSON array:
    [{"name": "Tom Harlan", "role_hint": "neighbor", "approx_lines": 11}, ...]
Parsing is defensive: code fences stripped, non-dict entries dropped,
names deduped case-insensitively against the known cast AND each other.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any, Callable

log = logging.getLogger(__name__)

IDENTIFY_SYSTEM = """You are a casting assistant for an audiobook producer.

You will receive manuscript text and a list of already-known character
names. Find SPEAKING characters in the text who are NOT in the known
list. Only include characters who actually speak dialogue. Use the name
the text itself uses for them (e.g. "the stranger" → "The Stranger").

Return ONLY a JSON array, no commentary:
[{"name": str, "role_hint": str, "approx_lines": int}, ...]
Return [] if every speaker is already known."""


@dataclass
class SpeakerCandidate:
    name: str
    role_hint: str | None = None
    approx_lines: int | None = None


def _strip_code_fences(text: str) -> str:
    m = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    return m.group(1) if m else text


def parse_candidates(raw: str, known_names: list[str]) -> list[SpeakerCandidate]:
    """Parse the LLM reply into deduped candidates. Tolerates fences,
    stray text around the array, and partially-malformed entries."""
    text = _strip_code_fences(raw).strip()
    start, end = text.find("["), text.rfind("]")
    if start < 0 or end <= start:
        return []
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        log.warning("identify: unparseable LLM reply: %.200s", raw)
        return []
    if not isinstance(data, list):
        return []

    known = {n.strip().lower() for n in known_names}
    known.update({"narrator", "unknown", ""})
    seen: set[str] = set()
    out: list[SpeakerCandidate] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", "")).strip()
        key = name.lower()
        if not name or key in known or key in seen:
            continue
        seen.add(key)
        approx = item.get("approx_lines")
        out.append(
            SpeakerCandidate(
                name=name,
                role_hint=(str(item.get("role_hint")).strip() or None)
                if item.get("role_hint")
                else None,
                approx_lines=int(approx) if isinstance(approx, (int, float)) else None,
            )
        )
    return out


def identify_speakers(
    text: str,
    known_names: list[str],
    *,
    settings,
    chat_fn: Callable[..., Any] | None = None,
) -> list[SpeakerCandidate]:
    """Run the identification LLM call. `chat_fn` is the dispatch seam —
    tests inject a stub; production uses engines.llm.dispatch.chat."""
    if chat_fn is None:
        from llm_runner.llm.dispatch import chat as chat_fn  # pragma: no cover

    from llm_runner.llm import LLMMessage
    from ..engines.llm.config import llm_config

    user = (
        "Known characters:\n"
        + "\n".join(f"- {n}" for n in known_names or ["(none)"])
        + "\n\nManuscript text:\n"
        + text
    )
    resp = chat_fn(
        config=llm_config(settings),
        feature="speaker_attribution",
        messages=[LLMMessage(role="user", content=user)],
        system=IDENTIFY_SYSTEM,
        temperature=0.2,
    )
    return parse_candidates(getattr(resp, "content", str(resp)), known_names)
