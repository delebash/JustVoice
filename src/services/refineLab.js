// SPDX-License-Identifier: MIT
// The dictation-cleanup Lab adapter. Registered under the `refine` FEATURE:
// the card's Lab (the one refine surface since the 2026-08-08 sectioned
// redesign retired the per-piece panes) runs the REAL production path —
// /v1/refine/lab-run: the composed system plus the few-shot
// REFINEMENT_EXAMPLES history production sends (the generic run sent no
// history — the recorded 2026-08-06 gap). A column-edited system still
// rides (what you see is what runs). §16: every run is a real task on the strip — the
// task row is ConfigColumn's: it registers the run in the shared kit queue
// (inline-flagged) and hands this adapter the handle's abort signal.
import { useApi } from "../stores/api.js";

async function run(body, { signal } = {}) {
  const api = useApi();
  const vars = body.variables || {};

  const r = await api.request("/v1/refine/lab-run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transcript: vars.transcript || "",
      systemPrompt: body.system || null,
      userPrompt: body.userTemplate || null,
      providerId: body.providerId || null,
      model: body.model || null,
      temperature: body.temperature ?? null,
      think: body.think ?? null,
      reasoningEffort: body.reasoningEffort ?? null,
      maxTokens: body.maxTokens || null,
      topP: body.topP ?? null,
      samplers: body.samplers || [],
    }),
    signal,
  });
  return {
    content: r?.text || "",
    promptTokens: r?.usage?.prompt_tokens || 0,
    completionTokens: r?.usage?.completion_tokens || 0,
    model: r?.usage?.model || r?.model || "",
  };
}

export const refineLabAdapter = { run };
