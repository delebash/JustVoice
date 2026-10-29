// SPDX-License-Identifier: MIT
// What the adoption plan's slice 4 gives the seven engines described by our own files
// (docs/plans/2026-10-13-adopt-everything-audiocpp.md §3, §5): Turbo's and Nano's own voice (F4),
// what audio.cpp's files give them (F10), the packages it offers beside ours (E6/E14/F5, QwenCleo),
// and audio.cpp's memory estimate (the build's answer 3). What stays the same is
// seven_engines_unchanged.test.js. Since round E (docs/plans/2026-10-29-round-e-onto-the-kit.md)
// the kit's audio.cpp runtime downloads and registers each model from its kit row (engines/
// audiocpp/kit_models.js) and runs our warm-up (slot.js `warmModel`, its warm hook): what is pinned
// here is what our rows and our warm-up give it.
import { afterEach, expect, test, vi } from "vitest";
import "./engines_helpers.js";
import * as generated from "../src/engines/audiocpp/generated.js";
import { runtimeModelRows } from "../src/engines/audiocpp/kit_models.js";
import * as slot from "../src/engines/audiocpp/slot.js";
import { lookup } from "../src/engines/capability_details.js";
import { discoverEngines, modelsFor } from "../src/engines/model_catalog.js";
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
  // Another model's voice is no voice of Turbo's: refused, naming what it speaks (TASKS "Slice 4's gaps" 5).
  expect(() => slot.toSpeechRequest(row("chatterbox", "chatterbox-turbo-q8"), { voice_id: "af_heart", text: "Hi.", seed: 1 })).toThrow(
    "Chatterbox Turbo (350M, English) speaks only a cloned voice or its own built-in one — this voice has no reference clip",
  );
  // The persona page and every voice list read the voice's model from it.
  expect(vmod.modelForPreset("chatterbox", voices[0])).toBe("chatterbox-turbo");
});

test("audio.cpp's own Turbo package is offered beside ours: its own voice, Turbo's settings, no cloning (E6/E14/F5)", () => {
  const upstream = row("chatterbox", "chatterbox-chatterboxturbo-q8");
  expect(upstream.sources[0]).toMatchObject({ hf_repo: "audio-cpp/audio.cpp-gguf", files: ["Chatterbox-Turbo-GGUF/chatterbox-turbo-q8_0.gguf"] });
  expect([upstream.name, upstream.voice_cloning, upstream.preset_voices, upstream.min_vram_gb]).toEqual(["Chatterbox Turbo (built-in voice only)", false, 1, 4]);
  const cap = lookup(upstream.id);
  expect(cap.display_name).toBe("Chatterbox Turbo (built-in voice only)");
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

test("QwenCleo-ASR's row names each file where its download puts it: each repository its own", () => {
  // Slice 4's GPU half (2026-10-16): "model path does not exist: …\qwencleo-asr-q8\qwencleo-asr-q8_0.gguf"
  // — its model and Qwen3's aligner come from two repositories, and the registration left the
  // model's out. The kit downloads and registers each file by its row's repository, revision and
  // path, in its slot: the model "model", the aligner "aligner" (round E).
  const rows = runtimeModelRows();
  const files = (id) => rows.find((r) => r.id === id).files.map((f) => [f.slot, f.repo, f.revision, f.path]);
  expect(files("qwencleo-asr-q8")).toEqual([
    ["model", "mohammedaly22/QwenCleo-ASR-GGUF", "6884dc2054684a2bb5e70ac8074e43f9c9fcd78a", "qwencleo-asr-q8_0.gguf"],
    ["aligner", "audio-cpp/audio.cpp-gguf", "f861648c0c1f4da9f18e9a0ce5e217b0679bb2f5", "Qwen3-ForcedAligner-0.6B-GGUF/qwen3-forced-aligner-0.6b-q8_0.gguf"],
  ]);
  // Qwen3-ASR's, one repository, each at its own path.
  expect(files("qwen3-asr-1.7b-q8")).toEqual([
    ["model", "audio-cpp/audio.cpp-gguf", "f861648c0c1f4da9f18e9a0ce5e217b0679bb2f5", "Qwen3-ASR-1.7B-GGUF/qwen3-asr-1.7b-q8_0.gguf"],
    ["aligner", "audio-cpp/audio.cpp-gguf", "f861648c0c1f4da9f18e9a0ce5e217b0679bb2f5", "Qwen3-ForcedAligner-0.6B-GGUF/qwen3-forced-aligner-0.6b-q8_0.gguf"],
  ]);
  // Each registers the aligner from its slot, on the first alignment (round E, G11).
  for (const id of ["qwencleo-asr-q8", "qwencleo-asr-f16", "qwen3-asr-1.7b-q8", "qwen3-asr-0.6b-f16"]) {
    const r = rows.find((x) => x.id === id);
    expect(r.spec.companions, id).toEqual([{ role: "aligner", family: "qwen3_forced_aligner", task: "align", slot: "aligner", onDemand: true }]);
    expect(r.files.map((f) => f.slot), id).toEqual(["model", "aligner"]);
  }
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

test("KittenTTS offers a seed like every engine, and its request sends it (TASKS \"Slice 5's findings\" 1)", () => {
  // The fork's 7ec5c652 (jv bcc5dfbb): KittenTTS repeats its take on the graphics card and the CPU.
  const seedOf = (model) => lookup(model).knobs.find((k) => k.key === "seed");
  expect(seedOf("kitten")).toEqual({ ...seedOf("kokoro"), max: generated.requestOptionsOf("kitten_tts").get("seed")?.max ?? 2_000_000_000 });
  expect(lookup("kitten").notes).toContain("The same seed gives the same audio.");
  // Every model of the seven that speaks offers one now.
  for (const model of ["kokoro", "kitten", "pocket", "qwen3-cv", "qwen3-base", "qwen3-vd", "chatterbox-multilingual", "chatterbox-turbo", "chatterbox-nano", "voxcpm2"]) {
    expect(seedOf(model), model).toBeTruthy();
  }
  const kitten = row("kitten", "kitten-mini-0.8");
  expect(slot.toSpeechRequest(kitten, { voice_id: "kitten_leo", text: "Hi.", seed: 42, delivery: { speed: 1.1 } })).toEqual({
    model: "kitten-mini-0.8",
    input: "Hi.",
    seed: 42,
    voice: "Leo",
    speed: 1.1,
  });
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
  // own Turbo f16 isn't) — Pocket TTS French too, clone-only (TASKS "Slice 4's gaps" 2).
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
  expect([...new Set(missing)].sort()).toEqual([]);
});

test("Pocket TTS French clones only: none of our presets, its own non-commercial one left out (TASKS \"Slice 4's gaps\" 2)", () => {
  const fr = row("pocket", "pocket-fr-q8");
  expect([fr.name, fr.voice_cloning, fr.preset_voices, fr.languages]).toEqual(["Pocket TTS French", true, 0, ["fr"]]);
  expect(fr.description).toBe("Clones a voice from a short clip, in French. 8-bit weights.");
  expect(() => slot.toSpeechRequest(fr, { voice_id: "pocket_alba", text: "Bonjour.", language: "fr", seed: 1 })).toThrow(
    "Pocket TTS French speaks only cloned voices — this voice has no reference clip",
  );
  expect(slot.toSpeechRequest(fr, { voice_id: "v", text: "Bonjour.", language: "fr", seed: 1, audio_prompt_path: "C:/v.wav" })).toEqual({
    model: "pocket-fr-q8",
    input: "Bonjour.",
    seed: 1,
    voice_ref: "C:/v.wav",
  });
  // The other languages keep their presets.
  expect(row("pocket", "pocket-de-q8").preset_voices).toBe(20);
});

test("Pocket TTS French loads without a warm-up: it has no preset to speak one in, so its first line sets its price", async () => {
  // Slice 4's GPU half (2026-10-16): its load failed with "failed to open safetensors file:
  // …\french\embeddings\alba.safetensors" — the warm-up spoke every Pocket model in alba, which the
  // French download doesn't have. audio.cpp's registration reads no voice (pocket_tts/loader.cpp).
  const warm = async (id, chars) => {
    const asked = [];
    return [await slot.warmModel({ speech: async (req) => asked.push(req) }, row("pocket", id), "tts", chars), asked];
  };
  for (const id of ["pocket-fr-q8", "pocket-fr-bf16"]) expect(await warm(id, 200), id).toEqual([false, []]);
  // TASKS "Slice 4's gaps" 2: no preset in French, ours or Kyutai's cosette.
  expect(Object.values(row("pocket", "pocket-fr-q8").audiocpp.voices)).toEqual([]);
  // Every other language warms in its default preset, as before: the same request.
  const [calibrated, asked] = await warm("pocket-de-q8", 0);
  expect(calibrated).toBe(false);
  expect(asked).toEqual([{ model: "pocket-de-q8", input: "Ready.", voice: "alba", seed: 1 }]);
  expect((await warm("pocket-en-bf16", 200))[0]).toBe(true);
});

test("every speech model warms up in a voice it has, or clones only and is priced by its first line", async () => {
  // Pocket TTS French warmed up in a voice its download lacks (slice 4's GPU half). A model whose
  // warm-up says nothing is one that speaks only from a clip: its first line sets its price (§7
  // answer 5; the kit's runtime_service.js `_priceFirstLine` since round E).
  const silent = [];
  for (const m of discoverEngines().values()) {
    if (m.kind !== "tts") continue;
    for (const r of m.module.VARIANTS) {
      const asked = [];
      const calibrated = await slot.warmModel({ speech: async (req) => asked.push(req) }, r, "tts", 200);
      if (!asked.length) {
        silent.push(r.id);
        expect([calibrated, r.voice_cloning, r.voice_design, r.preset_voices], r.id).toEqual([false, true, false, 0]);
      } else if (asked[0].voice) {
        expect(Object.values(r.audiocpp.voices || {}), `${r.id} warms up in ${asked[0].voice}`).toContain(asked[0].voice);
      }
    }
  }
  expect(silent).toEqual(expect.arrayContaining(["pocket-fr-q8", "pocket-fr-bf16", "chatterbox-multilingual-v2-q8", "qwen3-base-1.7b-q8", "cosyvoice3-q8"]));
});
