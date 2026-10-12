// SPDX-License-Identifier: MIT
// Every other speech model audio.cpp has, built from its own files (engines/audiocpp/
// generated.js; docs/plans/2026-10-11-audiocpp-engine-catalog.md slice 2): the generated
// engines join the hand-wired ones, each model has a capability row, a line's direction reaches
// each family as its file says, the request keeps to the spec, a licence that isn't "Yes" gates
// the first download, and a directed VoxCPM2 line goes without the clip's words.
import { afterEach, expect, test, vi } from "vitest";
import "./engines_helpers.js";
import * as generated from "../src/engines/audiocpp/generated.js";
import * as slot from "../src/engines/audiocpp/slot.js";
import { lookup } from "../src/engines/capability_details.js";
import * as manager from "../src/engines/manager.js";

afterEach(() => vi.restoreAllMocks());

const engines = generated.generatedEngines();
const rowOf = (engineId, variantId) => engines.get(engineId).VARIANTS.find((v) => v.id === variantId);
const line = (extra = {}) => ({ voice_id: "v", text: "Two days wrong!", audio_prompt_path: "C:\\clips\\hatter.wav", ...extra });

test("generated engines leave the hand-wired families to their own manifests", () => {
  expect(engines.size).toBeGreaterThan(0);
  for (const fam of generated.HAND_WIRED_FAMILIES) expect(engines.has(fam), fam).toBe(false);
  for (const id of ["cosyvoice3", "index_tts2", "breeze_tts", "higgs_audio_tts", "fish_audio"]) expect(engines.has(id), id).toBe(true);
  const found = manager.discoverEngines();
  expect(found.has("cosyvoice3")).toBe(true);
  expect(found.has("kokoro")).toBe(true);
});

test("every generated model is one download per precision, with a capability row", () => {
  for (const [id, mod] of engines) {
    const ids = mod.VARIANTS.map((v) => v.id);
    expect(new Set(ids).size, id).toBe(ids.length);
    for (const v of mod.VARIANTS) {
      expect(v.sources[0].size_bytes, v.id).toBeGreaterThan(0);
      expect(v.audiocpp.file.endsWith(".gguf"), v.id).toBe(true);
      expect(lookup(v.id)?.engine_id, v.id).toBe(v.audiocpp.model);
    }
  }
  expect(lookup("cosyvoice3").display_name).toBe("CosyVoice3");
  expect(lookup("index_tts2-indextts25").display_name).toBe("IndexTTS2.5");
});

test("a model whose family file says nothing of direction can't be directed and isn't tested", () => {
  const row = lookup("audio8_tts");
  expect(row.supports_instruct_freeform).toBe(false);
  expect(row.notes).toContain("Not tested by JustVoice yet.");
});

test("CosyVoice3 gets the authors' sentence for an emotion, and its plain templates otherwise", () => {
  const row = rowOf("cosyvoice3", "cosyvoice3-q8");
  const sad = slot.toSpeechRequest(row, line({ ref_text: "Why is a raven like a writing desk?", delivery: { emotion: "sad", instruct: "sad. sadly and mournfully" } }));
  expect(sad.options).toMatchObject({ template_name: "instruct", instruction: "请非常伤心地说一句话。" });
  expect(sad.reference_text).toBeUndefined();
  expect(sad.voice_ref).toBe("C:/clips/hatter.wav");
  const plain = slot.toSpeechRequest(row, line({ ref_text: "Why is a raven like a writing desk?" }));
  expect(plain.options.template_name).toBe("zero_shot");
  expect(plain.reference_text).toBe("Why is a raven like a writing desk?");
  // A direction with no documented sentence stays plain (free prose came back plain, round 3).
  const smug = slot.toSpeechRequest(row, line({ delivery: { instruct: "triumphantly, smug and gleeful" } }));
  expect(smug.options.template_name).toBe("cross_lingual");
  expect(smug.language).toBeUndefined(); // CosyVoice3 lists no language option
});

test("IndexTTS gets an emotion vector at 0.65, and words when the emotion has none", () => {
  const row = rowOf("index_tts2", "index_tts2-indextts25-q8");
  const angry = slot.toSpeechRequest(row, line({ delivery: { emotion: "angry", instruct: "angry. scolding" } }));
  expect(angry.options).toEqual({ emotion_vector: [0, 0.7, 0, 0, 0, 0, 0, 0], emotion_alpha: 0.65 });
  const sigh = slot.toSpeechRequest(row, line({ delivery: { instruct: "with a long, weary sigh" } }));
  expect(sigh.options).toEqual({ use_emotion_text: true, emotion_text: "with a long, weary sigh", emotion_alpha: 0.65 });
  expect(slot.toSpeechRequest(row, line()).options).toBeUndefined();
  // The model's own setting wins over the direction's default strength.
  const set = slot.toSpeechRequest(row, line({ delivery: { emotion: "sad", instruct: "sad", engine: { emotion_alpha: 0.9 } } }));
  expect(set.options.emotion_alpha).toBe(0.9);
});

test("a generated model's settings are its spec's typed options, minus what the app sets", () => {
  const index = lookup("index_tts2-indextts25").knobs;
  expect(index.find((k) => k.key === "use_random_emotion")).toMatchObject({ type: "switch", default: false });
  expect(index.find((k) => k.key === "emotion_alpha")).toMatchObject({ type: "number", min: 0, max: 1 });
  for (const owned of ["emotion_text", "emotion_vector", "use_emotion_text", "instruction", "reference_text", "language"]) {
    expect(index.some((k) => k.key === owned), owned).toBe(false);
  }
  const breeze = lookup("breeze_tts").knobs.map((k) => k.key);
  expect(breeze).toContain("guidance_scale");
  expect(breeze.some((k) => k.startsWith("stream") || k.startsWith("text_chunk"))).toBe(false);
});

test("Higgs takes only its real tags; Fish a tag and a description", () => {
  const higgs = slot.toSpeechRequest(rowOf("higgs_audio_tts", "higgs_audio_tts-q8"), line({ delivery: { emotion: "whispered", instruct: "whispered. quietly" } }));
  expect(higgs.input).toBe("<|style:whispering|>Two days wrong!");
  const sarcastic = slot.toSpeechRequest(rowOf("higgs_audio_tts", "higgs_audio_tts-q8"), line({ delivery: { emotion: "sarcastic", instruct: "sarcastic" } }));
  expect(sarcastic.input).toBe("Two days wrong!"); // no Higgs tag for sarcasm — never read aloud
  const fish = slot.toSpeechRequest(rowOf("fish_audio", "fish_audio-q8"), line({ delivery: { emotion: "sad", instruct: "with a long [weary] sigh" } }));
  expect(fish.input).toBe("[sad][with a long weary sigh]Two days wrong!");
});

test("Breeze takes the direction as its instruction, with guidance 4 unless the settings say otherwise", () => {
  const row = rowOf("breeze_tts", "breeze_tts-q8");
  const told = slot.toSpeechRequest(row, line({ ref_text: "Hello.", delivery: { instruct: "Speak slowly and gravely." } }));
  expect(told.options).toMatchObject({ instruction: "Speak slowly and gravely.", guidance_scale: 4 });
  expect(told.reference_text).toBe("Hello.");
  const set = slot.toSpeechRequest(row, line({ delivery: { instruct: "Slowly.", engine: { guidance_scale: 2.5 } } }));
  expect(set.options.guidance_scale).toBe(2.5);
  const plain = slot.toSpeechRequest(row, line());
  expect(plain.options?.guidance_scale).toBeUndefined();
});

test("a listing family gets only the options its spec lists, typed and in range", () => {
  const row = rowOf("breeze_tts", "breeze_tts-q8");
  const req = slot.toSpeechRequest(row, line({ delivery: { engine: { temperature: "0.7", not_an_option: 3, seed: 9, instruction: "x" } } }));
  expect(req.options).toEqual({ temperature: 0.7 });
});

test("a generated model refuses a voice with no clip by name", () => {
  expect(() => slot.toSpeechRequest(rowOf("cosyvoice3", "cosyvoice3-q8"), { voice_id: "v", text: "Hi." })).toThrow(/speaks only cloned voices/);
});

test("the gate follows our reading of the licence, and says it in plain words", () => {
  const engines = manager.discoverEngines();
  // audio.cpp says No; its Creator Use Grant lets a user sell their own audiobooks with credit.
  const higgs = engines.get("higgs_audio_tts").module.TERMS;
  expect(higgs.gates).toBe("download");
  expect(higgs.text).toContain("credit Boson AI");
  expect(higgs.reading).toContain('licence table says "No"');
  // audio.cpp says Yes; the authors keep cloning to academic research: gated.
  expect(engines.get("fireredtts3").module.TERMS.gates).toBe("download");
  // Not in audio.cpp's table; Apache-2.0 at its source: no gate.
  expect(engines.get("moss_ttsd").module.TERMS).toBeUndefined();
});

test("every engine's facts: our licence word beside audio.cpp's, its status, tested, best for", () => {
  const engines = manager.discoverEngines();
  const higgs = generated.engineFacts(engines.get("higgs_audio_tts").module);
  expect(higgs.licence).toMatchObject({ commercial: "Conditional", table: "No" });
  expect(higgs.catalog_status).toBe("supported");
  expect(higgs.tested).toBeNull();
  // A hand-wired engine reads its families' curated file — Chatterbox runs two, one carries it.
  const chatterbox = generated.engineFacts(engines.get("chatterbox").module);
  expect(chatterbox.licence).toMatchObject({ name: "MIT", commercial: "Yes", table: "Yes" });
  expect(chatterbox.tested.note).toBe("Wired by hand and measured by JustVoice.");
  expect(chatterbox.best_for.length).toBe(2);
  for (const [id, m] of engines) {
    if (m.module.GENERATED || m.module.VARIANTS?.some((v) => v.audiocpp)) {
      expect(generated.engineFacts(m.module).licence, id).not.toBeNull();
    }
  }
});

test("a language list that describes is shown as audio.cpp words it, never counted as one language", () => {
  expect(generated.speaks(generated.CATALOG.families.higgs_audio_tts)).toEqual({ languages: [], note: "100+ languages" });
  expect(generated.speaks(generated.CATALOG.families.cosyvoice3).note).toBe("");
  const omni = generated.generatedEngines().get("omnivoice").VARIANTS;
  expect(omni.every((v) => v.languages_note === "600+ languages")).toBe(true);
  // bf16 and f16 are both 16-bit: the names say which.
  expect(omni.map((v) => v.name)).toEqual(["OmniVoice", "OmniVoice (16-bit, bf16)", "OmniVoice (16-bit, f16)"]);
});

test("a licence that isn't Yes gates the first download until accepted", () => {
  const index = manager.discoverEngines().get("index_tts2");
  const cosy = manager.discoverEngines().get("cosyvoice3");
  expect(index.module.TERMS.gates).toBe("download");
  expect(cosy.module.TERMS).toBeUndefined(); // Apache-2.0, commercial use Yes
  vi.spyOn(slot, "termsAccepted").mockReturnValue(false);
  expect(() => manager.requireDownloadTerms(index)).toThrow(manager.TermsRequired);
  expect(() => manager.requireDownloadTerms(cosy)).not.toThrow();
  vi.spyOn(slot, "termsAccepted").mockReturnValue(true);
  expect(() => manager.requireDownloadTerms(index)).not.toThrow();
});

test("a directed VoxCPM2 line goes without the clip's words; a plain one keeps them", () => {
  const vox = { id: "voxcpm2-q8", name: "VoxCPM2", audiocpp: { family: "voxcpm2", task: "tts", file: "v.gguf" } };
  const directed = slot.toSpeechRequest(vox, line({ ref_text: "Hello there.", delivery: { instruct: "sighing" } }));
  expect(directed.reference_text).toBeUndefined();
  expect(directed.input.startsWith("(sighing)")).toBe(true);
  const plain = slot.toSpeechRequest(vox, line({ ref_text: "Hello there." }));
  expect(plain.reference_text).toBe("Hello there.");
});

test("the direction kinds apply as data", () => {
  expect(generated.applyDirection(null, { emotion: "sad", words: "x" }).directed).toBe(false);
  expect(generated.applyDirection({ kind: "prefix", tags: {} }, { emotion: "neutral", words: "" }).directed).toBe(false);
  expect(generated.coerceOption({ type: "int", min: 1, max: 10 }, "42")).toBe(10);
  expect(generated.coerceOption({ type: "enum", values: ["a"] }, "b")).toBeUndefined();
});
