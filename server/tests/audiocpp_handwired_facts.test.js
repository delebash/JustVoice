// SPDX-License-Identifier: MIT
// The adoption plan's slice 1 acceptance (docs/plans/2026-10-13-adopt-everything-audiocpp.md §5):
// every hand-wired engine's facts — its voices, languages and downloads — as audio.cpp's specs,
// with our fork's additions, now describe them (catalog.json), beside what its manifest has today.
// Where the two differ the difference is written here, so it is reported, not changed: the
// manifests move onto the specs in the plan's slice 4, and a difference that appears or goes
// fails this test.
import { expect, test } from "vitest";
import "./engines_helpers.js";
import { CATALOG } from "../src/engines/audiocpp/generated.js";
import * as asr from "../src/engines/asr/manifest.js";
import * as chatterbox from "../src/engines/chatterbox/manifest.js";
import * as kitten from "../src/engines/kitten/manifest.js";
import * as kokoro from "../src/engines/kokoro/manifest.js";
import * as pocket from "../src/engines/pocket/manifest.js";
import * as qwen3 from "../src/engines/qwen3/manifest.js";
import * as voxcpm2 from "../src/engines/voxcpm2/manifest.js";

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

test("every download a hand-wired engine offers is a spec package's file, at the same revision and size", () => {
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
  // (pocket_tts.json's English package carries alba's alone, the others only the model).
  const PRESETS = pocket.STATIC_VOICES.map((v) => v.id.replace(/^pocket_/, ""));
  for (const [vid, paths] of Object.entries(notInSpecs)) {
    expect(vid, paths.join(" ")).toMatch(/^pocket-/);
    const names = paths.map((p) => p.replace(/^PocketTTS-GGUF\/[a-z]+\/embeddings\/(.+)\.safetensors$/, "$1"));
    expect(names.every((n) => PRESETS.includes(n)), `${vid}: ${paths.join(" ")}`).toBe(true);
    expect(names.length, vid).toBe(vid.startsWith("pocket-en-") ? PRESETS.length - 1 : PRESETS.length);
  }
  expect(Object.keys(notInSpecs).sort()).toEqual(rows(pocket).map((v) => v.id).sort());
});

test("the hand-wired engines' voices beside the specs' built-in voices", () => {
  const spec = (family) => CATALOG.families[family].builtin_voices;
  // Kokoro: the same 54, by id.
  expect(kokoro.STATIC_VOICES.map((v) => v.id).sort()).toEqual([...spec("kokoro_tts")].sort());
  // Kitten: the same 8, by name (our ids carry a "kitten_" prefix).
  expect(kitten.STATIC_VOICES.map((v) => v.name).sort()).toEqual([...spec("kitten_tts")].sort());
  // Qwen3 CustomVoice: the same 9 speakers. Known: the spec writes them in lower case
  // ("uncle_fu"), our ids as Qwen's model card does ("Uncle_Fu").
  expect(lower(qwen3.STATIC_VOICES.map((v) => v.id))).toEqual(lower(spec("qwen3_tts")));
  expect(qwen3.STATIC_VOICES.map((v) => v.id)).not.toEqual(spec("qwen3_tts"));
  // Known: Pocket TTS — the spec names one built-in voice, alba; our manifest offers 20 presets
  // from the model repo's embeddings.
  expect(spec("pocket_tts")).toEqual(["alba"]);
  expect(pocket.STATIC_VOICES).toHaveLength(20);
  // Chatterbox, Turbo, Nano, VoxCPM2: none either side — Turbo's built-in voice has no name in
  // its spec (the plan's question 6).
  for (const family of ["chatterbox", "chatterbox_turbo", "voxcpm2"]) expect(spec(family), family).toEqual([]);
  for (const m of [chatterbox, voxcpm2, asr]) expect(m.STATIC_VOICES).toEqual([]);
});

test("the hand-wired engines' languages beside the specs'", () => {
  const spec = (family) => lower(CATALOG.families[family].languages);
  const ours = (m, pick = () => true) => lower(rows(m).filter(pick).flatMap((v) => v.languages));
  // The same, letter for letter but case.
  expect(ours(qwen3)).toEqual(spec("qwen3_tts"));
  expect(ours(chatterbox, (v) => v.audiocpp.family === "chatterbox")).toEqual(spec("chatterbox")); // 23, with our he/ru/zh/ja
  expect(ours(chatterbox, (v) => v.audiocpp.family === "chatterbox_turbo")).toEqual(spec("chatterbox_turbo"));
  expect(ours(pocket)).toEqual(minus(spec("pocket_tts"), ["fr"])); // known: French is in the spec, not our manifest yet
  // Known: the spec also lists "zh dialects", a description rather than a language.
  expect(minus(spec("voxcpm2"), ours(voxcpm2))).toEqual(["zh dialects"]);
  expect(minus(ours(voxcpm2), spec("voxcpm2"))).toEqual([]);
  expect(minus(spec("qwen3_asr"), ours(asr))).toEqual(["zh dialects"]);
  expect(minus(ours(asr), spec("qwen3_asr"))).toEqual([]);
  // Known: Kokoro's French is "fr" in our voices, "fr-fr" in the spec.
  expect(minus(spec("kokoro_tts"), ours(kokoro))).toEqual(["fr-fr"]);
  expect(minus(ours(kokoro), spec("kokoro_tts"))).toEqual(["fr"]);
  // Known: Kitten speaks "en-US" in our manifest, "en" in the spec.
  expect(ours(kitten)).toEqual(["en-us"]);
  expect(spec("kitten_tts")).toEqual(["en"]);
});
