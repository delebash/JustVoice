// SPDX-License-Identifier: MIT
// Per-line render cache — disk-backed LRU with an in-memory hot tier (the port of
// justvoice/cache.py).
//
// Each scope is a subdirectory; each entry is one PCM-with-format-header file keyed by
// `sha256(engine || engine_version || voice || text || language || seed || delivery ||
// effects)`. Lexicons are not a field of their own: what they change is already in the text
// and the delivery (render_core.render_line). The key's bytes are Python's, so a cache
// written by either server is read by the other.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ValueError } from "@delebash/llm-runner/platform/py";
import { construct, CacheStats } from "./models.js";

/** Composable cache-key hasher. Order matters for stable keys. */
export class CacheKeyBuilder {
  constructor() {
    this._h = createHash("sha256");
  }

  _put(...parts) {
    for (const p of parts) this._h.update(Buffer.from(p, "utf8"));
    return this;
  }

  withEngine(engineId, version) {
    return this._put("engine:", engineId, ":", version, "\n");
  }

  withVoice(voiceId) {
    return this._put("voice:", voiceId, "\n");
  }

  withText(text) {
    return this._put("text:", text, "\n");
  }

  withLanguage(lang) {
    return this._put("lang:", lang || "", "\n");
  }

  /** `str(seed or 0)` — a missing or zero seed hashes as "0". */
  withSeed(seed) {
    return this._put("seed:", String(seed || 0), "\n");
  }

  withDeliveryJson(canonical) {
    return this._put("delivery:", canonical, "\n");
  }

  /** Include the resolved effects-chain hash, so the cache busts when the chain changes.
   * Empty chains hash to a constant so "no effects" cache hits propagate across requests. */
  withEffectsChain(chainHash) {
    return this._put("fx:", chainHash || "noeffects", "\n");
  }

  finish() {
    return this._h.digest("hex");
  }
}

/**
 * cachetools' LRUCache, as RenderCache used it: `get` promotes, `has` doesn't, an insert past
 * `maxsize` first evicts the least recently used entry, and iteration is INSERTION order
 * (cachetools keeps the data in a plain dict beside its recency order).
 */
class LRUCache {
  constructor(maxsize) {
    this.maxsize = maxsize;
    this.data = new Map();
    this.order = new Map();
  }

  get size() {
    return this.data.size;
  }

  has(key) {
    return this.data.has(key);
  }

  get(key) {
    if (!this.data.has(key)) return undefined;
    this.order.delete(key);
    this.order.set(key, true);
    return this.data.get(key);
  }

  set(key, value) {
    if (!this.data.has(key)) {
      while (this.data.size + 1 > this.maxsize && this.order.size) {
        const lru = this.order.keys().next().value;
        this.order.delete(lru);
        this.data.delete(lru);
      }
    }
    this.data.set(key, value);
    this.order.delete(key);
    this.order.set(key, true);
  }

  entries() {
    return this.data.entries();
  }

  values() {
    return this.data.values();
  }
}

const memKey = (scope, key) => `${scope}\u0000${key}`;
const memParts = (k) => k.split("\u0000");

/** Disk-backed LRU. Each scope is a subdirectory of `root`. */
export class RenderCache {
  constructor(root, maxMemoryEntries = 64) {
    this._root = String(root);
    mkdirSync(this._root, { recursive: true });
    // The in-memory hot tier. Evicting a hot entry has NO side effects: put() writes disk
    // first, so a dropped memory entry just re-reads from disk. maxsize must be >= 1, so the
    // operator-tunable value is clamped — "0" degrades to a 1-entry tier instead of crashing.
    this._maxMemoryEntries = maxMemoryEntries;
    this._memory = new LRUCache(Math.max(1, maxMemoryEntries));
  }

  /** The entry's bytes, or null. A memory hit promotes it; a disk hit fills the hot tier. */
  get(scope, key) {
    const mkey = memKey(scope, key);
    const cached = this._memory.get(mkey);
    if (cached !== undefined) return cached;
    const p = this._path(scope, key);
    if (!existsSync(p)) return null;
    const data = readFileSync(p);
    this._memory.set(mkey, data);
    return data;
  }

  /** Existence probe — no disk read, no LRU promotion. Drives the Studio Render cache banner
   * ("N of M lines unchanged"). */
  has(scope, key) {
    if (this._memory.has(memKey(scope, key))) return true;
    return existsSync(this._path(scope, key));
  }

  put(scope, key, data) {
    const p = this._path(scope, key);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, data);
    this._memory.set(memKey(scope, key), data);
  }

  /**
   * Delete cached entries. Returns the number of files removed. `scope` limits deletion to
   * one scope directory; `olderThanDays` to files whose mtime is older than the cutoff.
   * Entries are hash-keyed, so age and scope are the ONLY filters the cache can honor —
   * voice/engine pruning lives on the generations layer (DELETE /v1/generations).
   */
  clear(scope = null, olderThanDays = null) {
    const cutoff = olderThanDays != null ? Date.now() / 1000 - olderThanDays * 86400.0 : null;
    let removed = 0;
    let dirs;
    if (scope == null) {
      dirs = readdirSync(this._root)
        .map((n) => path.join(this._root, n))
        .filter((d) => isDir(d));
    } else {
      const d = path.join(this._root, scope);
      dirs = existsSync(d) ? [d] : [];
    }
    for (const child of dirs) {
      for (const name of readdirSync(child).filter((n) => n.endsWith(".bin"))) {
        const f = path.join(child, name);
        if (cutoff !== null) {
          try {
            if (statSync(f).mtimeMs / 1000 >= cutoff) continue;
          } catch {
            continue;
          }
        }
        rmSync(f, { force: true });
        removed += 1;
      }
      try {
        rmdirSync(child); // only succeeds if now empty
      } catch {
        /* not empty */
      }
    }
    // Drop memory entries whose backing file is gone (put() always writes disk first, so
    // disk is the source of truth here).
    const survivors = [...this._memory.entries()].filter(([k]) => existsSync(this._path(...memParts(k))));
    this._memory = new LRUCache(Math.max(1, this._maxMemoryEntries));
    for (const [k, v] of survivors) this._memory.set(k, v);
    return removed;
  }

  stats() {
    const scopes = {};
    let totalEntries = 0;
    let totalBytes = 0;
    for (const name of readdirSync(this._root)) {
      const scopeDir = path.join(this._root, name);
      if (!isDir(scopeDir)) continue;
      const entries = readdirSync(scopeDir).filter((n) => n.endsWith(".bin"));
      let bytesOnDisk = 0;
      for (const f of entries) bytesOnDisk += statSync(path.join(scopeDir, f)).size;
      scopes[name] = { entries_on_disk: entries.length, bytes_on_disk: bytesOnDisk };
      totalEntries += entries.length;
      totalBytes += bytesOnDisk;
    }
    let memoryBytes = 0;
    for (const v of this._memory.values()) memoryBytes += v.length;
    return construct(CacheStats, {
      total_entries_on_disk: totalEntries,
      total_bytes_on_disk: totalBytes,
      memory_entries: this._memory.size,
      memory_bytes: memoryBytes,
      scopes,
    });
  }

  /** The entry's file. The scope name is sanitised (no slashes / special chars on disk). */
  _path(scope, key) {
    const safe = Array.from(scope)
      .map((c) => (/[\p{L}\p{N}]/u.test(c) || "-_.".includes(c) ? c : "_"))
      .slice(0, 80)
      .join("");
    return path.join(this._root, safe, `${key}.bin`);
  }
}

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Prepend a tiny header so the cache file carries format info (`struct.pack("<IH")`). */
export function packPcmWithFormat(pcm, sampleRate, channels) {
  const head = Buffer.alloc(6);
  head.writeUInt32LE(sampleRate, 0);
  head.writeUInt16LE(channels, 4);
  return Buffer.concat([head, Buffer.from(pcm)]);
}

/** `[sampleRate, channels, pcm]`. */
export function unpackPcmWithFormat(buf) {
  if (buf.length < 6) throw new ValueError("buffer too small for PCM-with-format header");
  return [buf.readUInt32LE(0), buf.readUInt16LE(4), buf.subarray(6)];
}
