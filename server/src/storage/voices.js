// SPDX-License-Identifier: MIT
// Voice storage — directory per voice under `$DATA_DIR/voices/<id>/` (the port of
// justvoice/storage/voices.py).
//
// Each voice dir contains:
//   - manifest.json — the VoiceRecord (Python's json.dump of `model_dump()`, indent 2:
//                     datetimes as isoformat "…+00:00", floats as floats)
//   - ref.wav       — primary reference clip (clone / import / frozen-designed: a designed
//                     voice keeps the preview it was saved from, so its identity stops
//                     re-rolling per line — 2026-08-22)
//   - samples/      — additional samples added via /samples
//
// Records go out in the wire form (`created_at` "…Z"); `get` returns the cached record
// itself, as Python returned its model instance — copy before mutating.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { KeyError, pySorted, ValueError } from "@delebash/llm-runner/platform/py";
import { construct, dtIso, dtMicros, floatify, modelDump, pyClone, utcNow, VoiceRecord } from "../models.js";
import { voicesRoot } from "../paths.js";
import { atomicWriteJson } from "./atomic.js";

const log = getLogger("justvoice.storage.voices");

export class VoiceStore {
  static REF_FILENAME = "ref.wav";
  static MANIFEST_FILENAME = "manifest.json";
  static SAMPLES_DIRNAME = "samples";

  constructor(dataDir) {
    this._dir = voicesRoot(dataDir);
    mkdirSync(this._dir, { recursive: true });
    this._cache = new Map();
    this._loadAll();
  }

  _loadAll() {
    for (const name of readdirSync(this._dir)) {
      const sub = path.join(this._dir, name);
      let isDir = false;
      try {
        isDir = statSync(sub).isDirectory();
      } catch {
        isDir = false;
      }
      if (!isDir) continue;
      const manifest = path.join(sub, VoiceStore.MANIFEST_FILENAME);
      if (!existsSync(manifest)) continue;
      try {
        const record = construct(VoiceRecord, JSON.parse(readFileSync(manifest, "utf8")));
        this._cache.set(record.id, record);
      } catch (e) {
        log.warning(`voice manifest ${manifest} unreadable: ${e?.message ?? e}`);
      }
    }
  }

  voiceDir(id) {
    return path.join(this._dir, id);
  }

  refWavPath(id) {
    return path.join(this.voiceDir(id), VoiceStore.REF_FILENAME);
  }

  samplesDir(id) {
    return path.join(this.voiceDir(id), VoiceStore.SAMPLES_DIRNAME);
  }

  /** Every stored voice, oldest first. */
  list() {
    return pySorted([...this._cache.values()], (r) => dtMicros(r.created_at));
  }

  get(id) {
    return this._cache.get(id) ?? null;
  }

  /** Store a new voice. The record gets its id (when it has none) and both times — the
   * caller's object is updated too, as Python's model was. Returns a copy. */
  create(record) {
    if (!record.id) record.id = `voice_${randomUUID().replaceAll("-", "")}`;
    record.created_at = utcNow();
    record.updated_at = utcNow();
    const full = construct(VoiceRecord, record);
    this._flush(full);
    this._cache.set(full.id, full);
    return pyClone(full);
  }

  writeRefWav(id, data) {
    mkdirSync(this.voiceDir(id), { recursive: true });
    writeFileSync(this.refWavPath(id), data);
  }

  addSample(id, data) {
    const record = this._cache.get(id);
    if (!record) throw new KeyError(`voice not found: ${id}`);
    mkdirSync(this.samplesDir(id), { recursive: true });
    const nextIdx = record.sample_count + 1;
    writeFileSync(path.join(this.samplesDir(id), `sample_${String(nextIdx).padStart(3, "0")}.wav`), data);
    record.sample_count = nextIdx;
    record.updated_at = utcNow();
    this._flush(record);
    return nextIdx;
  }

  /** Partial metadata update. Unknown fields are refused (pydantic refuses them on
   * assignment); null values are skipped (PATCH semantics). Null when the voice is unknown. */
  update(id, fields) {
    const record = this._cache.get(id);
    if (!record) return null;
    for (const [key, value] of Object.entries(fields)) {
      if (value === null || value === undefined) continue;
      if (!Object.hasOwn(VoiceRecord.properties, key)) {
        throw new ValueError(`"VoiceRecord" object has no field "${key}"`);
      }
      record[key] = value;
    }
    record.updated_at = utcNow();
    this._flush(record);
    return pyClone(record);
  }

  delete(id) {
    if (!this._cache.has(id)) return false;
    const d = this.voiceDir(id);
    if (existsSync(d)) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore_errors=True */
      }
    }
    this._cache.delete(id);
    return true;
  }

  _flush(record) {
    const d = this.voiceDir(record.id);
    mkdirSync(d, { recursive: true });
    // `model_dump()` then json.dump's isoformat() for the datetimes.
    const data = floatify(VoiceRecord, modelDump(VoiceRecord, record));
    data.created_at = dtIso(record.created_at);
    data.updated_at = dtIso(record.updated_at);
    atomicWriteJson(path.join(d, VoiceStore.MANIFEST_FILENAME), data);
  }
}
