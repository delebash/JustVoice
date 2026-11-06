// SPDX-License-Identifier: MIT
// Every speaking family audio.cpp has, offered (docs/plans/2026-10-13-adopt-everything-audiocpp.md
// slice 2): a model does what its spec says — copies a voice from a clip, speaks its built-in
// voices (voices in the app, like Kokoro's), makes a voice from words — recognition families are
// speech-recognition engines, a model with no direction file can't be directed yet and offers only
// the emotions its file maps, and a model that can speak without a clip warms up on a full-length
// piece. Since round E (docs/plans/2026-10-29-round-e-onto-the-kit.md) the kit's audio.cpp runtime
// loads and runs every model: a warm-up is ours (slot.js `warmModel`, the kit's warm hook), a
// recogniser's request and its 16 kHz copy ours (kit_hooks.js `transcribe`), dictation's readiness
// the Transcription feature's preset (decided, §5 item 7), and a file two models share is one file
// in the kit's models cache. Captions on Qwen3-ASR's aligner are kit_speech.test.js's.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import { endState, useState } from "./engines_helpers.js";
import { tmpPath } from "./helpers.js";
import { listVoices } from "../src/api/voices_api.js";
import * as dspClient from "../src/audio/dsp_client.js";
import { parseWavHeader, writeWavContainer } from "../src/audio/wav.js";
import * as generated from "../src/engines/audiocpp/generated.js";
import * as hooks from "../src/engines/audiocpp/kit_hooks.js";
import { runtimeModelRows } from "../src/engines/audiocpp/kit_models.js";
import * as kitSpeech from "../src/engines/audiocpp/kit_speech.js";
import * as slot from "../src/engines/audiocpp/slot.js";
import { lookup } from "../src/engines/capability_details.js";
import { checkDelivery, emotionChoices } from "../src/persona_render.js";
import * as vmod from "../src/voice_model.js";

afterEach(() => vi.restoreAllMocks());
afterAll(() => dspClient.stop());

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
  expect(does("moss_voicegen", "moss_voicegen")).toEqual({ clone: false, design: true, voices: 0 });
  // Only voice-design entries make a voice from words, as audio.cpp's own Voice design tab lists
  // them (the plan's E5): Maya1 and OmniVoice have none — Maya1 speaks its one voice, with its
  // voice description a setting; OmniVoice's instruction is its direction (E3).
  expect(does("maya1", "maya1")).toEqual({ clone: false, design: false, voices: 1 });
  expect(does("omnivoice", "omnivoice")).toEqual({ clone: true, design: false, voices: 0 });
  expect(does("omnivoice", "omnivoice-voicetuttts")).toEqual({ clone: true, design: false, voices: 0 });
  // A model whose spec names no voice speaks in its one voice.
  expect(does("piper_tts", "piper_tts")).toEqual({ clone: false, design: false, voices: 1 });
  // VibeVoice's spec names no speaker_reference, but its session takes the clip as speaker 1's
  // voice and it has no stable voice without one: clone-only, no voice of its own (its file's
  // CLONES; decided 2026-10-15, TASKS "Slice 2's acceptance findings" 1).
  expect(does("vibevoice", "vibevoice-vibevoice")).toEqual({ clone: true, design: false, voices: 0 });
  expect(voicesOf("vibevoice")).toEqual([]);
  expect(lookup("vibevoice-vibevoice")).toMatchObject({ supports_voice_cloning: true, supports_clone_prompt_text: false });
  // The capability rows say the same: the Clone and Design pickers read them.
  expect(lookup("breeze_tts")).toMatchObject({ supports_voice_cloning: true, supports_voice_design: true });
  expect(lookup("maya1")).toMatchObject({ supports_voice_cloning: false, supports_voice_design: false, supports_clone_prompt_text: false });
  expect(lookup("omnivoice").supports_voice_design).toBe(false);
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
  expect(lfm.filter((v) => v.model === "lfm2_audio-lfm2audiojptts").map((v) => v.name)).toEqual(["LFM2.5-Audio 1.5B JP (built-in)"]);
  expect(voicesOf("piper_tts")).toEqual([{ id: "piper_tts_model_default", name: "Piper TTS (built-in)", language: "en", gender: "", model: "piper_tts" }]);
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
  // A design with no description is refused by name, in the hand-wired models' words.
  expect(() => slot.toSpeechRequest(modelRow("moss_voicegen", "moss_voicegen"), { voice_id: "v", text: "Hi." })).toThrow(/renders from a voice description and this voice has none/);
  expect(() => slot.toSpeechRequest(modelRow("breeze_tts", "breeze_tts"), { voice_id: "v", text: "Hi." })).toThrow(/neither a reference clip nor a description/);
  // The same model with a clip clones, and takes the line's direction as its file says.
  const clone = described(modelRow("breeze_tts", "breeze_tts"), { audio_prompt_path: "C:\\clips\\hatter.wav" });
  expect(clone.voice_ref).toBe("C:/clips/hatter.wav");
  expect(clone.options).toMatchObject({ instruction: "A warm, low voice.", guidance_scale: 4 });
});

test("recognition families are speech-recognition engines; the language goes as each spec takes it", () => {
  const ids = generated.generatedRecognisers().map((m) => m.engineId);
  for (const id of ["parakeet_tdt", "canary_asr", "cohere_asr", "moss_transcribe_diarize", "owsm"]) expect(ids, id).toContain(id);
  // Qwen3-ASR stays hand-wired; audio understanding (its analysis tab) isn't a recogniser; nor is
  // Index-Echo, a Chinese speech translator (its file's NOT_OFFERED; decided 2026-10-15).
  for (const id of ["qwen3_asr", "audio_flamingo", "samsone", "index_echo"]) expect(ids, id).not.toContain(id);
  expect(engines.has("index_echo")).toBe(false);
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

/** `row`'s warm-up (slot.js `warmModel`, which the kit's warm hook runs on the server holding the
 * model): whether it calibrated, and what it asked that server. */
async function warmUp(engineId, row, calibrateChars) {
  const asked = [];
  const srv = {
    speech: async (req) => asked.push(["speech", req]),
    transcribe: async (req) => asked.push(["transcribe", req]),
  };
  return [await slot.warmModel(srv, row, engines.get(engineId).KIND, calibrateChars), asked];
}

test("a model that speaks without a clip warms up on a full-length piece; a clone-only one can't", async () => {
  // M1: in its default built-in voice, at its spec's own piece budget (Kitten TTS 2's 380).
  const [kitten, k] = await warmUp("kitten_tts2", modelRow("kitten_tts2", "kitten_tts2"), 800);
  expect(kitten).toBe(true);
  expect(k[0][1].voice).toBe("Bruno"); // the spec's default voice
  expect(k[0][1].input.length).toBeGreaterThan(300);
  expect(k[0][1].input.length).toBeLessThanOrEqual(380);
  // Maya1 in its one voice: its required voice description at audio.cpp's own default.
  const [maya, m] = await warmUp("maya1", modelRow("maya1", "maya1"), 800);
  expect(maya).toBe(true);
  expect(m[0][1].options.instruct).toBe("Warm female voice with an American accent and conversational pacing.");
  // From a description on a design model: the one audio.cpp gives the option (Breeze's spec),
  // else Qwen3 VoiceDesign's warm-up words.
  const [breeze, b] = await warmUp("breeze_tts", modelRow("breeze_tts", "breeze_tts"), 800);
  expect(breeze).toBe(true);
  expect(b[0][1].options.instruct).toBe("Speak clearly and naturally.");
  expect(b[0][1].voice_ref).toBeUndefined();
  const [, g] = await warmUp("moss_voicegen", modelRow("moss_voicegen", "moss_voicegen"), 800);
  expect(g[0][1].options.instruct).toBe("A calm, clear narrator.");
  // In its one voice.
  const [piper, p] = await warmUp("piper_tts", modelRow("piper_tts", "piper_tts"), 0);
  expect(piper).toBe(false); // nothing to calibrate: a short warm-up
  expect(p[0][1].input).toBe("Ready.");
  // A model that speaks only from a clip says nothing: its first line sets its price.
  expect(await warmUp("cosyvoice3", modelRow("cosyvoice3", "cosyvoice3"), 800)).toEqual([false, []]);
  // VibeVoice too, now that it speaks only cloned voices (its warm-up in its own voice failed:
  // "VibeVoice prompt has no valid Speaker N: lines").
  expect(await warmUp("vibevoice", modelRow("vibevoice", "vibevoice-vibevoice"), 800)).toEqual([false, []]);
  // A recogniser hears silence — its 30 s chunk when calibrating, as Qwen3-ASR does.
  const [canary, a] = await warmUp("canary_asr", engines.get("canary_asr").VARIANTS[0], 800);
  expect(canary).toBe(true);
  expect(a[0][0]).toBe("transcribe");
  expect(a[0][1].audio).toMatch(/silence-480000\.wav$/);
});

test("a recogniser hears 16 kHz mono, as audio.cpp's own page sends it", async () => {
  // OWSM, CrisperWhisper, MOSS-Transcribe-Diarize and Hviske v6 refuse any other rate without
  // libsoxr (the acceptance run, 2026-10-15); audio.cpp's page sends every recogniser 16 kHz. The
  // kit asks our hook for the request (kit_hooks.js `transcribe`), which makes the copy.
  useState();
  try {
    const owsm = runtimeModelRows().find((r) => r.id === engines.get("owsm").VARIANTS[0].id);
    const f = path.join(tmpPath(), "a-24k-take.wav");
    writeFileSync(f, writeWavContainer(Buffer.alloc(24000 * 2 * 2), 24000, 2)); // 1 s, stereo
    const { body } = await hooks.transcribe({ audio_path: f }, owsm);
    const [heard] = parseWavHeader(readFileSync(body.audio));
    expect([heard.sampleRate, heard.channels]).toEqual([16000, 1]);
    expect(Math.abs(heard.durationSec - 1.0)).toBeLessThanOrEqual(0.01);
    expect(existsSync(f)).toBe(true); // the caller's file stays; only the 16 kHz copy goes
  } finally {
    endState();
  }
});

test("MOSS-Transcribe-Diarize and VibeVoice-ASR Streaming give the words without their own markup", () => {
  // Decided 2026-10-15 (TASKS "Slice 2's acceptance findings" 3): their `text` carries timed
  // speaker tags or "Speaker N:" labels; their speaker turns hold the words alone (WORDS_FROM).
  // What the recogniser answered, as a transcription returns it (kit_speech.js `transcribe`).
  const heard = (engineId, answer) => slot.plainTranscript(engines.get(engineId).VARIANTS[0], answer);
  const turns = [{ speaker_id: "S01", text: "Two days wrong!" }, { speaker_id: "S01", text: " Yes. " }];
  expect(
    heard("moss_transcribe_diarize", {
      text: "[0.06][S01] Two days wrong![1.20][1.30][S01] Yes.[2.00]",
      segments: turns.map(({ text }) => ({ text })),
      speaker_turns: turns,
    }),
  ).toBe("Two days wrong! Yes.");
  expect(
    heard("vibevoice_asr_streaming", {
      text: "Speaker 0: Two days wrong! Speaker 1: Yes.",
      speaker_turns: [{ speaker_id: "0", text: "Two days wrong!" }, { speaker_id: "1", text: "Yes." }],
    }),
  ).toBe("Two days wrong! Yes.");
  // No turns parsed: its text, as it came.
  expect(heard("moss_transcribe_diarize", { text: " Two days wrong! ", speaker_turns: [] })).toBe("Two days wrong!");
  // Any other recogniser: its text, whatever else it returns.
  expect(heard("owsm", { text: "Two days wrong!", speaker_turns: [{ text: "other" }] })).toBe("Two days wrong!");
});

test("VibeVoice speaks each line as speaker 1 of its script, in the clip's voice; MOSS-TTSD as [S1]", () => {
  // Decided 2026-10-15 (TASKS "Slice 2's acceptance findings" 1): VibeVoice drops a line without
  // "Speaker N:" (tokenizer_text.cpp:48-83); the clip goes as voice_ref, never voice_samples, and no
  // instructions. One mechanism for both, the family file's SPEAKER_SCRIPT.
  const vibe = modelRow("vibevoice", "vibevoice-vibevoice");
  const req = slot.toSpeechRequest(vibe, {
    voice_id: "v",
    text: "Two days wrong!\n\n  And a $& second.  ",
    audio_prompt_path: "C:\\clips\\hatter.wav",
    ref_text: "Ah, that accounts for it.",
    delivery: { emotion: "sad", instruct: "sad. weary" },
  });
  expect(req.input).toBe("Speaker 1: Two days wrong!\nSpeaker 1: And a $& second.");
  expect(req.voice_ref).toBe("C:/clips/hatter.wav");
  expect(req.reference_text).toBeUndefined(); // its spec takes no clip words
  expect(req.instructions).toBeUndefined();
  expect(req.options?.voice_samples).toBeUndefined();
  expect(() => slot.toSpeechRequest(vibe, { voice_id: "v", text: "Hi." })).toThrow(/speaks only cloned voices/);
  // MOSS-TTSD: its text and the clip's words tagged [S1] (moss_ttsd.md:20-21, 53).
  const ttsd = slot.toSpeechRequest(modelRow("moss_ttsd", "moss_ttsd"), {
    voice_id: "v",
    text: "Two days wrong!",
    audio_prompt_path: "C:\\clips\\hatter.wav",
    ref_text: "Ah, that accounts for it.",
  });
  expect(ttsd.input).toBe("[S1] Two days wrong!");
  expect(ttsd.reference_text).toBe("[S1] Ah, that accounts for it.");
  expect(ttsd.voice_ref).toBe("C:/clips/hatter.wav");
  // Any other family's text is as it was.
  expect(slot.toSpeechRequest(modelRow("cosyvoice3", "cosyvoice3"), { voice_id: "v", text: "Hi.", audio_prompt_path: "C:\\c.wav" }).input).toBe("Hi.");
});

test("a checkpoint that speaks fewer languages than its family lists only its own", () => {
  // Decided 2026-10-15 (TASKS "Slice 2's acceptance findings" 5), from audio.cpp's model docs.
  const langs = (engineId, variantId) => engines.get(engineId).VARIANTS.find((v) => v.id === variantId);
  expect(langs("lfm2_audio", "lfm2_audio-lfm2audiotts-q8").languages).toEqual(["en"]);
  expect(langs("lfm2_audio", "lfm2_audio-lfm2audiojptts-q8").languages).toEqual(["ja"]);
  expect(langs("lfm2_audio_asr", "lfm2_audio_asr-lfm2audioasr-q8").languages).toEqual(["en"]);
  expect(langs("lfm2_audio_asr", "lfm2_audio_asr-lfm2audiojpasr-f16").languages).toEqual(["ja"]);
  expect(voicesOf("lfm2_audio").find((v) => v.model === "lfm2_audio-lfm2audiojptts").language).toBe("ja");
  expect(langs("gigaam_asr", "gigaam_asr-gigaamv3ctc-f16").languages).toEqual(["ru"]);
  expect(langs("gigaam_asr", "gigaam_asr-gigaammultilingual-f16").languages).toEqual(["ru", "kk", "ky", "uz", "en"]);
  expect(langs("kroko_asr", "kroko_asr-q8").languages).toEqual(["en"]);
  expect(langs("index_tts2", "index_tts2-indextts2-q8").languages).toEqual(["zh", "en"]);
  expect(langs("index_tts2", "index_tts2-indextts25-q8").languages).toEqual(["zh", "en", "ja", "es", "ar"]);
  expect(langs("f5_tts", "f5_tts-f5ttshabibiunified-orig").languages).toEqual(["ar"]);
  expect(langs("f5_tts", "f5_tts-f5ttshabibiegy-orig").languages).toEqual(["ar-EG"]);
  expect(langs("f5_tts", "f5_tts-f5ttshabibimsa-orig").languages).toEqual(["ar-001"]);
  const voicetut = langs("omnivoice", "omnivoice-voicetuttts-q8");
  expect([voicetut.languages, voicetut.languages_note]).toEqual([["ar-EG", "en"], ""]);
  expect(langs("omnivoice", "omnivoice-q8")).toMatchObject({ languages: [], languages_note: "600+ languages" });
  // sanoTTS: one language per download.
  expect(langs("sanotts", "sanotts-german").languages).toEqual(["de"]);
  expect(langs("sanotts", "sanotts-heart").languages).toEqual(["en"]);
  expect(langs("sanotts", "sanotts-portuguesebrazil").languages).toEqual(["pt-BR"]);
  expect(vmod.modelSpeaks("lfm2_audio", "lfm2_audio-lfm2audiojptts")).toEqual(["ja"]);
  expect(vmod.modelSpeaks("sanotts", "sanotts")).toHaveLength(14);
  // A speech line in a language its model doesn't speak goes without one; the form stays the
  // family's (OmniVoice takes no `ar-EG`, so VoiceTut's Arabic line goes as none, as before).
  const say = (engineId, variantId, language, extra = {}) =>
    slot.toSpeechRequest(langs(engineId, variantId), { voice_id: "v", text: "Hi.", language, ...extra });
  const clip = { audio_prompt_path: "C:\\c.wav", ref_text: "Hello." };
  expect(say("lfm2_audio", "lfm2_audio-lfm2audiojptts-q8", "en", { voice_id: "lfm2_audio-lfm2audiojptts_model_default" }).language).toBeUndefined();
  expect(say("lfm2_audio", "lfm2_audio-lfm2audiojptts-q8", "ja", { voice_id: "lfm2_audio-lfm2audiojptts_model_default" }).language).toBe("ja");
  expect(say("omnivoice", "omnivoice-voicetuttts-q8", "ar", clip).language).toBeUndefined();
  expect(say("index_tts2", "index_tts2-indextts2-q8", "ja", clip).options?.language).toBeUndefined();
  expect(say("index_tts2", "index_tts2-indextts25-q8", "ja", clip).options.language).toBe("ja");
  // A recogniser's request keeps the family's form, so audio.cpp's own refusal stays (LFM2.5-Audio
  // JP: "this LFM2-Audio checkpoint transcribes ja, not en").
  const hear = (engineId, variantId, language) => slot.generatedTranscribeRequest(langs(engineId, variantId), { language }, "C:/a.wav");
  expect(hear("lfm2_audio_asr", "lfm2_audio_asr-lfm2audiojpasr-q8", "en").language).toBe("en");
  expect(hear("kroko_asr", "kroko_asr-q8", "de").language).toBe("de");
});

test("sanoTTS's download is picked by the persona's language, as Pocket TTS's is", () => {
  vi.spyOn(vmod, "_onDisk").mockReturnValue(true);
  expect(vmod.variantForModel("sanotts", "sanotts", "de-DE")).toBe("sanotts-german");
  expect(vmod.variantForModel("sanotts", "sanotts", "pt")).toBe("sanotts-portuguesebrazil");
  expect(() => vmod.variantForModel("sanotts", "sanotts", "ko")).toThrow(vmod.ModelUnavailable);
});

test("every offered model shows JustVoice's licence reading; one not read yet would show audio.cpp's word", () => {
  // The 34 families listed since slice 2 were read at their source on 2026-10-15 (RESEARCH §10.13).
  for (const [id, m] of engines) expect(generated.engineFacts(m).licence?.by, id).toBeUndefined();
  expect(generated.engineFacts(engines.get("voxtral_tts")).licence).toMatchObject({ commercial: "No", checked: "2026-10-15" });
  // Our word differs from audio.cpp's table: Supertonic 3's OpenRAIL-M asks you to say the audio
  // is machine-generated, so its download is gated now; CrisperWhisper's maker sells a licence.
  expect(engines.get("supertonic").TERMS).toMatchObject({ gates: "download" });
  expect(engines.get("supertonic").TERMS.reading).toContain(`audio.cpp's licence table says "Yes"`);
  expect(generated.engineFacts(engines.get("crisperwhisper")).licence).toMatchObject({ commercial: "Separate licence", table: "No" });
  // Parakeet's link is NVIDIA's model, not the catalog row's.
  expect(generated.engineFacts(engines.get("parakeet_tdt")).licence.url).toBe("https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3");
  // A family audio.cpp adds before we read it falls back to its table, and says so.
  const unread = generated.engineFacts({ GENERATED: { family: "audio8_asr" } }).licence;
  expect(unread).toMatchObject({ commercial: "No", by: "audio.cpp" });
  expect(generated.readingOf(unread)).toBe("CC-BY-NC-4.0 · audio.cpp's licence table, checked 2026-09-21");
  // Every gate says something.
  for (const [id, m] of engines) if (m.TERMS) expect(m.TERMS.text, id).toBeTruthy();
});

test("dictation is ready on the Transcription preset's recogniser, named as its model", async () => {
  // Transcription is a feature on its stt preset since round E (decided, §5 item 7): dictation
  // reads the kit's readiness for it (kit_speech.js `transcriptionReadiness`), its model named by
  // our catalog where the kit's state names none.
  const { _sttReadiness } = await import("../src/api/capture_readiness_api.js");
  const parakeet = engines.get("parakeet_tdt").VARIANTS.find((v) => v.id === "parakeet_tdt-q8");
  vi.spyOn(kitSpeech, "transcriptionReadiness").mockReturnValue({ ready: true, need: "", model: parakeet.id, modelState: { id: parakeet.id, onDisk: true } });
  expect(_sttReadiness()).toMatchObject({ ready: true, display_name: parakeet.name, downloading: false });
  // No preset model: not set up, said as a state.
  vi.mocked(kitSpeech.transcriptionReadiness).mockReturnValue({ ready: false, need: "no-stt-model", model: "", modelState: null });
  expect(_sttReadiness()).toEqual({ ready: false, display_name: "No speech-recognition model" });
});

test("a family's instruction is its direction where its file says so (E3), else a setting", () => {
  // OmniVoice takes only its own words there (gender, age, pitch, "whisper", accents): of a line's
  // direction only whispered is one, so nothing else is sent — never a word it refuses.
  const omni = modelRow("omnivoice", "omnivoice");
  const say = (delivery) =>
    slot.toSpeechRequest(omni, { voice_id: "v", text: "Hi.", audio_prompt_path: "C:\\c.wav", ref_text: "Hello.", delivery });
  expect(say({ emotion: "whispered", instruct: "whispered. hushed" }).options).toEqual({ instruct: "whisper" });
  expect(say({ emotion: "sad", instruct: "sad. weary" }).options).toBeUndefined();
  expect(say({ instruct: "slowly, with care" }).options).toBeUndefined();
  expect(say({ emotion: "whispered" }).reference_text).toBe("Hello."); // its clone needs the words
  expect(lookup("omnivoice").emotions).toEqual(["whispered"]);
  expect(lookup("omnivoice-voicetuttts").emotions).toEqual(["whispered"]);
  // MOSS-TTSD and MOSS-TTS v1.5: the line's direction in words.
  const ttsd = slot.toSpeechRequest(modelRow("moss_ttsd", "moss_ttsd"), {
    voice_id: "v",
    text: "Hi.",
    audio_prompt_path: "C:\\c.wav",
    delivery: { instruct: "Brisk and cheerful." },
  });
  expect(ttsd.options).toMatchObject({ instruct: "Brisk and cheerful." });
  expect(vmod.directedBy("moss_tts_v15")).toBe("words");
  // Not a setting where the app sets it (or, dots.tts, its Edit template's); Maya1's voice
  // description is one, at audio.cpp's default.
  for (const model of ["omnivoice", "moss_ttsd", "breeze_tts", "fireredtts3-fireredtts3base", "irodori_tts-irodorittsv3500m", "dots_tts-dotsttssoar"]) {
    expect(lookup(model).knobs.some((k) => k.key === "instruct" || k.key === "instruction"), model).toBe(false);
  }
  const description = "Warm female voice with an American accent and conversational pacing.";
  expect(lookup("maya1").knobs.find((k) => k.key === "instruct")).toMatchObject({ type: "text", default: description });
  // Required, so a line that leaves it unset sends audio.cpp's own; a set one wins.
  const maya = modelRow("maya1", "maya1");
  expect(slot.toSpeechRequest(maya, { voice_id: "maya1_model_default", text: "Hi." }).options.instruct).toBe(description);
  const set = slot.toSpeechRequest(maya, { voice_id: "maya1_model_default", text: "Hi.", delivery: { engine: { instruct: "An old sailor." } } });
  expect(set.options.instruct).toBe("An old sailor.");
});

test("a line's language goes only in a form the family lists; otherwise the model picks it", () => {
  // OmniVoice takes Arabic only as `arb`, `arz` … and its spec lists no codes: `ar` was refused in
  // the acceptance, so it goes as none — its spec's "omitted uses automatic language selection".
  expect(slot.generatedLanguage("omnivoice", "ar")).toBeUndefined();
  expect(slot.generatedLanguage("omnivoice", "en")).toBeUndefined();
  // A family that lists codes gets its own form; one it doesn't list goes as none.
  expect(slot.generatedLanguage("audio8_tts", "en-US")).toBe("en");
  expect(slot.generatedLanguage("audio8_tts", "ar")).toBeUndefined();
  expect(slot.generatedLanguage("index_tts2", "ar")).toBe("ar");
  // IndexTTS2 and MOSS's three read it only from the request's options: there, as their spec
  // takes it — IndexTTS2's code, MOSS's name (decided 2026-10-15, "Slice 2's acceptance findings"
  // 7). A top-level language reaches only the request's text (server_protocol.cpp:72-75).
  const clip = { voice_id: "v", text: "Hi.", audio_prompt_path: "C:\\c.wav", ref_text: "Hello." };
  const index = slot.toSpeechRequest(modelRow("index_tts2", "index_tts2-indextts25"), { ...clip, language: "es" });
  expect([index.language, index.options.language]).toEqual([undefined, "es"]);
  for (const [engineId, model, extra] of [
    ["moss_tts_v15", "moss_tts_v15", clip],
    ["moss_ttsd", "moss_ttsd", clip],
    ["moss_voicegen", "moss_voicegen", { voice_id: "v", text: "Hi.", delivery: { instruct: "A warm voice." } }],
  ]) {
    const row = modelRow(engineId, model);
    const en = slot.toSpeechRequest(row, { ...extra, language: "en-US" });
    expect([en.language, en.options.language], model).toEqual([undefined, "English"]);
    expect(slot.toSpeechRequest(row, { ...extra, language: "zh" }).options.language, model).toBe("Chinese");
    expect(slot.toSpeechRequest(row, { ...extra, language: "fr" }).options?.language, model).toBeUndefined();
  }
  // ZipVoice's `language` is eSpeak's language for the English words in a line, not the line's:
  // left at the top level, as before.
  const zip = slot.toSpeechRequest(modelRow("zipvoice", "zipvoice"), { ...clip, language: "en" });
  expect([zip.language, zip.options?.language]).toEqual(["en", undefined]);
  // Magpie lists Arabic as three regions: not guessed.
  expect(slot.listedLanguage("magpie_tts", "ar")).toBeUndefined();
  expect(slot.listedLanguage("magpie_tts", "ar-SA")).toBe("ar-SA");
  // A name where the default is one, a value where the spec lists values — as before.
  expect(slot.generatedLanguage("fireredtts3", "en")).toBe("English");
  const req = slot.toSpeechRequest(modelRow("omnivoice", "omnivoice-voicetuttts"), {
    voice_id: "v",
    text: "مرحبا",
    language: "ar",
    audio_prompt_path: "C:\\c.wav",
    ref_text: "Hello.",
  });
  expect(req.language).toBeUndefined();
});

test("a speech and a recognition model on one package share one copy on disk", () => {
  // LFM2.5-Audio's and FireRedAudio's recognisers name their speech model's own files — the same
  // repository, revision, path and SHA-256 — so the kit's models cache (one file per repository,
  // revision and path) holds one copy that both see. Deleting it is the kit's.
  const rows = new Map(runtimeModelRows().map((r) => [r.id, r]));
  const files = (id) => rows.get(id).files.map(({ slot: _slot, ...f }) => f);
  expect(files("lfm2_audio_asr-lfm2audioasr-q8")).toEqual(files("lfm2_audio-lfm2audiotts-q8"));
  expect(files("lfm2_audio_asr-lfm2audiojpasr-f16")).toEqual(files("lfm2_audio-lfm2audiojptts-f16"));
  expect(files("firered_audio_asr-q8")).toEqual(files("firered_audio-q8"));
  // A recogniser of its own has files of its own.
  const speechFiles = new Set([...rows.values()].filter((r) => r.kind === "tts").flatMap((r) => r.files.map((f) => `${f.repo}/${f.path}`)));
  expect(rows.get("canary_asr-q8").files.some((f) => speechFiles.has(`${f.repo}/${f.path}`))).toBe(false);
});
