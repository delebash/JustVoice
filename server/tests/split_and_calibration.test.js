// SPDX-License-Identifier: MIT
// Bound the work, then price it (audit 2026-10-04 §13.3): a split size per model, a fixed seed
// for a description voice, and the calibrating warm-up a model with no price on the card
// measures its peak with. Since round E (docs/plans/2026-10-29-round-e-onto-the-kit.md §4 step 1)
// the kit's audio.cpp runtime loads the model, runs our warm-up as its hook and keeps the price;
// the piece length is ours (kit_hooks.js `pieceLengthOf`, the one a render splits at —
// render_core.js `lineSplitChars` — and the one the kit prices at), and so is the warm-up (slot.js
// `warmModel`). The port of tests/test_split_and_calibration.py; parametrized tests loop over their
// cases.
import { readFileSync } from "node:fs";
import path from "node:path";
import { AudioCppError } from "@delebash/core/runner/audiocpp";
import { afterEach, expect, test } from "vitest";
import { endSpeech, fakeSpeechRuntime } from "./engines_helpers.js";
import { parseWavHeader } from "../src/audio/wav.js";
import { pieceLengthOf } from "../src/engines/audiocpp/kit_hooks.js";
import { variantOf } from "../src/engines/audiocpp/kit_models.js";
import * as slotMod from "../src/engines/audiocpp/slot.js";
import { modelsFor } from "../src/engines/model_catalog.js";
import { EngineRegistry } from "../src/engines/registry.js";
import { descriptionSeed, lineSplitChars, probeLineCached, renderLine } from "../src/render_core.js";
import { tmpPath } from "./helpers.js";

afterEach(() => endSpeech());

const version = (id) => variantOf(id).row;

// ─── the split size ──────────────────────────────────────────────────────────

/** The app's settings: the user's split per model (`{engine: {version: chars}}`) and the cap. */
const settingsOf = (overrides = {}, cap = 800) => ({
  engines: { engine_overrides: Object.fromEntries(Object.entries(overrides).map(([eid, v]) => [eid, { split_chars: { ...v } }])) },
  generation: { max_chunk_chars: cap },
});

test("a_models_split_size_comes_from_the_user_then_the_catalog", () => {
  const s = settingsOf({ qwen3: { "qwen3-cv-1.7b-q8": 120 } });
  const piece = (engine, id, settings = s) => pieceLengthOf(engine, version(id), settings);
  expect(piece("qwen3", "qwen3-cv-1.7b-q8")).toBe(120); // the user's
  expect(piece("qwen3", "qwen3-base-1.7b-q8")).toBe(200); // the catalog's
  expect(piece("qwen3", "qwen3-base-1.7b-bf16")).toBe(200); // 16-bit rows inherit it
  expect(piece("qwen3", "qwen3-vd-1.7b-q8")).toBe(800); // none yet (it waits for the ear): the global cap
  expect(piece("voxcpm2", "voxcpm2-q8")).toBe(200);
  expect(piece("kokoro", "kokoro-82m-q8")).toBe(240);
  expect(piece("chatterbox", "chatterbox-multilingual-v2-q8")).toBe(800);
  expect(piece("qwen3", "qwen3-cv-1.7b-q8", settingsOf({}, 150))).toBe(150); // never above the cap
});

// ─── the render: pieces of the model's length; a description voice's seed ────

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

/** Every version of `engine` split at `chars` by the user. */
const splitEvery = (engine, chars) => ({ [engine]: Object.fromEntries(modelsFor(engine).map((v) => [v.id, chars])) });

function renderState(tmp, { cache = null, designed = false, overrides = {} } = {}) {
  const settings = {
    limits: { text_max_chars: 5000 },
    cache: { enabled: cache !== null },
    ...settingsOf(overrides),
    generation: { max_chunk_chars: 800, crossfade_ms: 50 },
  };
  const stored = { id: "d1", engine: "qwen3", source: "designed", design_prompt: "A gravel-voiced harbour-master." };
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

/** The text of each piece the runtime was asked to speak. */
const pieces = (svc) => svc.server.calls.filter(([what]) => what === "speech").map(([, body]) => body.input);

test("a_long_line_goes_to_the_model_in_its_own_piece_length", async () => {
  // Kokoro's own piece (240) holds the line; the user's 70 splits it, on the version that speaks.
  let svc = fakeSpeechRuntime();
  const tmp = tmpPath();
  const st = renderState(tmp, { overrides: splitEvery("kokoro", 70) });
  await renderLine(st, { voice: "af_heart", text: LONG });
  const speaking = svc.lines[0].modelId;
  expect(lineSplitChars(st, "kokoro", "af_heart", speaking)).toBe(70);
  expect(pieces(svc).length).toBeGreaterThanOrEqual(3);
  expect(pieces(svc).every((t) => [...t].length <= 70)).toBe(true);
  svc = fakeSpeechRuntime();
  await renderLine(renderState(tmp), { voice: "af_heart", text: LONG });
  expect(pieces(svc).length).toBe(1);
  // No version (a registry engine): the global cap.
  expect(lineSplitChars(renderState(tmp), "kokoro", "af_heart", null)).toBe(800);
});

test("a_description_voice_keeps_one_seed_and_the_full_length", async () => {
  // Every Qwen3 version split at 70 by the user — a description voice still goes in one piece.
  const svc = fakeSpeechRuntime();
  const st = renderState(tmpPath(), { cache: new Cache(), designed: true, overrides: splitEvery("qwen3", 70) });
  // Its description reaches the model as instruct prose, as the compose sites send it.
  const delivery = { instruct: "A gravel-voiced harbour-master." };
  expect(await probeLineCached(st, "d1", LONG, { cacheScope: "s", delivery })).toBe(false);
  await renderLine(st, { voice: "d1", text: LONG, cacheScope: "s", delivery });
  // Its voice is drawn from the description on every request: one piece, one fixed seed.
  expect(svc.lines.map((l) => l.modelId)).toEqual([expect.stringMatching(/^qwen3-vd-/)]);
  expect(lineSplitChars(st, "qwen3", "d1", svc.lines[0].modelId)).toBe(800);
  expect(lineSplitChars(st, "qwen3", "Ryan", svc.lines[0].modelId)).toBe(70); // any other voice on it is split
  expect(pieces(svc)).toHaveLength(1);
  expect(svc.server.calls[0][1].seed).toBe(descriptionSeed("d1"));
  expect(await probeLineCached(st, "d1", LONG, { cacheScope: "s", delivery })).toBe(true); // the probe agrees
  await renderLine(st, { voice: "d1", text: LONG, cacheScope: "s", delivery, seed: 7 }); // a set seed still wins
  expect(svc.server.calls.at(-1)[1].seed).toBe(7);
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

/** The warm-up of version `id` (the kit's server holding it — `srv`), a piece of `chars` when it calibrates. */
const warm = (id, srv, chars) => slotMod.warmModel(srv, version(id), variantOf(id).mod.KIND === "stt" ? "stt" : "tts", chars);

test("a_calibrating_warm_up_is_a_full_length_piece", async () => {
  for (const [variant, chars, longest] of [
    ["qwen3-cv-1.7b-q8", 200, 200],
    ["qwen3-vd-1.7b-q8", 800, 800],
    ["voxcpm2-q8", 200, 200],
    ["kokoro-82m-q8", 800, 240], // never past audio.cpp's own budget
    ["kitten-mini-0.8", 800, 400],
  ]) {
    const srv = new Srv();
    expect(await warm(variant, srv, chars)).toBe(true);
    const text = srv.calls[0].input.replace(/^\(A calm, clear voice\)/, "");
    expect(text.length, variant).toBeGreaterThanOrEqual(longest - 40);
    expect(text.length, variant).toBeLessThanOrEqual(longest);
    srv.calls.length = 0;
    expect(await warm(variant, srv, 0)).toBe(false);
    expect(srv.calls[0].input.endsWith("Ready.")).toBe(true);
  }
});

test("voicedesign_warms_from_words_and_a_clip_only_family_cannot_calibrate", async () => {
  const srv = new Srv();
  await warm("qwen3-vd-1.7b-q8", srv, 0);
  expect(srv.calls[0].instructions).toBeTruthy();
  expect("options" in srv.calls[0]).toBe(false);
  srv.calls.length = 0;
  expect(await warm("chatterbox-multilingual-v2-q8", srv, 200)).toBe(false);
  expect(srv.calls).toEqual([]);
  expect(await warm("qwen3-base-1.7b-q8", srv, 200)).toBe(false);
  expect(srv.calls).toEqual([]);
});

test("speech_recognition_calibrates_with_its_own_chunk_of_audio", async () => {
  const srv = new Srv();
  expect(await warm("qwen3-asr-1.7b-q8", srv, 800)).toBe(true);
  const [fmt] = parseWavHeader(readFileSync(srv.calls[0].audio));
  expect(Math.round(fmt.durationSec)).toBe(30);
});

test("a_failed_warm_up_fails_the_load", async () => {
  // Until 2026-10-04 it was logged and the Load said ready (audit §5 B4): the warm-up throws
  // audio.cpp's own words, which fail the kit's load.
  await expect(warm("kokoro-82m-q8", new Srv("out of memory"), 0)).rejects.toThrow(/out of memory/);
});
