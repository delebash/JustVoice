// SPDX-License-Identifier: MIT
// The attribution routes + the Auto row (the restore 2026-08-06; the tier-debris cleanup
// 2026-08-07 — Reasoned died, Auto routes by SIZE only, `tier` renamed `route` end to end) — the
// port of tests/test_attribution_restore.py: route choice (per-run override > Auto; no stored
// force), the reported route + source, and the size rule.
//
// The model is `pipeline.runFeature` (Python patched `pipeline.run_feature`); the prompt measure
// (`pipeline.measureFeature`, which only sizes pieces) is stubbed to "can't say" as well, so no
// test reaches a model — not even after `auto_judges_the_model_that_would_run` gives the local
// provider a default model.
import * as llmDb from "@delebash/llm-runner/llm/db";
import { afterEach, expect, test, vi } from "vitest";
import * as pipeline from "../src/extraction/pipeline.js";
import { construct, ExtractionSettings, modelDump } from "../src/models.js";
import { appClient, closeApps } from "./app_helpers.js";
import { bookJson } from "./jw_fixtures.js";

afterEach(closeApps);

/** The app over a seeded workspace (Python's `client` fixture). */
async function client() {
  const { c } = await appClient(undefined, { seed: true });
  return c;
}

/** A real JustWrite book.json — see jw_fixtures.js. → its first scene's id. */
async function _importProject(c) {
  const r = await c.post("/v1/projects/import?source=justwrite", { json: bookJson() });
  expect(r.status, r.text).toBe(200);
  const pid = r.json().project_id;
  const scenes = (await c.get(`/v1/projects/${pid}/scenes`)).json();
  return scenes[0].id;
}

/** `monkeypatch.setattr("justvoice.extraction.pipeline.run_feature", fn)`. */
function useModel(fn) {
  vi.spyOn(pipeline, "measureFeature").mockResolvedValue(null);
  vi.spyOn(pipeline, "runFeature").mockImplementation(fn);
}

function _fakeRun(captured) {
  return async (action, _variables, _overrides) => {
    captured.action = action;
    return { text: "[]", model: "stub-model", prompt_tokens: 7, completion_tokens: 3 };
  };
}

/** A run that answers nothing; `see(action, variables, overrides)` records what it was given. */
function _quietRun(see) {
  return async (action, variables, overrides) => {
    see(action, variables, overrides);
    return { text: "[]", model: "m", prompt_tokens: 0, completion_tokens: 0 };
  };
}

const HI = '"Hi," said Mara.';

test("route_override_and_auto_source", async () => {
  // A per-run override beats Auto, and the response names the route AND why it ran (no silent
  // state). No stored force exists anymore (the Auto simplification): a stale extraction.route in
  // a PATCH is ignored and production stays on Auto.
  const c = await client();
  const captured = {};
  useModel(_fakeRun(captured));
  const sceneId = await _importProject(c);

  // Auto (fresh install: no model routed → the size rule lands on Guided).
  let r = await c.post(`/v1/scenes/${sceneId}/analyze`, { json: { text: HI } });
  expect(r.status, r.text).toBe(200);
  expect(captured.action).toBe("speaker_attribution.guided");
  expect(r.json().route_used).toBe("guided");
  expect(r.json().route_source).toBe("auto");
  // §16: the response carries the run's usage numbers.
  const usage = r.json().usage;
  expect(usage.prompt_tokens).toBe(7);
  expect(usage.completion_tokens).toBe(3);
  expect(usage.model).toBe("stub-model");
  expect(usage.duration_ms).toBeGreaterThanOrEqual(0);

  // The retired pills' key is ignored wholesale — nothing gets forced.
  r = await c.patch("/v1/settings", { json: { extraction: { route: "direct" } } });
  expect(r.status, r.text).toBe(200);
  r = await c.post(`/v1/scenes/${sceneId}/analyze`, { json: { text: HI } });
  expect(r.status, r.text).toBe(200);
  expect(captured.action).toBe("speaker_attribution.guided");
  expect(r.json().route_source).toBe("auto");

  // A per-run override forces its route for THAT run only.
  r = await c.post(`/v1/scenes/${sceneId}/analyze`, { json: { text: HI, route: "direct" } });
  expect(r.status, r.text).toBe(200);
  expect(captured.action).toBe("speaker_attribution.direct");
  expect(r.json().route_used).toBe("direct");
  expect(r.json().route_source).toBe("forced");

  // The dead route value 422s loudly — no silent alias (the tier-debris cleanup: Reasoned died;
  // testing thinking = the think control).
  r = await c.post(`/v1/scenes/${sceneId}/analyze`, { json: { text: HI, route: "reasoned" } });
  expect(r.status).toBe(422);
});

test("auto_judges_each_card_by_its_own_model", async () => {
  // The size rule — Auto's ONLY rule since the tier-debris cleanup — judged against THAT card's
  // own model; the threshold is editable.
  const c = await client();
  const captured = {};
  useModel(_fakeRun(captured));
  const sceneId = await _importProject(c);

  const models = { direct: "big-model-30b", guided: "small-3b" };
  vi.spyOn(pipeline, "routeModel").mockImplementation((route) => models[route] ?? "");

  // Direct's card carries a 30B model (30 ≥ 14) → Direct runs.
  let r = await c.post(`/v1/scenes/${sceneId}/analyze`, { json: { text: HI } });
  expect(captured.action).toBe("speaker_attribution.direct");
  expect(r.json().route_used).toBe("direct");
  expect(r.json().route_source).toBe("auto");

  // Direct's card under the size line → Guided.
  models.direct = "mid-model-12b";
  await c.patch("/v1/settings", { json: { extraction: { direct_min_b: 14 } } });
  r = await c.post(`/v1/scenes/${sceneId}/analyze`, { json: { text: HI } });
  expect(captured.action).toBe("speaker_attribution.guided");

  // The size line is EDITABLE: lower it and the same 12B model is Direct.
  await c.patch("/v1/settings", { json: { extraction: { direct_min_b: 10 } } });
  r = await c.post(`/v1/scenes/${sceneId}/analyze`, { json: { text: HI } });
  expect(captured.action).toBe("speaker_attribution.direct");

  // Unknown size plays safe: an id with no size anywhere → Guided.
  models.direct = "mystery-model";
  await c.patch("/v1/settings", { json: { extraction: { direct_min_b: 14 } } });
  r = await c.post(`/v1/scenes/${sceneId}/analyze`, { json: { text: HI } });
  expect(captured.action).toBe("speaker_attribution.guided");
});

test("stale_force_keys_are_ignored", () => {
  // The retired dial's and pills' stored keys neither error nor force: the settings model
  // drops them (production is always Auto).
  const s = construct(ExtractionSettings, { reading_style: "direct", route: "direct" });
  expect(s.direct_min_b).toBe(14.0);
  const dumped = modelDump(ExtractionSettings, s);
  expect("route" in dumped).toBe(false);
  expect("reading_style" in dumped).toBe(false);
});

test("no_computed_budget_and_explicit_cap_rides", async () => {
  // Caps ruling 2026-08-07: no code-computed budgets — a run with no explicit value sends
  // maxTokens=null (preset empty = uncapped, nothing sent); an explicit per-call value still
  // rides untouched.
  const c = await client();
  const captured = {};
  useModel(
    _quietRun((action, _variables, overrides) => {
      captured[action] = overrides?.maxTokens ?? null;
    }),
  );
  const sceneId = await _importProject(c);

  await c.post(`/v1/scenes/${sceneId}/analyze`, { json: { text: HI, route: "direct" } });
  expect(captured["speaker_attribution.direct"]).toBeNull();

  await c.post(`/v1/scenes/${sceneId}/analyze`, { json: { text: HI, route: "guided" } });
  expect(captured["speaker_attribution.guided"]).toBeNull();

  const r = await c.post("/v1/extraction/analyze-text", { json: { text: HI, route: "direct", maxTokens: 2048 } });
  expect(r.status).toBe(200);
  expect(captured["speaker_attribution.direct"]).toBe(2048);
});

test("lab_run_uses_stored_project_corrections", async () => {
  // Part 5 (2026-08-06): the typed corrections box died — an adhoc Lab run carrying project_id
  // uses that project's STORED corrections through the same resolver production uses.
  const c = await client();
  const captured = {};
  useModel(
    _quietRun((_action, variables) => {
      captured.variables = variables;
    }),
  );
  await _importProject(c);
  const pid = (await c.get("/v1/projects")).json().projects[0].id;
  const speaker = (await c.get(`/v1/projects/${pid}/speakers`)).json().speakers[0];
  let r = await c.post(`/v1/projects/${pid}/corrections`, { json: { text_snippet: HI, speaker_id: speaker.id } });
  expect(r.status, r.text).toBe(200);

  r = await c.post("/v1/extraction/analyze-text", { json: { text: HI, project_id: pid } });
  expect(r.status, r.text).toBe(200);
  expect(captured.variables.corrections).toContain(HI);
});

test("cellar_sample_seeds", async () => {
  // The attribution Lab's seeded sample is the ORIGINAL Speaker Lab's cellar passage, word for
  // word (the Lab restoration Part 3, 2026-08-06; seeds-direct since the one-time migrations died
  // 2026-08-07).
  await client();
  const s = llmDb.session();
  const cellar = s.all("select * from test_samples where action_key = ? and label = ?", [
    "speaker_attribution.guided",
    "Cellar scene — the original Speaker Lab sample",
  ]);
  expect(cellar.length).toBe(1);
  const varsRows = s.all("select * from test_sample_vars where sample_id = ?", [cellar[0].id]);
  const byName = Object.fromEntries(varsRows.map((v) => [v.name, v.value]));
  expect(byName.paragraphs).toContain("cellar");
  expect(byName.speakers).toBe("Mara\nSarah");
});

test("extraction_config_has_no_force_field", async () => {
  // The pane is words + the size line — the config response carries no stored force (the pills
  // died; production always runs Auto).
  const c = await client();
  const r = await c.get("/v1/extraction/config");
  expect(r.status).toBe(200);
  expect(r.json()).not.toHaveProperty("route");
});

test("lab_tunables_pass_through", async () => {
  // Part 2 (2026-08-06): the Lab column's Reasoning / Max tok / Top-p / samplers are REAL — they
  // ride the analyze request into the shared run path (they were verified inert before: adapter
  // dropped them AND the request model rejected them).
  const c = await client();
  const captured = {};
  useModel(
    _quietRun((_action, _variables, overrides) => {
      captured.overrides = overrides;
    }),
  );
  const r = await c.post("/v1/extraction/analyze-text", {
    json: {
      text: HI,
      route: "direct",
      think: true,
      reasoningEffort: "low",
      maxTokens: 512,
      topP: 0.9,
      samplers: [{ flagName: "top_k", flagValue: "40" }],
    },
  });
  expect(r.status, r.text).toBe(200);
  const o = captured.overrides;
  expect(o.think).toBe(true);
  expect(o.reasoningEffort).toBe("low");
  expect(o.maxTokens).toBe(512);
  expect(o.topP).toBe(0.9);
  expect(o.samplers).toEqual([{ flagName: "top_k", flagValue: "40" }]);
});

test("auto_judges_the_model_that_would_run", async () => {
  // Judge-what-runs (ruled 2026-08-06: "it just defaults to default model"): a card whose preset
  // ships model-empty is judged by the model the run would actually land on — its provider's
  // default model — so the size rule works on a setup that never hand-filled the presets.
  const c = await client();
  const captured = {};
  useModel(_fakeRun(captured));
  const sceneId = await _importProject(c);

  // Fresh state: presets ship model-empty and the provider has no default → every card judges
  // empty → Guided (the safe floor).
  expect(pipeline.routeModel("direct")).toBe("");
  let r = await c.post(`/v1/scenes/${sceneId}/analyze`, { json: { text: HI } });
  expect(captured.action).toBe("speaker_attribution.guided");

  // Give the local provider a default model through the app's own door (the PATCH re-registers
  // the adapter, exactly like the provider form).
  const rows = (await c.get("/v1/llm-providers")).json().providers;
  const local = rows.find((p) => p.id === "local-llamacpp");
  r = await c.patch("/v1/llm-providers/local-llamacpp", { json: { ...local, apiKey: "", defaultModel: "gemma-4-26b-a4b-qat" } });
  expect(r.status, r.text).toBe(200);

  // The judge now sees what the run would use: preset model empty → the provider default — a
  // 26B MoE (TOTAL params) ≥ 14 → Direct, by Auto.
  expect(pipeline.routeModel("direct")).toBe("gemma-4-26b-a4b-qat");
  r = await c.post(`/v1/scenes/${sceneId}/analyze`, { json: { text: HI } });
  expect(captured.action).toBe("speaker_attribution.direct");
  expect(r.json().route_used).toBe("direct");
  expect(r.json().route_source).toBe("auto");
});
