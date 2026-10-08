// SPDX-License-Identifier: MIT
// CPU placement (decided 2026-10-02 — docs/plans/2026-10-02-cpu-placement.md §8). Every speech
// model runs on the graphics card or the CPU. These pin the rule (a CPU build runs everything
// on the CPU; the user's choice wins; Auto takes the card when nothing else is on it or the
// model's MEASURED size fits beside the AI model, else the CPU when it is fast enough there,
// else the card with the AI model unloaded first), the load door, KittenTTS and Pocket TTS
// requests and the Kyutai terms gate, and the runtime processes (the port of
// tests/test_cpu_placement.py).
import * as stores from "@delebash/llm-runner/llm/stores";
import * as hardware from "@delebash/llm-runner/runner/hardware";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { discrete, makeArbiter, resetArbiter, wav } from "./engines_helpers.js";
import * as runtime from "../src/engines/audiocpp/runtime.js";
import * as slot from "../src/engines/audiocpp/slot.js";
import * as manager from "../src/engines/manager.js";
import { _wavSeconds, discoverEngines, EngineManager, TermsRequired } from "../src/engines/manager.js";
import { construct, SpeechRuntimeSettings } from "../src/models.js";
import { appClient, closeApps } from "./app_helpers.js";
import { tmpPath } from "./helpers.js";

let arb;
beforeEach(() => {
  arb = makeArbiter(discrete());
});
afterEach(async () => {
  await closeApps();
  resetArbiter();
});

function mgrFor(build = "cuda12") {
  const exe = `C:/rt/audiocpp/v0.9.0/${build}/audiocpp_server.exe`;
  vi.spyOn(runtime, "installedExe").mockReturnValue(exe);
  vi.spyOn(EngineManager.prototype, "poolUsedMb").mockResolvedValue(null);
  // A load fetches a missing model file into the app's speech cache — never from a test.
  vi.spyOn(EngineManager.prototype, "_ensureVariantLocal").mockResolvedValue(null);
  const mgr = new EngineManager();
  mgr._hwCache = discrete();
  mgr._hwDetected = true;
  return mgr;
}

const aiOnCard = (mb = 6800) => arb.reserve("llm:gemma", mb, { kind: "llm", evictFn: () => {}, source: "measured" });

// ─── the rule ───────────────────────────────────────────────────────────────

test("a_cpu_build_runs_everything_on_the_cpu", async () => {
  const mgr = mgrFor("cpu");
  const [where, why, unload] = await mgr.placementFor(mgr.getManifest("chatterbox"), "tts", "chatterbox-multilingual-v2-q8");
  expect([where, unload]).toEqual(["cpu", false]);
  expect(why).toContain("CPU build");
});

test("auto_takes_the_card_when_nothing_else_is_on_it", async () => {
  const mgr = mgrFor();
  expect((await mgr.placementFor(mgr.getManifest("kokoro"), "tts", "kokoro-82m-q8"))[0]).toBe("gpu");
});

test("auto_keeps_a_fast_model_off_the_card_beside_the_ai_model", async () => {
  // Kokoro was never measured on this card, and it is fast on the CPU: CPU.
  const mgr = mgrFor();
  aiOnCard();
  const [where, why, unload] = await mgr.placementFor(mgr.getManifest("kokoro"), "tts", "kokoro-82m-q8");
  expect([where, unload]).toEqual(["cpu", false]);
  expect(why).toContain("3.1× real time on the reference machine");
  expect(why).toContain("AI model");
});

test("a_measured_size_that_fits_stays_on_the_card", async () => {
  const mgr = mgrFor();
  aiOnCard(5000);
  vi.spyOn(EngineManager.prototype, "_priceMb").mockReturnValue(600);
  const [where, why, unload] = await mgr.placementFor(mgr.getManifest("kokoro"), "tts", "kokoro-82m-q8");
  expect([where, unload]).toEqual(["gpu", false]);
  expect(why).toContain("fits beside the AI model (600 MB)");
});

test("a_never_measured_slow_model_unloads_the_ai_model", async () => {
  // Decision 1: an unknown size does not fit while the AI model is on the card, and Chatterbox
  // has no usable CPU speed — the card, with the AI model unloaded first.
  const mgr = mgrFor();
  aiOnCard();
  const [where, why, unload] = await mgr.placementFor(mgr.getManifest("chatterbox"), "tts", "chatterbox-multilingual-v2-q8");
  expect([where, unload]).toEqual(["gpu", true]);
  expect(why).toContain("AI model makes room");
});

test("a_measured_size_that_does_not_fit_goes_through_admission", async () => {
  // Known size, too big beside the AI model, slow on the CPU: the card — and the normal
  // admission does the eviction, not a blanket unload.
  const mgr = mgrFor();
  aiOnCard();
  vi.spyOn(EngineManager.prototype, "_priceMb").mockReturnValue(3200);
  const [where, , unload] = await mgr.placementFor(mgr.getManifest("chatterbox"), "tts", "chatterbox-multilingual-v2-q8");
  expect([where, unload]).toEqual(["gpu", false]);
});

test("a_sleeping_ai_model_is_not_on_the_card", async () => {
  const mgr = mgrFor();
  aiOnCard();
  arb.syncSleeping(new Set(["llm:gemma"]));
  expect((await mgr.placementFor(mgr.getManifest("kokoro"), "tts", "kokoro-82m-q8"))[0]).toBe("gpu");
});

test("the_users_choice_wins", async () => {
  const mgr = mgrFor();
  aiOnCard();
  vi.spyOn(EngineManager, "_userPlacement").mockReturnValue("cpu");
  const [where, why] = await mgr.placementFor(mgr.getManifest("chatterbox"), "tts", "chatterbox-multilingual-v2-q8");
  expect(where).toBe("cpu");
  expect(why.startsWith("your choice")).toBe(true);
  vi.spyOn(EngineManager, "_userPlacement").mockReturnValue("gpu");
  expect((await mgr.placementFor(mgr.getManifest("kokoro"), "tts", "kokoro-82m-q8")).slice(0, 2)).toEqual(["gpu", "your choice"]);
});

test("cpu_speed_reads_this_machine_before_the_reference", () => {
  const mgr = mgrFor();
  const rows = [];
  vi.spyOn(stores, "getModelMeasurementStore").mockReturnValue({ list: (mid) => rows.filter((r) => r.modelId === mid) });
  vi.spyOn(hardware, "currentMachineKey").mockReturnValue("box");
  expect(mgr.cpuSpeed("tts", "kokoro", "kokoro-82m-q8")).toEqual([3.15, false]);
  vi.spyOn(runtime, "cpuThreads").mockReturnValue(8);
  rows.push({
    modelId: "tts:kokoro:kokoro-82m-q8",
    machineKey: "box",
    source: "speed",
    backend: "cpu",
    realtimeX: 2.4,
    switches: [{ flagName: "threads", flagValue: "8" }],
  });
  expect(mgr.cpuSpeed("tts", "kokoro", "kokoro-82m-q8")).toEqual([2.4, true]);
  // Another machine's number is not this one's.
  rows[0].machineKey = "other";
  expect(mgr.cpuSpeed("tts", "kokoro", "kokoro-82m-q8")).toEqual([3.15, false]);
  expect(mgr.cpuSpeed("tts", "chatterbox", "chatterbox-multilingual-v2-q8")).toEqual([null, false]);
});

// ─── the load door ──────────────────────────────────────────────────────────

const resp = (status = 200, content = Buffer.alloc(0), payload = null) => ({
  statusCode: status,
  content,
  headers: { "content-type": "audio/wav" },
  text: JSON.stringify(payload || {}),
  json: () => payload || {},
});

const made = [];
class Slot {
  constructor(manifest, placement = "gpu") {
    this.manifest = manifest;
    this.placement = placement;
    this.terminated = false;
    this.speedRecorded = false;
    this.synthReply = resp(200, wav(3.0));
    this.proc = null;
    made.push(this);
  }
  spawn() {}
  isAlive() {
    return !this.terminated;
  }
  terminate() {
    this.terminated = true;
  }
  get() {
    return resp(200, Buffer.alloc(0), { voices: [] });
  }
  post(p, json = null) {
    if (p === "/synth") return this.synthReply;
    return resp(200, Buffer.alloc(0), { ok: true, variant: (json || {}).variant });
  }
}

function loadable(where, unload = false) {
  made.length = 0;
  vi.spyOn(manager, "_newSlot").mockImplementation((m, p) => new Slot(m, p));
  vi.spyOn(EngineManager.prototype, "placementFor").mockResolvedValue([where, `why ${where}`, unload]);
  const calls = [];
  vi.spyOn(EngineManager.prototype, "_unloadAiModel").mockImplementation(async (eid) => calls.push(eid));
  return calls;
}

test("the_load_puts_the_slot_where_the_rule_says", async () => {
  const mgr = mgrFor();
  loadable("cpu");
  await mgr.load("kokoro");
  expect(made[made.length - 1].placement).toBe("cpu");
  expect(mgr.resolvedDeviceFor("kokoro")).toBe("cpu");
  expect(mgr.placementReasonFor("kokoro")).toBe("why cpu");
  // A CPU-placed model books nothing on a discrete card.
  expect(arb.reservedMb("tts:kokoro")).toBeNull();
});

test("the_third_step_unloads_the_ai_model_before_the_load", async () => {
  const mgr = mgrFor();
  const calls = loadable("gpu", true);
  await mgr.load("chatterbox");
  expect(calls).toEqual(["chatterbox"]);
  expect(made[made.length - 1].placement).toBe("gpu");
});

test("the_unload_goes_through_make_room_and_spares_speech", async () => {
  // The blanket unload is the kit's makeRoom — so the eviction event names who made room for
  // whom — and a speech model is never its victim.
  const mgr = mgrFor();
  aiOnCard();
  const gone = [];
  arb.reserve("stt:asr", 2400, { kind: "stt", evictFn: () => gone.push("asr"), source: "measured" });
  arb.reserve("llm:qwen", 3000, { kind: "llm", evictFn: () => gone.push("qwen"), source: "measured" });
  await mgr._unloadAiModel("chatterbox");
  expect(new Set(gone)).toEqual(new Set(["qwen"]));
  expect(arb.reservedMb("llm:gemma")).toBeNull();
  expect(arb.reservedMb("stt:asr")).toBe(2400);
  expect(arb.eventsSince(0).some((e) => e.reason === "loading chatterbox")).toBe(true);
});

test("a_loaded_model_moves_when_its_place_changes", async () => {
  const mgr = mgrFor();
  loadable("gpu");
  await mgr.load("kokoro");
  const first = made[made.length - 1];
  loadable("cpu");
  await mgr.load("kokoro");
  expect(first.terminated).toBe(true);
  expect(made[made.length - 1].placement).toBe("cpu");
  // Same place again: nothing moves.
  await mgr.load("kokoro");
  expect(made.length).toBe(1);
});

test("the_first_cpu_line_after_a_load_records_its_speed_once", async () => {
  const mgr = mgrFor();
  loadable("cpu");
  const recorded = [];
  vi.spyOn(stores, "getModelMeasurementStore").mockReturnValue({ record: (mid, kw) => recorded.push([mid, kw]), list: () => [] });
  vi.spyOn(hardware, "currentMachineKey").mockReturnValue("box");
  await mgr.load("kokoro");
  await mgr.synth("kokoro", { text: "A line." });
  await mgr.synth("kokoro", { text: "Another." });
  expect(recorded.length).toBe(1);
  const [mid, kw] = recorded[0];
  expect(mid).toBe("tts:kokoro:kokoro-82m-q8");
  expect(kw.backend).toBe("cpu");
  expect(kw.source).toBe("speed");
  expect(kw.realtimeX).toBeGreaterThan(0);
  expect(kw.machineKey).toBe("box");
});

test("a_gpu_line_records_no_cpu_speed", async () => {
  const mgr = mgrFor();
  loadable("gpu");
  const recorded = [];
  vi.spyOn(stores, "getModelMeasurementStore").mockReturnValue({ record: (mid) => recorded.push(mid), list: () => [] });
  await mgr.load("kokoro");
  await mgr.synth("kokoro", { text: "A line." });
  expect(recorded).toEqual([]);
});

test("a_terms_refusal_reaches_the_caller_as_terms_required", async () => {
  const mgr = mgrFor();
  loadable("cpu");
  await mgr.load("pocket");
  made[made.length - 1].synthReply = resp(403, Buffer.alloc(0), { detail: "accept Kyutai's terms", code: "terms_required", engine: "pocket" });
  const err = await mgr.synth("pocket", { text: "Hi.", audio_prompt_path: "/v/ref.wav" }).catch((e) => e);
  expect(err).toBeInstanceOf(TermsRequired);
  const api = err.apiError();
  expect(api.statusCode).toBe(403);
  expect(api.slug).toBe("terms-required");
  expect(api.extra).toEqual({ engine: "pocket" });
});

test("wav_seconds_reads_any_sample_format", () => {
  expect(_wavSeconds(wav(2.0))).toBeCloseTo(2.0, 6);
  // A 32-bit float WAV (format 3) — the duration still reads.
  const data = Buffer.alloc(16000 * 4);
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(3, 0);
  fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(16000, 4);
  fmt.writeUInt32LE(16000 * 4, 8);
  fmt.writeUInt16LE(4, 12);
  fmt.writeUInt16LE(32, 14);
  const u32 = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
  };
  const raw = Buffer.concat([
    Buffer.from("RIFF"),
    u32(4 + 8 + fmt.length + 8 + data.length),
    Buffer.from("WAVEfmt "),
    u32(fmt.length),
    fmt,
    Buffer.from("data"),
    u32(data.length),
    data,
  ]);
  expect(_wavSeconds(raw)).toBeCloseTo(1.0, 6);
  expect(_wavSeconds(Buffer.from("not a wav"))).toBeNull();
});

// ─── KittenTTS and Pocket TTS requests ──────────────────────────────────────

const row = (engine, variant) => discoverEngines().get(engine).module.VARIANTS.find((r) => r.id === variant);

test("kitten_takes_its_own_voice_name_and_speed", () => {
  const req = slot.toSpeechRequest(row("kitten", "kitten-mini-0.8"), { text: "Hi.", voice_id: "kitten_bella", delivery: { speed: 1.2 } });
  expect([req.voice, req.speed, req.model]).toEqual(["Bella", 1.2, "kitten-mini-0.8"]);
});

test("pocket_speaks_a_preset_or_clones_from_the_clip", () => {
  const r = row("pocket", "pocket-en-q8");
  expect(slot.toSpeechRequest(r, { text: "Hi.", voice_id: "pocket_bill_boerst" }).voice).toBe("bill_boerst");
  const req = slot.toSpeechRequest(r, { text: "Hi.", audio_prompt_path: "C:\\v\\ref.wav", seed: 3 });
  expect(req.voice_ref).toBe("C:/v/ref.wav");
  expect("voice" in req).toBe(false);
  expect(req.seed).toBe(3);
});

test("pocket_refuses_a_line_in_another_language_by_name", () => {
  const r = row("pocket", "pocket-en-q8");
  expect(() => slot.toSpeechRequest(r, { text: "Hallo.", voice_id: "pocket_alba", language: "de-DE" })).toThrow(
    /speaks English.*German.*load the German Pocket TTS model/,
  );
  // Its own language, any region, is fine.
  expect(slot.toSpeechRequest(r, { text: "Hi.", voice_id: "pocket_alba", language: "en-GB" })).toBeTruthy();
});

test("pocket_offers_only_the_presets_licensed_for_commercial_use", () => {
  const voices = new Set(discoverEngines().get("pocket").staticVoices.map((v) => v.id));
  expect(voices.size).toBe(20);
  for (const v of ["pocket_cosette", "pocket_jean", "pocket_giovanni", "pocket_lola", "pocket_juergen", "pocket_rafael"]) {
    expect(voices.has(v)).toBe(false);
  }
  for (const r of discoverEngines().get("pocket").module.VARIANTS) {
    const files = r.sources[0].files;
    expect(files.length).toBe(21);
    expect(files[0].endsWith(".gguf")).toBe(true);
  }
});

test("every_new_voice_id_is_unique_across_engines", () => {
  const seen = new Map();
  for (const [eid, m] of discoverEngines()) {
    for (const v of m.staticVoices) {
      expect(seen.has(v.id), `${v.id} is both ${seen.get(v.id)} and ${eid}`).toBe(false);
      seen.set(v.id, eid);
    }
  }
});

function pocketSlot(accepted) {
  const srv = {
    calls: [],
    async speech(req) {
      srv.calls.push(req);
      return [wav(1.0), {}];
    },
  };
  vi.spyOn(runtime, "getServer").mockReturnValue(srv);
  vi.spyOn(slot, "termsAccepted").mockReturnValue(accepted);
  vi.spyOn(slot.AudioCppSlot.prototype, "isAlive").mockReturnValue(true);
  const s = Object.create(slot.AudioCppSlot.prototype);
  s.manifest = discoverEngines().get("pocket");
  s.placement = "cpu";
  s.kind = "tts";
  s._row = row("pocket", "pocket-en-q8");
  return [s, srv];
}

test("a_pocket_clone_waits_for_kyutais_terms", async () => {
  const [s, srv] = pocketSlot(false);
  const r = await s._synth({ text: "Hi.", audio_prompt_path: "/v/ref.wav" });
  expect(r.statusCode).toBe(403);
  expect(r.json().code).toBe("terms_required");
  expect(srv.calls).toEqual([]);
  expect(r.json().detail).toContain("Kyutai");
  // A preset needs no terms.
  expect((await s._synth({ text: "Hi.", voice_id: "pocket_alba" })).statusCode).toBe(200);
});

test("an_accepted_pocket_clone_renders", async () => {
  const [s, srv] = pocketSlot(true);
  expect((await s._synth({ text: "Hi.", audio_prompt_path: "/v/ref.wav" })).statusCode).toBe(200);
  expect(srv.calls[0].voice_ref).toBe("/v/ref.wav");
});

// ─── the two processes ──────────────────────────────────────────────────────

test("each_placement_and_kind_has_its_own_process_files", () => {
  // Speech and speech recognition each get a process per placement (audit §13.2); the speech
  // processes keep the names they always had.
  const gpu = runtime.getServer("gpu");
  const cpu = runtime.getServer("cpu");
  const gpuStt = runtime.getServer("gpu", "stt");
  const cpuStt = runtime.getServer("cpu", "stt");
  expect(new Set([gpu, cpu, gpuStt, cpuStt]).size).toBe(4);
  expect(runtime.getServer("cpu")).toBe(cpu);
  expect(runtime.getServer("gpu", "stt")).toBe(gpuStt);
  expect(gpu._fileStem()).toBe("audiocpp-server");
  expect(cpu._fileStem()).toBe("audiocpp-server-cpu");
  expect(gpuStt._fileStem()).toBe("audiocpp-server-stt");
  expect(cpuStt._fileStem()).toBe("audiocpp-server-cpu-stt");
  expect(() => runtime.getServer("npu")).toThrow();
  expect(() => runtime.getServer("gpu", "llm")).toThrow();
});

test("cpu_threads_default_to_the_physical_cores", () => {
  vi.spyOn(runtime, "physicalCores").mockReturnValue(8);
  vi.spyOn(runtime, "_settings").mockReturnValue(construct(SpeechRuntimeSettings, {}));
  expect(runtime.cpuThreads()).toBe(8);
  vi.spyOn(runtime, "_settings").mockReturnValue(construct(SpeechRuntimeSettings, { cpu_threads: 6 }));
  expect(runtime.cpuThreads()).toBe(6);
});

test("the_cpu_process_runs_the_same_build_on_the_cpu", async () => {
  // ensureServer("cpu") hands the installed build `backend: cpu` and the thread setting.
  const seen = {};
  const exe = "C:/rt/audiocpp/v0.9.0/cuda12/audiocpp_server.exe";
  vi.spyOn(runtime, "installedExe").mockReturnValue(exe);
  vi.spyOn(runtime, "getServer").mockReturnValue({
    async ensure(e, models, kw) {
      Object.assign(seen, kw, { exe: e, models });
    },
  });
  vi.spyOn(slot, "installedEntries").mockImplementation((kind) => [`${kind}-models`]);
  vi.spyOn(slot, "managedRuntime").mockReturnValue(false);
  vi.spyOn(slot, "_dataDir").mockReturnValue(tmpPath());
  vi.spyOn(runtime, "cpuThreads").mockReturnValue(8);
  await slot.ensureServer("cpu");
  expect([seen.backend, seen.threads, seen.exe]).toEqual(["cpu", 8, exe]);
  // A build that can't register models lists its kind's own; one that can lists none.
  expect(seen.models).toEqual(["tts-models"]);
  expect(seen.managed).toBe(false);
  vi.spyOn(slot, "managedRuntime").mockReturnValue(true);
  await slot.ensureServer("cpu", "stt");
  expect(seen.models).toEqual([]);
  expect(seen.managed).toBe(true);
});

// ─── the API ────────────────────────────────────────────────────────────────

async function placementClient() {
  vi.spyOn(EngineManager.prototype, "_aiModelOnCard").mockResolvedValue(false);
  return (await appClient()).c;
}

test("the_models_say_where_they_run", async () => {
  const c = await placementClient();
  const rows = Object.fromEntries((await c.get("/v1/engines/kokoro/models")).json().variants.map((v) => [v.id, v]));
  const k = rows["kokoro-82m-q8"];
  expect(k.placement).toBe("auto");
  expect(["gpu", "cpu"]).toContain(k.runs_on);
  expect(k.runs_on_reason).toBeTruthy();
  expect(k.cpu_realtime).toBe(3.15);
  expect(k.cpu_realtime_here).toBe(false);
});

test("a_models_place_is_saved_and_auto_clears_it", async () => {
  const c = await placementClient();
  const r = await c.put("/v1/engines/kokoro/models/kokoro-82m-q8/placement", { json: { placement: "cpu" } });
  expect(r.status).toBe(200);
  expect(r.json().runs_on).toBe("cpu");
  expect(r.json().moves).toBe(false);
  let ov = (await c.get("/v1/settings")).json().engines.engine_overrides.kokoro;
  expect(ov.placements).toEqual({ "kokoro-82m-q8": "cpu" });
  await c.put("/v1/engines/kokoro/models/kokoro-82m-q8/placement", { json: { placement: "auto" } });
  ov = (await c.get("/v1/settings")).json().engines.engine_overrides.kokoro;
  expect(ov.placements).toEqual({});
  expect((await c.put("/v1/engines/kokoro/models/nope/placement", { json: { placement: "cpu" } })).status).toBe(404);
  expect((await c.put("/v1/engines/kokoro/models/kokoro-82m-q8/placement", { json: { placement: "npu" } })).status).toBe(422);
});

test("pocket_shows_its_terms_until_accepted", async () => {
  const c = await placementClient();
  const engine = async (id) => (await c.get("/v1/engines")).json().engines.find((e) => e.id === id);
  let eng = await engine("pocket");
  expect(eng.terms.owner).toBe("Kyutai");
  expect(eng.terms.gates).toBe("cloning");
  expect(eng.terms.text).toContain("voice impersonation or cloning without explicit and lawful consent");
  expect(eng.terms_accepted).toBe(false);
  const r = await c.post("/v1/engines/pocket/terms");
  expect(r.status).toBe(200);
  expect(r.json().accepted).toBe(true);
  expect(r.json().at).toBeTruthy();
  eng = await engine("pocket");
  expect(eng.terms_accepted).toBe(true);
  // An engine without terms has nothing to accept.
  expect((await c.post("/v1/engines/kokoro/terms")).status).toBe(400);
  expect((await engine("kokoro")).terms).toBeNull();
});
