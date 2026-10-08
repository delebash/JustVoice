// SPDX-License-Identifier: MIT
// Variant wiring contract — every engine once ignored the `variant` arg, making the Engines
// tab's model dropdown cosmetic. These pin the catalog rows to what actually renders them
// (since the 2026-10-01 switch: each row's `audiocpp` block and the request mapping in
// engines/audiocpp/slot.js). The port of tests/test_variant_wiring.py; Python's parametrized
// tests loop over their cases; its `app` fixture (create_app) is the app state on a temp
// database (`useState`).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { endState, useState } from "./engines_helpers.js";
import * as release from "../src/engines/audiocpp/release.js";
import { QWEN_LANGUAGE, toSpeechRequest } from "../src/engines/audiocpp/slot.js";
import * as chatterboxManifest from "../src/engines/chatterbox/manifest.js";
import * as manager from "../src/engines/manager.js";
import { discoverEngines, EngineManager } from "../src/engines/manager.js";
import { modelsFor } from "../src/engines/model_catalog.js";
import * as qwen3Manifest from "../src/engines/qwen3/manifest.js";
import * as speechCache from "../src/speech_cache.js";

const QWEN_LANGS_10 = ["zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"];
const row = (engine, variant) => discoverEngines().get(engine).module.VARIANTS.find((r) => r.id === variant);
afterEach(() => endState());

// ── Qwen3 ────────────────────────────────────────────────────────────────

test("qwen3_catalog_is_the_three_checkpoint_families", () => {
  const ids = new Set(modelsFor("qwen3").map((v) => v.id));
  const eight = ["qwen3-cv-1.7b-q8", "qwen3-cv-0.6b-q8", "qwen3-base-1.7b-q8", "qwen3-base-0.6b-q8", "qwen3-vd-1.7b-q8"];
  // Each checkpoint at 8-bit (the defaults) and its 16-bit sibling (gap 9).
  expect(ids).toEqual(new Set([...eight, ...eight.map((i) => `${i.slice(0, -3)}-bf16`)]));
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
  // Turbo and Nano are offered since the pin clones with them (v0.9.0-jv.4, gap 1).
  expect(new Set(modelsFor("chatterbox").map((v) => v.id))).toEqual(
    new Set([
      "chatterbox-multilingual-v2-q8",
      "chatterbox-multilingual-v2-f16",
      "chatterbox-turbo-q8",
      "chatterbox-turbo-f16",
      "chatterbox-nano-q8",
      "chatterbox-nano-f16",
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
  expect(modelsFor("asr").map((x) => x.id)).toEqual(["qwen3-asr-1.7b-q8", "qwen3-asr-1.7b-f16"]);
  for (const [vid, dtype] of [
    ["qwen3-asr-1.7b-q8", "q8_0"],
    ["qwen3-asr-1.7b-f16", "f16"],
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
  const repos = new Set([release.MODEL_REPO, qwen3Manifest.CV_06_REPO, chatterboxManifest.TURBO_REPO, chatterboxManifest.NANO_REPO]);
  for (const [eid, m] of discoverEngines()) {
    for (const variant of m.module.VARIANTS || []) {
      for (const src of variant.sources || []) {
        const rev = String(src.revision || "");
        if (!/^[0-9a-f]{40}$/.test(rev)) loose.push(`${eid}/${variant.id}: '${rev}'`);
        expect(repos.has(src.hf_repo), variant.id).toBe(true);
      }
    }
  }
  expect(loose).toEqual([]);
});

test("engine_kinds", () => {
  const kinds = Object.fromEntries([...discoverEngines()].map(([k, m]) => [k, m.kind]));
  expect(kinds).toEqual({ kokoro: "tts", qwen3: "tts", chatterbox: "tts", asr: "stt", kitten: "tts", pocket: "tts", voxcpm2: "tts" });
});

// ─── current_variant_id recording (user-hit 2026-06-12) ────────────────
// Loading via the Voices ask-before-load path passes variant=null; the manager must record
// the RESOLVED default variant id, never null/"auto".

const fakeResp = (payload) => ({ statusCode: 200, text: "", json: () => payload });

class FakeSlot {
  constructor(manifest, placement = "gpu") {
    this.manifest = manifest;
    this.placement = placement;
  }
  spawn() {}
  isAlive() {
    return true;
  }
  terminate() {}
  post(_p, _json = null) {
    return fakeResp({ ok: true });
  }
  get(_p) {
    return fakeResp({ voices: [] });
  }
}

const fakeManifest = (over = {}) => ({ id: "fake-tts", kind: "tts", isInstalled: true, defaultVariantId: "fake-default-v1", ...over });

function fakeManager(Slot = FakeSlot) {
  vi.spyOn(manager, "_newSlot").mockImplementation((m, p) => new Slot(m, p));
  vi.spyOn(EngineManager.prototype, "_resolveDevice").mockReturnValue("cpu");
  // Never a real model fetch from a test (a cold load downloads what it needs).
  vi.spyOn(EngineManager.prototype, "_ensureVariantLocal").mockResolvedValue(null);
  vi.spyOn(EngineManager.prototype, "placementFor").mockResolvedValue(["gpu", "test", false]);
  const mgr = new EngineManager();
  mgr._hwCache = null;
  mgr._hwDetected = true;
  mgr._manifests.set("fake-tts", fakeManifest());
  return mgr;
}

test("load_without_variant_records_default", async () => {
  const mgr = fakeManager();
  await mgr.load("fake-tts", { device: "auto" }); // the voice_preview_api call shape
  expect(mgr.currentVariantId("fake-tts")).toBe("fake-default-v1");
});

test("load_with_auto_variant_records_default", async () => {
  const mgr = fakeManager();
  await mgr.load("fake-tts", { device: "auto", variant: "auto" });
  expect(mgr.currentVariantId("fake-tts")).toBe("fake-default-v1");
});

test("load_with_explicit_variant_records_it", async () => {
  const mgr = fakeManager();
  await mgr.load("fake-tts", { device: "auto", variant: "fake-other-v2" });
  expect(mgr.currentVariantId("fake-tts")).toBe("fake-other-v2");
});

test("no_manifest_default_records_the_downloaded_variant", async () => {
  // An engine with no DEFAULT_VARIANT_ID loads what is downloaded — the manager must record
  // that variant, not "". Qwen3 stands in, its default forced off.
  const st = useState();
  const mgr = fakeManager();
  mgr._manifests.set("qwen3", fakeManifest({ id: "qwen3", defaultVariantId: null }));
  const vdir = speechCache.variantDir(st.dataDir, "qwen3", "qwen3-base-0.6b-q8");
  mkdirSync(vdir, { recursive: true });
  writeFileSync(path.join(vdir, "m.gguf"), "x");
  writeFileSync(path.join(vdir, speechCache.MANIFEST_NAME), JSON.stringify({ sources: [], files: [{ path: "m.gguf", size: 1, oid: "" }] }));
  await mgr.load("qwen3", { device: "auto" });
  expect(mgr.currentVariantId("qwen3")).toBe("qwen3-base-0.6b-q8");
});

test("no_manifest_default_and_nothing_downloaded_takes_the_catalogs_first", async () => {
  useState();
  const mgr = fakeManager();
  mgr._manifests.set("qwen3", fakeManifest({ id: "qwen3", defaultVariantId: null }));
  await mgr.load("qwen3", { device: "auto" });
  expect(mgr.currentVariantId("qwen3")).toBe(modelsFor("qwen3")[0].id);
});

test("all_multi_variant_engines_resolve_a_real_variant", () => {
  // The user's Set-as-default override is consulted first — absent here, so manifest order is
  // what this pins.
  for (const [engineId, m] of discoverEngines()) {
    const resolved = manager.getManager()._resolvedDefaultVariant(m);
    const ids = modelsFor(engineId).map((v) => v.id);
    if (!ids.length) continue;
    expect(ids, engineId).toContain(resolved);
  }
});

test("already_loaded_reload_keeps_resolved_variant", async () => {
  const mgr = fakeManager();
  await mgr.load("fake-tts", { device: "auto", variant: "fake-other-v2" });
  // Re-load with no variant (Voices preview path) must NOT clobber the explicit variant back
  // to default, and must never store null.
  await mgr.load("fake-tts", { device: "auto" });
  expect(mgr.currentVariantId("fake-tts")).toBe("fake-other-v2");
  await mgr.load("fake-tts", { device: "auto", variant: "fake-default-v1" });
  expect(mgr.currentVariantId("fake-tts")).toBe("fake-default-v1");
});

test("loading_another_variant_of_the_loaded_engine_loads_it", async () => {
  // Until 2026-10-02 a second variant of a loaded engine was only relabelled — the first model
  // kept speaking under the new name. Now the old slot goes and the new variant loads.
  const slots = [];
  class CountingSlot extends FakeSlot {
    constructor(...a) {
      super(...a);
      this.bodies = [];
      this.terminated = false;
      slots.push(this);
    }
    post(p, json = null) {
      this.bodies.push([p, { ...(json || {}) }]);
      return fakeResp({ ok: true, variant: (json || {}).variant });
    }
    terminate() {
      this.terminated = true;
    }
  }
  const mgr = fakeManager(CountingSlot);
  await mgr.load("fake-tts", { device: "auto", variant: "fake-default-v1" });
  await mgr.load("fake-tts", { device: "auto", variant: "fake-other-v2" });
  expect(slots.length).toBe(2);
  expect(slots[0].terminated, "the first variant's slot stayed loaded").toBe(true);
  expect(slots[1].bodies.map(([p, b]) => [p, b.variant])).toContainEqual(["/load", "fake-other-v2"]);
  expect(mgr.currentVariantId("fake-tts")).toBe("fake-other-v2");
  // The same variant again, or no variant at all, keeps the slot.
  await mgr.load("fake-tts", { device: "auto", variant: "fake-other-v2" });
  await mgr.load("fake-tts", { device: "auto" });
  expect(slots.length).toBe(2);
});

test("the_card_names_what_loaded_not_a_stale_request", async () => {
  // A stored request can name a model the catalog no longer has; the slot loads its default
  // instead and says which — that is what the card must show.
  class ResolvingSlot extends FakeSlot {
    post() {
      return fakeResp({ ok: true, variant: "fake-default-v1" });
    }
  }
  const mgr = fakeManager(ResolvingSlot);
  await mgr.load("fake-tts", { device: "auto", variant: "whisper-turbo" });
  expect(mgr.currentVariantId("fake-tts")).toBe("fake-default-v1");
});

// ── 16-bit rows (gap 9) ──────────────────────────────────────────────────

test("every_16_bit_row_is_its_8_bit_siblings_model_at_the_original_precision", () => {
  // Same capabilities, same languages and presets, its own file; never the default, and no
  // borrowed CPU speed. KittenTTS has no 16-bit file.
  let seen = 0;
  for (const [eid, m] of discoverEngines()) {
    const rows = Object.fromEntries((m.module.VARIANTS || []).map((r) => [r.id, r]));
    for (const [vid, r] of Object.entries(rows)) {
      if (!(vid.endsWith("-bf16") || vid.endsWith("-f16"))) continue;
      seen += 1;
      const sib = rows[`${vid.slice(0, vid.lastIndexOf("-"))}-q8`];
      for (const k of ["languages", "voice_cloning", "preset_voices", "weights_license"]) expect(r[k], `${vid} ${k}`).toEqual(sib[k]);
      const strip = (a) => Object.fromEntries(Object.entries(a).filter(([k]) => k !== "file" && k !== "companions"));
      expect(strip(r.audiocpp), vid).toEqual(strip(sib.audiocpp));
      expect(r.audiocpp.file).not.toBe(sib.audiocpp.file);
      expect(r.sources[0].files).toContain(r.audiocpp.file);
      expect(r.name).toContain("16-bit");
      expect(r.cpu_realtime == null || r.cpu_realtime !== sib.cpu_realtime, vid).toBe(true);
      expect(m.defaultVariantId).not.toBe(vid);
    }
    void eid;
  }
  // kokoro 1 · pocket 5 · qwen3 5 · chatterbox 3 (Turbo and Nano too) · asr 1 · voxcpm2 1
  expect(seen).toBe(16);
});
