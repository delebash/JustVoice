// SPDX-License-Identifier: MIT
// What the adoption plan's slice 4 gives the seven engines described by our own files
// (docs/plans/2026-10-13-adopt-everything-audiocpp.md §3, §5): Turbo's and Nano's own voice (F4),
// what audio.cpp's files give them (F10), the packages it offers beside ours (E6/E14/F5, QwenCleo),
// and audio.cpp's memory estimate (the build's answer 3). What stays the same is
// seven_engines_unchanged.test.js.
import { afterEach, expect, test, vi } from "vitest";
import "./engines_helpers.js";
import * as generated from "../src/engines/audiocpp/generated.js";
import * as slot from "../src/engines/audiocpp/slot.js";
import { lookup } from "../src/engines/capability_details.js";
import { discoverEngines } from "../src/engines/manager.js";
import { modelsFor } from "../src/engines/model_catalog.js";
import * as vmod from "../src/voice_model.js";

afterEach(() => vi.restoreAllMocks());

const engine = (id) => discoverEngines().get(id).module;
const row = (engineId, id) => engine(engineId).VARIANTS.find((v) => v.id === id);

test("Turbo and Nano each list their own voice, Not known, and speak it with no clip (F4)", () => {
  // Decided 2026-10-15 (§7 question 6): "Turbo (built-in)" and "Nano (built-in)", gender Not known.
  const voices = engine("chatterbox").STATIC_VOICES;
  expect(voices.find((v) => v.model === "chatterbox-turbo")).toEqual({
    id: "chatterbox-turbo_model_default",
    name: "Turbo (built-in)",
    language: "en",
    gender: "",
    model: "chatterbox-turbo",
  });
  expect(voices.find((v) => v.model === "chatterbox-nano").name).toBe("Nano (built-in)");
  for (const id of ["chatterbox-turbo-q8", "chatterbox-turbo-f16", "chatterbox-nano-q8", "chatterbox-nano-f16"]) {
    expect(row("chatterbox", id).preset_voices, id).toBe(1);
  }
  // Its voice goes as no voice — audio.cpp speaks the model's own, as its warm-up always did.
  const req = slot.toSpeechRequest(row("chatterbox", "chatterbox-nano-q8"), {
    voice_id: "chatterbox-nano_model_default",
    text: "[laugh] Two days wrong!",
    seed: 42,
    delivery: { temperature: 0.7, engine: { top_k: 500 } },
  });
  expect(req).toEqual({ model: "chatterbox-nano-q8", input: "[laugh] Two days wrong!", seed: 42, options: { top_k: 500, temperature: 0.7 } });
  // Another model's voice is no voice of Turbo's: refused as before.
  expect(() => slot.toSpeechRequest(row("chatterbox", "chatterbox-turbo-q8"), { voice_id: "af_heart", text: "Hi.", seed: 1 })).toThrow(
    /speaks only cloned voices/,
  );
  // The persona page and every voice list read the voice's model from it.
  expect(vmod.modelForPreset("chatterbox", voices[0])).toBe("chatterbox-turbo");
});

test("audio.cpp's own Turbo package is offered beside ours: its own voice, Turbo's settings, no cloning (E6/E14/F5)", () => {
  const upstream = row("chatterbox", "chatterbox-chatterboxturbo-q8");
  expect(upstream.sources[0]).toMatchObject({ hf_repo: "audio-cpp/audio.cpp-gguf", files: ["Chatterbox-Turbo-GGUF/chatterbox-turbo-q8_0.gguf"] });
  expect([upstream.name, upstream.voice_cloning, upstream.preset_voices, upstream.min_vram_gb]).toEqual(["Chatterbox Turbo (tts)", false, 1, 4]);
  const cap = lookup(upstream.id);
  expect(cap.display_name).toBe("Chatterbox Turbo (tts)");
  expect(cap.supports_voice_cloning).toBe(false);
  expect(cap.knobs.map((k) => k.key)).toEqual(lookup("chatterbox-turbo").knobs.map((k) => k.key));
  expect(cap.inline_tags).toEqual(lookup("chatterbox-turbo").inline_tags);
  expect(cap.notes[0]).toBe("English only.");
  // Our Turbo's clones still load our Turbo, never this one (the clone pickers' first build).
  expect(engine("chatterbox").VARIANTS.find((v) => v.id.startsWith("chatterbox-turbo-")).id).toBe("chatterbox-turbo-q8");
  expect(() => slot.toSpeechRequest(upstream, { voice_id: "x", text: "Hi.", seed: 1, audio_prompt_path: "C:/v.wav" })).toThrow(
    /doesn't copy a voice from a clip/,
  );
  expect(slot.toSpeechRequest(upstream, { voice_id: "chatterbox-chatterboxturbo_model_default", text: "Hi.", seed: 1 })).toEqual({
    model: "chatterbox-chatterboxturbo-q8",
    input: "Hi.",
    seed: 1,
  });
});

test("the original precisions of Qwen3-TTS Base 1.7B and VoxCPM2, audio.cpp's own packages (E14/F5)", () => {
  const base = row("qwen3", "qwen3-base-1.7b-orig");
  expect([base.name, base.voice_cloning, base.audiocpp.clone, base.split_chars]).toEqual(["Qwen3-TTS Base 1.7B (cloning, original precision)", true, true, 200]);
  expect(base.description).toBe(
    "Clones a voice from a 3–10 second clip; no preset speakers; written direction is dropped. Original precision weights — a larger download that needs more memory.",
  );
  expect(lookup(base.id).engine_id).toBe("qwen3-base");
  const vox = row("voxcpm2", "voxcpm2-orig");
  expect(vox.name).toBe("VoxCPM2 (original precision)");
  expect(vox.sources[0].files).toEqual(["VoxCPM2-GGUF/voxcpm2-orig.gguf"]);
  // Never the default; the list still opens on the 8-bit rows.
  expect(engine("qwen3").DEFAULT_VARIANT_ID).toBe("qwen3-cv-1.7b-q8");
  expect(engine("qwen3").VARIANTS.at(-1).id).toBe("qwen3-base-1.7b-orig");
});

test("QwenCleo-ASR: its package as audio.cpp's catalog gives it, its languages in our notes, the aligner with it", () => {
  const q8 = row("asr", "qwencleo-asr-q8");
  expect(q8.sources).toEqual([
    { hf_repo: "mohammedaly22/QwenCleo-ASR-GGUF", revision: "6884dc2054684a2bb5e70ac8074e43f9c9fcd78a", size_bytes: 2_477_476_256, files: ["qwencleo-asr-q8_0.gguf"] },
    {
      hf_repo: "audio-cpp/audio.cpp-gguf",
      revision: "f861648c0c1f4da9f18e9a0ce5e217b0679bb2f5",
      size_bytes: 1_129_966_496,
      files: ["Qwen3-ForcedAligner-0.6B-GGUF/qwen3-forced-aligner-0.6b-q8_0.gguf"],
    },
  ]);
  expect(q8.languages).toEqual(["ar-EG", "en"]);
  expect(q8.audiocpp.companions).toEqual([
    { role: "aligner", family: "qwen3_forced_aligner", task: "align", file: "Qwen3-ForcedAligner-0.6B-GGUF/qwen3-forced-aligner-0.6b-q8_0.gguf" },
  ]);
  expect(row("asr", "qwencleo-asr-f16").audiocpp.companions[0].file).toBe("Qwen3-ForcedAligner-0.6B-GGUF/qwen3-forced-aligner-0.6b-f16.gguf");
  expect(q8.name).toBe("QwenCleo-ASR Egyptian Arabic");
  // A recogniser has no capability row (it walked to Qwen3-TTS's before).
  expect(lookup("qwen3-asr-1.7b-q8")).toBeNull();
  expect(lookup(q8.id)).toBeNull();
  // 1.7B stays the default.
  expect(engine("asr").DEFAULT_VARIANT_ID).toBe("qwen3-asr-1.7b-q8");
});

test("audio.cpp's memory estimate for the seven, as for every model (the build's answer 3)", () => {
  // "slice 4 gives those models audio.cpp's memory estimate" — or their files, where those are more.
  const kokoro = modelsFor("kokoro").find((v) => v.id === "kokoro-82m-q8");
  expect([kokoro.min_vram_gb, kokoro.need_gb]).toEqual([1, 1]);
  const chatterbox = modelsFor("chatterbox").find((v) => v.id === "chatterbox-multilingual-v2-q8");
  expect([chatterbox.min_vram_gb, chatterbox.need_gb]).toEqual([12, 12]);
  // Our own conversions have no estimate in the catalog: their files are the number.
  const cv06 = modelsFor("qwen3").find((v) => v.id === "qwen3-cv-0.6b-q8");
  expect([cv06.min_vram_gb, cv06.need_gb]).toEqual([null, 1.6]);
  const qwen = modelsFor("asr").find((v) => v.id === "qwen3-asr-1.7b-q8");
  expect([qwen.min_vram_gb, qwen.need_gb]).toEqual([6, 6]);
});

test("voices, languages and piece budgets read from audio.cpp's files (F10)", () => {
  // The voices: the spec's, in its order, under our ids — Kitten's Leo and Pocket's alba its defaults.
  expect(row("kitten", "kitten-mini-0.8").audiocpp.default_voice).toBe("kitten_leo");
  expect(row("pocket", "pocket-de-q8").audiocpp.default_voice).toBe("pocket_alba");
  expect(row("kokoro", "kokoro-82m-q8").audiocpp.default_voice).toBe("af_heart");
  expect(engine("qwen3").STATIC_VOICES.map((v) => v.id)).toEqual(["Aiden", "Dylan", "Eric", "Ono_Anna", "Ryan", "Serena", "Sohee", "Uncle_Fu", "Vivian"]);
  // audio.cpp's own piece budget is each spec's text_chunk_size: copied here by hand before.
  expect(["chatterbox", "chatterbox_turbo", "kokoro_tts", "kitten_tts"].map(slot.familyBudget)).toEqual([128, 128, 240, 400]);
  // Kokoro's longest piece is that budget too.
  expect(row("kokoro", "kokoro-82m-q8").split_chars).toBe(240);
  // Every package audio.cpp's own UI offers for the seven's models (installChoices), and every other
  // GGUF package of their entries, is offered where its files are at the pinned revision (audio.cpp's
  // own Turbo f16 isn't); one that isn't is named: Pocket TTS French (TASKS, slice 4's gaps).
  const offered = new Set([...generated.generatedEngines().values()].flatMap((m) => [...m.VARIANTS, ...(m.PENDING_VARIANTS || [])].map((v) => v.audiocpp.package)));
  const missing = [];
  for (const family of generated.OWN_FAMILIES) {
    const fam = generated.CATALOG.families[family];
    const usable = (id) => {
      const p = fam.packages.find((x) => x.id === id);
      return p?.format === "gguf" && !p.source.files.some((f) => f.missing);
    };
    for (const e of fam.entries.filter((x) => x.workflow === "tts" || x.workflow === "design" || x.workflow === "asr")) {
      for (const id of [...(e.install_packages || []).map((c) => c.id), ...e.packages]) if (usable(id) && !offered.has(id)) missing.push(id);
    }
  }
  expect([...new Set(missing)].sort()).toEqual(["pocket_tts_french_bf16", "pocket_tts_french_q8_0"]);
});
