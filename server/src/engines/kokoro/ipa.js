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
//   lose its off-glide and read "lack". A symbol Kokoro does not have would be refused by the
//   runtime, naming the word — and the whole line with it — so such a word is left to Kokoro's
//   own reading instead (decided 2026-10-15, the narrowings review F12): `vocabOf` reads
//   Kokoro's symbols from the model file, `lacking` names the first one an entry uses that
//   isn't among them.
// - `splice`: mark the words of a line that have an IPA entry, by the same rule the host uses
//   to decide which entries a line carries (`render_core._ipa_words`): whole words, any case,
//   the longest entry first, and every piece of the split that IS an entry — so a line spoken
//   here and the cache key computed there always agree.

import { statSync } from "node:fs";
import { B, cpLen, pySorted, reEscape, strip } from "@delebash/core/platform/py";
import { embeddedFiles } from "../audiocpp/gguf_files.js";

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

// One model file version's symbols: "<path>|<mtimeNs>" → Set (or null).
const VOCAB_CACHE = new Map();

/** Kokoro's phoneme symbols — the `vocab` of the config.json its GGUF carries, what our audio.cpp
 * checks a given pronunciation against (`require_kokoro_symbols`). null when the file can't be
 * read. */
export function vocabOf(ggufPath) {
  try {
    const key = `${ggufPath}|${statSync(ggufPath, { bigint: true }).mtimeNs}`;
    if (VOCAB_CACHE.has(key)) return VOCAB_CACHE.get(key);
    const config = embeddedFiles(ggufPath).get("config.json");
    const vocab = config ? JSON.parse(config.toString("utf8")).vocab : null;
    const out = vocab && typeof vocab === "object" ? new Set(Object.keys(vocab)) : null;
    VOCAB_CACHE.clear();
    VOCAB_CACHE.set(key, out);
    return out;
  } catch {
    return null;
  }
}

/** Every one of Kokoro's phoneme symbols in `phonemes` (already Kokoro's, `toKokoro`) that
 * `vocab` lacks, once each, in order — code point by code point, as audio.cpp checks. [] when
 * there is no `vocab` to check against. */
export function lackingAll(phonemes, vocab) {
  if (!vocab) return [];
  const out = [];
  for (const ch of strip(phonemes || "")) if (!vocab.has(ch) && !out.includes(ch)) out.push(ch);
  return out;
}

/** The first symbol `lackingAll` finds, or null. */
export function lacking(phonemes, vocab) {
  return lackingAll(phonemes, vocab)[0] ?? null;
}

/** `text` with each word that has an IPA entry written as "[word](/kokoro phonemes/)". With
 * `vocab` (Kokoro's symbols), a word whose pronunciation uses a symbol Kokoro lacks is left as
 * it is, for Kokoro to read the normal way; the match itself is unchanged, so "Mara" is still not
 * marked inside a "Mara Vance" left alone. */
export function splice(text, ipaMap, vocab = null) {
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
  const mark = (p) => {
    const phonemes = lookup.get(p.toLowerCase());
    return lacking(phonemes, vocab) === null ? `[${p}](/${phonemes}/)` : p;
  };
  return parts.map((p) => (p && lookup.has(p.toLowerCase()) ? mark(p) : p ?? "")).join("");
}
