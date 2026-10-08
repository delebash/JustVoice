// SPDX-License-Identifier: MIT
// POST /v1/voices/{id}/preview — row audition with ask-before-load (the port of
// tests/test_voice_row_preview.py).
//
// Exercises the real app against a temp data dir: the managed kokoro manifest is present
// (static voices resolve) but never loaded, so the endpoint must 409 with the engine id instead
// of 404/405 — the bug this endpoint replaced. The auto_load happy path stands in for the
// manager's load and the synth seam. Kokoro counts as installed (the autouse fixture): these
// tests are about the LOADED gate behind the install gate.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as generateApi from "../src/api/generate_api.js";
import * as voicePreviewApi from "../src/api/voice_preview_api.js";
import * as manager from "../src/engines/manager.js";
import { appClient, closeApps } from "./app_helpers.js";

beforeEach(() => {
  voicePreviewApi._resetAuditionCache();
  vi.spyOn(manager.EngineManifest.prototype, "isInstalled", "get").mockReturnValue(true);
});
afterEach(closeApps);

const fakeViaManager = () => vi.spyOn(generateApi, "_generateViaManager").mockResolvedValue(Buffer.from("RIFFfake"));

test("preset_of_unloaded_engine_409s_with_engine_id", async () => {
  const { c } = await appClient();
  const r = await c.post("/v1/voices/af_heart/preview");
  expect(r.status).toBe(409);
  expect(r.text).toContain("engine_not_loaded:kokoro");
});

test("unknown_voice_404", async () => {
  const { c } = await appClient();
  const r = await c.post("/v1/voices/definitely_not_a_voice/preview");
  expect(r.status).toBe(404);
});

test("auto_load_loads_then_synthesizes", async () => {
  const { c } = await appClient();
  const loads = [];
  const mgr = manager.getManager();
  vi.spyOn(mgr, "load").mockImplementation(async (eid) => {
    loads.push(eid);
  });
  fakeViaManager();
  const r = await c.post("/v1/voices/af_heart/preview?auto_load=true");
  expect(r.status, r.text).toBe(200);
  expect(r.content.subarray(0, 4).toString("latin1")).toBe("RIFF");
  expect(loads).toEqual(["kokoro"]);
});

test("loaded_engine_skips_the_gate", async () => {
  const { c } = await appClient();
  const mgr = manager.getManager();
  vi.spyOn(mgr, "currentId").mockReturnValue("kokoro");
  vi.spyOn(mgr, "currentFor").mockReturnValue("kokoro");
  fakeViaManager();
  const r = await c.post("/v1/voices/af_heart/preview");
  expect(r.status, r.text).toBe(200);
});
