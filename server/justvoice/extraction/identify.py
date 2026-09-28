# SPDX-License-Identifier: MIT
"""Speaker identification — "who exists in this text?"

Distinct from attribution ("who speaks THIS line?") per CONCEPTS.md §3/§13:
identification runs rarely (once per chapter/import), proposes NEW
characters as a review list, and never commits anything itself. The
client shows the candidates in the Script tab's discovered-speakers
banner; promotion to personas is an explicit user action.

The LLM output contract is a JSON array:
    [{"name": "Tom Harlan", "role_hint": "neighbor", "approx_lines": 11,
      "evidence": "Tom Harlan kept the ledger"}, ...]
`evidence` is the quote that names the character, so a proposal can be judged
without opening the chapter.
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

# The SHIPPED DEFAULT for the `speaker_attribution.identify` feature row — it
# seeds a new database once. What runs is the live row in AI Settings →
# Features. Revised 2026-09-27 (fix options 1 + 2 + 4): the old text asked for
# speakers only and offered "the stranger" as a name, so the old seeded demo
# got "child" / "the elder" (a chapter that names no one) and lost Edith (a
# named character it judged silent). Now: named characters only, speaking or
# not, each with the quote that names them. Then (fixes B + 2): never a named
# object, and a known character's nicknames and description are honoured.
IDENTIFY_SYSTEM = """You are a casting assistant for an audiobook producer.

You will receive a passage of manuscript text and the list of characters already in the cast. List every CHARACTER the passage names who is NOT in that list, whether or not they speak in this passage. Who speaks which line is decided later; your only job is to find the people.

A character is a person, or a creature that could talk. They count only when the text gives them a proper name ("Edith", "Tom Harlan") or a title the text uses as their name ("the harbour-master", "Captain Hale"). Never list a named object, weapon, tool, ship, building, place or organisation, however it is described — a sword with a name is not a character. Never make up a label from how someone speaks or how they are addressed: "child", "the elder", "a voice", "the speaker", "someone" are not characters. If a line of dialogue is never tied to a name, propose no one for it.

Each known character may list other names they go by and a one-line description. Leave out the narrator and every known character, however the text refers to them: a first name, a surname, a nickname, or a name from their description ("Answers to Ode" means "Ode" is that person). Compare names ignoring case.

For each character give:
- name: exactly as the text writes it
- role_hint: a few words on who they are, taken from the text only
- approx_lines: how many lines of dialogue they speak in this passage, 0 if none
- evidence: the shortest exact quote from the passage that names them

Return ONLY a JSON array, no commentary:
[{"name": str, "role_hint": str, "approx_lines": int, "evidence": str}, ...]
Return [] if there is no one new."""


@dataclass
class SpeakerCandidate:
    name: str
    role_hint: str | None = None
    approx_lines: int | None = None
    evidence: str | None = None


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
                evidence=(str(item.get("evidence")).strip() or None) if item.get("evidence") else None,
            )
        )
    return out


def _describe(sheet: str | None) -> str:
    """The first line of a character sheet, trimmed — enough to tell the model
    who someone is ("Answers to Ode.") without spending the whole sheet."""
    line = (sheet or "").strip().splitlines()[0].strip() if (sheet or "").strip() else ""
    return line if len(line) <= 200 else line[:197].rstrip() + "…"


def format_known(known: list) -> str:
    """The cast as the model reads it (Discover fix 2, 2026-09-27): each
    person's other names and a one-line description, not just a bare name —
    the bare list is what let "Ode" read as a stranger.

    `known` holds names (the Lab's free-text list) or dicts
    {name, aliases, description}."""
    lines = []
    for k in known or []:
        if isinstance(k, str):
            if k.strip():
                lines.append(f"- {k.strip()}")
            continue
        name = (k.get("name") or "").strip()
        if not name:
            continue
        bit = f"- {name}"
        aliases = [a for a in (k.get("aliases") or []) if a]
        if aliases:
            bit += f" (also called: {', '.join(aliases)})"
        desc = _describe(k.get("description"))
        if desc:
            bit += f" — {desc}"
        lines.append(bit)
    return "\n".join(lines) or "- (none)"


def known_labels(known: list) -> list[str]:
    """Every name and alias in `known`, for the parser's exact-match drop."""
    out: list[str] = []
    for k in known or []:
        if isinstance(k, str):
            out.append(k)
        else:
            out.extend([k.get("name") or "", *(k.get("aliases") or [])])
    return [n for n in out if n]


def identify_speakers(
    text: str,
    known_names: list,
    *,
    settings,
    run_fn: Callable[..., Any] | None = None,
    raw_out: dict | None = None,
) -> list[SpeakerCandidate]:
    """Run the identification LLM call through the shared run path. `run_fn`
    is the seam — tests inject a stub; production uses engines.llm.run's
    run_feature (the `speaker_attribution.identify` template row + its preset;
    `settings` is unused since the pin-era config died, kept for the callers'
    signature until the settings tree sheds its LLM residue). `raw_out`
    receives the run's usage (§16 — the responses carry the numbers)."""
    del settings  # pin-era argument — routing is preset-resolved now
    if run_fn is None:
        from ..engines.llm.run import run_feature as run_fn  # pragma: no cover

    import time

    t0 = time.monotonic()
    resp = run_fn(
        "speaker_attribution.identify",
        {
            "known_characters": format_known(known_names),
            "manuscript": text,
        },
    )
    if raw_out is not None:
        raw_out["usage"] = {
            "prompt_tokens": int(getattr(resp, "prompt_tokens", 0) or 0),
            "completion_tokens": int(getattr(resp, "completion_tokens", 0) or 0),
            "duration_ms": int((time.monotonic() - t0) * 1000),
            "model": getattr(resp, "model", "") or "",
        }
    return parse_candidates(getattr(resp, "text", str(resp)), known_labels(known_names))
