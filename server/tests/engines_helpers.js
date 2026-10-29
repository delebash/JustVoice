// SPDX-License-Identifier: MIT
// Test helpers for the speech-engine layer's suites (wave B) — fake hardware, an injected
// arbiter, WAV builders, the kit's audio.cpp runtime faked (round E: it runs our speech models),
// an app state on a temp folder.
//
// Importing this module points the default data folder at a temp folder for the whole test
// file (the DSP program logs there when no app state is set — never into the checkout's
// `data/`), and forgets any `npm run dev` build named in the environment (conftest.py did the
// same: the suite tests the pinned release unless a test points at a build itself).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as llmDb from "@delebash/core/llm/db";
import { model } from "@delebash/core/platform/models";
import * as arbiter from "@delebash/core/runner/arbiter";
import { configureRuntimeServices, runtimeServices } from "@delebash/core/runner/runtime_service";
import { runtimeOf } from "@delebash/core/runner/runtimes";
import { GpuInfo, HardwareInfo } from "@delebash/core/runner/schema";
import * as appState from "../src/app_state.js";
import { writeWavContainer } from "../src/audio/wav.js";
import * as session from "../src/database/session.js";
import * as devBuild from "../src/engines/audiocpp/dev_build.js";
import { variantOf } from "../src/engines/audiocpp/kit_models.js";
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

/** An audio.cpp server that answers every request and remembers it: speech `wav` (a WAV), a
 * transcription `text`, an alignment `words`. Its `calls` are `[method, ...args]`. */
export function fakeServer({ wav: answer = wav(0.5), text = "", words = [] } = {}) {
  const calls = [];
  return {
    calls,
    speech: async (body) => {
      calls.push(["speech", body]);
      return [answer, {}];
    },
    transcribe: async (body, timeout = null) => {
      calls.push(["transcribe", body, timeout]);
      return { text };
    },
    align: async (model, audio, said, language) => {
      calls.push(["align", model, audio, said, language]);
      return { words };
    },
  };
}

/**
 * The kit's audio.cpp runtime, faked (round E: it loads and runs our models — kit_speech.js): what
 * each kind holds (`loaded`: `[{modelId, placement?, kind?, reason?}]`), the model ids downloaded
 * (`onDisk`; their files `files[id]`, else a main file of their own), whether it is `installed`,
 * the add-ons installed (`addons`: "unidic"). A line runs on `server` (fakeServer) and holds its
 * model after; `lines` records each `useModel` call — `{modelId, placement, sessionOptions, needs}`
 * — `unloads` each Unload, `stops` each stop of its servers. Installed with the kit's
 * configureRuntimeServices; `endSpeech()` puts the services back. → the fake service.
 */
export function fakeSpeechRuntime({ loaded = [], onDisk = [], files = {}, installed = true, addons = [], server = fakeServer() } = {}) {
  const kindOf = (id) => (variantOf(id)?.mod.KIND === "stt" ? "stt" : "tts");
  const held = loaded.map((l) => ({ placement: "gpu", reason: "", kind: kindOf(l.modelId), ...l }));
  const svc = {
    rt: runtimeOf("audiocpp"),
    server,
    lines: [],
    unloads: [],
    held,
    loaded: () => held.map((h) => ({ ...h })),
    installedExe: () => (installed ? "audiocpp_server" : null),
    modelFor(id) {
      if (!onDisk.includes(id)) throw Object.assign(new Error(`${id} isn't downloaded`), { notDownloaded: true });
      return { key: id, files: files[id] ?? { model: path.join(process.env.JUSTVOICE_DATA_DIR, "fake-models", `${id}.gguf`) }, peakVramMb: 0 };
    },
    addons: () => [{ id: "unidic", installed: addons.includes("unidic") }],
    async useModel(modelId, { placement, sessionOptions, needs = [] } = {}, fn) {
      svc.lines.push({ modelId, placement, sessionOptions, needs });
      const kind = kindOf(modelId);
      for (let i = held.length - 1; i >= 0; i--) if (held[i].kind === kind && held[i].modelId !== modelId) held.splice(i, 1);
      let h = held.find((x) => x.modelId === modelId);
      if (!h) held.push((h = { modelId, placement: "gpu", kind, reason: "" }));
      return fn(server, { ...h });
    },
    // a transcription's request, as the kit asks our hook to shape it (kit_hooks.js `transcribe`)
    async transcriptionRequest(modelId, body) {
      const { SPEECH_HOOKS } = await import("../src/engines/audiocpp/kit_hooks.js");
      return SPEECH_HOOKS.transcribe(body, { id: modelId, kind: kindOf(modelId) });
    },
    // the kit's stopRuntimeServers (a reset, a restore, the shutdown): every model leaves
    async stopServer() {
      svc.stops += 1;
      held.length = 0;
    },
    stops: 0,
    async unloadModel(id) {
      svc.unloads.push(id);
      const i = held.findIndex((x) => x.modelId === id);
      if (i >= 0) held.splice(i, 1);
      return i >= 0;
    },
  };
  fakeSpeech.prev ??= new Map(runtimeServices().map((s) => [s.rt.id, s]));
  configureRuntimeServices(new Map([...fakeSpeech.prev, ["audiocpp", svc]]));
  return svc;
}
const fakeSpeech = { prev: null };

/** The kit's runtime services as they were before `fakeSpeechRuntime`. */
export function endSpeech() {
  if (fakeSpeech.prev !== null) configureRuntimeServices(fakeSpeech.prev);
  fakeSpeech.prev = null;
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
