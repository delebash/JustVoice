// SPDX-License-Identifier: MIT
//
// The capture language — Settings → Captures sets it, the Captures page and a
// capture's details show it. ONE wording (decided 2026-10-06, the one-wording
// audit B7/C3): a language by its name, never its code; Captures shows what
// Settings holds — it used to print "auto" whatever Settings held.
// "Auto-detect" for auto was the implementer's label, not the audit's; kept by
// the user's word on 2026-10-13 (the narrowings review K7).

import { languageName } from "@delebash/llm-ui";

/** The languages Settings offers besides Auto-detect. */
export const CAPTURE_LANGUAGES = ["en", "es", "fr", "de", "ja"];

/** "auto" (or nothing) → "Auto-detect"; a code → its name. */
export function captureLanguageWord(code) {
  if (!code || code === "auto") return "Auto-detect";
  return languageName(code) || code;
}
