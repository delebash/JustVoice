// SPDX-License-Identifier: MIT
// The VRAM wiring under the AMENDED measured currency (docs/plans/2026-08-13-speech-catalog-
// redesign.md §10). Since round E (docs/plans/2026-10-29-round-e-onto-the-kit.md) the kit's audio.cpp
// runtime owns all of it for the speech models — where each runs, the measured prices, admission,
// eviction, the high-water bump, the one-pool ruling, the per-kind locks a line and a transcription
// hold, the memory strip — and tests it. What stays ours: the render scheduler's own coarse tts-busy
// flag while its pool drains (step 4, Q1's never-evict-busy — synth_scheduler.js `_setBusy`), and a
// recogniser's refusal said in its own words (seen 2026-10-15; kit_speech.js `asProblem` — the
// transcription half is kit_speech.test.js's). The port of tests/test_engine_vram_wiring.py.
import { AsyncEvent, sleep } from "@delebash/core/platform/asyncutil";
import { AudioCppError } from "@delebash/core/runner/audiocpp";
import { afterEach, expect, test } from "vitest";
import { discrete, endSpeech, fakeServer, fakeSpeechRuntime, makeArbiter, resetArbiter, wav } from "./engines_helpers.js";
import * as kitSpeech from "../src/engines/audiocpp/kit_speech.js";
import { SynthScheduler } from "../src/synth_scheduler.js";

afterEach(() => {
  endSpeech();
  resetArbiter();
});

// ─── busy flags (step 4) ──────────────────────────────────────────────

test("scheduler_worker_marks_tts_busy_while_draining", async () => {
  const arb = makeArbiter(discrete());
  const sched = new SynthScheduler();
  const seen = [];
  const gate = new AsyncEvent();
  const handle = sched.submit([
    [
      "eng",
      async () => {
        seen.push(arb.busyKinds());
        await gate.wait(5000);
        return "ok";
      },
    ],
  ]);
  for (let i = 0; i < 200 && !seen.length; i++) await sleep(10);
  expect(seen.length && seen[0].has("tts")).toBe(true);
  gate.set();
  expect(await handle.wait(5)).toBe(true);
  for (let i = 0; i < 200 && arb.busyKinds().has("tts"); i++) await sleep(10);
  expect(arb.busyKinds().has("tts")).toBe(false);
});

test("a recogniser's refusal reads in its own words, not as a JSON body", async () => {
  // Seen through the app 2026-10-15: "engine transcribe failed: {"detail": "this LFM2-Audio
  // checkpoint transcribes ja, not en"}" reached dictation as it was. The kit's server reads
  // audio.cpp's answer; the words after "engine align failed:" are its own.
  const detail = "this LFM2-Audio checkpoint transcribes ja, not en";
  const server = fakeServer();
  server.align = async () => {
    throw new AudioCppError(detail, 500);
  };
  fakeSpeechRuntime({ server });
  await expect(kitSpeech.align(wav(0.5, 16000), "x", "en")).rejects.toMatchObject({ detail: `engine align failed: ${detail}` });
});
