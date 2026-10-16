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
import { lineModels } from "../src/line_takes.js";
import { checkDelivery, currentDelivery, modelSettings } from "../src/persona_render.js";
import { tmpPath } from "./helpers.js";

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

test("every generated model is one download per precision, a speech one with a capability row", () => {
  for (const [id, mod] of engines) {
    const ids = mod.VARIANTS.map((v) => v.id);
    expect(new Set(ids).size, id).toBe(ids.length);
    for (const v of mod.VARIANTS) {
      expect(v.sources[0].size_bytes, v.id).toBeGreaterThan(0);
      expect(v.audiocpp.file.endsWith(".gguf"), v.id).toBe(true);
      // A recogniser speaks nothing: no voice, no knobs, no row.
      if (mod.KIND === "stt") expect(lookup(v.id), v.id).toBeNull();
      else expect(lookup(v.id)?.engine_id, v.id).toBe(v.audiocpp.model);
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

test("IndexTTS gets the line's direction as emotion text, at audio.cpp's own strength", () => {
  // Round 3's tested mapping (test branch 1b5bff4; the narrowings review, E9).
  const row = rowOf("index_tts2", "index_tts2-indextts25-q8");
  const angry = slot.toSpeechRequest(row, line({ delivery: { emotion: "angry", instruct: "angry. scolding" } }));
  expect(angry.options).toEqual({ use_emotion_text: true, emotion_text: "angry. scolding" });
  const sigh = slot.toSpeechRequest(row, line({ delivery: { instruct: "with a long, weary sigh" } }));
  expect(sigh.options).toEqual({ use_emotion_text: true, emotion_text: "with a long, weary sigh" });
  expect(slot.toSpeechRequest(row, line()).options).toBeUndefined();
  expect(slot.toSpeechRequest(row, line({ delivery: { emotion: "sad" } })).options).toBeUndefined();
  // The model's own strength setting is sent when set.
  const set = slot.toSpeechRequest(row, line({ delivery: { instruct: "sad", engine: { emotion_alpha: 0.9 } } }));
  expect(set.options).toEqual({ use_emotion_text: true, emotion_text: "sad", emotion_alpha: 0.9 });
  expect(lookup("index_tts2-indextts25").notes).toContain(
    "Tested by JustVoice: Acted 12 of 21 lines like the book in a blind test, with directions in words; kept the cloned voice.",
  );
});

test("the line's text, the clip's words and the clip are never offered as settings", () => {
  // The narrowings review, E15: plan §5's list ("text, voice, clip …"), VoxCPM1's name for the
  // clip's words, and what a family's file hides.
  expect(generated.APP_OWNED_OPTIONS.has("text")).toBe(true);
  expect(lookup("voxcpm1").knobs.some((k) => k.key === "prompt_text")).toBe(false);
  for (const [model, key] of [
    ["moss_ttsd", "voice_samples"],
    ["fish_audio", "multi_reference_cond"],
    ["audio8_tts", "multi_reference_cond"],
    // Decided 2026-10-15: dots.tts's Edit-template texts and Irodori's "No ref".
    ["dots_tts-dotsttssoar", "source_text"],
    ["dots_tts-dotsttssoar", "target_text"],
    ["irodori_tts-irodorittsv3500m", "no_ref"],
  ]) {
    expect(lookup(model).knobs.some((k) => k.key === key), `${model} ${key}`).toBe(false);
  }
  // A value saved before it was hidden isn't sent.
  const req = slot.toSpeechRequest(rowOf("fish_audio", "fish_audio-q8"), line({ delivery: { engine: { multi_reference_cond: "C:\\clips\\other.wav", temperature: 0.7 } } }));
  expect(req.options).toEqual({ temperature: 0.7 });
  // An Irodori clone sends its clip, and never "No ref", even one saved on.
  const irodori = slot.toSpeechRequest(rowOf("irodori_tts", "irodori_tts-irodorittsv3500m-q8"), line({ delivery: { engine: { no_ref: true } } }));
  expect(irodori.voice_ref).toBe("C:/clips/hatter.wav");
  expect(irodori.options?.no_ref).toBeUndefined();
});

test("IndexTTS's note says it takes direction in words; the other directed families keep theirs", () => {
  // Decided 2026-10-15.
  expect(lookup("index_tts2-indextts25").notes).toContain("Takes a line's direction in words.");
  expect(lookup("cosyvoice3").notes).toContain("Takes a line's emotion and direction.");
});

test("a setting with no default has none: audio.cpp's own applies", () => {
  // The narrowings review, E12: MioTTS's presence_penalty has no default in its spec (Echo
  // TTS's max_duration_sec, the example until v0.9.2, lost its lower end there and isn't shown).
  const mio = lookup("miotts").knobs.find((k) => k.key === "presence_penalty");
  expect(mio).toMatchObject({ type: "number", min: 0, max: 1 });
  expect(mio.default).toBeNull();
  expect(lookup("echo_tts").knobs.find((k) => k.key === "num_inference_steps").default).toBe(40);
  expect(slot.toSpeechRequest(rowOf("echo_tts", "echo_tts-q8"), line()).options).toBeUndefined();
});

test("the clip's words field shows for a family whose spec lists no options", () => {
  // The narrowings review, E11: the field follows the request's rule.
  expect(lookup("omnivoice").supports_clone_prompt_text).toBe(true);
  expect(lookup("breeze_tts").supports_clone_prompt_text).toBe(true);
  expect(lookup("echo_tts").supports_clone_prompt_text).toBe(false);
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

test("a clone-only model refuses a voice with no clip by name", () => {
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
  // No commercial rights under the free licence, but its maker offers a separate one.
  const fish = generated.engineFacts(engines.get("fish_audio").module).licence;
  expect(fish).toMatchObject({ commercial: "Separate licence", table: "No" });
  expect(engines.get("fish_audio").module.TERMS.gates).toBe("download");
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
  // "multilingual" is audio.cpp's word too; "auto" (it detects) is no language (the narrowings
  // review, E10).
  expect(generated.speaks(generated.CATALOG.families.dots_tts)).toEqual({ languages: [], note: "multilingual" });
  const audio8 = generated.speaks(generated.CATALOG.families.audio8_tts);
  expect(audio8.languages).not.toContain("auto");
  expect(audio8.languages).toHaveLength(11);
  const omni = generated.generatedEngines().get("omnivoice").VARIANTS;
  expect(omni.every((v) => v.languages_note === "600+ languages")).toBe(true);
  // bf16 and f16 are both 16-bit: the names say which.
  const own = omni.filter((v) => v.audiocpp.model === "omnivoice");
  expect(own.map((v) => v.name)).toEqual(["OmniVoice", "OmniVoice (16-bit, bf16)", "OmniVoice (16-bit, f16)"]);
});

test("a family file keeps out a model that doesn't speak as listed", () => {
  // AuK is three downloads loaded as one folder; OuteTTS generated no audio in the download test
  // (decided 2026-10-12).
  for (const id of ["auk", "outetts"]) {
    expect(generated.generatedEngines().has(id), id).toBe(false);
    expect(lookup(id), id).toBeNull();
  }
});

test("VieNeu is listed, marked as not copying a voice from a clip yet", () => {
  // Decided 2026-10-13, the narrowings review K2: it needs a speaker embedding audio.cpp can't
  // make yet. Without its clone it speaks in its one voice — whether it does is checked in the
  // slice's acceptance.
  const vieneu = generated.generatedEngines().get("vieneu_v3_turbo");
  expect(vieneu.VARIANTS.every((v) => v.voice_cloning === false)).toBe(true);
  expect(lookup("vieneu_v3_turbo").supports_voice_cloning).toBe(false);
  expect(vieneu.STATIC_VOICES.map((v) => v.name)).toEqual(["VieNeu-TTS v3 Turbo (built-in)"]);
  const row = vieneu.VARIANTS[0];
  expect(() => slot.toSpeechRequest(row, line())).toThrow(/doesn't copy a voice from a clip/);
});

test("a model needs its estimate or its files, whichever is more; a hand-wired one, neither", () => {
  // decided 2026-10-12: the estimate is one per model, shared by its precisions.
  expect(generated.needOf(rowOf("omnivoice", "omnivoice-q8"))).toEqual({ gb: 10, by: "estimate" });
  expect(generated.needOf(rowOf("firered_audio", "firered_audio-orig"))).toEqual({ gb: 23.3, by: "files" });
  expect(generated.needOf(rowOf("moss_ttsd", "moss_ttsd-q8"))).toEqual({ gb: 12.1, by: "files" });
  const kokoro = manager.discoverEngines().get("kokoro").module.VARIANTS[0];
  expect(generated.needOf(kokoro)).toBeNull();
});

test("the clip's words reach a spec that lists no options, as they reach one that lists them", () => {
  // OmniVoice's spec lists no request options, and its clone needs the words (decided 2026-10-12).
  const omni = slot.toSpeechRequest(rowOf("omnivoice", "omnivoice-q8"), line({ ref_text: "Why is a raven like a writing desk?" }));
  expect(omni.reference_text).toBe("Why is a raven like a writing desk?");
  // Echo TTS lists its options, and not the words: they don't go.
  const echo = slot.toSpeechRequest(rowOf("echo_tts", "echo_tts-q8"), line({ ref_text: "Why is a raven like a writing desk?" }));
  expect(echo.reference_text).toBeUndefined();
});

test("a companion a family file names downloads with the model and reaches it as a session option", () => {
  // MioTTS decodes with MioCodec, given as miotts.codec_model_path; the spec doesn't list it.
  const engine = manager.discoverEngines().get("miotts");
  const row = engine.module.VARIANTS.find((v) => v.id === "miotts-q8");
  const codec = "MioCodec-25Hz-44.1kHz-v2-GGUF/miocodec-25hz-44khz-v2-q8_0.gguf";
  expect(row.sources).toHaveLength(1); // the same repository and revision: one download row
  expect(row.sources[0].files).toContain(codec);
  vi.spyOn(slot, "_dataDir").mockReturnValue(tmpPath());
  const [entry] = slot._entriesFor(engine, row);
  const opt = Object.fromEntries(entry.sessionOptions);
  expect(String(opt["miotts.codec_model_path"]).replaceAll("\\", "/")).toMatch(new RegExp(`miotts-q8/${codec}$`));
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

test("a setting saved under a name audio.cpp has since renamed reaches the model under its new name", () => {
  // audio.cpp v0.9.2 renamed IndexTTS2's duration_factor and ZipVoice's t_shift (the family
  // files' OLD_OPTION_NAMES; docs/plans/2026-10-13-adopt-everything-audiocpp.md §2, §4).
  const index = slot.toSpeechRequest(rowOf("index_tts2", "index_tts2-indextts25-q8"), line({ delivery: { engine: { duration_factor: 1.3 } } }));
  expect(index.options).toEqual({ duration_scale: 1.3 });
  const zip = slot.toSpeechRequest(rowOf("zipvoice", "zipvoice-orig"), line({ delivery: { engine: { t_shift: 0.7 } } }));
  expect(zip.options).toEqual({ shift: 0.7 });
  // Both set: the new name's value wins.
  expect(generated.currentOptionNames("zipvoice", { t_shift: 0.7, shift: 0.4 })).toEqual({ shift: 0.4 });
  // The setting shows under its new name, with audio.cpp's control for the old one.
  expect(lookup("zipvoice").knobs.find((k) => k.key === "shift")).toMatchObject({ type: "number", min: 0.05, max: 1 });
  expect(lookup("index_tts2-indextts25").knobs.find((k) => k.key === "duration_scale")).toMatchObject({ min: 0.5, max: 2 });
});

test("a persona's and a line's settings under an old name read under the new one; a hand-wired model's don't", () => {
  const delivery = {
    models: {
      zipvoice: { knobs: { t_shift: 0.7, guidance_scale: 1.5 } },
      // Chatterbox is hand-wired: its own mapping reads s3gen_cfg_rate (the plan's slice 4 moves it).
      "chatterbox-multilingual": { knobs: { s3gen_cfg_rate: 0.6 } },
    },
  };
  const shown = currentDelivery(delivery);
  expect(shown.models.zipvoice.knobs).toEqual({ guidance_scale: 1.5, shift: 0.7 });
  expect(shown.models["chatterbox-multilingual"].knobs).toEqual({ s3gen_cfg_rate: 0.6 });
  expect(checkDelivery(delivery)).toEqual([]);
  const [settings] = modelSettings({ default_delivery: delivery }, "zipvoice", { knobs: { t_shift: 0.9 } });
  // The line's value wins over the persona's (numbers come as PyFloats).
  expect(Object.keys(settings.engine).sort()).toEqual(["guidance_scale", "shift"]);
  expect(Number(settings.engine.shift)).toBe(0.9);
  expect(Number(settings.engine.guidance_scale)).toBe(1.5);
  const block = { metadata_json: JSON.stringify({ line_models: { zipvoice: { knobs: { t_shift: 0.8 } } } }) };
  const lineKnobs = lineModels(block).zipvoice.knobs;
  expect(Object.keys(lineKnobs)).toEqual(["shift"]);
  expect(Number(lineKnobs.shift)).toBe(0.8);
});

test("a number audio.cpp gives no range is a number box; a setting the spec doesn't take is refused", () => {
  // audio.cpp v0.9.2 dropped ZipVoice feat_scale's range: a number box, open at both ends (the
  // adoption plan's slice 3, E2) — a value saved before it was shown still goes.
  expect(lookup("zipvoice").knobs.find((k) => k.key === "feat_scale")).toMatchObject({ type: "number", box: true, min: null, max: null });
  expect(checkDelivery({ models: { zipvoice: { knobs: { feat_scale: 0.2 } } } })).toEqual([]);
  expect(slot.toSpeechRequest(rowOf("zipvoice", "zipvoice-orig"), line({ delivery: { engine: { feat_scale: 0.2 } } })).options).toEqual({ feat_scale: 0.2 });
  expect(checkDelivery({ models: { zipvoice: { knobs: { not_an_option: 1 } } } })).toEqual(["ZipVoice has no not_an_option setting"]);
});
