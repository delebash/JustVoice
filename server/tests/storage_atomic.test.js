// SPDX-License-Identifier: MIT
// Tests for atomic JSON write — the crash-safety primitive (the port of
// tests/test_storage_atomic.py). Python's `object()` (no serializer) is a class instance here.
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { EOL } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { atomicWriteJson } from "../src/storage/atomic.js";
import { tmpPath, tmpStorageDir } from "./helpers.js";

class Unserializable {}

const read = (p) => JSON.parse(readFileSync(p, "utf8"));

test("round_trip", () => {
  const dir = tmpStorageDir(tmpPath());
  mkdirSync(dir, { recursive: true });
  const p = path.join(dir, "settings.json");
  const data = { x: 1, y: [2, 3], z: "ok" };
  atomicWriteJson(p, data);
  expect(read(p)).toEqual(data);
  // Python's json.dump(indent=2) bytes, written in text mode (os.linesep — CRLF on Windows).
  const want = '{\n  "x": 1,\n  "y": [\n    2,\n    3\n  ],\n  "z": "ok"\n}'.replaceAll("\n", EOL);
  expect(readFileSync(p, "utf8")).toBe(want);
});

test("overwrite", () => {
  const dir = tmpStorageDir(tmpPath());
  mkdirSync(dir, { recursive: true });
  const p = path.join(dir, "settings.json");
  atomicWriteJson(p, { a: 1 });
  atomicWriteJson(p, { a: 2 });
  expect(read(p)).toEqual({ a: 2 });
});

test("no_temp_file_left_behind", () => {
  // Atomic write should not leave .tmp/.partial siblings on success.
  const dir = tmpStorageDir(tmpPath());
  mkdirSync(dir, { recursive: true });
  atomicWriteJson(path.join(dir, "settings.json"), { a: 1 });
  expect(readdirSync(dir)).toEqual(["settings.json"]);
});

test("tmp_cleaned_up_when_unserializable", () => {
  // A serialization failure must not leave a `.tmp` behind (and never create the target).
  const dir = tmpStorageDir(tmpPath());
  mkdirSync(dir, { recursive: true });
  expect(() => atomicWriteJson(path.join(dir, "settings.json"), { bad: new Unserializable() })).toThrow(TypeError);
  expect(readdirSync(dir).sort()).toEqual([]);
});

test("overwrite_preserved_when_new_payload_unserializable", () => {
  // A failed rewrite must leave the previously-written file intact.
  const dir = tmpStorageDir(tmpPath());
  mkdirSync(dir, { recursive: true });
  const p = path.join(dir, "settings.json");
  atomicWriteJson(p, { a: 1 });
  expect(() => atomicWriteJson(p, { bad: new Unserializable() })).toThrow(TypeError);
  expect(read(p)).toEqual({ a: 1 });
  expect(readdirSync(dir).sort()).toEqual(["settings.json"]);
});
