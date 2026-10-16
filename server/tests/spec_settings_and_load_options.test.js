// SPDX-License-Identifier: MIT
// Settings and load options from audio.cpp's spec — the adoption plan's slice 3
// (docs/plans/2026-10-13-adopt-everything-audiocpp.md §3: E2, E4, F9, F3; §7 question 3): a
// number with no range is a number box; ranges are audio.cpp's (its control list's, else the
// spec's); a file on the server's disk is never a setting; every load option the spec lists is
// on the model's row at audio.cpp's default, Qwen3's decoder 16-bit by default; Chatterbox
// Multilingual's v3 checkpoint is one of them; a model's memory price is kept per load-option set.
import * as stores from "@delebash/llm-runner/llm/stores";
import * as hardware from "@delebash/llm-runner/runner/hardware";
import { afterEach, expect, test, vi } from "vitest";
import "./engines_helpers.js";
import * as generated from "../src/engines/audiocpp/generated.js";
import * as runtimeOptions from "../src/engines/audiocpp/runtime_options.js";
import * as slot from "../src/engines/audiocpp/slot.js";
import { lookup } from "../src/engines/capability_details.js";
import * as manager from "../src/engines/manager.js";
import { discoverEngines, EngineManager } from "../src/engines/manager.js";
import { checkDelivery } from "../src/persona_render.js";
import { tmpPath } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());

const knob = (model, key) => lookup(model).knobs.find((k) => k.key === key);
const row = (engine, variant) => discoverEngines().get(engine).module.VARIANTS.find((r) => r.id === variant);
const option = (r, key) => runtimeOptions.offeredFor(r).find((o) => o.key === key);
const MULTILINGUAL = ["chatterbox", "chatterbox-multilingual-v2-q8"];

// ─── Settings (E2, F9) ─────────────────────────────────────────────────────

test("a number audio.cpp gives no top is a number box, open at that end", () => {
  // CosyVoice3's steps: its control list's number box from 1, the spec's default (E2).
  expect(knob("cosyvoice3", "num_inference_steps")).toMatchObject({ type: "number", box: true, min: 1, max: null, default: 10 });
  // Audio8's top k: the control list's 0 beats the spec's 1, and the request sends what was set.
  expect(knob("audio8_tts", "top_k")).toMatchObject({ box: true, min: 0, max: null });
  const req = slot.toSpeechRequest(generated.generatedEngines().get("audio8_tts").VARIANTS[0], {
    text: "Hi.",
    audio_prompt_path: "/v/ref.wav",
    delivery: { engine: { top_k: 0 } },
  });
  expect(req.options.top_k).toBe(0);
});

test("a number's ends are audio.cpp's control list's where it gives one, else the spec's", () => {
  // Echo TTS's steps: the control list's 8–40 slider (the spec says only "from 1").
  expect(knob("echo_tts", "num_inference_steps")).toMatchObject({ box: false, min: 8, max: 40 });
  // Breeze's guidance: the spec's 0, the control list's 10.
  expect(knob("breeze_tts", "guidance_scale")).toMatchObject({ box: false, min: 0, max: 10 });
  // MioTTS's best of N: a number box in audio.cpp's own UI though it has both ends.
  expect(knob("miotts", "best_of_n")).toMatchObject({ box: true, min: 1, max: 8 });
});

test("a file on the server's disk is never a setting, even one saved before", () => {
  expect(generated.isSetting("glm_tts", "flow_noise_file")).toBe(false);
  expect(generated.isSetting("dots_tts", "source_audio")).toBe(false);
  expect(lookup("glm_tts").knobs.some((k) => k.key === "flow_noise_file")).toBe(false);
  const req = slot.toSpeechRequest(generated.generatedEngines().get("glm_tts").VARIANTS[0], {
    text: "Hi.",
    audio_prompt_path: "/v/ref.wav",
    delivery: { engine: { flow_noise_file: "C:/elsewhere/noise.bin" } },
  });
  expect(req.options?.flow_noise_file).toBeUndefined();
});

test("the seven engines' knobs narrower than audio.cpp's take its ranges (F9)", () => {
  expect(knob("chatterbox-multilingual", "exaggeration")).toMatchObject({ min: 0, max: 2 });
  expect(knob("voxcpm2", "cfg_value")).toMatchObject({ min: 0, max: 5 });
  expect(knob("voxcpm2", "inference_timesteps")).toMatchObject({ box: true, min: 1, max: null });
  for (const key of ["talker_top_k", "subtalker_top_k"]) expect(knob("qwen3-cv", key)).toMatchObject({ box: true, min: 0, max: null });
  expect(knob("chatterbox-turbo", "top_k")).toMatchObject({ box: true, min: 0, max: null });
  // Each still reaches the runtime under audio.cpp's name.
  const req = slot.toSpeechRequest(row("voxcpm2", "voxcpm2-q8"), {
    text: "Hi.",
    audio_prompt_path: "/v/ref.wav",
    delivery: { engine: { cfg_value: 0.5, inference_timesteps: 64 } },
  });
  expect(req.options).toMatchObject({ guidance_scale: 0.5, num_inference_steps: 64 });
});

test("a persona's settings: a number box checks only the ends it has; a word or a switch is never read as a number", () => {
  expect(checkDelivery({ models: { "qwen3-cv": { knobs: { talker_top_k: 5000 } } } })).toEqual([]);
  expect(checkDelivery({ models: { "qwen3-cv": { knobs: { talker_top_k: -1 } } } })).toEqual([
    "Qwen3-TTS CustomVoice's Top k is at least 0; -1 is outside it",
  ]);
  // A choice and a switch were refused as numbers ("runs 0–0; nan is outside it").
  const model = "dots_tts-dotsttssoar";
  const choice = lookup(model).knobs.find((k) => k.type === "choice");
  expect(checkDelivery({ models: { [model]: { knobs: { [choice.key]: choice.choices[0] } } } })).toEqual([]);
  const index = "index_tts2-indextts25";
  expect(checkDelivery({ models: { [index]: { knobs: { use_random_emotion: true } } } })).toEqual([]);
});

// ─── Load options (E4, F3) ─────────────────────────────────────────────────

test("every load option the spec lists is on the model's row, at audio.cpp's default", () => {
  const r = row(...MULTILINGUAL);
  const keys = runtimeOptions.offeredFor(r).map((o) => o.key);
  // Chatterbox's spec, in order (model_specs/chatterbox.json `options.session`).
  expect(keys).toEqual([
    "chatterbox.weight_type",
    "chatterbox.t3_weight_type",
    "chatterbox.multilingual_t3",
    "chatterbox.conditionals_cache_slots",
    "chatterbox.mem_saver",
    "chatterbox.encoder_condition_samples",
    "chatterbox.decoder_condition_samples",
    "chatterbox.t3_speech_cond_prompt_len",
  ]);
  const described = Object.fromEntries(runtimeOptions.describe("chatterbox", r).map((o) => [o.key, o]));
  expect(described["chatterbox.mem_saver"]).toMatchObject({ type: "switch", default: "false", value: "false", featured: false });
  expect(described["chatterbox.conditionals_cache_slots"]).toMatchObject({ type: "number", integer: true, min: 0, max: null, default: "1" });
  // No default in the spec: none here — audio.cpp decides, and nothing is sent.
  expect(described["chatterbox.weight_type"]).toMatchObject({ type: "choice", default: null, value: null });
  expect(runtimeOptions.sessionOptionsFor("chatterbox", r)).toEqual({});
});

test("Chatterbox Multilingual's v3 checkpoint is its load option; set, it reaches the model's registration", () => {
  const r = row(...MULTILINGUAL);
  expect(option(r, "chatterbox.multilingual_t3")).toMatchObject({
    type: "choice",
    choices: [
      ["v2", "v2"],
      ["v3", "v3"],
    ],
    default: "v2",
  });
  // Turbo and Nano are another family: no such option.
  expect(option(row("chatterbox", "chatterbox-turbo-q8"), "chatterbox.multilingual_t3")).toBeUndefined();
  vi.spyOn(runtimeOptions, "savedFor").mockReturnValue({ "chatterbox.multilingual_t3": "v3" });
  vi.spyOn(slot, "_dataDir").mockReturnValue(tmpPath());
  const entry = slot._entriesFor(discoverEngines().get("chatterbox"), r)[0];
  expect(Object.fromEntries(entry.sessionOptions)).toEqual({ "chatterbox.multilingual_t3": "v3" });
  // v3 speaks the 23 languages audio.cpp lists for the family, as v2 does.
  expect(r.languages).toEqual(generated.catalogFamily("chatterbox").languages);
});

test("Qwen3's decoder stays 16-bit by default; its two measured options stay on the row", () => {
  const r = row("qwen3", "qwen3-cv-1.7b-q8");
  const shown = runtimeOptions.describe("qwen3", r);
  expect(shown.filter((o) => o.featured).map((o) => [o.key, o.label, o.value])).toEqual([
    ["qwen3_tts.perf_mode", "Attention", "off"],
    ["qwen3_tts.conv_weight_type", "Decoder weights", "f16"],
  ]);
  expect(shown.find((o) => o.key === "qwen3_tts.conv_weight_type").choices).toContainEqual({ value: "f16", label: "16-bit" });
  expect(runtimeOptions.sessionOptionsFor("qwen3", r)).toEqual({ "qwen3_tts.conv_weight_type": "f16" });
  // The rest are folded, every one typed by its spec.
  expect(shown.find((o) => o.key === "qwen3_tts.talker_graph_arena_mb")).toMatchObject({ type: "number", min: 1, default: "32", featured: false });
  expect(shown.find((o) => o.key === "qwen3_tts.exec_plan")).toMatchObject({ type: "text", default: "{}" });
});

test("a file the app gives, or an option it sets for the row, is never a load option", () => {
  // eSpeak NG's paths (Kitten), MioTTS's codec (its family file's SESSION_FILES), the recogniser's
  // aligner and VAD files.
  const keys = (r) => runtimeOptions.offeredFor(r).map((o) => o.key);
  expect(keys(row("kitten", "kitten-mini-0.8")).some((k) => k.includes("espeak"))).toBe(false);
  const mio = generated.generatedEngines().get("miotts").VARIANTS[0];
  expect(keys(mio)).not.toContain("miotts.codec_model_path");
  expect(keys(mio)).not.toContain("miotts.best_of_n_asr_model_path");
  expect(keys(mio)).toContain("miotts.best_of_n_enabled");
  expect(keys(row("asr", "qwen3-asr-1.7b-q8")).some((k) => k.endsWith("_path"))).toBe(false);
});

test("load options are checked by their type; at the default nothing is saved", () => {
  const r = row(...MULTILINGUAL);
  expect(
    runtimeOptions.validate(r, {
      "chatterbox.mem_saver": "on",
      "chatterbox.conditionals_cache_slots": "2.6",
      "chatterbox.multilingual_t3": "v2",
      "chatterbox.t3_speech_cond_prompt_len": "",
    }),
  ).toEqual({ "chatterbox.mem_saver": "true", "chatterbox.conditionals_cache_slots": "3" });
  // A whole number's spec end is kept: −4 becomes 0.
  expect(runtimeOptions.validate(r, { "chatterbox.conditionals_cache_slots": "-4" })).toEqual({ "chatterbox.conditionals_cache_slots": "0" });
  expect(() => runtimeOptions.validate(r, { "chatterbox.conditionals_cache_slots": "many" })).toThrow(/must be a number/);
  expect(() => runtimeOptions.validate(r, { "chatterbox.mem_saver": "maybe" })).toThrow(/must be one of true, false/);
  expect(() => runtimeOptions.validate(r, { "chatterbox.multilingual_t3": "v4" })).toThrow(/must be one of v2, v3/);
});

test("a generated model's row offers its spec's load options too", () => {
  const cosy = generated.generatedEngines().get("cosyvoice3").VARIANTS[0];
  const keys = runtimeOptions.offeredFor(cosy).map((o) => o.key);
  expect(keys.length).toBeGreaterThan(0);
  expect(keys.every((k) => k.startsWith("cosyvoice3."))).toBe(true);
});

// ─── The price per load-option set (§7 question 3) ─────────────────────────

test("a model's memory price is kept per load-option set; the default set's rows from before still count", () => {
  const mgr = new EngineManager();
  const [engine, variant] = MULTILINGUAL;
  const split = String(mgr.effectiveSplit(engine, variant));
  const peak = (mb, extra = []) => ({
    modelId: `tts:${engine}:${variant}`,
    machineKey: "box",
    source: "peak",
    backend: "cuda",
    vramModelMb: mb,
    switches: [{ flagName: "split_chars", flagValue: split }, { flagName: "runtime", flagValue: "jv.6" }, ...extra],
  });
  const rows = [peak(3000), peak(3600, [{ flagName: "load_options", flagValue: "chatterbox.multilingual_t3=v3" }])];
  const recorded = [];
  vi.spyOn(stores, "getModelMeasurementStore").mockReturnValue({
    list: (mid) => rows.filter((r) => r.modelId === mid),
    record: (mid, r) => recorded.push(r),
    pruneLoadRows: () => 0,
  });
  vi.spyOn(hardware, "currentMachineKey").mockReturnValue("box");
  vi.spyOn(manager, "_runtimeBuild").mockReturnValue("jv.6");
  // The default set: the row measured before the key existed.
  expect(mgr.loadOptionsKey(engine, variant)).toBe("");
  expect(mgr._priceMb("tts", engine, variant, "cuda")).toBe(3000);
  mgr._recordSpeechLoad(mgr.getManifest(engine), "tts", variant, 3100, "cuda");
  expect(recorded[0].rows.some((f) => f.flagName === "load_options")).toBe(false);
  // v3 chosen: its own price, and its rows say so.
  vi.spyOn(runtimeOptions, "savedFor").mockReturnValue({ "chatterbox.multilingual_t3": "v3" });
  expect(mgr.loadOptionsKey(engine, variant)).toBe("chatterbox.multilingual_t3=v3");
  expect(mgr._priceMb("tts", engine, variant, "cuda")).toBe(3600);
  mgr._recordSpeechLoad(mgr.getManifest(engine), "tts", variant, 3700, "cuda");
  expect(recorded[1].rows).toContainEqual({ flagName: "load_options", flagValue: "chatterbox.multilingual_t3=v3" });
  // A set never measured has no price: it is measured the first time it is used.
  vi.spyOn(runtimeOptions, "savedFor").mockReturnValue({ "chatterbox.mem_saver": "true" });
  expect(mgr._priceMb("tts", engine, variant, "cuda")).toBe(0);
});
