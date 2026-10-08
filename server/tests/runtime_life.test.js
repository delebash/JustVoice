// SPDX-License-Identifier: MIT
// The speech runtime's life (audit 2026-10-04 §13.2): models registered at run time so nothing
// downloaded restarts a process, one process per kind, a dead slot dropped with its booking,
// Cancel freeing its booking. No binary, no GPU (the port of tests/test_runtime_life.py).
//
// Not ported: test_engine_handlers_run_off_the_event_loop — a Python-only mechanism (FastAPI
// runs a plain `def` handler on its thread pool; it pins that no handler was `async def`).
// The Node server is one event loop by design; the load's long waits are awaits.
import { readFileSync } from "node:fs";
import path from "node:path";
import * as kitProcess from "@delebash/llm-runner/runner/process";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { discrete, makeArbiter, resetArbiter, wav } from "./engines_helpers.js";
import * as runtime from "../src/engines/audiocpp/runtime.js";
import { ModelEntry } from "../src/engines/audiocpp/runtime.js";
import * as slotMod from "../src/engines/audiocpp/slot.js";
import * as enginesApi from "../src/api/engines_api.js";
import * as managerMod from "../src/engines/manager.js";
import { discoverEngines, EngineManager } from "../src/engines/manager.js";
import * as speechCache from "../src/speech_cache.js";
import { tmpPath } from "./helpers.js";

const fakeProc = () => ({ pid: 777, exitCode: null, signalCode: null, kill() {} });

/** `AudioCppServer.ensure` with the spawn faked: each start is recorded, nothing runs. */
function spawns() {
  const started = [];
  vi.spyOn(kitProcess, "spawnChild").mockImplementation(async (popen, argv) => {
    started.push(argv);
    return [fakeProc(), null];
  });
  vi.spyOn(runtime.AudioCppServer.prototype, "_waitHealthy").mockResolvedValue(undefined);
  vi.spyOn(runtime, "_childEnv").mockReturnValue({});
  return started;
}

const config = (dir, stem = "audiocpp-server") => JSON.parse(readFileSync(path.join(dir, "engines-runtime-config", `${stem}.json`), "utf8"));

test("a_managed_process_starts_with_no_models_and_a_download_never_restarts_it", async () => {
  const started = spawns();
  const tmp = tmpPath();
  const srv = new runtime.AudioCppServer("gpu", "tts");
  const exe = path.join(tmp, "audiocpp_server.exe");
  const kokoro = new ModelEntry("kokoro-82m-q8", "kokoro_tts", "tts", "C:/m/k.gguf");
  const kitten = new ModelEntry("kitten-mini-0.8", "kitten_tts", "tts", "C:/m/t.gguf");
  await srv.ensure(exe, [kokoro], { dataDir: tmp, managed: true });
  const cfg = config(tmp);
  expect(cfg.model_management).toBe(true);
  expect(cfg.models).toEqual([]);
  expect("ui_management" in cfg).toBe(false); // never the WebUI's installer / delete / browse
  await srv.ensure(exe, [kokoro, kitten], { dataDir: tmp, managed: true }); // a model downloaded
  expect(started.length).toBe(1);
  expect(srv.managed).toBe(true);
});

test("an_older_build_lists_its_models_and_a_new_one_restarts_it", async () => {
  const started = spawns();
  const tmp = tmpPath();
  const srv = new runtime.AudioCppServer("gpu", "stt");
  const exe = path.join(tmp, "audiocpp_server.exe");
  const asr = new ModelEntry("qwen3-asr-1.7b-q8", "qwen3_asr", "asr", "C:/m/a.gguf");
  await srv.ensure(exe, [asr], { dataDir: tmp });
  const cfg = config(tmp, "audiocpp-server-stt");
  expect(cfg.models.map((m) => m.id)).toEqual(["qwen3-asr-1.7b-q8"]);
  expect("model_management" in cfg).toBe(false);
  expect(srv.hasModel("qwen3-asr-1.7b-q8")).toBe(true);
  expect(srv.managed).toBe(false);
  await srv.ensure(exe, [asr, new ModelEntry("x", "qwen3_asr", "asr", "C:/m/x.gguf")], { dataDir: tmp });
  expect(started.length).toBe(2);
});

/** What the slot needs from a managed process. */
function managedServer() {
  const srv = {
    managed: true,
    pid: 5,
    _run: { proc: { pid: 5 }, port: 1 },
    registered: new Map(),
    calls: [],
    isRunning: () => true,
    hasModel: (id) => srv.registered.has(id),
    async register(entry) {
      srv.calls.push(["register", entry.id]);
      srv.registered.set(entry.id, entry);
    },
    async transcribe() {
      return { text: "" };
    },
    async align(model) {
      srv.calls.push(["align", model]);
      return { words: [{ word: "hi", start: 0.0, end: 0.2 }] };
    },
    async unload(ids) {
      srv.calls.push(["unload", [...ids]]);
    },
  };
  return srv;
}

test("a_load_registers_its_model_and_the_aligner_registers_on_first_use", async () => {
  const srv = managedServer();
  vi.spyOn(slotMod, "ensureServer").mockResolvedValue(srv);
  vi.spyOn(runtime, "getServer").mockReturnValue(srv);
  vi.spyOn(slotMod, "effectivePlacement").mockImplementation((p) => p);
  vi.spyOn(slotMod, "_dataDir").mockReturnValue(tmpPath());
  vi.spyOn(speechCache, "variantOnDisk").mockReturnValue(true);
  const asr = discoverEngines().get("asr");
  const s = new slotMod.AudioCppSlot(asr, "gpu");
  expect(s.kind).toBe("stt");
  expect((await s.post("/load", { variant: null })).statusCode).toBe(200);
  const modelId = asr.defaultVariantId;
  expect(srv.calls[0]).toEqual(["register", modelId]);
  expect(s.isAlive()).toBe(true);
  expect(srv.registered.has(`${modelId}::aligner`)).toBe(false); // lazily, as before
  const r = await s.post("/align", { wav_b64: wav(0.5, 16000).toString("base64"), text: "hi", language: "en" });
  expect(r.statusCode).toBe(200);
  expect(r.json().words[0].word).toBe("hi");
  expect(srv.calls).toContainEqual(["register", `${modelId}::aligner`]);
  await s.terminate();
  expect(srv.calls[srv.calls.length - 1]).toEqual(["unload", [modelId, `${modelId}::aligner`]]);
});

test("a_load_refuses_a_model_that_is_not_downloaded", async () => {
  const srv = managedServer();
  vi.spyOn(slotMod, "ensureServer").mockResolvedValue(srv);
  vi.spyOn(slotMod, "effectivePlacement").mockImplementation((p) => p);
  vi.spyOn(slotMod, "_dataDir").mockReturnValue(tmpPath());
  vi.spyOn(speechCache, "variantOnDisk").mockReturnValue(false);
  const r = await new slotMod.AudioCppSlot(discoverEngines().get("kokoro"), "gpu").post("/load", { variant: null });
  expect(r.statusCode).toBe(400);
  expect(r.text).toContain("not downloaded");
  expect(srv.calls).toEqual([]);
});

let arbiter;
beforeEach(() => {
  arbiter = makeArbiter(discrete());
});
afterEach(() => resetArbiter());

class Slot {
  constructor(engineId, { alive = true, dead = false } = {}) {
    this.manifest = { id: engineId };
    this._alive = alive;
    this._dead = dead;
    this.terminated = false;
  }
  isAlive() {
    return this._alive;
  }
  isDead() {
    return this._dead;
  }
  terminate() {
    this.terminated = true;
  }
}

test("a_slot_whose_process_died_is_dropped_with_its_booking", () => {
  // §13.1, live: the GPU process restarted under the recogniser and its 2,861 MB booking
  // stayed, so its own reload was refused against it.
  const mgr = new EngineManager();
  arbiter.reserve("stt:asr", 2861, { kind: "stt", evictFn: () => {}, source: "measured" });
  mgr._loaded = new Map([["stt", new Slot("asr", { alive: false, dead: true })]]);
  mgr._currentVariants.set("asr", "qwen3-asr-1.7b-q8");
  expect(mgr.loadedFor("stt")).toBeNull();
  expect(mgr._loaded.has("stt")).toBe(false);
  expect(mgr._currentVariants.has("asr")).toBe(false);
  expect(arbiter.reservedMb("stt:asr")).toBeFalsy();
});

test("the_memory_strip_never_shows_a_dead_models_booking", async () => {
  // Live 2026-10-04: after the speech process was killed, the first poll still listed
  // `tts:qwen3 1913 MB` — the handler read the bookings before it looked at the slots.
  const mgr = new EngineManager();
  arbiter.reserve("tts:qwen3", 1913, { kind: "tts", evictFn: () => {}, source: "measured" });
  mgr._loaded = new Map([["tts", new Slot("qwen3", { alive: false, dead: true })]]);
  vi.spyOn(managerMod, "getManager").mockReturnValue(mgr);
  vi.spyOn(mgr, "_hardware").mockResolvedValue(null);
  vi.spyOn(mgr, "poolUsedMb").mockResolvedValue(500);
  const out = await enginesApi.getEngineVram();
  expect(out.reservations.filter((r) => r.key === "tts:qwen3")).toEqual([]);
  expect(out.loaded).toEqual([]);
});

test("a_slot_still_loading_is_left_alone", () => {
  const mgr = new EngineManager();
  arbiter.reserve("tts:kokoro", 600, { kind: "tts", evictFn: () => {}, source: "measured" });
  const loading = new Slot("kokoro", { alive: false, dead: false });
  mgr._loaded = new Map([["tts", loading]]);
  expect(mgr.loadedFor("tts")).toBeNull();
  expect(mgr._loaded.get("tts")).toBe(loading);
  expect(arbiter.reservedMb("tts:kokoro")).toBe(600);
});

test("cancel_frees_the_booking_with_the_slot", async () => {
  const mgr = new EngineManager();
  arbiter.reserve("tts:kokoro", 600, { kind: "tts", evictFn: () => {}, source: "measured" });
  const s = new Slot("kokoro");
  mgr._loaded = new Map([["tts", s]]);
  expect(await mgr.requestCancelLoad("kokoro")).toBe(true);
  expect(s.terminated).toBe(true);
  expect(mgr._loaded.has("tts")).toBe(false);
  expect(arbiter.reservedMb("tts:kokoro")).toBeFalsy();
});
