// SPDX-License-Identifier: MIT
// Does a name found in the prose refer to a speaker the book already has? (the port of
// justvoice/extraction/names.py)
//
// One matcher for every place that asks it (decided 2026-09-27, Discover fixes A / C / 1;
// speakers since the 2026-09-29 split): Discover dropping a proposal for someone already in
// the book, and Discover's record of the speakers a chapter names (`castNamedIn`).
//
// What counts as the same person, most specific first:
//   * the full name or any "Also called" name, compared case- and punctuation-blind;
//   * a single word that is the speaker's first or last name ("Brick" → "Brick Halvorn",
//     "Threll" → "Haldane Threll") — only for words of three letters or more, because "Al" or
//     "Jo" would match half a cast.
// A prefix is NOT a match: "Ode" is not "Odeline" unless someone recorded it as an alias.
// Guessing there would merge different people with similar names.
//
// Ambiguity is refused rather than guessed: when a name fits two speakers ("Vance" with Mara
// Vance and Edith Vance), `match` returns null and the caller treats it as unmatched.

import {
  B,
  casefold,
  cpLen,
  cpSlice,
  PY_WS,
  pyCapitalize,
  pySorted,
  reEscape,
  rstrip,
  splitWs,
  strip,
} from "@delebash/llm-runner/platform/py";

const _PUNCT = new RegExp(`[^\\p{L}\\p{N}_${PY_WS}'-]`, "gu");
const _SPACE = new RegExp(`[${PY_WS}]+`, "gu");

/** Case-, accent- and punctuation-blind form of a name. */
export function norm(name) {
  let s = casefold((name || "").normalize("NFKC").replaceAll("’", "'"));
  s = s.replace(_PUNCT, " ");
  return strip(s.replace(_SPACE, " "));
}

function _labels(persona) {
  return [persona?.name ?? "", ...(persona?.aliases || [])].filter((n) => n);
}

/** True when `candidate` names `persona` — exactly, by an alias, or by its first or last name
 * alone (3+ letters). */
export function refersTo(candidate, persona) {
  const c = norm(candidate);
  if (!c) return false;
  const labels = _labels(persona).map(norm);
  if (labels.includes(c)) return true;
  if (c.includes(" ") || cpLen(c) < 3) return false;
  for (const label of labels) {
    const words = splitWs(label);
    if (words.length >= 2 && (c === words[0] || c === words[words.length - 1])) return true;
  }
  return false;
}

/** The one persona `candidate` refers to, or null when none — or several — fit. An exact
 * name/alias hit wins over a first/last-name hit. */
export function match(candidate, personas) {
  const pool = [...personas];
  const c = norm(candidate);
  const exact = pool.filter((p) => _labels(p).map(norm).includes(c));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const loose = pool.filter((p) => refersTo(candidate, p));
  return loose.length === 1 ? loose[0] : null;
}

/** One name is the other with words added ("Sedge" / "Old Sedge") — whole words only, so
 * "Ann" is not a variant of "Annabel". */
export function isVariant(a, b) {
  const x = splitWs(norm(a));
  const y = splitWs(norm(b));
  const same = x.length === y.length && x.every((w, i) => w === y[i]);
  if (!x.length || !y.length || same) return x.length > 0 && same;
  const [short, long] = x.length < y.length ? [x, y] : [y, x];
  const n = short.length;
  for (let i = 0; i < long.length - n + 1; i++) if (short.every((w, k) => long[i + k] === w)) return true;
  return false;
}

const SQUASH_PAIRS = [
  ["“", '"'],
  ["”", '"'],
  ["‘", "'"],
  ["’", "'"],
  ["—", "-"],
  ["–", "-"],
];

/** Does `quote` appear in `text`, ignoring case, spacing and the straight/curly quote marks a
 * model rewrites? (Discover fix 3: an invented quote is the tell of an invented name.) */
export function quoteInText(quote, text) {
  if (!quote || !text) return false;
  const squash = (s) => {
    s = s.normalize("NFKC");
    for (const [a, b] of SQUASH_PAIRS) s = s.replaceAll(a, b);
    return strip(strip(casefold(s.replace(_SPACE, " "))), "\"'.,;:!?");
  };
  const q = squash(quote);
  return Boolean(q) && squash(text).includes(q);
}

// Words a first/last-name hit never counts on: titles and the like, which begin names ("Old
// Sedge", "Mr. Armitage") and appear everywhere.
const _NOT_A_NAME = new Set(["the", "old", "young", "mr", "mrs", "miss", "ms", "dr", "sir", "lady", "lord", "master", "mister", "doctor", "captain", "saint", "st"]);

/**
 * The book's speakers `text` names, for Discover's record of everyone a chapter names
 * (2026-09-29) — found without the AI, so the same every scan. `personas` is the speakers
 * (`{id, name, aliases}` objects or rows).
 *
 * A speaker counts when its full name or an alias appears as a phrase, or when its first or
 * last name (3+ letters, not a title) appears capitalised and belongs to no other speaker —
 * ambiguity is refused, as in `match`. Returns `[{speaker_id, name, mentions, evidence}]` in
 * order of first appearance; `evidence` is the sentence that first names them, trimmed.
 */
export function castNamedIn(text, personas) {
  const pool = [...personas];
  const body = text || "";
  const owners = new Map();
  for (const p of pool) {
    for (const label of _labels(p)) {
      const all = splitWs(norm(label));
      const words = all.filter((w) => cpLen(w) >= 3 && !_NOT_A_NAME.has(w));
      if (all.length >= 2 && words.length) {
        // A set in Python: its order never matters here (every owner's spans are sorted).
        for (const w of new Set([words[0], words[words.length - 1]])) {
          if (!owners.has(w)) owners.set(w, []);
          owners.get(w).push(p);
        }
      }
    }
  }
  const out = [];
  for (const p of pool) {
    let spans = [];
    for (const label of _labels(p)) {
      const pat = `${B}${splitWs(label).map(reEscape).join(`[${PY_WS}]+`)}${B}`;
      spans = spans.concat([...body.matchAll(new RegExp(pat, "giu"))].map((m) => [m.index, m.index + m[0].length]));
    }
    for (const [word, who] of owners) {
      if (who.length === 1 && who[0] === p) {
        const re = new RegExp(`${B}${reEscape(pyCapitalize(word))}${B}`, "gu");
        spans = spans.concat([...body.matchAll(re)].map((m) => [m.index, m.index + m[0].length]));
      }
    }
    if (!spans.length) continue;
    // "Mara Vance" also matches "Mara" and "Vance": one mention, not three.
    let mentions = 0;
    let reach = -1;
    for (const [s, e] of pySorted(spans)) {
      if (s >= reach) mentions += 1;
      reach = Math.max(reach, e);
    }
    const first = Math.min(...spans.map(([s]) => s));
    const lastBefore = (ch) => (first > 0 ? body.lastIndexOf(ch, first - 1) : -1);
    const start = Math.max(lastBefore("."), lastBefore("\n")) + 1;
    const ends = [body.indexOf(".", first), body.indexOf("\n", first)].filter((i) => i >= 0);
    const end = ends.length ? Math.min(...ends) : body.length;
    let sentence = strip(body.slice(start, end + 1));
    if (cpLen(sentence) > 120) sentence = `${rstrip(cpSlice(sentence, 0, 117))}…`;
    out.push({ speaker_id: p?.id ?? null, name: p?.name ?? "", mentions, evidence: sentence, _first: first });
  }
  return pySorted(out, (r) => r._first).map(({ _first, ...r }) => r);
}
