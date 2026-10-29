// SPDX-License-Identifier: MIT
// A clone's transcript is only what was typed (decided 2026-10-03, TASKS "Our copy of
// audio.cpp"): Qwen3 Base clones from the clip and its words or from the speaker vector alone, and
// refuses a clip with neither by name; an audition sends no words it wasn't given, and a saved voice
// keeps "Skip the words". A VoxCPM2 clip's words need our build 1 — on a build pinned before it the
// line is refused by name before anything loads (the port of tests/test_runtime_update.py).
//
// Moving to a newer pinned release — the old build kept working, "Update to <tag>", the old
// processes stopped and the replaced build deleted — is the kit's audio.cpp runtime's since round E
// (docs/plans/2026-10-29-round-e-onto-the-kit.md; its runtime tab and runner/runtime_service.js),
// tested there. The build pinned here is the kit's (kit_settings.js `runtimeHas`); a line runs on
// the kit's runtime (kit_speech.js `speak`), faked here.
import { afterEach, expect, test, vi } from "vitest";
import { stores } from "@delebash/core/llm";
import { pinKey } from "@delebash/core/runner/runtimes";
import { endSpeech, endState, fakeSpeechRuntime, useState } from "./engines_helpers.js";
import * as kitSettings from "../src/engines/audiocpp/kit_settings.js";
import * as kitSpeech from "../src/engines/audiocpp/kit_speech.js";
import { variantOf } from "../src/engines/audiocpp/kit_models.js";
import * as slot from "../src/engines/audiocpp/slot.js";
import { toSpeechRequest } from "../src/engines/audiocpp/slot.js";
import { discoverEngines } from "../src/engines/model_catalog.js";
import { appClient, closeApps } from "./app_helpers.js";
import { tmpPath } from "./helpers.js";
import { getState } from "../src/app_state.js";
import { voiceSynthFields } from "../src/render_core.js";
import { modelOfVariant } from "../src/voice_model.js";

afterEach(async () => {
  endSpeech();
  await closeApps();
  endState();
});

test("voxcpm2s_transcript_follows_the_pin", () => {
  // Our build 1 passes a VoxCPM2 clip's transcript on; upstream v0.9.0 ignored it.
  useState();
  const vox = variantOf("voxcpm2-q8");
  const line = { text: "Hi.", audio_prompt_path: "C:/v/ref.wav", ref_text: "What the clip says." };
  stores.getRunnerConfigStore().setSetting(pinKey("audiocpp"), "v0.9.0");
  expect(kitSettings.runtimeHas("voxcpm2_transcript")).toBe(false);
  expect(() => slot.checkLine(vox, line)).toThrow(slot.featureRefusal("voxcpm2_transcript"));
  // A clip without its words needs nothing the old build lacks.
  expect(() => slot.checkLine(vox, { ...line, ref_text: null })).not.toThrow();
  stores.getRunnerConfigStore().setSetting(pinKey("audiocpp"), "v0.9.0-jv.1");
  expect(kitSettings.runtimeHas("voxcpm2_transcript")).toBe(true);
  expect(() => slot.checkLine(vox, line)).not.toThrow();
});

// ── A clone's transcript is only what was typed (decided 2026-10-03) ─────

const qwenBaseRow = () => discoverEngines().get("qwen3").module.VARIANTS.find((r) => r.id === "qwen3-base-1.7b-q8");

test("qwen3_base_clones_with_its_transcript_or_the_speaker_vector", () => {
  const clip = { text: "Hi.", audio_prompt_path: "C:/v/ref.wav" };
  let req = toSpeechRequest(qwenBaseRow(), { ...clip, ref_text: "What the clip says." });
  expect(req.reference_text).toBe("What the clip says.");
  expect("x_vector_only_mode" in (req.options || {})).toBe(false);
  req = toSpeechRequest(qwenBaseRow(), { ...clip, ref_text: "ignored", xvector_only: true });
  expect(req.options.x_vector_only_mode).toBe(true);
  expect("reference_text" in req).toBe(false);
});

test("qwen3_base_without_either_is_refused_by_name", () => {
  expect(() => toSpeechRequest(qwenBaseRow(), { text: "Hi.", audio_prompt_path: "C:/v/ref.wav" })).toThrow(
    "Qwen3 Base needs what the clip says — type the transcript, or tick Skip the words.",
  );
});

/** The app with its candidate clips kept in a temp folder of the test's own, its speech on the
 * kit's runtime faked — every line the kit runs (`svc`) and every synth body it was given
 * (`speak`'s calls). */
async function previewClient() {
  const tmp = tmpPath();
  vi.stubEnv("TEMP", tmp);
  vi.stubEnv("TMP", tmp);
  vi.stubEnv("TMPDIR", tmp);
  const client = (await appClient()).c;
  const svc = fakeSpeechRuntime();
  return { client, svc, speak: vi.spyOn(kitSpeech, "speak") };
}

test("a_cloned_audition_needs_no_transcript_and_sends_none", async () => {
  // The preview API no longer requires a transcript, so the Voices screen stops sending a
  // placeholder; without one, no ref_text reaches the engine and the saved voice has none.
  const { client, svc, speak } = await previewClient();
  const r = await client.post("/v1/voices/preview", {
    json: {
      engine: "chatterbox",
      source: "cloned",
      language: "en-US",
      ref_wav_b64: Buffer.from("RIFF....WAVE").toString("base64"),
      preview_text: "Hello there.",
    },
  });
  expect(r.status, r.text).toBe(200);
  expect(speak).toHaveBeenCalled();
  const sent = speak.mock.calls[0][2];
  expect("ref_text" in sent).toBe(false);
  expect(sent.audio_prompt_path).toBeTruthy();
  expect(svc.server.calls[0][1].voice_ref).toBeTruthy();
  const saved = await client.post(`/v1/voices/preview/${r.json().preview_id}/save`, { json: { name: "No words" } });
  expect([200, 201], saved.text).toContain(saved.status);
  const stored = getState().voices.get(saved.json().voice_id);
  expect(stored).not.toBeNull();
  expect(stored.transcript).toBeNull();
});

test("a_saved_voice_keeps_skip_the_words", async () => {
  // The x-vector choice is stored on the voice — from a direct clone and from a saved audition
  // — so its renders take the mode its audition did (decided 2026-10-03).
  const { client, svc } = await previewClient();
  const clip = Buffer.from("RIFF....WAVE").toString("base64");
  let r = await client.post("/v1/voices/clone", { json: { engine: "qwen3", name: "Fingerprint", ref_wav_b64: clip, xvector_only: true } });
  expect(r.status, r.text).toBe(201);
  const state = getState();
  const fields = voiceSynthFields(state, state.voices.get(r.json().id));
  expect(fields.xvector_only).toBe(true);
  expect("ref_text" in fields).toBe(false);

  r = await client.post("/v1/voices/preview", {
    json: { engine: "qwen3", source: "cloned", ref_wav_b64: clip, preview_text: "Hello.", xvector_only: true },
  });
  expect(r.status, r.text).toBe(200);
  // A clone is heard on Qwen3 Base (2026-10-03: the voice's model, not just its engine), from the
  // speaker vector alone.
  expect(svc.lines.map((l) => modelOfVariant(l.modelId))).toEqual(["qwen3-base"]);
  const req = svc.server.calls[0][1];
  expect(req.options?.x_vector_only_mode).toBe(true);
  expect("reference_text" in req).toBe(false);
  const saved = await client.post(`/v1/voices/preview/${r.json().preview_id}/save`, { json: { name: "Audition" } });
  expect([200, 201], saved.text).toContain(saved.status);
  expect(state.voices.get(saved.json().voice_id).xvector_only).toBe(true);
});
