// SPDX-License-Identifier: MIT
// The dictation-cleanup Lab doors (the port of justvoice/api/refine_lab_api.py).
//
// POST /v1/ai/prompt-preview — the family prompt-preview contract, surviving solely as the
// COMPOSED-CALL door (the 2026-08-08 carve-out): for the `refine` feature it returns the REAL
// composed call — the base template rendered with the sections the user's Capture toggles
// enable — so what the sectioned pane shows and tunes is exactly what a dictation run sends.
// Any other feature 404s (fail-loud; the kit shows the error line, never a fallback picker).
//
// POST /v1/refine/lab-run — the refine Lab's run door: the SAME path production takes
// (explicit composed system + the few-shot REFINEMENT_EXAMPLES history), with the column's
// overrides riding like any feature's.

import { LLMNotConfiguredError } from "@delebash/llm-runner/llm";
import { HttpError } from "@delebash/llm-runner/platform/errors";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { nullable, opt, T } from "@delebash/llm-runner/platform/models";
import { pyInt } from "@delebash/llm-runner/platform/py";
import { getState } from "../app_state.js";
import * as run from "../engines/llm/run.js";
import { construct } from "../models.js";
import { strRepr } from "../py_compat.js";
import { composeRefinementSystem, REFINEMENT_EXAMPLES, RefinementFlags } from "../refinement.js";

const log = getLogger("justvoice.api.refine_lab_api");

export const PromptPreviewRequest = T.Object({ feature: T.String() });

export const PromptPreviewResponse = T.Object({ system: T.String(), user: T.String(), sample: opt(T.String(), "") });

// The seeded refine.base Lab sample's transcript (seed_presets.js) — the preview's user half
// shows a real dictation, not a placeholder.
const _PREVIEW_TRANSCRIPT = "um can you check if the uh export finished before we send it";

export function _currentFlags() {
  const s = getState().settings.get();
  return new RefinementFlags({
    smartCleanup: s.captures.smart_cleanup,
    selfCorrection: s.captures.self_correction,
    preserveTechnical: s.captures.preserve_technical,
  });
}

/** The refine Lab column's run body — camelCase like the shared LLM-config contract. */
export const RefineLabRunRequest = T.Object({
  transcript: opt(T.String(), ""),
  systemPrompt: opt(nullable(T.String()), null),
  userPrompt: opt(nullable(T.String()), null),
  providerId: opt(nullable(T.String()), null),
  model: opt(nullable(T.String()), null),
  temperature: opt(nullable(T.Number()), null),
  think: opt(nullable(T.Boolean()), null),
  reasoningEffort: opt(nullable(T.String()), null),
  maxTokens: opt(nullable(T.Integer()), null),
  topP: opt(nullable(T.Number()), null),
  samplers: opt(T.Array(T.Record(T.String(), T.Any())), []),
});

export const RefineLabRunResponse = T.Object({
  text: T.String(),
  model: opt(T.String(), ""),
  usage: opt(T.Record(T.String(), T.Any()), {}),
});

const msg = (e) => e?.message ?? String(e);

export async function router(app) {
  app.post("/v1/ai/prompt-preview", { schema: { body: PromptPreviewRequest } }, async (req) => {
    if (req.body.feature !== "refine") throw new HttpError(404, `no prompt preview for ${strRepr(req.body.feature)}`);
    const flags = _currentFlags();
    const on = Object.entries(flags.toDict())
      .filter(([, v]) => v)
      .map(([k]) => k.replaceAll("_", " "));
    return construct(PromptPreviewResponse, {
      system: composeRefinementSystem(flags),
      user: _PREVIEW_TRANSCRIPT,
      sample: on.length ? `sections on: ${on.join(", ")}` : "ground rules only",
    });
  });

  app.post("/v1/refine/lab-run", { schema: { body: RefineLabRunRequest } }, async (req) => {
    const body = req.body;
    const all = {
      providerId: body.providerId,
      model: body.model,
      temperature: body.temperature,
      think: body.think,
      reasoningEffort: body.reasoningEffort,
      maxTokens: body.maxTokens,
      topP: body.topP,
      samplers: body.samplers.length ? body.samplers : null,
      system: body.systemPrompt,
      userTemplate: body.userPrompt,
    };
    const overrides = Object.fromEntries(Object.entries(all).filter(([, v]) => v !== null));
    // The column's own system wins when it sent one (what you see is what runs); else the
    // CURRENT toggles' composition — exactly production's call (the sectioned redesign).
    if (!Object.hasOwn(overrides, "system")) overrides.system = composeRefinementSystem(_currentFlags());
    const t0 = performance.now();
    let resp;
    try {
      resp = await run.runFeature(
        "refine.base",
        { transcript: body.transcript || "" },
        {
          history: REFINEMENT_EXAMPLES.flatMap(([user, assistant]) => [
            { role: "user", content: user },
            { role: "assistant", content: assistant },
          ]),
          ...overrides,
        },
      );
    } catch (e) {
      if (e instanceof LLMNotConfiguredError) throw new HttpError(501, msg(e));
      log.exception("refine lab run failed", e);
      throw new HttpError(502, `refine failed: ${msg(e)}`);
    }
    return construct(RefineLabRunResponse, {
      text: resp.text,
      model: resp.model,
      usage: {
        prompt_tokens: pyInt(resp.prompt_tokens || 0),
        completion_tokens: pyInt(resp.completion_tokens || 0),
        duration_ms: Math.trunc(performance.now() - t0),
        model: resp.model || "",
      },
    });
  });
}
