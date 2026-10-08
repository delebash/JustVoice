// SPDX-License-Identifier: MIT
// The files an audio.cpp GGUF carries inside it — read without audio.cpp (the port of
// justvoice/engines/audiocpp/gguf_files.py).
//
// audio.cpp's standalone GGUFs embed their non-weight files (configs, vocabularies, Kokoro's
// voices) in three metadata arrays: `audiocpp.embedded_files.names`, `.offsets` (one more than
// the names) and `.data` (the bytes). Kokoro's voices are `voices.json` plus
// `voices/<id>.bin`, raw float32 of 510 × 256 — what a blend is made from (gap 2,
// docs/plans/2026-10-03-gap-2-kokoro-blends.md). Only the metadata section is read; the tensor
// data after it never is.

import { closeSync, openSync, readSync } from "node:fs";
import { ValueError } from "@delebash/llm-runner/platform/py";

// GGUF metadata scalar types → [byte width, reader].
const SCALAR = {
  0: [1, (b, o) => b.readUInt8(o)],
  1: [1, (b, o) => b.readInt8(o)],
  2: [2, (b, o) => b.readUInt16LE(o)],
  3: [2, (b, o) => b.readInt16LE(o)],
  4: [4, (b, o) => b.readUInt32LE(o)],
  5: [4, (b, o) => b.readInt32LE(o)],
  6: [4, (b, o) => b.readFloatLE(o)],
  7: [1, (b, o) => b.readUInt8(o) !== 0],
  10: [8, (b, o) => Number(b.readBigUInt64LE(o))],
  11: [8, (b, o) => Number(b.readBigInt64LE(o))],
  12: [8, (b, o) => b.readDoubleLE(o)],
};
const STRING = 8;
const ARRAY = 9;

/** A forward-only reader over an open file (Python's `f.read(n)`). */
class Reader {
  constructor(fd) {
    this.fd = fd;
    this.pos = 0;
  }
  read(n) {
    const b = Buffer.alloc(n);
    let got = 0;
    while (got < n) {
      const r = readSync(this.fd, b, got, n - got, this.pos + got);
      if (r === 0) break;
      got += r;
    }
    this.pos += got;
    return got === n ? b : b.subarray(0, got);
  }
  u32() {
    return this.read(4).readUInt32LE(0);
  }
  u64() {
    return Number(this.read(8).readBigUInt64LE(0));
  }
  skip(n) {
    this.pos += n;
  }
}

function skipOrRead(r, kind, keep) {
  if (kind in SCALAR) {
    const [w, rd] = SCALAR[kind];
    if (!keep) {
      r.skip(w);
      return null;
    }
    return rd(r.read(w), 0);
  }
  if (kind === STRING) {
    const n = r.u64();
    if (!keep) {
      r.skip(n);
      return null;
    }
    return r.read(n).toString("utf8");
  }
  if (kind === ARRAY) {
    const item = r.u32();
    const n = r.u64();
    if (item === 0) {
      // uint8 — the embedded bytes
      if (!keep) {
        r.skip(n);
        return null;
      }
      return r.read(n);
    }
    if (item in SCALAR) {
      const [w, rd] = SCALAR[item];
      if (!keep) {
        r.skip(w * n);
        return null;
      }
      const raw = r.read(w * n);
      const out = new Array(n);
      for (let i = 0; i < n; i++) out[i] = rd(raw, i * w);
      return out;
    }
    const values = [];
    for (let i = 0; i < n; i++) values.push(skipOrRead(r, item, keep));
    return keep ? values : null;
  }
  throw new ValueError(`unknown GGUF metadata type ${kind}`);
}

const KEYS = ["audiocpp.embedded_files.names", "audiocpp.embedded_files.offsets", "audiocpp.embedded_files.data"];

/** Every embedded file of an audio.cpp GGUF, by its name (e.g. "voices/af_heart.bin"), as a
 * Map name → Buffer. An empty Map when the file embeds none. */
export function embeddedFiles(filePath) {
  const found = new Map();
  const fd = openSync(String(filePath), "r");
  try {
    const r = new Reader(fd);
    if (r.read(4).toString("latin1") !== "GGUF") throw new ValueError(`${filePath} is not a GGUF file`);
    r.u32(); // version
    r.u64(); // tensor count
    const entries = r.u64(); // metadata entries
    for (let i = 0; i < entries; i++) {
      const key = r.read(r.u64()).toString("utf8");
      const kind = r.u32();
      const keep = KEYS.includes(key);
      const value = skipOrRead(r, kind, keep);
      if (keep) {
        found.set(key, value);
        if (found.size === KEYS.length) break;
      }
    }
  } finally {
    closeSync(fd);
  }
  if (found.size < KEYS.length) return new Map();
  const [names, offsets, data] = KEYS.map((k) => found.get(k));
  if (offsets.length !== names.length + 1) {
    throw new ValueError(`${filePath}: ${names.length} embedded names but ${offsets.length} offsets`);
  }
  return new Map(names.map((name, i) => [name, data.subarray(offsets[i], offsets[i + 1])]));
}
