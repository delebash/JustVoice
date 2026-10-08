// SPDX-License-Identifier: MIT
// Kokoro's half of a lexicon's IPA (gap 3 of the audio.cpp switch) — the port of
// justvoice/engines/kokoro/ipa.py.
//
// Our copy of audio.cpp reads inline pronunciations — "[word](/phonemes/)", the markup
// hexgrad/Kokoro's misaki uses: the word is spoken from the phonemes given and the rest of the
// line through Kokoro's own G2P. Two jobs here:
//
// - `toKokoro`: a lexicon holds canonical IPA, and Kokoro's symbols are not that — it writes
//   the affricates and the diphthongs as ONE symbol (ʧ, ʤ, A = eɪ, I = aɪ, W = aʊ, Y = ɔɪ,
//   O = oʊ, Q = əʊ) and has no ASCII g (it is ɡ). Left as two symbols, "like" /laɪk/ would
//   lose its off-glide and read "lack". A symbol Kokoro does not have is refused by the
//   runtime, naming the word.
// - `splice`: mark the words of a line that have an IPA entry, by the same rule the host uses
//   to decide which entries a line carries (`render_core._ipa_words`): whole words, any case,
//   the longest entry first, and every piece of the split that IS an entry — so a line spoken
//   here and the cache key computed there always agree.

import { B, cpLen, pySorted, reEscape, strip } from "@delebash/llm-runner/platform/py";

// IPA → Kokoro, longest first so "t͡ʃ" is not half-replaced by "tʃ".
const REPLACEMENTS = [
  ["t͡ʃ", "ʧ"],
  ["d͡ʒ", "ʤ"],
  ["tʃ", "ʧ"],
  ["dʒ", "ʤ"],
  ["eɪ", "A"],
  ["aɪ", "I"],
  ["aʊ", "W"],
  ["ɔɪ", "Y"],
  ["oʊ", "O"],
  ["əʊ", "Q"],
  ["ɝ", "ɜɹ"],
  ["͡", ""], // any other tie bar
  [".", ""], // syllable breaks — to Kokoro a "." is a full stop
  ["g", "ɡ"],
];

/** Canonical IPA (with or without /…/ or […]) → Kokoro's phoneme symbols. */
export function toKokoro(ipa) {
  let s = strip(ipa || "");
  if (s.length >= 2 && "/[".includes(s[0]) && "/]".includes(s[s.length - 1])) s = s.slice(1, -1);
  s = strip(s);
  for (const [a, b] of REPLACEMENTS) s = s.replaceAll(a, b);
  return s;
}

/** `text` with each word that has an IPA entry written as "[word](/kokoro phonemes/)". */
export function splice(text, ipaMap) {
  const entriesIn = Object.entries(ipaMap || {});
  let lookup = new Map();
  for (const [g, p] of entriesIn) {
    if (strip(g) && strip(p || "")) lookup.set(strip(g).toLowerCase(), toKokoro(p));
  }
  lookup = new Map([...lookup].filter(([, v]) => v));
  if (!lookup.size || !strip(text)) return text;
  const entries = pySorted(
    entriesIn.map(([g]) => strip(g)).filter((g) => g && lookup.has(g.toLowerCase())),
    (g) => cpLen(g),
    true,
  );
  const pattern = new RegExp(`${B}(${entries.map(reEscape).join("|")})${B}`, "iu");
  const parts = text.split(pattern);
  if (parts.length === 1) return text;
  return parts.map((p) => (p && lookup.has(p.toLowerCase()) ? `[${p}](/${lookup.get(p.toLowerCase())}/)` : p ?? "")).join("");
}
