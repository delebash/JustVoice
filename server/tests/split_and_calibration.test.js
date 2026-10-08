// SPDX-License-Identifier: MIT
// Bound the work, then price it (audit 2026-10-04 §13.3): a split size per model, a fixed seed
// for a description voice, and the calibrating warm-up a model with no price on the card
// measures its peak with (the port of tests/test_split_and_calibration.py; parametrized tests
// loop over their cases).
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, vi } from "vitest";
import "./engines_helpers.js";
import * as appState from "../src/app_state.js";
import { parseWavHeader } from "../src/audio/wav.js";
import { AudioCppError } from "../src/engines/audiocpp/runtime.js";
import * as slotMod from "../src/engines/audiocpp/slot.js";
import * as manager from "../src/engines/manager.js";
import { discoverEngines, EngineManager } from "../src/engines/manager.js";
import { EngineRegistry } from "../src/engines/registry.js";
import { descriptionSeed, probeLineCached, renderLine } from "../src/render_core.js";
import { tmpPath } from "./helpers.js";

// ─── the split size ──────────────────────────────────────────────────────────

function settingsState(overrides = {}, cap = 800) {
  const settings = {
    engines: { engine_overrides: Object.fromEntries(Object.entries(overrides).map(([eid, v]) => [eid, { split_chars: { ...v } }])) },
    generation: { max_chunk_chars: cap },
  };
  vi.spyOn(appState, "getState").mockReturnValue({ settings: { get: () => settings } });
}

test("a_models_split_size_comes_from_the_user_then_the_catalog", () => {
  settingsState({ qwen3: { "qwen3-cv-1.7b-q8": 120 } });
  const mgr = new EngineManager();
  expect(mgr.splitCharsFor("qwen3", "qwen3-cv-1.7b-q8")).toBe(120); // the user's
  expect(mgr.splitCharsFor("qwen3", "qwen3-base-1.7b-q8")).toBe(200); // the catalog's
  expect(mgr.splitCharsFor("qwen3", "qwen3-base-1.7b-bf16")).toBe(200); // 16-bit rows inherit it
  expect(mgr.splitCharsFor("qwen3", "qwen3-vd-1.7b-q8")).toBeNull(); // waits for the ear
  expect(mgr.splitCharsFor("voxcpm2", "voxcpm2-q8")).toBe(200);
  expect(mgr.splitCharsFor("kokoro", "kokoro-82m-q8")).toBe(240);
  expect(mgr.splitCharsFor("chatterbox", "chatterbox-multilingual-v2-q8")).toBeNull();
  expect(mgr.effectiveSplit("qwen3", "qwen3-vd-1.7b-q8")).toBe(800); // the global cap
  settingsState({}, 150);
  expect(mgr.effectiveSplit("qwen3", "qwen3-cv-1.7b-q8")).toBe(150); // never above the cap
});

// ─── the render: pieces of the model's length; a description voice's seed ────

class Mgr {
  constructor(split) {
    this.split = split;
    this.synths = [];
    this.m = { id: "mock-tts", kind: "tts", capabilities: { paralinguistic_tags: false }, staticVoices: [{ id: "mv_1", name: "MV" }] };
  }
  getManifest(engineId) {
    return engineId === "mock-tts" ? this.m : null;
  }
  manifests() {
    return new Map([["mock-tts", this.m]]);
  }
  currentFor() {
    return "mock-tts";
  }
  currentVariantId() {
    return "v1";
  }
  splitCharsFor() {
    return this.split;
  }
  async load() {
    return {};
  }
  async synth(engineId, body) {
    this.synths.push({ ...body });
    const b = Buffer.alloc(200);
    for (let i = 0; i < 100; i++) b.writeInt16LE(0x0100, 2 * i);
    return [b, { sample_rate: 16000, channels: 1, is_wav_container: false }];
  }
}

class Cache {
  constructor() {
    this.d = new Map();
  }
  has(scope, key) {
    return this.d.has(`${scope}|${key}`);
  }
  get(scope, key) {
    return this.d.get(`${scope}|${key}`) ?? null;
  }
  put(scope, key, data) {
    this.d.set(`${scope}|${key}`, data);
  }
}

function renderState(tmp, { cache = null, designed = false } = {}) {
  const settings = {
    limits: { text_max_chars: 5000 },
    cache: { enabled: cache !== null },
    generation: { max_chunk_chars: 800, crossfade_ms: 50 },
  };
  const stored = { id: "d1", engine: "mock-tts", source: "designed", design_prompt: "A gravel-voiced harbour-master." };
  const voices = {
    get: (vid) => (designed && vid === "d1" ? stored : null),
    refWavPath: () => path.join(tmp, "no-clip.wav"),
  };
  const st = { settings: { get: () => settings }, engines: new EngineRegistry(), voices, lexicons: { get: () => null } };
  if (cache !== null) st._renderCache = cache;
  return st;
}

const LONG =
  "The ferry was late again, and nobody on the quay looked surprised. Marius set the lamp " +
  "on the table and counted the doors until the ninth. The fog came in over the pier.";

test("a_long_line_goes_to_the_model_in_its_own_piece_length", async () => {
  const mgr = new Mgr(70);
  vi.spyOn(manager, "getManager").mockReturnValue(mgr);
  const tmp = tmpPath();
  await renderLine(renderState(tmp), { voice: "mv_1", text: LONG });
  expect(mgr.synths.length).toBeGreaterThanOrEqual(3);
  expect(mgr.synths.every((b) => [...b.text].length <= 70)).toBe(true);
  mgr.synths.length = 0;
  mgr.split = null; // a model with none: the global cap
  await renderLine(renderState(tmp), { voice: "mv_1", text: LONG });
  expect(mgr.synths.length).toBe(1);
});

test("a_description_voice_keeps_one_seed_and_the_full_length", async () => {
  const mgr = new Mgr(70);
  vi.spyOn(manager, "getManager").mockReturnValue(mgr);
  const st = renderState(tmpPath(), { cache: new Cache(), designed: true });
  expect(await probeLineCached(st, "d1", LONG, { cacheScope: "s" })).toBe(false);
  await renderLine(st, { voice: "d1", text: LONG, cacheScope: "s" });
  // Its voice is drawn from the description on every request: one piece, one fixed seed.
  expect(mgr.synths.length).toBe(1);
  expect(mgr.synths[0].seed).toBe(descriptionSeed("d1"));
  expect(await probeLineCached(st, "d1", LONG, { cacheScope: "s" })).toBe(true); // the probe agrees
  await renderLine(st, { voice: "d1", text: LONG, cacheScope: "s", seed: 7 }); // a set seed still wins
  expect(mgr.synths.at(-1).seed).toBe(7);
});

test("a_description_seed_is_stable_and_per_voice", () => {
  expect(descriptionSeed("d1")).toBe(descriptionSeed("d1"));
  expect(descriptionSeed("d1")).not.toBe(descriptionSeed("d2"));
  expect(descriptionSeed("d1") >= 0 && descriptionSeed("d1") < 2 ** 31).toBe(true);
});

// ─── the calibrating warm-up ─────────────────────────────────────────────────

class Srv {
  constructor(fail = null) {
    this.calls = [];
    this.fail = fail;
  }
  async speech(body) {
    if (this.fail) throw new AudioCppError(this.fail);
    this.calls.push(body);
    return [Buffer.alloc(0), {}];
  }
  async transcribe(body) {
    this.calls.push(body);
    return { text: "" };
  }
}

function slot(engine, variant, srv) {
  const s = Object.create(slotMod.AudioCppSlot.prototype);
  s.manifest = discoverEngines().get(engine);
  s._row = s.manifest.module.VARIANTS.find((r) => r.id === variant);
  vi.spyOn(slotMod.AudioCppSlot.prototype, "_srv").mockReturnValue(srv);
  return s;
}

test("a_calibrating_warm_up_is_a_full_length_piece", async () => {
  for (const [engine, variant, chars, longest] of [
    ["qwen3", "qwen3-cv-1.7b-q8", 200, 200],
    ["qwen3", "qwen3-vd-1.7b-q8", 800, 800],
    ["voxcpm2", "voxcpm2-q8", 200, 200],
    ["kokoro", "kokoro-82m-q8", 800, 240], // never past audio.cpp's own budget
    ["kitten", "kitten-mini-0.8", 800, 400],
  ]) {
    const srv = new Srv();
    const s = slot(engine, variant, srv);
    expect(await s._warm(chars)).toBe(true);
    const text = srv.calls[0].input.replace(/^\(A calm, clear voice\)/, "");
    expect(text.length, variant).toBeGreaterThanOrEqual(longest - 40);
    expect(text.length, variant).toBeLessThanOrEqual(longest);
    srv.calls.length = 0;
    expect(await s._warm(0)).toBe(false);
    expect(srv.calls[0].input.endsWith("Ready.")).toBe(true);
  }
});

test("voicedesign_warms_from_words_and_a_clip_only_family_cannot_calibrate", async () => {
  const srv = new Srv();
  let s = slot("qwen3", "qwen3-vd-1.7b-q8", srv);
  await s._warm(0);
  expect(srv.calls[0].instructions).toBeTruthy();
  expect("options" in srv.calls[0]).toBe(false);
  srv.calls.length = 0;
  s = slot("chatterbox", "chatterbox-multilingual-v2-q8", srv);
  expect(await s._warm(200)).toBe(false);
  expect(srv.calls).toEqual([]);
  s = slot("qwen3", "qwen3-base-1.7b-q8", srv);
  expect(await s._warm(200)).toBe(false);
  expect(srv.calls).toEqual([]);
});

test("speech_recognition_calibrates_with_its_own_chunk_of_audio", async () => {
  const srv = new Srv();
  const s = slot("asr", "qwen3-asr-1.7b-q8", srv);
  expect(await s._warm(800)).toBe(true);
  const [fmt] = parseWavHeader(readFileSync(srv.calls[0].audio));
  expect(Math.round(fmt.durationSec)).toBe(30);
});

test("a_failed_warm_up_fails_the_load", async () => {
  // Until 2026-10-04 it was logged and the Load said ready (audit §5 B4).
  const s = slot("kokoro", "kokoro-82m-q8", new Srv("out of memory"));
  await expect(s._warm(0)).rejects.toThrow(/out of memory/);
});
