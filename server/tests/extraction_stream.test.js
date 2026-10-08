// SPDX-License-Identifier: MIT
// POST /v1/scenes/{id}/analyze/stream — lane 2A of the AI-call convention (the port of
// tests/test_extraction_stream.py).
//
// The streaming analyze must be the SAME pipeline as /analyze with the reply travelling as family
// SSE frames: `data:{"delta"}` per chunk, a final `data:{"done":true,...}` carrying the usage names
// top-level PLUS the AnalyzeSceneResponse fields, then `data:[DONE]`; a no-LLM state arrives as
// `data:{"error"}` inside the stream (it has already started — no HTTP status).
//
// The model is `pipeline.streamFeature` (Python patched `pipeline.stream_feature`); the prompt
// measure (`pipeline.measureFeature`, which only sizes pieces) is stubbed to "can't say" too.
//
// `stream_emits_deltas_then_a_done_frame_with_rows_and_usage` FAILS in Python today (measured
// 2026-10-08): its fake deltas are SimpleNamespaces with no `reasoning` attribute, which the
// pipeline's stream reader reads, so the run ends in an error frame. Here a missing field is just
// undefined and the test passes as written.
import { LLMNotConfiguredError } from "@delebash/llm-runner/llm";
import { strip, isDict } from "@delebash/llm-runner/platform/py";
import { afterEach, expect, test, vi } from "vitest";
import * as pipeline from "../src/extraction/pipeline.js";
import { appClient, closeApps } from "./app_helpers.js";
import { bookJson } from "./jw_fixtures.js";

afterEach(closeApps);

/** The app over a seeded workspace (Python's `client` fixture). */
async function client() {
  const { c } = await appClient(undefined, { seed: true });
  return c;
}

async function _sceneId(c) {
  const r = await c.post("/v1/projects/import?source=justwrite", { json: bookJson() });
  expect(r.status, r.text).toBe(200);
  const pid = r.json().project_id;
  return (await c.get(`/v1/projects/${pid}/scenes`)).json()[0].id;
}

function _frames(body) {
  const out = [];
  for (const line of body.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = strip(line.slice(5));
    out.push(payload === "[DONE]" ? "[DONE]" : JSON.parse(payload));
  }
  return out;
}

/** `monkeypatch.setattr("justvoice.extraction.pipeline.stream_feature", fn)`. */
function useStream(fn) {
  vi.spyOn(pipeline, "measureFeature").mockResolvedValue(null);
  vi.spyOn(pipeline, "streamFeature").mockImplementation(fn);
}

test("stream_emits_deltas_then_a_done_frame_with_rows_and_usage", async () => {
  const c = await client();
  const actions = [];
  useStream(async (action, _variables, _overrides) => {
    actions.push(action);
    return (async function* fakeStream() {
      yield { done: false, text: '[{"speaker": ', progress: null };
      yield { done: false, text: '"mara", "confidence": 0.9}]', progress: null };
      yield { done: true, text: "", progress: null, prompt_tokens: 321, completion_tokens: 45, model: "stub-model" };
    })();
  });

  const sceneId = await _sceneId(c);
  const r = await c.post(`/v1/scenes/${sceneId}/analyze/stream`, { json: { text: '"Hi," said Mara.' } });
  expect(r.status, r.text).toBe(200);
  expect(r.headers["content-type"].startsWith("text/event-stream")).toBe(true);
  // Python asserted this inside the fake stream.
  expect(actions.length).toBeGreaterThan(0);
  expect(actions.every((a) => a.startsWith("speaker_attribution."))).toBe(true);

  const frames = _frames(r.text);
  const deltas = frames.filter((f) => isDict(f) && "delta" in f);
  expect(deltas.map((f) => f.delta).join("")).toBe('[{"speaker": "mara", "confidence": 0.9}]');

  const dones = frames.filter((f) => isDict(f) && f.done);
  expect(dones.length).toBe(1);
  const [done] = dones;
  // The family usage names, top level — what the kit client normalizes.
  expect(done.promptTokens).toBe(321);
  expect(done.completionTokens).toBe(45);
  expect(done.model).toBe("stub-model");
  // The domain payload — same names as AnalyzeSceneResponse.
  expect(done.scene_id).toBe(sceneId);
  expect(["guided", "direct"]).toContain(done.route_used);
  expect(Array.isArray(done.rows)).toBe(true);
  expect(done.rows.length).toBeGreaterThan(0);
  // The stub answered "mara" — not a real speaker id. Since 2026-09-28 an answer is resolved to
  // the cast by name (pipeline.resolveSpeaker), so the row carries Mara Vance's REAL speaker id
  // instead of the phantom "mara".
  const speakers = [];
  for (const proj of (await c.get("/v1/projects")).json().projects) {
    speakers.push(...(await c.get(`/v1/projects/${proj.id}/speakers`)).json().speakers);
  }
  const maraId = speakers.find((sp) => sp.name === "Mara Vance").id;
  expect(done.rows.some((row) => row.speaker === maraId)).toBe(true);
  expect(done.usage.prompt_tokens).toBe(321);
  // The write happens in the response layer, not the worker, so that a cancelled run can be
  // caught before it touches the chapter. Its receipt rides the same frame.
  expect(["in_place", "resegmented"]).toContain(done.persisted.mode);
  expect(done).not.toHaveProperty("__rows__");

  expect(frames.at(-1)).toBe("[DONE]");
});

test("stream_surfaces_no_llm_as_an_error_frame", async () => {
  const c = await client();
  useStream(async () => {
    throw new LLMNotConfiguredError("no LLM provider registered");
  });

  const sceneId = await _sceneId(c);
  const r = await c.post(`/v1/scenes/${sceneId}/analyze/stream`, { json: { text: '"Hi," said Mara.' } });
  expect(r.status).toBe(200); // the stream started; the error is a frame
  const frames = _frames(r.text);
  const errs = frames.filter((f) => isDict(f) && "error" in f);
  expect(errs.length).toBe(1);
  expect(errs[0].error).toContain("provider");
  expect(frames.at(-1)).toBe("[DONE]");
});

test("stream_404s_an_unknown_scene_before_streaming", async () => {
  const c = await client();
  const r = await c.post("/v1/scenes/nope/analyze/stream", { json: { text: "x" } });
  expect(r.status).toBe(404);
});
