// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2024-2026 JustWrite contributors
// SPDX-FileCopyrightText: 2026 JustVoice contributors
//
// Paragraph segmentation — split each paragraph by speech marks into alternating narration /
// dialogue segments (the port of justvoice/extraction/segmentation.py).
//
// PARTIAL — the render wave (wave C) ported only what the render path reads: `opensSpeech`
// (line_takes.scene_lines and the chapter resolver's dialogue-tag rule reach it through
// extraction/flags.spokenBlock) and the single-quote opener it is built from. The extraction
// wave fills in the rest of this file (the styles' patterns, detectMarks, leftOpen,
// stripMarks, the segmenter) under the same names.
//
// A book's speech marks are one of four styles: "double" (“ ” and straight "), "single"
// (‘ ’ and straight '), "guillemets" (« » and » «) and "german" („ “ and „ ”). Single quotes
// double as apostrophes, so in single mode a speech opens only at a word's start — never on
// an elision ('tis, 'em, rock 'n' roll, the '90s).
//
// Python's `\s`, `\b` and `\d` are Unicode on str: the patterns use the kit's classes with
// the `u` flag (and the inline `(?i:…)` group, which Node 24 reads).

import { B, D, PY_WS } from "@delebash/llm-runner/platform/py";

export const SPEECH_MARKS = ["double", "single", "guillemets", "german"];

// A single-quoted speech opens with ‘ or ' at a word's start — the paragraph's start, or after
// a space, bracket, dash or double quote — never on an elision ('tis, 'em, rock 'n' roll, the
// '90s), and something must follow it.
export const _SQ_OPEN =
  `(?<![^${PY_WS}(\\[—–"“])[‘']` +
  `(?!(?i:tis|twas|twere|twill|em|cause|cos|til|till|round|nuff|n)${B}|${D})(?=[^${PY_WS}])`;

// `re.match(r"\s*(?:[“\"«»„]|" + _SQ_OPEN + r")")` — anchored at the start only.
const _OPENS_SPEECH = new RegExp(`^[${PY_WS}]*(?:[“"«»„]|${_SQ_OPEN})`, "u");

/** Does a stored line start with a speech mark of any style? A dialogue block keeps its marks,
 * so this is how a line nothing decided (yours, an import's) is known to be speech. */
export function opensSpeech(text) {
  return _OPENS_SPEECH.test(text || "");
}
