// SPDX-License-Identifier: MIT
// Settings and load options from audio.cpp's spec — the adoption plan's slice 3
// (docs/plans/2026-10-13-adopt-everything-audiocpp.md §3: E2, E4, F9, F3; §7 question 3): a
// number with no range is a number box; ranges are audio.cpp's (its control list's, else the
// spec's); a file on the server's disk is never a setting; every load option the spec lists is
// on the model's row at audio.cpp's default, Qwen3's decoder 16-bit by default; Chatterbox
// Multilingual's v3 checkpoint is one of them; a model's memory price is kept per load-option set.
// Since round E (docs/plans/2026-10-29-round-e-onto-the-kit.md §4 step 1) the kit's audio.cpp
// runtime registers the model and keeps its price: the load options it registers and the set it
// prices under are our hooks' answers (kit_hooks.js `sessionOptions`, `loadOptionsKey`); the
// prices themselves, and the rows it records, are the kit's and tested there.
import { afterEach, expect, test, vi } from "vitest";
import "./engines_helpers.js";
import * as generated from "../src/engines/audiocpp/generated.js";
import * as hooks from "../src/engines/audiocpp/kit_hooks.js";
import { runtimeModelRows } from "../src/engines/audiocpp/kit_models.js";
import * as runtimeOptions from "../src/engines/audiocpp/runtime_options.js";
import * as slot from "../src/engines/audiocpp/slot.js";
import { lookup } from "../src/engines/capability_details.js";
import { discoverEngines } from "../src/engines/model_catalog.js";
import { checkDelivery } from "../src/persona_render.js";

afterEach(() => vi.restoreAllMocks());

const knob = (model, key) => lookup(model).knobs.find((k) => k.key === key);
const row = (engine, variant) => discoverEngines().get(engine).module.VARIANTS.find((r) => r.id === variant);
const option = (r, key) => runtimeOptions.offeredFor(r).find((o) => o.key === key);
const MULTILINGUAL = ["chatterbox", "chatterbox-multilingual-v2-q8"];
/** The kit's runtime_model row of a version (kit_models.js), as the kit hands it to our hooks. */
const kitRow = (variant) => runtimeModelRows().find((r) => r.id === variant);

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

// The capability rows of the seven engines described by our own files: their family, and each
// knob's name in audio.cpp's spec where it differs (slot.toSpeechRequest's mapping).
const SEVEN = {
  "chatterbox-multilingual": "chatterbox",
  chatterbox: "chatterbox",
  "chatterbox-turbo": "chatterbox_turbo",
  "chatterbox-nano": "chatterbox_turbo",
  qwen3: "qwen3_tts",
  "qwen3-cv": "qwen3_tts",
  "qwen3-base": "qwen3_tts",
  "qwen3-vd": "qwen3_tts",
  voxcpm2: "voxcpm2",
};
const SPEC_NAME = {
  talker_temperature: "temperature",
  talker_top_k: "top_k",
  talker_top_p: "top_p",
  cfg_weight: "guidance_scale",
  cfg_value: "guidance_scale",
  inference_timesteps: "num_inference_steps",
};

test("a setting audio.cpp's own screen doesn't show folds under Advanced; one it shows stays in view", () => {
  // Decided 2026-10-15 (TASKS "Slice 3's six questions" 1): generated models from their control list.
  expect(knob("cosyvoice3", "num_inference_steps").advanced).toBe(false);
  expect(knob("cosyvoice3", "max_tokens").advanced).toBe(true);
  for (const m of generated.generatedModels()) {
    for (const k of lookup(m.modelId).knobs) {
      if (k.key === "seed") continue;
      expect(k.advanced, `${m.modelId} ${k.key}`).toBe(!generated.inControlList(m.family, k.key));
    }
  }
  // The seven engines' knobs by the same rule.
  for (const [capId, family] of Object.entries(SEVEN)) {
    for (const k of lookup(capId).knobs) {
      if (k.key === "seed" || k.key === "speed") continue;
      expect(k.advanced, `${capId} ${k.key}`).toBe(!generated.inControlList(family, SPEC_NAME[k.key] ?? k.key));
    }
  }
  expect(knob("qwen3-cv", "talker_top_k").advanced).toBe(false);
  expect(knob("qwen3-cv", "subtalker_top_k").advanced).toBe(true);
  // Turbo: audio.cpp's own screen shows none of its settings.
  expect(lookup("chatterbox-turbo").knobs.filter((k) => k.key !== "seed").every((k) => k.advanced)).toBe(true);
});

test("the seed box's top is the spec's where it gives one", () => {
  // Decided 2026-10-15 (TASKS "Slice 3's six questions" 3); was 2,000,000,000 everywhere.
  expect(knob("qwen3-cv", "seed").max).toBe(4294967295);
  expect(knob("chatterbox-multilingual", "seed").max).toBe(4294967295);
  expect(knob("voxcpm2", "seed").max).toBe(4294967295);
  // Kokoro's spec gives the seed no top: the app's own stays.
  expect(knob("kokoro", "seed").max).toBe(2_000_000_000);
  // A top-of-range seed reaches the runtime as it is.
  const req = slot.toSpeechRequest(row("qwen3", "qwen3-cv-1.7b-q8"), { text: "Hi.", voice_id: "Ryan", seed: 4294967295 });
  expect(req.seed).toBe(4294967295);
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
  // On the model's row, in audio.cpp's own word (decided 2026-10-15, TASKS "Slice 3's six
  // questions" 2).
  expect(option(r, "chatterbox.multilingual_t3")).toMatchObject({
    type: "choice",
    label: "Checkpoint",
    hint: "Multilingual T3 checkpoint selection.",
    choices: [
      ["v2", "v2"],
      ["v3", "v3"],
    ],
    default: "v2",
    featured: true,
  });
  // Turbo and Nano are another family: no such option.
  expect(option(row("chatterbox", "chatterbox-turbo-q8"), "chatterbox.multilingual_t3")).toBeUndefined();
  // Every load of it registers the options the user saved (the kit reads our `sessionOptions`).
  vi.spyOn(runtimeOptions, "savedFor").mockReturnValue({ "chatterbox.multilingual_t3": "v3" });
  expect(hooks.sessionOptions(kitRow(r.id))).toEqual({ "chatterbox.multilingual_t3": "v3" });
  // v3 speaks the 23 languages audio.cpp lists for the family, as v2 does.
  expect(r.languages).toEqual(generated.catalogFamily("chatterbox").languages);
});

test("Qwen3's decoder stays 16-bit by default; its two measured options stay on the row", () => {
  const r = row("qwen3", "qwen3-cv-1.7b-q8");
  const shown = runtimeOptions.describe("qwen3", r);
  expect(shown.filter((o) => o.featured).map((o) => [o.key, o.label, o.value])).toEqual([
    ["qwen3_tts.perf_mode", "Speed mode", "off"],
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

test("a model's memory price is kept per load-option set; the default set has no key, so its rows from before still count", () => {
  // The set our hook names is the one the kit keeps the price under (its rows' `load_options`).
  const [, variant] = MULTILINGUAL;
  const row = kitRow(variant);
  // The default set: no key, as the rows measured before the key existed have none.
  expect(hooks.loadOptionsKey(row)).toBe("");
  // v3 chosen: its own set.
  vi.spyOn(runtimeOptions, "savedFor").mockReturnValue({ "chatterbox.multilingual_t3": "v3" });
  expect(hooks.loadOptionsKey(row)).toBe("chatterbox.multilingual_t3=v3");
  // Another set is another price, measured the first time it is used.
  vi.spyOn(runtimeOptions, "savedFor").mockReturnValue({ "chatterbox.mem_saver": "true" });
  expect(hooks.loadOptionsKey(row)).toBe("chatterbox.mem_saver=true");
});
