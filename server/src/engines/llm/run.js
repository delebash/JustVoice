// SPDX-License-Identifier: MIT
// JV's in-server door onto the shared run path (F1 Phase 2, 2026-08-05) — the port of
// justvoice/engines/llm/run.py.
//
// One thin seam so all of JustVoice's feature call sites read the same way:
//
//     import { runFeature } from "../engines/llm/run.js";
//     const resp = await runFeature("smart_assign", { speakers: …, personas: … });
//
// `runFeature` = the kit's `runAction` (resolve the action's template row → render fail-loud
// → resolve its ENGINE PRESET → overlay tunables → ensure a local model resident → dispatch)
// over the SHARED prompt store and the shared `buildLlmConfig` — the same path POST
// /v1/ai/run takes, so a feature and its Lab column can never drift. `overrides` pass through
// to RunRequest (per-call `maxTokens`, `system` / `userTemplate`, `history`, `think` /
// `model` / `providerId`). Throws the kit's own errors (LLMNotConfiguredError → 501 at the API
// layer, MissingTemplateVariables → a caller bug named loudly, UnknownActionError → an
// unseeded row).

import { LLMNotConfiguredError, measureAction, resolveRoute, runAction, stores, streamAction } from "@delebash/core/llm";
import { buildLlmConfig } from "@delebash/core/llm/config_builder";
import { providerPlan } from "@delebash/core/llm/plans";
import { resolveFeaturePresetWithSource } from "@delebash/core/llm/preset_resolve";
import { PREFER_LOCAL_FEATURES } from "../../feature_catalog.js";

/** The dispatch view over the shared stores — JV's one per-app input is the prefer-local set
 * (the same value installLlm registers). */
export function jvLlmConfig() {
  return buildLlmConfig(PREFER_LOCAL_FEATURES);
}

/**
 * The model a feature action runs on right now → `{configured, model, provider, provider_id,
 * cloud, detail}` — the kit's own resolution, as GET /v1/ai/resolved-route reports it (the
 * action's preset over the feature's route). `cloud`: a provider that isn't on this machine (a
 * metered account — the kit's `local` flag, which `presetRecipe` reads too). `plan`: the
 * person's own plan a cloud provider draws on instead of a price ("claude" — their Claude Code;
 * "chatgpt" — Sign in with ChatGPT; the kit's `providerPlan`), else null; `plan_used`: how much of
 * it is used (0..1), when known. The one-click run's plan (`book_run.stepRoute`) and Discover's
 * Find same people both ask it.
 */
export function featureRoute(feature, action) {
  const [preset] = resolveFeaturePresetWithSource(action, feature);
  try {
    const [adapter, model] = resolveRoute(jvLlmConfig(), feature, {
      action,
      providerOverride: preset?.providerId || null,
      modelOverride: preset?.model || null,
    });
    const provider = stores.getProviderStore().get(adapter.provider_id);
    const plan = providerPlan(provider);
    return {
      configured: true,
      model,
      provider: provider?.name || adapter.provider_id,
      provider_id: adapter.provider_id,
      cloud: provider?.local === false,
      plan: plan?.plan ?? null,
      plan_used: plan?.used ?? null,
      detail: null,
    };
  } catch (e) {
    if (!(e instanceof LLMNotConfiguredError)) throw e;
    return { configured: false, model: null, provider: null, provider_id: null, cloud: false, plan: null, plan_used: null, detail: String(e?.message ?? e) };
  }
}

/** Run one feature action → the kit's LLMResponse. `signal` (the kit's, 2026-10-21): a run's
 * Stop or a client gone aborts the model's request, and the run rejects with the kit's AbortError
 * (`isAbortError`). */
export async function runFeature(action, variables, overrides = {}, { signal = null } = {}) {
  return runAction(stores.getPromptStore(), jvLlmConfig(), { action, variables, ...overrides }, { signal });
}

/** runFeature's streaming sibling (lane 2A, 2026-08-08): the kit's streamAction over the same
 * store + config — an async iterator of StreamDelta (text chunks, optional prompt-eval
 * `progress`, a final `done` with usage). Resolution + the local-model ensure run eagerly, so
 * callers get LLMNotConfiguredError before any frame: `for await (const d of await
 * streamFeature(…))`. */
export async function streamFeature(action, variables, overrides = {}, { signal = null } = {}) {
  return streamAction(stores.getPromptStore(), jvLlmConfig(), { action, variables, ...overrides }, { signal });
}

/** How big runFeature's prompt would be, and the context it must fit — the kit's
 * measureAction over the same store + config (chapter splitting, 2026-09-28). null off the
 * local runner or when the router cannot say. */
export async function measureFeature(action, variables, overrides = {}) {
  return measureAction(stores.getPromptStore(), jvLlmConfig(), { action, variables, ...overrides });
}
