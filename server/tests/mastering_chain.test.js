// SPDX-License-Identifier: MIT
// The ACX mastering chain, run for real: a mastered chapter must pass the app's own ACX QC
// limits (RMS -23..-18 dBFS, peak <= -3 dBFS) — the port of tests/test_mastering_chain.py.
//
// Found 2026-09-29 on a live render: `dynaudnorm` ran after `loudnorm` and renormalised toward a
// 0.95 peak, so an "acx" chapter measured -16.8 LUFS with its peak at -0.5 dBFS — mastered, and
// failing ACX. Skipped without ffmpeg. The noise under the tones is a seeded generator of our
// own (Python used random.Random(7)); the check is a threshold, not a byte comparison.
import { expect, test } from "vitest";
import "./engines_helpers.js";
import { analyze } from "../src/audio/analyzer.js";
import { haveFfmpeg, masterToWav } from "../src/mastering.js";
import { construct, MasterPresetSettings } from "../src/models.js";

const RATE = 44_100;

/** Mono 16-bit PCM: voiced-band tones under a syllable-rate envelope, in loud and quiet
 * passages — the dynamics a narrated chapter has. */
function speechlike(seconds) {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  const freqs = [
    [180, 0.5],
    [360, 0.3],
    [720, 0.2],
    [1500, 0.12],
    [2800, 0.06],
  ];
  const n = Math.trunc(seconds * RATE);
  const out = Buffer.alloc(2 * n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const passage = Math.floor(t / 4) % 2 === 0 ? 0.9 : 0.25; // loud / quiet, 4 s each
    const syllable = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4.0 * t); // ~4 syllables a second
    const tone = freqs.reduce((s, [f, a]) => s + a * Math.sin(2 * Math.PI * f * t), 0);
    const s = passage * syllable * tone + (rnd() * 0.02 - 0.01);
    out.writeInt16LE(Math.max(-32767, Math.min(32767, Math.trunc(s * 20000))), 2 * i);
  }
  return out;
}

test.skipIf(!haveFfmpeg())("acx_master_passes_the_acx_qc_limits", async () => {
  const wav = await masterToWav(speechlike(24.0), RATE, 1, { presetName: "acx", presets: construct(MasterPresetSettings, {}) });
  const loud = (await analyze(wav)).loudness;
  expect(loud.peak_dbfs).toBeLessThanOrEqual(-3.0);
  expect(loud.rms_dbfs).toBeGreaterThanOrEqual(-23.0);
  expect(loud.rms_dbfs).toBeLessThanOrEqual(-18.0);
});
