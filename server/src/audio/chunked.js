// SPDX-License-Identifier: MIT
// Long text into pieces a speech model can take, and the rule for joining the pieces again.
//
// A model is given a long line in pieces of its own length (`render_core.lineSplitChars`; the
// general cap is `settings.generation.max_chunk_chars`). `splitTextIntoChunks` cuts the line at
// the most natural place inside each piece's length, best first:
//
//   1. a sentence end — `.` `!` `?` followed by whitespace (closing quotes may sit between), or
//      a CJK `。` `！` `？` anywhere. A `.` after a known abbreviation (`Mr.`, `e.g.`, `U.S.`) is
//      not one; a number before the `.` is no exception (`It was 2024. Then…` ends there), and a
//      decimal (`3.14`) never qualifies because no whitespace follows its point;
//   2. a clause mark — `;` `:` `,` `—` followed by whitespace, or a CJK `，` `、` `；` `：`;
//   3. a space;
//   4. a hard cut at the piece length.
// Within each kind the last one in the window wins. A `[bracket]` tag (`[laugh]`,
// `[clears throat]`) is one unit: nothing inside it is a boundary and no cut lands inside it — a
// hard cut that would moves back to just before the `[`. Only a tag longer than the piece length
// itself is cut, since no piece may be longer than that.
//
// Lengths are counted in Unicode code points (an emoji is one character) and whitespace is
// Python's definition (the kit's PY_WS), as everywhere else lengths are compared. Only
// whitespace is lost at a cut.
//
// The join constants below are JustVoice's measured decision (2026-10-07, docs/dev/RESEARCH.md
// §3 "Long lines also hold ~0.9–1 s silences"): where two pieces meet in silence, the silence is
// cut down to PIECE_JOIN_PAUSE_MS — quiet judged in WINDOW_MS windows under
// PIECE_JOIN_SILENCE_DBFS. `dsp_client.js` sends them with every join; the DSP program applies
// the rule.

import { PY_WS, ValueError } from "@delebash/llm-runner/platform/py";

/** The general piece length (`settings.generation.max_chunk_chars`' default). */
export const DEFAULT_MAX_CHUNK_CHARS = 800;

/** Where two pieces meet in silence, the silence is cut down to this many milliseconds. */
export const PIECE_JOIN_PAUSE_MS = 260;
/** At or below this level a window counts as quiet. */
export const PIECE_JOIN_SILENCE_DBFS = -60.0;
/** Quiet is judged in windows of this many milliseconds. */
export const WINDOW_MS = 10;

const WS = new Set(PY_WS);
const isWs = (ch) => WS.has(ch);
const isLetter = (ch) => /\p{L}/u.test(ch);

const SENTENCE_END = new Set([".", "!", "?"]);
const CJK_SENTENCE_END = new Set(["。", "！", "？"]);
const CLAUSE_MARK = new Set([";", ":", ",", "—"]);
const CJK_CLAUSE_MARK = new Set(["，", "、", "；", "："]);
// Closing quotes and brackets that may follow a sentence end before the whitespace.
const CLOSERS = new Set(['"', "'", "”", "’", "»", ")", "」", "』"]);

// Words whose period is part of the word, not the end of a sentence (lower case, inner dots kept).
const ABBREVIATIONS = new Set([
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "sr",
  "jr",
  "st",
  "mt",
  "ave",
  "blvd",
  "rd",
  "inc",
  "ltd",
  "corp",
  "dept",
  "est",
  "approx",
  "vs",
  "etc",
  "vol",
  "fig",
  "e.g",
  "i.e",
  "a.m",
  "p.m",
  "u.s",
  "u.k",
  "u.n",
  "e.u",
]);

/** The `[…]` tags of `chars`, as [start, end) index pairs: a `[` up to the next `]`. A `[` that
 * is never closed is plain text. */
function tagSpans(chars) {
  const spans = [];
  let i = 0;
  while (i < chars.length) {
    if (chars[i] === "[") {
      const close = chars.indexOf("]", i + 1);
      if (close === -1) break;
      spans.push([i, close + 1]);
      i = close + 1;
    } else i += 1;
  }
  return spans;
}

/** Is a `.` at `i` the end of a known abbreviation? */
function endsAbbreviation(chars, i) {
  let j = i;
  while (j > 0 && (isLetter(chars[j - 1]) || chars[j - 1] === ".")) j -= 1;
  const word = chars.slice(j, i).join("").replace(/^\.+/, "").toLowerCase();
  return word !== "" && ABBREVIATIONS.has(word);
}

/** Trim whitespace (Python's) from both ends of a code-point array → a string. */
function trimmed(chars) {
  let a = 0;
  let b = chars.length;
  while (a < b && isWs(chars[a])) a += 1;
  while (b > a && isWs(chars[b - 1])) b -= 1;
  return chars.slice(a, b).join("");
}

/**
 * Where to cut the text that starts at `start`: the number of characters to take, 1..limit.
 * `spans` are the text's tags (`tagSpans`).
 */
function cutLength(chars, start, limit, spans) {
  const end = start + limit; // the window is [start, end); chars[end] is the text after it
  const insideTag = (i) => spans.some(([a, b]) => a <= i && i < b);
  const cutsTag = (c) => spans.some(([a, b]) => a < c && c < b);
  const followedByWs = (c) => c >= chars.length || isWs(chars[c]);

  let sentence = -1;
  let clause = -1;
  let space = -1;
  for (let i = start; i < end; i++) {
    const ch = chars[i];
    if (insideTag(i)) continue;
    if (CJK_SENTENCE_END.has(ch)) {
      let c = i + 1;
      while (c < end && CLOSERS.has(chars[c])) c += 1;
      sentence = c;
    } else if (SENTENCE_END.has(ch)) {
      let c = i + 1;
      while (c < end && CLOSERS.has(chars[c])) c += 1;
      if (c <= end && followedByWs(c) && !(ch === "." && endsAbbreviation(chars, i))) sentence = c;
    } else if (CJK_CLAUSE_MARK.has(ch)) {
      clause = i + 1;
    } else if (CLAUSE_MARK.has(ch)) {
      if (followedByWs(i + 1)) clause = i + 1;
    } else if (ch === " ") {
      space = i + 1;
    }
  }
  for (const c of [sentence, clause, space]) if (c > start && !cutsTag(c)) return c - start;

  // A hard cut — moved back to just before a tag it would land inside, unless that tag opens the
  // window (then nothing shorter than the tag is possible, and the piece length wins).
  const tag = spans.find(([a, b]) => a < end && end < b);
  if (tag && tag[0] > start) return tag[0] - start;
  return limit;
}

/**
 * `text` in pieces of at most `maxChars` characters, cut at the most natural boundary (see the
 * header). Empty text gives `[]`; text that fits gives one piece. Throws a ValueError when
 * `maxChars` is not at least 1.
 */
export function splitTextIntoChunks(text, maxChars = DEFAULT_MAX_CHUNK_CHARS) {
  const limit = Math.floor(Number(maxChars));
  if (!(limit >= 1)) throw new ValueError(`the piece length must be at least 1 character (got ${maxChars})`);

  const chars = [...trimmed([...(text == null ? "" : String(text))])];
  if (chars.length === 0) return [];
  if (chars.length <= limit) return [chars.join("")];

  const spans = tagSpans(chars);
  const pieces = [];
  let start = 0;
  while (start < chars.length) {
    while (start < chars.length && isWs(chars[start])) start += 1;
    if (start >= chars.length) break;
    if (chars.length - start <= limit) {
      pieces.push(trimmed(chars.slice(start)));
      break;
    }
    const take = cutLength(chars, start, limit, spans);
    const piece = trimmed(chars.slice(start, start + take));
    if (piece) pieces.push(piece);
    start += take;
  }
  return pieces;
}
