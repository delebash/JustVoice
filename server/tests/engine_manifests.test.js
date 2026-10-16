// SPDX-License-Identifier: MIT
// Tests for engine discovery + required-field validation (the port of
// tests/test_engine_manifests.py). Every engine is a catalog: a module declaring its id, name,
// capabilities and its model VARIANTS, each runnable in the speech runtime. Since the adoption
// plan's slice 4 every engine is built from audio.cpp's own files (engines/audiocpp/generated.js) —
// the seven described by our own files too, which were hand-written `engines/<id>/manifest.js`
// files discovery scanned for until then; no engine folder holds a manifest or a program now.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import "./engines_helpers.js";
import { discoverEngines, ENGINES_DIR } from "../src/engines/manager.js";

test("every_engine_declares_its_id_and_name", () => {
  for (const [engineId, m] of discoverEngines()) {
    expect(m.module.ID, `${engineId} missing ID`).toBe(engineId);
    expect(m.module.NAME, `${engineId} missing NAME`).toBeTypeOf("string");
  }
});

test("every_engine_runs_in_the_speech_runtime", () => {
  // Since 2026-10-01 there is no per-engine program: an engine.js or a manifest.js in an engine
  // folder would be dead code, and a variant with no `audiocpp` block would have nothing to run it.
  for (const d of readdirSync(ENGINES_DIR, { withFileTypes: true }).filter((x) => x.isDirectory())) {
    for (const stray of ["engine.js", "manifest.js"]) expect(existsSync(path.join(ENGINES_DIR, d.name, stray)), `${d.name}/${stray}`).toBe(false);
  }
  for (const [engineId, m] of discoverEngines()) expect(m.usesAudiocpp, `${engineId}: a variant has no audiocpp block`).toBe(true);
});

test("at_least_one_engine_discovered", () => {
  expect(discoverEngines().size).toBeGreaterThanOrEqual(1);
});
