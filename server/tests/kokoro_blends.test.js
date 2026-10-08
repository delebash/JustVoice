// SPDX-License-Identifier: MIT
// Kokoro blends on the speech runtime (gap 2, docs/plans/2026-10-03-gap-2-kokoro-blends.md):
// the voices are read from the GGUF's embedded files, a blend renders through our audio.cpp's
// `voice_pack` option, and an older runtime refuses by name (the port of
// tests/test_kokoro_blends.py).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import "./engines_helpers.js";
import * as dspClient from "../src/audio/dsp_client.js";
import * as blending from "../src/engines/blending.js";
import { embeddedFiles } from "../src/engines/audiocpp/gguf_files.js";
import * as release from "../src/engines/audiocpp/release.js";
import * as runtime from "../src/engines/audiocpp/runtime.js";
import * as slot from "../src/engines/audiocpp/slot.js";
import { discoverEngines } from "../src/engines/manager.js";
import { tmpPath } from "./helpers.js";

afterAll(() => dspClient.stop());
const TAG = release.cfg.TAG;
afterEach(() => {
  release.cfg.TAG = TAG;
});

const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
const s = (text) => {
  const raw = Buffer.from(text, "utf8");
  return Buffer.concat([u64(raw.length), raw]);
};

/** A minimal GGUF v3: two unrelated keys around the three embedded-file arrays. */
function ggufWithFiles(file, files) {
  const names = Object.keys(files);
  const offsets = [0];
  let data = Buffer.alloc(0);
  for (const n of names) {
    data = Buffer.concat([data, files[n]]);
    offsets.push(data.length);
  }
  const kv = [
    Buffer.concat([s("general.name"), u32(8), s("tiny")]),
    Buffer.concat([s("audiocpp.embedded_files.names"), u32(9), u32(8), u64(names.length), ...names.map(s)]),
    Buffer.concat([s("audiocpp.embedded_files.offsets"), u32(9), u32(10), u64(offsets.length), ...offsets.map(u64)]),
    Buffer.concat([s("audiocpp.embedded_files.data"), u32(9), u32(0), u64(data.length), data]),
    Buffer.concat([s("general.after"), u32(4), u32(7)]),
  ];
  writeFileSync(file, Buffer.concat([Buffer.from("GGUF"), u32(3), u64(0), u64(kv.length), ...kv]));
  return file;
}

const ROWS = 3;
const voice = (seed) => {
  const b = Buffer.alloc(ROWS * 256 * 4);
  for (let i = 0; i < ROWS * 256; i++) b.writeFloatLE(seed, i * 4);
  return b;
};

let kokoroGguf;
beforeEach(() => {
  const voices = { af_heart: voice(1.0), am_adam: voice(3.0) };
  const files = {
    "voices.json": Buffer.from(JSON.stringify(Object.fromEntries(Object.keys(voices).map((n) => [n, { rows: ROWS, cols: 256, path: `${n}.bin` }])))),
    ...Object.fromEntries(Object.entries(voices).map(([n, v]) => [`voices/${n}.bin`, v])),
    "config.json": Buffer.from("{}"),
  };
  kokoroGguf = ggufWithFiles(path.join(tmpPath(), "kokoro.gguf"), files);
  vi.spyOn(blending, "_kokoroGguf").mockReturnValue(kokoroGguf);
  blending._PACK_CACHE.clear();
});
afterEach(() => blending._PACK_CACHE.clear());

test("the_reader_returns_every_embedded_file", () => {
  const files = embeddedFiles(kokoroGguf);
  expect(new Set(files.keys())).toEqual(new Set(["voices.json", "voices/af_heart.bin", "voices/am_adam.bin", "config.json"]));
  expect(files.get("voices/af_heart.bin").length).toBe(ROWS * 256 * 4);
});

test("a_gguf_without_embedded_files_reads_as_none", () => {
  const tmp = tmpPath();
  expect(embeddedFiles(ggufWithFiles(path.join(tmp, "x.gguf"), {})).size).toBe(0);
  const plain = path.join(tmp, "plain.gguf");
  writeFileSync(plain, Buffer.concat([Buffer.from("GGUF"), u32(3), u64(0), u64(0)]));
  expect(embeddedFiles(plain).size).toBe(0);
});

test("blends_are_made_from_the_ggufs_voices", async () => {
  const tmp = tmpPath();
  const [pack, names, features] = blending._kokoroPack(tmp);
  expect(names).toEqual(["af_heart", "am_adam"]);
  expect(pack.get("af_heart").length).toBe(ROWS * 256 * 4);
  expect(features).toBe(256);
  const mix = await blending.blend("kokoro", ["af_heart", "am_adam"], [0.5, 0.5], { dataDir: tmp, resolveStored: () => null });
  expect(mix.length).toBe(ROWS * 256);
  expect(mix[0]).toBeCloseTo(2.0, 6);
  const mean = await blending.packMean("kokoro", { dataDir: tmp });
  expect(mean[0]).toBeCloseTo(2.0, 6);
  const spliced = await blending.recombine(
    "kokoro",
    [
      ["af_heart", 0.0, 0.5],
      ["am_adam", 0.5, 1.0],
    ],
    { dataDir: tmp, resolveStored: () => null },
  );
  expect(spliced[0]).toBeCloseTo(1.0, 6);
  expect(spliced[200]).toBeCloseTo(3.0, 6);
});

test("no_kokoro_download_says_so", () => {
  vi.restoreAllMocks();
  expect(() => blending._kokoroGguf(tmpPath())).toThrow(/Kokoro is not downloaded/);
});

// ── the runtime and the slot ─────────────────────────────────────────────

test("features_follow_the_build_order", () => {
  // jv.2 and jv.3 were never published; blends arrive in jv.4 (decided 2026-10-04).
  for (const [tag, expected] of [
    ["v0.9.0", false],
    ["v0.9.0-jv.1", false],
    ["v0.9.0-jv.2", false],
    ["v0.9.0-jv.4", true],
    [null, false],
    ["v9-unknown", false],
  ]) {
    vi.spyOn(runtime, "installedTag").mockReturnValue(tag);
    expect(runtime.hasFeature("voice_pack"), String(tag)).toBe(expected);
  }
  release.cfg.TAG = "v0.9.0";
  expect(release.pinnedHas("voice_pack")).toBe(false);
  release.cfg.TAG = "v0.9.0-jv.4";
  expect(release.pinnedHas("voice_pack")).toBe(true);
});

const kokoroRow = () => discoverEngines().get("kokoro").module.VARIANTS.find((r) => r.id === "kokoro-82m-q8");

test("a_blend_rides_voice_pack_with_a_preset_of_its_language", () => {
  for (const [lang, v, code] of [
    ["en-US", "af_alloy", "en-us"],
    ["en-GB", "bf_alice", "en-gb"],
    ["zh", "zf_xiaobei", "zh"],
  ]) {
    const req = slot.toSpeechRequest(kokoroRow(), { voice_id: "v_blend", text: "Hi.", language: lang, voice_pack_path: "C:\\cache\\p.bin" });
    expect([req.voice, req.language, req.options]).toEqual([v, code, { voice_pack: "C:/cache/p.bin" }]);
  }
});

test("the_pack_file_is_written_once_by_content", () => {
  vi.spyOn(slot, "_dataDir").mockReturnValue(tmpPath());
  const vec = new Array(ROWS * 256).fill(2.0);
  const p1 = slot.writeVoicePack(vec);
  const p2 = slot.writeVoicePack(vec);
  expect(p1).toBe(p2);
  const want = Buffer.alloc(vec.length * 4);
  vec.forEach((x, i) => want.writeFloatLE(x, i * 4));
  expect(readFileSync(p1).equals(want)).toBe(true);
  expect(() => slot.writeVoicePack([1.0, 2.0])).toThrow(/rows × 256/);
});

function blendSlot(family) {
  const sl = Object.create(slot.AudioCppSlot.prototype);
  Object.assign(sl, { manifest: { name: "Kokoro", id: "kokoro", module: {} }, _row: { id: "m", audiocpp: { family } }, placement: "gpu" });
  sl.isAlive = () => true;
  return sl;
}

test("an_older_runtime_refuses_a_blend_by_name", async () => {
  vi.spyOn(runtime, "hasFeature").mockReturnValue(false);
  // The pin has blends: an update brings them. It doesn't: this version can't (audit §5 E3).
  vi.spyOn(release, "pinnedHas").mockReturnValue(true);
  let r = await blendSlot("kokoro_tts")._synth({ voice_vector: new Array(256).fill(0.0), text: "Hi." });
  expect(r.statusCode).toBe(409);
  expect(r.json().detail).toContain("speech runtime update");
  vi.spyOn(release, "pinnedHas").mockReturnValue(false);
  r = await blendSlot("kokoro_tts")._synth({ voice_vector: new Array(256).fill(0.0), text: "Hi." });
  expect(r.statusCode).toBe(409);
  expect(r.json().detail).toContain("Blended voices");
  expect(r.json().detail).toContain("isn't in this version");
  r = await blendSlot("qwen3_tts")._synth({ voice_vector: new Array(256).fill(0.0), text: "Hi." });
  expect(r.statusCode).toBe(422);
  expect(r.json().detail).toContain("blends are Kokoro's");
});
