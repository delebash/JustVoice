// SPDX-License-Identifier: MIT
// The VRAM wiring under the AMENDED measured currency
// (docs/plans/2026-08-13-speech-catalog-redesign.md §10): device policy at the one load door;
// NO pre-load estimate — a prior MEASURED footprint admits and books EARLY, a first-ever load
// gets no arithmetic; the per-PID-tree true-up; the device-delta fallback (computed, never
// persisted); the raise-only high-water bump with occupant re-check; the one-pool ruling; the
// tts/stt busy flags (the port of tests/test_engine_vram_wiring.py).
//
// Every test injects its own VramArbiter (fake hardware) and restores the singleton after. The
// pool probe is stubbed to null by default; measured-admission and delta tests install their
// own probe sequences.
//
// Not ported here: test_scheduler_worker_marks_tts_busy_while_draining (synth_scheduler) and
// test_vram_endpoint_serves_the_strip (app.js + api/engines_api) — later waves: test.todo.
import * as stores from "@delebash/llm-runner/llm/stores";
import * as hardware from "@delebash/llm-runner/runner/hardware";
import { afterEach, expect, test, vi } from "vitest";
import { bareManager, discrete, makeArbiter, onePool, resetArbiter } from "./engines_helpers.js";
import * as runtime from "../src/engines/audiocpp/runtime.js";
import * as manager from "../src/engines/manager.js";
import { EngineManager } from "../src/engines/manager.js";
import { SynthScheduler } from "../src/synth_scheduler.js";
import { AsyncEvent, sleep } from "@delebash/llm-runner/platform/asyncutil";

afterEach(() => resetArbiter());

const resp = (payload = { ok: true, voices: [] }, status = 200) => ({ statusCode: status, text: "", json: () => payload });

class Proc {
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

/** A duck-typed manifest. Deliberately carries NO memory number of any kind. `backend` is
 * where the speech runtime runs for this test (what `_resolveDevice` answers). */
const manifest = (engineId = "eng", kind = "tts", backend = "cuda") => ({
  id: engineId,
  kind,
  isInstalled: true,
  defaultVariantId: "v1",
  requirements: {},
  backend,
});

function mgrFor(hw, m, SlotClass = Proc) {
  vi.spyOn(manager, "_newSlot").mockImplementation((mm, p) => new SlotClass(mm, p));
  // Every model runs where the speech runtime runs — the test's manifest says where.
  vi.spyOn(EngineManager.prototype, "_resolveDevice").mockImplementation((mm) => mm.backend);
  // Offline-deterministic by default: no measured pool, no prior measurement rows, no
  // persistence.
  vi.spyOn(EngineManager.prototype, "poolUsedMb").mockResolvedValue(null);
  vi.spyOn(EngineManager.prototype, "_priceMb").mockReturnValue(0);
  vi.spyOn(EngineManager.prototype, "_recordSpeechLoad").mockImplementation(() => {});
  const mgr = new EngineManager();
  mgr._manifests = new Map([[m.id, m]]);
  mgr._hwCache = hw;
  mgr._hwDetected = true;
  return mgr;
}

// ─── where a model runs: the speech runtime's backend ─────────────────

test("the_device_is_the_installed_runtimes_backend", () => {
  // No per-engine device since the 2026-10-01 switch: the resolved device is the one runtime's
  // build backend (none installed → cpu, which books nothing on a discrete card).
  for (const [build, expected] of [
    ["cuda12", "cuda"],
    ["cuda13", "cuda"],
    ["vulkan", "vulkan"],
    ["cpu", "cpu"],
    [null, "cpu"],
  ]) {
    const exe = build === null ? null : `C:/rt/audiocpp/v0.9.0/${build}/audiocpp_server.exe`;
    vi.spyOn(runtime, "installedExe").mockReturnValue(exe);
    const m = manifest();
    expect(Object.create(EngineManager.prototype)._resolveDevice(m, "auto")).toBe(expected);
    // A per-call request has nothing to move — one runtime, one place.
    expect(Object.create(EngineManager.prototype)._resolveDevice(m, "cpu")).toBe(expected);
  }
});

test("resolved_device_is_passed_down_explicitly", async () => {
  // The slot never sees "auto": the door resolves, and the card shows it.
  makeArbiter(discrete());
  const mgr = mgrFor(discrete(), manifest());
  await mgr.load("eng", { device: "auto" });
  expect(mgr._loaded.get("tts").loadBodies[0].device).toBe("cuda");
  expect(mgr.resolvedDeviceFor("eng")).toBe("cuda");
});

// ─── the amended pricing chain (§10): no estimate, measured-only ──────

test("first_load_books_nothing_when_nothing_measurable", async () => {
  // A first-ever load carries NO invented number — no admission, no booking.
  const arb = makeArbiter(discrete());
  const mgr = mgrFor(discrete(), manifest());
  await mgr.load("eng", { device: "auto" }); // probe miss (fake proc), pool unmeasurable
  expect(arb.reservationOf("tts:eng")).toBeNull();
  expect(mgr._loaded.get("tts").isAlive()).toBe(true);
  await mgr.unload("tts");
  expect(arb.reservationOf("tts:eng")).toBeNull();
});

test("load_true_up_books_the_measured_number", async () => {
  // The per-PID-tree probe books the real footprint the moment the load confirms. A model
  // with no price yet is asked to calibrate; what it measures after that is persisted.
  const arb = makeArbiter(discrete());
  const recorded = [];
  const bodies = [];
  class CalibratingProc extends Proc {
    post(p, json = null) {
      if (p === "/load") {
        bodies.push(json);
        return resp({ ok: true, voices: [], calibrated: Boolean((json || {}).calibrate_chars) });
      }
      return super.post(p, json);
    }
  }
  const mgr = mgrFor(discrete(), manifest(), CalibratingProc);
  vi.spyOn(EngineManager.prototype, "_engineProcMb").mockResolvedValue(1234);
  vi.spyOn(EngineManager.prototype, "_recordSpeechLoad").mockImplementation((m, kind, variant, mb) => recorded.push([m.id, kind, mb]));
  await mgr.load("eng", { device: "auto" });
  expect(bodies[0].calibrate_chars).toBeGreaterThan(0);
  expect(arb.reservationOf("tts:eng")).toEqual({ vram_mb: 1234, source: "measured", kind: "tts", pinned: false, asleep: false });
  expect(recorded).toEqual([["eng", "tts", 1234]]);
});

test("a_load_that_could_not_calibrate_is_booked_but_never_priced", async () => {
  // A clip-only family can't speak a warm-up line: its post-load number is the weights alone.
  const arb = makeArbiter(discrete());
  const recorded = [];
  const mgr = mgrFor(discrete(), manifest());
  vi.spyOn(EngineManager.prototype, "_engineProcMb").mockResolvedValue(900);
  vi.spyOn(EngineManager.prototype, "_recordSpeechLoad").mockImplementation((m, k, v, mb) => recorded.push(mb));
  await mgr.load("eng", { device: "auto" });
  expect(arb.reservationOf("tts:eng").vram_mb).toBe(900);
  expect(recorded).toEqual([]);
});

test("prior_measured_admits_and_books_early", async () => {
  // A prior measured footprint books BEFORE the child confirms; a post-load probe miss keeps
  // the prior booking.
  const arb = makeArbiter(discrete());
  const seenAtPost = [];
  class EarlyProc extends Proc {
    post(p, json = null) {
      if (p === "/load") seenAtPost.push(arb.reservationOf("tts:eng"));
      return super.post(p, json);
    }
  }
  const mgr = mgrFor(discrete(), manifest(), EarlyProc);
  vi.spyOn(EngineManager.prototype, "_priceMb").mockReturnValue(1500);
  await mgr.load("eng", { device: "auto" });
  expect(seenAtPost[0]).not.toBeNull();
  expect(seenAtPost[0].vram_mb).toBe(1500);
  expect(seenAtPost[0].source).toBe("measured");
  expect(arb.reservationOf("tts:eng").vram_mb).toBe(1500);
});

test("failed_load_releases_the_early_booking", async () => {
  // A reservation nobody releases is a lying ledger.
  const arb = makeArbiter(discrete());
  class FailProc extends Proc {
    post(p, json = null) {
      if (p === "/load") return { statusCode: 500, text: "boom", json: () => ({}) };
      return super.post(p, json);
    }
  }
  const mgr = mgrFor(discrete(), manifest(), FailProc);
  vi.spyOn(EngineManager.prototype, "_priceMb").mockReturnValue(1500);
  await expect(mgr.load("eng", { device: "auto" })).rejects.toThrow(/engine load failed/);
  expect(arb.reservationOf("tts:eng")).toBeNull();
});

test("first_load_delta_fallback_books_computed_never_persists", async () => {
  // No per-process arm on this box (AMD Linux): the device-wide delta books as "computed" —
  // and is NEVER persisted.
  const arb = makeArbiter(discrete());
  const recorded = [];
  const mgr = mgrFor(discrete(), manifest());
  const seq = [3000, 4400]; // the before snapshot at the door; after at the true-up
  vi.spyOn(EngineManager.prototype, "poolUsedMb").mockImplementation(async () => (seq.length ? seq.shift() : 4400));
  vi.spyOn(EngineManager.prototype, "_recordSpeechLoad").mockImplementation((m, k, v, mb) => recorded.push(mb));
  await mgr.load("eng", { device: "auto" });
  expect(arb.reservationOf("tts:eng")).toEqual({ vram_mb: 1400, source: "computed", kind: "tts", pinned: false, asleep: false });
  expect(recorded).toEqual([]);
});

test("cpu_load_books_nothing_on_discrete", async () => {
  const arb = makeArbiter(discrete());
  const mgr = mgrFor(discrete(), manifest("eng", "tts", "cpu"));
  await mgr.load("eng", { device: "auto" });
  expect(arb.reservationOf("tts:eng")).toBeNull();
  expect(mgr.resolvedDeviceFor("eng")).toBe("cpu");
});

test("one_pool_books_whichever_device_resolves", async () => {
  // THE ONE-POOL RULING: CPU and GPU are the same physical bytes on a one-pool box.
  const arb = makeArbiter(onePool());
  const mgr = mgrFor(onePool(), manifest("eng", "tts", "cpu"));
  vi.spyOn(EngineManager.prototype, "_engineProcMb").mockResolvedValue(800);
  await mgr.load("eng", { device: "auto" });
  const row = arb.reservationOf("tts:eng");
  expect(row.vram_mb).toBe(800);
  expect(row.source).toBe("measured");
  expect(mgr.resolvedDeviceFor("eng")).toBe("cpu");
});

test("slot_replacement_releases_the_prior_booking", async () => {
  const arb = makeArbiter(discrete());
  const a = manifest("eng-a");
  const b = manifest("eng-b");
  const mgr = mgrFor(discrete(), a);
  mgr._manifests.set("eng-b", b);
  vi.spyOn(EngineManager.prototype, "_engineProcMb").mockResolvedValue(1200);
  await mgr.load("eng-a", { device: "auto" });
  expect(arb.reservationOf("tts:eng-a").vram_mb).toBe(1200);
  await mgr.load("eng-b", { device: "auto" });
  expect(arb.reservationOf("tts:eng-a")).toBeNull();
  expect(arb.reservationOf("tts:eng-b").vram_mb).toBe(1200);
});

// ─── the high-water bump (raise-only + occupant re-check + create) ────

test("high_water_bump_raises_and_never_lowers", async () => {
  const arb = makeArbiter(discrete());
  const recorded = [];
  const mgr = mgrFor(discrete(), manifest());
  vi.spyOn(EngineManager.prototype, "_engineProcMb").mockResolvedValue(2000);
  await mgr.load("eng", { device: "auto" }); // books measured 2000
  vi.spyOn(EngineManager.prototype, "_recordSpeechLoad").mockImplementation((m, k, v, mb) => recorded.push(mb));
  // Render peak observed above the booking → raised.
  vi.spyOn(EngineManager.prototype, "_engineProcMb").mockResolvedValue(4000);
  await mgr.bumpEngineReservation("tts");
  expect(arb.reservationOf("tts:eng").vram_mb).toBe(4000);
  expect(arb.reservationOf("tts:eng").source).toBe("measured");
  expect(recorded).toEqual([4000]);
  // A lower later probe never shrinks the high-water mark.
  vi.spyOn(EngineManager.prototype, "_engineProcMb").mockResolvedValue(900);
  await mgr.bumpEngineReservation("tts");
  expect(arb.reservationOf("tts:eng").vram_mb).toBe(4000);
  expect(recorded).toEqual([4000]);
});

test("bump_creates_the_booking_when_measurement_first_lands", async () => {
  // An engine that loaded "not measured yet" gets its booking CREATED by the first successful
  // post-work probe.
  const arb = makeArbiter(discrete());
  const mgr = mgrFor(discrete(), manifest());
  await mgr.load("eng", { device: "auto" }); // nothing measurable → no booking
  expect(arb.reservationOf("tts:eng")).toBeNull();
  vi.spyOn(EngineManager.prototype, "_engineProcMb").mockResolvedValue(1300);
  await mgr.bumpEngineReservation("tts");
  const row = arb.reservationOf("tts:eng");
  expect(row.vram_mb).toBe(1300);
  expect(row.source).toBe("measured");
});

test("bump_never_creates_a_booking_for_a_cpu_placed_engine", async () => {
  const arb = makeArbiter(discrete());
  const mgr = mgrFor(discrete(), manifest("eng", "tts", "cpu"));
  await mgr.load("eng", { device: "auto" });
  vi.spyOn(EngineManager.prototype, "_engineProcMb").mockResolvedValue(700);
  await mgr.bumpEngineReservation("tts");
  expect(arb.reservationOf("tts:eng")).toBeNull();
});

test("bump_skips_when_the_slot_swapped_mid_probe", async () => {
  // The probe runs unlocked — if the slot occupant changes meanwhile, no booking is written
  // for the departed engine.
  const arb = makeArbiter(discrete());
  const mgr = mgrFor(discrete(), manifest());
  vi.spyOn(EngineManager.prototype, "_engineProcMb").mockResolvedValue(1000);
  await mgr.load("eng", { device: "auto" });
  vi.spyOn(EngineManager.prototype, "_engineProcMb").mockImplementation(async function () {
    this._loaded.set("tts", new Proc({ id: "other", kind: "tts" }));
    return 5000;
  });
  await mgr.bumpEngineReservation("tts");
  expect(arb.reservationOf("tts:eng").vram_mb).toBe(1000);
});

// ─── admission (prior-measured only; honest refusal; the seam) ────────

test("admission_refuses_honestly_when_nothing_is_evictable", async () => {
  const arb = makeArbiter(discrete(8192));
  arb.reserve("llm:pinned-chat", 7000, { pinned: true, kind: "llm" });
  const mgr = mgrFor(discrete(8192), manifest());
  vi.spyOn(EngineManager.prototype, "_priceMb").mockReturnValue(4096);
  await expect(mgr.load("eng", { device: "auto" })).rejects.toThrow(/not enough memory/);
  // The world is exactly as it was: no slot occupant, no booking.
  expect(mgr._loaded.get("tts") ?? null).toBeNull();
  expect(arb.reservationOf("tts:eng")).toBeNull();
});

test("admission_evicts_the_idle_llm", async () => {
  const arb = makeArbiter(discrete(8192));
  const evicted = [];
  arb.reserve("chat", 7000, { kind: "llm", evictFn: () => evicted.push("chat") });
  const mgr = mgrFor(discrete(8192), manifest());
  vi.spyOn(EngineManager.prototype, "_priceMb").mockReturnValue(4096);
  await mgr.load("eng", { device: "auto" });
  expect(evicted).toEqual(["chat"]);
  expect(arb.reservationOf("chat")).toBeNull();
  expect(arb.reservationOf("tts:eng").vram_mb).toBe(4096);
  expect(arb.reservationOf("tts:eng").source).toBe("measured");
  // Q3's event feed recorded the swap for the toast poller.
  const events = arb.eventsSince(0);
  expect(events[0].victim_key).toBe("chat");
});

test("admission_never_evicts_a_busy_kind", async () => {
  const arb = makeArbiter(discrete(8192));
  arb.reserve("chat", 7000, { kind: "llm", evictFn: () => {} });
  arb.busyBegin("llm");
  const mgr = mgrFor(discrete(8192), manifest());
  vi.spyOn(EngineManager.prototype, "_priceMb").mockReturnValue(4096);
  await expect(mgr.load("eng", { device: "auto" })).rejects.toThrow(/busy: llm/);
  expect(arb.reservationOf("chat")).not.toBeNull();
  // The refusal fired BEFORE the early booking — nothing leaked.
  expect(arb.reservationOf("tts:eng")).toBeNull();
});

test("admission_on_measured_free_sees_foreign_usage", async () => {
  // The ledger says 8 GB free but the MEASURED pool says other apps hold 7 GB — refuse,
  // quoting the measured number.
  makeArbiter(discrete(8192));
  const mgr = mgrFor(discrete(8192), manifest());
  vi.spyOn(EngineManager.prototype, "_priceMb").mockReturnValue(4096);
  vi.spyOn(EngineManager.prototype, "poolUsedMb").mockResolvedValue(7000);
  await expect(mgr.load("eng", { device: "auto" })).rejects.toThrow(/free of 8192 MB \(measured, minus what is booked\)/);
  expect(mgr._loaded.get("tts") ?? null).toBeNull();
});

test("admission_on_measured_free_evicts_then_settles", async () => {
  // Short measured free + an idle victim: the ledger target is inflated by the unledgered
  // slice, the victim dies through the seam, the settle loop watches the measured number
  // recover, and the prior-measured booking stands after a post-load probe miss.
  const arb = makeArbiter(discrete(8192));
  const evicted = [];
  arb.reserve("chat", 6500, { kind: "llm", evictFn: () => evicted.push("chat") });
  const mgr = mgrFor(discrete(8192), manifest());
  // Probe sequence: admission sees 7000 used (6500 booked + 500 foreign); the settle re-probe
  // and everything after see 600 (chat drained).
  const seq = [7000, 600];
  vi.spyOn(EngineManager.prototype, "poolUsedMb").mockImplementation(async () => (seq.length ? seq.shift() : 600));
  vi.spyOn(EngineManager.prototype, "_priceMb").mockReturnValue(2000);
  await mgr.load("eng", { device: "auto" });
  expect(evicted).toEqual(["chat"]);
  expect(arb.reservationOf("tts:eng").vram_mb).toBe(2000);
});

test("evictor_terminates_only_the_matching_occupant", async () => {
  makeArbiter(discrete());
  const mgr = mgrFor(discrete(), manifest());
  await mgr.load("eng", { device: "auto" });
  const proc = mgr._loaded.get("tts");
  await mgr._evictForArbiter("tts", "someone-else");
  expect(proc.terminated).toBe(false);
  await mgr._evictForArbiter("tts", "eng");
  expect(proc.terminated).toBe(true);
  expect(mgr._loaded.get("tts") ?? null).toBeNull();
});

// ─── busy flags (step 4) ──────────────────────────────────────────────

test("scheduler_worker_marks_tts_busy_while_draining", async () => {
  const arb = makeArbiter(discrete());
  // The idle transition's high-water re-probe reaches the manager; a stand-in answers it.
  vi.spyOn(manager, "getManager").mockReturnValue({ bumpEngineReservation: async () => {} });
  const sched = new SynthScheduler();
  const seen = [];
  const gate = new AsyncEvent();
  const handle = sched.submit([
    [
      "eng",
      async () => {
        seen.push(arb.busyKinds());
        await gate.wait(5000);
        return "ok";
      },
    ],
  ]);
  for (let i = 0; i < 200 && !seen.length; i++) await sleep(10);
  expect(seen.length && seen[0].has("tts")).toBe(true);
  gate.set();
  expect(await handle.wait(5)).toBe(true);
  for (let i = 0; i < 200 && arb.busyKinds().has("tts"); i++) await sleep(10);
  expect(arb.busyKinds().has("tts")).toBe(false);
});
test.todo("vram_endpoint_serves_the_strip — waits for app.js + api/engines_api.js");

test("transcribe_marks_stt_busy", async () => {
  const arb = makeArbiter(discrete());
  const seen = [];
  const mgr = bareManager();
  mgr._loaded.set("stt", {
    manifest: { id: "asr", kind: "stt" },
    isAlive: () => true,
    post() {
      seen.push(arb.busyKinds());
      return { statusCode: 200, text: "", json: () => ({ text: "hi" }) };
    },
  });
  expect(await mgr.transcribe({ wav_b64: "" })).toBe("hi");
  expect(seen).toEqual([new Set(["stt"])]);
  expect(arb.busyKinds().has("stt")).toBe(false);
});

// ─── the speech door prices on BOTH truths (2026-08-15) ───────────────

function admissionMgr(arb, { priorMb, usedMb }) {
  const mgr = mgrFor(discrete(), manifest());
  vi.spyOn(EngineManager.prototype, "_priceMb").mockReturnValue(priorMb);
  vi.spyOn(EngineManager.prototype, "poolUsedMb").mockResolvedValue(usedMb);
  vi.spyOn(EngineManager, "_safetyMarginMb").mockReturnValue(1024);
  return mgr;
}

test("admission_counts_a_standing_booking_the_probe_cannot_see", async () => {
  // 6 GB booked, the card reporting 100 MB used (the allocation has not landed).
  const arb = makeArbiter(discrete());
  const evicted = [];
  arb.reserve("gemma", 6000, { kind: "llm", evictFn: () => evicted.push("gemma") });
  const mgr = admissionMgr(arb, { priorMb: 4400, usedMb: 100 });
  await mgr.load("eng", { device: "auto" });
  expect(evicted, "the booking must be honoured, not out-voted by a stale probe").toEqual(["gemma"]);
  expect(arb.reservationOf("gemma")).toBeNull();
  expect(arb.reservationOf("tts:eng").vram_mb).toBe(4400);
});

test("admission_treats_a_sleeping_booking_as_free_memory", async () => {
  // A child the router idle-unloaded holds nothing, so its booking must NOT block a speech
  // load.
  const arb = makeArbiter(discrete());
  const evicted = [];
  arb.reserve("gemma", 6000, { kind: "llm", evictFn: () => evicted.push("gemma") });
  arb.syncSleeping(new Set(["gemma"]));
  const mgr = admissionMgr(arb, { priorMb: 4400, usedMb: 100 });
  await mgr.load("eng", { device: "auto" });
  expect(evicted, "a sleeper holds no memory — evicting it frees nothing").toEqual([]);
  expect(arb.isAsleep("gemma"), "and it keeps its booking for the wake to claim").toBe(true);
  expect(arb.reservationOf("tts:eng").vram_mb).toBe(4400);
});

test("admission_still_prices_on_the_probe_when_the_probe_is_worse", async () => {
  // 3 GB held by programs we do not manage, nothing in our ledger, and a 4.4 GB engine no
  // longer fits.
  const arb = makeArbiter(discrete());
  const mgr = admissionMgr(arb, { priorMb: 4400, usedMb: 6000 });
  await expect(mgr.load("eng", { device: "auto" })).rejects.toThrow(/not enough memory/);
  expect(arb.reservationOf("tts:eng")).toBeNull();
});

// ─── the price: exactly this model's own peaks (audit 2026-10-04 §13.3) ────

test("the_price_is_this_models_own_peak_at_its_piece_length", () => {
  const flag = (split, build) => [
    { flagName: "split_chars", flagValue: String(split) },
    { flagName: "runtime", flagValue: build },
  ];
  const row = (model, mb, { source = "peak", machine = "box", backend = "cuda", split = 200, build = "dev · new" } = {}) => ({
    modelId: model,
    machineKey: machine,
    vramModelMb: mb,
    source,
    backend,
    switches: flag(split, build),
  });
  const rows = [
    row("tts:qwen3:qwen3-cv-0.6b-q8", 6249), // another variant
    row("tts:qwen3:qwen3-vd-1.7b-q8", 6000, { source: "load" }), // an old shared-process share
    row("tts:qwen3:qwen3-vd-1.7b-q8", 9000, { machine: "other" }), // another machine
    row("tts:qwen3:qwen3-vd-1.7b-q8", 5100, { backend: "vulkan" }), // another device
    row("tts:qwen3:qwen3-vd-1.7b-q8", 7100, { split: 800 }), // another piece length
    row("tts:qwen3:qwen3-vd-1.7b-q8", 6800, { build: "dev · old" }), // another runtime build
    row("tts:qwen3:qwen3-vd-1.7b-q8", 3900),
    row("tts:qwen3:qwen3-vd-1.7b-q8", 3500),
  ];
  vi.spyOn(stores, "getModelMeasurementStore").mockReturnValue({ list: (k) => rows.filter((r) => r.modelId === k) });
  vi.spyOn(hardware, "currentMachineKey").mockReturnValue("box");
  vi.spyOn(manager, "_runtimeBuild").mockReturnValue("dev · new");
  const mgr = Object.create(EngineManager.prototype);
  vi.spyOn(EngineManager.prototype, "effectiveSplit").mockReturnValue(200);
  expect(mgr._priceMb("tts", "qwen3", "qwen3-vd-1.7b-q8", "cuda")).toBe(3900);
  expect(mgr._priceMb("tts", "qwen3", "qwen3-cv-1.7b-q8", "cuda")).toBe(0); // never measured
  expect(mgr._priceMb("tts", "qwen3", "qwen3-vd-1.7b-q8", null)).toBe(0); // no card
  vi.spyOn(EngineManager.prototype, "effectiveSplit").mockReturnValue(800);
  expect(mgr._priceMb("tts", "qwen3", "qwen3-vd-1.7b-q8", "cuda")).toBe(7100);
});

// ─── refuse before changing anything (audit 2026-10-04 §13.3, §5 B2/B5) ───

test("a_refused_load_downloads_nothing_and_unloads_nothing", async () => {
  const arb = makeArbiter(discrete());
  const mgr = mgrFor(discrete(), manifest());
  const calls = [];
  vi.spyOn(EngineManager.prototype, "_priceMb").mockReturnValue(9000);
  vi.spyOn(EngineManager.prototype, "_ensureVariantLocal").mockImplementation(async () => calls.push("download"));
  vi.spyOn(EngineManager.prototype, "_unloadAiModel").mockImplementation(async () => calls.push("unload ai"));
  vi.spyOn(EngineManager.prototype, "placementFor").mockResolvedValue(["gpu", "test", true]);
  await expect(mgr.load("eng", { device: "auto" })).rejects.toThrow(/not enough memory/);
  expect(calls).toEqual([]);
  expect(arb.reservationOf("tts:eng")).toBeNull();
});

test("an_unpriced_load_fetches_first_and_unloads_the_ai_model_after", async () => {
  makeArbiter(discrete());
  const mgr = mgrFor(discrete(), manifest());
  const calls = [];
  vi.spyOn(EngineManager.prototype, "_ensureVariantLocal").mockImplementation(async () => {
    calls.push("download");
    return null;
  });
  vi.spyOn(EngineManager.prototype, "_unloadAiModel").mockImplementation(async () => calls.push("unload ai"));
  vi.spyOn(EngineManager.prototype, "placementFor").mockResolvedValue(["gpu", "test", true]);
  await mgr.load("eng", { device: "auto" });
  expect(calls).toEqual(["download", "unload ai"]);
});

test("a_variant_switch_is_checked_against_what_it_adds", async () => {
  const arb = makeArbiter(discrete());
  const mgr = mgrFor(discrete(), manifest());
  vi.spyOn(EngineManager.prototype, "_engineProcMb").mockResolvedValue(3000);
  await mgr.load("eng", { device: "auto", variant: "v1" });
  expect(arb.reservationOf("tts:eng").vram_mb).toBe(3000);
  const seen = {};
  vi.spyOn(EngineManager.prototype, "_admitMemory").mockImplementation(async (m, kind, engineId, neededMb, creditMb = 0) => {
    Object.assign(seen, { needed: neededMb, credit: creditMb });
  });
  vi.spyOn(EngineManager.prototype, "_priceMb").mockImplementation((k, e, v) => (v === "v2" ? 5000 : 0));
  await mgr.load("eng", { device: "auto", variant: "v2" });
  expect(seen).toEqual({ needed: 5000, credit: 3000 });
});

test("a_known_price_is_the_floor_and_a_higher_reading_is_recorded", async () => {
  const arb = makeArbiter(discrete());
  const mgr = mgrFor(discrete(), manifest());
  const recorded = [];
  vi.spyOn(EngineManager.prototype, "_recordSpeechLoad").mockImplementation((m, k, v, mb) => recorded.push(mb));
  vi.spyOn(EngineManager.prototype, "_priceMb").mockReturnValue(4000);
  vi.spyOn(EngineManager.prototype, "_engineProcMb").mockResolvedValue(3000);
  await mgr.load("eng", { device: "auto" });
  expect(arb.reservationOf("tts:eng").vram_mb).toBe(4000);
  expect(recorded).toEqual([]);
  await mgr.unload("tts");
  vi.spyOn(EngineManager.prototype, "_engineProcMb").mockResolvedValue(5000);
  await mgr.load("eng", { device: "auto" });
  expect(arb.reservationOf("tts:eng").vram_mb).toBe(5000);
  expect(recorded).toEqual([5000]);
});

test("admission_credits_what_the_replaced_occupant_gives_back", async () => {
  const arb = makeArbiter(discrete());
  const mgr = mgrFor(discrete(), manifest());
  vi.spyOn(EngineManager.prototype, "poolUsedMb").mockResolvedValue(4000);
  vi.spyOn(EngineManager, "_safetyMarginMb").mockReturnValue(1024);
  arb.reserve("tts:kokoro", 3000, { kind: "tts", evictFn: null, source: "measured" });
  await expect(mgr._admitMemory(manifest(), "tts", "eng", 4000)).rejects.toThrow(/not enough memory/);
  await mgr._admitMemory(manifest(), "tts", "eng", 4000, 3000); // admitted
});

test("unloading_the_ai_model_waits_for_its_memory_to_drain", async () => {
  const arb = makeArbiter(discrete());
  const mgr = mgrFor(discrete(), manifest());
  arb.reserve("llm:gemma", 6800, { kind: "llm", evictFn: () => {}, source: "measured" });
  const readings = [7300, 7300, 7300, 500, 500];
  const seen = [];
  vi.spyOn(EngineManager.prototype, "poolUsedMb").mockImplementation(async () => {
    const value = readings.length ? readings.shift() : 500;
    seen.push(value);
    return value;
  });
  vi.spyOn(manager, "_sleep").mockResolvedValue(undefined);
  await mgr._unloadAiModel("qwen3");
  expect(arb.reservationOf("llm:gemma")).toBeNull();
  expect(seen[seen.length - 1]).toBe(500);
  expect(seen.length).toBe(4); // it waited until the card showed it
});
