// SPDX-License-Identifier: MIT
// RIFF/WAVE parser + the minimal container writer (the port of justvoice/audio/wav.py).
//
// Mirrors the Rust `audio_analyzer::parse_wav_header` behaviour. Supports 16-bit PCM mono /
// stereo at any sample rate; rejects other formats with a clear error so callers convert via
// ffmpeg first. Bytes are Node Buffers (a Uint8Array is accepted on input).

import { ValueError } from "@delebash/llm-runner/platform/py";

/** The parsed format (Python's `WavFormat` dataclass). */
export class WavFormat {
  constructor({ sampleRate, channels, bitsPerSample, sampleCount, durationSec }) {
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.bitsPerSample = bitsPerSample;
    this.sampleCount = sampleCount;
    this.durationSec = durationSec;
  }
}

/** Bytes as a Buffer without copying a view. Candidate for platform/. */
export const asBuf = (b) =>
  Buffer.isBuffer(b) ? b : ArrayBuffer.isView(b) ? Buffer.from(b.buffer, b.byteOffset, b.byteLength) : Buffer.from(b);

/** Python's `repr(bytes)` of a 4-byte chunk id, for the error text (b'LIST'). */
function bytesRepr(b) {
  let s = "";
  for (const c of b) {
    if (c === 0x5c) s += "\\\\";
    else if (c === 0x27) s += "\\'";
    else if (c >= 0x20 && c < 0x7f) s += String.fromCharCode(c);
    else if (c === 0x09) s += "\\t";
    else if (c === 0x0a) s += "\\n";
    else if (c === 0x0d) s += "\\r";
    else s += `\\x${c.toString(16).padStart(2, "0")}`;
  }
  return `b'${s}'`;
}

/** Returns `[format, dataOffset, dataSize]`. Throws ValueError on malformed or unsupported
 * input. */
export function parseWavHeader(input) {
  const buf = asBuf(input);
  if (buf.length < 44) throw new ValueError(`File too small to be a WAV (${buf.length} bytes < 44)`);
  if (buf.toString("latin1", 0, 4) !== "RIFF") throw new ValueError("Not a RIFF file (missing RIFF magic)");
  if (buf.toString("latin1", 8, 12) !== "WAVE") throw new ValueError("RIFF file is not a WAVE");

  let cursor = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let audioFormat = 0;
  let dataOffset = 0;
  let dataSize = 0;

  while (cursor + 8 <= buf.length) {
    const chunkId = buf.subarray(cursor, cursor + 4);
    const id = buf.toString("latin1", cursor, cursor + 4);
    const size = buf.readUInt32LE(cursor + 4);
    const body = cursor + 8;
    if (body + size > buf.length) {
      if (id === "data") {
        dataOffset = body;
        dataSize = buf.length - body;
        break;
      }
      throw new ValueError(`Truncated WAV chunk ${bytesRepr(chunkId)}`);
    }
    if (id === "fmt ") {
      if (size < 16) throw new ValueError(`fmt chunk too small (${size} < 16)`);
      audioFormat = buf.readUInt16LE(body);
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bitsPerSample = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      dataOffset = body;
      dataSize = size;
      break;
    }
    cursor = body + size + (size & 1);
  }

  if (audioFormat !== 1) throw new ValueError(`Only PCM (audio_format=1) supported; got ${audioFormat}`);
  if (bitsPerSample !== 16) throw new ValueError(`Only 16-bit PCM supported; got ${bitsPerSample} bits`);
  if (sampleRate === 0 || channels === 0) throw new ValueError("Missing or zero sample_rate / channels in fmt chunk");
  if (dataOffset === 0) throw new ValueError("WAV has no data chunk");

  const bytesPerFrame = channels * 2;
  const sampleCount = Math.floor(dataSize / bytesPerFrame);
  const durationSec = sampleCount / sampleRate;
  return [new WavFormat({ sampleRate, channels, bitsPerSample, sampleCount, durationSec }), dataOffset, dataSize];
}

/** Wrap raw 16-bit PCM in a minimal WAV container. */
export function writeWavContainer(pcm, sampleRate, channels = 1) {
  const data = asBuf(pcm);
  const bitsPerSample = 16;
  const byteRate = Math.floor((sampleRate * channels * bitsPerSample) / 8);
  const blockAlign = Math.floor((channels * bitsPerSample) / 8);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "latin1");
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8, "latin1");
  h.write("fmt ", 12, "latin1");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(byteRate, 28);
  h.writeUInt16LE(blockAlign, 32);
  h.writeUInt16LE(bitsPerSample, 34);
  h.write("data", 36, "latin1");
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Return just the PCM data. */
export function stripWavHeader(input) {
  const buf = asBuf(input);
  const [, dataOffset, dataSize] = parseWavHeader(buf);
  return buf.subarray(dataOffset, dataOffset + dataSize);
}
