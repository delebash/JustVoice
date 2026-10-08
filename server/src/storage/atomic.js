// SPDX-License-Identifier: MIT
// Atomic JSON write helper (the port of justvoice/storage/atomic.py).
//
// Writes go through `<path>.tmp` + rename so a partial write never leaves a corrupt JSON
// file. The text is Python's `json.dump(data, f, indent=2)` byte for byte (pyJson): a file
// written by either server reads the same in both.

import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from "node:fs";
import { EOL } from "node:os";
import path from "node:path";
import { PyFloat, pyJson } from "@delebash/llm-runner/platform/pyjson";
import { dtIso } from "../models.js";

/**
 * Python's `default=_default_serializer`: a datetime → isoformat(); anything else that is not
 * plain JSON (a class instance, a function, a symbol) → TypeError, as `json.dump` raises for
 * an object it can't serialize.
 */
function serializable(v) {
  if (v === null || v === undefined || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number" || typeof v === "bigint" || v instanceof PyFloat) return v;
  if (v instanceof Date) return dtIso(v);
  if (Array.isArray(v)) return v.map(serializable);
  if (typeof v === "object") {
    const proto = Object.getPrototypeOf(v);
    if (proto === Object.prototype || proto === null) {
      const out = {};
      for (const [k, x] of Object.entries(v)) out[k] = serializable(x);
      return out;
    }
    throw new TypeError(`Cannot serialize ${v.constructor?.name ?? "object"}`);
  }
  throw new TypeError(`Cannot serialize ${typeof v}`);
}

/**
 * Write `data` to `filePath` atomically. Creates parent dirs if needed; renders with
 * `indent` spaces (default 2) for human-readability when operators edit the file directly.
 *
 * Durability: the tmp file is flushed + fsync'd before the rename, so a power loss between
 * the write and the kernel flushing file *data* can't expose a zero-length file — the exact
 * corruption this module exists to prevent. On ANY failure (serialization or IO) the tmp
 * file is removed instead of being left as a stray `.tmp` sibling.
 */
export function atomicWriteJson(filePath, data, indent = 2) {
  const p = String(filePath);
  mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  try {
    const fd = openSync(tmp, "w");
    try {
      // Python opened the file in text mode, which writes os.linesep for every "\n" — CRLF on
      // Windows (measured). A pretty-printed dump has newlines only between tokens.
      writeSync(fd, pyJson(serializable(data), { indent }).replaceAll("\n", EOL));
      fsyncSync(fd); // force file *data* to disk before the rename
    } finally {
      closeSync(fd);
    }
    // rename replaces atomically on POSIX + Windows (MoveFileEx with REPLACE_EXISTING).
    renameSync(tmp, p);
  } catch (e) {
    // Serialization or IO failed — don't leave a partial `.tmp` behind for the next reader.
    rmSync(tmp, { force: true });
    throw e;
  }
  // Best-effort: fsync the parent directory so the rename itself is durable on POSIX. A
  // directory can't be fsync'd on Windows (open fails) — skip cleanly there.
  try {
    const dfd = openSync(path.dirname(p), "r");
    try {
      fsyncSync(dfd);
    } finally {
      closeSync(dfd);
    }
  } catch {
    /* not supported here */
  }
}
