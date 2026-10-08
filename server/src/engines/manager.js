// SPDX-License-Identifier: MIT
// Speech engine manager — discovery, the runtime install, per-kind slots, memory (the port of
// justvoice/engines/manager.py).
//
// Each engine lives in `server/src/engines/<id>/` as a catalog: `manifest.js` (metadata,
// capabilities, and the model VARIANTS with their pinned GGUF files). Every variant's models
// run in the ONE audio.cpp speech runtime (`engines/audiocpp/`, the 2026-10-01 switch —
// docs/plans/2026-10-01-audiocpp-switch.md):
//
// On Install: the runtime binary for this machine (+ eSpeak NG) — once, for every engine.
// On Download: the variant's file(s) into the speech cache (`speech_cache.js`).
// On Load: the model's PLACEMENT is decided — the graphics card or the CPU, per model, Auto
//   from what was measured (`placementFor`, docs/plans/2026-10-02-cpu-placement.md §8) — the
//   runtime process for that placement is (re)started, and the slot
//   (`audiocpp/slot.js: AudioCppSlot`) warms the chosen model. One slot per kind (tts / stt);
//   the kit's VRAM arbiter books each kind's measured share (a CPU-placed model books nothing
//   on a discrete card).
// On Synth / Transcribe / Align: the slot maps our request onto audio.cpp's HTTP API.
// On Uninstall: the engine's downloaded models are deleted; the runtime stays.
//
// Locks (Python's threads → one event loop): each kind's activity lock and the manager's own
// lock are Mutexes held exactly where Python's locks spanned I/O (a slot's terminate / spawn);
// state read without I/O needs no lock. Lock order: activity → the manager's lock.

import { existsSync, readdirSync, readFileSync, realpathSync, rmdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stores } from "@delebash/llm-runner/llm";
import { background, Mutex, sleep } from "@delebash/llm-runner/platform/asyncutil";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { floorDiv, pyInt, pyRound, RuntimeError } from "@delebash/llm-runner/platform/py";
import { pyFixed } from "@delebash/llm-runner/platform/pyjson";
import * as arbiter from "@delebash/llm-runner/runner/arbiter";
import * as kitConfig from "@delebash/llm-runner/runner/config";
import * as download from "@delebash/llm-runner/runner/download";
import * as hardware from "@delebash/llm-runner/runner/hardware";
import * as lifecycle from "@delebash/llm-runner/runner/lifecycle";
import * as appState from "../app_state.js";
import { DEFAULT_MAX_CHUNK_CHARS } from "../audio/chunked.js";
import { ApiError, badRequest, conflict, internal, serviceUnavailable } from "../errors.js";
import * as paths from "../paths.js";
import * as speechCache from "../speech_cache.js";
import * as asrManifest from "./asr/manifest.js";
import * as devBuild from "./audiocpp/dev_build.js";
import * as espeak from "./audiocpp/espeak.js";
import * as japanese from "./audiocpp/japanese.js";
import * as release from "./audiocpp/release.js";
import * as runtime from "./audiocpp/runtime.js";
import * as slot from "./audiocpp/slot.js";
import * as chatterboxManifest from "./chatterbox/manifest.js";
import * as kittenManifest from "./kitten/manifest.js";
import * as kokoroManifest from "./kokoro/manifest.js";
import * as self from "./manager.js";
import * as modelCatalog from "./model_catalog.js";
import * as pocketManifest from "./pocket/manifest.js";
import * as qwen3Manifest from "./qwen3/manifest.js";
import * as voxcpm2Manifest from "./voxcpm2/manifest.js";

const log = getLogger("justvoice.engines.manager");

// ─── Constants ────────────────────────────────────────────────────────

export const ENGINES_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Where engine MUTABLE state lives — the speech runtime's builds and eSpeak NG
 * (`<root>/audiocpp/…`): `<data_dir>/engines-runtime`, always (decided for the JS server: the
 * runtime follows the user's data folder — the family's "all data under the chosen root"
 * law; Python kept it in the source tree when unfrozen). Deliberately SHORT, because Windows
 * still caps most path APIs at 260 characters. The data dir is the app state's, else the
 * default data folder (no state: a script, a bare test).
 */
export function enginesRuntimeRoot() {
  let dataDir = null;
  try {
    dataDir = appState.getState().dataDir ?? null;
  } catch {
    dataDir = null;
  }
  return path.join(String(dataDir ?? paths.defaultDataDir()), "engines-runtime");
}

// Folder names that aren't engines — skipped during discovery. A folder without a manifest.js
// is skipped anyway; the runtime's own folder is named so it never reads as one.
export const NOT_ENGINES = new Set(["audiocpp"]);

// The speech measured currency: the probes can shell out (nvidia-smi / typeperf), so every
// polling/per-line caller goes through a short TTL cache. There is NO pre-load estimate
// constant: the only numbers in the pricing chain are measured ones.
export const PROBE_TTL_S = 2.0;

const monotonic = () => performance.now() / 1000;
const msgOf = (e) => e?.message ?? String(e);

/** time.sleep (seconds) — a test replaces it. */
export async function _sleep(seconds) {
  await sleep(seconds * 1000);
}

/** Run `fn` with the arbiter's `kind` marked busy (Q1's never-evict-busy). Best-effort:
 * without the shared stack there is no ledger and nothing to protect. */
export async function _withKindBusy(kind, fn) {
  let arb = null;
  try {
    arb = arbiter.getArbiter();
  } catch {
    arb = null;
  }
  if (arb !== null) arb.busyBegin(kind);
  try {
    return await fn();
  } finally {
    if (arb !== null) arb.busyEnd(kind);
  }
}

/** Normalised OS string used by manifests' SUPPORTED_OSES lists. */
export function _currentOsLabel() {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
}

// ─── Manifest loading ─────────────────────────────────────────────────

// The manifests, imported once (ESM can't import synchronously on a folder scan). Each is a
// MUTABLE copy of its module's exports — Python modules are objects a test may patch
// (DEPRECATED, SUPPORTED_OSES), and every discovery wraps the same copy, as Python's
// re-import returned the same module. A new engine folder adds its manifest here.
export const MANIFEST_MODULES = new Map([
  ["asr", { ...asrManifest }],
  ["chatterbox", { ...chatterboxManifest }],
  ["kitten", { ...kittenManifest }],
  ["kokoro", { ...kokoroManifest }],
  ["pocket", { ...pocketManifest }],
  ["qwen3", { ...qwen3Manifest }],
  ["voxcpm2", { ...voxcpm2Manifest }],
]);

const has = (o, k) => o != null && Object.hasOwn(o, k);
const attr = (o, k, d) => (has(o, k) ? o[k] : d);

/** Lightweight wrapper around an engine's manifest module. */
export class EngineManifest {
  constructor(engineDir, module) {
    this.engineDir = engineDir;
    this.module = module;
  }

  get id() {
    return attr(this.module, "ID", path.basename(this.engineDir));
  }

  get name() {
    return attr(this.module, "NAME", this.id);
  }

  get description() {
    return attr(this.module, "DESCRIPTION", "");
  }

  get license() {
    return attr(this.module, "LICENSE", "");
  }

  /** Model-weights license — distinct from the framework code license; LICENSE when unset. */
  get weightsLicense() {
    return attr(this.module, "WEIGHTS_LICENSE", "") || attr(this.module, "LICENSE", "");
  }

  /** The engine's primary kind (slot + section). */
  get kind() {
    return this.kinds[0];
  }

  /** Multi-capability engines declare KINDS = ["tts", "stt"]; single-capability manifests
   * keep KIND. Always non-empty; kinds[0] is the primary. */
  get kinds() {
    const ks = attr(this.module, "KINDS", null);
    if (Array.isArray(ks) && ks.length) return ks.map(String);
    return [attr(this.module, "KIND", "tts")];
  }

  get capabilities() {
    return attr(this.module, "CAPABILITIES", {});
  }

  get requirements() {
    return attr(this.module, "REQUIREMENTS", {});
  }

  /** Voices the engine ships statically — exposed to the host catalog even when the engine
   * isn't loaded. Cloning-based engines leave this empty. */
  get staticVoices() {
    return attr(this.module, "STATIC_VOICES", []);
  }

  /** The model variant a no-variant load loads (the user's Set-as-default choice is layered
   * over it by `EngineManager._resolvedDefaultVariant`). */
  get defaultVariantId() {
    return attr(this.module, "DEFAULT_VARIANT_ID", null);
  }

  /** Always "audiocpp": every engine's models run in the one shared speech runtime. The UI
   * reads it to show the runtime row instead of a per-engine Install. */
  get isolation() {
    return "audiocpp";
  }

  /** OSes this engine can run on: "windows" | "linux" | "macos". ENFORCED AT `installEngine()`.
   * The catalog still LISTS a blocked engine; `supported_on_this_os` carries the verdict. */
  get supportedOses() {
    return attr(this.module, "SUPPORTED_OSES", ["windows", "linux", "macos"]);
  }

  /** Non-empty = marked for removal; the string is the user-facing why. */
  get deprecated() {
    return attr(this.module, "DEPRECATED", "") || "";
  }

  supportsCurrentOs() {
    return this.supportedOses.includes(self._currentOsLabel());
  }

  /** True when this engine's models run in the audio.cpp runtime (every variant row carries an
   * `audiocpp` block). */
  get usesAudiocpp() {
    const rows = attr(this.module, "VARIANTS", null) || [];
    return rows.length > 0 && rows.every((r) => Boolean(r.audiocpp));
  }

  /** True when this engine can run: the shared speech runtime is installed for the configured
   * backend. Its models download separately, and a Load fetches a missing one first. */
  get isInstalled() {
    return runtime.installedExe() !== null;
  }
}

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** Scan engines/*\/ for manifest.js — id → EngineManifest (a Map, folder order). */
export function discoverEngines() {
  const out = new Map();
  let children;
  try {
    children = readdirSync(ENGINES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return out;
  }
  for (const name of children) {
    if (NOT_ENGINES.has(name) || name.startsWith("_")) continue;
    if (!isFile(path.join(ENGINES_DIR, name, "manifest.js"))) continue;
    const mod = MANIFEST_MODULES.get(name);
    if (mod === undefined) {
      log.warning(`engine dir ${name} has a manifest.js the manager does not import — add it to MANIFEST_MODULES`);
      continue;
    }
    try {
      const manifest = new EngineManifest(path.join(ENGINES_DIR, name), mod);
      out.set(manifest.id, manifest);
      log.info(`discovered engine: ${manifest.id} (${manifest.name})`);
    } catch (e) {
      log.exception(`failed to load manifest ${name}: ${msgOf(e)}`, e);
    }
  }
  return out;
}

// ─── Install ──────────────────────────────────────────────────────────

export class InstallError extends RuntimeError {
  constructor(message) {
    super(message);
    this.name = "InstallError";
  }
}

/** An engine refused a use its own terms gate until the user accepts them (manifest TERMS —
 * Pocket TTS cloning, decided 2026-10-02). The API answers 403 with `code: terms_required` and
 * the engine id, so the app can show the terms. */
export class TermsRequired extends RuntimeError {
  constructor(engineId, message) {
    super(message);
    this.name = "TermsRequired";
    this.engineId = engineId;
  }

  /** The 403 problem the app keys on: type `…/terms-required`, plus the engine. */
  apiError() {
    return new ApiError(403, "terms-required", "Terms not accepted", this.message, { engine: this.engineId });
  }
}

/** A speech request the runtime refused or failed, with its status: 503 (out of memory, busy,
 * or the runtime stopped answering), 400 (a request it can't take), 409 (a build feature the
 * installed runtime lacks), 500 otherwise (audit 2026-10-04 §5 D8). */
export class EngineRequestError extends RuntimeError {
  constructor(status, message) {
    super(message);
    this.name = "EngineRequestError";
    this.status = status;
  }

  apiError() {
    if (this.status === 503) return serviceUnavailable(this.message);
    if (this.status === 409) return conflict(this.message);
    if (this.status >= 400 && this.status < 500) {
      return this.status !== 404 ? badRequest(this.message) : new ApiError(404, "not-found", "Not found", this.message);
    }
    return internal(this.message);
  }
}

/** The message inside a slot's error answer (`{"detail": …}`), else its text. */
export function _engineDetail(r) {
  let payload;
  try {
    payload = r.json();
  } catch {
    payload = null;
  }
  if (payload && typeof payload === "object" && !Array.isArray(payload) && payload.detail) return String(payload.detail);
  return r.text;
}

/** A WAV's duration from its RIFF header — data bytes / byte rate, so any sample format
 * reads. null when the bytes are not a WAV this can walk. */
export function _wavSeconds(data) {
  const b = Buffer.from(data ?? []);
  if (b.length < 12 || b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WAVE") return null;
  let i = 12;
  let rate = null;
  let size = null;
  while (i + 8 <= b.length) {
    const cid = b.toString("latin1", i, i + 4);
    const n = b.readUInt32LE(i + 4);
    if (cid === "fmt " && i + 20 <= b.length) rate = b.readUInt32LE(i + 16);
    else if (cid === "data") {
      size = Math.min(n, b.length - i - 8);
      break;
    }
    i += 8 + n + (n & 1);
  }
  return rate && size ? size / rate : null;
}

/** Memory in use on the pool models load into (the GPU on a discrete box), read fresh — the
 * kit's one door. For the load log lines; null = unmeasurable. */
export async function memoryInUseMb() {
  try {
    return await hardware.usedPoolMb({ fresh: true });
  } catch {
    return null; // measuring is informative only
  }
}

const mbText = (v) => (v == null ? "?" : String(v));

/**
 * Install an engine — which, since the 2026-10-01 switch, means installing the ONE speech
 * runtime every engine shares (idempotent: a second engine finds it there). Refuses outright
 * when the manifest does not declare the host OS — THE os gate.
 */
export async function installEngine(manifest, { progress = null, cancelCheck = null, onBytes = null, force = false } = {}) {
  if (!manifest.supportsCurrentOs()) {
    throw new InstallError(
      `${manifest.id} does not support ${self._currentOsLabel()} — the manifest declares ${manifest.supportedOses.join(", ")}.`,
    );
  }
  await self._installAudiocppRuntime({ progress, cancelCheck, onBytes, force });
}

/**
 * Install the ONE speech runtime every audio.cpp engine shares: the pinned server build for
 * this machine (the kit's verified acquisition), then eSpeak NG for Kokoro. Over an older
 * pinned build it is the update: the old build runs until this finishes, then stops.
 */
export async function _installAudiocppRuntime({ progress = null, cancelCheck = null, onBytes = null, force = false } = {}) {
  const emit = progress || (() => {});
  if (force) {
    // A repair replaces the build the processes are running — stop them first (Windows won't
    // replace an exe in use); the next load starts the fresh one.
    await self.stopSpeechRuntime();
  }
  if (devBuild.current() !== null) {
    // `npm run dev` runs our checkout's own build — nothing to download but eSpeak NG.
    emit("installing", "eSpeak NG (Kokoro's pronunciation)");
    try {
      await espeak.install(self.enginesRuntimeRoot(), force);
    } catch (e) {
      throw new InstallError(`eSpeak NG install failed: ${msgOf(e)}`);
    }
    runtime.forgetInstalled();
    emit("done", "speech runtime ready (development build)");
    return;
  }
  let lastMb = -1;
  const prog = (done, total) => {
    if (onBytes) onBytes(done, total); // the job's bytes — the runtime row's bar (decided 2026-10-03)
    const mb = floorDiv(done, 1024 * 1024);
    if (floorDiv(mb, 16) !== lastMb) {
      lastMb = floorDiv(mb, 16);
      emit("downloading", `speech runtime: ${mb} MB${total ? ` of ${floorDiv(total, 1024 * 1024)} MB` : ""}`);
    }
  };
  emit("downloading", "speech runtime (audio.cpp)");
  // An older pinned build still runs until this finishes (the runtime row's "Update to …").
  const was = runtime.installedTag();
  const replaced = was != null && was !== release.cfg.TAG ? runtime.installedExe() : null;
  try {
    await runtime.install({ onProgress: prog, cancelCheck, force });
  } catch (e) {
    // every failure is the install's answer
    if (msgOf(e).toLowerCase().includes("cancel") || e?.name === "DownloadCancelled") throw new InstallError("cancelled by user");
    throw new InstallError(`speech runtime install failed: ${msgOf(e)}`);
  }
  runtime.forgetInstalled();
  try {
    emit("installing", "eSpeak NG (Kokoro's pronunciation)");
    try {
      await espeak.install(self.enginesRuntimeRoot(), force);
    } catch (e) {
      throw new InstallError(`eSpeak NG install failed: ${msgOf(e)}`);
    }
  } finally {
    if (was != null && was !== release.cfg.TAG) {
      // An update: the processes still run the older build. Free the speech slots (their
      // bookings go with them) and stop them all, so the next load starts the pinned build.
      // In `finally`: the new build is in place even when eSpeak NG then fails, and the old one
      // must not run on (audit §5 E6).
      await self.stopSpeechRuntime();
      log.info(`speech runtime updated ${was} → ${release.cfg.TAG}; its processes stopped`);
      if (replaced !== null) await self._removeReplacedBuild(path.dirname(String(replaced)), was);
    }
  }
  emit("done", "speech runtime ready");
}

/** Free every speech slot the runtime holds (their bookings go with them) and stop all of its
 * processes, so the next load starts them again — after an update, or once the Japanese
 * dictionary is installed (the processes read its folder when they start). */
export async function stopSpeechRuntime() {
  const mgr = self.getManager();
  for (const kind of ["tts", "stt"]) {
    const s = mgr.loadedFor(kind);
    if (s !== null && s?.manifest?.usesAudiocpp) await mgr.unload(kind);
  }
  await runtime.shutdownServer();
}

/** The optional Japanese dictionary (gap 7), then a runtime restart if it was running, so the
 * processes start again with its folder. Returns its folder. */
export async function installJapaneseDictionary({ onBytes = null, cancelCheck = null } = {}) {
  const root = await japanese.install(self.enginesRuntimeRoot(), { onProgress: onBytes, cancelCheck });
  if (runtime.servers().some((srv) => srv.isRunning())) await self.stopSpeechRuntime();
  return root;
}

const realpath = (p) => {
  try {
    return realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
};

/** After an update the older build is never run again, so its folder goes — 2 GB for a CUDA
 * build (decided 2026-10-03). Only the build the update replaced: another backend's build of
 * that release keeps working until it is updated. The release's folder goes once empty. */
export async function _removeReplacedBuild(buildDir, tag) {
  const root = realpath(String(runtime._runtimeRoot()));
  buildDir = realpath(String(buildDir));
  const rel = path.relative(root, buildDir);
  const under = rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  if (path.basename(path.dirname(buildDir)) !== tag || !under) {
    log.warning(`not removing ${buildDir}: not an older speech runtime build under ${root}`);
    return;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      if (!existsSync(buildDir)) break;
      rmSync(buildDir, { recursive: true });
      break;
    } catch (e) {
      if (e?.code === "ENOENT") break;
      if (attempt === 4) {
        // the stopped process can hold its DLLs for a moment
        log.warning(`could not remove the older speech runtime ${buildDir}: ${msgOf(e)}`);
        return;
      }
      await self._sleep(1);
    }
  }
  log.info(`removed the older speech runtime build ${buildDir}`);
  try {
    if (readdirSync(path.dirname(buildDir)).length === 0) rmdirSync(path.dirname(buildDir));
  } catch {
    /* in use / gone */
  }
}

/** shutil.rmtree(p, ignore_errors=True): delete what can be deleted, keep going past the
 * rest (a file another process holds open). */
export function _rmtree(p) {
  let entries = [];
  try {
    entries = readdirSync(p, { withFileTypes: true });
  } catch {
    try {
      unlinkSync(p);
    } catch {
      /* ignored */
    }
    return;
  }
  for (const e of entries) {
    const full = path.join(p, e.name);
    if (e.isDirectory() && !e.isSymbolicLink()) self._rmtree(full);
    else {
      try {
        unlinkSync(full);
      } catch {
        /* ignored */
      }
    }
  }
  try {
    rmdirSync(p);
  } catch {
    /* ignored */
  }
}

// ─── Manager ──────────────────────────────────────────────────────────

/** The speech runtime build a measurement belongs to: the installed release's tag, or
 * `npm run dev`'s own build ("dev · <commit>"). "" when there is none. */
export function _runtimeBuild() {
  try {
    const dev = devBuild.current();
    return dev !== null ? dev.version : runtime.installedTag() || "";
  } catch {
    return ""; // bare tests
  }
}

/** The slot a load fills: one model in the speech runtime's process for `placement` ("gpu" |
 * "cpu") and the engine's kind. The one seam tests swap for a fake. */
export function _newSlot(m, placement = "gpu") {
  return new slot.AudioCppSlot(m, placement);
}

/** A real-time factor the way the rows say it: 3.2×, 12×. */
export function _x(v) {
  return v < 10 ? `${pyFixed(v, 1)}×` : `${pyFixed(v, 0)}×`;
}

const isAuto = (v) => v == null || v === "" || v === "auto";

/**
 * Top-level manager. One process per `kind` slot loaded at a time. `_loaded`: kind ("tts" |
 * "stt") → AudioCppSlot. Loading a new engine of the same kind unloads the prior occupant of
 * THAT slot; other kinds stay loaded (speaker attribution needs LLM + TTS resident at once).
 */
export class EngineManager {
  constructor() {
    this._manifests = new Map();
    this._loaded = new Map();
    // Per-engine last loaded variant — the UI shows server truth, not local state.
    this._currentVariants = new Map();
    this._lock = new Mutex();
    // Engine ids the client asked to cancel-load (the cancel-load endpoint adds them; `load`
    // clears its own at the end, whether the cancel landed in time or not).
    this._cancelLoadRequests = new Set();
    // Per-kind activity locks — held around an engine's in-flight synth / transcribe call,
    // and by load/unload around terminating a slot's occupant: a load can never kill a model
    // mid-line.
    this._activityLocks = new Map();
    // engine_id → the device its last confirmed load resolved to (always visible).
    this._resolvedDevices = new Map();
    // Why each loaded engine runs where it does (CPU placement, 2026-10-02).
    this._placementReasons = new Map();
    // The kit's hardware snapshot (null until first use; detection shells out to nvidia-smi).
    this._hwCache = null;
    this._hwDetected = false;
    // The measured true-up's probe TTL cache: "pid:<n>" → [monotonic s, value].
    this._probeCache = new Map();
    this.refreshManifests();
  }

  // ─── Per-kind slot helpers ────────────────────────────────────

  /** Back-compat alias: the TTS slot, or null. */
  get _current() {
    return this._loaded.get("tts") ?? null;
  }

  set _current(proc) {
    if (proc == null) this._loaded.delete("tts");
    else this._loaded.set("tts", proc);
  }

  /** The kind's loaded slot, or null. A slot whose model died with its process (a crash, a
   * restart) is dropped here WITH its booking (audit §5 C1). */
  loadedFor(kind) {
    const proc = this._loaded.get(kind) ?? null;
    if (proc === null || proc.isAlive()) return proc;
    if (typeof proc.isDead === "function" && proc.isDead()) this._dropDeadSlot(kind, proc);
    return null;
  }

  /** Forget a slot whose model is gone, and free its booking. */
  _dropDeadSlot(kind, proc) {
    const engineId = proc.manifest.id;
    log.warning(`the ${kind} model ${engineId} is no longer loaded — its runtime process stopped`);
    this._loaded.delete(kind);
    this._currentVariants.delete(engineId);
    this._resolvedDevices.delete(engineId);
    this._placementReasons.delete(engineId);
    this._releaseEngine(kind, engineId);
  }

  currentFor(kind) {
    const proc = this.loadedFor(kind);
    return proc ? proc.manifest.id : null;
  }

  /** The kind's activity lock (a Mutex), created on first use. */
  _activity(kind) {
    let lock = this._activityLocks.get(kind);
    if (lock === undefined) {
      lock = new Mutex();
      this._activityLocks.set(kind, lock);
    }
    return lock;
  }

  // ─── VRAM arbitration ───────────────────────────────────────────
  // The manager joins the kit's process-wide VramArbiter: device resolves HERE (the one load
  // door), a booking load admits via the shared `makeRoom`, a confirmed load reserves, and
  // every unload path releases. All kit calls are best-effort.

  /** The kit's hardware snapshot, detected once (it shells out to nvidia-smi). null when
   * detection is unavailable — resolution then falls to CPU and admission books nothing. */
  async _hardware() {
    if (!this._hwDetected) {
      this._hwDetected = true;
      try {
        this._hwCache = await hardware.ensureDetected();
      } catch {
        this._hwCache = null;
      }
    }
    return this._hwCache;
  }

  /** Where a model runs: where the ONE speech runtime runs — the backend of its installed
   * build. A per-call `requested` device has nothing to move and is ignored. */
  _resolveDevice(m, requested) {
    const exe = runtime.installedExe();
    return exe !== null ? runtime.backendOf(exe) : "cpu";
  }

  // ── Placement: the graphics card or the CPU, per model (2026-10-02) ───────────
  // The user's choice per model (Auto / GPU / CPU) and, for Auto, the decided order:
  //   1. the GPU when nothing else is on the card, or when the model's MEASURED
  //      graphics-memory size fits beside the AI model;
  //   2. else the CPU, when it speaks at least `cpu_min_realtime` (2×) real time there;
  //   3. else the GPU with the AI model unloaded first — the kit's eviction event, so the
  //      app's existing toast says so.
  // A model never measured on the card counts as not fitting while an AI model is on it.

  /** The user's choice for this model: "auto" | "gpu" | "cpu". */
  static _userPlacement(engineId, variant) {
    try {
      const ov = appState.getState().settings.get().engines.engine_overrides[engineId];
      return (ov ? ov.placements[variant || ""] : null) || "auto";
    } catch {
      return "auto"; // no state (bare tests / mid-boot)
    }
  }

  static _variantRow(m, variant) {
    const rows = m?.module?.VARIANTS || [];
    return rows.find((r) => r.id === variant) ?? null;
  }

  /** [seconds of audio per second of work on the CPU, measured on THIS machine?]. The best of
   * the newest 5 speeds this machine recorded for the model at the CPU-threads setting in force
   * now, else the manifest's reference figure, else [null, false] — never offered to the CPU
   * by Auto (audit §5 B7). */
  cpuSpeed(kind, engineId, variant) {
    try {
      const mk = hardware.currentMachineKey();
      const threads = String(runtime.cpuThreads());
      const seen = [];
      for (const row of stores.getModelMeasurementStore().list(`${kind}:${engineId}:${variant || ""}`)) {
        const flags = Object.fromEntries((row.switches || []).map((f) => [f.flagName, f.flagValue]));
        if (
          row.machineKey === mk &&
          row.source === "speed" &&
          (row.backend || "") === "cpu" &&
          Number(row.realtimeX || 0) > 0 &&
          flags.threads === threads
        ) {
          seen.push(Number(row.realtimeX));
          if (seen.length === 5) break;
        }
      }
      if (seen.length) return [Math.max(...seen), true];
    } catch {
      /* bare tests / store not wired */
    }
    const ref = (EngineManager._variantRow(this.getManifest(engineId), variant) || {}).cpu_realtime;
    return ref ? [Number(ref), false] : [null, false];
  }

  // ── The price: what a model takes, measured, at the length it is given (audit §13.3) ──

  /** The longest piece a line reaches this model in: the user's size for it, else the
   * catalog's (`split_chars` on the variant row), else null. */
  splitCharsFor(engineId, variant) {
    try {
      const ov = appState.getState().settings.get().engines.engine_overrides[engineId];
      const mine = pyInt((ov ? ov.split_chars[variant || ""] : 0) || 0);
      if (mine > 0) return mine;
    } catch {
      /* no state → the catalog's */
    }
    const row = EngineManager._variantRow(this.getManifest(engineId), variant) || {};
    return row.split_chars ? pyInt(row.split_chars) : null;
  }

  /** The piece length this model actually gets — its split size under the global cap — and
   * the one its price is measured at. */
  effectiveSplit(engineId, variant) {
    let cap = DEFAULT_MAX_CHUNK_CHARS;
    try {
      cap = pyInt(appState.getState().settings.get().generation.max_chunk_chars || cap);
    } catch {
      /* default cap */
    }
    const split = this.splitCharsFor(engineId, variant);
    return split ? Math.min(cap, split) : cap;
  }

  /** What loading exactly this model on `device` takes, measured on this machine at the piece
   * length it is given now: the largest `"peak"` reading of this variant, by the runtime
   * build running now. 0 = never measured there. Placement and the memory check both ask this
   * one function (audit §5 B1). */
  _priceMb(kind, engineId, variant, device) {
    if (!device) return 0;
    try {
      const mk = hardware.currentMachineKey();
      const want = { split_chars: String(this.effectiveSplit(engineId, variant)), runtime: self._runtimeBuild() };
      let best = 0;
      for (const row of stores.getModelMeasurementStore().list(EngineManager._measureId(kind, engineId, variant))) {
        const flags = Object.fromEntries((row.switches || []).map((f) => [f.flagName, f.flagValue]));
        if (
          row.machineKey === mk &&
          row.source === "peak" &&
          (row.backend || "") === device &&
          row.vramModelMb > 0 &&
          Object.entries(want).every(([k, v]) => flags[k] === v)
        ) {
          best = Math.max(best, pyInt(row.vramModelMb));
        }
      }
      return best;
    } catch {
      return 0; // bare tests / store not wired
    }
  }

  /** A discrete graphics card (its own memory) — or unknown, which reads as one. */
  async _cardIsItsOwnMemory() {
    const hw = await this._hardware();
    try {
      return hw === null || hardware.memArch(hw) === "discrete";
    } catch {
      return true;
    }
  }

  /** Is an AI model holding the graphics card now? A sleeping one holds nothing; the tiny
   * pinned embedder is not the AI model. */
  async _aiModelOnCard() {
    const hw = await this._hardware();
    let snap;
    try {
      if (hw === null || hardware.memArch(hw) !== "discrete") return false;
      snap = await arbiter.getArbiter().snapshot(hw);
    } catch {
      return false;
    }
    return (snap.reservations || []).some((r) => r.kind === "llm" && !r.asleep && !r.pinned && pyInt(r.vram_mb || 0) > 0);
  }

  /** Graphics memory a load of `engineId` could use now, after the safety margin: the measured
   * truth and the ledger, whichever says less, plus what this kind's current occupant gives
   * back when it is replaced. null = unknown. */
  async _freeCardMb(kind, engineId) {
    const hw = await this._hardware();
    try {
      const arb = arbiter.getArbiter();
      const total = hw !== null ? pyInt(hardware.budgetTotalMb(hw)) : 0;
      if (total <= 0) return null;
      const committed = Math.max(0, total - (await arb.remainingMb(hw)));
      const used = await this.poolUsedMb({ fresh: true });
      let free = total - Math.max(committed, used ?? 0);
      const occ = this._loaded.get(kind) ?? null;
      if (occ !== null && occ.manifest.id !== engineId) free += pyInt(arb.reservedMb(`${kind}:${occ.manifest.id}`) || 0);
      return free - EngineManager._safetyMarginMb();
    } catch {
      return null;
    }
  }

  /** Where a load of this model goes now: [`"gpu"` | `"cpu"`, why — a clause the row says
   * after "Runs on the CPU ·", unload the AI model first?]. */
  async placementFor(m, kind, variant) {
    await runtime.ensureHardware();
    const exe = runtime.installedExe();
    if (exe !== null && runtime.backendOf(exe) === "cpu") return ["cpu", "this machine's speech runtime is the CPU build", false];
    const choice = EngineManager._userPlacement(m.id, variant);
    const [x, here] = this.cpuSpeed(kind, m.id, variant);
    const speed = x ? `${_x(x)} real time ${here ? "here" : "on the reference machine"}` : "";
    if (choice === "gpu") return ["gpu", "your choice", false];
    if (choice === "cpu") return ["cpu", `your choice${speed ? ` — ${speed}` : ""}`, false];
    if (!(await this._cardIsItsOwnMemory())) {
      // A Mac or integrated graphics: the GPU uses the same memory as the CPU, so running on
      // the CPU would free none of it (audit §5 B9).
      return ["gpu", "the graphics share this machine's memory, so the CPU would free none of it", false];
    }
    if (!(await this._aiModelOnCard())) return ["gpu", "nothing else is on the graphics card", false];
    const prior = this._priceMb(kind, m.id, variant, exe !== null ? runtime.backendOf(exe) : null);
    const free = prior ? await this._freeCardMb(kind, m.id) : null;
    if (prior && free !== null && prior <= free) return ["gpu", `it fits beside the AI model (${prior} MB)`, false];
    if (x !== null && x >= runtime.cpuMinRealtime()) return ["cpu", `${speed}, which keeps the graphics card for the AI model`, false];
    const slow = x ? `only ${speed} on the CPU` : "it has no usable speed on the CPU";
    return ["gpu", `${slow}, so the AI model makes room`, !prior];
  }

  /** Auto's third step for a model never measured on the card: unload the AI model before the
   * load, through the kit's `makeRoom` (so the eviction event — and the app's toast — say who
   * made room for whom). Speech kinds are protected; a busy AI model by the arbiter itself. */
  async _unloadAiModel(engineId) {
    const hw = await this._hardware();
    try {
      const total = hw !== null ? pyInt(hardware.budgetTotalMb(hw)) : 0;
      if (total <= 0) return;
      const arb = arbiter.getArbiter();
      const llmMb = async () =>
        ((await arb.snapshot(hw)).reservations || [])
          .filter((r) => r.kind === "llm" && !r.asleep)
          .reduce((s, r) => s + pyInt(r.vram_mb || 0), 0);
      const beforeLlm = await llmMb();
      const beforeUsed = await this.poolUsedMb({ fresh: true });
      await arb.makeRoom(total, { protectedKinds: ["tts", "stt"], hardware: hw, reason: `loading ${engineId}` });
      const freed = beforeLlm - (await llmMb());
      // An unloaded model's memory drains over a second or two. Wait for the card to show it
      // before the load reads the card (audit §5 B2).
      if (freed > 0 && beforeUsed !== null) {
        const deadline = monotonic() + 6.0;
        while (monotonic() < deadline) {
          const used = await this.poolUsedMb({ fresh: true });
          if (used === null || used <= beforeUsed - freed * 0.8) break;
          await self._sleep(0.4);
        }
      }
    } catch (e) {
      log.debug(`AI-model unload before ${engineId} unavailable: ${msgOf(e)}`);
    }
  }

  placementReasonFor(engineId) {
    return this._placementReasons.get(engineId) ?? "";
  }

  /** The first line (or clip) a CPU-placed model handles after each load records its
   * real-time factor in the kit's measurement store — from then on Auto reads THIS machine's
   * number. Best-effort; never fails the work. */
  _recordCpuSpeed(kind, proc, audioS, wallS) {
    if ((proc.placement ?? "gpu") !== "cpu" || (proc.speedRecorded ?? true)) return;
    if (!audioS || audioS < 2.0 || wallS <= 0) return;
    proc.speedRecorded = true;
    const engineId = proc.manifest.id;
    const variant = this._currentVariants.get(engineId) || "";
    try {
      const threads = String(runtime.cpuThreads());
      stores.getModelMeasurementStore().record(`${kind}:${engineId}:${variant}`, {
        machineKey: hardware.currentMachineKey(),
        source: "speed",
        label: `CPU real-time factor (${threads} threads)`,
        tokensPerSec: 0.0,
        vramTotalMb: 0,
        at: Math.trunc(Date.now()),
        rows: [{ flagName: "threads", flagValue: threads }],
        kind: kind === "stt" ? "stt" : "tts",
        realtimeX: pyRound(audioS / wallS, 2),
        backend: "cpu",
      });
    } catch (e) {
      log.debug(`CPU speed record failed for ${engineId}: ${msgOf(e)}`);
    }
  }

  /** THE ONE-POOL RULING (2026-08-13): on one-pool boxes (integrated/unified) EVERY managed
   * load books its measured footprint into the pool ledger; on discrete boxes only a
   * device-resolved load holds VRAM (cpu is free). Any non-cpu resolve books on discrete. */
  async _booksMemory(resolvedDevice) {
    const hw = await this._hardware();
    if (hw === null) return false;
    try {
      if (hardware.memArch(hw) !== "discrete") return true;
    } catch {
      return false;
    }
    return resolvedDevice !== "cpu";
  }

  /** The runner config's margin knob (the SAME knob the LLM admission subtracts); the kit's
   * seed default when the shared service isn't wired. */
  static _safetyMarginMb() {
    try {
      return pyInt(lifecycle.getService().config().safetyMarginMb);
    } catch {
      try {
        return pyInt(kitConfig.DEFAULT_SAFETY_MARGIN_MB);
      } catch {
        return 1024;
      }
    }
  }

  // ── The measured currency ──────────────────────────────────────────────
  // No number here is declared or estimated: a model's price is what it was MEASURED to take
  // on this machine. A reading is per process (the slot's runtime process), not a device
  // delta; the delta survives only as the fallback on boxes with no per-process reading (AMD
  // Linux), labeled "computed" and never stored.

  /** Measured used memory of the budget pool — THE kit's cached door (one cache for the whole
   * family). `fresh` bypasses the cache for the load door. */
  async poolUsedMb({ fresh = false } = {}) {
    try {
      return await hardware.usedPoolMb({ fresh });
    } catch {
      return null; // no kit → honestly unmeasurable
    }
  }

  /** Measured memory held by the slot's process tree: dedicated device memory on discrete
   * boxes (per-PID), resident set on one-pool boxes. null = unmeasurable. */
  async _engineProcMb(proc, { fresh = true } = {}) {
    const pid = proc?.proc?.pid;
    if (!pid) return null;
    const now = monotonic();
    const key = `pid:${pid}`;
    if (!fresh) {
      const hit = this._probeCache.get(key);
      if (hit !== undefined && now - hit[0] < PROBE_TTL_S) return hit[1];
    }
    const hw = await this._hardware();
    let val;
    try {
      val = hw !== null && hardware.memArch(hw) !== "discrete" ? await hardware.processTreeRssMb(pid) : await hardware.processTreeDeviceMemMb(pid);
    } catch {
      return null;
    }
    this._probeCache.set(key, [now, val]);
    return val;
  }

  /**
   * Budget admission for a booking load whose PRIOR MEASURED footprint is known (a first-ever
   * load skips admission entirely). Prices on MEASURED free memory AND the ledger — the WORSE
   * of the two (2026-08-15); when free is short, `makeRoom`'s target is inflated by the
   * UNLEDGERED usage, so evicting to ledger-room yields real room. Runs with NO manager locks
   * held; busy kinds are protected inside `makeRoom`; a refusal is HONEST and leaves the world
   * exactly as it was. `creditMb`: what the kind's current occupant gives back when this load
   * replaces it (audit §13.3, §5 B5).
   */
  async _admitMemory(m, kind, engineId, neededMb, creditMb = 0) {
    const needed = pyInt(neededMb);
    if (needed <= 0) return;
    let arb;
    try {
      arb = arbiter.getArbiter();
    } catch {
      return; // nothing to admit against
    }
    // Reconcile the LLM sleepers first (the 2026-08-15 sleeping-child fix): the runner's ledger
    // keeps a booking for a child the router idle-unloaded. Best-effort.
    try {
      await lifecycle.getService().reconcileSleeping({ force: true });
    } catch (e) {
      log.debug(`sleeping-set reconcile unavailable at the speech door: ${msgOf(e)}`);
    }
    const hw = await this._hardware();
    const margin = EngineManager._safetyMarginMb();
    const want = Math.max(0, needed + margin - Math.max(0, pyInt(creditMb)));
    const used = await this.poolUsedMb({ fresh: true });
    let total = 0;
    if (hw !== null) {
      try {
        total = pyInt(hardware.budgetTotalMb(hw));
      } catch {
        total = 0;
      }
    }
    let free;
    let target;
    if (used !== null && total > 0) {
      const committed = Math.max(0, total - (await arb.remainingMb(hw)));
      // The pool is occupied by the WORSE of the two truths (2026-08-15): the measurement
      // can't see a booking whose allocation has not landed; the ledger can't see other
      // programs.
      free = Math.max(0, total - Math.max(used, committed));
      if (want <= free) return;
      const foreign = Math.max(0, used - committed);
      target = want + foreign;
    } else {
      free = null;
      if (want <= (await arb.remainingMb(hw))) return;
      target = want;
    }
    if (await arb.makeRoom(target, { exclude: `${kind}:${engineId}`, hardware: hw, reason: `loading ${engineId}` })) {
      // Eviction frees device memory ASYNCHRONOUSLY. Wait briefly for the measured number to
      // agree; if it stays short, proceed — the ledger says room.
      if (free !== null) {
        const deadline = monotonic() + 4.0;
        while (monotonic() < deadline) {
          const u = await this.poolUsedMb({ fresh: true });
          const c = Math.max(0, total - (await arb.remainingMb(hw)));
          if (u === null || Math.max(0, total - Math.max(u, c)) >= want) break;
          await self._sleep(0.4);
        }
      }
      return;
    }
    const snap = await arb.snapshot(hw);
    const have =
      free !== null
        ? `${free} MB free of ${total} MB (measured, minus what is booked)`
        : `${snap.remaining_mb} MB of ${snap.vram_total_mb} MB unbooked`;
    const resident = snap.reservations.map((r) => `${r.key} (${r.vram_mb} MB${r.asleep ? " · asleep" : ""})`).join(", ") || "nothing";
    const busy = snap.busy_kinds.join(", ") || "none";
    throw new RuntimeError(
      `not enough memory to load ${engineId}: it needs ~${needed} MB ` +
        `(+${margin} MB safety margin) but only ${have} remain. ` +
        `Resident: ${resident}; busy: ${busy}. ` +
        "Wait for the current work to finish or unload something first.",
    );
  }

  /** Book the confirmed load at `mb` with its honest provenance ("measured" | "computed"). Key
   * = "kind:engine_id"; `evictFn` is our evictor. */
  _reserveEngine(m, kind, mb, source) {
    let arb;
    try {
      arb = arbiter.getArbiter();
    } catch {
      return;
    }
    const arbKind = kind === "stt" ? "stt" : "tts";
    arb.reserve(`${kind}:${m.id}`, pyInt(mb), { kind: arbKind, evictFn: () => this._evictForArbiter(kind, m.id), source });
  }

  /** Persist a measured peak as a `"peak"` row in the shared measurement store — what
   * `_priceMb` reads on the next load. Keeps the newest 5 per length and runtime build.
   * Best-effort: persistence must never fail a load. */
  _recordSpeechLoad(m, kind, variant, mb, device) {
    try {
      const store = stores.getModelMeasurementStore();
      const modelId = EngineManager._measureId(kind, m.id, variant);
      const mk = hardware.currentMachineKey();
      const split = String(this.effectiveSplit(m.id, variant));
      const build = self._runtimeBuild();
      store.record(modelId, {
        machineKey: mk,
        source: "peak",
        label: `speech peak (${device}, pieces of ${split} characters, ${build})`,
        tokensPerSec: 0.0,
        vramTotalMb: 0,
        at: Math.trunc(Date.now()),
        rows: [
          { flagName: "split_chars", flagValue: split },
          { flagName: "runtime", flagValue: build },
        ],
        vramModelMb: pyInt(mb),
        kind: kind === "stt" ? "stt" : "tts",
        backend: device,
      });
      store.pruneLoadRows(modelId, mk, new Set(["split_chars", "runtime"]), 5, "peak");
    } catch (e) {
      log.debug(`speech peak persist failed for ${m.id}: ${msgOf(e)}`);
    }
  }

  static _measureId(kind, engineId, variant) {
    return `${kind}:${engineId}:${variant || ""}`.replace(/:+$/, "");
  }

  /** Fire-and-forget high-water bump for the synthesis/transcription hot path — the probe can
   * shell out for ~1 s and must never add latency to a line. */
  bumpEngineReservationAsync(kind) {
    background(`${kind}-highwater`, () => this.bumpEngineReservation(kind), log);
  }

  /** The raise-only HIGH-WATER re-probe: a TTS model allocates at generate(), not load — a
   * post-load number misses render peak. Never lowers a booking; best-effort. */
  async bumpEngineReservation(kind, { fresh = false } = {}) {
    const proc = this._loaded.get(kind) ?? null;
    if (proc === null) return;
    const engineId = proc.manifest.id;
    // The kind's own process (audit §13.2): its whole measurement is this model's.
    const mb = await this._engineProcMb(proc, { fresh });
    if (!mb) return;
    try {
      const arb = arbiter.getArbiter();
      const cur = arb.reservedMb(`${kind}:${engineId}`);
      if (cur === null || mb > cur) {
        // Occupant re-check: the probe ran unlocked — the slot may have swapped meanwhile.
        const occ = this._loaded.get(kind) ?? null;
        const variant = this._currentVariants.get(engineId) ?? null;
        const device = this._resolvedDevices.get(engineId) ?? "";
        if (occ === null || occ.manifest.id !== engineId) return;
        // cur null = "not measured yet": the first measured probe CREATES the booking — only
        // when the resolved device books at all.
        if (cur === null && !(await this._booksMemory(device))) return;
        const m = this.getManifest(engineId);
        if (m !== null) {
          this._reserveEngine(m, kind, mb, "measured");
          this._recordSpeechLoad(m, kind, variant, mb, device);
        }
      }
    } catch {
      /* best-effort */
    }
  }

  /** What `key` holds booked now (0 = nothing, or no kit). */
  static _bookingMb(key) {
    try {
      return pyInt(arbiter.getArbiter().reservedMb(key) || 0);
    } catch {
      return 0;
    }
  }

  /** Drop the booking (idempotent). */
  _releaseEngine(kind, engineId) {
    let arb;
    try {
      arb = arbiter.getArbiter();
    } catch {
      return;
    }
    arb.release(`${kind}:${engineId}`);
  }

  /** The evictor `makeRoom` executes for one of OUR reservations. Terminates the slot ONLY if
   * this engine still occupies it; the reservation itself is released by `makeRoom`. */
  async _evictForArbiter(kind, engineId) {
    await this._activity(kind).run(() =>
      this._lock.run(async () => {
        const proc = this._loaded.get(kind) ?? null;
        if (proc !== null && proc.manifest.id === engineId) {
          try {
            await proc.terminate();
          } catch {
            /* already dying is fine */
          }
          this._loaded.delete(kind);
          this._currentVariants.delete(engineId);
          this._resolvedDevices.delete(engineId);
          this._placementReasons.delete(engineId);
        }
      }),
    );
  }

  /** The device the last confirmed load of this engine resolved to; null = not loaded. */
  resolvedDeviceFor(engineId) {
    return this._resolvedDevices.get(engineId) ?? null;
  }

  currentVariantId(engineId) {
    return this._currentVariants.get(engineId) ?? null;
  }

  /** What a no-variant load of this engine resolves to (user Set-as-default → manifest →
   * heuristics). */
  resolvedDefaultVariant(engineId) {
    const m = this.getManifest(engineId);
    return m ? this._resolvedDefaultVariant(m) : "";
  }

  /** The operator's own default-model choice for this engine (Set as default). "" without
   * app state. */
  static _userDefaultVariant(engineId) {
    try {
      const ov = appState.getState().settings.get().engines.engine_overrides[engineId];
      return ov ? ov.default_variant || "" : "";
    } catch {
      return "";
    }
  }

  /** The variant id a no-variant load resolves to: the USER's default → manifest
   * DEFAULT_VARIANT_ID → sole catalog variant → the first variant already in the speech cache
   * → the first catalog variant. */
  _resolvedDefaultVariant(m) {
    const user = EngineManager._userDefaultVariant(m.id);
    if (user) return user;
    if (m.defaultVariantId) return m.defaultVariantId;
    let variants;
    try {
      variants = modelCatalog.modelsFor(m.id);
    } catch {
      return "";
    }
    if (!variants.length) return "";
    if (variants.length > 1) {
      try {
        const dataDir = appState.getState().dataDir;
        for (const v of variants) if (speechCache.variantOnDisk(dataDir, m.id, v.id)) return v.id;
      } catch {
        /* bare tests / no app state */
      }
    }
    return variants[0].id;
  }

  /** The load door's acquisition step: make sure the variant's file(s) are in the speech
   * cache before the runtime is told about them, and return that folder — or null when there
   * is nothing to fetch (no variant, no app state, no catalog row). */
  async _ensureVariantLocal(m, variantId, progress, cancelCheck) {
    if (!variantId) return null;
    let dataDir;
    try {
      dataDir = appState.getState().dataDir;
    } catch {
      return null; // bare tests / no app state
    }
    if (speechCache.variantOnDisk(dataDir, m.id, variantId)) return String(speechCache.variantDir(dataDir, m.id, variantId));
    let src;
    try {
      const { resolveSource } = await import("../api/engine_sources_api.js");
      [src] = resolveSource(m.id, variantId);
    } catch {
      return null; // no catalog row → nothing to fetch
    }
    const repo = src?.hf_repo;
    if (!repo) return null;
    if (progress) progress("downloading-model", `fetching ${variantId} into the speech cache`);
    let lastPct = -1;
    const prog = (done, total) => {
      if (progress && total) {
        const pct = Math.trunc((done * 100) / total);
        if (pct !== lastPct) {
          lastPct = pct;
          progress("downloading-model", `${variantId}: ${pct}% of ${floorDiv(total, 1024 * 1024)} MB`);
        }
      }
    };
    const sources = src.sources || [{ hf_repo: repo, revision: src.revision ?? null, files: src.files ?? null }];
    try {
      await speechCache.fetchHfVariant(dataDir, m.id, variantId, sources, {
        onProgress: prog,
        cancelCheck: cancelCheck ? () => Boolean(cancelCheck()) : null,
      });
    } catch (e) {
      if (msgOf(e).toLowerCase().includes("cancel") || e instanceof download.DownloadCancelled) throw new RuntimeError("cancelled by user");
      throw new RuntimeError(`model download failed for ${m.id}/${variantId}: ${msgOf(e)}`);
    }
    return String(speechCache.variantDir(dataDir, m.id, variantId));
  }

  /** Mark an in-flight load for cancellation. True if this engine was found in a slot (it is
   * terminated and its booking freed, audit §5 C3); false otherwise (a no-op cancel). The load
   * loop polls its cancel check at safe points. */
  async requestCancelLoad(engineId) {
    return this._lock.run(async () => {
      this._cancelLoadRequests.add(engineId);
      for (const [kind, proc] of [...this._loaded]) {
        if (proc.manifest.id === engineId) {
          try {
            await proc.terminate();
          } catch {
            /* ignored */
          }
          this._loaded.delete(kind);
          this._currentVariants.delete(engineId);
          this._resolvedDevices.delete(engineId);
          this._placementReasons.delete(engineId);
          this._releaseEngine(kind, engineId);
          return true;
        }
      }
      return false;
    });
  }

  refreshManifests() {
    this._manifests = self.discoverEngines();
  }

  /** id → EngineManifest (a copy of the Map). */
  manifests() {
    return new Map(this._manifests);
  }

  getManifest(engineId) {
    return this._manifests.get(engineId) ?? null;
  }

  /** One of: not_installed | installed | loaded. */
  status(engineId) {
    const m = this._manifests.get(engineId);
    if (!m) return "not_installed";
    for (const proc of this._loaded.values()) {
      if (proc.manifest.id === engineId && proc.isAlive()) return "loaded";
    }
    return m.isInstalled ? "installed" : "not_installed";
  }

  /** Back-compat: the TTS slot's engine id. */
  currentId() {
    return this.currentFor("tts");
  }

  // ─── Install / Uninstall ──────────────────────────────────────────

  async install(engineId, { progress = null, cancelCheck = null, onBytes = null, force = false } = {}) {
    const m = this.getManifest(engineId);
    if (m === null) throw new InstallError(`unknown engine: ${engineId}`);
    await self.installEngine(m, { progress, cancelCheck, onBytes, force });
  }

  /** Delete every downloaded model of this engine (its speech-cache folder), unloading it
   * first. The runtime is shared and stays. `{engine_id, removed}`. */
  async uninstall(engineId) {
    const m = this.getManifest(engineId);
    if (m === null) throw new InstallError(`unknown engine: ${engineId}`);
    const freed = [];
    for (const kind of ["tts", "stt"]) {
      // The activity lock first: never unload a model under a line it is speaking (§5 C7).
      await this._activity(kind).run(() =>
        this._lock.run(async () => {
          const proc = this._loaded.get(kind) ?? null;
          if (proc !== null && proc.manifest.id === engineId) {
            await proc.terminate();
            this._loaded.delete(kind);
            freed.push(kind);
          }
        }),
      );
    }
    this._currentVariants.delete(engineId);
    this._resolvedDevices.delete(engineId);
    // The booking goes with the memory, as on every other unload path.
    for (const kind of freed) this._releaseEngine(kind, engineId);
    const removed = [];
    let root;
    try {
      root = path.join(paths.speechCacheRoot(appState.getState().dataDir), engineId);
    } catch {
      root = null; // bare tests / no app state
    }
    if (root !== null && existsSync(root)) {
      self._rmtree(root);
      if (existsSync(root)) {
        // A file the runtime still holds open (Windows refuses the delete).
        throw new InstallError(
          `some ${m.name} model files are still in use and were not deleted — unload the model and try again (${root})`,
        );
      }
      removed.push("models");
    }
    return { engine_id: engineId, removed };
  }

  // ─── Load / Unload ────────────────────────────────────────────────

  /** Load an engine's model (the resolved default when `variant` is null/""/"auto") into its
   * kind's slot. Resolves the slot's /load answer. */
  async load(engineId, { device = "auto", variant = null, progress = null, cancelCheck = null } = {}) {
    const m = this.getManifest(engineId);
    if (m === null) throw new RuntimeError(`unknown engine: ${engineId}`);
    // The runtime's sync readers (installedExe, …) read the detection memo (Python detected here).
    await runtime.ensureHardware();

    // Drop any stale cancel flag and compose the caller's `cancelCheck` with ours.
    this._cancelLoadRequests.delete(engineId);
    const serverCancel = () => this._cancelLoadRequests.has(engineId);
    const effectiveCancel = cancelCheck == null ? serverCancel : () => serverCancel() || cancelCheck();
    const maybeCancel = () => {
      if (effectiveCancel()) throw new RuntimeError("cancelled by user");
    };

    let earlyMb = 0; // a prior-measured booking made BEFORE the load confirms
    try {
      maybeCancel();
      // Install is what fetches the speech runtime — Load never installs a program behind the
      // user's back (it does fetch a missing MODEL file, below).
      if (!m.isInstalled) {
        throw new RuntimeError(
          `the speech runtime is not installed yet, so ${m.name} cannot load. Install it on AI Settings → Speech engines.`,
        );
      }
      maybeCancel();

      const targetKind = m.kind;
      // Where it runs (CPU placement, 2026-10-02): decided before anything moves, for the
      // variant this load will end up with.
      const cur0 = this.loadedFor(targetKind);
      const planned = !isAuto(variant)
        ? variant
        : (cur0 !== null && cur0.manifest.id === engineId ? this._currentVariants.get(engineId) : null) ||
          this._resolvedDefaultVariant(m) ||
          null;
      let [placement, why, unloadAi] = await this.placementFor(m, targetKind, planned);
      placement = slot.effectivePlacement(placement);
      // This engine already holds the slot with the same (or unspecified) variant in the same
      // place: that path early-returns below and must never fetch or check.
      const already =
        cur0 !== null &&
        cur0.manifest.id === engineId &&
        cur0.isAlive() &&
        (cur0.placement ?? "gpu") === placement &&
        (isAuto(variant) || this._currentVariants.get(engineId) === variant);

      // Refuse before changing anything (audit §13.3, §5 B2): the device, the price and the
      // memory check come FIRST — before a file is fetched or the AI model is unloaded. A
      // known price admits and books EARLY; the check credits what the kind's current
      // occupant gives back (§5 B5). A model never measured here gets no arithmetic: it loads,
      // calibrates, is measured.
      device = placement === "cpu" ? "cpu" : this._resolveDevice(m, device);
      const books = await this._booksMemory(device);
      const price = books && !already ? this._priceMb(targetKind, engineId, planned, device) : 0;
      if (price > 0) {
        const credit = cur0 !== null ? EngineManager._bookingMb(`${targetKind}:${cur0.manifest.id}`) : 0;
        await this._admitMemory(m, targetKind, engineId, price, credit);
        this._reserveEngine(m, targetKind, price, "measured");
        earlyMb = price;
      }
      // The planned variant's files are LOCAL before the runtime is told about them.
      let localDir = null;
      if (!already) localDir = await this._ensureVariantLocal(m, planned, progress, effectiveCancel);
      if (unloadAi && !already && !price) {
        // Auto's third step, for a model never measured on the card; it waits for the AI
        // model's memory to drain before the load reads the card.
        await this._unloadAiModel(engineId);
      }
      // A load with no price on the card measures one: its warm-up is a full-length piece.
      const calibrate = books && !already && !price;
      // The device-delta fallback's BEFORE snapshot (boxes with no per-process probe arm).
      const poolBefore = books ? await this.poolUsedMb({ fresh: true }) : null;
      const gpuBefore = books ? poolBefore : await self.memoryInUseMb();

      let proc = null;
      let early;
      // Activity lock first (lock order: activity → the manager's lock): a terminate must wait
      // for the slot's in-flight line.
      await this._activity(targetKind).run(() =>
        this._lock.run(async () => {
          // Unload the SAME-KIND slot's prior occupant — other kinds stay loaded.
          const prior = this._loaded.get(targetKind) ?? null;
          const moving = prior !== null && prior.manifest.id === engineId && (prior.placement ?? "gpu") !== placement;
          // Another variant of the loaded engine is a different model: the slot serves
          // whichever row its own /load set, so it must load again (until 2026-10-02 this
          // path only relabelled the variant).
          const curVariant = this._currentVariants.get(engineId) ?? null;
          const switching =
            prior !== null && prior.manifest.id === engineId && !isAuto(variant) && curVariant !== null && curVariant !== variant;
          if (prior !== null && (prior.manifest.id !== engineId || moving || switching)) {
            log.info(
              `unloading ${targetKind} engine ${prior.manifest.id} before loading ${engineId}` +
                (moving ? ` on the ${placement.toUpperCase()}` : switching ? ` as ${variant}` : ""),
            );
            await prior.terminate();
            this._loaded.delete(targetKind);
            this._releaseEngine(targetKind, prior.manifest.id);
            this._resolvedDevices.delete(prior.manifest.id);
            this._placementReasons.delete(prior.manifest.id);
          } else if (prior !== null && prior.manifest.id === engineId && prior.isAlive()) {
            // Already loaded — just return current voices. Record the RESOLVED variant: "auto"
            // or null must map to the default id or the Engines page can't tell which row is
            // loaded.
            if (!isAuto(variant)) this._currentVariants.set(engineId, variant);
            else if (!this._currentVariants.get(engineId)) this._currentVariants.set(engineId, this._resolvedDefaultVariant(m));
            early = { value: (await prior.get("/voices")).json() };
            return;
          }
          if (progress) progress("loading", `loading ${engineId} on the ${placement === "cpu" ? "CPU" : "graphics card"}…`);
          proc = self._newSlot(m, placement);
          await proc.spawn();
          this._loaded.set(targetKind, proc);
        }),
      );
      if (early !== undefined) return early.value;

      maybeCancel();

      // A FRESH no-variant load resolves the default HERE: the slot receives `variant`
      // verbatim, so the user's Set-as-default choice is substituted before the POST.
      // Deliberately AFTER the already-loaded early return: a no-variant re-load of a loaded
      // engine keeps whatever is loaded.
      if (isAuto(variant)) variant = this._resolvedDefaultVariant(m) || null;

      // The model comes into memory here. `model_dir` (the speech-cache variant dir) makes the
      // engine load plain local files.
      if (progress) progress("loading_weights", `loading ${engineId} weights`);
      const r = await proc.post("/load", {
        device,
        variant,
        model_dir: localDir,
        // A full-length warm-up piece when this model has no price on the card yet.
        calibrate_chars: calibrate ? this.effectiveSplit(engineId, variant) : 0,
      });
      if (r.statusCode !== 200) {
        log.warning(`engine ${engineId} /load failed: ${String(r.text).slice(0, 400)}`);
        await this._activity(targetKind).run(() =>
          this._lock.run(async () => {
            await proc.terminate();
            this._loaded.delete(targetKind);
            this._resolvedDevices.delete(engineId);
          }),
        );
        // Defensive — a release is idempotent, and a reservation nobody releases is a lying
        // ledger.
        this._releaseEngine(targetKind, engineId);
        throw new RuntimeError(`engine load failed: ${r.text}`);
      }
      if (effectiveCancel()) {
        // Cancelled while the model came in — unload it before anything is booked for it;
        // `requestCancelLoad` may already have dropped the slot.
        await this._activity(targetKind).run(() =>
          this._lock.run(async () => {
            try {
              await proc.terminate();
            } catch {
              /* already gone is fine */
            }
            if (this._loaded.get(targetKind) === proc) this._loaded.delete(targetKind);
            this._resolvedDevices.delete(engineId);
          }),
        );
        this._releaseEngine(targetKind, engineId);
        throw new RuntimeError("cancelled by user");
      }
      // Record what actually LOADED: the slot answers with the variant it resolved, which
      // differs from the request when the request names a model the catalog no longer has.
      let loadedAs = null;
      try {
        loadedAs = (r.json() || {}).variant ?? null;
      } catch {
        loadedAs = null; // a fake/legacy answer without a body
      }
      this._currentVariants.set(engineId, loadedAs || (!isAuto(variant) ? variant : this._resolvedDefaultVariant(m)));
      this._resolvedDevices.set(engineId, device);
      this._placementReasons.set(engineId, why);
      // Book the CONFIRMED load at its MEASURED footprint — the per-PID tree probe of the
      // kind's own process. A known price stays the booking's floor. What is RECORDED as this
      // model's peak (§13.3): a calibrated load's measurement, or any measurement above the
      // price. Probe miss on a box with no per-process arm → the device-wide delta, honestly
      // "computed" and never persisted; an EARLY booking keeps the price instead.
      if (books) {
        const measured = await this._engineProcMb(proc, { fresh: true });
        let calibrated = false;
        try {
          calibrated = Boolean((r.json() || {}).calibrated);
        } catch {
          calibrated = false;
        }
        if (measured) {
          this._reserveEngine(m, targetKind, Math.max(measured, earlyMb), "measured");
          if (calibrated || (earlyMb && measured > earlyMb)) {
            this._recordSpeechLoad(m, targetKind, this._currentVariants.get(engineId), measured, device);
          }
        } else if (!earlyMb) {
          const after = await this.poolUsedMb({ fresh: true });
          const delta = after !== null && poolBefore !== null ? Math.max(0, after - poolBefore) : 0;
          if (delta > 0) this._reserveEngine(m, targetKind, delta, "computed");
        }
      }
      log.info(
        `engine ${engineId} loaded ${this._currentVariants.get(engineId)}: pid ${proc?.proc?.pid ?? null}, ` +
          `server pid ${process.pid}; memory in use ${mbText(gpuBefore)} -> ${mbText(await self.memoryInUseMb())} MB`,
      );
      if (progress) progress("warming_up", `${engineId} ready`);
      return r.json();
    } catch (e) {
      // Never leak the EARLY booking on a failed/cancelled load; release is idempotent.
      if (earlyMb) this._releaseEngine(m.kind, engineId);
      throw e;
    } finally {
      // Always clear the cancel flag — a stale "cancelled" would block the next load.
      this._cancelLoadRequests.delete(engineId);
    }
  }

  /** Unload the engine in the given kind's slot; null = every slot (back-compat). Resolves
   * `{previous_engine}`. */
  async unload(kind = null) {
    if (kind != null) return this._unloadKind(kind);
    const kinds = [...this._loaded.keys()];
    if (!kinds.length) return { previous_engine: null };
    let prev = null;
    for (const k of kinds) {
      const out = await this._unloadKind(k);
      if (prev === null) prev = out.previous_engine;
    }
    this._currentVariants.clear();
    return { previous_engine: prev };
  }

  async _unloadKind(kind) {
    let prev = null;
    // Activity lock first: never terminate a slot mid-synth/transcribe.
    await this._activity(kind).run(() =>
      this._lock.run(async () => {
        const proc = this._loaded.get(kind) ?? null;
        if (!proc) return;
        prev = proc.manifest.id;
        try {
          await proc.terminate();
        } catch {
          /* ignored */
        }
        this._loaded.delete(kind);
        this._currentVariants.delete(prev);
        this._resolvedDevices.delete(prev);
        this._placementReasons.delete(prev);
      }),
    );
    if (prev === null) return { previous_engine: null };
    // Free the booking with the memory (every unload path releases).
    this._releaseEngine(kind, prev);
    return { previous_engine: prev };
  }

  // ─── Synth / voices / clone ──────────────────────────────────────

  async voices(engineId) {
    const proc = this._requireCurrent(engineId);
    const r = await proc.get("/voices");
    r.raiseForStatus();
    return r.json().voices ?? [];
  }

  /** `[audioBytes, headers]` — headers `{media_type, sample_rate, channels, is_wav_container}`
   * for the host caller. */
  async synth(engineId, body) {
    const m = this.getManifest(engineId);
    const kind = m ? m.kind : "tts";
    let proc;
    let r;
    let wall;
    await this._activity(kind).run(async () => {
      proc = this._requireCurrent(engineId);
      const t0 = performance.now();
      r = await proc.post("/synth", body);
      wall = (performance.now() - t0) / 1000;
    });
    // High-water true-up: generate() is where a TTS engine's memory peaks — async +
    // TTL-absorbed, raise-only, never blocks the line.
    this.bumpEngineReservationAsync(kind);
    if (r.statusCode === 403) {
      const payload = typeof r.json === "function" ? r.json() : {};
      if ((payload || {}).code === "terms_required") {
        throw new TermsRequired(engineId, payload.detail || "accept the engine's terms first");
      }
    }
    if (r.statusCode !== 200) throw new EngineRequestError(r.statusCode, `engine synth failed: ${_engineDetail(r)}`);
    this._recordCpuSpeed(kind, proc, _wavSeconds(r.content || Buffer.alloc(0)), wall);
    // Mirror the engine's audio headers back through to the host caller.
    const h = (k) => headerGet(r.headers, k);
    const sampleRate = h("X-JustVoice-Sample-Rate");
    const channels = h("X-JustVoice-Channels");
    return [
      r.content,
      {
        media_type: h("content-type") ?? "audio/wav",
        sample_rate: sampleRate ? pyInt(sampleRate) : null,
        channels: channels ? pyInt(channels) : 1,
        is_wav_container: h("X-JustVoice-WAV-Container") === "1",
      },
    ];
  }

  /** Transcription via the loaded stt-slot engine. `body`: {wav_b64 | audio_path, language}.
   * stt-busy for the call's duration (a mid-transcription recogniser is not a victim).
   * Resolves the text. `timeout` in seconds. */
  async transcribe(body, { timeout = 600.0 } = {}) {
    let proc;
    let r;
    let wall;
    await this._activity("stt").run(() =>
      self._withKindBusy("stt", async () => {
        proc = this.loadedFor("stt");
        if (proc === null) {
          throw new RuntimeError(
            "no speech recognition model is loaded — download and load one on the AI page's Speech engines tab",
          );
        }
        const t0 = performance.now();
        r = await proc.post("/transcribe", body, timeout);
        wall = (performance.now() - t0) / 1000;
      }),
    );
    this.bumpEngineReservationAsync("stt");
    if (r.statusCode !== 200) throw new RuntimeError(`engine transcribe failed: ${r.text}`);
    if ((proc.placement ?? "gpu") === "cpu" && !(proc.speedRecorded ?? true)) {
      this._recordCpuSpeed("stt", proc, _inputSeconds(body), wall);
    }
    return r.json().text || "";
  }

  /** Word timings via the loaded stt-slot engine — the /align door. `body`: wav_b64 /
   * audio_path + text + language. Same busy/reservation contract as transcribe. */
  async align(body, { timeout = 600.0 } = {}) {
    let r;
    await this._activity("stt").run(() =>
      self._withKindBusy("stt", async () => {
        const proc = this.loadedFor("stt");
        if (proc === null) {
          throw new RuntimeError(
            "no speech recognition model is loaded — download and load one on the AI page's Speech engines tab",
          );
        }
        r = await proc.post("/align", body, timeout);
      }),
    );
    this.bumpEngineReservationAsync("stt");
    if (r.statusCode === 501) throw new RuntimeError(r.json().detail ?? "word alignment unsupported");
    if (r.statusCode !== 200) throw new RuntimeError(`engine align failed: ${r.text}`);
    return r.json().words || [];
  }

  _requireCurrent(engineId) {
    for (const proc of this._loaded.values()) {
      if (proc.manifest.id === engineId && proc.isAlive()) return proc;
    }
    throw new RuntimeError(`engine ${engineId} is not loaded — POST /v1/engines/${engineId}/load first`);
  }
}

/** A header by name, case-blind, from a plain object, a Map or a Headers. */
function headerGet(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function" && !(headers instanceof Map)) return headers.get(name) ?? null;
  const want = name.toLowerCase();
  const entries = headers instanceof Map ? headers.entries() : Object.entries(headers);
  for (const [k, v] of entries) if (String(k).toLowerCase() === want) return v;
  return null;
}

/** The length of a transcription's input audio (a path or base64 WAV), or null. */
export function _inputSeconds(body) {
  try {
    if (body.audio_path) return _wavSeconds(readFileSync(body.audio_path));
    if (body.wav_b64) return _wavSeconds(Buffer.from(String(body.wav_b64), "base64"));
  } catch {
    return null;
  }
  return null;
}

// ─── Singleton accessor ───────────────────────────────────────────────

export const cfg = { manager: null, exitHook: false };

/**
 * The process-wide engine manager, created on first use. Creating one also arms an exit hook
 * that stops the speech runtime: it is a child of this process. LIMIT: a hook runs on a normal
 * exit, not on a hard kill — there the Windows Job Object (the kit's spawn door) takes the
 * runtime with this process, `engines/leftovers.js` sweeps anything older at startup, and the
 * desktop shell closes through POST /v1/shutdown before it ever hard-kills.
 */
export function getManager() {
  if (cfg.manager === null) cfg.manager = new EngineManager();
  if (!cfg.exitHook) {
    process.once("exit", () => runtime.killAllSync());
    cfg.exitHook = true;
  }
  return cfg.manager;
}

/** Called on JustVoice server shutdown — stop the runtime, then let the slots go. The
 * runtime's processes stop FIRST: that frees every model at once and ends any line in flight
 * (audit §5 C4, C6). */
export async function shutdownManager() {
  await runtime.shutdownServer();
  const mgr = cfg.manager;
  cfg.manager = null;
  if (mgr !== null) await mgr.unload(); // the processes are gone: this releases bookings and forgets slots
}
