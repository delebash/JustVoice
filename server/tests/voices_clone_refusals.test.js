// SPDX-License-Identifier: MIT
// What a new voice is refused before anything is stored. Two Python bugs copied into the port on
// purpose (TASKS "The family moves to Electron…", the API wave's agent 2), fixed 2026-11-05 as
// decided 2026-10-08:
//   - a clone (or design) on an engine none of whose models can make one stored a voice with the
//     engine id as its model;
//   - a clip that isn't base64 ("%%%") decoded leniently to nothing and was stored as an empty clip.
import { afterEach, expect, test, vi } from "vitest";
import * as voicePreviewApi from "../src/api/voice_preview_api.js";
import { getState } from "../src/app_state.js";
import { writeWavContainer } from "../src/audio/wav.js";
import { appClient, closeApps } from "./app_helpers.js";

afterEach(closeApps);

const clip = () => writeWavContainer(Buffer.alloc(24000 * 2 * 6), 24000, 1).toString("base64");
const stored = () => getState().voices.list().length;

test("an_engine_with_no_model_that_can_clone_is_refused_by_name", async () => {
  const { c } = await appClient();
  let r = await c.post("/v1/voices/clone", { json: { engine: "kokoro", name: "Marius", ref_wav_b64: clip() } });
  expect(r.status, r.text).toBe(400);
  expect(r.json().detail).toBe("Kokoro has no model that can clone a voice");
  r = await c.post("/v1/voices/design", { json: { engine: "kokoro", name: "Wren", prompt: "a bright young voice" } });
  expect(r.status, r.text).toBe(400);
  expect(r.json().detail).toBe("Kokoro has no model that can design a voice");
  expect(stored()).toBe(0);
  // An engine whose catalog has one still picks it (Qwen3: Base clones, CustomVoice doesn't).
  r = await c.post("/v1/voices/clone", { json: { engine: "qwen3", name: "Mara", transcript: "Hello.", ref_wav_b64: clip() } });
  expect(r.status, r.text).toBe(201);
  expect(r.json().model).toBe("qwen3-base");
});

test("a_clip_that_is_not_base64_or_holds_nothing_is_refused_and_nothing_is_stored", async () => {
  const { c } = await appClient();
  const body = { engine: "chatterbox", model: "chatterbox-multilingual", name: "Marius", language: "en" };
  for (const bad of ["%%%", "QUJD!!RA==", ""]) {
    const r = await c.post("/v1/voices/clone", { json: { ...body, ref_wav_b64: bad } });
    expect(r.status, `${JSON.stringify(bad)}: ${r.text}`).toBe(400);
  }
  expect(stored()).toBe(0);
  // A clone preview refuses it before any model is asked to speak.
  const synth = vi.spyOn(voicePreviewApi, "synthCandidate").mockResolvedValue([Buffer.alloc(0), 24000, 1]);
  const r = await c.post("/v1/voices/preview", { json: { ...body, source: "cloned", ref_wav_b64: "%%%" } });
  expect(r.status, r.text).toBe(400);
  expect(r.json().detail).toContain("invalid base64");
  expect(synth).not.toHaveBeenCalled();
  // A good clip is still kept.
  const ok = await c.post("/v1/voices/clone", { json: { ...body, ref_wav_b64: clip() } });
  expect(ok.status, ok.text).toBe(201);
});

test("a_clip_in_wrapped_base64_is_read", async () => {
  // MIME base64 (RFC 2045) wraps its lines — Python's base64.encodebytes, `base64` on the command
  // line. The strict check refuses junk ("%%%"), not the line breaks: whitespace is taken out first.
  const { clipBytes } = await import("../src/api/voices_api.js");
  const raw = Buffer.from("RIFF0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghij");
  const wrapped = raw.toString("base64").replace(/(.{20})/g, "$1\n");
  expect(wrapped).toContain("\n");
  expect(clipBytes(wrapped).equals(raw)).toBe(true);
  expect(() => clipBytes("%%%")).toThrow();
});
