# SPDX-License-Identifier: MIT
# SPDX-FileCopyrightText: 2024-2026 JustWrite contributors
# SPDX-FileCopyrightText: 2026 JustVoice contributors

"""Tier-aware prompt templates.

JustWrite's audit identified two prompt bodies — strict-rules-only
("direct") and strict-rules-plus-four-worked-examples ("guided"). The
Reasoned tier shares the Direct body but enables Ollama's reasoning
blocks via think=True.
"""

from __future__ import annotations


DIRECT_SYSTEM = """You attribute dialogue in a novel chapter to its speaker.

You receive:
  - A list of cast characters with id + name + (optional) gender/pronouns/aliases.
  - A list of paragraphs with each dialogue segment marked [D1], [D2], etc.
  - Optionally a list of past corrections from the writer.

You return JSON only — an array, one entry per [D#] in the order they appear:

  [{"speaker": "<character_id>" | "unknown", "confidence": 0.0..1.0}, ...]

RULES:
  1. Narration is never tagged — only the [D#] dialogue segments.
  2. A speaker id MUST appear in the cast list. Never invent ids.
  3. If a dialogue segment has no clear speaker (bare quote, no
     surrounding tag, no nearby unique pronoun antecedent), return
     "unknown" with confidence 0.4.
  4. Past corrections (when supplied) are ground truth — apply the same
     reasoning to similar lines.
  5. Bare-quote turn-taking with no name tags is "unknown" — DO NOT
     guess by alternating.

Return only the JSON array. No prose, no preamble.
"""


GUIDED_SYSTEM = DIRECT_SYSTEM + """

WORKED EXAMPLES:

Example 1 — tagged dialogue + cast match:
  Cast: id="c_mara", name="Mara"
  Paragraph: "[D1] Mara said. She turned away."
  Answer: [{"speaker": "c_mara", "confidence": 0.95}]

Example 2 — off-cast role:
  Cast: id="c_mara", name="Mara"; id="c_chen", name="Detective Chen"
  Paragraph: "[D1] the bartender said, wiping a glass."
  Answer: [{"speaker": "unknown", "confidence": 0.4}]
  Reason: "the bartender" isn't in the cast — DO NOT match by semantic
  similarity to Detective Chen even though both are roles.

Example 3 — bare-quote turn-taking with no name:
  Cast: id="c_mara", name="Mara"; id="c_sarah", name="Sarah"
  Paragraph: "[D1] [D2] [D3]"
  Answer: [
    {"speaker": "unknown", "confidence": 0.4},
    {"speaker": "unknown", "confidence": 0.4},
    {"speaker": "unknown", "confidence": 0.4}
  ]
  Reason: No name tag = no anchor. Don't alternate.

Example 4 — mid-paragraph continuation through pronoun tag:
  Cast: id="c_mara", name="Mara"
  Paragraph: "[D1] Mara paused. [D2] she said, frowning."
  Answer: [
    {"speaker": "c_mara", "confidence": 0.9},
    {"speaker": "c_mara", "confidence": 0.9}
  ]
  Reason: "she said" continues the same speaker since Mara is the
  unambiguous pronoun antecedent.
"""


USER_TEMPLATE = """Characters in this scene:
{characters}
{corrections}
Paragraphs (dialogue segments tagged inline):

{paragraphs}

Return only the JSON array, one entry per [D#] in the order they appear.
"""


def format_characters(characters: list[dict]) -> str:
    """One line per character: `- id="c_mara", name="Mara", role=..., gender=...`"""
    lines: list[str] = []
    for c in characters:
        bits = [f'id="{c.get("id")}"', f'name="{c.get("name")}"']
        if c.get("role"):
            bits.append(f'role="{c.get("role")}"')
        if c.get("gender"):
            bits.append(f'gender="{c.get("gender")}"')
        if c.get("pronouns"):
            bits.append(f'pronouns="{c.get("pronouns")}"')
        aliases = c.get("aliases") or []
        if aliases:
            bits.append(f'aliases="{", ".join(aliases)}"')
        lines.append("- " + ", ".join(bits))
    return "\n".join(lines)


def format_corrections(corrections: list[dict]) -> str:
    """Render past writer corrections as a worked-examples block. Empty
    list → empty string (no dangling header)."""
    if not corrections:
        return ""
    lines = ["", "Past corrections from the writer (apply the same reasoning to similar lines):"]
    for c in corrections:
        snippet = (c.get("text_snippet") or "").strip().replace("\n", " ")
        speaker = c.get("character_id") or "unknown"
        lines.append(f'  - "{snippet}" → speaker id "{speaker}"')
    return "\n".join(lines) + "\n"


def format_paragraphs(segments: list[dict]) -> str:
    """Render the segmented chapter with inline [D#] markers.

    Walks the segment list paragraph by paragraph and produces:
      paragraph 1 narration "[D1] dialogue" more narration
      paragraph 2 narration "[D2] dialogue"
    """
    by_para: dict[int, list[str]] = {}
    for seg in segments:
        idx = seg.get("paragraph_idx", 0)
        if seg["kind"] == "dialogue":
            by_para.setdefault(idx, []).append(f"[D{seg['dialogue_id']}] \"{seg['text']}\"")
        else:
            by_para.setdefault(idx, []).append(seg["text"])
    return "\n\n".join(
        " ".join(by_para[i]) for i in sorted(by_para.keys())
    )
