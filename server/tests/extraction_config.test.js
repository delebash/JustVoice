// SPDX-License-Identifier: MIT
// Speaker Lab truth surface — GET /v1/extraction/config + the per-call user_prompt /
// confidence_floor overrides (Lab parity redesign) — the port of tests/test_extraction_config.py.
//
// As in Python, the model seam is the ADAPTER: a FakeAdapter registered in the kit's registry
// under the preset's provider id, its `chat` replaced per test, so the real run path (template
// row → render → preset → dispatch) runs end to end. The prompt measure
// (`pipeline.measureFeature`, which only sizes pieces) is stubbed to "can't say" on the routes
// that run the pipeline, so nothing probes a local runner.
import { getLlmRegistry, LLMResponse } from "@delebash/llm-runner/llm";
import { setEnsureLocalModel } from "@delebash/llm-runner/llm/dispatch";
import { RuntimeError, rstrip, cpSlice } from "@delebash/llm-runner/platform/py";
import { afterEach, expect, test, vi } from "vitest";
import * as pipeline from "../src/extraction/pipeline.js";
import { appClient, closeApps } from "./app_helpers.js";

class FakeAdapter {
  constructor(providerId, defaultModel) {
    this.provider_id = providerId;
    this.provider_type = "ollama";
    this.default_model = defaultModel;
  }

  async chat() {
    throw new Error("NotImplementedError"); // not exercised
  }

  async *streamChat() {
    throw new Error("NotImplementedError"); // not exercised
  }
}

// The registry's adapters before a test emptied it — put back after (Python's fixture teardown).
let saved = null;

function emptyRegistry() {
  const reg = getLlmRegistry();
  saved = reg.all();
  reg._adapters = new Map();
  return reg;
}

afterEach(async () => {
  await closeApps();
  if (saved !== null) {
    getLlmRegistry()._adapters = new Map(saved.map((a) => [a.provider_id, a]));
    saved = null;
  }
});

/** The app over a seeded workspace with ONE fake provider (Python's `app` fixture). */
async function fakeApp() {
  const { c } = await appClient(undefined, { seed: true });
  const reg = emptyRegistry();
  // Registered under the PRESET's provider id (F1 Phase 2: the route truth is the action's
  // preset — provider local-llamacpp, model "" → the provider's default fills in).
  reg.register(new FakeAdapter("local-llamacpp", "qwen3:8b"));
  // installLlm wired the ensure-local hook to the real runner service; a local-routed unit-test
  // run must not try to LOAD a model.
  setEnsureLocalModel(null);
  return c;
}

/** `monkeypatch.setattr(FakeAdapter, "chat", fn)`; the measure answers "can't say". */
function useChat(fn) {
  vi.spyOn(pipeline, "measureFeature").mockResolvedValue(null);
  vi.spyOn(FakeAdapter.prototype, "chat").mockImplementation(fn);
}

test("extraction_config_shape", async () => {
  const c = await fakeApp();
  const r = await c.get("/v1/extraction/config");
  expect(r.status).toBe(200);
  const body = r.json();

  // TWO routes (Reasoned died in the tier-debris cleanup 2026-08-07) with the measured floors —
  // JV-local ROUTE_FLOORS now.
  expect(new Set(body.routes.map((t) => t.name))).toEqual(new Set(["guided", "direct"]));
  const floors = Object.fromEntries(body.routes.map((t) => [t.name, t.confidence_floor]));
  expect(floors.guided).toBe(0.7);
  expect(floors.direct).toBe(0.5);

  // The Auto row's truth: the editable size rule + the pick with its work (each line names the
  // model it judged). The stored force (`route`) died with the pills (the Auto simplification) —
  // production always runs Auto.
  expect(body).not.toHaveProperty("route");
  expect(body.direct_min_b).toBe(14.0);
  expect(["guided", "direct"]).toContain(body.auto_picked);
  expect(body.auto_checks.length, "the readout must show Auto's work").toBeGreaterThan(0);
  for (const check of body.auto_checks) expect(new Set(Object.keys(check))).toEqual(new Set(["route", "model", "passed", "rule"]));

  // Real prompt bodies, not placeholders — guided extends direct with the worked examples.
  expect(body.system_prompts.direct).toContain("RULES:");
  expect(body.system_prompts.guided).toContain("WORKED EXAMPLES:");
  expect(body.system_prompts.guided.startsWith(cpSlice(rstrip(body.system_prompts.direct), 0, 40))).toBe(true);
  // The shared renderer's {{var}} placeholders (F1 Phase 2 — the old single-brace .replace
  // tokens converted with the template-row move).
  for (const token of ["{{speakers}}", "{{corrections}}", "{{paragraphs}}"]) expect(body.user_template).toContain(token);
});

test("extraction_config_no_provider", async () => {
  const { c } = await appClient(undefined, { seed: true });
  emptyRegistry();
  const r = await c.get("/v1/extraction/config");
  expect(r.status).toBe(200);
  const body = r.json();
  expect(body.system_prompts.guided).toBeTruthy(); // prompts still served
  // No model routed anywhere → the rules land on Guided, visibly.
  expect(body.auto_picked).toBe("guided");
});

/** FakeAdapter.chat replacement — captures what the RENDERED template produced (the real run
 * path end-to-end, adapter as the seam). */
function _captureAdapterChat(captured) {
  return async (messages, { system = null } = {}) => {
    captured.system = system;
    captured.user = messages.at(-1).content;
    // Two dialogue segments: one confident, one at 0.6.
    return LLMResponse({
      text: '[{"speaker": "c_mara", "confidence": 0.9}, {"speaker": "c_sarah", "confidence": 0.6}]',
      prompt_tokens: 0,
      completion_tokens: 0,
      model: "",
    });
  };
}

const TEXT = 'Mara stood up.\n\n"Hello," she said.\n\n"Hi."';
const CAST = [
  { id: "c_mara", name: "Mara" },
  { id: "c_sarah", name: "Sarah" },
];

test("provider_override_routes_call", async () => {
  // Register a second provider; the Lab's provider_id override must route through it (and pick
  // up ITS default model).
  const c = await fakeApp();
  getLlmRegistry().register(new FakeAdapter("prov-cloud", "gpt-4o-mini"));
  const captured = {};

  useChat(async function (_messages, { model = null } = {}) {
    captured.provider = this.provider_id;
    captured.model = model;
    return LLMResponse({ text: '[{"speaker": "c_mara", "confidence": 0.9}]', prompt_tokens: 0, completion_tokens: 0, model: "" });
  });
  const r = await c.post("/v1/extraction/analyze-text", {
    json: { text: '"Hello," Mara said.', characters: CAST, providerId: "prov-cloud" },
  });
  expect(r.status).toBe(200);
  expect(captured.provider).toBe("prov-cloud");
  expect(captured.model).toBe("gpt-4o-mini");
});

test("user_prompt_and_floor_overrides", async () => {
  const c = await fakeApp();
  const captured = {};
  useChat(_captureAdapterChat(captured));

  // Custom user template ({{var}} — the shared renderer's syntax) is interpolated and sent;
  // custom floor (0.65) keeps the 0.6 pick floored even on the direct route (default 0.5), and
  // the response echoes the effective floor.
  const r = await c.post("/v1/extraction/analyze-text", {
    json: {
      text: TEXT,
      characters: CAST,
      route: "direct",
      propagate: false,
      userPrompt: "CAST:\n{{speakers}}\nBODY:\n{{paragraphs}}",
      confidence_floor: 0.65,
      // The main call's prompt is what this pins; the second look would ask again about the
      // floored line and its prompt would be the one captured.
      second_look: false,
    },
  });
  expect(r.status).toBe(200);
  const body = r.json();
  expect(body.confidence_floor).toBe(0.65);
  expect(captured.user.startsWith("CAST:\n")).toBe(true);
  expect(captured.user).toContain('id="mara"'); // the model sees a name handle, not the id
  expect(captured.user).not.toContain("{{paragraphs}}");

  const dialogue = body.rows.filter((row) => row.kind === "dialogue");
  const floored = dialogue.filter((row) => row.source === "floored");
  expect(floored.length).toBe(1);
  expect(floored[0].floored_from).toBe("c_sarah");

  // Same call without the floor override: direct route's 0.5 applies, so the 0.6 pick survives.
  const r2 = await c.post("/v1/extraction/analyze-text", {
    json: { text: TEXT, characters: CAST, route: "direct", propagate: false },
  });
  expect(r2.status).toBe(200);
  expect(r2.json().confidence_floor).toBe(0.5);
  expect(r2.json().rows.filter((row) => row.source === "floored")).toEqual([]);
});

test("direct_min_b_has_an_api_floor", async () => {
  // Part 7 rider (2026-08-06): the size line's API floor mirrors the pane input's min=0.1 — zero
  // or negative would route EVERY model to Direct.
  const c = await fakeApp();
  let r = await c.patch("/v1/settings", { json: { extraction: { direct_min_b: 0 } } });
  expect([400, 422], r.text).toContain(r.status);
  r = await c.patch("/v1/settings", { json: { extraction: { direct_min_b: -3 } } });
  expect([400, 422], r.text).toContain(r.status);
  r = await c.patch("/v1/settings", { json: { extraction: { direct_min_b: 0.5 } } });
  expect(r.status, r.text).toBe(200);
  expect((await c.get("/v1/extraction/config")).json().direct_min_b).toBe(0.5);
});

// ── a failed model call stops the run, with a reason (2026-09-28, pass 10) ──
// The pipeline used to swallow every failure into a chapter of "unknown" lines: a chapter past
// the context, a timeout, a model that would not load all looked like "the model couldn't tell
// who spoke", with no message anywhere.

const OVERFLOW =
  'local-llamacpp 400: {"error":{"code":400,"message":"request (34514 tokens) exceeds ' +
  'the available context size (32768 tokens), try increasing it","type":' +
  '"exceed_context_size_error","n_prompt_tokens":34514,"n_ctx":32768}}';

function _failingChat(message) {
  return async () => {
    throw new RuntimeError(message);
  };
}

test("a_chapter_past_the_context_says_so", async () => {
  const c = await fakeApp();
  useChat(_failingChat(OVERFLOW));
  const r = await c.post("/v1/extraction/analyze-text", { json: { text: TEXT, characters: CAST, route: "direct" } });
  expect(r.status).toBe(502);
  const detail = r.json().detail;
  // Every piece is refused, so splitting halves down to one paragraph and then says so.
  expect(detail.startsWith("A paragraph of this chapter is too long for the model to read")).toBe(true);
  expect(detail).toContain("34,514 tokens");
  expect(detail).toContain("32,768");
});

test("any_other_model_failure_carries_the_providers_reason", async () => {
  const c = await fakeApp();
  useChat(_failingChat("local-llamacpp request failed: timed out"));
  const r = await c.post("/v1/extraction/analyze-text", { json: { text: TEXT, characters: CAST, route: "direct" } });
  expect(r.status).toBe(502);
  expect(r.json().detail).toBe("The model call failed: local-llamacpp request failed: timed out");
});
