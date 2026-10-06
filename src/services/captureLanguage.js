// SPDX-License-Identifier: MIT
//
// The capture language — Settings → Captures sets it, the Captures page and a
// capture's details show it. ONE wording (decided 2026-10-06, the one-wording
// audit B7/C3): a language by its name, never its code, and "auto" as
// Auto-detect. Captures used to print "auto" whatever Settings held.

import { languageName } from "@delebash/llm-ui";

/** The languages Settings offers besides Auto-detect. */
export const CAPTURE_LANGUAGES = ["en", "es", "fr", "de", "ja"];

/** "auto" (or nothing) → "Auto-detect"; a code → its name. */
export function captureLanguageWord(code) {
  if (!code || code === "auto") return "Auto-detect";
  return languageName(code) || code;
}
