// SPDX-License-Identifier: MIT
// A Qwen3-TTS Base reference reaches the runtime with its digital silence filled (decided
// 2026-10-11, TASKS FINDING "Digital silence in a clone reference…"): stretches of exact zeros ran
// the model on without stopping; the same stretches at ±2 LSB clone normally.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { parseWavHeader, writeWavContainer } from "../src/audio/wav.js";
import { discoverEngines } from "../src/engines/model_catalog.js";
import * as slot from "../src/engines/audiocpp/slot.js";
import { toSpeechRequest } from "../src/engines/audiocpp/slot.js";
import { tmpPath } from "./helpers.js";

const RATE = 24000;
const KEPT = slot.cfg.REFERENCES_KEPT;
afterEach(() => {
  slot.cfg.REFERENCES_KEPT = KEPT;
  vi.restoreAllMocks();
});

/** Mono 16-bit speech-like noise with exact-zero gaps of `gapS` seconds after each second. */
function clip(seconds, gapS = 0) {
  const parts = [];
  let x = 1;
  for (let s = 0; s < seconds; s++) {
    const pcm = Buffer.alloc(RATE * 2);
    for (let i = 0; i < RATE; i++) {
      x = (x * 48271) % 2147483647;
      pcm.writeInt16LE((x % 6001) - 3000, i * 2);
    }
    parts.push(pcm);
    if (gapS) parts.push(Buffer.alloc(Math.round(RATE * gapS) * 2));
  }
  return Buffer.concat(parts);
}
const runs = (pcm, minFrames) => {
  let n = 0;
  let run = 0;
  for (let i = 0; i <= pcm.length / 2; i++) {
    if (i < pcm.length / 2 && pcm.readInt16LE(i * 2) === 0) run++;
    else {
      if (run >= minFrames) n++;
      run = 0;
    }
  }
  return n;
};

test("a_run_of_exact_zeros_is_filled_and_the_rest_left_alone", () => {
  const pcm = clip(3, 0.25);
  const filled = slot.fillDigitalSilence(pcm, 1, 240, 2);
  expect(filled.length).toBe(pcm.length);
  expect(runs(pcm, 240)).toBe(3);
  expect(runs(filled, 240)).toBe(0);
  for (let i = 0; i < pcm.length / 2; i++) {
    const a = pcm.readInt16LE(i * 2);
    const b = filled.readInt16LE(i * 2);
    if (a !== 0) expect(b).toBe(a);
    else expect(Math.abs(b)).toBeLessThanOrEqual(2);
  }
  // the same clip gets the same copy
  expect(Buffer.compare(slot.fillDigitalSilence(pcm, 1, 240, 2), filled)).toBe(0);
});

test("a_clip_without_digital_silence_is_not_copied", () => {
  expect(slot.fillDigitalSilence(clip(2), 1, 240, 2)).toBeNull();
  // a few zero samples in a row are speech crossing zero, not silence
  const pcm = clip(1);
  for (let i = 100; i < 110; i++) pcm.writeInt16LE(0, i * 2);
  expect(slot.fillDigitalSilence(pcm, 1, 240, 2)).toBeNull();
});

test("the_runtime_gets_a_filled_copy_once_and_the_voice_file_is_untouched", () => {
  const tmp = tmpPath();
  vi.spyOn(slot, "_dataDir").mockReturnValue(tmp);
  const ref = path.join(tmp, "ref.wav");
  const wav = writeWavContainer(clip(3, 0.25), RATE, 1);
  writeFileSync(ref, wav);
  const out = slot.guardedReference(ref);
  expect(out).not.toBe(ref);
  expect(path.dirname(out)).toBe(path.join(tmp, "cache", "qwen3-references"));
  expect(Buffer.compare(readFileSync(ref), wav)).toBe(0);
  const [fmt, offset, size] = parseWavHeader(readFileSync(out));
  expect(fmt.sampleRate).toBe(RATE);
  expect(runs(readFileSync(out).subarray(offset, offset + size), 240)).toBe(0);
  expect(slot.guardedReference(ref)).toBe(out);
  expect(readdirSync(path.dirname(out)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
});

test("a_clean_or_unreadable_reference_goes_as_it_is", () => {
  const tmp = tmpPath();
  vi.spyOn(slot, "_dataDir").mockReturnValue(tmp);
  const clean = path.join(tmp, "clean.wav");
  writeFileSync(clean, writeWavContainer(clip(2), RATE, 1));
  expect(slot.guardedReference(clean)).toBe(clean);
  expect(slot.guardedReference(path.join(tmp, "missing.wav"))).toBe(path.join(tmp, "missing.wav"));
  const notWav = path.join(tmp, "note.txt");
  writeFileSync(notWav, "not audio");
  expect(slot.guardedReference(notWav)).toBe(notWav);
  expect(existsSync(path.join(tmp, "cache", "qwen3-references"))).toBe(false);
});

test("only_qwen3_base_references_are_guarded", () => {
  const tmp = tmpPath();
  vi.spyOn(slot, "_dataDir").mockReturnValue(tmp);
  mkdirSync(tmp, { recursive: true });
  const ref = path.join(tmp, "ref.wav");
  writeFileSync(ref, writeWavContainer(clip(2, 0.25), RATE, 1));
  const engines = discoverEngines();
  const row = (engine, id) => engines.get(engine).module.VARIANTS.find((r) => r.id === id);
  const qwen = toSpeechRequest(row("qwen3", "qwen3-base-1.7b-q8"), { text: "Hi.", audio_prompt_path: ref, xvector_only: true });
  expect(qwen.voice_ref).not.toBe(ref.replaceAll("\\", "/"));
  expect(qwen.voice_ref).toContain("qwen3-references");
  const chatter = engines.get("chatterbox").module.VARIANTS[0];
  const cb = toSpeechRequest(chatter, { text: "Hi.", audio_prompt_path: ref, language: "en" });
  expect(cb.voice_ref).toBe(ref.replaceAll("\\", "/"));
});
