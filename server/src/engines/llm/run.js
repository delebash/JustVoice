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

import { measureAction, runAction, stores, streamAction } from "@delebash/llm-runner/llm";
import { buildLlmConfig } from "@delebash/llm-runner/llm/config_builder";
import { PREFER_LOCAL_FEATURES } from "../../feature_catalog.js";

/** The dispatch view over the shared stores — JV's one per-app input is the prefer-local set
 * (the same value installLlm registers). */
export function jvLlmConfig() {
  return buildLlmConfig(PREFER_LOCAL_FEATURES);
}

/** Run one feature action → the kit's LLMResponse. */
export async function runFeature(action, variables, overrides = {}) {
  return runAction(stores.getPromptStore(), jvLlmConfig(), { action, variables, ...overrides });
}

/** runFeature's streaming sibling (lane 2A, 2026-08-08): the kit's streamAction over the same
 * store + config — an async iterator of StreamDelta (text chunks, optional prompt-eval
 * `progress`, a final `done` with usage). Resolution + the local-model ensure run eagerly, so
 * callers get LLMNotConfiguredError before any frame: `for await (const d of await
 * streamFeature(…))`. */
export async function streamFeature(action, variables, overrides = {}) {
  return streamAction(stores.getPromptStore(), jvLlmConfig(), { action, variables, ...overrides });
}

/** How big runFeature's prompt would be, and the context it must fit — the kit's
 * measureAction over the same store + config (chapter splitting, 2026-09-28). null off the
 * local runner or when the router cannot say. */
export async function measureFeature(action, variables, overrides = {}) {
  return measureAction(stores.getPromptStore(), jvLlmConfig(), { action, variables, ...overrides });
}
