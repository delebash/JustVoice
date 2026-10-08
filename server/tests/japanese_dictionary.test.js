// SPDX-License-Identifier: MIT
// The optional Japanese dictionary (gap 7, docs/plans/2026-10-03-gap-7-more-languages.md):
// unidic-lite downloads, is verified and unpacks to only its dictionary and licences; the
// runtime finds it through AUDIOCPP_UNIDIC_DIR; a Japanese line without it is refused by name;
// the catalogs follow the pin (the port of tests/test_japanese_dictionary.py).
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import * as download from "@delebash/llm-runner/runner/download";
import { afterEach, expect, test, vi } from "vitest";
import "./engines_helpers.js";
import * as speechRuntimeApi from "../src/api/speech_runtime_api.js";
import * as japanese from "../src/engines/audiocpp/japanese.js";
import * as release from "../src/engines/audiocpp/release.js";
import * as runtime from "../src/engines/audiocpp/runtime.js";
import * as slot from "../src/engines/audiocpp/slot.js";
import * as chatterbox from "../src/engines/chatterbox/manifest.js";
import * as kokoro from "../src/engines/kokoro/manifest.js";
import * as manager from "../src/engines/manager.js";
import { discoverEngines } from "../src/engines/manager.js";
import { tmpPath } from "./helpers.js";

const DIC = `unidic-lite-${japanese.VERSION}/unidic_lite/dicdir/`;
const TAG = release.cfg.TAG;
const SHA = japanese.cfg.SHA256;
afterEach(() => {
  release.cfg.TAG = TAG;
  japanese.cfg.SHA256 = SHA;
});

/** A ustar tar.gz of `files` (name → bytes). */
function tarGz(files) {
  const blocks = [];
  for (const [name, data] of Object.entries(files)) {
    const h = Buffer.alloc(512);
    h.write(name, 0, 100, "utf8");
    h.write("0000644\0", 100);
    h.write("0000000\0", 108);
    h.write("0000000\0", 116);
    h.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124);
    h.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, "0")}\0`, 136);
    h.write("        ", 148);
    h.write("0", 156);
    h.write("ustar\0", 257);
    h.write("00", 263);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

/** A small stand-in for the sdist: the dictionary folder, the licences, and the Python wrapper
 * that must be left behind. */
const sdist = () =>
  tarGz({
    [`${DIC}dicrc`]: Buffer.from("; dicrc\n"),
    [`${DIC}sys.dic`]: Buffer.alloc(64),
    [`${DIC}BSD`]: Buffer.from("bsd"),
    [`unidic-lite-${japanese.VERSION}/LICENSE`]: Buffer.from("mit"),
    [`unidic-lite-${japanese.VERSION}/LICENSE.unidic`]: Buffer.from("unidic"),
    [`unidic-lite-${japanese.VERSION}/unidic_lite/__init__.py`]: Buffer.from("print('no')"),
    [`unidic-lite-${japanese.VERSION}/setup.py`]: Buffer.alloc(0),
  });

function fakeDownload() {
  const blob = sdist();
  const calls = [];
  vi.spyOn(download, "streamDownload").mockImplementation(async (url, dest, { onProgress } = {}) => {
    calls.push(url);
    writeFileSync(dest, blob);
    if (onProgress) onProgress(blob.length, blob.length);
  });
  japanese.cfg.SHA256 = createHash("sha256").update(blob).digest("hex");
  return calls;
}

test("it_unpacks_only_the_dictionary_and_its_licences", async () => {
  const calls = fakeDownload();
  const root = path.join(tmpPath(), "rt");
  const seen = [];
  const got = await japanese.install(root, { onProgress: (done, total) => seen.push([done, total]) });
  expect(got).toBe(japanese.home(root));
  expect(japanese.dictionaryDir(root)).toBe(got);
  expect(readdirSync(got).sort()).toEqual(["BSD", "LICENSE", "LICENSE.unidic", "dicrc", "sys.dic"]);
  expect(seen.length).toBeGreaterThan(0);
  const left = readdirSync(path.join(root, "audiocpp"));
  expect(left.filter((n) => n.endsWith(".tar.gz") || n.endsWith(".staging"))).toEqual([]);
  await japanese.install(root); // idempotent: no second download
  expect(calls).toEqual([japanese.URL]);
});

test("a_tampered_download_is_refused", async () => {
  fakeDownload();
  japanese.cfg.SHA256 = "0".repeat(64);
  const root = path.join(tmpPath(), "rt");
  await expect(japanese.install(root)).rejects.toThrow(/checksum mismatch/);
  expect(japanese.dictionaryDir(root)).toBeNull();
});

test("the_runtime_is_told_where_the_dictionary_is", () => {
  const tmp = tmpPath();
  vi.spyOn(runtime, "_runtimeRoot").mockReturnValue(tmp);
  vi.stubEnv("AUDIOCPP_UNIDIC_DIR", "stale");
  expect("AUDIOCPP_UNIDIC_DIR" in runtime._childEnv()).toBe(false);
  mkdirSync(japanese.home(tmp), { recursive: true });
  writeFileSync(path.join(japanese.home(tmp), "dicrc"), "x");
  expect(runtime._childEnv().AUDIOCPP_UNIDIC_DIR).toBe(japanese.home(tmp));
});

const kokoroRow = () => discoverEngines().get("kokoro").module.VARIANTS.find((r) => r.id === "kokoro-82m-q8");
const CB = { id: "chatterbox-multilingual-v2-q8", audiocpp: { family: "chatterbox", task: "clon", file: "c.gguf" } };

test("a_japanese_line_is_refused_by_name_until_the_dictionary_is_here", () => {
  const tmp = tmpPath();
  vi.spyOn(manager, "enginesRuntimeRoot").mockReturnValue(tmp);
  expect(() => slot.toSpeechRequest(kokoroRow(), { voice_id: "jf_alpha", text: "こんにちは。" })).toThrow(
    "Japanese needs the Japanese dictionary — install it on AI Settings → Speech engines.",
  );
  expect(() => slot.toSpeechRequest(CB, { text: "こんにちは。", language: "ja", audio_prompt_path: "C:/v.wav" })).toThrow(/Japanese dictionary/);
  // Other languages never ask for it.
  expect(slot.toSpeechRequest(kokoroRow(), { voice_id: "af_heart", text: "Hi." }).language).toBe("en-us");
  mkdirSync(japanese.home(tmp), { recursive: true });
  writeFileSync(path.join(japanese.home(tmp), "dicrc"), "x");
  expect(slot.toSpeechRequest(kokoroRow(), { voice_id: "jf_alpha", text: "こんにちは。" }).language).toBe("ja");
  expect(slot.toSpeechRequest(CB, { text: "こんにちは。", language: "ja", audio_prompt_path: "C:/v.wav" }).language).toBe("ja");
});

test("languages_and_voices_follow_the_pin", () => {
  // Python reloaded the manifests under each pin; here their pin-dependent half is built again.
  release.cfg.TAG = "v0.9.0-jv.1";
  expect(chatterbox.build().VARIANTS[0].languages.length).toBe(19);
  expect(kokoro.build().STATIC_VOICES.length).toBe(49);
  release.cfg.TAG = "v0.9.0-jv.4";
  const cb = chatterbox.build();
  for (const l of ["he", "ru", "zh", "ja"]) expect(cb.VARIANTS[0].languages).toContain(l);
  expect(cb.VARIANTS[0].name).toBe("Chatterbox Multilingual (23 languages)");
  expect(kokoro.build().STATIC_VOICES.length).toBe(54);
});

test("the_runtime_row_offers_it_only_once_the_pin_reads_japanese", () => {
  release.cfg.TAG = "v0.9.0-jv.1";
  expect(speechRuntimeApi._japaneseDictionary()).toBeNull();
  release.cfg.TAG = "v0.9.0-jv.4";
  const info = speechRuntimeApi._japaneseDictionary();
  expect(info.version).toBe(japanese.VERSION);
  expect(info.size_bytes).toBe(japanese.INSTALLED_BYTES);
});


