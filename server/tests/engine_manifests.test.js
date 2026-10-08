// SPDX-License-Identifier: MIT
// Tests for engine manifests — discovery + required-field validation (the port of
// tests/test_engine_manifests.py). Every engine is a catalog: a manifest.js declaring its id,
// name, capabilities and its model VARIANTS, each runnable in the speech runtime. Discovery
// walks engines/<id>/manifest.js. (Python parametrized the first two over the engine ids;
// here each loops over them.)
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import "./engines_helpers.js";
import { discoverEngines, ENGINES_DIR } from "../src/engines/manager.js";

function engineIds() {
  return readdirSync(ENGINES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && !d.name.startsWith("."))
    .map((d) => d.name)
    .filter((n) => existsSync(path.join(ENGINES_DIR, n, "manifest.js")));
}

test("manifest_imports_cleanly", async () => {
  for (const engineId of engineIds()) {
    const mod = await import(pathToFileURL(path.join(ENGINES_DIR, engineId, "manifest.js")).href);
    // Sanity-check the manifest exposes the required surface.
    expect(mod.ID, `${engineId} manifest missing ID`).toBeTypeOf("string");
    expect(mod.NAME, `${engineId} manifest missing NAME`).toBeTypeOf("string");
  }
});

test("every_engine_runs_in_the_speech_runtime", () => {
  // Since 2026-10-01 there is no per-engine program: an engine.js beside a manifest would be
  // dead code, and a variant with no `audiocpp` block would have nothing to run it.
  const discovered = [...discoverEngines().values()];
  for (const engineId of engineIds()) {
    expect(existsSync(path.join(ENGINES_DIR, engineId, "engine.js")), `${engineId} has a stray engine.js`).toBe(false);
    const m = discovered.find((x) => path.basename(x.engineDir) === engineId);
    expect(m.usesAudiocpp, `${engineId}: a variant has no audiocpp block`).toBe(true);
  }
});

test("at_least_one_engine_discovered", () => {
  expect(engineIds().length).toBeGreaterThanOrEqual(1);
});
