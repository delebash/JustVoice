// SPDX-License-Identifier: MIT
// GET/PUT /v1/speech-runtime — the one audio.cpp runtime every speech engine shares (the port
// of justvoice/api/speech_runtime_api.py).
//
// The AI page's runtime row reads this: which release, which backend this machine runs (CUDA,
// Vulkan, CPU, Metal), whether it is installed, and whether its processes are up — the GPU one
// and, since CPU placement (2026-10-02), the CPU one for models placed there. Installing goes
// through any audio.cpp engine's Install (POST /v1/engines/{id}/install), which installs the
// runtime once for all of them (docs/plans/2026-10-01-audiocpp-switch.md §3.1). PUT changes the
// backend or GPU — it saves the setting, frees every speech slot and stops both processes, so
// the next load starts the chosen build — or the CPU process's threads, which frees only the
// models on the CPU and stops only that process. The CPU bar (`cpu_min_realtime`) restarts
// nothing.

import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { nullable, opt, T } from "@delebash/llm-runner/platform/models";
import { strip } from "@delebash/llm-runner/platform/py";
import { getState } from "../app_state.js";
import * as devBuild from "../engines/audiocpp/dev_build.js";
import * as japanese from "../engines/audiocpp/japanese.js";
import * as release from "../engines/audiocpp/release.js";
import * as runtime from "../engines/audiocpp/runtime.js";
import * as manager from "../engines/manager.js";
import { badRequest } from "../errors.js";
import * as installer from "../installer.js";
import { construct, SpeechRuntimeSettings } from "../models.js";
import { sentBody } from "./settings_api.js";

const log = getLogger("justvoice.api.speech_runtime_api");

export const JapaneseDictionaryInfo = T.Object({
  installed: T.Boolean(),
  version: T.String(),
  size_bytes: T.Integer(), // on disk once installed
  download_bytes: T.Integer(),
});

export const SpeechRuntimeInfo = T.Object({
  runtime: opt(T.String(), "audio.cpp"),
  version: T.String(), // the installed release, else the pinned one
  installed: T.Boolean(),
  // The pinned release when an older one is installed — the runtime row offers "Update to
  // <it>"; the older build keeps working until then (2026-10-03).
  update_to: opt(nullable(T.String()), null),
  backend: opt(nullable(T.String()), null), // "cuda" | "vulkan" | "cpu" | "metal" — the build in use
  build: opt(nullable(T.String()), null), // the build key ("cuda12", "vulkan", …)
  // `npm run dev`: the checkout the development build came from ("..\audio.cpp"), else null;
  // `version` is then "dev · <commit>" (decided 2026-10-03, D4).
  dev_source: opt(nullable(T.String()), null),
  backend_setting: opt(T.String(), "auto"), // settings.engines.speech_runtime.backend
  backends: opt(T.Array(T.String()), []), // the builds audio.cpp publishes for this OS
  gpu: opt(T.Integer(), 0), // settings.engines.speech_runtime.gpu
  gpus: opt(T.Array(T.String()), []), // this machine's GPUs, by index
  running: opt(T.Boolean(), false),
  pid: opt(nullable(T.Integer()), null),
  models_known: opt(T.Integer(), 0), // models the GPU processes list or have registered
  // The CPU process (CPU placement, 2026-10-02).
  cpu_threads: opt(T.Integer(), 0), // the setting; 0 = the physical core count
  cpu_threads_used: opt(T.Integer(), 0), // what the CPU process runs with
  physical_cores: opt(T.Integer(), 0),
  cpu_min_realtime: opt(T.Number(), 2.0), // Auto's bar for the CPU
  cpu_running: opt(T.Boolean(), false),
  cpu_pid: opt(nullable(T.Integer()), null),
  // The optional Japanese dictionary (gap 7) — null while the pinned runtime cannot use it.
  japanese_dictionary: opt(nullable(JapaneseDictionaryInfo), null),
});

export function _japaneseDictionary() {
  if (!release.pinnedHas("japanese")) return null;
  return {
    installed: japanese.dictionaryDir(manager.enginesRuntimeRoot()) !== null,
    version: japanese.VERSION,
    size_bytes: japanese.INSTALLED_BYTES,
    download_bytes: japanese.DOWNLOAD_BYTES,
  };
}

export function _info() {
  const exe = runtime.installedExe();
  const tag = exe !== null ? runtime.installedTag() : null;
  const dev = devBuild.current();
  const asset = exe === null && dev === null ? runtime.selectedAsset() : null;
  // Speech and speech recognition run in processes of their own (audit 2026-10-04 §13.2); the
  // row reports a placement's speech process, else its recognition one.
  const gpu = runtime.servers("gpu").filter((s) => s.isRunning());
  const cpu = runtime.servers("cpu").filter((s) => s.isRunning());
  const known = gpu.reduce((n, s) => n + (s._run ? s._run.models.size : 0), 0);
  const s = runtime._settings();
  let gpus;
  try {
    gpus = (runtime._hardware()?.gpus || []).map((g) => g.name);
  } catch {
    gpus = []; // no kit / detection failed → no list
  }
  let version;
  let updateTo;
  let backend;
  let build;
  if (dev !== null) {
    // The development build: its own version and backend, never an update.
    [version, updateTo, backend, build] = [dev.version, null, dev.backend, null];
  } else {
    version = tag || release.cfg.TAG;
    updateTo = tag !== null && tag !== release.cfg.TAG ? release.cfg.TAG : null;
    backend = exe ? runtime.backendOf(exe) : asset === null ? null : asset.gpu.startsWith("cuda") ? "cuda" : asset.gpu;
    build = exe ? path.basename(path.dirname(String(exe))) : asset ? asset.gpu : null;
  }
  return construct(SpeechRuntimeInfo, {
    version,
    installed: exe !== null,
    update_to: updateTo,
    backend,
    build,
    dev_source: dev !== null ? dev.source : null,
    backend_setting: s.backend || "auto",
    backends: runtime.availableBackends(),
    gpu: s.gpu,
    gpus,
    running: gpu.length > 0,
    pid: gpu.length ? gpu[0].pid : null,
    models_known: known,
    cpu_threads: s.cpu_threads,
    cpu_threads_used: runtime.cpuThreads(),
    physical_cores: runtime.physicalCores(),
    cpu_min_realtime: s.cpu_min_realtime,
    cpu_running: cpu.length > 0,
    cpu_pid: cpu.length ? cpu[0].pid : null,
    japanese_dictionary: _japaneseDictionary(),
  });
}

export async function router(app) {
  /** Start the Japanese dictionary's download; poll /v1/jobs/{job_id}. */
  app.post("/v1/speech-runtime/japanese-dictionary", async (_req, reply) => {
    if (!release.pinnedHas("japanese")) throw badRequest("this speech runtime cannot read Japanese yet");
    reply.code(202);
    return { job_id: installer.spawnJapaneseDictionaryInstall(getState()) };
  });

  app.get("/v1/speech-runtime", async () => _info());

  app.put("/v1/speech-runtime", { schema: { body: SpeechRuntimeSettings } }, async (req) => {
    const body = req.body;
    const backend = strip(body.backend || "auto").toLowerCase();
    if (backend !== "auto" && !runtime.availableBackends().includes(backend)) {
      throw badRequest(`audio.cpp has no ${backend} build for this machine`);
    }
    if (body.gpu < 0) throw badRequest("gpu must be 0 or more");
    if (body.cpu_threads < 0) throw badRequest("cpu_threads must be 0 (the physical core count) or more");
    if (body.cpu_min_realtime <= 0) throw badRequest("cpu_min_realtime must be more than 0");
    if (body.gpu_threads < 1) throw badRequest("gpu_threads must be 1 or more");
    if (body.start_timeout_s <= 0 || body.request_timeout_s <= 0) throw badRequest("the timeouts must be more than 0 seconds");
    const store = getState().settings;
    const cur = store.get();
    const old = cur.engines.speech_runtime;
    // A field the request leaves out keeps its value — the runtime row sends only what it
    // shows, and a value set through PATCH /v1/settings must survive the row's next change.
    const sent = sentBody(req);
    const update = {};
    for (const k of Object.keys(SpeechRuntimeSettings.properties)) if (Object.hasOwn(sent, k)) update[k] = body[k];
    const next = { ...old, ...update, backend };
    if (!isDeepStrictEqual(old, next)) {
      cur.engines.speech_runtime = next;
      store.set(cur);
      const mgr = manager.getManager();
      const buildChanged = old.backend !== next.backend || old.gpu !== next.gpu;
      const threadsChanged = old.cpu_threads !== next.cpu_threads;
      const gpuThreadsChanged = old.gpu_threads !== next.gpu_threads;
      // Free the slots whose process stops (their bookings go with them), then stop it — the
      // next load starts it again with the new setting.
      for (const kind of ["tts", "stt"]) {
        const slot = mgr.loadedFor(kind);
        if (slot === null || !slot.manifest.usesAudiocpp) continue;
        const on = slot.placement ?? "gpu";
        if (buildChanged || (threadsChanged && on === "cpu") || (gpuThreadsChanged && on === "gpu")) await mgr.unload(kind);
      }
      if (buildChanged) {
        await runtime.shutdownServer();
        runtime.forgetInstalled();
        log.info(`speech runtime set to ${backend} (gpu ${body.gpu}); both processes stopped`);
      } else {
        if (threadsChanged) {
          await runtime.shutdownServer("cpu");
          log.info(`speech runtime CPU threads set to ${next.cpu_threads}; the CPU process stopped`);
        }
        if (gpuThreadsChanged) {
          await runtime.shutdownServer("gpu");
          log.info(`speech runtime GPU-process threads set to ${next.gpu_threads}; the GPU process stopped`);
        }
      }
    }
    return _info();
  });
}
