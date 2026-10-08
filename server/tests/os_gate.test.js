// SPDX-License-Identifier: MIT
// The OS gate must be declared honestly and must actually fire (the port of
// tests/test_os_gate.py). Every manifest declares SUPPORTED_OSES explicitly, and
// `installEngine()` refuses before any install work runs. (Python parametrized three tests
// over the engines; here each loops over them.)
//
// Not ported here: test_the_catalog_serves_the_verdict_not_just_the_list — it reads
// GET /v1/engines (api/engines_api, a later wave): test.todo.
import { afterEach, expect, test, vi } from "vitest";
import "./engines_helpers.js";
import * as manager from "../src/engines/manager.js";
import { discoverEngines, InstallError } from "../src/engines/manager.js";

const VALID_OS_LABELS = new Set(["windows", "linux", "macos"]);
const manifests = () => [...discoverEngines().entries()].sort(([a], [b]) => (a < b ? -1 : 1));

test("every_manifest_declares_supported_oses_explicitly", () => {
  // No engine may rely on the all-three default — an inherited platform claim is a claim
  // nobody made.
  for (const [engineId, m] of manifests()) {
    expect(Object.hasOwn(m.module, "SUPPORTED_OSES"), `${engineId}/manifest.js does not declare SUPPORTED_OSES`).toBe(true);
  }
});

test("declared_oses_are_valid_and_sane", () => {
  for (const [engineId, m] of manifests()) {
    const declared = m.supportedOses;
    expect(declared.length, `${engineId} declares an empty SUPPORTED_OSES`).toBeGreaterThan(0);
    expect(declared.filter((o) => !VALID_OS_LABELS.has(o)), `${engineId} declares unknown OS label(s)`).toEqual([]);
    expect(new Set(declared).size, `${engineId} repeats an OS label`).toBe(declared.length);
  }
});

test("supports_current_os_agrees_with_the_declaration", () => {
  for (const [, m] of manifests()) {
    expect(m.supportsCurrentOs()).toBe(m.supportedOses.includes(manager._currentOsLabel()));
  }
});

test("every_engine_runs_on_all_three", () => {
  // Every engine is a set of model files the speech runtime loads, and audio.cpp ships a
  // build for Windows, Linux and macOS.
  for (const [engineId, m] of manifests()) expect(new Set(m.supportedOses), engineId).toEqual(VALID_OS_LABELS);
});

// ── The gate ──────────────────────────────────────────────────────────────

let restore = null;
afterEach(() => {
  if (restore) restore();
  restore = null;
});

/** Kokoro with macOS taken out of its declaration, on a host claiming to be a Mac. */
function macExcluded() {
  vi.spyOn(manager, "_currentOsLabel").mockReturnValue("macos");
  const m = discoverEngines().get("kokoro");
  const was = m.module.SUPPORTED_OSES;
  m.module.SUPPORTED_OSES = ["windows", "linux"];
  restore = () => {
    m.module.SUPPORTED_OSES = was;
  };
  return m;
}

test("install_engine_refuses_an_unsupported_os", async () => {
  const m = macExcluded();
  expect(m.supportsCurrentOs()).toBe(false);
  const err = await manager.installEngine(m).catch((e) => e);
  expect(err).toBeInstanceOf(InstallError);
  expect(err.message).toContain("kokoro");
  expect(err.message).toContain("macos");
  // The message names what IS supported, so the user can act on it.
  for (const declared of m.supportedOses) expect(err.message).toContain(declared);
});

test("the_gate_runs_before_any_install_work", async () => {
  const m = macExcluded();
  const called = [];
  vi.spyOn(manager, "_installAudiocppRuntime").mockImplementation(async () => called.push("runtime"));
  await expect(manager.installEngine(m)).rejects.toBeInstanceOf(InstallError);
  expect(called).toEqual([]);
});

test("a_supported_os_passes_the_gate", async () => {
  // Kokoro declares all three OSes, so the runtime install runs (stubbed).
  const called = [];
  vi.spyOn(manager, "_currentOsLabel").mockReturnValue("macos");
  vi.spyOn(manager, "_installAudiocppRuntime").mockImplementation(async () => called.push("runtime"));
  await manager.installEngine(discoverEngines().get("kokoro"));
  expect(called).toEqual(["runtime"]);
});

test.todo("the_catalog_serves_the_verdict_not_just_the_list — waits for app.js + api/engines_api.js");
