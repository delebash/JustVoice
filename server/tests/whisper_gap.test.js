// SPDX-License-Identifier: MIT
// Whispers set under the narration when a chapter is joined (decided 2026-10-21, TASKS "Round 7's
// answers acted on", 4): the engines whisper at speaking volume, so a whispered line without a
// volume of its own is brought to `generation.whisper_gap_db` under the chapter's narration, RMS
// over the trimmed lines — the measure round 7 used (RESEARCH §10.34). Joins only.
import { expect, test } from "vitest";
import * as dspClient from "../src/audio/dsp_client.js";
import { writeWavContainer } from "../src/audio/wav.js";
import { _join, _levelWhispers } from "../src/api/render_chapter_api.js";
import { RenderedLine } from "../src/render_core.js";

const RATE = 24000;

/** One second of a 220 Hz tone at `amplitude` (0–1), 16-bit mono. */
function tone(amplitude, seconds = 1) {
  const n = RATE * seconds;
  const pcm = Buffer.alloc(2 * n);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(amplitude * 32767 * Math.sin((2 * Math.PI * 220 * i) / RATE)), 2 * i);
  return pcm;
}
const rms = async (pcm) => (await dspClient.loudness(writeWavContainer(pcm, RATE, 1))).rms_dbfs;
const line = (fields = {}) => ({ block_id: "b", narration: false, own_volume: false, delivery: null, ...fields });
const whisper = (fields = {}) => line({ delivery: { emotion: "whispered" }, ...fields });

test("a whispered line at full voice comes out the gap under the narration", async () => {
  const lines = [line({ narration: true }), whisper(), line({ narration: true }), line()];
  // The narration at two levels (its power together is what counts), the whisper as loud as it.
  const fitted = [tone(0.3), tone(0.3), tone(0.15), tone(0.6)];
  const narration = 10 * Math.log10((10 ** ((await rms(fitted[0])) / 10) + 10 ** ((await rms(fitted[2])) / 10)) / 2);
  await _levelWhispers(lines, -18)(fitted, RATE, 1);
  expect(await rms(fitted[1])).toBeCloseTo(narration - 18, 0);
  // Only the whisper moved; the character's line isn't the narration.
  expect(fitted[3]).toEqual(tone(0.6));
});

test("a quiet whisper is brought up to the gap, at most 12 dB — a line's own volume's range", async () => {
  const fitted = [tone(0.3), tone(0.03), tone(0.003)];
  await _levelWhispers([line({ narration: true }), whisper(), whisper()], -15)(fitted, RATE, 1);
  expect(await rms(fitted[1])).toBeCloseTo((await rms(tone(0.3))) - 15, 0);
  expect(await rms(fitted[2])).toBeCloseTo((await rms(tone(0.003))) + 12, 0);
});

test("the line's own volume wins; off, or not a book's chapter, nothing is levelled", async () => {
  expect(_levelWhispers([line({ narration: true }), whisper({ own_volume: true })], -18)).toBeNull();
  expect(_levelWhispers([line({ narration: true }), whisper()], null)).toBeNull();
  expect(_levelWhispers([line({ narration: true, block_id: null }), whisper({ block_id: null })], -18)).toBeNull();
  expect(_levelWhispers([line({ narration: true }), line()], -18)).toBeNull(); // no whisper
});

test("a chapter with no narration is measured on its other lines", async () => {
  const fitted = [tone(0.3), tone(0.3), tone(0.3)];
  await _levelWhispers([line(), whisper(), line()], -12)(fitted, RATE, 1);
  expect(await rms(fitted[1])).toBeCloseTo((await rms(tone(0.3))) - 12, 0);
});

test("the chapter's join levels its whispers, and its length stays", async () => {
  const st = { settings: { get: () => ({ generation: { whisper_gap_db: -18, pause_at_scene_break_ms: 2000, pause_within_paragraph_ms: 250 } }) } };
  const lines = [line({ narration: true }), whisper(), line({ narration: true })];
  const rendered = [tone(0.3), tone(0.3), tone(0.3)].map((pcm) => new RenderedLine({ pcm, sampleRate: RATE, channels: 1, effectiveDelivery: {} }));
  const joined = await _join(st, lines, rendered, 0);
  expect(joined.pcm.length).toBe(3 * 2 * RATE);
  const second = (k) => joined.pcm.subarray(k * 2 * RATE, (k + 1) * 2 * RATE);
  expect(await rms(second(1))).toBeCloseTo((await rms(second(0))) - 18, 0);
  // The rendered lines themselves are untouched (a cached take is never changed).
  expect(rendered[1].pcm).toEqual(tone(0.3));
});
