// SPDX-License-Identifier: MIT
// Tests for the audio analyzer — peak / RMS / clipping / silence detection (the port of
// tests/test_analyzer.py).
import { afterAll, expect, test } from "vitest";
import "./engines_helpers.js";
import { analyze, compare } from "../src/audio/analyzer.js";
import * as dspClient from "../src/audio/dsp_client.js";
import { fullscaleWav, silenceWav, sineWav } from "./audio_fixtures.js";

afterAll(() => dspClient.stop());

test("sine_wave_has_expected_peak", async () => {
  const a = await analyze(sineWav());
  // 0.5 amplitude => peak ~= -6 dBFS
  expect(a.loudness.peak_dbfs).toBeGreaterThan(-7.5);
  expect(a.loudness.peak_dbfs).toBeLessThan(-5.0);
  // RMS of a sine at 0.5 amplitude is 0.5/sqrt(2) ~ 0.354 => -9 dBFS
  expect(a.loudness.rms_dbfs).toBeGreaterThan(-10.5);
  expect(a.loudness.rms_dbfs).toBeLessThan(-8.0);
});

test("silence_detected", async () => {
  const a = await analyze(silenceWav());
  expect(a.loudness.silence_ratio).toBe(1.0);
  expect(a.loudness.peak_dbfs).toBe(Number.NEGATIVE_INFINITY);
  expect(a.loudness.clipping_ratio).toBe(0.0);
});

test("fullscale_detects_clipping", async () => {
  const a = await analyze(fullscaleWav());
  expect(a.loudness.clipping_ratio).toBeGreaterThan(0.9);
  // Peak is at the +/- 32767 ceiling => 0 dBFS
  expect(a.loudness.peak_dbfs).toBeGreaterThan(-0.01);
});

test("compare_identical_wavs_reports_identical", async () => {
  const w = sineWav();
  const rep = await compare(w, w);
  expect(rep.identical).toBe(true);
  expect(rep.verdict).toBe("identical");
  expect(rep.sample_rmse === null || rep.sample_rmse === 0.0).toBe(true);
});

test("compare_different_wavs_reports_unrelated", async () => {
  const rep = await compare(sineWav(), fullscaleWav());
  expect(rep.identical).toBe(false);
  expect(["different", "unrelated"]).toContain(rep.verdict);
  expect(rep.sample_rmse).not.toBeNull();
  expect(rep.sample_rmse).toBeGreaterThan(0.05);
});

test("analyze_reports_duration", async () => {
  const a = await analyze(sineWav());
  expect(Math.abs(a.format.duration_sec - 1.0)).toBeLessThan(0.001);
  expect(a.format.sample_rate).toBe(44_100);
  expect(a.format.channels).toBe(1);
});
