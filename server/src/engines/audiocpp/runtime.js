// SPDX-License-Identifier: MIT
// The audio.cpp server processes: install the pinned binary, run the servers, call them (the
// port of justvoice/engines/audiocpp/runtime.py).
//
// One process per PLACEMENT and KIND — up to four. Placement (CPU placement, 2026-10-02 —
// docs/plans/2026-10-02-cpu-placement.md §8): "gpu" runs the installed build on its own
// backend (CUDA, Vulkan, Metal), "cpu" runs the SAME build with `backend: cpu` for the models
// placed on the CPU — measured at 0 MB of graphics memory; on a machine whose runtime is the
// CPU build only "cpu" runs. Kind (2026-10-04, audit §13.2): speech ("tts") and speech
// recognition ("stt") each get their own process, so a process's measured memory is its one
// model's and a crash or restart in one never takes the other's model.
//
// WHICH model is resident is the engine manager's call. A build with `model_management` (our
// fork; `release.FEATURES`) starts with no models and `register()`s each one as it loads — so
// nothing downloaded or deleted ever restarts it. An older build's config lists its kind's
// installed models (`lazy_load` — nothing loads until asked), and installing or deleting one
// of them changes the list, which restarts that process on its next use (`ensure`). The
// servers run headless (`--no-ui`): audio.cpp's own web UI is never shown — ours is the UI.
//
// The binary's install is the kit's (`runner/binary.acquireRuntime` — the same stage →
// launch-verify → atomic swap llama.cpp gets); the pinned rows are `release.js`. Under
// `npm run dev` the server is our checkout's own build instead (`dev_build.js`). Programs
// start only through the kit's spawn door (`runner/process.spawnChild` — a kill-on-close Job
// Object on Windows).
//
// Hardware: the sync readers (`installedExe`, `selectedAsset`, …) read the kit's detection
// memo — boot (or any async door here) awaits `ensureHardware()` first.

import { readFileSync, mkdirSync, openSync, readSync, closeSync, renameSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Mutex, sleep } from "@delebash/llm-runner/platform/asyncutil";
import * as http from "@delebash/llm-runner/platform/http";
import { getLogger } from "@delebash/llm-runner/platform/log";
import * as procs from "@delebash/llm-runner/platform/procs";
import { isJsonObject, pyInt, RuntimeError, splitlines, ValueError } from "@delebash/llm-runner/platform/py";
import { pyJson } from "@delebash/llm-runner/platform/pyjson";
import * as binary from "@delebash/llm-runner/runner/binary";
import * as hardware from "@delebash/llm-runner/runner/hardware";
import * as kitProcess from "@delebash/llm-runner/runner/process";
import * as appState from "../../app_state.js";
import { construct, SpeechRuntimeSettings } from "../../models.js";
import * as speechCache from "../../speech_cache.js";
import * as manager from "../manager.js";
import * as devBuild from "./dev_build.js";
import * as espeak from "./espeak.js";
import * as japanese from "./japanese.js";
import * as release from "./release.js";
import * as self from "./runtime.js";

const log = getLogger("justvoice.engines.audiocpp.runtime");

export const FOLDER = "audiocpp";

// Module state a test assigns (Python monkeypatched `_HW` / `_LOG_ROTATE_BYTES`): `HW` is the
// hardware snapshot when set (else the kit's detection memo); `PHYSICAL_CORES` the detected
// physical core count (null until `ensureHardware()` ran).
export const cfg = { HW: null, LOG_ROTATE_BYTES: 10 * 1024 * 1024, PHYSICAL_CORES: null };

// ─── The binary ─────────────────────────────────────────────────────────────

/** Where the runtime's builds live: `manager.enginesRuntimeRoot()` (`<data>/engines-runtime`). */
export function _runtimeRoot() {
  return manager.enginesRuntimeRoot();
}

const INSTALLED = new Map(); // backend → exe | null
const INSTALLED_TAG = new Map(); // backend → tag | null

// The variables `_childEnv` sets for the runtime — part of a process's signature, so a change
// (eSpeak NG or the dictionary installed or removed) starts it again with them.
export const _RUNTIME_ENV = ["AUDIOCPP_ESPEAK_LIBRARY", "AUDIOCPP_ESPEAK_DATA", "AUDIOCPP_UNIDIC_DIR"];

/**
 * The server's environment: who started it (`engines/leftovers.js` reads it to stop a server
 * whose parent is gone); the eSpeak NG the runtime install fetched — Kokoro reads its library
 * and data ONLY from AUDIOCPP_ESPEAK_LIBRARY / AUDIOCPP_ESPEAK_DATA, and otherwise loads
 * whatever eSpeak NG the system path finds, or fails (audit 2026-10-04 §5 A1); and the
 * optional Japanese dictionary's folder when it is installed — MeCab reads UniDic from
 * AUDIOCPP_UNIDIC_DIR (gap 7). An inherited value is never passed on.
 */
export function _childEnv() {
  const env = { ...process.env, JUSTVOICE_SERVER_PID: String(process.pid) };
  for (const key of _RUNTIME_ENV) {
    for (const k of Object.keys(env)) if (k.toUpperCase() === key) delete env[k];
  }
  const root = self._runtimeRoot();
  const found = espeak.paths(root);
  if (found !== null) {
    env.AUDIOCPP_ESPEAK_LIBRARY = String(found[0]);
    env.AUDIOCPP_ESPEAK_DATA = String(found[1]);
  }
  const dictionary = japanese.dictionaryDir(root);
  if (dictionary !== null) env.AUDIOCPP_UNIDIC_DIR = String(dictionary);
  return env;
}

/** The kit's hardware snapshot (detection shells out to nvidia-smi, so it is the memo). */
export function _hardware() {
  if (cfg.HW) return cfg.HW;
  const hw = hardware.detected();
  if (hw) return hw;
  throw new RuntimeError("hardware not detected yet — await runtime.ensureHardware() (boot) before reading the runtime");
}

/** Detect once (the kit's memo) and this machine's physical core count; the hardware back. */
export async function ensureHardware() {
  if (!cfg.HW && !hardware.detected()) await hardware.ensureDetected();
  if (cfg.PHYSICAL_CORES === null) cfg.PHYSICAL_CORES = await self.detectPhysicalCores();
  return self._hardware();
}

/** Drop the cached install answer — after an install, uninstall or backend change. */
export function forgetInstalled() {
  INSTALLED.clear();
  INSTALLED_TAG.clear();
}

/** settings.engines.speech_runtime, or the defaults when there is no app state (unit tests,
 * mid-boot). */
export function _settings() {
  try {
    return appState.getState().settings.get().engines.speech_runtime;
  } catch {
    return construct(SpeechRuntimeSettings, {});
  }
}

/** The operator's backend choice; "" = auto (this machine decides). */
export function configuredBackend() {
  const b = String(self._settings().backend || "").trim().toLowerCase();
  return b === "" || b === "auto" ? "" : b;
}

export function configuredGpu() {
  return Math.max(0, pyInt(self._settings().gpu || 0));
}

/** This machine's physical core count, measured once (Windows' processor table, macOS'
 * sysctl, Linux' /proc/cpuinfo — psutil's sources); null when it cannot tell. */
export async function detectPhysicalCores() {
  try {
    if (process.platform === "win32") {
      const r = await procs.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfCores -Sum).Sum"],
        { timeout: 20 },
      );
      const n = Number.parseInt(String(r.stdout).trim(), 10);
      return n > 0 ? n : null;
    }
    if (process.platform === "darwin") {
      const r = await procs.run(["sysctl", "-n", "hw.physicalcpu"], { timeout: 10 });
      const n = Number.parseInt(String(r.stdout).trim(), 10);
      return n > 0 ? n : null;
    }
    const cores = new Set();
    let phys = "";
    for (const line of readFileSync("/proc/cpuinfo", "utf8").split("\n")) {
      const [k, v] = line.split(":").map((x) => (x ?? "").trim());
      if (k === "physical id") phys = v;
      else if (k === "core id") cores.add(`${phys}/${v}`);
    }
    return cores.size || null;
  } catch {
    return null;
  }
}

/** This machine's physical core count (the logical count when it cannot tell) — the CPU
 * process's default thread count. */
export function physicalCores() {
  const n = cfg.PHYSICAL_CORES;
  return Math.max(1, pyInt(n || os.availableParallelism?.() || os.cpus().length || 1));
}

/** settings.engines.speech_runtime.cpu_threads, 0 = the physical core count. */
export function cpuThreads() {
  const n = pyInt(self._settings().cpu_threads || 0);
  return n > 0 ? n : self.physicalCores();
}

/** settings.engines.speech_runtime.gpu_threads — the graphics-card process's CPU threads. */
export function gpuThreads() {
  return Math.max(1, pyInt(self._settings().gpu_threads || 4));
}

/** settings.engines.speech_runtime.start_timeout_s — a process's longest start (seconds). */
export function startTimeout() {
  return Number(self._settings().start_timeout_s || 60.0);
}

/** settings.engines.speech_runtime.request_timeout_s — one request's longest run (seconds). */
export function requestTimeout() {
  return Number(self._settings().request_timeout_s || 900.0);
}

/** Auto's bar for the CPU — seconds of audio per second of work (decided: 2×). */
export function cpuMinRealtime() {
  return Number(self._settings().cpu_min_realtime || 2.0);
}

/** The backends audio.cpp publishes a build of for this OS (the runtime row's choices). */
export function availableBackends() {
  const hw = self._hardware();
  const out = [];
  for (const b of release.binaries()) {
    if (b.platform !== hw.platform) continue;
    const name = b.gpu.startsWith("cuda") ? "cuda" : b.gpu;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** The build for this box: `backend` ("cuda", "vulkan", "cpu", "metal") pins the family;
 * empty lets the kit's GPU preference choose (CUDA on NVIDIA, Vulkan on AMD/Intel, Metal on a
 * Mac). null/undefined = the operator's setting. */
export function selectedAsset(backend = null) {
  if (backend == null) backend = self.configuredBackend();
  const hw = self._hardware();
  const rows = release.binaries();
  if (backend) {
    const key = binary.concreteGpu(hw, backend);
    return rows.find((b) => b.platform === hw.platform && b.gpu === key) ?? null;
  }
  return binary.selectRuntimeAsset(rows, hw);
}

/** The installed server for this box and the release it came from: the pinned tag, else an
 * older pinned release still on disk (`release.cfg.PREVIOUS_TAGS`, newest first). An older
 * build keeps working until the runtime row's Update installs the pinned one (decided
 * 2026-10-03). The install folder depends on the tag and the build key only, so the pinned
 * asset row finds an older tag's folder. Returns `[exe, tag]`. */
export function _findInstalled(backend) {
  const dev = devBuild.current();
  if (dev !== null) {
    // `npm run dev`: our checkout's build, whatever the backend setting. Nothing downloads
    // it, so it counts as installed once eSpeak NG is here — Install fetches only that.
    return espeak.paths(self._runtimeRoot()) !== null ? [dev.exe, devBuild.TAG] : [null, null];
  }
  const asset = self.selectedAsset(backend);
  if (asset === null) return [null, null];
  for (const tag of [release.cfg.TAG, ...release.cfg.PREVIOUS_TAGS]) {
    const exe = binary.installedRuntimeExe(self._runtimeRoot(), FOLDER, tag, asset);
    if (exe !== null) return [exe, tag];
  }
  return [null, null];
}

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** The installed server for this box — the pinned tag's, or an older pinned release's until
 * it is updated — or null. Never downloads. null/undefined = the operator's backend setting. */
export function installedExe(backend = null) {
  if (backend == null) backend = self.configuredBackend();
  if (INSTALLED.has(backend)) {
    const exe = INSTALLED.get(backend);
    if (exe === null || isFile(exe)) return exe;
  }
  const [exe, tag] = self._findInstalled(backend);
  INSTALLED.set(backend, exe);
  INSTALLED_TAG.set(backend, tag);
  return exe;
}

/** The release the installed server came from (`release.cfg.TAG` once updated), or null. */
export function installedTag(backend = null) {
  if (backend == null) backend = self.configuredBackend();
  self.installedExe(backend);
  return INSTALLED_TAG.get(backend) ?? null;
}

/** Whether the installed build has `name` (`release.FEATURES`) — false when nothing is
 * installed or the build is older than the first one that has it. A development build (the
 * fork's latest) has every one. */
export function hasFeature(name, backend = null) {
  const first = Object.hasOwn(release.FEATURES, name) ? release.FEATURES[name] : undefined;
  const tag = self.installedTag(backend);
  if (tag === devBuild.TAG) return first !== undefined;
  const order = release.BUILDS_IN_ORDER;
  if (first === undefined || tag == null || !order.includes(tag) || !order.includes(first)) return false;
  return order.indexOf(tag) >= order.indexOf(first);
}

/** Download + verify + swap in the pinned build for this box (idempotent). Returns the exe. */
export async function install({ backend = null, force = false, onProgress = null, cancelCheck = null } = {}) {
  await self.ensureHardware();
  const asset = self.selectedAsset(backend);
  if (asset === null) {
    const which = backend != null ? backend : self.configuredBackend();
    throw new RuntimeError(`audio.cpp has no ${which ? `${which} ` : ""}build for this machine`);
  }
  return binary.acquireRuntime(self._runtimeRoot(), FOLDER, release.cfg.TAG, release.binaries(), self._hardware(), {
    gpu: asset.gpu,
    force,
    dlKwargs: speechCache._downloadKwargs(),
    onProgress,
    cancelCheck,
    // `--version` alone proves the DLLs load; this proves the flags we launch with exist.
    probeArgvs: [["--no-ui", "--max-loaded-models", "0", "--version"]],
    // The release ships upstream's Python reference scripts (tools/…); the app runs none of
    // them, and the family keeps no Python (2026-10-08).
    dropFiles: (rel) => rel.endsWith(".py"),
  });
}

/** The audio.cpp backend for an installed exe's variant dir (`…/<tag>/<gpu>/`), or the
 * development build's own (its CMake cache). */
export function backendOf(exe) {
  if (devBuild.isDevExe(exe)) return devBuild.current().backend;
  const gpu = path.basename(path.dirname(String(exe)));
  return gpu.startsWith("cuda") ? "cuda" : gpu;
}

// ─── The process ────────────────────────────────────────────────────────────

/** One model the server may load — an installed variant of one of our engines. */
export class ModelEntry {
  /** `sessionOptions`: sorted `[key, value]` pairs. */
  constructor(id, family, task, filePath, sessionOptions = []) {
    this.id = id; // our variant id
    this.family = family; // audio.cpp family ("qwen3_tts", "chatterbox", …)
    this.task = task; // "tts" | "clon" | "vdes" | "asr" | "align"
    this.path = filePath; // the GGUF file in the speech cache
    this.sessionOptions = sessionOptions;
    Object.freeze(this);
  }

  toConfig() {
    const row = { id: this.id, family: this.family, task: this.task, mode: "offline", path: this.path };
    if (this.sessionOptions.length) row.session_options = Object.fromEntries(this.sessionOptions);
    return row;
  }
}

/** An audio.cpp request failed; the message is the server's own words. `status` is its HTTP
 * status — 503 for out of memory or busy, 400 for a bad request, 500 otherwise — and 503 when
 * the process stopped answering (audit §5 C5, D8). */
export class AudioCppError extends RuntimeError {
  constructor(message, status = 500) {
    super(message);
    this.name = "AudioCppError";
    this.status = status;
  }
}

/** A free loopback port. */
export function _freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** A response read whole — what callers of `_post` get: `{status, headers (lower-case keys),
 * content (Buffer), text, json()}`. */
export function responseOf(status, content = Buffer.alloc(0), headers = {}) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return {
    status,
    headers,
    content: buf,
    get text() {
      return buf.toString("utf8");
    },
    json() {
      return JSON.parse(buf.toString("utf8"));
    },
  };
}

// The request keys Python always sends as floats (`float(...)` in slot.toSpeechRequest), so
// the JSON text is Python's (`1.0`, not `1`).
const FLOAT_KEYS = new Set([
  "speed", "temperature", "top_p", "repetition_penalty", "subtalker_temperature", "subtalker_top_p",
  "exaggeration", "guidance_scale", "min_p", "s3gen_cfg_rate", "retry_badcase_ratio_threshold",
]);

/** httpx's `json=` body: compact, UTF-8, floats where Python had floats. */
const jsonBody = (v) => Buffer.from(pyJson(v, { separators: [",", ":"], ensureAscii: false, floats: FLOAT_KEYS }), "utf8");
/** The speech request body as sent (for the parity check). */
export const _jsonBody = jsonBody;

const isTimeout = (e) =>
  e?.name === "TimeoutError" || e?.name === "AbortError" || e?.cause?.name === "TimeoutError" || /timeout/i.test(String(e?.cause?.code ?? ""));

/** One server process — a placement ("gpu" | "cpu") for one kind of model ("tts" speech |
 * "stt" speech recognition). Every method may start it; one start at a time. */
export class AudioCppServer {
  constructor(placement = "gpu", kind = "tts") {
    this.placement = placement;
    this.kind = kind;
    this._lock = new Mutex();
    this._run = null;
  }

  _fileStem() {
    // The GPU speech process keeps the names it has always had.
    const stem = this.placement === "gpu" ? "audiocpp-server" : `audiocpp-server-${this.placement}`;
    return this.kind === "tts" ? stem : `${stem}-${this.kind}`;
  }

  // -- lifecycle --

  /**
   * Running with this configuration (restart if it changed). `managed`: the build registers
   * models at run time (`model_management`), so the config lists none and `register` adds
   * each as it loads — what is downloaded or deleted never restarts the process. Otherwise the
   * config lists `models` and a change to that list restarts it. `backend` overrides the
   * build's own (the "cpu" process runs a GPU build on the CPU). `threads`: the setting's
   * `gpu_threads` when not given.
   */
  async ensure(exe, models, { dataDir, device = 0, threads = null, backend = null, managed = false } = {}) {
    if (threads == null) threads = gpuThreads();
    const sorted = [...models].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const conf = {
      host: "127.0.0.1",
      backend: backend || self.backendOf(exe),
      device,
      threads,
      lazy_load: true,
      max_loaded_models: 0,
      models: managed ? [] : sorted.map((m) => m.toConfig()),
    };
    if (managed) conf.model_management = true;
    // Who started it — `engines/leftovers.js` reads this to stop a server whose parent is gone
    // (a hard-killed app must not leave a model in VRAM).
    const env = self._childEnv();
    const signature = pyJson(
      { exe: String(exe), ...conf, env: Object.fromEntries(_RUNTIME_ENV.map((k) => [k, env[k] ?? null])) },
      { sortKeys: true },
    );
    await this._lock.run(async () => {
      if (this._run && this._run.signature === signature && kitProcess.pollProc(this._run.proc) === null) return;
      await this._stopUnlocked();
      const port = await self._freePort();
      const confDir = path.join(String(dataDir), "engines-runtime-config");
      mkdirSync(confDir, { recursive: true });
      const confPath = path.join(confDir, `${this._fileStem()}.json`);
      // Python's write_text: text mode, so "\n" is the platform's line ending.
      writeFileSync(confPath, pyJson({ ...conf, port }, { indent: 1 }).replaceAll("\n", os.EOL), "utf8");
      const logPath = path.join(String(dataDir), "logs", `${this._fileStem()}.log`);
      mkdirSync(path.dirname(logPath), { recursive: true });
      self._rotateLog(logPath);
      // The kit's one spawn seam: on Windows the child goes into a kill-on-close Job Object,
      // so it dies WITH this process however this process dies, and a freshly installed binary
      // still held by the virus scanner is retried.
      const popen = (argv, opts) => procs.popen(argv, { ...opts, cwd: path.dirname(String(exe)), env });
      const [proc, job] = await kitProcess.spawnChild(popen, [String(exe), "--config", confPath, "--no-ui"], logPath);
      this._run = {
        proc,
        port,
        signature,
        logPath,
        models: managed ? new Map() : new Map(models.map((m) => [m.id, m])),
        job,
        managed,
      };
      try {
        await this._waitHealthy();
      } catch (e) {
        // Never leave a process that didn't come up recorded as running — the next `ensure`
        // with the same signature took it for healthy (audit §5 C8).
        if (e instanceof AudioCppError) await this._stopUnlocked();
        throw e;
      }
      const dev = devBuild.current();
      log.info(
        `audio.cpp ${dev ? dev.version : release.cfg.TAG} (${this.placement} ${this.kind}) up on :${port} ` +
          `(pid ${proc.pid}, ${conf.backend}, ${threads} threads, ` +
          `${managed ? "models registered as they load" : `${models.length} models`})`,
      );
    });
  }

  async _waitHealthy(timeout = null) {
    timeout = timeout == null ? startTimeout() : timeout;
    const run = this._run;
    const deadline = performance.now() / 1000 + timeout;
    while (performance.now() / 1000 < deadline) {
      const rc = kitProcess.pollProc(run.proc);
      if (rc !== null) throw new AudioCppError(`audio.cpp exited with ${rc}: ${this.logTail()}`);
      try {
        const r = await http.fetch(`http://127.0.0.1:${run.port}/health`, { timeoutMs: 2000 });
        await r.arrayBuffer().catch(() => {});
        if (r.status === 200) return;
      } catch {
        /* not up yet */
      }
      await sleep(250);
    }
    throw new AudioCppError(`audio.cpp did not answer within ${timeout.toFixed(0)}s: ${this.logTail()}`);
  }

  /** Stop the process (waits for a start in progress — Python's RLock). */
  async stop() {
    await this._lock.run(() => this._stopUnlocked());
  }

  async _stopUnlocked() {
    const run = this._run;
    this._run = null;
    if (run === null) return;
    if (kitProcess.pollProc(run.proc) === null) {
      try {
        run.proc.kill();
      } catch {
        /* already gone */
      }
      if ((await kitProcess.waitExit(run.proc, 10)) === null) {
        try {
          run.proc.kill("SIGKILL");
        } catch {
          /* already gone */
        }
        await kitProcess.waitExit(run.proc, 10);
      }
    }
    kitProcess.closeJob(run.job);
  }

  /** Kill without waiting — the process-exit last resort (Python's atexit). */
  killSync() {
    const run = this._run;
    if (run && kitProcess.pollProc(run.proc) === null) {
      try {
        run.proc.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }

  isRunning() {
    return this._run !== null && kitProcess.pollProc(this._run.proc) === null;
  }

  get pid() {
    return this.isRunning() ? this._run.proc.pid : null;
  }

  /** Listed in the config, or registered with a managed process. */
  hasModel(modelId) {
    return this._run !== null && this._run.models.has(modelId);
  }

  get managed() {
    return this._run !== null && this._run.managed;
  }

  /** Register `entry` with a managed process and load it now (`POST /v1/models/load` — our
   * fork's `model_management`). A registered model is loaded again if it was unloaded, and
   * reloaded with its new options if they changed. */
  async register(entry, timeout = null) {
    await this._post("/v1/models/load", { json: entry.toConfig(), timeout: timeout || requestTimeout() });
    if (this._run !== null) this._run.models.set(entry.id, entry);
  }

  logTail(lines = 12) {
    if (this._run === null) return "";
    let text;
    try {
      // the end only, never the whole log
      const fd = openSync(this._run.logPath, "r");
      try {
        const size = statSync(this._run.logPath).size;
        const start = Math.max(0, size - 65536);
        const buf = Buffer.alloc(size - start);
        let got = 0;
        while (got < buf.length) {
          const n = readSync(fd, buf, got, buf.length - got, start + got);
          if (n === 0) break;
          got += n;
        }
        text = buf.subarray(0, got).toString("utf8");
      } finally {
        closeSync(fd);
      }
    } catch {
      return "";
    }
    const keep = splitlines(text).filter((ln) => !ln.includes("SERVER_HTTP_DEBUG") && !ln.includes("TIMING"));
    return keep.slice(-lines).join("\n");
  }

  // -- requests --

  _url(p) {
    if (!this.isRunning()) throw new AudioCppError("audio.cpp is not running");
    return `http://127.0.0.1:${this._run.port}${p}`;
  }

  /** Throw the server's own words, with its status, for a ≥ 400 answer (a `responseOf`). */
  static _raiseFor(r) {
    if (r.status < 400) return;
    let body;
    try {
      body = r.json();
    } catch {
      body = null;
    }
    const err = isJsonObject(body) ? body.error : undefined;
    // `error` is an object with a message — or, from some handlers, a bare string.
    const msg = (isJsonObject(err) ? err.message : err) || r.text;
    throw new AudioCppError(String(msg).slice(0, 500), r.status);
  }

  /** POST to the running process; a dropped connection or a timeout is an AudioCppError (503)
   * that names it and carries the log's last lines. `json` (a body) or `form` (a `multipart` body). */
  async _post(p, { json = undefined, form = undefined, timeout, floats = false } = {}) {
    const init = { method: "POST", timeoutMs: timeout * 1000 };
    if (form !== undefined) {
      init.body = form.body;
      init.headers = { "content-type": form.contentType };
    }
    else if (json !== undefined) {
      init.body = floats ? jsonBody(json) : Buffer.from(pyJson(json, { separators: [",", ":"], ensureAscii: false }), "utf8");
      init.headers = { "content-type": "application/json" };
    }
    let r;
    try {
      const res = await http.fetch(this._url(p), init);
      r = responseOf(res.status, Buffer.from(await res.arrayBuffer()), Object.fromEntries(res.headers));
    } catch (e) {
      if (e instanceof AudioCppError) throw e;
      if (isTimeout(e)) throw new AudioCppError(`the speech runtime did not answer within ${Number(timeout).toFixed(0)} s`, 503);
      const tail = this.logTail(4);
      const kind = e?.cause?.code ?? e?.cause?.name ?? e?.name ?? "Error";
      throw new AudioCppError(`the speech runtime stopped answering (${kind})${tail ? `: ${tail}` : ""}`, 503);
    }
    AudioCppServer._raiseFor(r);
    return r;
  }

  /** `[wavBytes, headers]`. */
  async speech(body, timeout = null) {
    const r = await this._post("/v1/audio/speech", { json: body, timeout: timeout || requestTimeout(), floats: true });
    return [r.content, { ...r.headers }];
  }

  async transcribe(body, timeout = null) {
    return (await this._post("/v1/audio/transcriptions/details", { json: body, timeout: timeout || requestTimeout() })).json();
  }

  async align(model, wav, text, language, timeout = null) {
    const form = http.multipart([
      { name: "model", data: Buffer.from(String(model), "utf8") },
      { name: "text", data: Buffer.from(String(text), "utf8") },
      { name: "language", data: Buffer.from(String(language), "utf8") },
      { name: "file", filename: "audio.wav", contentType: "audio/wav", data: Buffer.from(wav) },
    ]);
    return (await this._post("/v1/audio/alignments", { form, timeout: timeout || requestTimeout() })).json();
  }

  async unload(modelIds) {
    if (!this.isRunning() || !modelIds.length) return;
    await this._post("/v1/tasks/unload_models", { json: { model_ids: modelIds }, timeout: 120 });
  }

  async unloadAll() {
    if (!this.isRunning()) return;
    await this._post("/v1/tasks/unload_all_models", { timeout: 120 });
  }
}

/** A log over 10 MB becomes `<name>.1.log` (replacing the one before) as its process starts;
 * the logs grew without end across every start (audit 2026-10-04 §5 F). A log another process
 * still holds is left for the next start. */
export function _rotateLog(logPath) {
  try {
    if (isFile(logPath) && statSync(logPath).size > cfg.LOG_ROTATE_BYTES) {
      const p = String(logPath);
      const ext = path.extname(p);
      renameSync(p, `${ext ? p.slice(0, -ext.length) : p}.1.log`);
    }
  } catch {
    /* held by another process — next start */
  }
}

export const PLACEMENTS = ["gpu", "cpu"];
export const KINDS = ["tts", "stt"];
const SERVERS = new Map(); // "placement/kind" → AudioCppServer

/** The server for one placement ("gpu" | "cpu") and kind ("tts" | "stt"), created on first
 * use (not started). */
export function getServer(placement = "gpu", kind = "tts") {
  if (!PLACEMENTS.includes(placement)) throw new ValueError(`unknown placement '${placement}'`);
  if (!KINDS.includes(kind)) throw new ValueError(`unknown kind '${kind}'`);
  const key = `${placement}/${kind}`;
  let srv = SERVERS.get(key);
  if (srv === undefined) {
    srv = new AudioCppServer(placement, kind);
    SERVERS.set(key, srv);
  }
  return srv;
}

/** Every server created so far for `placement` (null = all), cpu before gpu, speech first. */
export function servers(placement = null) {
  const found = [...SERVERS.values()].filter((s) => placement == null || s.placement === placement);
  return found.sort((a, b) =>
    a.placement < b.placement ? -1 : a.placement > b.placement ? 1 : KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind),
  );
}

/** Stop the servers of one placement and/or kind; null = every one. */
export async function shutdownServer(placement = null, kind = null) {
  for (const srv of self.servers(placement)) {
    if (kind == null || srv.kind === kind) await srv.stop();
  }
}

/** Kill every running server without waiting — for process exit. */
export function killAllSync() {
  for (const srv of SERVERS.values()) srv.killSync();
}
