// SPDX-License-Identifier: MIT
// Tests for the chunked TTS splitter and the joins between a line's pieces — which run in
// audiocpp_dsp since 2026-10-07 (audio/dsp_client.js). The port of tests/test_chunked.py.
import { afterAll, expect, test } from "vitest";
import "./engines_helpers.js";
import { PIECE_JOIN_PAUSE_MS, splitTextIntoChunks } from "../src/audio/chunked.js";
import * as dspClient from "../src/audio/dsp_client.js";
import { writeWavContainer } from "../src/audio/wav.js";

afterAll(() => dspClient.stop());

test("short_text_is_one_chunk", () => {
  expect(splitTextIntoChunks("Just a sentence.", 800)).toEqual(["Just a sentence."]);
});

test("splits_at_sentence_boundary", () => {
  const text = "First sentence. Second sentence. Third sentence.";
  const chunks = splitTextIntoChunks(text, 20);
  // Each chunk should end at a sentence boundary, none over the cap.
  for (const c of chunks) expect(c.length).toBeLessThanOrEqual(25); // max_chars + small overhead
  expect(chunks.join("").replaceAll(" ", "")).toBe(text.replaceAll(" ", ""));
});

test("does_not_split_abbreviation", () => {
  // Periods inside abbreviations like 'Dr.' or 'Mr.' do not end a sentence.
  const chunks = splitTextIntoChunks("Dr. Smith met Mr. Jones at the café. They had tea.", 30);
  expect(chunks.some((c) => c === "Dr.")).toBe(false);
  expect(chunks.some((c) => c === "Mr.")).toBe(false);
});

test("does_not_split_paralinguistic_tag", () => {
  // [laugh], [sigh] etc. are atomic — never split across chunks.
  const chunks = splitTextIntoChunks("Once upon a time [laugh] there was a wolf.", 20);
  expect(chunks.join("")).toContain("[laugh]");
});

const pcmOf = (samples) => {
  const b = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => b.writeInt16LE(s, i * 2));
  return b;
};
const samplesOf = (pcm) => {
  const out = [];
  for (let i = 0; i + 1 < pcm.length; i += 2) out.push(pcm.readInt16LE(i));
  return out;
};

test("concatenate_with_crossfade_no_clicks", async () => {
  // Crossfading two short chunks should produce a smooth boundary.
  const sr = 44100;
  const a = pcmOf(new Array(Math.floor(sr / 10)).fill(16383)); // 100 ms at half scale
  const b = pcmOf(new Array(Math.floor(sr / 10)).fill(16383));
  const merged = samplesOf(await dspClient.join([[a, sr, 1], [b, sr, 1]], 20));
  // Without crossfade the concat would be 2*len(a). With 20ms overlap it's less.
  const n = Math.floor(sr / 10);
  expect(merged.length).toBeGreaterThanOrEqual(2 * n - Math.trunc(sr * 0.02) - 10);
  expect(merged.length).toBeLessThanOrEqual(2 * n);
  // No discontinuity over the crossfade region.
  let maxStep = 0;
  for (let i = 1; i < merged.length; i++) maxStep = Math.max(maxStep, Math.abs(merged[i] - merged[i - 1]));
  expect(maxStep).toBeLessThan(0.1 * 32767);
});

test("empty_input_returns_empty_audio", async () => {
  expect((await dspClient.join([], 50)).length).toBe(0);
});

/** A piece as a model hands it over: silence, sound, silence. */
function piece(sr, leadMs, soundMs, tailMs) {
  const z = (ms) => new Array(Math.trunc((sr * ms) / 1000)).fill(0);
  return pcmOf([...z(leadMs), ...new Array(Math.trunc((sr * soundMs) / 1000)).fill(Math.trunc(0.3 * 32767)), ...z(tailMs)]);
}

function gapsMs(x, sr) {
  const quiet = x.map((v) => Math.abs(v) / 32767 <= 10 ** (-60 / 20));
  let i = quiet.indexOf(false);
  const last = x.length - [...quiet].reverse().indexOf(false);
  const out = [];
  while (i < last) {
    if (quiet[i]) {
      let j = i;
      while (j < last && quiet[j]) j += 1;
      out.push(Math.round(((j - i) / sr) * 1000));
      i = j;
    } else i += 1;
  }
  return out;
}

test("pieces_meet_at_the_piece_pause_not_their_padding", async () => {
  // 2026-10-07: a long line's pieces kept their padding — ~1 s gaps mid-line.
  const sr = 24000;
  const a = piece(sr, 265, 1000, 715);
  const b = piece(sr, 265, 1000, 715);
  const merged = samplesOf(await dspClient.join([[a, sr, 1], [b, sr, 1]], 50));
  // Quiet is judged in 10 ms windows, so the join lands within a window or two of the pause.
  const gaps = gapsMs(merged, sr);
  expect(gaps.length).toBe(1);
  const [gap] = gaps;
  expect(gap).toBeGreaterThanOrEqual(PIECE_JOIN_PAUSE_MS);
  expect(gap).toBeLessThanOrEqual(PIECE_JOIN_PAUSE_MS + 20);
  // The line's own lead and tail stay: trimming them is the chapter join's job.
  expect(Math.round((merged.length / sr) * 1000)).toBe(265 + 1000 + gap + 1000 + 715);
});

test("a_join_already_short_is_left_as_it_is", async () => {
  const sr = 24000;
  const a = piece(sr, 0, 500, 60);
  const b = piece(sr, 40, 500, 0);
  const merged = samplesOf(await dspClient.join([[a, sr, 1], [b, sr, 1]], 50));
  expect(gapsMs(merged, sr)).toEqual([100]);
});

test("a_streamed_audition_joins_its_pieces_like_a_line", async () => {
  // 2026-10-07: the Voices preview streams pieces one by one; holding each piece's quiet back
  // for the next seam gives exactly the line's join.
  const sr = 24000;
  const pieces = [piece(sr, 265, 800, 715), piece(sr, 265, 600, 715), piece(sr, 265, 700, 715)];
  const streamed = [];
  let held = null;
  for (const [i, p] of pieces.entries()) {
    let out;
    [out, held] = await dspClient.streamJoin(writeWavContainer(p, sr, 1), held, { last: i === pieces.length - 1, crossfadeMs: 50 });
    streamed.push(out);
  }
  const whole = await dspClient.join(pieces.map((p) => [p, sr, 1]), 50);
  expect(Buffer.concat(streamed).equals(Buffer.from(whole))).toBe(true);
});
