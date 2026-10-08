// SPDX-License-Identifier: MIT
// Where to read closely — Script's Check column (§8.24, 3a) — and whether a stored line is
// speech (the port of justvoice/extraction/flags.py).
//
// The model is right on nearly every line and sure even when wrong, so its confidence is no
// warning. What it measurably gets wrong has a shape, and these checks mark that shape
// (docs/plans/2026-08-15-voice-workflow-redesign.md §8.23, §8.25 — each was measured on
// answer-keyed books before it was built):
//
// * run — one speaker speaks three or more turns in a row: back-to-back spoken paragraphs, no
//   narration-only paragraph between, all given to them. Its most common mistake is losing
//   track of turns in a back-and-forth, and it shows up exactly like this. The WHOLE run is
//   one group — the wrong line is as often the middle one as the last. A speech over several
//   paragraphs (each opens a quote, only the last closes it) is one turn.
// * only — a speaker's only line in the chapter.
// * disagree — the book named one speaker and the model said another.
// * nearby — the second look named the speaker from a nearby chapter (always worth a look).
//
// The narrator is an ordinary speaker in every check (2026-09-29): any speaker can narrate, so
// a "speech given to the Narrator" check would mark a first-person narrator's every line.
//
// A line you set or confirmed (`corrected`) is never marked, and neither is one nothing
// decided (`manual`, an import's own). Only what Analyze decided is.
//
// One function for the app and the eval: the eval imports this, so every eval run measures
// what ships.
//
// The dataclasses keep their Python field names (`llm_speaker`): the API reads them field for
// field into its wire models.

import { leftOpen, opensSpeech } from "./segmentation.js";

// The sources an Analyze run writes for a spoken line ("second_look": the second look named
// the speaker from the chapters around it, 2026-10-05).
export const DECIDED = new Set(["tag", "propagated", "llm", "floored", "second_look"]);

/** One line of a chapter, in reading order. */
export class Line {
  /**
   * `speaker`: speaker id, null = no speaker. `paragraph`: the paragraph of the analyzed text
   * it came from; null (an imported or pasted line) = a paragraph of its own. `llm_speaker`:
   * set only where the book's words decided the line and the model had said someone else.
   */
  constructor({ id, speaker, text = "", spoken = true, source = null, paragraph = null, llm_speaker = null, marker = false }) {
    this.id = id;
    this.speaker = speaker ?? null;
    this.text = text;
    this.spoken = spoken;
    this.source = source;
    this.paragraph = paragraph;
    this.llm_speaker = llm_speaker;
    this.marker = marker;
  }
}

export class FlagGroup {
  /** `check`: "run" | "only" | "disagree" | "nearby"; `speaker`: whose line(s) these are;
   * `lines`: the ids marked; `turns` (run): how many turns with no reply; `other`
   * (disagree): who the model said. */
  constructor(check, speaker, lines = [], { turns = 0, other = null } = {}) {
    this.check = check;
    this.speaker = speaker;
    this.lines = lines;
    this.turns = turns;
    this.other = other;
  }
}

/** A paragraph that opens a quote and never closes it — a speech that carries on into the
 * next paragraph. `marks` is the chapter's speech-mark style; one paragraph is too little to
 * read it from, so pass it. */
export function quoteLeftOpen(text, marks = null) {
  return leftOpen(text, marks);
}

function _paragraphs(lines) {
  const out = [];
  for (const ln of lines) {
    if (ln.marker) continue;
    const last = out[out.length - 1];
    if (last && ln.paragraph !== null && last[0].paragraph === ln.paragraph) last.push(ln);
    else out.push([ln]);
  }
  return out;
}

const _marked = (lines) => lines.filter((ln) => DECIDED.has(ln.source)).map((ln) => ln.id);

/**
 * The chapter's flag groups, in reading order of their first line.
 *
 * `castIds` is the project's cast now (a Set). `openParagraphs` names the paragraphs whose
 * quote is left open, for a caller whose lines have lost their quote marks (the eval reads the
 * pipeline's rows); without it, the lines' own text is read — a stored dialogue block keeps
 * its quote marks — in the chapter's `marks` style.
 */
export function flagGroups(lines, castIds, { openParagraphs = null, marks = null } = {}) {
  const groups = [];
  const cast = castIds instanceof Set ? castIds : new Set(castIds);
  const openSet = openParagraphs == null ? null : openParagraphs instanceof Set ? openParagraphs : new Set(openParagraphs);

  // ── Three in a row ──────────────────────────────────────────────────
  const paras = _paragraphs(lines);
  let run = []; // turns; each turn is one or more paragraphs
  let runWho = null;
  let openLast = false;

  const close = () => {
    if (run.length >= 3) {
      const marked = _marked(run.flat().filter((ln) => ln.spoken));
      if (marked.length) groups.push(new FlagGroup("run", runWho, marked, { turns: run.length }));
    }
  };

  for (const para of paras) {
    const spoken = para.filter((ln) => ln.spoken);
    const who = new Set(spoken.map((ln) => ln.speaker));
    if (!spoken.length || who.size !== 1 || who.has(null)) {
      close();
      run = [];
      runWho = null;
      openLast = false;
      continue;
    }
    const [w] = who;
    if (w === runWho && run.length && openLast) {
      run[run.length - 1] = [...run[run.length - 1], ...para]; // the same speech carrying on
    } else if (w === runWho) {
      run.push([...para]);
    } else {
      close();
      run = [[...para]];
      runWho = w;
    }
    const first = para[0].paragraph;
    openLast =
      openSet !== null && first !== null ? openSet.has(first) : quoteLeftOpen(para.map((ln) => ln.text).join(" "), marks);
  }
  close();

  // ── One line at a time ──────────────────────────────────────────────
  const spokenAll = lines.filter((ln) => ln.spoken && !ln.marker);
  const count = new Map();
  for (const ln of spokenAll) count.set(ln.speaker, (count.get(ln.speaker) || 0) + 1);
  for (const ln of spokenAll) {
    if (!DECIDED.has(ln.source)) continue;
    const w = ln.speaker;
    // The second look named the speaker from a nearby chapter — always worth a look (decided
    // 2026-10-05: its answers are "marked to check"). First, so it is the question Script asks
    // of the line (its first mark).
    if (ln.source === "second_look" && w) groups.push(new FlagGroup("nearby", w, [ln.id]));
    if (w && cast.has(w) && count.get(w) === 1) groups.push(new FlagGroup("only", w, [ln.id]));
    if (ln.llm_speaker && ln.llm_speaker !== w) groups.push(new FlagGroup("disagree", w, [ln.id], { other: ln.llm_speaker }));
  }

  const order = new Map(lines.map((ln, i) => [ln.id, i]));
  // A stable sort, as Python's.
  return groups
    .map((g, i) => [order.get(g.lines[0]) ?? 0, i, g])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map((x) => x[2]);
}

/** The model's pick worth keeping: only where the book's words decided the line and the model
 * said someone else. null otherwise. */
export function modelDisagreed(source, speaker, llmSpeaker) {
  if ((source !== "tag" && source !== "propagated") || !llmSpeaker || llmSpeaker === "unknown") return null;
  return llmSpeaker !== speaker ? llmSpeaker : null;
}

/** A pipeline result (AttributionRow objects or dicts, as analyze-text returns them) as Lines —
 * the eval's door. Dialogue ids are `D0, D1, …`, the answer key's numbering. */
export function linesFromRows(rows, { narratorIds = ["narrator"] } = {}) {
  const out = [];
  let d = 0;
  rows.forEach((r, i) => {
    const spoken = r.kind === "dialogue";
    let spk = r.speaker ?? null;
    spk = spk === null || spk === "" || spk === "unknown" ? null : narratorIds.includes(spk) ? "narrator" : spk;
    let llm = r.llm_speaker ?? null;
    llm = narratorIds.includes(llm) ? "narrator" : llm;
    out.push(
      new Line({
        id: spoken ? `D${d}` : `N${i}`,
        speaker: spk,
        text: r.text || "",
        spoken,
        source: r.source ?? null,
        paragraph: r.paragraph_idx ?? null,
        llm_speaker: modelDisagreed(r.source ?? null, spk, llm),
      }),
    );
    if (spoken) d += 1;
  });
  return out;
}

export function flaggedLines(groups) {
  return new Set(groups.flatMap((g) => g.lines));
}

/** Is a stored line speech? The segmenter decides and records it as the source; a line it
 * didn't decide (yours, an import's) is speech when it opens with a speech mark — a stored
 * dialogue line keeps its marks. */
export function spokenBlock(source, text) {
  if (source === "narration") return false;
  if (DECIDED.has(source)) return true;
  return opensSpeech(text);
}
