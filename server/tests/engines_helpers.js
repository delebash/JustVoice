// SPDX-License-Identifier: MIT
// Test helpers for the speech-engine layer's suites (wave B) — fake hardware, an injected
// arbiter, WAV builders, a bare manager, an app state on a temp folder.
//
// Importing this module points the default data folder at a temp folder for the whole test
// file (the DSP program logs there when no app state is set — never into the checkout's
// `data/`), and forgets any `npm run dev` build named in the environment (conftest.py did the
// same: the suite tests the pinned release unless a test points at a build itself).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as llmDb from "@delebash/llm-runner/llm/db";
import { Mutex } from "@delebash/llm-runner/platform/asyncutil";
import { model } from "@delebash/llm-runner/platform/models";
import * as arbiter from "@delebash/llm-runner/runner/arbiter";
import { GpuInfo, HardwareInfo } from "@delebash/llm-runner/runner/schema";
import * as appState from "../src/app_state.js";
import { writeWavContainer } from "../src/audio/wav.js";
import * as session from "../src/database/session.js";
import * as devBuild from "../src/engines/audiocpp/dev_build.js";
import { EngineManager } from "../src/engines/manager.js";
import { tmpPath } from "./helpers.js";

process.env.JUSTVOICE_DATA_DIR = mkdtempSync(path.join(tmpdir(), "jv-test-data-"));
delete process.env.JUSTVOICE_AUDIOCPP_BUILD;
devBuild.current.cacheClear();

/** A discrete NVIDIA box (the kit's HardwareInfo, camelCase). */
export const discrete = (vramMb = 8192, ramMb = 32768) =>
  model(HardwareInfo, {
    os: "Windows",
    platform: "windows",
    cpuCores: 8,
    ramMb,
    gpus: [model(GpuInfo, { vendor: "NVIDIA", name: "fake", vramMb })],
    runtimes: { cuda: true },
  });

/** A one-pool (integrated graphics) box. */
export const onePool = (ramMb = 16384) =>
  model(HardwareInfo, {
    os: "Windows",
    platform: "windows",
    cpuCores: 8,
    ramMb,
    gpus: [model(GpuInfo, { vendor: "Intel", name: "Intel(R) Graphics", vramMb: 128 })],
    runtimes: {},
  });

/** Install a fresh arbiter over fake hardware (set_arbiter); `resetArbiter()` after. */
export function makeArbiter(hw) {
  const arb = new arbiter.VramArbiter(() => hw);
  arbiter.setArbiter(arb);
  return arb;
}
export const resetArbiter = () => arbiter.setArbiter(null);

/** `seconds` of 16-bit mono silence as a WAV (Python's `wave` writer, byte for byte). */
export const wav = (seconds, rate = 24000) => writeWavContainer(Buffer.alloc(Math.trunc(seconds * rate) * 2), rate, 1);

/** EngineManager.__new__ + the fields the code reads — no discovery. */
export function bareManager() {
  const mgr = Object.create(EngineManager.prototype);
  Object.assign(mgr, {
    _manifests: new Map(),
    _loaded: new Map(),
    _currentVariants: new Map(),
    _lock: new Mutex(),
    _cancelLoadRequests: new Set(),
    _activityLocks: new Map(),
    _resolvedDevices: new Map(),
    _placementReasons: new Map(),
    _hwCache: null,
    _hwDetected: true, // never shell out to nvidia-smi in a unit test
    _probeCache: new Map(),
  });
  return mgr;
}

/** create_app(data_dir=tmp)'s state half: the database at `dir` (or a new temp folder), the
 * shared LLM tables' storage on it, and an AppState set. Returns the state; `endState()` after. */
export function useState(dir = null) {
  const d = dir ?? tmpPath("jv-test-app-");
  session.initDb(d);
  llmDb.configureStorage(session.cfg.handle);
  llmDb.createAll(session.cfg.handle);
  const st = new appState.AppState(d);
  appState.setState(st);
  return st;
}

export function endState() {
  appState.cfg.state = null;
  session.closeDb();
  session.cfg.dbPath = null;
}
