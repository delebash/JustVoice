// SPDX-License-Identifier: MIT
// POST /v1/voices/{id}/preview — row audition with ask-before-load (the port of
// tests/test_voice_row_preview.py).
//
// Exercises the real app against a temp data dir: the managed kokoro manifest is present
// (static voices resolve) but its model isn't held by the kit's speech runtime (faked —
// engines_helpers' fakeSpeechRuntime, installed), so the endpoint must 409 with the engine id
// instead of 404/405 — the bug this endpoint replaced. With auto_load the line itself loads the
// voice's model (round E: the kit loads it inside the line — kit_speech.js `speak`), so the happy
// path runs the real Generate door onto the fake runtime. These tests are about the LOADED gate
// behind the install gate.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as generateApi from "../src/api/generate_api.js";
import * as voicePreviewApi from "../src/api/voice_preview_api.js";
import { appClient, closeApps } from "./app_helpers.js";
import { endSpeech, fakeSpeechRuntime } from "./engines_helpers.js";

beforeEach(() => voicePreviewApi._resetAuditionCache());
afterEach(async () => {
  endSpeech();
  await closeApps();
});

const fakeViaManager = () => vi.spyOn(generateApi, "_generateViaManager").mockResolvedValue(Buffer.from("RIFFfake"));

test("preset_of_unloaded_engine_409s_with_engine_id", async () => {
  const { c } = await appClient();
  fakeSpeechRuntime();
  const r = await c.post("/v1/voices/af_heart/preview");
  expect(r.status).toBe(409);
  expect(r.text).toContain("engine_not_loaded:kokoro");
});

test("unknown_voice_404", async () => {
  const { c } = await appClient();
  fakeSpeechRuntime();
  const r = await c.post("/v1/voices/definitely_not_a_voice/preview");
  expect(r.status).toBe(404);
});

test("auto_load_loads_then_synthesizes", async () => {
  // The line asks the kit for Kokoro's version (the default, nothing of it downloaded) — the kit
  // loads it there — and speaks on it.
  const { c } = await appClient();
  const svc = fakeSpeechRuntime();
  const r = await c.post("/v1/voices/af_heart/preview?auto_load=true");
  expect(r.status, r.text).toBe(200);
  expect(r.content.subarray(0, 4).toString("latin1")).toBe("RIFF");
  expect(svc.lines.map((l) => l.modelId)).toEqual(["kokoro-82m-q8"]);
  expect(svc.server.calls.map(([method]) => method)).toEqual(["speech"]);
});

test("loaded_engine_skips_the_gate", async () => {
  const { c } = await appClient();
  fakeSpeechRuntime({ loaded: [{ modelId: "kokoro-82m-q8" }] });
  fakeViaManager();
  const r = await c.post("/v1/voices/af_heart/preview");
  expect(r.status, r.text).toBe(200);
});
