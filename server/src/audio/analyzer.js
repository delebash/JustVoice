// SPDX-License-Identifier: MIT
// Audio analyzer — format + loudness + A/B comparison (the port of justvoice/audio/analyzer.py).
//
// The header half (format, sha256) is read here; the sample half — loudness, the noise
// margin, the sample-by-sample comparison — runs in `audiocpp_dsp` (audio/dsp_client.js,
// 2026-10-07). Results are the wire models' shapes (`AudioAnalysis`, `ComparisonReport`),
// fields in declaration order; silence reads -Infinity.

import { createHash } from "node:crypto";
import * as dspClient from "./dsp_client.js";
import { parseWavHeader, writeWavContainer } from "./wav.js";

/** Peak, RMS and crest in dBFS (-Infinity for silence), and the share of samples that are
 * near silent (|x| < 32) or clipped (|x| ≥ 32760) — over the data chunk's samples as they lie.
 * A `LoudnessStats`. */
export async function _computeLoudness(wav) {
  const d = await dspClient.loudness(wav);
  return {
    peak_dbfs: d.peak_dbfs,
    rms_dbfs: d.rms_dbfs,
    crest_factor_db: d.crest_factor_db,
    silence_ratio: d.silence_ratio,
    clipping_ratio: d.clipping_ratio,
  };
}

/** How far a clip's speech stands above its noise, in dB: the loud end of its 20 ms frames
 * (90th percentile) against the quiet end (10th) — the pauses between words, where only the
 * room is heard. A clean clip reads 40 dB and more; under 25 a clone copies the hiss
 * (Alexandria's own floor). null for a clip under half a second, or one that is all silence. */
export async function noiseMarginDb(pcmBytes, sampleRate, channels) {
  return dspClient.noiseMargin(writeWavContainer(pcmBytes, sampleRate, channels));
}

/** An `AudioAnalysis` of a 16-bit PCM WAV (throws ValueError for anything else). */
export async function analyze(buf) {
  const [fmt] = parseWavHeader(buf);
  const loudness = await _computeLoudness(buf);
  return {
    sha256: createHash("sha256").update(buf).digest("hex"),
    file_size_bytes: buf.length,
    format: {
      sample_rate: fmt.sampleRate,
      channels: fmt.channels,
      bits_per_sample: fmt.bitsPerSample,
      sample_count: fmt.sampleCount,
      duration_sec: fmt.durationSec,
    },
    loudness,
  };
}

const sameFormat = (a, b) => Object.keys(a).every((k) => a[k] === b[k]);

/** A `ComparisonReport` of two WAVs. */
export async function compare(aBuf, bBuf) {
  const a = await analyze(aBuf);
  const b = await analyze(bBuf);

  const identical = a.sha256 === b.sha256;
  const formatMatch = sameFormat(a.format, b.format);
  const peakDiffDb = b.loudness.peak_dbfs - a.loudness.peak_dbfs;
  const rmsDiffDb = b.loudness.rms_dbfs - a.loudness.rms_dbfs;
  const durationDiffSec = b.format.duration_sec - a.format.duration_sec;

  let sampleRmse = null;
  let maxSampleDelta = null;
  let pctIdenticalSamples = null;
  if (formatMatch) {
    const d = await dspClient.sampleDiff(aBuf, bBuf);
    sampleRmse = d.sample_rmse;
    maxSampleDelta = d.max_sample_delta;
    pctIdenticalSamples = d.pct_identical_samples;
  }

  let verdict;
  if (identical) verdict = "identical";
  else if (!formatMatch) verdict = "incomparable";
  else if (sampleRmse == null) verdict = "incomparable";
  else if (sampleRmse < 0.001) verdict = "near-identical";
  else if (sampleRmse < 0.05) verdict = "similar";
  else if (sampleRmse < 0.2) verdict = "different";
  else verdict = "unrelated";

  return {
    a,
    b,
    identical,
    format_match: formatMatch,
    peak_diff_db: peakDiffDb,
    rms_diff_db: rmsDiffDb,
    duration_diff_sec: durationDiffSec,
    sample_rmse: sampleRmse ?? null,
    max_sample_delta: maxSampleDelta ?? null,
    pct_identical_samples: pctIdenticalSamples ?? null,
    verdict,
    a_label: null,
    b_label: null,
  };
}
