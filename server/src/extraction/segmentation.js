// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2024-2026 JustWrite contributors
// SPDX-FileCopyrightText: 2026 JustVoice contributors
//
// Paragraph segmentation — split each paragraph by speech marks into alternating narration /
// dialogue segments (the port of justvoice/extraction/segmentation.py).
//
// Lifted from JustWrite speakerAttribution.js, which read double quotes only. A book's speech
// marks are one of four styles (2026-09-30, Overview → Speech marks): "double" (“ ” and
// straight "), "single" (‘ ’ and straight '), "guillemets" (« » and » «) and "german" („ “
// and „ ”). A project picks one or leaves it on Auto, and Auto takes each chapter's main mark
// by counting (`detectMarks`). One style at a time: a book's other marks are quotes inside a
// speech, never speech of their own.
//
// Single quotes double as apostrophes, so in single mode a speech opens only at a word's start
// and closes only where no letter follows — the apostrophe in don’t never ends one. A trailing
// apostrophe inside speech (‘the boys’ bikes’) still closes it early; Script's Split and Merge
// fix that line by hand.
//
// Python's `\s`, `\b`, `\w` and `\d` are Unicode on str: the patterns use the kit's classes
// with the `u` flag (and the inline `(?i:…)` group, which Node 24 reads); Python's `$` is
// END (it also matches before a final newline).

import { B, D, PY_WS, pyMax, strip, W } from "@delebash/llm-runner/platform/py";
import { END } from "../py_compat.js";

export const SPEECH_MARKS = ["double", "single", "guillemets", "german"];

const S = `[${PY_WS}]`;
const NOT_S = `[^${PY_WS}]`;

// A single-quoted speech opens with ‘ or ' at a word's start — the paragraph's start, or after
// a space, bracket, dash or double quote — never on an elision ('tis, 'em, rock 'n' roll, the
// '90s), and something must follow it.
export const _SQ_OPEN =
  `(?<![^${PY_WS}(\\[—–"“])[‘']` + `(?!(?i:tis|twas|twere|twill|em|cause|cos|til|till|round|nuff|n)${B}|${D})(?=${NOT_S})`;
// ...and closes with ’ or ' after something, where no letter or digit follows.
const _SQ_CLOSE = `(?<=${NOT_S})[’'](?!${W})`;

// Each style's dialogue spans. Greedy enough to capture multi-sentence dialogue inside one set
// of marks; not greedy enough to swallow the next paragraph.
//
// A speech that runs over several paragraphs opens a mark on each one and closes only the
// last, so a mark that opens and never closes is speech to the paragraph's end — for straight
// quotes too (2026-09-29). Without the straight branch, The Speckled Band with its quotes
// straightened lost 14 paragraphs of speech, 1,247 of 6,473 spoken words, to the Narrator.
const PATTERN_SOURCES = {
  double: `“([^“”]*?)”|“([^“”]*?)${END}|"([^"]*?)"|"([^"]*?)${END}`,
  single: `${_SQ_OPEN}(.*?)${_SQ_CLOSE}|${_SQ_OPEN}(.*)${END}`,
  guillemets: `«([^«»]*?)»|«([^«»]*?)${END}|»([^«»]*?)«`,
  german: `„([^„“”]*?)[“”]|„([^„“”]*?)${END}`,
};
/** A fresh global pattern for a style (re.DOTALL → the `s` flag). */
const pattern = (style) => new RegExp(PATTERN_SOURCES[style], "gsu");

// The groups of each pattern that match a speech left open.
const _UNCLOSED = { double: [2, 4], single: [2], guillemets: [2], german: [2] };

// The marks a stored dialogue line keeps around its words, by style — the pairs
// `extraction_api._block_text` looks for in the analyzed text.
export const QUOTE_PAIRS = {
  double: [
    ["“", "”"],
    ['"', '"'],
  ],
  single: [
    ["‘", "’"],
    ["'", "'"],
    ["‘", "'"],
    ["'", "’"],
  ],
  guillemets: [
    ["«", "»"],
    ["»", "«"],
  ],
  german: [
    ["„", "“"],
    ["„", "”"],
  ],
};

// `re.match(r"\s*(?:[“\"«»„]|" + _SQ_OPEN + r")")` — anchored at the start only.
const _OPENS_SPEECH = new RegExp(`^${S}*(?:[“"«»„]|${_SQ_OPEN})`, "u");

const _FIRST_MARK = new RegExp(`(?<double>[“"])|(?<guillemets>[«»])|(?<german>„)|(?<single>${_SQ_OPEN})`, "u");

/**
 * The style a text's speech uses: the one whose mark comes first in the most paragraphs. Only
 * the first counts — a speech's own mark always opens before any quote inside it, so Helen
 * quoting her sister ‘…’ inside her “…” never outvotes the speech, and a German closing “
 * never reads as an English opening one. A tie, or no speech at all, is "double".
 */
export function detectMarks(text) {
  const counts = Object.fromEntries(SPEECH_MARKS.map((k) => [k, 0]));
  for (const para of splitIntoParagraphs(text)) {
    const m = _FIRST_MARK.exec(para);
    if (m) {
      const style = Object.entries(m.groups).find(([, v]) => v !== undefined)[0];
      counts[style] += 1;
    }
  }
  const best = pyMax(SPEECH_MARKS, (k) => counts[k]); // ties keep SPEECH_MARKS order
  return counts[best] ? best : "double";
}

/** A project's Speech marks setting for this text: a style as set, and Auto (or anything
 * unknown) read from the text. */
export function resolveMarks(setting, text) {
  return SPEECH_MARKS.includes(setting) ? setting : detectMarks(text);
}

/** Does a stored line start with a speech mark of any style? A dialogue block keeps its marks,
 * so this is how a line nothing decided (yours, an import's) is known to be speech. */
export function opensSpeech(text) {
  return _OPENS_SPEECH.test(text || "");
}

/** Does a speech open in this paragraph and never close — carrying on into the next one? */
export function leftOpen(paragraph, marks = null) {
  const style = SPEECH_MARKS.includes(marks) ? marks : detectMarks(paragraph);
  let last = null;
  for (const m of paragraph.matchAll(pattern(style))) last = m;
  return last !== null && _UNCLOSED[style].some((g) => last[g] !== undefined);
}

/** A stored dialogue line's words without the marks around them — what the segmenter hands on
 * for the same span. A mark left open stays off too. */
export function stripMarks(text) {
  const t = strip(text);
  const pairs = Object.values(QUOTE_PAIRS).flat();
  const opener = pairs.find(([o]) => t.startsWith(o))?.[0];
  if (opener === undefined) return t;
  const inner = t.slice(opener.length);
  const closer = pairs.find(([o, c]) => o === opener && inner.endsWith(c))?.[1] ?? "";
  return strip(inner.slice(0, inner.length - closer.length));
}

/**
 * Segments for a chapter already cut into lines — each line one segment, in order, so the rows
 * that come back map onto the lines one to one.
 *
 * A line is `{text, spoken, paragraph}`: `paragraph` is the analyzed text's paragraph it came
 * from (null for a line added by hand). Neighbouring lines of one paragraph read as one again —
 * the anchors and the three-in-a-row check are same-paragraph only — and a line with no
 * paragraph is its own. Paragraphs are renumbered 0..n-1, as the pipeline counts them.
 */
export function segmentsFromLines(lines) {
  const segments = [];
  let pIdx = -1;
  let prev = Symbol("none");
  let nextDid = 0;
  for (const ln of lines) {
    const para = ln.paragraph ?? null;
    if (para === null || para !== prev) pIdx += 1;
    prev = para;
    if (ln.spoken) {
      segments.push({ kind: "dialogue", text: stripMarks(ln.text), paragraph_idx: pIdx, dialogue_id: nextDid });
      nextDid += 1;
    } else {
      segments.push({ kind: "narration", text: strip(ln.text), paragraph_idx: pIdx });
    }
  }
  return segments;
}

/** The paragraphs a ready-cut segment list reads as, 0..n-1. */
export function paragraphsOf(segments) {
  const by = new Map();
  for (const s of segments) {
    if (!by.has(s.paragraph_idx)) by.set(s.paragraph_idx, []);
    by.get(s.paragraph_idx).push(s.text);
  }
  return [...by.keys()].sort((a, b) => a - b).map((i) => by.get(i).join(" "));
}

const PARA_BREAK = new RegExp(`\\n${S}*\\n`, "u");

/** Split a chapter / scene blob into paragraphs. JustWrite's pipeline expects
 * newline-delimited paragraphs. Multiple blank lines collapse to one separator. */
export function splitIntoParagraphs(text) {
  return strip(text)
    .split(PARA_BREAK)
    .map((p) => strip(p))
    .filter((p) => p);
}

/**
 * Walk paragraphs and emit a flat list of segments.
 *
 * Each segment is `{kind, text, paragraph_idx}` where kind is "narration" or "dialogue".
 * Dialogue segments also carry a chapter-wide `dialogue_id` integer (D1, D2, ...) that anchors
 * and the LLM both reference.
 *
 * `marks` is the speech-mark style (`SPEECH_MARKS`); null reads it from these paragraphs
 * (Auto). A caller segmenting one paragraph at a time passes the chapter's, since one
 * paragraph is too little to read it from. `startDialogueId` lets a caller continue numbering
 * across several calls.
 */
export function segmentParagraphs(paragraphs, { startDialogueId = 0, marks = null } = {}) {
  const segments = [];
  let nextDid = startDialogueId;
  const style = SPEECH_MARKS.includes(marks) ? marks : detectMarks(paragraphs.join("\n\n"));
  const re = pattern(style);

  paragraphs.forEach((para, pIdx) => {
    let lastEnd = 0;
    for (const m of para.matchAll(re)) {
      // Narration BEFORE this dialogue span (if any).
      if (m.index > lastEnd) {
        const narration = strip(para.slice(lastEnd, m.index));
        if (narration) segments.push({ kind: "narration", text: narration, paragraph_idx: pIdx });
      }
      // The dialogue itself.
      const dialogue = strip(m.slice(1).find((g) => g !== undefined) ?? "");
      if (dialogue) {
        segments.push({ kind: "dialogue", text: dialogue, paragraph_idx: pIdx, dialogue_id: nextDid });
        nextDid += 1;
      }
      lastEnd = m.index + m[0].length;
    }
    // Trailing narration after the last dialogue (or the whole paragraph when there's none).
    const tail = strip(para.slice(lastEnd));
    if (tail) segments.push({ kind: "narration", text: tail, paragraph_idx: pIdx });
  });

  return segments;
}
