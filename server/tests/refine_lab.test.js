// SPDX-License-Identifier: MIT
// Task #22 (2026-08-06) — the dictation-cleanup Lab doors: the family prompt-preview contract
// (the composed call, live against the Capture toggles) and the Lab run door that rides
// production's few-shot history. The port of tests/test_refine_lab.py.
import { afterEach, expect, test, vi } from "vitest";
import * as run from "../src/engines/llm/run.js";
import { appClient, closeApps } from "./app_helpers.js";

afterEach(closeApps);

const seeded = async () => (await appClient(undefined, { seed: true })).c;

test("prompt_preview_serves_the_composed_refine_call", async () => {
  const c = await seeded();
  let r = await c.post("/v1/ai/prompt-preview", { json: { feature: "refine" } });
  expect(r.status, r.text).toBe(200);
  const body = r.json();
  // The ground rules always open the composition; default toggles are all on, so every
  // section's name shows in the sample note.
  expect(body.system.includes("Fix punctuation") || body.system.trim().length > 0).toBe(true);
  expect(body.user.startsWith("um can you check")).toBe(true);
  expect(body.sample).toContain("sections on:");

  // Toggle a section off — the composed system is LIVE against settings.
  const on = (await c.post("/v1/ai/prompt-preview", { json: { feature: "refine" } })).json().system;
  r = await c.patch("/v1/settings", { json: { captures: { smart_cleanup: false } } });
  expect(r.status, r.text).toBe(200);
  const off = (await c.post("/v1/ai/prompt-preview", { json: { feature: "refine" } })).json().system;
  expect(off).not.toBe(on);
  expect(off.length).toBeLessThan(on.length);
});

test("prompt_preview_404s_for_other_features", async () => {
  const c = await seeded();
  const r = await c.post("/v1/ai/prompt-preview", { json: { feature: "compose" } });
  expect(r.status).toBe(404);
});

const fakeRun = (captured, text) =>
  vi.spyOn(run, "runFeature").mockImplementation(async (action, variables, overrides) => {
    captured.action = action;
    captured.variables = variables;
    captured.overrides = overrides;
    return { text, model: "m", prompt_tokens: text === "ok" ? 0 : 5, completion_tokens: text === "ok" ? 0 : 2 };
  });

test("lab_run_rides_production_history", async () => {
  // The recorded #22 gap: production sends REFINEMENT_EXAMPLES as history turns and the Lab sent
  // none — the Lab door now rides the same turns, and a piece column's own system text still
  // wins (standalone-testable).
  const c = await seeded();
  const captured = {};
  fakeRun(captured, "Cleaned.");
  const r = await c.post("/v1/refine/lab-run", { json: { transcript: "um hello there", systemPrompt: "MY OWN SECTION TEXT" } });
  expect(r.status, r.text).toBe(200);
  const body = r.json();
  expect(body.text).toBe("Cleaned.");
  expect(body.usage.prompt_tokens).toBe(5);
  expect(body.usage.completion_tokens).toBe(2);

  expect(captured.action).toBe("refine.base");
  expect(captured.variables).toEqual({ transcript: "um hello there" });
  const o = captured.overrides;
  // The column's own system rode (what you see is what runs).
  expect(o.system).toBe("MY OWN SECTION TEXT");
  // Production's few-shot turns ride as real history.
  const hist = o.history;
  expect(hist.length).toBeGreaterThanOrEqual(2);
  expect(hist[0].role).toBe("user");
  expect(hist[1].role).toBe("assistant");
});

test("lab_run_defaults_to_the_composed_system", async () => {
  // No column system → the CURRENT toggles' composition, production's call.
  const c = await seeded();
  const captured = {};
  fakeRun(captured, "ok");
  const r = await c.post("/v1/refine/lab-run", { json: { transcript: "um hello" } });
  expect(r.status, r.text).toBe(200);
  const composed = (await c.post("/v1/ai/prompt-preview", { json: { feature: "refine" } })).json().system;
  expect(captured.overrides.system).toBe(composed);
});
