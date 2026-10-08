// SPDX-License-Identifier: MIT
// Pronunciation pre-flight — the names a book will mispronounce, listed BEFORE hours of audio
// are rendered (the port of justvoice/pronunciation.py; C2, 2026-08-21).
//
// The mechanism: proper nouns are where a text reader guesses, and a book's character and
// place names are exactly the words no dictionary covers. The scan finds capitalized words
// that only ever appear capitalized (a word that also shows up lowercase is an ordinary word
// that merely started a sentence), drops the ones a lexicon already covers, and returns the
// rest as a worklist — most frequent first, because the name on every page is the one that
// matters. Pure functions; the API route feeds them each line's text and the lexicon
// graphemes the render reads that line with.
//
// Python's regexes are Unicode (`\w`, `\s`, `\b`, IGNORECASE): the kit's W/B classes with the
// `u` flag stand in for them, and lengths and slices count code points.

import { B, casefold, pySorted, S } from "@delebash/llm-runner/platform/py";

// `[A-Za-zÀ-ÖØ-öø-ÿ][\w'’-]*`
const TOKEN_RE = /[A-Za-zÀ-ÖØ-öø-ÿ](?:[\p{L}\p{N}_]|['’-])*/gu;
// A token counts as "mid-sentence" unless it follows a sentence break or opens the
// text/paragraph — those positions capitalize any word. `[.!?…]\s*["'“”‘’)\]]*\s*$`
const BREAK_RE = new RegExp(`[.!?…]${S}*["'“”‘’)\\]]*${S}*$`, "u");

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
const isLower = (ch) => /\p{Lowercase}/u.test(ch);

/**
 * [{word, count}] — likely proper nouns no lexicon covers where they stand.
 *
 * `lines`: each line's text with its own `covered` set — the graphemes in the lexicons the
 * render reads THAT line with (render_core.line_lexicons), matched casefolded. Per line since
 * 2026-09-30: a persona's lexicon reaches only that persona's lines, so a name it holds is
 * still unhandled when the narrator says it. A word qualifies when it appears capitalized
 * somewhere a sentence didn't force the capital, never appears lowercase, and is at least
 * three letters (two-letter capitals are almost always initials or "I" artifacts).
 */
export function scanNames(lines) {
  // A multi-word covered grapheme ("Mara Vance") covers exactly the PHRASE — that is also
  // all the render-side entry matches. Those occurrences are stripped from the text before
  // tokenizing, so their words aren't re-flagged, while a lone "Mara" elsewhere still counts
  // (review R2). Compiled once per distinct covered set.
  const prepared = new Map();
  const prepare = (covered) => {
    const key = JSON.stringify([...covered].sort());
    if (!prepared.has(key)) {
      prepared.set(key, [
        new Set([...covered].map((c) => casefold(c))),
        [...covered]
          .filter((c) => c.trim().includes(" "))
          .map((c) => new RegExp(`${B}${escapeRe(c)}${B}`, "giu")),
      ]);
    }
    return prepared.get(key);
  };

  const lowercaseSeen = new Set();
  const candidates = new Map(); // casefold → {word, count, mid}

  for (const [line, covered] of lines) {
    if (!line) continue;
    let text = line;
    const [coveredCf, phraseRes] = prepare(new Set(covered));
    for (const pr of phraseRes) text = text.replace(pr, " ");
    for (const m of text.matchAll(TOKEN_RE)) {
      const token = m[0];
      const before = [...text.slice(Math.max(0, m.index - 16), m.index)].slice(-8).join("");
      const atStart = m.index === 0 || BREAK_RE.test(before);
      const cf = casefold(token);
      if (isLower(token[0])) {
        lowercaseSeen.add(cf);
        continue;
      }
      if ([...token].length < 3 || coveredCf.has(cf)) continue;
      let entry = candidates.get(cf);
      if (!entry) candidates.set(cf, (entry = { word: token, count: 0, mid: false }));
      entry.count += 1;
      if (!atStart) entry.mid = true;
    }
  }

  const out = [];
  for (const [cf, c] of candidates) {
    if (c.mid && !lowercaseSeen.has(cf)) out.push({ word: c.word, count: c.count });
  }
  return pySorted(out, (w) => [-w.count, casefold(w.word)]);
}
