// SPDX-License-Identifier: MIT
// The blend audition's stream ticket (POST /v1/voices/preview/stream-ticket, then GET
// /v1/voices/{ticket}/preview/stream). Two Python bugs copied into the port on purpose (TASKS "The
// family moves to Electron…", the API wave's agent 2), fixed 2026-11-05 as decided 2026-10-08:
//   - a blend ticket with no voices or no weights was a 500, not the 400 POST /v1/voices/preview
//     answers;
//   - a ticket's stream filled the audition cache under a key no lookup reads.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as generateApi from "../src/api/generate_api.js";
import * as voicePreviewApi from "../src/api/voice_preview_api.js";
import * as dspClient from "../src/audio/dsp_client.js";
import { writeWavContainer } from "../src/audio/wav.js";
import { appClient, closeApps } from "./app_helpers.js";
import { endSpeech, fakeSpeechRuntime } from "./engines_helpers.js";

beforeEach(() => voicePreviewApi._resetAuditionCache());
afterEach(async () => {
  voicePreviewApi.cfg._STREAM_TICKETS.clear();
  endSpeech();
  await closeApps();
});

test("a_blend_ticket_missing_its_voices_or_weights_is_refused_in_words", async () => {
  const { c } = await appClient();
  const ticket = (json) => c.post("/v1/voices/preview/stream-ticket", { json: { engine: "kokoro", source: "blended", ...json } });
  let r = await ticket({});
  expect(r.status, r.text).toBe(400);
  expect(r.json().detail).toContain("source_voice_ids");
  r = await ticket({ source_voice_ids: ["af_heart", "af_bella"] });
  expect(r.status, r.text).toBe(400);
  expect(r.json().detail).toContain("weights");
  r = await ticket({ strategy: "recombine" });
  expect(r.status, r.text).toBe(400);
  expect(r.json().detail).toContain("segments");
});

test("a_tickets_stream_leaves_nothing_in_the_audition_cache", async () => {
  const { c } = await appClient();
  fakeSpeechRuntime({ loaded: [{ modelId: "kokoro-82m-q8" }] });
  const wav = writeWavContainer(Buffer.alloc(4800), 24000, 1);
  vi.spyOn(generateApi, "_generateViaManager").mockResolvedValue(wav);
  vi.spyOn(dspClient, "streamJoin").mockImplementation(async (piece) => [Buffer.from(piece).subarray(44), null]);
  voicePreviewApi.cfg._STREAM_TICKETS.set("tkt_test", {
    engine_id: "kokoro",
    voice_fields: { voice_vector: [0.1], voice_language: "en-us" },
    language: "en-us",
  });
  const r = await c.get("/v1/voices/tkt_test/preview/stream?auto_load=true&text=A%20short%20line.");
  expect(r.status, r.text).toBe(200);
  expect(r.content.length).toBeGreaterThan(44);
  expect(voicePreviewApi.cfg._AUDITION_CACHE.size).toBe(0);
});
