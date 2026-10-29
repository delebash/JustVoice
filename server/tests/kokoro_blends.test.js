// SPDX-License-Identifier: MIT
// Kokoro blends on the speech runtime (gap 2, docs/plans/2026-10-03-gap-2-kokoro-blends.md):
// the voices are read from the GGUF's embedded files — since round E (docs/plans/2026-10-29-
// round-e-onto-the-kit.md) the Kokoro file in the kit's models cache — a blend renders through our
// audio.cpp's `voice_pack` option, written for the line, and a build pinned before jv.4 refuses
// it by name before anything loads (slot.js `checkLine` on kit_settings.js `runtimeHas`; the port
// of tests/test_kokoro_blends.py).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import { stores } from "@delebash/core/llm";
import { pinKey } from "@delebash/core/runner/runtimes";
import { endSpeech, endState, fakeServer, fakeSpeechRuntime, useState } from "./engines_helpers.js";
import * as dspClient from "../src/audio/dsp_client.js";
import * as blending from "../src/engines/blending.js";
import { embeddedFiles } from "../src/engines/audiocpp/gguf_files.js";
import * as kitSettings from "../src/engines/audiocpp/kit_settings.js";
import * as kitSpeech from "../src/engines/audiocpp/kit_speech.js";
import { variantOf } from "../src/engines/audiocpp/kit_models.js";
import * as slot from "../src/engines/audiocpp/slot.js";
import { discoverEngines } from "../src/engines/model_catalog.js";
import { voiceSynthFields } from "../src/render_core.js";
import { tmpPath } from "./helpers.js";

afterAll(() => dspClient.stop());
afterEach(() => {
  endSpeech();
  endState();
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
  // Kokoro downloaded: its file in the kit's models cache.
  fakeSpeechRuntime({ onDisk: ["kokoro-82m-q8"], files: { "kokoro-82m-q8": { model: kokoroGguf } } });
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
  expect(blending._kokoroGguf()).toBe(kokoroGguf);
  const [pack, names, features] = blending._kokoroPack();
  expect(names).toEqual(["af_heart", "am_adam"]);
  expect(pack.get("af_heart").length).toBe(ROWS * 256 * 4);
  expect(features).toBe(256);
  const mix = await blending.blend("kokoro", ["af_heart", "am_adam"], [0.5, 0.5], { resolveStored: () => null });
  expect(mix.length).toBe(ROWS * 256);
  expect(mix[0]).toBeCloseTo(2.0, 6);
  const mean = await blending.packMean("kokoro");
  expect(mean[0]).toBeCloseTo(2.0, 6);
  const spliced = await blending.recombine(
    "kokoro",
    [
      ["af_heart", 0.0, 0.5],
      ["am_adam", 0.5, 1.0],
    ],
    { resolveStored: () => null },
  );
  expect(spliced[0]).toBeCloseTo(1.0, 6);
  expect(spliced[200]).toBeCloseTo(3.0, 6);
});

test("no_kokoro_download_says_so", () => {
  fakeSpeechRuntime();
  expect(() => blending._kokoroGguf()).toThrow(/Kokoro is not downloaded/);
});

// ── the runtime and the slot ─────────────────────────────────────────────

test("features_follow_the_build_order", () => {
  // The build the kit pins on this computer decides; jv.2 and jv.3 were never published; blends
  // arrive in jv.4 (decided 2026-10-04).
  useState();
  for (const [tag, expected] of [
    ["v0.9.0", false],
    ["v0.9.0-jv.1", false],
    ["v0.9.0-jv.2", false],
    ["v0.9.0-jv.4", true],
    ["v9-unknown", false],
  ]) {
    stores.getRunnerConfigStore().setSetting(pinKey("audiocpp"), tag);
    expect(kitSettings.runtimeHas("voice_pack"), tag).toBe(expected);
  }
  // The build the app ships has them.
  expect(kitSettings.shippedHas("voice_pack")).toBe(true);
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

test("a_blend_in_a_language_kokoro_lacks_sends_none_and_a_preset_of_the_voices_own", () => {
  // The narrowings review, F11: no language goes, and the preset is the voice's own language's.
  const req = slot.toSpeechRequest(kokoroRow(), { voice_id: "v_blend", text: "Hi.", language: "de", voice_pack_path: "C:\\cache\\p.bin" });
  expect("language" in req).toBe(false);
  expect(req.voice).toBe("af_alloy");
  expect(req.options).toEqual({ voice_pack: "C:/cache/p.bin" });
});

test("a_blend_speaks_its_own_language_where_kokoro_lacks_the_lines", () => {
  // Decided 2026-10-15 (F11): render and preview pass a blend's own language, as a preset's id
  // carries its own, so a line in a language Kokoro lacks is read in the blend's — not English.
  const body = { voice_id: "v_blend", text: "Hola.", voice_pack_path: "C:\cache\p.bin", voice_language: "es" };
  const foreign = slot.toSpeechRequest(kokoroRow(), { ...body, language: "de" });
  expect("language" in foreign).toBe(false);
  expect(foreign.voice).toBe("ef_dora");
  // No line language: the blend's own goes.
  const own = slot.toSpeechRequest(kokoroRow(), body);
  expect([own.voice, own.language]).toEqual(["ef_dora", "es"]);
  // Render and preview put it in the synth body from the voice's record.
  const fields = voiceSynthFields(null, { id: "v_blend", source: "blended", embedding: [0.5, 0.25], language: "es" });
  expect(fields).toEqual({ voice_vector: [0.5, 0.25], voice_language: "es" });
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

/** What `checkLine` refuses `body` on model version `id` with, or null when the line can go. */
function refusal(id, body) {
  try {
    slot.checkLine(variantOf(id), body);
  } catch (e) {
    return e;
  }
  return null;
}

test("an_older_runtime_refuses_a_blend_by_name", () => {
  const line = { voice_vector: new Array(256).fill(0.0), text: "Hi." };
  vi.spyOn(kitSettings, "runtimeHas").mockReturnValue(false);
  // The build the app ships has blends: an update brings them. It doesn't: this version can't
  // (audit §5 E3).
  vi.spyOn(kitSettings, "shippedHas").mockReturnValue(true);
  let e = refusal("kokoro-82m-q8", line);
  expect(e).toBeInstanceOf(kitSpeech.EngineRequestError);
  expect(e.status).toBe(409);
  expect(e.message).toContain("speech runtime update");
  vi.mocked(kitSettings.shippedHas).mockReturnValue(false);
  e = refusal("kokoro-82m-q8", line);
  expect(e.status).toBe(409);
  expect(e.message).toContain("Blended voices");
  expect(e.message).toContain("isn't in this version");
  // A model with no blends says so, whatever the build.
  e = refusal("qwen3-cv-1.7b-q8", { ...line, voice_id: "Ryan" });
  expect(e.status).toBe(422);
  expect(e.message).toContain("blends are Kokoro's");
});

test("a_blend_reaches_kokoro_as_its_pack", async () => {
  // On a build that has blends the line goes: its vector written as a pack file, sent as
  // `voice_pack` with a preset of its language.
  vi.spyOn(slot, "_dataDir").mockReturnValue(tmpPath());
  vi.spyOn(kitSettings, "runtimeHas").mockReturnValue(true);
  const vec = new Array(ROWS * 256).fill(2.0);
  const line = { voice_id: "v_blend", text: "Hi.", seed: 7, voice_vector: vec, voice_language: "en-US" };
  expect(refusal("kokoro-82m-q8", line)).toBeNull();
  const srv = fakeServer();
  await slot.speak(srv, variantOf("kokoro-82m-q8").row, line);
  const pack = slot.writeVoicePack(vec).replaceAll("\\", "/");
  expect(srv.calls).toEqual([["speech", { model: "kokoro-82m-q8", input: "Hi.", seed: 7, voice: "af_alloy", language: "en-us", options: { voice_pack: pack } }]]);
});
