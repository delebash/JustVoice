// SPDX-License-Identifier: MIT
// Every speaking family audio.cpp has, offered (docs/plans/2026-10-13-adopt-everything-audiocpp.md
// slice 2): a model does what its spec says — copies a voice from a clip, speaks its built-in
// voices (voices in the app, like Kokoro's), makes a voice from words — recognition families are
// speech-recognition engines, captions stay on Qwen3-ASR's aligner, a model with no direction file
// can't be directed yet and offers only the emotions its file maps, and a model that can speak
// without a clip warms up on a full-length piece.
import { afterEach, expect, test, vi } from "vitest";
import { endState, useState } from "./engines_helpers.js";
import * as captures from "../src/api/captures_api.js";
import { listVoices } from "../src/api/voices_api.js";
import * as generated from "../src/engines/audiocpp/generated.js";
import * as slot from "../src/engines/audiocpp/slot.js";
import { lookup } from "../src/engines/capability_details.js";
import * as manager from "../src/engines/manager.js";
import { checkDelivery, emotionChoices } from "../src/persona_render.js";
import * as vmod from "../src/voice_model.js";

afterEach(() => vi.restoreAllMocks());

const engines = generated.generatedEngines();
const modelRow = (engineId, model) => engines.get(engineId).VARIANTS.find((v) => v.audiocpp.model === model);
const voicesOf = (engineId) => engines.get(engineId).STATIC_VOICES;

test("every family that speaks is offered — the ones the clone-only filter left out too", () => {
  // TASKS "FINDING — the generated engines offer only models that clone a voice": left out at
  // v0.9.1. MOSS VoiceGenerator (voice design only) and Voxtral TTS (built-in voices only) too.
  for (const id of [
    "maya1", "neutts", "vibevoice", "supertonic", "magpie_tts", "piper_tts", "kugelaudio", "lfm2_audio",
    "inflect_v2", "sanotts", "soprano_tts", "moss_voicegen", "voxtral_tts",
  ]) {
    expect(engines.get(id)?.KIND, id).toBe("tts");
  }
  // MiniMax-H3 and Vevo2 have no entry on audio.cpp's Text to speech tab (its own web UI lists
  // them under music and conversion), so they aren't speech engines here either.
  expect(engines.has("minimax_h3")).toBe(false);
  expect(engines.has("vevo2")).toBe(false);
});

test("a model does what its spec says: copies a voice, makes one from words, speaks built-in voices", () => {
  const does = (engineId, model) => {
    const v = modelRow(engineId, model);
    return { clone: v.voice_cloning, design: v.voice_design, voices: v.preset_voices };
  };
  expect(does("kitten_tts2", "kitten_tts2")).toEqual({ clone: true, design: false, voices: 47 });
  expect(does("supertonic", "supertonic")).toEqual({ clone: false, design: false, voices: 10 });
  expect(does("cosyvoice3", "cosyvoice3")).toEqual({ clone: true, design: false, voices: 0 });
  // Breeze's clone and voice-design entries are one package: one model doing both.
  expect(does("breeze_tts", "breeze_tts")).toEqual({ clone: true, design: true, voices: 0 });
  // Irodori's v3 VoiceDesign is its own download and only designs; v4 does both.
  expect(does("irodori_tts", "irodori_tts-irodorittsv3vdesign")).toEqual({ clone: false, design: true, voices: 0 });
  expect(does("irodori_tts", "irodori_tts-irodoritts")).toEqual({ clone: true, design: true, voices: 0 });
  expect(does("irodori_tts", "irodori_tts-irodorittsv3500m")).toEqual({ clone: true, design: false, voices: 0 });
  // A family that designs with no voice-design entry: its Text to speech entry takes the words.
  expect(does("maya1", "maya1")).toEqual({ clone: false, design: true, voices: 0 });
  expect(does("moss_voicegen", "moss_voicegen")).toEqual({ clone: false, design: true, voices: 0 });
  // A model whose spec names no voice speaks in its one voice.
  expect(does("piper_tts", "piper_tts")).toEqual({ clone: false, design: false, voices: 1 });
  // The capability rows say the same: the Clone and Design pickers read them.
  expect(lookup("breeze_tts")).toMatchObject({ supports_voice_cloning: true, supports_voice_design: true });
  expect(lookup("maya1")).toMatchObject({ supports_voice_cloning: false, supports_voice_design: true, supports_clone_prompt_text: false });
  expect(lookup("supertonic")).toMatchObject({ supports_voice_cloning: false, supports_voice_design: false });
  // The engine's capabilities are its models'.
  expect(engines.get("irodori_tts").CAPABILITIES).toMatchObject({ voice_cloning: true, voice_design: true, preset_voices: false });
  expect(engines.get("supertonic").CAPABILITIES).toMatchObject({ voice_cloning: false, preset_voices: true });
});

test("built-in voices: audio.cpp's names, their model, a gender and language only where audio.cpp's docs give one", () => {
  const kitten = voicesOf("kitten_tts2");
  expect(kitten).toHaveLength(47);
  expect(kitten.find((v) => v.name === "Bella")).toEqual({ id: "kitten_tts2_Bella", name: "Bella", language: "en", gender: "", model: "kitten_tts2" });
  expect(kitten.find((v) => v.name === "German").language).toBe("de");
  // KugelAudio's doc: German female, British English female and male.
  expect(voicesOf("kugelaudio").map((v) => [v.name, v.language, v.gender])).toEqual([
    ["default", "de", "female"],
    ["clear", "de", "female"],
    ["english_female", "en-GB", "female"],
    ["english_male", "en-GB", "male"],
  ]);
  // No gender in the spec or audio.cpp's doc: none ("Not known"); one language: it.
  expect(voicesOf("neutts").find((v) => v.name === "emily")).toMatchObject({ gender: "", language: "en" });
  expect(voicesOf("supertonic").every((v) => v.gender === "" && v.language === "")).toBe(true);
  // Voxtral: each voice id names its gender; the general presets' language isn't stated.
  const voxtral = voicesOf("voxtral_tts");
  expect(voxtral.find((v) => v.name === "es_male")).toMatchObject({ language: "es", gender: "male" });
  expect(voxtral.find((v) => v.name === "casual_female")).toMatchObject({ language: "", gender: "female" });
  // LFM2.5-Audio: its four voices belong to its English model; the Japanese one has its own.
  const lfm = voicesOf("lfm2_audio");
  expect(lfm.filter((v) => v.model === "lfm2_audio-lfm2audiotts").map((v) => v.name)).toEqual(["us_male", "us_female", "uk_male", "uk_female"]);
  expect(lfm.filter((v) => v.model === "lfm2_audio-lfm2audiojptts").map((v) => v.name)).toEqual(["Model default"]);
  expect(voicesOf("piper_tts")).toEqual([{ id: "piper_tts_model_default", name: "Model default", language: "en", gender: "", model: "piper_tts" }]);
  // Ids never collide.
  const ids = [...engines.values()].flatMap((m) => m.STATIC_VOICES.map((v) => v.id));
  expect(new Set(ids).size).toBe(ids.length);
});

test("built-in voices are voices in the app, listed like Kokoro's, each on its own model", async () => {
  const st = useState();
  try {
    const { voices } = await listVoices();
    const bella = voices.find((v) => v.id === "kitten_tts2_Bella");
    expect(bella).toMatchObject({ engine: "kitten_tts2", source: "preset", model: "kitten_tts2", model_name: "Kitten TTS 2", gender: "" });
    // No direction file yet: can't be directed yet (the plan's E8).
    expect(bella.directed_by).toBe("not_yet");
    const usMale = voices.find((v) => v.id === "lfm2_audio_us_male");
    expect(usMale.model).toBe("lfm2_audio-lfm2audiotts");
    expect((await vmod.voiceModel(st, "lfm2_audio_us_male")).model).toBe("lfm2_audio-lfm2audiotts");
    expect((await vmod.voiceModel(st, "lfm2_audio-lfm2audiojptts_model_default")).model).toBe("lfm2_audio-lfm2audiojptts");
    // Kokoro's presets are as they were.
    expect(voices.find((v) => v.id === "af_heart")).toMatchObject({ engine: "kokoro", model: "kokoro" });
  } finally {
    endState();
  }
});

test("a built-in voice goes as audio.cpp names it; a model's one voice as none", () => {
  const kitten = slot.toSpeechRequest(modelRow("kitten_tts2", "kitten_tts2"), { voice_id: "kitten_tts2_Bella", text: "Two days wrong!", ref_text: "x" });
  expect(kitten.voice).toBe("Bella");
  expect(kitten.voice_ref).toBeUndefined();
  expect(kitten.reference_text).toBeUndefined();
  const piper = slot.toSpeechRequest(modelRow("piper_tts", "piper_tts"), { voice_id: "piper_tts_model_default", text: "Two days wrong!", language: "en" });
  expect(piper.voice).toBeUndefined();
  expect(piper.voice_ref).toBeUndefined();
  // A voice that isn't one of its own, on a model that copies none: refused by name.
  expect(() => slot.toSpeechRequest(modelRow("supertonic", "supertonic"), { voice_id: "voice_x", text: "Hi." })).toThrow(/speaks only its built-in voices/);
  // A clip still wins on a model that clones and has built-in voices.
  const clone = slot.toSpeechRequest(modelRow("kitten_tts2", "kitten_tts2"), { voice_id: "voice_x", text: "Hi.", audio_prompt_path: "C:\\clips\\hatter.wav" });
  expect(clone.voice_ref).toBe("C:/clips/hatter.wav");
  expect(clone.voice).toBeUndefined();
});

test("a designed voice goes in the option the spec's voice design takes, with the entry's own template", () => {
  const described = (row, extra = {}) => slot.toSpeechRequest(row, { voice_id: "voice_x", text: "Two days wrong!", delivery: { instruct: "A warm, low voice." }, ...extra });
  // Breeze: its spec's `instruct`, no clip — and not its clone's direction (guidance 4).
  const breeze = described(modelRow("breeze_tts", "breeze_tts"));
  expect(breeze.voice_ref).toBeUndefined();
  expect(breeze.options).toEqual({ instruct: "A warm, low voice." });
  // FireRedAudio is registered for its clone entry: the voice-design entry's template goes too.
  expect(described(modelRow("firered_audio", "firered_audio")).options).toEqual({ template_name: "voice_design", instruct: "A warm, low voice." });
  expect(described(modelRow("fireredtts3", "fireredtts3-fireredtts3instruct")).options).toMatchObject({ template_name: "voice_design", instruct: "A warm, low voice." });
  expect(described(modelRow("maya1", "maya1")).options).toEqual({ instruct: "A warm, low voice." });
  // A design with no description is refused by name, in the hand-wired models' words.
  expect(() => slot.toSpeechRequest(modelRow("maya1", "maya1"), { voice_id: "v", text: "Hi." })).toThrow(/renders from a voice description and this voice has none/);
  expect(() => slot.toSpeechRequest(modelRow("breeze_tts", "breeze_tts"), { voice_id: "v", text: "Hi." })).toThrow(/neither a reference clip nor a description/);
  // The same model with a clip clones, and takes the line's direction as its file says.
  const clone = described(modelRow("breeze_tts", "breeze_tts"), { audio_prompt_path: "C:\\clips\\hatter.wav" });
  expect(clone.voice_ref).toBe("C:/clips/hatter.wav");
  expect(clone.options).toMatchObject({ instruction: "A warm, low voice.", guidance_scale: 4 });
});

test("recognition families are speech-recognition engines; the language goes as each spec takes it", () => {
  const ids = generated.generatedRecognisers().map((m) => m.engineId);
  for (const id of ["parakeet_tdt", "canary_asr", "cohere_asr", "moss_transcribe_diarize", "owsm"]) expect(ids, id).toContain(id);
  // Qwen3-ASR stays hand-wired; audio understanding (its analysis tab) isn't a recogniser.
  for (const id of ["qwen3_asr", "audio_flamingo", "samsone"]) expect(ids, id).not.toContain(id);
  const req = (engineId, language) => slot.generatedTranscribeRequest(engines.get(engineId).VARIANTS[0], { language }, "C:/a.wav");
  expect(req("canary_asr", "en")).toEqual({ model: "canary_asr-f32", audio: "C:/a.wav", language: "en" });
  expect(req("confucius4_r2t2", "en").language).toBe("English"); // its default is a name ("Auto")
  expect(req("owsm", "en").language).toBeUndefined(); // it lists three-letter codes only
  expect(req("nemotron_asr", "en-GB").language).toBe("en-GB");
  expect(req("nemotron_asr", "en").language).toBeUndefined(); // two regions: not guessed
  expect(req("parakeet_tdt", "en").language).toBeUndefined(); // no language option
});

test("a model with no direction file can't be directed yet; the persona page offers only the emotions a file maps", () => {
  expect(vmod.directedBy("audio8_tts")).toBe("not_yet");
  expect(vmod.directedBy("supertonic")).toBe("not_yet");
  expect(vmod.directedBy("cosyvoice3")).toBe("words");
  // A hand-wired model is unchanged.
  expect(vmod.directedBy("kokoro")).toBe("sliders");
  expect(lookup("kokoro").direction_known).toBe(true);
  // CosyVoice3 acts on its authors' five sentences, Higgs on its seven tags (the narrowings review
  // E8); a model taking words, on every emotion.
  expect(lookup("cosyvoice3").emotions).toEqual(["happy", "sad", "angry", "whispered", "shouted"]);
  expect(emotionChoices("cosyvoice3")).toEqual(["happy", "sad", "angry", "whispered", "shouted"]);
  expect(emotionChoices("higgs_audio_tts")).toEqual(["happy", "sad", "angry", "fearful", "whispered", "shouted", "contemptuous"]);
  expect(lookup("breeze_tts").emotions).toBeNull();
  expect(emotionChoices("breeze_tts")).toHaveLength(9);
  expect(emotionChoices("supertonic")).toEqual([]);
  // An emotion saved before the choices narrowed still saves; one no model knows doesn't.
  expect(checkDelivery({ models: { cosyvoice3: { emotion: "fearful" } } })).toEqual([]);
  expect(checkDelivery({ models: { cosyvoice3: { emotion: "bored" } } })).toEqual(["CosyVoice3 has no emotion called 'bored'"]);
});

/** A slot holding `row`, its server a fake that records what it is asked. */
function warmSlot(engineId, row) {
  vi.spyOn(slot, "effectivePlacement").mockImplementation((p) => p);
  const s = new slot.AudioCppSlot(manager.discoverEngines().get(engineId));
  s._row = row;
  const asked = [];
  vi.spyOn(s, "_srv").mockReturnValue({
    speech: async (req) => asked.push(["speech", req]),
    transcribe: async (req) => asked.push(["transcribe", req]),
  });
  return [s, asked];
}

test("a model that speaks without a clip warms up on a full-length piece; a clone-only one can't", async () => {
  // M1: in its default built-in voice, at its spec's own piece budget (Kitten TTS 2's 380).
  const [kitten, k] = warmSlot("kitten_tts2", modelRow("kitten_tts2", "kitten_tts2"));
  expect(await kitten._warm(800)).toBe(true);
  expect(k[0][1].voice).toBe("Bruno"); // the spec's default voice
  expect(k[0][1].input.length).toBeGreaterThan(300);
  expect(k[0][1].input.length).toBeLessThanOrEqual(380);
  // From a description on a design model: the one audio.cpp gives the option (Maya1's control
  // list, Breeze's spec), else Qwen3 VoiceDesign's warm-up words.
  const [maya, m] = warmSlot("maya1", modelRow("maya1", "maya1"));
  expect(await maya._warm(800)).toBe(true);
  expect(m[0][1].options.instruct).toBe("Warm female voice with an American accent and conversational pacing.");
  const [breeze, b] = warmSlot("breeze_tts", modelRow("breeze_tts", "breeze_tts"));
  expect(await breeze._warm(800)).toBe(true);
  expect(b[0][1].options.instruct).toBe("Speak clearly and naturally.");
  expect(b[0][1].voice_ref).toBeUndefined();
  const [moss, g] = warmSlot("moss_voicegen", modelRow("moss_voicegen", "moss_voicegen"));
  await moss._warm(800);
  expect(g[0][1].options.instruct).toBe("A calm, clear narrator.");
  // OmniVoice takes only its own words as a description; with none it speaks its auto voice.
  const [omni, o] = warmSlot("omnivoice", modelRow("omnivoice", "omnivoice"));
  expect(await omni._warm(800)).toBe(true);
  expect(o[0][1].options).toBeUndefined();
  expect(o[0][1].voice_ref).toBeUndefined();
  // In its one voice.
  const [piper, p] = warmSlot("piper_tts", modelRow("piper_tts", "piper_tts"));
  expect(await piper._warm(0)).toBe(false); // nothing to calibrate: a short warm-up
  expect(p[0][1].input).toBe("Ready.");
  // A model that speaks only from a clip says nothing: its first line sets its price.
  const [cosy, c] = warmSlot("cosyvoice3", modelRow("cosyvoice3", "cosyvoice3"));
  expect(await cosy._warm(800)).toBe(false);
  expect(c).toEqual([]);
  // A recogniser hears silence — its 30 s chunk when calibrating, as Qwen3-ASR does.
  const [canary, a] = warmSlot("canary_asr", engines.get("canary_asr").VARIANTS[0]);
  expect(await canary._warm(800)).toBe(true);
  expect(a[0][0]).toBe("transcribe");
  expect(a[0][1].audio).toMatch(/silence-480000\.wav$/);
});

test("captions keep Qwen3-ASR and its aligner whatever recogniser transcribes", async () => {
  const st = useState();
  try {
    const loads = [];
    const fake = {
      loadedFor: () => ({ manifest: { id: "parakeet_tdt" } }),
      status: () => "installed",
      load: async (id, opts) => loads.push([id, opts.variant]),
    };
    vi.spyOn(manager, "getManager").mockReturnValue(fake);
    // Dictation, a clip's words, read-back: the loaded recogniser.
    await captures.ensureSttLoaded();
    expect(loads).toEqual([]);
    // Word timings: Qwen3-ASR takes the slot (the plan's §7 answer 2).
    await captures.ensureSttLoaded({ aligner: true });
    expect(loads).toEqual([["asr", st.settings.get().captures.stt_model]]);
  } finally {
    endState();
  }
});

test("a model whose licence JustVoice hasn't read yet shows audio.cpp's word, gated the same way", () => {
  const voxtral = generated.engineFacts(engines.get("voxtral_tts")).licence;
  expect(voxtral).toMatchObject({ name: "CC-BY-NC-4.0", commercial: "No", table: "No", by: "audio.cpp" });
  expect(engines.get("voxtral_tts").TERMS).toMatchObject({ gates: "download", reading: "CC-BY-NC-4.0 · audio.cpp's licence table, checked 2026-10-07" });
  // A Yes in audio.cpp's table: no gate.
  expect(engines.get("supertonic").TERMS).toBeUndefined();
  // Our reading wins where we have one.
  expect(generated.engineFacts(engines.get("kitten_tts2")).licence.by).toBeUndefined();
  // Every gate says something.
  for (const [id, m] of engines) if (m.TERMS) expect(m.TERMS.text, id).toBeTruthy();
});

test("dictation is ready with whichever recogniser is loaded", async () => {
  const { _sttReadiness } = await import("../src/api/capture_readiness_api.js");
  vi.spyOn(manager, "getManager").mockReturnValue({
    loadedFor: () => ({ manifest: { id: "parakeet_tdt", name: "Parakeet TDT", module: engines.get("parakeet_tdt") } }),
    currentVariantId: () => "parakeet_tdt-q8",
  });
  expect(_sttReadiness()).toMatchObject({ ready: true, display_name: engines.get("parakeet_tdt").VARIANTS.find((v) => v.id === "parakeet_tdt-q8").name });
});
