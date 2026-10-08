// SPDX-License-Identifier: MIT
// Tests for the WAV parser + container writer (the port of tests/test_wav.py).
import { expect, test } from "vitest";
import { parseWavHeader, stripWavHeader, writeWavContainer } from "../src/audio/wav.js";
import { synthSinePcm } from "./audio_fixtures.js";

test("round_trip_preserves_pcm", () => {
  const pcm = synthSinePcm();
  const wav = writeWavContainer(pcm, 44_100, 1);
  expect(Buffer.from(stripWavHeader(wav)).equals(pcm)).toBe(true);
});

test("parse_returns_correct_format", () => {
  const pcm = synthSinePcm();
  const wav = writeWavContainer(pcm, 44_100, 1);
  const [fmt, off, size] = parseWavHeader(wav);
  expect(fmt.sampleRate).toBe(44_100);
  expect(fmt.channels).toBe(1);
  expect(fmt.bitsPerSample).toBe(16);
  expect(fmt.sampleCount).toBe(Math.floor(pcm.length / 2));
  expect(Math.abs(fmt.durationSec - 1.0)).toBeLessThan(0.001);
  expect(off).toBe(44);
  expect(size).toBe(pcm.length);
});

test("rejects_truncated_wav", () => {
  expect(() => parseWavHeader(Buffer.from("RIFF"))).toThrow(/too small/);
});

test("rejects_non_riff", () => {
  expect(() => parseWavHeader(Buffer.concat([Buffer.from("NOPE"), Buffer.alloc(100)]))).toThrow(/RIFF/);
});

test("write_supports_stereo", () => {
  // Pretend the same PCM is stereo (each pair = one frame).
  const wav = writeWavContainer(synthSinePcm(), 44_100, 2);
  const [fmt] = parseWavHeader(wav);
  expect(fmt.channels).toBe(2);
});
