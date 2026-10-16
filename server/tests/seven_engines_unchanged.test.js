// SPDX-License-Identifier: MIT
// The adoption plan's slice 4, offline half of its acceptance (docs/plans/2026-10-13-adopt-
// everything-audiocpp.md §5): Kokoro, KittenTTS, Pocket TTS, Qwen3-TTS, Chatterbox (with Turbo
// and Nano), VoxCPM2 and Qwen3-ASR move onto the path every audio.cpp engine takes, and
// "a persona made before speaks the same take with the same seed; the user's data opens with
// nothing missing."
//
// `seven_engines_before.json` was written by this file on main (5bcd223f), before the move
// (`JV_SEVEN_BEFORE=write`). Every request a persona of each of the seven sends audio.cpp — and
// each warm-up, registration, transcription and alignment — must be the same bytes after it; every
// model, voice, setting and price key there before must still be there, the same. What an approved
// decision changes is named below with its decision; nothing else may differ.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { pyJson } from "@delebash/llm-runner/platform/pyjson";
import { afterEach, expect, test, vi } from "vitest";
import "./engines_helpers.js";
import { _jsonBody } from "../src/engines/audiocpp/runtime.js";
import * as runtimeOptions from "../src/engines/audiocpp/runtime_options.js";
import * as slot from "../src/engines/audiocpp/slot.js";
import { lookup } from "../src/engines/capability_details.js";
import { discoverEngines } from "../src/engines/manager.js";
import { modelSettings } from "../src/persona_render.js";
import { wav } from "./engines_helpers.js";
import { tmpPath } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());

const BEFORE = new URL("./seven_engines_before.json", import.meta.url);
const WRITE = process.env.JV_SEVEN_BEFORE === "write";
const SEVEN = ["kokoro", "kitten", "pocket", "qwen3", "chatterbox", "voxcpm2", "asr"];

const engine = (id) => discoverEngines().get(id);
const rowOf = (engineId, variantId) => engine(engineId).module.VARIANTS.find((v) => v.id === variantId);
// The bytes the runtime sends: a speech request with its floats written as floats
// (runtime._jsonBody), anything else as `_post` writes it.
const speechBytes = (req) => _jsonBody(req).toString("utf8");
const jsonBytes = (v) => pyJson(v, { separators: [",", ":"], ensureAscii: false });

const CLIP = "C:\\voices\\hatter\\ref.wav";
const WORDS = "Ah! that accounts for it. He won't stand beating.";
const LINE = "The Hatter looked at his watch twice, poured the tea and laughed at his luck.";

/** A persona's delivery for `model` as a render sends it (persona_render.modelSettings): the shared
 * settings, then the model's own saved under the app's names. */
function persona(model, { shared = {}, knobs = {}, emotion = null } = {}) {
  const ms = { knobs, ...(emotion ? { emotion } : {}) };
  return modelSettings({ default_delivery: { ...shared, models: { [model]: ms } } }, model)[0];
}

// [what it is, engine, model (variant), the body a render sends `/synth`]
const CASES = [
  // Kokoro — the user's own personas are Kokoro voices (am_liam, bf_isabella …).
  ["a Kokoro narrator, pace 1.1", "kokoro", "kokoro-82m-q8", { voice_id: "am_liam", text: LINE, language: "en-US", seed: 42, delivery: persona("kokoro", { shared: { speed: 1.1 } }) }],
  ["a Kokoro narrator on the 16-bit file", "kokoro", "kokoro-82m-bf16", { voice_id: "am_liam", text: LINE, language: "en-US", seed: 42, delivery: persona("kokoro", { shared: { speed: 1.1 } }) }],
  ["a British Kokoro voice", "kokoro", "kokoro-82m-q8", { voice_id: "bf_isabella", text: LINE, language: "en-GB", seed: 7, delivery: persona("kokoro") }],
  ["a French Kokoro voice", "kokoro", "kokoro-82m-q8", { voice_id: "ff_siwis", text: "Le chapelier regarda sa montre.", language: "fr", seed: 3 }],
  ["a line in a language Kokoro lacks", "kokoro", "kokoro-82m-q8", { voice_id: "bf_emma", text: "Hallo.", language: "de-DE", seed: 9 }],
  ["a Kokoro blend", "kokoro", "kokoro-82m-q8", { voice_id: "voice_blend", text: LINE, language: "en-GB", seed: 11, voice_pack_path: "C:\\data\\cache\\kokoro-voice-packs\\abc.bin", voice_language: "en-GB" }],
  ["a lexicon's IPA on Kokoro", "kokoro", "kokoro-82m-q8", { voice_id: "af_heart", text: "The Hatter laughed.", language: "en-US", seed: 5, delivery: { ipa_map: { Hatter: "hˈætəɹ" } } }],
  ["a Japanese Kokoro voice without the dictionary", "kokoro", "kokoro-82m-q8", { voice_id: "jf_alpha", text: "こんにちは。", language: "ja", seed: 1 }],
  // KittenTTS
  ["a Kitten voice, pace 1.2", "kitten", "kitten-mini-0.8", { voice_id: "kitten_bella", text: LINE, language: "en-US", seed: 42, delivery: persona("kitten", { shared: { speed: 1.2 } }) }],
  ["Kitten's Leo", "kitten", "kitten-mini-0.8", { voice_id: "kitten_leo", text: LINE, language: "en-US", seed: 8 }],
  ["a voice Kitten doesn't have", "kitten", "kitten-mini-0.8", { voice_id: "af_heart", text: LINE, seed: 8 }],
  // Pocket TTS
  ["a Pocket preset", "pocket", "pocket-en-q8", { voice_id: "pocket_alba", text: LINE, language: "en", seed: 42 }],
  ["a Pocket preset in German", "pocket", "pocket-de-q8", { voice_id: "pocket_vera", text: "Der Hutmacher lachte.", language: "de", seed: 42 }],
  ["a Pocket preset in Spanish, 16-bit", "pocket", "pocket-es-bf16", { voice_id: "pocket_paul", text: "El sombrerero se rio.", language: "es", seed: 4 }],
  ["a Pocket clone", "pocket", "pocket-en-bf16", { voice_id: "voice_x", text: LINE, language: "en", seed: 42, audio_prompt_path: CLIP }],
  ["a Spanish line on Pocket's English model", "pocket", "pocket-en-q8", { voice_id: "pocket_alba", text: "Hola.", language: "es", seed: 1 }],
  // Qwen3-TTS
  [
    "a Qwen3 CustomVoice speaker, directed, every sampling setting",
    "qwen3",
    "qwen3-cv-1.7b-q8",
    {
      voice_id: "Ryan",
      text: LINE,
      language: "en-US",
      seed: 42,
      delivery: {
        ...persona("qwen3-cv", {
          knobs: { talker_temperature: 0.7, talker_top_k: 40, talker_top_p: 0.9, repetition_penalty: 1.1, subtalker_temperature: 0.8, subtalker_top_k: 30, subtalker_top_p: 0.95 },
        }),
        instruct: "Whisper it, amused.",
      },
    },
  ],
  ["a Qwen3 CustomVoice 0.6B speaker in Chinese", "qwen3", "qwen3-cv-0.6b-bf16", { voice_id: "Vivian", text: "帽匠看了两次表。", language: "zh", seed: 3 }],
  ["a Qwen3 speaker in a language it lacks", "qwen3", "qwen3-cv-1.7b-bf16", { voice_id: "Ono_Anna", text: "Hello.", language: "ar", seed: 3 }],
  ["a Qwen3 temperature of 0 and top-p of 0", "qwen3", "qwen3-cv-0.6b-q8", { voice_id: "Sohee", text: LINE, language: "ko", seed: 2, delivery: { temperature: 0, engine: { talker_top_p: 0 } } }],
  ["a Qwen3 Base clone with its words", "qwen3", "qwen3-base-1.7b-q8", { voice_id: "voice_x", text: LINE, language: "en-US", seed: 42, audio_prompt_path: CLIP, ref_text: WORDS }],
  ["a Qwen3 Base clone, Skip the words", "qwen3", "qwen3-base-0.6b-bf16", { voice_id: "voice_x", text: LINE, language: "de", seed: 6, audio_prompt_path: CLIP, xvector_only: true }],
  ["a Qwen3 Base clone without its words", "qwen3", "qwen3-base-1.7b-bf16", { voice_id: "voice_x", text: LINE, seed: 6, audio_prompt_path: CLIP }],
  ["a Qwen3 VoiceDesign voice", "qwen3", "qwen3-vd-1.7b-q8", { voice_id: "voice_d", text: LINE, language: "en-US", seed: 12, delivery: { instruct: "Male, middle-aged, a sharp eccentric timbre." } }],
  ["a Qwen3 VoiceDesign voice with no description", "qwen3", "qwen3-vd-1.7b-bf16", { voice_id: "voice_d", text: LINE, seed: 12 }],
  ["a clip on CustomVoice", "qwen3", "qwen3-cv-1.7b-q8", { voice_id: "voice_x", text: LINE, seed: 1, audio_prompt_path: CLIP }],
  ["a speaker on Base", "qwen3", "qwen3-base-0.6b-q8", { voice_id: "Ryan", text: LINE, seed: 1 }],
  // Chatterbox Multilingual
  [
    "a Chatterbox Multilingual clone in German, every setting",
    "chatterbox",
    "chatterbox-multilingual-v2-q8",
    {
      voice_id: "voice_x",
      text: "Der Hutmacher sah zweimal auf seine Uhr.",
      language: "de",
      seed: 42,
      audio_prompt_path: CLIP,
      delivery: persona("chatterbox-multilingual", {
        knobs: { temperature: 0.7, exaggeration: 0.6, cfg_weight: 0.4, repetition_penalty: 1.3, top_p: 0.9, min_p: 0.1, s3gen_cfg_rate: 0.6 },
      }),
    },
  ],
  ["a Chatterbox Multilingual clone, 16-bit", "chatterbox", "chatterbox-multilingual-v2-f16", { voice_id: "voice_x", text: LINE, language: "en-US", seed: 5, audio_prompt_path: CLIP }],
  ["Chatterbox without a clip", "chatterbox", "chatterbox-multilingual-v2-q8", { voice_id: "voice_x", text: LINE, seed: 5 }],
  ["Chatterbox in Japanese without the dictionary", "chatterbox", "chatterbox-multilingual-v2-q8", { voice_id: "voice_x", text: "こんにちは。", language: "ja", seed: 5, audio_prompt_path: CLIP }],
  // Chatterbox Turbo and Nano
  [
    "a Turbo clone with a tag, every setting",
    "chatterbox",
    "chatterbox-turbo-q8",
    {
      voice_id: "voice_x",
      text: "[laugh] Two days wrong!",
      language: "en-US",
      seed: 42,
      audio_prompt_path: CLIP,
      ref_text: WORDS,
      delivery: persona("chatterbox-turbo", { knobs: { temperature: 0.7, repetition_penalty: 1.3, top_p: 0.9, top_k: 500 } }),
    },
  ],
  ["a Nano clone, 16-bit", "chatterbox", "chatterbox-nano-f16", { voice_id: "voice_x", text: LINE, language: "en", seed: 4, audio_prompt_path: CLIP }],
  ["a Turbo voice with no clip", "chatterbox", "chatterbox-turbo-f16", { voice_id: "anything", text: LINE, seed: 4 }],
  // VoxCPM2
  [
    "a VoxCPM2 clone with its words, every setting",
    "voxcpm2",
    "voxcpm2-q8",
    {
      voice_id: "voice_x",
      text: LINE,
      language: "en-US",
      seed: 42,
      audio_prompt_path: CLIP,
      ref_text: WORDS,
      delivery: persona("voxcpm2", { knobs: { cfg_value: 2.5, inference_timesteps: 12, retry_badcase_max_times: 2, retry_badcase_ratio_threshold: 5 } }),
    },
  ],
  ["a directed VoxCPM2 clone", "voxcpm2", "voxcpm2-bf16", { voice_id: "voice_x", text: LINE, seed: 42, audio_prompt_path: CLIP, ref_text: WORDS, delivery: { instruct: "Whispered, (tired)" } }],
  ["a VoxCPM2 design", "voxcpm2", "voxcpm2-q8", { voice_id: "voice_d", text: "He left (quietly) and shut it.", seed: 1234, delivery: { instruct: "A deep, slow, elderly man's voice" } }],
  ["VoxCPM2's tries at 0", "voxcpm2", "voxcpm2-q8", { voice_id: "voice_x", text: LINE, seed: 1, audio_prompt_path: CLIP, delivery: { engine: { retry_badcase_max_times: 0 } } }],
  ["VoxCPM2 with neither", "voxcpm2", "voxcpm2-q8", { voice_id: "voice_x", text: LINE, seed: 1 }],
];

/** What each case sends audio.cpp: its request's bytes, or the refusal's words. */
function requests() {
  const out = {};
  for (const [what, engineId, variant, body] of CASES) {
    let sent;
    try {
      sent = speechBytes(slot.toSpeechRequest(rowOf(engineId, variant), body));
    } catch (e) {
      sent = `refused: ${e.message}`;
    }
    out[`${engineId}/${variant} · ${what}`] = sent;
  }
  return out;
}

/** A slot holding `row`, its server a recorder (what audio.cpp would be sent). */
function recordingSlot(engineId, row) {
  const s = Object.create(slot.AudioCppSlot.prototype);
  const m = engine(engineId);
  const sent = [];
  Object.assign(s, { manifest: m, _row: row, placement: "gpu", kind: m.kind === "stt" ? "stt" : "tts", _loaded: true, sent });
  s.isAlive = () => true;
  s._srv = () => ({
    managed: false,
    speech: async (req) => {
      sent.push(`speech ${speechBytes(req)}`);
      return [wav(0.1), {}];
    },
    transcribe: async (req) => {
      sent.push(`transcribe ${jsonBytes(req)}`);
      return { text: "hello" };
    },
    align: async (model, _wav, text, language) => {
      sent.push(`align ${jsonBytes({ model, text, language })}`);
      return { words: [] };
    },
  });
  return s;
}

const literally = (s) => new RegExp(s.replaceAll("\\", "/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
/** A request's paths as the same text on any machine: the data folder `<data>`, the temp folder
 * `<tmp>`, forward slashes. */
const portable = (s, data = null) => {
  const fwd = s.replaceAll("\\\\", "/").replaceAll("\\", "/");
  return (data ? fwd.replace(literally(data), "<data>") : fwd).replace(literally(os.tmpdir()), "<tmp>");
};

/** Every load of each of the seven's models: what it registers, and what its warm-up speaks (a
 * plain Load, and one that calibrates a 200-character piece). Its recognisers' transcription and
 * alignment too. */
async function loads() {
  const data = tmpPath();
  vi.spyOn(slot, "_dataDir").mockReturnValue(data);
  const out = {};
  for (const engineId of SEVEN) {
    const m = engine(engineId);
    for (const row of m.module.VARIANTS) {
      const key = `${engineId}/${row.id}`;
      const registered = slot._entriesFor(m, row).map((e) => portable(jsonBytes(e.toConfig()), data));
      const s = recordingSlot(engineId, row);
      const warm = await s._warm(0);
      const calibrated = await s._warm(200);
      if (m.kind === "stt") {
        await s._transcribe({ audio_path: "C:\\clips\\hatter.wav", language: "en-US" });
        await s._transcribe({ audio_path: "C:\\clips\\hatter.wav", language: "yue" });
        await s._transcribe({ audio_path: "C:\\clips\\hatter.wav", language: "sw" });
        await s._align({ wav_b64: wav(0.5, 16000).toString("base64"), text: LINE, language: "fr-FR" });
      }
      out[key] = { registered, warm, calibrated, sent: s.sent.map((x) => portable(x, data)) };
    }
  }
  return out;
}

const ENGINE_FACTS = ["ID", "NAME", "DESCRIPTION", "LICENSE", "WEIGHTS_LICENSE", "KIND", "DEFAULT_VARIANT_ID", "CAPABILITIES", "TERMS"];

/** The seven as the app holds them: each engine's facts, models and voices; each model's settings,
 * how a persona's saved settings read, and the keys its measured prices are kept under. */
function facts() {
  const out = {};
  for (const engineId of SEVEN) {
    const mod = engine(engineId).module;
    const models = {};
    for (const row of mod.VARIANTS) {
      models[row.id] = {
        row: JSON.parse(JSON.stringify(row)),
        capability: JSON.parse(JSON.stringify(lookup(row.id))),
        price_key: { load_options: runtimeOptions.priceKeyFor(engineId, row), split_chars: row.split_chars ?? null },
      };
    }
    out[engineId] = {
      engine: Object.fromEntries(ENGINE_FACTS.filter((k) => Object.hasOwn(mod, k)).map((k) => [k, JSON.parse(JSON.stringify(mod[k]))])),
      voices: JSON.parse(JSON.stringify(mod.STATIC_VOICES)),
      models,
    };
  }
  return out;
}

// A persona's saved settings, under the app's names, as a render reads them.
const SAVED = {
  kokoro: {},
  kitten: {},
  pocket: {},
  "qwen3-cv": { talker_temperature: 0.7, talker_top_k: 40, talker_top_p: 0.9, repetition_penalty: 1.1, subtalker_temperature: 0.8, subtalker_top_k: 30, subtalker_top_p: 0.95 },
  "qwen3-base": { talker_temperature: 0.6, repetition_penalty: 1.2 },
  "qwen3-vd": { talker_top_k: 20 },
  "chatterbox-multilingual": { temperature: 0.7, exaggeration: 0.6, cfg_weight: 0.4, repetition_penalty: 1.3, top_p: 0.9, min_p: 0.1, s3gen_cfg_rate: 0.6 },
  "chatterbox-turbo": { temperature: 0.7, repetition_penalty: 1.3, top_p: 0.9, top_k: 500 },
  "chatterbox-nano": { temperature: 0.9, top_k: 100 },
  voxcpm2: { cfg_value: 2.5, inference_timesteps: 12, retry_badcase_max_times: 2, retry_badcase_ratio_threshold: 5 },
};

function settings() {
  const out = {};
  for (const [model, knobs] of Object.entries(SAVED)) {
    const [delivery, tags, seed] = modelSettings({ default_delivery: { speed: 1.1, models: { [model]: { knobs, seed: 42, emotion: "happy" } } } }, model);
    out[model] = pyJson({ delivery, tags, seed }, { sortKeys: true });
  }
  return out;
}

async function now() {
  return { requests: requests(), loads: await loads(), settings: settings(), facts: facts() };
}

test("the seven's snapshot from main exists (written there with JV_SEVEN_BEFORE=write)", async () => {
  if (WRITE) writeFileSync(BEFORE, `${JSON.stringify(await now(), null, 1)}\n`);
  expect(existsSync(BEFORE)).toBe(true);
});

const before = () => JSON.parse(readFileSync(BEFORE, "utf8"));

test("a persona of each of the seven sends audio.cpp the same bytes as before", () => {
  expect(requests()).toEqual(before().requests);
});

// The models an approved decision adds: QwenCleo-ASR (E14/F5, with its languages — TASKS "Slice 2's
// acceptance findings" 5), audio.cpp's own Turbo package and the original precisions of Qwen3-TTS
// Base 1.7B and VoxCPM2 (the plan's E6/E14/F5).
const ADDED = [
  "asr/qwencleo-asr-f16",
  "asr/qwencleo-asr-q8",
  "chatterbox/chatterbox-chatterboxturbo-q8",
  "qwen3/qwen3-base-1.7b-orig",
  "voxcpm2/voxcpm2-orig",
];

test("each model loads, warms up, transcribes and aligns with the same requests as before", async () => {
  const was = before().loads;
  const is = await loads();
  for (const [key, load] of Object.entries(was)) expect(is[key], key).toEqual(load);
  expect(Object.keys(is).filter((k) => !Object.hasOwn(was, k)).sort()).toEqual(ADDED);
});

test("a persona's saved settings read the same as before, under the app's names", () => {
  expect(settings()).toEqual(before().settings);
});

const isObject = (x) => x !== null && typeof x === "object";
/** Every place `is` differs from `was` — a value `was` has that `is` lacks or holds differently
 * ("<path>": [was, is]); what only `is` has is an addition, not a difference. A list of plain values
 * is one value; a list of objects is compared item by item. */
function differences(was, is, at = "", out = {}) {
  const items = Array.isArray(was) && Array.isArray(is) && was.some(isObject);
  if (items && was.length === is.length) was.forEach((x, i) => differences(x, is[i], `${at}.${i}`, out));
  else if (isObject(was) && !Array.isArray(was) && isObject(is) && !Array.isArray(is)) {
    for (const k of Object.keys(was)) differences(was[k], is[k], at ? `${at}.${k}` : k, out);
  } else if (JSON.stringify(was) !== JSON.stringify(is)) out[at] = [was, is];
  return out;
}

// What an approved decision changes in what was there before, each with its decision — nothing
// else may differ.
const CHANGED = {
  // F4 (decided 2026-10-15, §7 question 6): Turbo's and Nano's own voice is listed.
  "chatterbox.engine.CAPABILITIES.preset_voices": "F4",
  "chatterbox.models.chatterbox-turbo-q8.row.preset_voices": "F4",
  "chatterbox.models.chatterbox-turbo-f16.row.preset_voices": "F4",
  "chatterbox.models.chatterbox-nano-q8.row.preset_voices": "F4",
  "chatterbox.models.chatterbox-nano-f16.row.preset_voices": "F4",
  // Slice 4 (Qwen3-ASR on every recogniser's path): a recogniser has no capability row — its
  // models' ids walked to Qwen3-TTS's "qwen3" row before.
  "asr.models.qwen3-asr-1.7b-q8.capability": "slice 4",
  "asr.models.qwen3-asr-1.7b-f16.capability": "slice 4",
  "asr.models.qwen3-asr-0.6b-q8.capability": "slice 4",
  "asr.models.qwen3-asr-0.6b-f16.capability": "slice 4",
  // F10: the languages are the spec's, in its order (Qwen3-ASR's last three).
  "asr.models.qwen3-asr-1.7b-q8.row.languages": "F10",
  "asr.models.qwen3-asr-1.7b-f16.row.languages": "F10",
  "asr.models.qwen3-asr-0.6b-q8.row.languages": "F10",
  "asr.models.qwen3-asr-0.6b-f16.row.languages": "F10",
};
// Slice 3's question 4 (decided 2026-10-15): the knobs audio.cpp gives a wider range, or none, take
// audio.cpp's — a number box where an end is open; never narrower than ours, nor below the app's
// 0.05 for a temperature or top-p ("open top": from where it was).
const RANGES = {
  kitten: { speed: { min: 0.01 } },
  "chatterbox-multilingual": { top_p: "open top", min_p: "open", s3gen_cfg_rate: "open" },
  chatterbox: { top_p: "open top", min_p: "open", s3gen_cfg_rate: "open" },
  "chatterbox-turbo": { temperature: "open top", repetition_penalty: "open", top_p: "open top" },
  "chatterbox-nano": { temperature: "open top", repetition_penalty: "open", top_p: "open top" },
  qwen3: { subtalker_temperature: "open top" },
  "qwen3-cv": { subtalker_temperature: "open top" },
  "qwen3-base": { subtalker_temperature: "open top" },
  "qwen3-vd": { subtalker_temperature: "open top" },
  voxcpm2: { retry_badcase_max_times: "open top", retry_badcase_ratio_threshold: "open" },
};

test("every model, voice and price key there before is there, the same — but what a decision changed", () => {
  const was = before().facts;
  const is = facts();
  const found = {};
  for (const engineId of SEVEN) {
    // Every voice, with its id, name, language and gender.
    const voices = new Map(is[engineId].voices.map((v) => [v.id, v]));
    for (const v of was[engineId].voices) expect(voices.get(v.id), `${engineId}/${v.id}`).toEqual({ ...v, model: voices.get(v.id)?.model });
    for (const [id, m] of Object.entries(was[engineId].models)) {
      const got = is[engineId].models[id];
      expect(got, `${engineId}/${id}`).toBeDefined();
      // A setting's range changed by question 4; everything else about it the same.
      const wasKnobs = new Map(m.capability.knobs.map((k) => [k.key, k]));
      for (const k of got.capability?.knobs || []) {
        const before = wasKnobs.get(k.key);
        const change = RANGES[got.capability.engine_id]?.[k.key];
        if (!change || !before) continue;
        const want =
          change === "open"
            ? { min: null, max: null, box: true }
            : change === "open top"
              ? { min: before.min, max: null, box: true }
              : { ...before, ...change };
        expect({ ...k, min: k.min, max: k.max, box: k.box }, `${id} ${k.key}`).toEqual({ ...before, ...want });
        Object.assign(before, { min: k.min, max: k.max, box: k.box });
      }
    }
    const { voices: _was, ...wasRest } = was[engineId];
    const { voices: _is, ...isRest } = is[engineId];
    Object.assign(found, differences(wasRest, isRest, engineId));
  }
  expect(Object.keys(found).sort()).toEqual(Object.keys(CHANGED).sort());
  // F4: one voice each, sent as no voice; F10: the same 30 languages.
  expect(found["chatterbox.models.chatterbox-turbo-q8.row.preset_voices"]).toEqual([0, 1]);
  const [wasLangs, isLangs] = found["asr.models.qwen3-asr-1.7b-q8.row.languages"];
  expect([...isLangs].sort()).toEqual([...wasLangs].sort());
});
