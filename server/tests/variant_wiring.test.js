// SPDX-License-Identifier: MIT
// Variant wiring contract — every engine once ignored the `variant` arg, making the Engines
// tab's model dropdown cosmetic. These pin the catalog rows to what actually renders them
// (since the 2026-10-01 switch: each row's `audiocpp` block and the request mapping in
// engines/audiocpp/slot.js). The port of tests/test_variant_wiring.py; Python's parametrized
// tests loop over their cases. Since round E (docs/plans/2026-10-29-round-e-onto-the-kit.md) the
// kit's audio.cpp runtime loads the version it is given and holds it; which version a no-variant
// choice speaks stays ours (engines/model_catalog.js `resolvedDefaultVariant`), what is downloaded
// read from the kit (faked here, engines_helpers.js `fakeSpeechRuntime`).
import { afterEach, expect, test } from "vitest";
import { endSpeech, endState, fakeSpeechRuntime } from "./engines_helpers.js";
import { CATALOG, OWN_ENGINES } from "../src/engines/audiocpp/generated.js";
import { QWEN_LANGUAGE, toSpeechRequest } from "../src/engines/audiocpp/slot.js";
import { discoverEngines, modelsFor, resolvedDefaultVariant } from "../src/engines/model_catalog.js";

// Our own conversions of models audio.cpp doesn't publish — CustomVoice 0.6B (gap 4), Turbo and
// Nano (gap 1) — as our fork's catalog names them (the adoption plan's slice 4: the repositories come
// from audio.cpp's files, where the manifests named them before).
const source = (family, id) => CATALOG.families[family].packages.find((p) => p.id === id).source;
const qwen3Manifest = { CV_06_REPO: source("qwen3_tts", "qwen3_tts_0_6b_customvoice_q8_0").repo, CV_06_REVISION: source("qwen3_tts", "qwen3_tts_0_6b_customvoice_q8_0").revision };
const chatterboxManifest = {
  TURBO_REPO: source("chatterbox_turbo", "chatterbox_turbo_clone_q8_0").repo,
  TURBO_REVISION: source("chatterbox_turbo", "chatterbox_turbo_clone_q8_0").revision,
  NANO_REPO: source("chatterbox_turbo", "chatterbox_nano_q8_0").repo,
  NANO_REVISION: source("chatterbox_turbo", "chatterbox_nano_q8_0").revision,
};

const QWEN_LANGS_10 = ["zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"];
const row = (engine, variant) => discoverEngines().get(engine).module.VARIANTS.find((r) => r.id === variant);
afterEach(() => {
  endSpeech();
  endState();
});

// ── Qwen3 ────────────────────────────────────────────────────────────────

test("qwen3_catalog_is_the_three_checkpoint_families", () => {
  const ids = new Set(modelsFor("qwen3").map((v) => v.id));
  const eight = ["qwen3-cv-1.7b-q8", "qwen3-cv-0.6b-q8", "qwen3-base-1.7b-q8", "qwen3-base-0.6b-q8", "qwen3-vd-1.7b-q8"];
  // Each checkpoint at 8-bit (the defaults) and its 16-bit sibling (gap 9); Base 1.7B at its
  // original precision too, audio.cpp's own package (the adoption plan's E14/F5).
  expect(ids).toEqual(new Set([...eight, ...eight.map((i) => `${i.slice(0, -3)}-bf16`), "qwen3-base-1.7b-orig"]));
  for (const r of discoverEngines().get("qwen3").module.VARIANTS) {
    expect(r.audiocpp.family).toBe("qwen3_tts");
    // VoiceDesign is its own audio.cpp task; CustomVoice and Base are tts.
    expect(r.audiocpp.task, r.id).toBe(r.id.startsWith("qwen3-vd") ? "vdes" : "tts");
  }
});

test("qwen3_cloning_flag_is_per_checkpoint_family", () => {
  const byId = Object.fromEntries(modelsFor("qwen3").map((v) => [v.id, v]));
  for (const cv of ["qwen3-cv-1.7b-q8", "qwen3-cv-0.6b-q8"]) {
    expect(byId[cv].voice_cloning).toBe(false); // presets, no clone
    expect(byId[cv].preset_voices).toBe(9);
  }
  for (const base of ["qwen3-base-1.7b-q8", "qwen3-base-0.6b-q8"]) {
    expect(byId[base].voice_cloning).toBe(true);
    expect(byId[base].preset_voices).toBe(0);
    expect(row("qwen3", base).audiocpp.clone).toBe(true);
  }
});

test("qwen3_languages_are_the_ten_supported", () => {
  for (const v of modelsFor("qwen3")) expect(v.languages, `${v.id} language list drifted`).toEqual(QWEN_LANGS_10);
});

test("qwen3_manifest_languages_all_reach_a_language_name", () => {
  // audio.cpp's Qwen3 takes a language NAME ("English"; "en" is rejected).
  for (const l of modelsFor("qwen3")[0].languages) expect(Object.hasOwn(QWEN_LANGUAGE, l), l).toBe(true);
});

test("qwen3_voice_design_claim_is_backed", () => {
  const m = discoverEngines().get("qwen3");
  expect(m.capabilities.voice_design).toBe(true);
  expect(modelsFor("qwen3").filter((v) => v.voice_design).map((v) => v.id)).toEqual(["qwen3-vd-1.7b-q8", "qwen3-vd-1.7b-bf16"]);
  const req = toSpeechRequest(row("qwen3", "qwen3-vd-1.7b-q8"), { text: "Hi.", delivery: { instruct: "A gravel voice." } });
  expect(req.instructions).toBe("A gravel voice.");
});

// ── Chatterbox ───────────────────────────────────────────────────────────

test("chatterbox_catalog_is_multilingual_turbo_and_nano", () => {
  // Turbo and Nano are offered since the pin clones with them (v0.9.0-jv.4, gap 1); audio.cpp's
  // own Turbo package beside ours (the adoption plan's E6/E14/F5).
  expect(new Set(modelsFor("chatterbox").map((v) => v.id))).toEqual(
    new Set([
      "chatterbox-multilingual-v2-q8",
      "chatterbox-multilingual-v2-f16",
      "chatterbox-turbo-q8",
      "chatterbox-turbo-f16",
      "chatterbox-nano-q8",
      "chatterbox-nano-f16",
      "chatterbox-chatterboxturbo-q8",
    ]),
  );
  const spec = row("chatterbox", "chatterbox-multilingual-v2-q8").audiocpp;
  expect([spec.family, spec.task]).toEqual(["chatterbox", "clon"]);
});

// ── Every engine ─────────────────────────────────────────────────────────

test("cloning_claims_are_wired_in_the_mapping", () => {
  // A row that claims `voice_cloning` must send the reference clip.
  for (const engine of ["kokoro", "qwen3", "chatterbox"]) {
    for (const v of modelsFor(engine)) {
      if (!v.voice_cloning) continue;
      const req = toSpeechRequest(row(engine, v.id), { text: "Hi.", audio_prompt_path: "C:\\v\\ref.wav", ref_text: "What the clip says." });
      expect(req.voice_ref, v.id).toBe("C:/v/ref.wav");
      expect(() => toSpeechRequest(row(engine, v.id), { text: "Hi.", voice_id: "x" })).toThrow();
    }
  }
});

test("manifest_default_variants_exist_in_catalog", () => {
  for (const [engineId, m] of [...discoverEngines()].sort()) {
    const def = m.module.DEFAULT_VARIANT_ID;
    if (def == null) continue;
    expect(modelsFor(engineId).map((v) => v.id), engineId).toContain(def);
  }
});

test("speech_recognition_carries_its_aligner", () => {
  // Qwen3-ASR 0.6B is offered beside 1.7B, which stays the default (the adoption plan §7 answer 4),
  // and QwenCleo-ASR (its E14/F5), each with the aligner.
  expect(modelsFor("asr").map((x) => x.id)).toEqual([
    "qwen3-asr-1.7b-q8",
    "qwen3-asr-1.7b-f16",
    "qwen3-asr-0.6b-q8",
    "qwen3-asr-0.6b-f16",
    "qwencleo-asr-q8",
    "qwencleo-asr-f16",
  ]);
  for (const [vid, dtype] of [
    ["qwen3-asr-1.7b-q8", "q8_0"],
    ["qwen3-asr-1.7b-f16", "f16"],
    ["qwen3-asr-0.6b-q8", "q8_0"],
    ["qwen3-asr-0.6b-f16", "f16"],
  ]) {
    const spec = row("asr", vid).audiocpp;
    expect([spec.family, spec.task]).toEqual(["qwen3_asr", "asr"]);
    expect(spec.companions.map((c) => c.role)).toEqual(["aligner"]);
    // Each precision brings its own aligner, and the source fetches both files.
    expect(spec.file.endsWith(`-${dtype}.gguf`) && spec.companions[0].file.endsWith(`-${dtype}.gguf`)).toBe(true);
    expect(new Set(row("asr", vid).sources[0].files)).toEqual(new Set([spec.file, spec.companions[0].file]));
  }
});

test("hf_sources_pin_a_commit_not_a_branch", () => {
  // Byte-exact sizes and file lists are facts about a COMMIT; "main" is a moving target.
  const loose = [];
  // audio.cpp's model repo: the one the catalog was built from (audiocpp_catalog.test.js pins it).
  const repos = new Set([CATALOG.generated_from.model_repo, qwen3Manifest.CV_06_REPO, chatterboxManifest.TURBO_REPO, chatterboxManifest.NANO_REPO]);
  for (const [eid, m] of discoverEngines()) {
    for (const variant of m.module.VARIANTS || []) {
      for (const src of variant.sources || []) {
        const rev = String(src.revision || "");
        if (!/^[0-9a-f]{40}$/.test(rev)) loose.push(`${eid}/${variant.id}: '${rev}'`);
        // A generated engine downloads from whichever repo audio.cpp's spec names, pinned to the
        // commit scripts/audiocpp-catalog.js resolved; a hand-wired one from our known repos.
        if (!m.module.GENERATED) expect(repos.has(src.hf_repo), variant.id).toBe(true);
      }
    }
  }
  expect(loose).toEqual([]);
});

test("engine_kinds", () => {
  const engines = [...discoverEngines()];
  // The seven engines described by our own files (built from audio.cpp's files too since the adoption
  // plan's slice 4).
  const kinds = Object.fromEntries(engines.filter(([k]) => OWN_ENGINES.includes(k)).map(([k, m]) => [k, m.kind]));
  expect(kinds).toEqual({ kokoro: "tts", qwen3: "tts", chatterbox: "tts", asr: "stt", kitten: "tts", pocket: "tts", voxcpm2: "tts" });
  // An engine built from audio.cpp's own files speaks, or — from its Speech to text tab — recognises
  // speech (the adoption plan's slice 2, E1).
  for (const [k, m] of engines.filter(([, m]) => m.module.GENERATED)) {
    const tasks = new Set(m.module.VARIANTS.map((v) => v.audiocpp.task));
    expect(m.kind, k).toBe(tasks.has("asr") ? "stt" : "tts");
    if (m.kind === "stt") expect([...tasks], k).toEqual(["asr"]);
  }
  expect(engines.find(([k]) => k === "parakeet_tdt")[1].kind).toBe("stt");
  // A family that speaks and recognises has an engine of each kind.
  expect(engines.find(([k]) => k === "lfm2_audio")[1].kind).toBe("tts");
  expect(engines.find(([k]) => k === "lfm2_audio_asr")[1].kind).toBe("stt");
});

// ─── The version a no-variant choice speaks (user-hit 2026-06-12) ──────
// Loading via the Voices ask-before-load path passed variant=null, and the manager had to record
// the RESOLVED default variant id, never null/"auto". Since round E the kit loads only a concrete
// version and holds it (its `loaded()`, read by kit_speech.test.js); the resolution is ours.

/** `fn()` with Qwen3's manifest default taken away (its module is the one every discovery wraps). */
function withoutQwen3Default(fn) {
  const mod = discoverEngines().get("qwen3").module;
  const was = mod.DEFAULT_VARIANT_ID;
  mod.DEFAULT_VARIANT_ID = null;
  try {
    return fn();
  } finally {
    mod.DEFAULT_VARIANT_ID = was;
  }
}

test("no_manifest_default_resolves_the_downloaded_variant", () => {
  // An engine with no DEFAULT_VARIANT_ID speaks what is downloaded — never "". Qwen3 stands in,
  // its default forced off.
  fakeSpeechRuntime({ onDisk: ["qwen3-base-0.6b-q8"] });
  expect(withoutQwen3Default(() => resolvedDefaultVariant("qwen3"))).toBe("qwen3-base-0.6b-q8");
});

test("no_manifest_default_and_nothing_downloaded_takes_the_catalogs_first", () => {
  fakeSpeechRuntime({ onDisk: [] });
  expect(withoutQwen3Default(() => resolvedDefaultVariant("qwen3"))).toBe(modelsFor("qwen3")[0].id);
});

test("all_multi_variant_engines_resolve_a_real_variant", () => {
  // The user's Set-as-default override is consulted first — absent here, so manifest order is
  // what this pins.
  for (const [engineId] of discoverEngines()) {
    const resolved = resolvedDefaultVariant(engineId);
    const ids = modelsFor(engineId).map((v) => v.id);
    if (!ids.length) continue;
    expect(ids, engineId).toContain(resolved);
  }
});

// ── 16-bit rows (gap 9) ──────────────────────────────────────────────────

test("every_16_bit_row_is_its_8_bit_siblings_model_at_the_original_precision", () => {
  // Same capabilities, same languages and presets, its own file; never the default, and no
  // borrowed CPU speed. KittenTTS has no 16-bit file.
  let seen = 0;
  for (const [eid, m] of discoverEngines()) {
    // The 16-bit rows of the seven engines described by our own files (named by the rule the 16-bit
    // rows have always had, generated.js `siblingWords`); every other engine's precisions are
    // audio.cpp's own packages (audiocpp_generated.test.js).
    if (!OWN_ENGINES.includes(eid)) continue;
    const rows = Object.fromEntries((m.module.VARIANTS || []).map((r) => [r.id, r]));
    for (const [vid, r] of Object.entries(rows)) {
      if (!(vid.endsWith("-bf16") || vid.endsWith("-f16"))) continue;
      seen += 1;
      const sib = rows[`${vid.slice(0, vid.lastIndexOf("-"))}-q8`];
      for (const k of ["languages", "voice_cloning", "preset_voices", "weights_license"]) expect(r[k], `${vid} ${k}`).toEqual(sib[k]);
      // Its own file — and, since the adoption plan's slice 4, the audio.cpp package that holds it.
      const strip = (a) => Object.fromEntries(Object.entries(a).filter(([k]) => k !== "file" && k !== "companions" && k !== "package"));
      expect(strip(r.audiocpp), vid).toEqual(strip(sib.audiocpp));
      expect(r.audiocpp.file).not.toBe(sib.audiocpp.file);
      expect(r.sources[0].files).toContain(r.audiocpp.file);
      expect(r.name).toContain("16-bit");
      expect(r.cpu_realtime == null || r.cpu_realtime !== sib.cpu_realtime, vid).toBe(true);
      expect(m.defaultVariantId).not.toBe(vid);
    }
    void eid;
  }
  // kokoro 1 · pocket 6 (French — TASKS "Slice 4's gaps" 2) · qwen3 5 · chatterbox 3 (Turbo and Nano
  // too) · asr 3 (1.7B, 0.6B, QwenCleo — the adoption plan's E14/F5) · voxcpm2 1
  expect(seen).toBe(19);
});
