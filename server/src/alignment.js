// SPDX-License-Identifier: MIT
// Word-level alignment — attach times to the words we KNOW were spoken (the port of
// justvoice/alignment.py).
//
// The engine-agnostic half of word timestamps (C1, 2026-08-21): the speech-recognition
// engine's aligner times the rendered audio's words, and this module maps that hypothesis
// onto the KNOWN line text. Knowing the text is what makes this forced alignment rather than
// transcription — an ASR mistake ("Wooster" for "Worcester") must not lose the word's
// timing, and it doesn't: the words align by sequence matching (difflib's SequenceMatcher,
// ported exactly) and every unmatched known word interpolates between its timed neighbours.
//
// Pure functions only — the aligner call lives in the engine slot.

import { casefold, pyRound } from "@delebash/llm-runner/platform/py";
import { SequenceMatcher } from "./difflib.js";

// Python's `\S` on str: anything but str.isspace() — JavaScript's `\s` also counts U+FEFF and
// misses U+001C–U+001F and U+0085. (Candidate for platform/py.js.)
const NOT_S = "(?:\\ufeff|[^\\s\\x1c-\\x1f\\x85])";
const WORD_RE = new RegExp(`${NOT_S}+`, "gu");
const NORM_RE = /[^\p{L}\p{N}_']+/gu; // Python's [^\w']+

/** The text's words, whitespace-split, punctuation kept (the caption should read as written). */
export function splitWords(text) {
  return (text || "").match(WORD_RE) ?? [];
}

const norm = (word) => casefold(String(word).replace(NORM_RE, ""));

/**
 * Times for every word of `knownText`.
 *
 * `hypWords`: [{word, start, end}] — the transcriber's own words with times. Returns
 * [{word, start, end}] for the KNOWN words, in order. Matched words take the hypothesis
 * timing. Unmatched runs (ASR errors, dropped words) interpolate linearly between the
 * nearest timed anchors; before the first anchor they interpolate from 0, after the last
 * from `totalDuration` (or the last anchor's end). A hypothesis with no usable overlap at all
 * returns an even spread over the audio — wrong in detail but monotonic and honest about
 * being an estimate.
 */
export function alignKnownText(knownText, hypWords, { totalDuration = null } = {}) {
  const known = splitWords(knownText);
  if (!known.length) return [];
  const hyp = hypWords.filter((h) => norm("word" in h ? h.word : ""));

  const n = known.length;
  const starts = new Array(n).fill(null);
  const ends = new Array(n).fill(null);

  if (hyp.length) {
    const sm = new SequenceMatcher(
      null,
      known.map((w) => norm(w)),
      hyp.map((h) => norm(h.word)),
      false,
    );
    for (const block of sm.getMatchingBlocks()) {
      for (let k = 0; k < block.size; k++) {
        const h = hyp[block.b + k];
        starts[block.a + k] = Number(h.start);
        ends[block.a + k] = Number(h.end);
      }
    }
  }

  let lastTime = totalDuration;
  if (lastTime === null || lastTime === undefined) {
    const timedEnds = ends.filter((e) => e !== null);
    lastTime = timedEnds.length ? Math.max(...timedEnds) : n; // 1 s/word floor
  }

  // Fill unmatched runs by linear interpolation between anchors.
  let i = 0;
  while (i < n) {
    if (starts[i] !== null) {
      i += 1;
      continue;
    }
    const runStart = i;
    while (i < n && starts[i] === null) i += 1;
    const runEnd = i; // exclusive
    const left = runStart > 0 ? ends[runStart - 1] : 0.0;
    let right = runEnd < n ? starts[runEnd] : lastTime;
    if (right < left) right = left; // a misordered anchor pair — keep it monotonic
    const span = right - left;
    const count = runEnd - runStart;
    for (let k = 0; k < count; k++) {
      starts[runStart + k] = left + (span * k) / count;
      ends[runStart + k] = left + (span * (k + 1)) / count;
    }
  }

  const out = [];
  let prevEnd = 0.0;
  for (let k = 0; k < n; k++) {
    const s = Math.max(Number(starts[k]), prevEnd); // monotonic, never overlapping backwards
    const e = Math.max(Number(ends[k]), s);
    out.push({ word: known[k], start: pyRound(s, 3), end: pyRound(e, 3) });
    prevEnd = e;
  }
  return out;
}
