// SPDX-License-Identifier: MIT
// Our speech, transcription and alignment on the kit's audio.cpp runtime (round E, docs/plans/
// 2026-10-29-round-e-onto-the-kit.md §4 steps 2–3 — engines/audiocpp/kit_speech.js): a line names its
// model version and the kit runs it, the request shaped for its family; what the line needs, its
// terms and its blend are refused before anything loads; the kit's refusals and audio.cpp's answers
// as our errors, a failure before the line started as a failed load; a transcription on the
// Transcription feature's preset, its words without the model's markup; the aligner on Qwen3-ASR;
// what each kind holds and what is downloaded, from the kit.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { stores } from "@delebash/core/llm";
import { runtimeProblem } from "@delebash/core/llm/runtimes_api";
import { ApiError } from "@delebash/core/platform/errors";
import { AudioCppError } from "@delebash/core/runner/audiocpp";
import { endSpeech, endState, fakeServer, fakeSpeechRuntime, useState, wav } from "./engines_helpers.js";
import * as kitSettings from "../src/engines/audiocpp/kit_settings.js";
import * as kitSpeech from "../src/engines/audiocpp/kit_speech.js";
import * as slot from "../src/engines/audiocpp/slot.js";
import { TermsRequired } from "../src/engines/model_catalog.js";
import { TRANSCRIPTION_FEATURE } from "../src/feature_catalog.js";
import { DEFAULT_ENGINE_PRESETS, DEFAULT_FEATURE_PRESETS } from "../src/seed_presets.js";
import { tmpPath } from "./helpers.js";

afterEach(() => {
  endSpeech();
  endState();
});

test("a_line_runs_on_the_version_it_names_its_request_shaped_for_the_family", async () => {
  useState();
  const svc = fakeSpeechRuntime();
  const out = await kitSpeech.speak("kokoro", "kokoro-82m-q8", { voice_id: "af_heart", text: "Hello.", seed: 7 });
  // no placement and no load options of ours: the kit reads the user's saved ones
  expect(svc.lines).toEqual([{ modelId: "kokoro-82m-q8", placement: undefined, sessionOptions: undefined, needs: [] }]);
  expect(svc.server.calls).toEqual([["speech", { model: "kokoro-82m-q8", input: "Hello.", seed: 7, voice: "af_heart", language: "en-us" }]]);
  expect(out[1]).toEqual({ media_type: "audio/wav", sample_rate: 24000, channels: 1, is_wav_container: true });
  // the kit holds it now
  expect(kitSpeech.loadedFor("tts")).toEqual({ engineId: "kokoro", versionId: "kokoro-82m-q8", placement: "gpu", reason: "" });
  expect([kitSpeech.currentFor("tts"), kitSpeech.currentVariantId("kokoro"), kitSpeech.engineStatus("kokoro")]).toEqual(["kokoro", "kokoro-82m-q8", "loaded"]);
  expect([kitSpeech.currentFor("stt"), kitSpeech.engineStatus("qwen3")]).toEqual([null, "installed"]);
});

test("what_a_line_cant_have_is_refused_before_anything_loads", async () => {
  useState();
  const svc = fakeSpeechRuntime();
  // a blend on a model with none
  await expect(kitSpeech.speak("qwen3", "qwen3-cv-1.7b-q8", { voice_id: "Ryan", text: "Hi.", voice_vector: [0.1] })).rejects.toMatchObject({ status: 422 });
  // a build feature the build pinned here lacks — the update offered when the build we ship has it
  vi.spyOn(kitSettings, "runtimeHas").mockReturnValue(false);
  const e = await kitSpeech.speak("chatterbox", "chatterbox-turbo-q8", { text: "Hi.", audio_prompt_path: "a.wav" }).catch((x) => x);
  expect(e).toBeInstanceOf(kitSpeech.EngineRequestError);
  expect(e.status).toBe(409);
  expect(e.message).toBe(`engine synth failed: ${slot.featureRefusal("turbo_clone")}`);
  vi.mocked(kitSettings.runtimeHas).mockRestore();
  // a clone on an engine whose terms gate cloning, until they are accepted
  const t = await kitSpeech.speak("pocket", "pocket-en-q8", { text: "Hi.", audio_prompt_path: "a.wav" }).catch((x) => x);
  expect(t).toBeInstanceOf(TermsRequired);
  expect(t.apiError()).toMatchObject({ statusCode: 403, slug: "terms-required", extra: { engine: "pocket" } });
  expect(svc.lines).toEqual([]);
});

test("the_kits_refusals_are_the_kits_problems_and_audiocpps_answers_ours", () => {
  const e = (fields, msg = "no") => Object.assign(new Error(msg), fields);
  // every refusal as the kit's routes answer it (llm/runtimes_api.js runtimeProblem — one mapping)
  const memory = Object.assign(new Error("needs 6 GB"), { name: "NotEnoughMemoryError", where: "card", neededMb: 6000, freeMb: 2000 });
  for (const refusal of [
    memory,
    e({ loadCancelled: { modelId: "m" } }),
    e({ diskFull: { needBytes: 2, freeBytes: 1 } }),
    e({ busy: "model-busy" }),
    e({ need: { reason: "update-engine", detail: "update it" } }),
    e({ notFound: true }),
    e({ nothingToInstall: true }),
  ]) {
    const kit = runtimeProblem(refusal);
    expect(kitSpeech.engineError(refusal).apiError()).toMatchObject({ statusCode: kit.statusCode, slug: kit.slug, extra: kit.extra });
  }
  expect(kitSpeech.engineError(memory).apiError()).toMatchObject({ statusCode: 409, slug: "not-enough-memory", extra: { where: "card", neededMb: 6000, freeMb: 2000 } });
  // what the kit leaves as it is stays as it is (a runtime not installed: a line says it failed to load)
  const notInstalled = e({ notInstalled: true }, "audio.cpp isn't installed");
  expect(kitSpeech.engineError(notInstalled)).toBe(notInstalled);
  // the licence a download waits for: the engine named, as our routes always said it
  const terms = kitSpeech.engineError(e({ termsRequired: { modelId: "index_tts2-indextts2-q8" } }, "Accept its licence"));
  expect(terms).toBeInstanceOf(TermsRequired);
  expect(terms.engineId).toBe("index_tts2");
  // audio.cpp's status survives; a kit problem stays the kit's
  expect(kitSpeech.engineError(new AudioCppError("out of memory", 503)).apiError()).toMatchObject({ statusCode: 503 });
  const problem = new ApiError(409, "no-stt-model", "No stt model is set for this feature", "choose one");
  expect(kitSpeech.engineError(problem).apiError()).toBe(problem);
  const other = new Error("something else");
  expect(kitSpeech.engineError(other)).toBe(other);
});

test("a_failure_before_the_line_started_is_a_failed_load_and_after_it_audiocpps_words", async () => {
  useState();
  const svc = fakeSpeechRuntime();
  svc.useModel = async () => {
    throw new AudioCppError("the speech runtime stopped answering", 503);
  };
  const failed = await kitSpeech.speak("kokoro", "kokoro-82m-q8", { text: "Hi." }).catch((x) => x);
  expect(failed).toBeInstanceOf(kitSpeech.LoadFailed);
  expect(failed.versionId).toBe("kokoro-82m-q8");
  // a refusal before the line is said as the refusal, never as a failed load
  svc.useModel = async () => {
    throw Object.assign(new Error("needs more"), { name: "NotEnoughMemoryError", where: "card" });
  };
  expect((await kitSpeech.speak("kokoro", "kokoro-82m-q8", { text: "Hi." }).catch((x) => x)).problem).toMatchObject({ slug: "not-enough-memory" });
  // audio.cpp refusing the line itself
  const server = fakeServer();
  server.speech = async () => {
    throw new AudioCppError("unknown voice", 400);
  };
  fakeSpeechRuntime({ server });
  const refused = await kitSpeech.speak("kokoro", "kokoro-82m-q8", { voice_id: "af_heart", text: "Hi." }).catch((x) => x);
  expect([refused.status, refused.message]).toEqual([400, "engine synth failed: unknown voice"]);
});

/** The Transcription feature on its seeded stt preset (seed_presets.js), its provider the kit's. */
function transcriptionPreset(model = "qwen3-asr-1.7b-q8", placement = "auto") {
  const preset = DEFAULT_ENGINE_PRESETS.find((p) => p.id === "p_transcription");
  if (!stores.getProviderStore().get(preset.provider_id)) stores.getProviderStore().add({ id: preset.provider_id, name: "Built-in — audio.cpp (stt)", kind: "stt", providerType: "local-audiocpp", local: true });
  stores.getEnginePresetStore().save({ id: preset.id, name: preset.name, providerId: preset.provider_id, model, kind: preset.kind, params: { placement } });
  stores.getFeaturePresetRefStore().set(TRANSCRIPTION_FEATURE, DEFAULT_FEATURE_PRESETS[TRANSCRIPTION_FEATURE]);
}

test("a_transcription_runs_on_the_presets_model_its_words_without_the_models_markup", async () => {
  useState();
  transcriptionPreset();
  const server = fakeServer({ text: "  hello there  " });
  const svc = fakeSpeechRuntime({ server });
  const clip = path.join(tmpPath("jv-kit-stt-"), "clip.wav");
  writeFileSync(clip, wav(2, 16000));
  expect(await kitSpeech.transcribe({ audio_path: clip, language: "de" })).toBe("hello there");
  // the preset's "auto" leaves where it runs to the user's saved choice
  expect(svc.lines).toEqual([{ modelId: "qwen3-asr-1.7b-q8", placement: undefined, sessionOptions: undefined, needs: [] }]);
  // the request as our hook shapes it — the language named its way, the runtime's limit
  expect(server.calls).toEqual([["transcribe", { model: "qwen3-asr-1.7b-q8", audio: clip.replaceAll("\\", "/"), language: "German" }, 900]]);
  // a preset that pins the CPU runs it there
  transcriptionPreset("qwen3-asr-1.7b-q8", "cpu");
  await kitSpeech.transcribe({ audio_path: clip, language: null });
  expect(svc.lines.at(-1).placement).toBe("cpu");
  // a recogniser's refusal, in its own words, as the problem it answers
  server.transcribe = async () => {
    throw new AudioCppError("this checkpoint transcribes ja, not en", 400);
  };
  await expect(kitSpeech.transcribe({ audio_path: clip, language: "en" })).rejects.toMatchObject({ statusCode: 400, detail: "engine transcribe failed: this checkpoint transcribes ja, not en" });
});

test("no_transcription_preset_is_the_kits_problem", async () => {
  useState();
  fakeSpeechRuntime();
  await expect(kitSpeech.transcribe({ audio_path: "x.wav" })).rejects.toMatchObject({ statusCode: 409, slug: "no-stt-model" });
});

test("the_aligner_times_words_on_qwen3_asr_at_its_own_rate", async () => {
  useState();
  const server = fakeServer({ words: [{ word: "Hello", start: 0.1, end: 0.4 }] });
  const svc = fakeSpeechRuntime({ server });
  vi.spyOn(kitSpeech, "transcriptionModel").mockReturnValue("qwen3-asr-0.6b-q8");
  const clip = wav(1, 16000);
  expect(await kitSpeech.align(clip, "Hello", "de-DE")).toEqual([{ word: "Hello", start: 0.1, end: 0.4 }]);
  expect(svc.lines).toEqual([{ modelId: "qwen3-asr-0.6b-q8", placement: undefined, sessionOptions: undefined, needs: ["aligner"] }]);
  expect(server.calls).toEqual([["align", "qwen3-asr-0.6b-q8::aligner", clip, "Hello", "German"]]);
  // a recogniser without an aligner: Qwen3-ASR's default times the words
  vi.mocked(kitSpeech.transcriptionModel).mockReturnValue("parakeet_tdt-parakeet-tdt-0.6b-v3-q8");
  expect(kitSpeech.alignerModel()).toMatch(/^qwen3-asr-/);
  // a language it doesn't know: English
  await kitSpeech.align(clip, "Hello", "xx");
  expect(server.calls.at(-1)[4]).toBe("English");
});

test("files_and_addons_are_the_kits", () => {
  fakeSpeechRuntime({ onDisk: ["kokoro-82m-q8"], files: { "kokoro-82m-q8": { model: "C:/m/kokoro.gguf" } }, addons: ["unidic"] });
  expect(kitSpeech.modelFiles("kokoro-82m-q8")).toEqual({ model: "C:/m/kokoro.gguf" });
  expect([kitSpeech.onDisk("kokoro-82m-q8"), kitSpeech.onDisk("kokoro-82m-bf16")]).toEqual([true, false]);
  expect(kitSpeech.addonInstalled("unidic")).toBe(true);
  endSpeech();
  // no runtime (a script, a bare test): nothing is here, nothing is installed
  expect([kitSpeech.onDisk("kokoro-82m-q8"), kitSpeech.installed(), kitSpeech.loadedFor("tts")]).toEqual([false, false, null]);
});
