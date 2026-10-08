// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2024-2026 JustWrite contributors
// SPDX-FileCopyrightText: 2026 JustVoice contributors
//
// Tier-aware prompt templates (the port of justvoice/extraction/prompts.py). JustWrite's audit
// identified two prompt bodies — strict-rules-only ("direct") and
// strict-rules-plus-four-worked-examples ("guided").
//
// Revised 2026-09-28 by measurement (docs/plans/2026-09-28-speaker-attribution-tuning.md):
// answers carry their [D#] id (pipeline.alignPicks matches by it — a positional array shifted
// whole chapters), each line is read in context, and clear two-person turn-taking is followed
// at inference confidence instead of forced to "unknown". This text + reasoning on + name
// handles in place of persona ids (pipeline.promptHandles): 535/536 on both books over two
// runs, and the guided route 268/268 (gemma-4-26b-a4b-qat, 2026-09-28).
//
// These texts seed the shared prompt rows (seed_feature_prompts.js) — byte for byte Python's.

import { strip, truthy } from "@delebash/llm-runner/platform/py";
import { pyStrOf } from "../py_compat.js";

export const DIRECT_SYSTEM = `You attribute dialogue in a novel chapter to its speaker.

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
`;

export const GUIDED_SYSTEM = `${DIRECT_SYSTEM}

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
`;

// (USER_TEMPLATE moved to seed_feature_prompts as the {{var}} template row — F1 Phase 2; the
// pipeline passes the format* outputs below as variables.)

const has = (c, k) => truthy(c[k]);

/** One line per character: `- id="c_mara", name="Mara", role=..., gender=...` */
export function formatCharacters(characters) {
  const lines = [];
  for (const c of characters) {
    const bits = [`id="${pyStrOf(c.id)}"`, `name="${pyStrOf(c.name)}"`];
    if (has(c, "role")) bits.push(`role="${pyStrOf(c.role)}"`);
    if (has(c, "gender")) bits.push(`gender="${pyStrOf(c.gender)}"`);
    if (has(c, "pronouns")) bits.push(`pronouns="${pyStrOf(c.pronouns)}"`);
    const aliases = truthy(c.aliases) ? c.aliases : [];
    if (aliases.length) bits.push(`aliases="${aliases.join(", ")}"`);
    lines.push(`- ${bits.join(", ")}`);
  }
  return lines.join("\n");
}

/** Render past writer corrections as a worked-examples block. Empty list → empty string (no
 * dangling header). */
export function formatCorrections(corrections) {
  if (!corrections?.length) return "";
  const lines = ["", "Past corrections from the writer (apply the same reasoning to similar lines):"];
  for (const c of corrections) {
    const snippet = strip(c.text_snippet || "").replaceAll("\n", " ");
    const speaker = c.speaker_id || "unknown";
    lines.push(`  - "${snippet}" → speaker id "${pyStrOf(speaker)}"`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Render the segmented chapter with inline [D#] markers. Walks the segment list paragraph by
 * paragraph and produces:
 *   paragraph 1 narration "[D1] dialogue" more narration
 *   paragraph 2 narration "[D2] dialogue"
 */
export function formatParagraphs(segments) {
  const byPara = new Map();
  for (const seg of segments) {
    const idx = Object.hasOwn(seg, "paragraph_idx") ? seg.paragraph_idx : 0;
    if (!byPara.has(idx)) byPara.set(idx, []);
    byPara.get(idx).push(seg.kind === "dialogue" ? `[D${seg.dialogue_id}] "${seg.text}"` : seg.text);
  }
  return [...byPara.keys()]
    .sort((a, b) => a - b)
    .map((i) => byPara.get(i).join(" "))
    .join("\n\n");
}
