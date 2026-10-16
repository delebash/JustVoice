// SPDX-License-Identifier: MIT
// CPU placement (decided 2026-10-02 — docs/plans/2026-10-02-cpu-placement.md §8). Every speech
// model runs on the graphics card or the CPU. These pin the rule (a CPU build runs everything
// on the CPU; the user's choice wins; Auto takes the card when the model fits in its free memory or the
// model's MEASURED size fits beside the AI model, else the CPU when it is fast enough there,
// else the card with the AI model unloaded first), the load door, KittenTTS and Pocket TTS
// requests and the Kyutai terms gate, and the runtime processes (the port of
// tests/test_cpu_placement.py).
import os from "node:os";
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

test("auto_runs_a_generated_model_too_big_for_the_card_on_the_cpu", async () => {
  // audio.cpp says MOSS-TTS v1.5 needs about 18 GB, and its 12 GB of files don't fit an 8 GB
  // card either (decided 2026-10-11, answer 4).
  const mgr = mgrFor();
  const [where, why] = await mgr.placementFor(mgr.getManifest("moss_tts_v15"), "tts", "moss_tts_v15-q8");
  expect(where).toBe("cpu");
  expect(why).toBe("audio.cpp says it needs about 18 GB, more than this card's 8 GB — this may be slow on the CPU");
  // Once a line on the CPU measured it, the speed takes the warning's place.
  vi.spyOn(EngineManager.prototype, "cpuSpeed").mockReturnValueOnce([0.06, true]);
  expect((await mgr.placementFor(mgr.getManifest("moss_tts_v15"), "tts", "moss_tts_v15-q8"))[1]).toBe("audio.cpp says it needs about 18 GB, more than this card's 8 GB — 0.1× real time here");
  // Once a load measured it here, the measurement decides, not the estimate.
  vi.spyOn(EngineManager.prototype, "_priceMb").mockReturnValue(3000);
  expect((await mgr.placementFor(mgr.getManifest("moss_tts_v15"), "tts", "moss_tts_v15-q8"))[0]).toBe("gpu");
});

test("auto_tries_the_card_first_when_the_files_fit_it_easily", async () => {
  // decided 2026-10-12: OmniVoice's 1.3 GB of files took 1.2 GB of an 8 GB card against
  // audio.cpp's 10 GB, and ran 27× slower on the CPU.
  const mgr = mgrFor();
  const want =
    "audio.cpp says it needs about 10 GB, but its files are about 1.3 GB, so it tries the graphics card first; if it doesn't fit, Load runs it on the CPU";
  expect(await mgr.placementFor(mgr.getManifest("omnivoice"), "tts", "omnivoice-q8")).toEqual(["gpu", want, false]);
  // Beside the AI model it is Auto's third step: the AI model makes room.
  aiOnCard();
  expect(await mgr.placementFor(mgr.getManifest("omnivoice"), "tts", "omnivoice-q8")).toEqual(["gpu", want, true]);
});

test("auto_says_the_card_first_words_for_an_estimate_that_fits_the_card_only_without_the_margin", async () => {
  // Decided 2026-10-16 (TASKS "Slice 5's findings: what each one gets" 3): Qwen3-TTS Base 1.7B —
  // audio.cpp's 8 GB, the whole of an 8 GB card — said nothing after "Loads on the graphics card".
  // Its 2.5 GB of files fit with the margin: the card-first words. Where it goes is unchanged.
  const mgr = mgrFor();
  const base = () => mgr.placementFor(mgr.getManifest("qwen3"), "tts", "qwen3-base-1.7b-q8");
  const want =
    "audio.cpp says it needs about 8 GB, but its files are about 2.5 GB, so it tries the graphics card first; if it doesn't fit, Load runs it on the CPU";
  expect(await base()).toEqual(["gpu", want, false]);
  // What other programs hold doesn't move it: its estimate stays the size weighed, as before.
  vi.spyOn(EngineManager.prototype, "poolUsedMb").mockResolvedValue(6500);
  expect(await base()).toEqual(["gpu", want, false]);
  // Beside the AI model it is Auto's third step, as before: the AI model makes room.
  aiOnCard();
  expect(await base()).toEqual(["gpu", want, true]);
});

test("a_card_that_failed_or_a_price_it_cannot_hold_sends_the_model_to_the_cpu", async () => {
  const mgr = mgrFor();
  const want = "it didn't load on the graphics card — this may be slow on the CPU";
  // This click's try failed.
  expect(await mgr.placementFor(mgr.getManifest("omnivoice"), "tts", "omnivoice-q8", { cardFailed: true })).toEqual(["cpu", want, false]);
  // A failure remembered here.
  const failed = vi.spyOn(EngineManager.prototype, "_failedOnCard").mockReturnValue(true);
  expect(await mgr.placementFor(mgr.getManifest("omnivoice"), "tts", "omnivoice-q8")).toEqual(["cpu", want, false]);
  failed.mockReturnValue(false);
  // A price measured here that, with the margin, is more than the card: the CPU, not a refusal,
  // saying what it took (decided 2026-10-13) and the margin it was held to.
  vi.spyOn(EngineManager.prototype, "_priceMb").mockReturnValue(7500);
  expect(await mgr.placementFor(mgr.getManifest("chatterbox"), "tts", "chatterbox-multilingual-v2-q8")).toEqual([
    "cpu",
    "it took about 7.3 GB on this card before, more than it holds with the 1 GB safety margin — this may be slow on the CPU",
    false,
  ]);
  // The user's pin still wins.
  vi.spyOn(EngineManager, "_userPlacement").mockReturnValue("gpu");
  expect((await mgr.placementFor(mgr.getManifest("chatterbox"), "tts", "chatterbox-multilingual-v2-q8"))[0]).toBe("gpu");
});

test("a_remembered_card_failure_lasts_until_a_card_load_measures_the_model", () => {
  const mgr = mgrFor();
  const rows = [];
  vi.spyOn(stores, "getModelMeasurementStore").mockReturnValue({ list: (mid) => rows.filter((r) => r.modelId === mid) });
  vi.spyOn(hardware, "currentMachineKey").mockReturnValue("box");
  vi.spyOn(manager, "_runtimeBuild").mockReturnValue("v0.9.0-jv.5");
  const row = (source, at, build = "v0.9.0-jv.5", backend = "cuda") => ({
    modelId: "tts:omnivoice:omnivoice-q8",
    machineKey: "box",
    source,
    at,
    backend,
    switches: [{ flagName: "runtime", flagValue: build }],
  });
  const failed = () => mgr._failedOnCard("tts", "omnivoice", "omnivoice-q8");
  expect(failed()).toBe(false);
  rows.push(row("no_card", 100));
  expect(failed()).toBe(true);
  // Another runtime build tries the card again.
  rows[0] = row("no_card", 100, "v0.9.0-jv.6");
  expect(failed()).toBe(false);
  rows[0] = row("no_card", 100);
  // A later load measured on the CPU doesn't clear it; one measured on the card (a pin) does.
  rows.push(row("peak", 200, undefined, "cpu"));
  expect(failed()).toBe(true);
  rows.push(row("peak", 300));
  expect(failed()).toBe(false);
});

test("try_the_card_again_forgets_only_the_remembered_failure", () => {
  // The narrowings review, M8: the model's no_card rows go; its price and CPU speed stay.
  const mgr = mgrFor();
  const clear = vi.fn(() => 2);
  vi.spyOn(stores, "getModelMeasurementStore").mockReturnValue({ clear });
  expect(mgr.forgetCardFailure("tts", "omnivoice", "omnivoice-q8")).toBe(2);
  expect(clear).toHaveBeenCalledWith("tts:omnivoice:omnivoice-q8", "no_card");
});

test("auto_goes_by_the_files_when_they_are_more_than_the_estimate_or_there_is_none", async () => {
  // MOSS-TTSD's 12 GB has no estimate; MOSS-TTS Local's 16-bit weights are 12 GB against an
  // estimate of 8 (decided 2026-10-12): the files decide, and the reason says so.
  const mgr = mgrFor();
  for (const [engine, variant] of [["moss_ttsd", "moss_ttsd-q8"], ["moss_tts_local", "moss_tts_local-bf16"]]) {
    const [where, why] = await mgr.placementFor(mgr.getManifest(engine), "tts", variant);
    expect(where, variant).toBe("cpu");
    expect(why, variant).toBe("its files are about 12 GB, more than this card's 8 GB — this may be slow on the CPU");
  }
  // Its q8 weights (7 GB) are under its estimate: the estimate decides, and fits.
  expect((await mgr.placementFor(mgr.getManifest("moss_tts_local"), "tts", "moss_tts_local-q8"))[0]).toBe("gpu");
});

test("a_cpu_load_needs_its_files_and_the_margin_in_free_memory", async () => {
  // decided 2026-10-12 (4a): OmniVoice's 1.3 GB of files and the 1 GB margin against what's free.
  const mgr = mgrFor();
  const m = mgr.getManifest("omnivoice");
  vi.spyOn(os, "totalmem").mockReturnValue(32 * 1024 ** 3);
  vi.spyOn(os, "freemem").mockReturnValue(1.5 * 1024 ** 3);
  await expect(mgr._admitSystemMemory(m, "tts", "omnivoice-q8")).rejects.toThrow(
    "its files are about 1.3 GB (+1024 MB safety margin) but only 1.5 GB of this machine's 32 GB is free. Close other programs",
  );
  aiOnCard();
  await expect(mgr._admitSystemMemory(m, "tts", "omnivoice-q8")).rejects.toThrow("The AI model (gemma) is loaded and holds memory too");
  // Short even with the AI models' memory credited: the words say what is free now, and don't
  // name the AI model, whose memory was already counted.
  await expect(mgr._admitSystemMemory(m, "tts", "omnivoice-q8", "cpu", 200)).rejects.toThrow(
    "but only 1.5 GB of this machine's 32 GB is free. Close other programs, or pick a smaller model.",
  );
  vi.spyOn(os, "freemem").mockReturnValue(4 * 1024 ** 3);
  await expect(mgr._admitSystemMemory(m, "tts", "omnivoice-q8")).resolves.toBeUndefined();
});

test("any_load_needs_the_memory_it_took_at_its_last_loads", async () => {
  // decided 2026-10-12 (4b): MOSS-TTS Local took 5.7 GB of this machine's memory on the card.
  const mgr = mgrFor();
  const m = mgr.getManifest("moss_tts_local");
  vi.spyOn(os, "totalmem").mockReturnValue(32 * 1024 ** 3);
  vi.spyOn(os, "freemem").mockReturnValue(6 * 1024 ** 3);
  // Never recorded on the card: nothing to check there yet.
  await expect(mgr._admitSystemMemory(m, "tts", "moss_tts_local-q8", "cuda")).resolves.toBeUndefined();
  vi.spyOn(EngineManager.prototype, "_ramPriceMb").mockImplementation((kind, id, variant, device) => (device === "cuda" ? 5800 : 0));
  await expect(mgr._admitSystemMemory(m, "tts", "moss_tts_local-q8", "cuda")).rejects.toThrow(
    "not enough memory to load MOSS-TTS-Local on the graphics card: it took about 5.7 GB of this machine's memory when it last loaded here (+1024 MB safety margin) but only 6 GB of this machine's 32 GB is free.",
  );
  vi.spyOn(os, "freemem").mockReturnValue(8 * 1024 ** 3);
  await expect(mgr._admitSystemMemory(m, "tts", "moss_tts_local-q8", "cuda")).resolves.toBeUndefined();
});

test("auto_tries_the_card_for_chatterbox_whose_estimate_is_more_than_the_card", async () => {
  // audio.cpp lists Chatterbox Multilingual at 12 GB; it runs on an 8 GB card, measured. Its files
  // fit the card, so the card is tried first (the build's answer 3, decided 2026-10-15: the seven
  // engines described by our own files get audio.cpp's estimate as every model does).
  const mgr = mgrFor();
  expect((await mgr.placementFor(mgr.getManifest("chatterbox"), "tts", "chatterbox-multilingual-v2-q8"))[0]).toBe("gpu");
});

test("auto_takes_the_card_when_nothing_else_is_on_it", async () => {
  // Never measured on this card: weighed by audio.cpp's estimate (Kokoro's 1 GB) — the build's
  // answer 3 (decided 2026-10-15): the seven engines described by our own files get it as every
  // model does (was: no size, so the card, claiming no fit). With no reading of the card, the card,
  // saying so ("memory not measured yet" — the same answer 3); beside other programs, it fits the
  // card's free memory.
  const mgr = mgrFor();
  expect(await mgr.placementFor(mgr.getManifest("kokoro"), "tts", "kokoro-82m-q8")).toEqual(["gpu", "memory not measured yet", false]);
  vi.spyOn(EngineManager.prototype, "poolUsedMb").mockResolvedValue(6000);
  expect(await mgr.placementFor(mgr.getManifest("kokoro"), "tts", "kokoro-82m-q8")).toEqual(["gpu", "it fits in the card's free memory", false]);
});

test("auto_weighs_a_never_measured_model_by_what_audiocpp_says_it_needs", async () => {
  // Decided 2026-10-15: placement and the card agree — a model audio.cpp describes is weighed by
  // its need (Irodori v3: about 4 GB) beside what other programs hold.
  const mgr = mgrFor();
  const used = vi.spyOn(EngineManager.prototype, "poolUsedMb").mockResolvedValue(600);
  const irodori = () => mgr.placementFor(mgr.getManifest("irodori_tts"), "tts", "irodori_tts-irodorittsv3500m-q8");
  expect(await irodori()).toEqual(["gpu", "it fits in the card's free memory", false]);
  // Its estimate doesn't fit beside them but its files do: the card first, at its files, as the
  // too-big rule does (2026-10-15 — Kitten TTS 2's 7 GB estimate with the margin is the whole
  // 8 GB card, so any other use sent its 3.1 GB to the CPU).
  used.mockResolvedValue(4000);
  expect(await irodori()).toEqual([
    "gpu",
    "audio.cpp says it needs about 4 GB, but its files are about 1 GB, so it tries the graphics card first; if it doesn't fit, Load runs it on the CPU",
    false,
  ]);
  const kitten2 = () => mgr.placementFor(mgr.getManifest("kitten_tts2"), "tts", "kitten_tts2-q8");
  used.mockResolvedValue(600);
  expect((await kitten2())[1]).toBe(
    "audio.cpp says it needs about 7 GB, but its files are about 3.1 GB, so it tries the graphics card first; if it doesn't fit, Load runs it on the CPU",
  );
  // Its files don't fit beside them either: the CPU.
  used.mockResolvedValue(6500);
  expect(await irodori()).toEqual([
    "cpu",
    "other programs are using about 6.3 GB of the graphics card — this may be slow on the CPU",
    false,
  ]);
  // Tried on the card by its files when only the estimate is too big (OmniVoice's 1.3 GB).
  const omnivoice = () => mgr.placementFor(mgr.getManifest("omnivoice"), "tts", "omnivoice-q8");
  used.mockResolvedValue(4000);
  expect((await omnivoice())[0]).toBe("gpu");
  used.mockResolvedValue(6500);
  expect((await omnivoice())[1]).toBe("other programs are using about 6.3 GB of the graphics card — this may be slow on the CPU");
});

test("auto_checks_what_other_programs_hold_on_the_card_first", async () => {
  // Decided 2026-10-15: another program held 6,490 of the card's 8,192 MB, Auto still picked the
  // card ("nothing else is on the graphics card") and the card's admission refused VoxCPM2.
  const mgr = mgrFor();
  vi.spyOn(EngineManager.prototype, "_priceMb").mockReturnValue(2937);
  const used = vi.spyOn(EngineManager.prototype, "poolUsedMb");
  const chatterbox = () => mgr.placementFor(mgr.getManifest("chatterbox"), "tts", "chatterbox-multilingual-v2-q8");
  // It fits beside them, with the safety margin: the card.
  used.mockResolvedValue(600);
  expect(await chatterbox()).toEqual(["gpu", "it fits in the card's free memory", false]);
  // It doesn't: the CPU, saying what they hold.
  used.mockResolvedValue(6490);
  expect(await chatterbox()).toEqual([
    "cpu",
    "other programs are using about 6.3 GB of the graphics card — this may be slow on the CPU",
    false,
  ]);
  // A measured speed on the CPU takes the warning's place, as on Auto's other moves there.
  vi.spyOn(EngineManager.prototype, "cpuSpeed").mockReturnValue([0.4, true]);
  expect((await chatterbox())[1]).toBe("other programs are using about 6.3 GB of the graphics card — 0.4× real time here");
  // The AI model's booking is not another program's: it can be unloaded to make room.
  aiOnCard(5000);
  used.mockResolvedValue(5600);
  expect((await chatterbox())[0]).toBe("gpu");
  // The user's pin to the GPU still wins.
  used.mockResolvedValue(6490);
  vi.spyOn(EngineManager, "_userPlacement").mockReturnValue("gpu");
  expect(await chatterbox()).toEqual(["gpu", "your choice", false]);
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
  // Why, in the words every model audio.cpp says is too big for the card gets: its files fit, so
  // the card is tried first (the build's answer 3, decided 2026-10-15; was "… so the AI model makes
  // room").
  expect(why).toContain("tries the graphics card first");
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

test("a_load_records_the_system_memory_its_process_holds", async () => {
  // decided 2026-10-12 (4b; the review's #4): the slot's own process, read by the kit's
  // per-process probe once the load is done — a "ram_peak" row beside the card's peaks.
  const mgr = mgrFor();
  loadable("cpu");
  vi.spyOn(EngineManager.prototype, "_slotRamMb").mockResolvedValue(1340);
  const recorded = [];
  vi.spyOn(EngineManager.prototype, "_recordSpeechRam").mockImplementation((m, kind, variant, mb, device) => recorded.push([m.id, kind, mb, device]));
  await mgr.load("kokoro");
  expect(recorded).toEqual([["kokoro", "tts", 1340, "cpu"]]);
});

test("a_line_raises_the_memory_record_only_above_the_loads_highest", async () => {
  // The after-line reading, raise-only, in the card re-check's pass (the review, 2026-10-12).
  const mgr = mgrFor();
  loadable("cpu");
  const read = vi.spyOn(EngineManager.prototype, "_slotRamMb").mockResolvedValue(900);
  const recorded = [];
  vi.spyOn(EngineManager.prototype, "_recordSpeechRam").mockImplementation((m, kind, variant, mb) => recorded.push(mb));
  await mgr.load("kokoro");
  read.mockResolvedValue(1200);
  await mgr.bumpEngineReservation("tts");
  read.mockResolvedValue(1100);
  await mgr.bumpEngineReservation("tts");
  expect(recorded).toEqual([900, 1200]);
});

test("a_card_load_credits_the_ai_models_memory_then_checks_exactly_before_the_slot_starts", async () => {
  // The review's #1 (2026-10-12): the RAM check ran before the card's own admission, which
  // pushes the AI model off for a measured model that doesn't fit beside it. Now the AI models'
  // memory is credited first, and the check runs again without it right before the slot starts.
  const mgr = mgrFor();
  loadable("gpu");
  aiOnCard();
  vi.spyOn(os, "totalmem").mockReturnValue(32 * 1024 ** 3);
  vi.spyOn(EngineManager.prototype, "_ramPriceMb").mockImplementation((kind, id, variant, device) => (device !== "cpu" ? 5800 : 0));
  vi.spyOn(EngineManager.prototype, "_aiModelsRamMb").mockResolvedValue(17000);
  // 6 GB free while the AI model is loaded; 23 GB once it has made room.
  const free = vi.spyOn(os, "freemem").mockReturnValueOnce(6 * 1024 ** 3).mockReturnValue(23 * 1024 ** 3);
  await mgr.load("moss_tts_local");
  expect(made[made.length - 1].placement).toBe("gpu");
  expect(free).toHaveBeenCalledTimes(2);
  // Nothing made room: the exact check refuses, naming the AI model.
  await mgr.unload("tts");
  free.mockReturnValue(6 * 1024 ** 3);
  await expect(mgr.load("moss_tts_local")).rejects.toThrow("The AI model (gemma) is loaded and holds memory too");
});

class FailOnCard extends Slot {
  post(p, json = null) {
    if (p === "/load" && this.placement === "gpu") return resp(500, Buffer.alloc(0), { detail: "out of memory" });
    return super.post(p, json);
  }
}

function cardFirst(SlotClass = Slot) {
  made.length = 0;
  vi.spyOn(manager, "_newSlot").mockImplementation((m, p) => new SlotClass(m, p));
  vi.spyOn(os, "freemem").mockReturnValue(16 * 1024 ** 3);
  const recorded = [];
  vi.spyOn(EngineManager.prototype, "_recordCardFailure").mockImplementation((m, kind, variant, how) => recorded.push([m.id, variant, how]));
  return recorded;
}

test("a_failed_card_load_under_auto_retries_on_the_cpu_and_is_remembered", async () => {
  // decided 2026-10-12: the same click retries on the CPU; the failure is remembered once the
  // CPU took it.
  const mgr = mgrFor();
  const recorded = cardFirst(FailOnCard);
  await mgr.load("omnivoice", { variant: "omnivoice-q8" });
  expect(made.map((s) => s.placement)).toEqual(["gpu", "cpu"]);
  expect(made[0].terminated).toBe(true);
  expect(mgr.resolvedDeviceFor("omnivoice")).toBe("cpu");
  expect(mgr.placementReasonFor("omnivoice")).toBe("it didn't load on the graphics card — this may be slow on the CPU");
  expect(recorded).toEqual([["omnivoice", "omnivoice-q8", "failed"]]);
});

test("a_card_load_that_spills_into_system_memory_retries_on_the_cpu", async () => {
  // NVIDIA's Windows driver can put what the card has no room for in system memory instead of
  // failing: the process's shared GPU memory grows past spill_mb (256) — a failed card load too.
  const mgr = mgrFor();
  const recorded = cardFirst();
  const shared = vi.spyOn(EngineManager.prototype, "_slotSharedMb").mockResolvedValueOnce(78).mockResolvedValueOnce(2126);
  await mgr.load("omnivoice", { variant: "omnivoice-q8" });
  expect(made.map((s) => s.placement)).toEqual(["gpu", "cpu"]);
  expect(recorded).toEqual([["omnivoice", "omnivoice-q8", "spilled"]]);
  // What fits leaves it as it was: it stays on the card.
  await mgr.unload("tts");
  made.length = 0;
  shared.mockResolvedValue(78);
  await mgr.load("omnivoice", { variant: "omnivoice-q8" });
  expect(made.map((s) => s.placement)).toEqual(["gpu"]);
  expect(recorded).toHaveLength(1);
});

test("a_pinned_card_load_that_fails_is_not_moved", async () => {
  // The user chose the card: a failure there is reported, not moved to the CPU.
  const mgr = mgrFor();
  const recorded = cardFirst(FailOnCard);
  vi.spyOn(EngineManager, "_userPlacement").mockReturnValue("gpu");
  await expect(mgr.load("omnivoice", { variant: "omnivoice-q8" })).rejects.toThrow("engine load failed");
  expect(made.map((s) => s.placement)).toEqual(["gpu"]);
  expect(recorded).toEqual([]);
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
  // Speed rows only: a load also records the memory it took (4b).
  vi.spyOn(stores, "getModelMeasurementStore").mockReturnValue({ record: (mid, kw) => kw.source === "speed" && recorded.push([mid, kw]), list: () => [], pruneLoadRows: () => 0 });
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
  vi.spyOn(stores, "getModelMeasurementStore").mockReturnValue({ record: (mid, kw) => kw.source === "speed" && recorded.push(mid), list: () => [], pruneLoadRows: () => 0 });
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
    // French clones only: its package's own cosette comes with it, never offered (TASKS "Slice 4's gaps" 2).
    expect(files.length, r.id).toBe(r.id.startsWith("pocket-fr-") ? 2 : 21);
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
  // A reason where one was checked; none for a model never measured on an unread card (2026-10-15).
  expect(typeof k.runs_on_reason).toBe("string");
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

test("a_remembered_card_failure_shows_on_its_row_until_try_the_card_again", async () => {
  // The narrowings review, M8: the row knows, and DELETE …/card-failure forgets it.
  const c = await placementClient();
  const mgr = manager.getManager();
  const row = async () => (await c.get("/v1/engines/kokoro/models")).json().variants.find((v) => v.id === "kokoro-82m-q8");
  expect((await row()).failed_on_card).toBe(false);
  mgr._recordCardFailure(mgr.getManifest("kokoro"), "tts", "kokoro-82m-q8", "spilled");
  expect((await row()).failed_on_card).toBe(true);
  const r = await c.delete("/v1/engines/kokoro/models/kokoro-82m-q8/card-failure");
  expect(r.status).toBe(200);
  expect(r.json().forgotten).toBe(1);
  expect((await row()).failed_on_card).toBe(false);
  expect((await c.delete("/v1/engines/kokoro/models/nope/card-failure")).status).toBe(404);
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

test("an_unload_answers_once_the_card_shows_the_memory_freed", async () => {
  // Slice 2's acceptance (2026-10-15): ZipVoice, loaded straight after an unload, read the
  // draining memory as other programs' and went to the CPU. The unload now waits (up to 6 s) for
  // the card's reading to drop by most of what the model held.
  const mgr = mgrFor();
  const terminate = vi.fn();
  mgr._loaded.set("tts", { manifest: { id: "zipvoice", kind: "tts" }, isAlive: () => true, terminate });
  arb.reserve("tts:zipvoice", 3000, { kind: "tts", evictFn: () => {}, source: "measured" });
  const readings = [6000, 5800, 4200, 3100];
  const used = vi.spyOn(EngineManager.prototype, "poolUsedMb").mockImplementation(async () => readings.shift() ?? 3100);
  const sleeps = vi.spyOn(manager, "_sleep").mockResolvedValue(undefined);
  expect(await mgr.unload("tts")).toEqual({ previous_engine: "zipvoice" });
  expect(terminate).toHaveBeenCalled();
  expect(arb.isReserved("tts:zipvoice")).toBe(false);
  // Read before, then until it dropped by 80 % of the 3,000 MB it held.
  expect(used).toHaveBeenCalledTimes(4);
  expect(sleeps).toHaveBeenCalledTimes(2);
});

test("an_empty_unload_frees_a_recogniser_loaded_alone", async () => {
  // POST /v1/engines/unload {} unloads every loaded engine (its own comment); with only a
  // recogniser loaded it unloaded nothing (2026-10-15).
  const { c } = await appClient();
  const mgr = manager.getManager();
  const terminate = vi.fn();
  mgr._loaded.set("stt", { manifest: { id: "asr", kind: "stt" }, isAlive: () => true, terminate });
  const r = await c.post("/v1/engines/unload", {});
  expect(r.status).toBe(200);
  expect(r.json().previous_engine).toBe("asr");
  expect(terminate).toHaveBeenCalled();
  expect(mgr._loaded.has("stt")).toBe(false);
});
