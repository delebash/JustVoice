// SPDX-License-Identifier: MIT
// Load-door pins (phase ②, plan doc §12, and the 2026-10-01 switch): the manager makes the
// planned variant LOCAL — in the speech cache — before the runtime is told about it, and
// passes the folder on /load; an already-loaded early return never re-triggers acquisition;
// bare contexts (no app state / unknown catalog row) answer null instead of inventing a path
// (the port of tests/test_engine_local_load.py; its `app` fixture is `useState`).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { endState, useState } from "./engines_helpers.js";
import * as runtime from "../src/engines/audiocpp/runtime.js";
import * as manager from "../src/engines/manager.js";
import { discoverEngines, EngineManager } from "../src/engines/manager.js";
import * as speechCache from "../src/speech_cache.js";

afterEach(() => endState());

const resp = () => ({ statusCode: 200, text: "", json: () => ({ ok: true, voices: [] }) });

class Slot {
  constructor(manifest, placement = "gpu") {
    this.manifest = manifest;
    this.placement = placement;
    this.terminated = false;
    this.loadBodies = [];
  }
  spawn() {}
  isAlive() {
    return !this.terminated;
  }
  terminate() {
    this.terminated = true;
  }
  post(p, json = null) {
    if (p === "/load") this.loadBodies.push(json);
    return resp();
  }
  get() {
    return resp();
  }
}

const manifest = (engineId = "eng") => ({ id: engineId, kind: "tts", isInstalled: true, defaultVariantId: "v1", requirements: {} });

function mgrFor(m) {
  vi.spyOn(manager, "_newSlot").mockImplementation((mm, p) => new Slot(mm, p));
  vi.spyOn(EngineManager.prototype, "_resolveDevice").mockReturnValue("cpu");
  vi.spyOn(EngineManager.prototype, "poolUsedMb").mockResolvedValue(null);
  vi.spyOn(EngineManager.prototype, "_priceMb").mockReturnValue(0);
  vi.spyOn(EngineManager.prototype, "_recordSpeechLoad").mockImplementation(() => {});
  vi.spyOn(EngineManager.prototype, "placementFor").mockResolvedValue(["gpu", "test", false]);
  const mgr = new EngineManager();
  mgr._manifests = new Map([[m.id, m]]);
  mgr._hwCache = null;
  mgr._hwDetected = true;
  return mgr;
}

test("load_passes_the_local_dir_on_load", async () => {
  const mgr = mgrFor(manifest());
  vi.spyOn(EngineManager.prototype, "_ensureVariantLocal").mockImplementation(async (m, v) => (v === "v1" ? "X:/cache/eng/v1" : null));
  await mgr.load("eng", { device: "cpu" });
  const body = mgr._loaded.get("tts").loadBodies[0];
  expect(body.model_dir).toBe("X:/cache/eng/v1");
  expect(body.variant).toBe("v1"); // the resolved default rode along
});

test("already_loaded_never_retriggers_acquisition", async () => {
  const mgr = mgrFor(manifest());
  const calls = [];
  vi.spyOn(EngineManager.prototype, "_ensureVariantLocal").mockImplementation(async (m, v) => {
    calls.push(v);
    return null;
  });
  await mgr.load("eng", { device: "cpu" });
  expect(calls).toEqual(["v1"]);
  await mgr.load("eng", { device: "cpu" }); // early return — same engine, no variant
  expect(calls).toEqual(["v1"]);
});

test("acquisition_answers_none_in_bare_contexts", async () => {
  // No usable app state / no catalog row → null, never an invented path.
  const mgr = mgrFor(manifest());
  expect(await mgr._ensureVariantLocal(mgr._manifests.get("eng"), "v1", null, null)).toBeNull();
  expect(await mgr._ensureVariantLocal(mgr._manifests.get("eng"), null, null, null)).toBeNull();
});

/** Files + the speech cache's files.json record, as a finished fetch leaves them. */
function putOnDisk(vdir, name, size) {
  mkdirSync(vdir, { recursive: true });
  writeFileSync(path.join(vdir, name), Buffer.alloc(size));
  writeFileSync(path.join(vdir, speechCache.MANIFEST_NAME), JSON.stringify({ sources: [], files: [{ path: name, size, oid: "" }] }));
}

test("a_downloaded_model_needs_no_fetch", async () => {
  const st = useState();
  const vdir = speechCache.variantDir(st.dataDir, "kokoro", "kokoro-82m-q8");
  putOnDisk(vdir, "kokoro-82m-q8_0.gguf", 64);
  vi.spyOn(speechCache, "fetchHfVariant").mockImplementation(() => {
    throw new Error("a downloaded model was fetched again");
  });
  const mgr = Object.create(EngineManager.prototype);
  expect(await mgr._ensureVariantLocal({ id: "kokoro" }, "kokoro-82m-q8", null, null)).toBe(String(vdir));
});

test("model_files_on_disk_do_not_make_an_engine_installed", () => {
  // Weights are not the program. An engine is installed when the speech runtime is.
  const st = useState();
  putOnDisk(speechCache.variantDir(st.dataDir, "kokoro", "kokoro-82m-q8"), "kokoro-82m-q8_0.gguf", 64);
  const kokoro = discoverEngines().get("kokoro");
  expect(speechCache.anyVariantOnDisk(st.dataDir, "kokoro")).toBe(true);
  vi.spyOn(runtime, "installedExe").mockReturnValue(null);
  expect(kokoro.isInstalled).toBe(false);
  vi.spyOn(runtime, "installedExe").mockReturnValue("C:/rt/audiocpp_server.exe");
  expect(kokoro.isInstalled).toBe(true);
});
