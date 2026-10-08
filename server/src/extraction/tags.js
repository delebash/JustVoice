// SPDX-License-Identifier: MIT
// Dialogue tags — narration that only says who spoke ("said Marius,") (the port of
// justvoice/extraction/tags.py).
//
// Overview's "Leave out dialogue tags" (2026-09-30, docs/plans/2026-09-30-script-leftovers.md
// B4): with every speaker in their own voice, the narrator reading "said Marius" between two
// of Marius's lines only repeats what the listener already hears. A line is left out only
// when it is NOTHING but a tag — who, a dialogue verb, perhaps an adverb — and sits next to a
// spoken line of the same paragraph. "said Marius, turning away" is still read, and so is any
// line of a chapter never analyzed (it has no paragraphs to go by).
//
// One function for every render path (chapter audio, M4B export, captions) and for Script's
// "Left out" tag, so what Script shows is what the audio skips. The verbs are the anchors'
// (anchors.DIALOGUE_VERBS), so English tags only.
//
// Ported in full by the render wave (wave C), which reads `leftOutBlocks`. Python's `\w` and
// `\s` are Unicode on str: the kit's classes stand in, with the `u` flag.

import { PY_WS, strip, truthy } from "@delebash/llm-runner/platform/py";
import { DIALOGUE_VERBS } from "./anchors.js";
import { spokenBlock } from "./flags.js";

const S = `[${PY_WS}]`;
const WORDISH = "[\\p{L}\\p{N}_’'-]"; // [\w’'-]
const _TITLE = `(?:(?:Mr|Mrs|Ms|Dr|St)\\.?${S}|Miss${S}|Sir${S}|Lady${S}|Lord${S}|Captain${S}|Master${S})?`;
const _NAME = `${_TITLE}[A-Z]${WORDISH}*(?:${S}[A-Z]${WORDISH}*){0,2}`;
const _PRONOUN = "(?:[Hh]e|[Ss]he|[Tt]hey|I|[Ww]e|[Yy]ou|[Ii]t)";
const _THE = `(?:[Tt]he${S}[a-z]${WORDISH}*(?:${S}[a-z]${WORDISH}*)?)`;
const _WHO = `(?:${_PRONOUN}|${_THE}|${_NAME})`;
const _VERB = `(?i:${DIALOGUE_VERBS.join("|")})`;
const _HOW = `(?:${S}(?:[a-z]+ly|again|aloud|at${S}last|at${S}once))?`;
// fullmatch → anchored at both ends.
const _TAG_ONLY = new RegExp(
  `^(?:[,;:—–-]?${S}*(?:${_WHO}${S}${_VERB}|${_VERB}${S}${_WHO})${_HOW}${S}*[,.;:!?—–-]*)$`,
  "u",
);

/** Is this narration nothing but a dialogue tag? */
export function isTagOnly(text) {
  return _TAG_ONLY.test(strip(text || ""));
}

/**
 * The ids of the lines "Leave out dialogue tags" skips. `lines` are a chapter's readable lines
 * in order, each `{id, text, spoken, paragraph}` — `paragraph` from the analyzed text, null
 * when there is none.
 */
export function leftOut(lines) {
  const out = new Set();
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.spoken || ln.paragraph == null || !isTagOnly(ln.text)) continue;
    for (const j of [i - 1, i + 1]) {
      const near = j >= 0 && j < lines.length ? lines[j] : null;
      if (near !== null && near.spoken && near.paragraph === ln.paragraph) {
        out.add(ln.id);
        break;
      }
    }
  }
  return out;
}

/** `leftOut` over a chapter's stored blocks, in order. Blank lines and podcast markers are not
 * readable lines, so they are no one's neighbour. */
export function leftOutBlocks(blocks) {
  const lines = [];
  for (const b of blocks) {
    if (!strip(b.text || "")) continue;
    let meta;
    try {
      meta = JSON.parse(b.metadata_json || "{}");
    } catch {
      meta = {};
    }
    if (meta === null || typeof meta !== "object" || Array.isArray(meta)) meta = {};
    if (truthy(meta.marker)) continue;
    lines.push({ id: b.id, text: b.text, spoken: spokenBlock(b.source, b.text), paragraph: meta.paragraph_idx ?? null });
  }
  return leftOut(lines);
}
