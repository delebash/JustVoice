// SPDX-License-Identifier: MIT
// The adoption plan's slice 1 acceptance, as slice 4 leaves it (docs/plans/2026-10-13-adopt-
// everything-audiocpp.md §5): the seven engines described by our own files — Kokoro, KittenTTS,
// Pocket TTS, Qwen3-TTS, Chatterbox, VoxCPM2, Qwen3-ASR — take their voices, languages and
// downloads from audio.cpp's specs, with our fork's additions (seed_audiocpp_catalog.json). Where they still
// differ from the specs the difference is written here, with why, so a difference that appears or
// goes fails this test. (Slice 1 wrote this beside the hand-written manifests slice 4 replaced.)
import { expect, test } from "vitest";
import "./engines_helpers.js";
import { CATALOG, generatedEngines } from "../src/engines/audiocpp/generated.js";

const ENGINES = generatedEngines();
const [asr, chatterbox, kitten, kokoro, pocket, qwen3, voxcpm2] = ["asr", "chatterbox", "kitten", "kokoro", "pocket", "qwen3", "voxcpm2"].map((id) =>
  ENGINES.get(id),
);
const MANIFESTS = { asr, chatterbox, kitten, kokoro, pocket, qwen3, voxcpm2 };
const rows = (m) => [...(m.VARIANTS || []), ...(m.PENDING_VARIANTS || [])];
const lower = (xs) => [...new Set(xs.map((x) => String(x).toLowerCase()))].sort();
const minus = (a, b) => a.filter((x) => !b.includes(x));

// Every file each spec package names, at the repo and revision the catalog pins it to.
const SPEC_FILES = new Map(
  Object.values(CATALOG.families).flatMap((f) =>
    f.packages.flatMap((p) => p.source.files.filter((x) => !x.missing).map((x) => [`${p.source.repo}@${p.source.revision}:${x.path}`, x.size_bytes])),
  ),
);

test("every download the seven engines offer is a spec package's file, at the same revision and size", () => {
  const notInSpecs = {};
  for (const [id, m] of Object.entries(MANIFESTS)) {
    for (const v of rows(m)) {
      for (const s of v.sources) {
        let size = 0;
        for (const path of s.files) {
          const key = `${s.hf_repo}@${s.revision}:${path}`;
          if (!SPEC_FILES.has(key)) (notInSpecs[v.id] ??= []).push(path);
          else size += SPEC_FILES.get(key);
        }
        // A row whose files the specs all name has the specs' size.
        if (!notInSpecs[v.id]) expect(size, `${id}/${v.id}`).toBe(s.size_bytes);
      }
    }
  }
  // Known: Pocket TTS's preset voices are files of the model repo that no spec package names
  // (pocket_tts.json's English package carries alba's alone, the others only the model) — our file
  // lists them (curated/pocket_tts.js VOICES `file_bytes`).
  const PRESETS = pocket.STATIC_VOICES.map((v) => v.id.replace(/^pocket_/, ""));
  for (const [vid, paths] of Object.entries(notInSpecs)) {
    expect(vid, paths.join(" ")).toMatch(/^pocket-/);
    const names = paths.map((p) => p.replace(/^PocketTTS-GGUF\/[a-z]+\/embeddings\/(.+)\.safetensors$/, "$1"));
    expect(names.every((n) => PRESETS.includes(n)), `${vid}: ${paths.join(" ")}`).toBe(true);
    expect(names.length, vid).toBe(vid.startsWith("pocket-en-") ? PRESETS.length - 1 : PRESETS.length);
  }
  // French clones only — none of our presets (TASKS "Slice 4's gaps" 2), so it adds no file.
  expect(Object.keys(notInSpecs).sort()).toEqual(rows(pocket).map((v) => v.id).filter((id) => !id.startsWith("pocket-fr-")).sort());
});

test("the seven engines' voices beside the specs' built-in voices", () => {
  const spec = (family) => CATALOG.families[family].builtin_voices;
  // Kokoro: the same 54, by id.
  expect(kokoro.STATIC_VOICES.map((v) => v.id).sort()).toEqual([...spec("kokoro_tts")].sort());
  // Kitten: the same 8, by name (our ids carry a "kitten_" prefix).
  expect(kitten.STATIC_VOICES.map((v) => v.name).sort()).toEqual([...spec("kitten_tts")].sort());
  // Qwen3 CustomVoice: the same 9 speakers. Known: the spec writes them in lower case
  // ("uncle_fu"), our ids as Qwen's model card does ("Uncle_Fu").
  expect(lower(qwen3.STATIC_VOICES.map((v) => v.id))).toEqual(lower(spec("qwen3_tts")));
  expect(qwen3.STATIC_VOICES.map((v) => v.id)).not.toEqual(spec("qwen3_tts"));
  // Known: Pocket TTS — the spec names one built-in voice, alba; our file adds 19 presets from the
  // model repo's embeddings.
  expect(spec("pocket_tts")).toEqual(["alba"]);
  expect(pocket.STATIC_VOICES).toHaveLength(20);
  // Chatterbox, Turbo, Nano, VoxCPM2: none in the specs. Turbo's and Nano's own voice is listed,
  // named by our file (the plan's F4; decided 2026-10-15, §7 question 6), and audio.cpp's own Turbo
  // package's, in audio.cpp's words (its E6/E14/F5).
  for (const family of ["chatterbox", "chatterbox_turbo", "voxcpm2"]) expect(spec(family), family).toEqual([]);
  expect(chatterbox.STATIC_VOICES.map((v) => [v.name, v.gender, v.model])).toEqual([
    ["Turbo (built-in)", "", "chatterbox-turbo"],
    ["Nano (built-in)", "", "chatterbox-nano"],
    ["Chatterbox Turbo (built-in)", "", "chatterbox-chatterboxturbo"],
  ]);
  for (const m of [voxcpm2, asr]) expect(m.STATIC_VOICES).toEqual([]);
});

test("the seven engines' languages beside the specs'", () => {
  const spec = (family) => lower(CATALOG.families[family].languages);
  const ours = (m, pick = () => true) => lower(rows(m).filter(pick).flatMap((v) => v.languages));
  // The same, letter for letter but case.
  expect(ours(qwen3)).toEqual(spec("qwen3_tts"));
  expect(ours(chatterbox, (v) => v.audiocpp.family === "chatterbox")).toEqual(spec("chatterbox")); // 23, with our he/ru/zh/ja
  expect(ours(chatterbox, (v) => v.audiocpp.family === "chatterbox_turbo")).toEqual(spec("chatterbox_turbo"));
  expect(ours(pocket)).toEqual(spec("pocket_tts")); // French clones only (TASKS "Slice 4's gaps" 2)
  // Known: the spec also lists "zh dialects", a description rather than a language.
  expect(minus(spec("voxcpm2"), ours(voxcpm2))).toEqual(["zh dialects"]);
  expect(minus(ours(voxcpm2), spec("voxcpm2"))).toEqual([]);
  // QwenCleo-ASR speaks its own (the plan's E14/F5; its languages in our file, decided 2026-10-15,
  // TASKS "Slice 2's acceptance findings" 5): Egyptian Arabic, a region tag of the spec's "ar", and
  // English.
  const qwen = (v) => !v.id.startsWith("qwencleo");
  expect(minus(spec("qwen3_asr"), ours(asr, qwen))).toEqual(["zh dialects"]);
  expect(minus(ours(asr, qwen), spec("qwen3_asr"))).toEqual([]);
  expect(ours(asr, (v) => !qwen(v))).toEqual(["ar-eg", "en"]);
  // Known: Kokoro's French is "fr" in our voices, "fr-fr" in the spec.
  expect(minus(spec("kokoro_tts"), ours(kokoro))).toEqual(["fr-fr"]);
  expect(minus(ours(kokoro), spec("kokoro_tts"))).toEqual(["fr"]);
  // Known: Kitten speaks "en-US" in our voices, "en" in the spec.
  expect(ours(kitten)).toEqual(["en-us"]);
  expect(spec("kitten_tts")).toEqual(["en"]);
});
