// SPDX-License-Identifier: MIT
// What Script marks for a look, and whether a stored line is speech (the port of
// justvoice/extraction/flags.py).
//
// PARTIAL — the render wave (wave C) ported only DECIDED and `spokenBlock`, which Render's
// line page (line_takes.scene_lines) and the "Leave out dialogue tags" rule read. The
// extraction wave fills in the rest (Line, FlagGroup, flagGroups, …) under the same names.

import { opensSpeech } from "./segmentation.js";

// The sources an Analyze run writes for a spoken line ("second_look": the second look named
// the speaker from the chapters around it, 2026-10-05).
export const DECIDED = new Set(["tag", "propagated", "llm", "floored", "second_look"]);

/** Is a stored line speech? The segmenter decides and records it as the source; a line it
 * didn't decide (yours, an import's) is speech when it opens with a speech mark — a stored
 * dialogue line keeps its marks. */
export function spokenBlock(source, text) {
  if (source === "narration") return false;
  if (DECIDED.has(source)) return true;
  return opensSpeech(text);
}
