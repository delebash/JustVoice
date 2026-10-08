// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2024 Jamie Pine and voicebox contributors
// SPDX-FileCopyrightText: 2026 JustVoice contributors
//
// Originally from https://github.com/jamiepine/voicebox/blob/b35b90961d5bc83a8b4e96e8b6ccde2a03152ff9/backend/utils/chunked_tts.py
// (commit pinned in voicebox-pin.txt at repo root).
// Ported to JustVoice on 2026-06-08. Modifications by JustVoice contributors
// are licensed under MIT as part of the combined JustVoice work. The
// MIT permission notice (LICENSES/MIT.txt) continues to apply to upstream-derived
// portions.
//
// Chunked TTS generation utilities (the port of justvoice/audio/chunked.py).
//
// Splits long text into sentence-boundary chunks; each piece is spoken by any TTS backend,
// and the pieces are joined by the DSP program (`dsp_client.join`, by the PIECE_JOIN_* rules
// below — the joins moved to our audio.cpp fork's `audiocpp_dsp` on 2026-10-07). All logic is
// engine-agnostic. Short text (≤ max_chunk_chars) uses the single-shot fast path.
//
// Tunables live in settings (CLAUDE.md "no hardcoded operator-tunable values"):
//     settings.generation.max_chunk_chars  (default 800)
//     settings.generation.crossfade_ms     (default 50)
//
// Python counts and slices by CODE POINT; this works on arrays of code points so a line with
// an emoji splits exactly where Python splits it.

import { PY_WS } from "@delebash/llm-runner/platform/py";

/** Default chunk size in characters. Can be overridden per-request. */
export const DEFAULT_MAX_CHUNK_CHARS = 800;

// Common abbreviations that should NOT be treated as sentence endings (lowercase).
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "ave", "blvd", "inc", "ltd", "corp", "dept",
  "est", "approx", "vs", "etc", "e.g", "i.e", "a.m", "p.m", "u.s", "u.s.a", "u.k",
]);

const isWs = (ch) => ch !== undefined && PY_WS.includes(ch);
// str.isalpha: categories Lu Ll Lt Lm Lo.
const isAlpha = (ch) => ch !== undefined && /^\p{L}$/u.test(ch);
// str.isdigit: Numeric_Type Decimal (Nd) or Digit — the superscripts, subscripts and circled
// digits JS has no property for are listed.
const DIGIT_RE =
  /^[\p{Nd}²³¹⁰⁴-⁹₀-₉①-⑨⑴-⑼⒈-⒐⓵-⓽❶-❾➀-➈➊-➒፩-፱᧚]$/u;
const isDigit = (ch) => ch !== undefined && DIGIT_RE.test(ch);

/** `\[[^\]]*\]` matches, left to right, non-overlapping: [start, end) code-point spans. */
function paraTags(cps) {
  const out = [];
  let i = 0;
  while (i < cps.length) {
    if (cps[i] === "[") {
      const j = cps.indexOf("]", i + 1);
      if (j === -1) break; // no closing bracket after this one, nor after any later "["
      out.push([i, j + 1]);
      i = j + 1;
    } else i += 1;
  }
  return out;
}

/** True if `pos` falls inside a `[...]` tag. */
function insideBracketTag(cps, pos) {
  for (const [s, e] of paraTags(cps)) if (s < pos && pos < e) return true;
  return false;
}

/** The index of the last sentence-ending punctuation in `cps`, or -1. Skips periods after
 * common abbreviations (`Dr.`, `Mr.`) and decimals, and periods inside bracket tags
 * (`[laugh]`). Handles CJK sentence ends (`。！？`). */
function findLastSentenceEnd(cps) {
  let best = -1;
  // ASCII sentence ends: [.!?](?:\s|$)
  for (let pos = 0; pos < cps.length; pos++) {
    const ch = cps[pos];
    if (!(ch === "." || ch === "!" || ch === "?")) continue;
    if (!(pos + 1 === cps.length || isWs(cps[pos + 1]))) continue;
    if (ch === ".") {
      // Walk backwards to find the preceding word.
      let wordStart = pos - 1;
      while (wordStart >= 0 && isAlpha(cps[wordStart])) wordStart -= 1;
      const word = cps.slice(wordStart + 1, pos).join("").toLowerCase();
      if (ABBREVIATIONS.has(word)) continue;
      // Skip decimal numbers (digit immediately before the period).
      if (wordStart >= 0 && isDigit(cps[wordStart])) continue;
    }
    if (insideBracketTag(cps, pos)) continue;
    best = pos;
  }
  // CJK sentence-ending punctuation.
  for (let pos = 0; pos < cps.length; pos++) {
    if ((cps[pos] === "。" || cps[pos] === "！" || cps[pos] === "？") && pos > best) best = pos;
  }
  return best;
}

/** The index of the last clause-boundary punctuation, or -1. */
function findLastClauseBoundary(cps) {
  let best = -1;
  for (let pos = 0; pos < cps.length; pos++) {
    const ch = cps[pos];
    if (!(ch === ";" || ch === ":" || ch === "," || ch === "—")) continue;
    if (!(pos + 1 === cps.length || isWs(cps[pos + 1]))) continue;
    if (insideBracketTag(cps, pos)) continue;
    best = pos;
  }
  return best;
}

/** A hard-cut position that doesn't split a `[tag]`. */
function safeHardCut(segment, maxChars) {
  const cut = maxChars - 1;
  for (const [s, e] of paraTags(segment)) {
    if (s < cut && cut < e) return s > 0 ? s - 1 : cut;
  }
  return cut;
}

const stripCps = (cps, left = true, right = true) => {
  let a = 0;
  let b = cps.length;
  if (left) while (a < b && isWs(cps[a])) a++;
  if (right) while (b > a && isWs(cps[b - 1])) b--;
  return cps.slice(a, b);
};

/**
 * Split `text` at natural boundaries into chunks of at most `maxChars` characters.
 * Priority: sentence-end (`.!?` not preceded by an abbreviation and not inside brackets) →
 * clause boundary (`;:,—`) → whitespace → hard cut. Paralinguistic tags like `[laugh]` are
 * atomic and never split across chunks.
 */
export function splitTextIntoChunks(text, maxChars = DEFAULT_MAX_CHUNK_CHARS) {
  const all = stripCps([...String(text)]);
  if (!all.length) return [];
  if (all.length <= maxChars) return [all.join("")];

  const chunks = [];
  let remaining = all;
  while (remaining.length) {
    remaining = stripCps(remaining, true, false);
    if (!remaining.length) break;
    if (remaining.length <= maxChars) {
      chunks.push(remaining.join(""));
      break;
    }
    const segment = remaining.slice(0, maxChars);
    // Try sentence-end → clause-boundary → whitespace → safe hard cut.
    let splitPos = findLastSentenceEnd(segment);
    if (splitPos === -1) splitPos = findLastClauseBoundary(segment);
    if (splitPos === -1) splitPos = segment.lastIndexOf(" ");
    if (splitPos === -1) splitPos = safeHardCut(segment, maxChars);

    const chunk = stripCps(remaining.slice(0, splitPos + 1)).join("");
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(splitPos + 1);
  }
  return chunks;
}

// Where two pieces of one line meet, the quiet on both sides is cut down to this (decided
// 2026-10-07): each piece arrives with its model's own padding — Kokoro ~715 ms after and
// ~265 ms before — so a long line held ~0.9-1 s gaps where it was cut, against the ~260 ms
// Kokoro pauses at a sentence end inside a piece (median of 214 on The Ninth Facet). "Quiet"
// is judged the way that pause was measured: 10 ms windows under PIECE_JOIN_SILENCE_DBFS. A
// per-sample −70 dBFS left a faint fade on top, and the joins measured 440-480 ms. The rule
// is applied in `audiocpp_dsp` (`dsp_client.join` / `streamJoin` send these values): where
// `a` ends and `b` begins in silence, that silence is cut down to the pause — half from each
// side, the rest from whichever has more — and the two meet without a crossfade; a join
// already that short, or a piece with no sound, gets the short crossfade. A streamed piece
// holds back its trailing quiet and one crossfade window for the next seam.
export const PIECE_JOIN_PAUSE_MS = 260;
export const PIECE_JOIN_SILENCE_DBFS = -60.0;
export const WINDOW_MS = 10;
