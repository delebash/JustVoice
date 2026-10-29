// SPDX-License-Identifier: MIT
// The OS gate must be declared honestly and its verdict must reach the client (the port of
// tests/test_os_gate.py). Every manifest declares SUPPORTED_OSES explicitly; the catalog still
// lists an engine this OS can't run, with `supported_on_this_os` false. (Python parametrized three
// tests over the engines; here each loops over them.) Until round E `installEngine()` refused one
// before any install work ran; installing is the kit's audio.cpp runtime's now (docs/plans/
// 2026-10-29-round-e-onto-the-kit.md), so the catalog's verdict is what stays ours.
import { afterEach, expect, test, vi } from "vitest";
import { appClient, closeApps } from "./app_helpers.js";
import "./engines_helpers.js";
import * as modelCatalog from "../src/engines/model_catalog.js";
import { discoverEngines } from "../src/engines/model_catalog.js";

const VALID_OS_LABELS = new Set(["windows", "linux", "macos"]);
const manifests = () => [...discoverEngines().entries()].sort(([a], [b]) => (a < b ? -1 : 1));

test("every_manifest_declares_supported_oses_explicitly", () => {
  // No engine may rely on the all-three default — an inherited platform claim is a claim
  // nobody made.
  for (const [engineId, m] of manifests()) {
    expect(Object.hasOwn(m.module, "SUPPORTED_OSES"), `${engineId} does not declare SUPPORTED_OSES`).toBe(true);
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
    expect(m.supportsCurrentOs()).toBe(m.supportedOses.includes(modelCatalog.currentOsLabel()));
  }
});

test("every_engine_runs_on_all_three", () => {
  // Every engine is a set of model files the speech runtime loads, and audio.cpp ships a
  // build for Windows, Linux and macOS.
  for (const [engineId, m] of manifests()) expect(new Set(m.supportedOses), engineId).toEqual(VALID_OS_LABELS);
});

// ── The verdict ───────────────────────────────────────────────────────────

let restore = null;
afterEach(async () => {
  await closeApps();
  if (restore) restore();
  restore = null;
});

/** Kokoro with macOS taken out of its declaration, on a host claiming to be a Mac. */
function macExcluded() {
  vi.spyOn(modelCatalog, "currentOsLabel").mockReturnValue("macos");
  const m = discoverEngines().get("kokoro");
  const was = m.module.SUPPORTED_OSES;
  m.module.SUPPORTED_OSES = ["windows", "linux"];
  restore = () => {
    m.module.SUPPORTED_OSES = was;
  };
  return m;
}

test("a_blocked_engine_is_listed_with_the_verdict", async () => {
  // The catalog still LISTS an engine this OS can't run; the verdict says so, and names what IS
  // supported, so the user can act on it.
  const m = macExcluded();
  expect(m.supportsCurrentOs()).toBe(false);
  const { c } = await appClient();
  const kokoro = (await c.get("/v1/engines")).json().engines.find((e) => e.id === "kokoro");
  expect(kokoro).toMatchObject({ supported_oses: ["windows", "linux"], supported_on_this_os: false });
});

test("the_catalog_serves_the_verdict_not_just_the_list", async () => {
  // `supported_on_this_os` must reach the client. The renderer must never re-derive it: it can
  // be a browser on a different machine than the server, so only the server knows the platform
  // the engine would actually install on.
  const { c } = await appClient();
  const body = (await c.get("/v1/engines")).json();
  const managed = Object.fromEntries(body.engines.filter((e) => e.supported_oses?.length).map((e) => [e.id, e]));
  expect(Object.keys(managed).length, "no engine served a supported_oses list").toBeGreaterThan(0);
  const manifests = discoverEngines();
  for (const [engineId, served] of Object.entries(managed)) {
    expect(served, `${engineId} served supported_oses without the verdict`).toHaveProperty("supported_on_this_os");
    expect(served.supported_on_this_os).toBe(manifests.get(engineId).supportsCurrentOs());
  }
});
