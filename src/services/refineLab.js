// SPDX-License-Identifier: MIT
// The dictation-cleanup Lab adapter (task #22, 2026-08-06). Registered under
// the `refine` FEATURE, so the four piece columns AND the feature pane's
// composed-prompt Lab all run the REAL production path — /v1/refine/lab-run:
// the explicit composed system plus the few-shot REFINEMENT_EXAMPLES history
// production sends (the generic run sent no history — the recorded #22 gap).
// A piece column's own system text still rides, so every part stays
// standalone-testable. §16: every run is a real task on the strip.
import { useApi } from "../stores/api.js";
import { useRenderTasks } from "../stores/renderTasks.js";

async function run(body, { signal } = {}) {
  const api = useApi();
  const vars = body.variables || {};

  const tasks = useRenderTasks();
  const ctrl = new AbortController();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  const task = tasks.start({
    kind: "compose",
    feature: "refine",
    label: "Lab — Dictation cleanup",
    statsFn: (t) => (t.meta.tokens != null ? [`${t.meta.tokens} tok`] : []),
    onCancel: () => ctrl.abort(),
  });
  try {
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
      signal: ctrl.signal,
    });
    if (r?.usage) {
      tasks.update(task.id, {
        meta: { tokens: (r.usage.prompt_tokens || 0) + (r.usage.completion_tokens || 0) },
      });
    }
    tasks.finish(task.id);
    return {
      content: r?.text || "",
      promptTokens: r?.usage?.prompt_tokens || 0,
      completionTokens: r?.usage?.completion_tokens || 0,
      model: r?.usage?.model || r?.model || "",
    };
  } catch (e) {
    if (ctrl.signal.aborted) tasks.cancel(task.id);
    else tasks.fail(task.id, e?.message || String(e));
    throw e;
  }
}

export const refineLabAdapter = { run };
