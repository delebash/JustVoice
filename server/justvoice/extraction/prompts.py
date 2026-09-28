# SPDX-License-Identifier: MIT
# SPDX-FileCopyrightText: 2024-2026 JustWrite contributors
# SPDX-FileCopyrightText: 2026 JustVoice contributors

"""Tier-aware prompt templates.

JustWrite's audit identified two prompt bodies — strict-rules-only
("direct") and strict-rules-plus-four-worked-examples ("guided").
"""

from __future__ import annotations


# Revised 2026-09-28 by measurement (docs/plans/2026-09-28-speaker-attribution-tuning.md):
# answers carry their [D#] id (pipeline.align_picks matches by it — a positional array shifted
# whole chapters), each line is read in context, and clear two-person turn-taking is followed
# at inference confidence instead of forced to "unknown". Shipped prompt: 55% right on The
# Ninth Facet, 64% on The Salt-Iron Road. This text + reasoning on + name handles in place of
# persona ids (pipeline.prompt_handles): 535/536 on both books over two runs, and the guided
# route 268/268 (gemma-4-26b-a4b-qat, 2026-09-28).
DIRECT_SYSTEM = """You attribute dialogue in a novel chapter to its speaker.

You receive:
  - A list of cast characters with id + name + (optional) gender/pronouns/aliases.
  - A list of paragraphs with each dialogue segment marked [D1], [D2], etc.
  - Optionally a list of past corrections from the writer.

You return JSON only — an array, one entry per [D#] in the order they appear, each naming its [D#]:

  [{"id": "D0", "speaker": "<character_id>" | "unknown", "confidence": 0.0..1.0}, ...]

Every [D#] gets exactly one entry, even when two segments sit side by side in one paragraph.

RULES:
  1. Narration is never tagged — only the [D#] dialogue segments.
  2. A speaker id MUST appear in the cast list, copied exactly as written
     there. Never invent ids.
  3. Read each line in context — the narration around it, who was just
     addressed, who acts in the same paragraph, who the pronoun ("she said")
     points back to. The character whose actions or thoughts fill a
     paragraph is usually the one speaking in it.
  4. Past corrections (when supplied) are ground truth — apply the same
     reasoning to similar lines.
  5. Untagged back-and-forth between two known speakers follows the turn
     order: when a short exchange alternates between two people and nothing
     interrupts it, give each line to the next speaker in turn, with
     confidence 0.6-0.75 (it is an inference, not a tag). If a third person
     could be speaking, or the exchange is broken by narration that changes
     the subject, answer "unknown" with confidence 0.4.

Return only the JSON array. No prose, no preamble.
"""


GUIDED_SYSTEM = DIRECT_SYSTEM + """

WORKED EXAMPLES:

Example 1 — tagged dialogue + cast match:
  Cast: id="c_mara", name="Mara"
  Paragraph: "[D0] Mara said. She turned away."
  Answer: [{"id": "D0", "speaker": "c_mara", "confidence": 0.95}]

Example 2 — off-cast role:
  Cast: id="c_mara", name="Mara"; id="c_chen", name="Detective Chen"
  Paragraph: "[D0] the bartender said, wiping a glass."
  Answer: [{"id": "D0", "speaker": "unknown", "confidence": 0.4}]
  Reason: "the bartender" isn't in the cast — DO NOT match by semantic
  similarity to Detective Chen even though both are roles.

Example 3 — untagged turn-taking between two people:
  Cast: id="c_mara", name="Mara"; id="c_sarah", name="Sarah"
  Paragraphs: "[D0] Mara said." / "[D1]" / "[D2]"
  Answer: [
    {"id": "D0", "speaker": "c_mara", "confidence": 0.95},
    {"id": "D1", "speaker": "c_sarah", "confidence": 0.7},
    {"id": "D2", "speaker": "c_mara", "confidence": 0.7}
  ]
  Reason: only two people are talking and nothing interrupts, so the
  untagged lines follow the turn order — at inference confidence.

Example 4 — mid-paragraph continuation through pronoun tag:
  Cast: id="c_mara", name="Mara"
  Paragraph: "[D0] Mara paused. [D1] she said, frowning."
  Answer: [
    {"id": "D0", "speaker": "c_mara", "confidence": 0.9},
    {"id": "D1", "speaker": "c_mara", "confidence": 0.9}
  ]
  Reason: "she said" continues the same speaker since Mara is the
  unambiguous pronoun antecedent.
"""


# (USER_TEMPLATE moved to seed_feature_prompts.py as the {{var}} template row —
# F1 Phase 2; the pipeline passes the format_* outputs below as variables.)


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
        speaker = c.get("persona_id") or "unknown"
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
