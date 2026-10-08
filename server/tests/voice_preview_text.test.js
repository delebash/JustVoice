// SPDX-License-Identifier: MIT
// POST /v1/voices/{id}/preview with your own line + knobs (Slice B) (the port of
// tests/test_voice_preview_text.py).
//
// The audition panel types a line and turns knobs, so the endpoint grew an optional
// `{text, delivery}` body and a small rendered-audition cache. The rules under test:
//   * your text reaches the synth, and a repeat listen is served from cache rather than paid
//     for again;
//   * changing ANY knob is a different sound, so it is a different key;
//   * a chapter pasted into the audition box is refused with a readable message rather than
//     synthesized;
//   * no body at all is still the canned audition, byte-for-byte.
// conftest's autouse `_clear_audition_cache` is the beforeEach below.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as generateApi from "../src/api/generate_api.js";
import * as voicePreviewApi from "../src/api/voice_preview_api.js";
import { getState } from "../src/app_state.js";
import * as manager from "../src/engines/manager.js";
import { Delivery, modelDump } from "../src/models.js";
import { appClient, closeApps } from "./app_helpers.js";

beforeEach(() => voicePreviewApi._resetAuditionCache());
afterEach(closeApps);

/** The app, with the manager synth seam stood in for: records every request that got as far
 * as an actual render. */
async function setup() {
  const { c } = await appClient();
  const mgr = manager.getManager();
  vi.spyOn(mgr, "currentId").mockReturnValue("kokoro");
  vi.spyOn(mgr, "currentFor").mockReturnValue("kokoro");
  // These tests exercise the audition surface, not install state.
  vi.spyOn(manager.EngineManifest.prototype, "isInstalled", "get").mockReturnValue(true);
  const calls = [];
  vi.spyOn(generateApi, "_generateViaManager").mockImplementation(async (_engineId, req) => {
    calls.push([req.text, req.delivery ? modelDump(Delivery, req.delivery, { excludeNone: true }) : {}]);
    return Buffer.from("RIFFfake");
  });
  return { c, calls };
}

test("custom_text_renders_then_serves_from_cache", async () => {
  const { c, calls } = await setup();
  const body = { text: "The fog came in over the pier." };

  const first = await c.post("/v1/voices/af_heart/preview", { json: body });
  expect(first.status, first.text).toBe(200);
  expect(calls).toEqual([["The fog came in over the pier.", {}]]);

  const before = voicePreviewApi.auditionCacheHits;
  const second = await c.post("/v1/voices/af_heart/preview", { json: body });

  expect(second.status).toBe(200);
  expect(second.content.equals(first.content)).toBe(true);
  expect(voicePreviewApi.auditionCacheHits).toBe(before + 1);
  // The second listen never reached the engine.
  expect(calls.length).toBe(1);
});

test("a_changed_knob_is_a_different_audition", async () => {
  const { c, calls } = await setup();
  await c.post("/v1/voices/af_heart/preview", { json: { text: "Same line.", delivery: { speed: 1.0 } } });
  await c.post("/v1/voices/af_heart/preview", { json: { text: "Same line.", delivery: { speed: 1.4 } } });

  expect(calls.length).toBe(2);
  expect(calls[0][1]).toEqual({ speed: 1.0 });
  expect(calls[1][1]).toEqual({ speed: 1.4 });
});

test("engine_private_knobs_survive_the_trip", async () => {
  // Engines read their own knobs from `delivery.engine`, so the subdict has to reach the synth
  // intact — dropping it is how a turned knob ends up changing nothing.
  const { c, calls } = await setup();
  await c.post("/v1/voices/af_heart/preview", { json: { text: "Line.", delivery: { speed: 1.1, engine: { exaggeration: 1.4 } } } });

  expect(calls[0][1]).toEqual({ speed: 1.1, engine: { exaggeration: 1.4 } });
});

test("key_ignores_delivery_key_order", async () => {
  const { c, calls } = await setup();
  await c.post("/v1/voices/af_heart/preview", { json: { text: "Same line.", delivery: { speed: 1.1, pitch: 2 } } });
  await c.post("/v1/voices/af_heart/preview", { json: { text: "Same line.", delivery: { pitch: 2, speed: 1.1 } } });

  // Same sound, one render — the key canonicalizes the dict.
  expect(calls.length).toBe(1);
});

test("a_pasted_chapter_is_refused_readably", async () => {
  const { c, calls } = await setup();
  const limits = getState().settings.get().limits;
  const tooLong = "x".repeat(Math.max(300, limits.text_max_chars) + 1);

  const r = await c.post("/v1/voices/af_heart/preview", { json: { text: tooLong } });

  expect(r.status).toBe(400);
  expect(r.text).toContain("not a chapter");
  expect(calls).toEqual([]);
});

test("no_body_is_still_the_canned_audition", async () => {
  const { c, calls } = await setup();
  const r = await c.post("/v1/voices/af_heart/preview");

  expect(r.status, r.text).toBe(200);
  expect(calls).toEqual([[voicePreviewApi.PREVIEW_LINE_DEFAULT, {}]]);
});

test("the_floor_holds_when_the_operator_clamps_generation", async () => {
  // An operator who clamps generation to a short line still gets a usable audition — the
  // floor is what keeps the panel from becoming unusable.
  const { c, calls } = await setup();
  let r = await c.patch("/v1/settings", { json: { limits: { text_max_chars: 40 } } });
  expect(r.status, r.text).toBe(200);

  const line = "y".repeat(250); // over the operator's limit, under the audition floor
  r = await c.post("/v1/voices/af_heart/preview", { json: { text: line } });

  expect(r.status, r.text).toBe(200);
  expect(calls).toEqual([[line, {}]]);
});
