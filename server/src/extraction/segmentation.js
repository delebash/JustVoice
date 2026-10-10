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

import { B, D, END, PY_WS, pyMax, strip, W } from "@delebash/llm-runner/platform/py";

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

// Curly double quotes have a direction, so a paragraph that uses them is read by counting
// instead of by the pattern (2026-10-10): a “ inside an open speech opens a quote within it,
// its ” closes that, and the next ” ends the speech — Alice's Dormouse, “… you know you say
// things are “much of a muchness”—did you ever see such a thing…?”, is one line, where the
// pattern kept only the phrase he quotes. Straight quotes have no direction and keep the
// pattern; so do the other styles.
const CURLY_OPEN = "“";
const CURLY_CLOSE = "”";
const hasCurly = (para) => para.includes(CURLY_OPEN) || para.includes(CURLY_CLOSE);

/** The paragraph's first curly double mark: "open", "close", or null when it has none. */
function firstCurly(para) {
  const o = para.indexOf(CURLY_OPEN);
  const c = para.indexOf(CURLY_CLOSE);
  if (o < 0 && c < 0) return null;
  if (o < 0) return "close";
  if (c < 0) return "open";
  return o < c ? "open" : "close";
}

/**
 * The speeches in a paragraph, by counting curly double marks. `carried`: a speech from the
 * paragraphs before is still open at this one's start. → `{at, start, end, stop, unclosed}`
 * per speech: `at..stop` is the whole span, marks included; `start..end` its words. A closing
 * mark with no speech open is left as text, as the pattern leaves it.
 */
function curlySpans(para, carried = false) {
  const spans = [];
  let depth = carried ? 1 : 0;
  let at = 0;
  let start = 0;
  for (let i = 0; i < para.length; i++) {
    const ch = para[i];
    if (ch === CURLY_OPEN) {
      if (depth === 0) {
        at = i;
        start = i + 1;
      }
      depth += 1;
    } else if (ch === CURLY_CLOSE && depth > 0) {
      depth -= 1;
      if (depth === 0) spans.push({ at, start, end: i, stop: i + 1, unclosed: false });
    }
  }
  if (depth > 0) spans.push({ at, start, end: para.length, stop: para.length, unclosed: true });
  return spans;
}

/**
 * Is a speech left open before `paragraphs[i]` still running through it? Only when the speech
 * comes back to close: `paragraphs[i]` opens with a closing mark, or it and the paragraphs
 * after it have no curly mark at all until one that does — and that one's first mark closes.
 * The Hatter's song is the case (Alice VII): his speech opens, the verse has no marks, and
 * “You know the song, perhaps?” ends on a closing mark. A speech that never comes back to
 * close leaves the paragraphs after it as they were, so a missing mark can't swallow narration.
 */
function carriedInto(paragraphs, i) {
  for (let j = i; j < paragraphs.length; j++) {
    const first = firstCurly(paragraphs[j]);
    if (first !== null) return first === "close";
  }
  return false;
}

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
  if (style === "double" && hasCurly(paragraph)) return curlySpans(paragraph).at(-1)?.unclosed ?? false;
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
  // A curly speech left open at the end of the paragraph before (see `carriedInto`).
  let open = false;

  paragraphs.forEach((para, pIdx) => {
    const carried = style === "double" && open && carriedInto(paragraphs, pIdx);
    // Each span: [at, stop) the whole match, the words between `start` and `end`.
    const spans =
      style === "double" && (carried || hasCurly(para))
        ? curlySpans(para, carried)
        : [...para.matchAll(re)].map((m) => {
            const g = m.slice(1).findIndex((x) => x !== undefined);
            const words = m[g + 1] ?? "";
            const start = m.index + m[0].indexOf(words);
            return { at: m.index, start, end: start + words.length, stop: m.index + m[0].length, unclosed: false };
          });
    let lastEnd = 0;
    for (const sp of spans) {
      // Narration BEFORE this dialogue span (if any).
      if (sp.at > lastEnd) {
        const narration = strip(para.slice(lastEnd, sp.at));
        if (narration) segments.push({ kind: "narration", text: narration, paragraph_idx: pIdx });
      }
      // The dialogue itself.
      const dialogue = strip(para.slice(sp.start, sp.end));
      if (dialogue) {
        segments.push({ kind: "dialogue", text: dialogue, paragraph_idx: pIdx, dialogue_id: nextDid });
        nextDid += 1;
      }
      lastEnd = sp.stop;
    }
    // Trailing narration after the last dialogue (or the whole paragraph when there's none).
    const tail = strip(para.slice(lastEnd));
    if (tail) segments.push({ kind: "narration", text: tail, paragraph_idx: pIdx });
    open = spans.length > 0 && spans[spans.length - 1].unclosed;
  });

  return segments;
}
