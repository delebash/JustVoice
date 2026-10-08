// SPDX-License-Identifier: MIT
// /v1/extraction — Analyze, Discover and the Lab's extraction routes (the port of
// justvoice/api/extraction_api.py).
//
// PARTIAL — API agent 2 ported only `RunUsage`, which voices_api's gender guess and
// personas_api's Compose / Rewrite answer with. API agent 3 fills in the rest of this file (the
// routes and their models) under the same names.

import { opt, T } from "@delebash/llm-runner/platform/models";

/** The run's usage numbers (§16 — every AI response carries them; the server always had them,
 * the responses just didn't). 0 = unreported. */
export const RunUsage = T.Object({
  prompt_tokens: opt(T.Integer(), 0),
  completion_tokens: opt(T.Integer(), 0),
  duration_ms: opt(T.Integer(), 0),
  model: opt(T.String(), ""),
  // Model calls the run took: 1 when the chapter fit, more when it was read in pieces (chapter
  // splitting, 2026-09-28).
  pieces: opt(T.Integer(), 1),
});
