// SPDX-License-Identifier: MIT
// Whisper's basic text normaliser — openai/whisper `whisper/normalizers/basic.py` (upstream's
// last change 2025-01-04, commit 26a7cac), ported line for line: `remove_symbols_and_diacritics`,
// `remove_symbols` and `BasicTextNormalizer`. The take check (take_check.js) puts a line's words
// and the recogniser's transcript through it before lining them up, as word-error-rate tools do
// (RESEARCH §10.11: "Normalise both texts with Whisper's normaliser and align").
//
// Python → JavaScript: `unicodedata.category(c)[0] in "MSP"` is the Unicode property classes
// \p{M}, \p{S}, \p{P}; `regex`'s `\X` (a grapheme cluster) is Intl.Segmenter's grapheme; `re`'s
// `\s` on str is the kit's Python whitespace class.
//
// MIT License
//
// Copyright (c) 2022 OpenAI
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import { S } from "@delebash/llm-runner/platform/py";

// non-ASCII letters that are not separated by "NFKD" normalization
const ADDITIONAL_DIACRITICS = {
  œ: "oe",
  Œ: "OE",
  ø: "o",
  Ø: "O",
  æ: "ae",
  Æ: "AE",
  ß: "ss",
  ẞ: "SS",
  đ: "d",
  Đ: "D",
  ð: "d",
  Ð: "D",
  þ: "th",
  Þ: "th",
  ł: "l",
  Ł: "L",
};

const MARK_SYMBOL_PUNCT = /^[\p{M}\p{S}\p{P}]$/u; // unicodedata.category(c)[0] in "MSP"
const NONSPACING_MARK = /^\p{Mn}$/u; // unicodedata.category(c) == "Mn"
const BRACKETED = /[<[][^>\]]*[>\]]/g; // r"[<\[][^>\]]*[>\]]"
const PARENTHESISED = /\(([^)]+?)\)/g; // r"\(([^)]+?)\)"
const WHITESPACE_RUN = new RegExp(`${S}+`, "gu"); // r"\s+" on str

/**
 * Replace any other markers, symbols, and punctuations with a space,
 * and drop any diacritics (category 'Mn' and some manual mappings)
 */
export function removeSymbolsAndDiacritics(s, keep = "") {
  let out = "";
  for (const c of s.normalize("NFKD")) {
    if (keep.includes(c)) out += c;
    else if (Object.hasOwn(ADDITIONAL_DIACRITICS, c)) out += ADDITIONAL_DIACRITICS[c];
    else if (NONSPACING_MARK.test(c)) continue; // "" — the mark is dropped
    else out += MARK_SYMBOL_PUNCT.test(c) ? " " : c;
  }
  return out;
}

/**
 * Replace any other markers, symbols, punctuations with a space, keeping diacritics
 */
export function removeSymbols(s) {
  let out = "";
  for (const c of s.normalize("NFKC")) out += MARK_SYMBOL_PUNCT.test(c) ? " " : c;
  return out;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export class BasicTextNormalizer {
  constructor({ removeDiacritics = false, splitLetters = false } = {}) {
    this.clean = removeDiacritics ? removeSymbolsAndDiacritics : removeSymbols;
    this.splitLetters = splitLetters;
  }

  /** `__call__`. */
  normalize(s) {
    s = s.toLowerCase();
    s = s.replace(BRACKETED, ""); // remove words between brackets
    s = s.replace(PARENTHESISED, ""); // remove words between parenthesis
    s = this.clean(s).toLowerCase();

    if (this.splitLetters) {
      s = [...graphemes.segment(s)].map((g) => g.segment).join(" ");
    }

    s = s.replace(WHITESPACE_RUN, " "); // replace any successive whitespace characters with a space

    return s;
  }
}
