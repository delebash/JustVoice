// SPDX-License-Identifier: MIT
// conftest.py's audio fixtures: a 1 s 440 Hz sine at 44.1 kHz (peak ~ -6 dBFS), 1 s of
// silence, 1 s of a full-scale square, and the minimal WAV wrapper — numpy's arithmetic, so
// the samples are Python's (`(sin(...) * 0.5 * 32767.0).astype("<i2")` truncates).
import { writeWavContainer } from "../src/audio/wav.js";

export function synthSinePcm() {
  const sampleRate = 44_100;
  const n = Math.trunc(sampleRate * 1.0);
  const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.trunc(Math.sin((2 * Math.PI * 440.0 * i) / sampleRate) * 0.5 * 32767.0), i * 2);
  return b;
}

export const synthSilencePcm = () => Buffer.alloc(44_100 * 2);

export function synthFullScalePcm() {
  const n = 44_100;
  const b = Buffer.alloc(Math.floor(n / 2) * 2 * 2);
  for (let i = 0; i < Math.floor(n / 2) * 2; i++) b.writeInt16LE(i % 2 ? -32767 : 32767, i * 2);
  return b;
}

export const writeWav = (pcm, sampleRate = 44_100, channels = 1) => writeWavContainer(pcm, sampleRate, channels);
export const sineWav = () => writeWav(synthSinePcm());
export const silenceWav = () => writeWav(synthSilencePcm());
export const fullscaleWav = () => writeWav(synthFullScalePcm());
