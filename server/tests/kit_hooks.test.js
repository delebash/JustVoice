// SPDX-License-Identifier: MIT
// JustVoice's hooks on the kit's audio.cpp runtime (round E, docs/plans/2026-10-29-round-e-onto-the-
// kit.md §3.3, §4 step 1 — engines/audiocpp/kit_hooks.js): a load's warm-up and whether it calibrated,
// the piece length a price is measured at (the 800-character cap, the catalog's piece, the user's
// own), the load-option set, the saved load options, a transcription's request and time limit, and
// the licence gate before a download — each read from the model's kit row.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { endState, useState, wav } from "./engines_helpers.js";
import { stores } from "@delebash/core/llm";
import * as hooks from "../src/engines/audiocpp/kit_hooks.js";
import { runtimeModelRows, variantOf } from "../src/engines/audiocpp/kit_models.js";
import * as runtimeOptions from "../src/engines/audiocpp/runtime_options.js";
import * as slot from "../src/engines/audiocpp/slot.js";
import { tmpPath } from "./helpers.js";

afterEach(() => endState());

const rows = runtimeModelRows();
const rowOf = (id) => rows.find((r) => r.id === id);

/** A server that answers every request and remembers it. */
function fakeServer() {
  const calls = [];
  return {
    calls,
    speech: async (body) => {
      calls.push(["speech", body]);
      return [wav(0.1), {}];
    },
    transcribe: async (body) => {
      calls.push(["transcribe", body]);
      return { text: "" };
    },
  };
}

test("the piece length: the catalog's piece under the 800-character cap, the user's own, the cap itself", () => {
  const st = useState();
  const kokoro = rowOf("kokoro-82m-q8");
  const index = rowOf("index_tts2-indextts2-q8");
  expect(hooks.pieceLength(kokoro)).toBe(240);
  expect(hooks.pieceLength(index)).toBe(800);
  st.settings.patch({ generation: { max_chunk_chars: 500 } });
  expect(hooks.pieceLength(kokoro)).toBe(240);
  expect(hooks.pieceLength(index)).toBe(500);
  st.settings.patch({ engines: { engine_overrides: { kokoro: { split_chars: { "kokoro-82m-q8": 120 } } } } });
  expect(hooks.pieceLength(kokoro)).toBe(120);
  expect(hooks.pieceLength(rowOf("kokoro-82m-bf16"))).toBe(240);
});

test("the load options: the set a price is kept under, and the ones every load registers", () => {
  const st = useState();
  const row = rowOf("qwen3-cv-1.7b-q8");
  const own = variantOf(row.id).row;
  expect(hooks.loadOptionsKey(row)).toBe("");
  st.settings.patch({ engines: { engine_overrides: { qwen3: { runtime_options: { "qwen3-cv-1.7b-q8": { "qwen3_tts.perf_mode": "flash_attention" } } } } } });
  expect(hooks.loadOptionsKey(row)).toBe("qwen3_tts.perf_mode=flash_attention");
  expect(hooks.loadOptionsKey(row)).toBe(runtimeOptions.priceKeyFor("qwen3", own));
  expect(hooks.sessionOptions(row)).toEqual(runtimeOptions.sessionOptionsFor("qwen3", own));
  expect(hooks.sessionOptions(row)["qwen3_tts.perf_mode"]).toBe("flash_attention");
});

test("a download waits for the licence the user hasn't accepted — answered at once", () => {
  const st = useState();
  const row = rowOf("index_tts2-indextts2-q8");
  expect(() => hooks.beforeDownload(row)).toThrow(/Accept .*licence before downloading its models/);
  st.settings.patch({ engines: { engine_overrides: { index_tts2: { terms_accepted_at: "2026-10-29T00:00:00Z" } } } });
  expect(hooks.beforeDownload(row)).toBeUndefined();
  // Kyutai's terms gate cloning, not the download
  expect(hooks.beforeDownload(rowOf("pocket-en-q8"))).toBeUndefined();
  expect(hooks.beforeDownload(rowOf("kokoro-82m-q8"))).toBeUndefined();
});

test("the warm-up: a full-length piece when it calibrates, a word when it doesn't, nothing without a voice", async () => {
  useState();
  let srv = fakeServer();
  expect(await hooks.warm({ server: srv, row: rowOf("kokoro-82m-q8"), modelId: "kokoro-82m-q8", entries: [], calibrate: true })).toBe(true);
  expect(srv.calls).toEqual([["speech", { model: "kokoro-82m-q8", input: slot.calibrationText(240), voice: "af_heart", language: "en-us", seed: 1 }]]);
  srv = fakeServer();
  expect(await hooks.warm({ server: srv, row: rowOf("kokoro-82m-q8"), modelId: "kokoro-82m-q8", entries: [], calibrate: false })).toBe(false);
  expect(srv.calls[0][1].input).toBe("Ready.");
  // speech recognition hears its 30 s chunk of silence
  srv = fakeServer();
  expect(await hooks.warm({ server: srv, row: rowOf("qwen3-asr-1.7b-q8"), modelId: "qwen3-asr-1.7b-q8", entries: [], calibrate: true })).toBe(true);
  expect(srv.calls).toEqual([["transcribe", { model: "qwen3-asr-1.7b-q8", language: "English", audio: slot._silencePath(slot.CALIBRATION_AUDIO_S) }]]);
  // Pocket TTS French has no preset: its first line sets its price
  srv = fakeServer();
  expect(await hooks.warm({ server: srv, row: rowOf("pocket-fr-q8"), modelId: "pocket-fr-q8", entries: [], calibrate: true })).toBe(false);
  expect(srv.calls).toEqual([]);
});

test("a transcription: the language named as the model takes it, the limit three times the recording or the runtime's", async () => {
  useState();
  stores.getRunnerConfigStore().setSetting("request_timeout_s:audiocpp", "10");
  const clip = path.join(tmpPath("jv-kit-asr-"), "clip.wav");
  writeFileSync(clip, wav(5, 16000));
  const asr = rowOf("qwen3-asr-1.7b-q8");
  const out = await hooks.transcribe({ audio_path: clip, language: "de-DE" }, asr);
  expect(out).toEqual({ body: { model: "qwen3-asr-1.7b-q8", audio: clip.replaceAll("\\", "/"), language: "German" }, timeout: 15 });
  // a language Qwen3-ASR doesn't name is detected; a short clip gets the runtime's limit
  stores.getRunnerConfigStore().setSetting("request_timeout_s:audiocpp", "900");
  expect(await hooks.transcribe({ audio_path: clip, language: "xx" }, asr)).toEqual({ body: { model: "qwen3-asr-1.7b-q8", audio: clip.replaceAll("\\", "/") }, timeout: 900 });
  // every other recogniser: its spec's form of the language
  const other = rows.find((r) => r.kind === "stt" && r.spec.family !== "qwen3_asr");
  const shaped = await hooks.transcribe({ audio_path: clip, language: "en" }, other);
  expect(shaped.body).toEqual(slot.generatedTranscribeRequest(variantOf(other.id).row, { audio_path: clip, language: "en" }, clip.replaceAll("\\", "/")));
  expect(shaped.timeout).toBe(900);
});
