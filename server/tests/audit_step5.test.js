// SPDX-License-Identifier: MIT
// Audit 2026-10-04, step 5 (docs/plans/2026-10-04-audiocpp-switch-audit.md §13.5): the
// requests, gates, runtime errors, placement, installs, leaks and options batches. No binary,
// no GPU (the port of tests/test_audit_step5.py; parametrized tests loop over their cases).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as stores from "@delebash/llm-runner/llm/stores";
import * as http from "@delebash/llm-runner/platform/http";
import * as hardware from "@delebash/llm-runner/runner/hardware";
import { afterEach, expect, test, vi } from "vitest";
import * as captures from "../src/api/captures_api.js";
import { appClient, closeApps } from "./app_helpers.js";
import { discrete } from "./engines_helpers.js";
import { writeWavContainer } from "../src/audio/wav.js";
import * as release from "../src/engines/audiocpp/release.js";
import * as runtime from "../src/engines/audiocpp/runtime.js";
import { AudioCppError, AudioCppServer, responseOf } from "../src/engines/audiocpp/runtime.js";
import * as runtimeOptions from "../src/engines/audiocpp/runtime_options.js";
import * as slot from "../src/engines/audiocpp/slot.js";
import { toSpeechRequest } from "../src/engines/audiocpp/slot.js";
import { lookup } from "../src/engines/capability_details.js";
import { discoverEngines, EngineManager } from "../src/engines/manager.js";
import { construct, SpeechRuntimeSettings } from "../src/models.js";
import { _verifyLfsSha256 } from "../src/speech_cache.js";
import { _detectRuntimes } from "../src/system_info.js";
import { tmpPath } from "./helpers.js";

const row = (engine, variant) => discoverEngines().get(engine).module.VARIANTS.find((r) => r.id === variant);
const KEPT = slot.cfg.VOICE_PACKS_KEPT;
const ROTATE = runtime.cfg.LOG_ROTATE_BYTES;
afterEach(async () => {
  await closeApps();
  slot.cfg.VOICE_PACKS_KEPT = KEPT;
  runtime.cfg.LOG_ROTATE_BYTES = ROTATE;
  runtime.cfg.HW = null;
  captures.cfg._MAX_UPLOAD_MB = captures._MAX_UPLOAD_MB;
});

// ─── 5a: requests ────────────────────────────────────────────────────────────

test("no_seed_or_zero_sends_a_new_random_one", () => {
  // audio.cpp's own "no seed" repeats on Kokoro, Kitten, Turbo and VoxCPM2 (§5 D1).
  for (const seed of [null, 0, "0", ""]) {
    const seen = new Set();
    for (let i = 0; i < 8; i++) seen.add(toSpeechRequest(row("kokoro", "kokoro-82m-q8"), { voice_id: "af_heart", text: "Hi.", seed }).seed);
    expect(seen.size).toBeGreaterThan(1);
    for (const s of seen) {
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThan(2 ** 31);
    }
  }
});

test("a_set_seed_is_sent_as_it_is", () => {
  expect(toSpeechRequest(row("kokoro", "kokoro-82m-q8"), { voice_id: "af_heart", text: "Hi.", seed: 42 }).seed).toBe(42);
});

test("qwen3_gets_auto_for_a_language_it_does_not_speak", () => {
  for (const lang of ["xx", null]) {
    const req = toSpeechRequest(row("qwen3", "qwen3-cv-1.7b-q8"), { voice_id: "Ryan", text: "Hi.", language: lang });
    expect(req.language).toBe(lang ? "Auto" : "English");
  }
});

test("qwen3_sampling_is_floored_and_the_sub_talker_reaches_the_runtime", () => {
  const req = toSpeechRequest(row("qwen3", "qwen3-cv-1.7b-q8"), {
    voice_id: "Ryan",
    text: "Hi.",
    language: "en",
    delivery: { temperature: 0, engine: { talker_top_p: 0, subtalker_temperature: 0, subtalker_top_k: 20, subtalker_top_p: 0.8 } },
  });
  const o = req.options;
  expect(o.temperature).toBe(0.05);
  expect(o.top_p).toBe(0.05);
  expect(o.subtalker_temperature).toBe(0.05);
  expect(o.subtalker_top_k).toBe(20);
  expect(o.subtalker_top_p).toBe(0.8);
});

test("chatterbox_min_p_and_decoder_cfg_reach_the_runtime", () => {
  const knobs = Object.fromEntries(lookup("chatterbox-multilingual").knobs.map((k) => [k.key, k]));
  expect(knobs.min_p.default).toBe(0.05);
  expect(knobs.s3gen_cfg_rate.default).toBe(0.7);
  expect(knobs.repetition_penalty.default).toBe(1.2); // what it uses (§5 D3)
  const req = toSpeechRequest(row("chatterbox", "chatterbox-multilingual-v2-q8"), {
    voice_id: "c1",
    text: "Hi.",
    audio_prompt_path: "/v/ref.wav",
    delivery: { engine: { min_p: 0.1, s3gen_cfg_rate: 0.5 } },
  });
  expect(req.options).toEqual({ min_p: 0.1, s3gen_cfg_rate: 0.5 });
});

test("voxcpm2_runaway_settings_reach_the_runtime", () => {
  const keys = new Set(lookup("voxcpm2").knobs.map((k) => k.key));
  expect(keys.has("retry_badcase_max_times") && keys.has("retry_badcase_ratio_threshold")).toBe(true);
  const req = toSpeechRequest(row("voxcpm2", discoverEngines().get("voxcpm2").defaultVariantId), {
    voice_id: "v",
    text: "Hi.",
    audio_prompt_path: "/v/ref.wav",
    delivery: { engine: { retry_badcase_max_times: 0, retry_badcase_ratio_threshold: 4 } },
  });
  expect(req.options).toEqual({ retry_badcase_max_times: 1, retry_badcase_ratio_threshold: 4.0 });
});

test("every_sampling_knob_stops_short_of_zero", () => {
  for (const r of ["qwen3-cv", "chatterbox-multilingual", "chatterbox-turbo"]) {
    for (const k of lookup(r).knobs) {
      if (k.key.includes("temperature") || k.key.endsWith("top_p")) expect(k.min, `${r} ${k.key}`).toBeGreaterThanOrEqual(0.05);
    }
  }
});

test("a_transcription_gets_its_floor_or_three_times_its_length", () => {
  vi.spyOn(runtime, "requestTimeout").mockReturnValue(900.0);
  const tmp = tmpPath();
  const short = path.join(tmp, "s.wav");
  const long = path.join(tmp, "l.wav");
  writeFileSync(short, writeWavContainer(Buffer.alloc(8000 * 2 * 2), 8000, 1));
  writeFileSync(long, writeWavContainer(Buffer.alloc(8000 * 2 * 400), 8000, 1));
  expect(slot._transcribeTimeout(short)).toBe(900.0);
  expect(slot._transcribeTimeout(long)).toBe(1200.0);
  expect(slot._transcribeTimeout(path.join(tmp, "missing.wav"))).toBe(900.0);
});

// ─── 5b: gates ───────────────────────────────────────────────────────────────

test("a_refusal_offers_an_update_only_when_the_pin_has_the_feature", () => {
  vi.spyOn(release, "pinnedHas").mockReturnValue(true);
  expect(slot.featureRefusal("voice_pack")).toContain("needs the speech runtime update");
  vi.spyOn(release, "pinnedHas").mockReturnValue(false);
  const msg = slot.featureRefusal("voice_pack");
  expect(msg.startsWith("Blended voices — ")).toBe(true);
  expect(msg).toContain("isn't in this version");
  expect(msg).not.toContain("Update");
});

// ─── 5c: runtime errors ──────────────────────────────────────────────────────

test("a_bare_string_error_body_keeps_its_status", () => {
  const r = responseOf(503, Buffer.from(JSON.stringify({ error: "server_busy" })));
  let err;
  try {
    AudioCppServer._raiseFor(r);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(AudioCppError);
  expect(err.status).toBe(503);
  expect(err.message).toContain("server_busy");
});

test("a_timeout_is_a_503_that_names_the_limit", async () => {
  const srv = new AudioCppServer("gpu", "tts");
  vi.spyOn(srv, "_url").mockImplementation((p) => `http://127.0.0.1:1${p}`);
  vi.spyOn(http, "fetch").mockRejectedValue(new DOMException("slow", "TimeoutError"));
  const err = await srv.speech({ model: "m" }, 12).catch((e) => e);
  expect(err).toBeInstanceOf(AudioCppError);
  expect(err.status).toBe(503);
  expect(err.message).toContain("within 12 s");
});

test("the_request_and_start_limits_are_settings", () => {
  const s = construct(SpeechRuntimeSettings, {});
  expect([s.gpu_threads, s.start_timeout_s, s.request_timeout_s]).toEqual([4, 60.0, 900.0]);
  expect(runtime.gpuThreads()).toBe(4);
  expect(runtime.requestTimeout()).toBe(900.0);
});

// ─── 5d: placement ───────────────────────────────────────────────────────────

test("cpu_speed_is_the_best_of_the_newest_five_at_these_threads", () => {
  const r = (x, threads = "8") => ({
    modelId: "tts:kokoro:kokoro-82m-q8",
    machineKey: "box",
    source: "speed",
    backend: "cpu",
    realtimeX: x,
    switches: [{ flagName: "threads", flagValue: threads }],
  });
  const rows = [r(1.1), r(2.9), r(1.4), r(1.2), r(1.3), r(5.0), r(9.9, "4")];
  vi.spyOn(stores, "getModelMeasurementStore").mockReturnValue({ list: (mid) => rows.filter((x) => x.modelId === mid) });
  vi.spyOn(hardware, "currentMachineKey").mockReturnValue("box");
  vi.spyOn(runtime, "cpuThreads").mockReturnValue(8);
  // Newest first: the sixth reading (5.0) is past the five, the 4-thread one another setting.
  expect(new EngineManager().cpuSpeed("tts", "kokoro", "kokoro-82m-q8")).toEqual([2.9, true]);
});

test("the_16bit_cpu_rows_have_speeds_of_their_own", () => {
  expect(row("kokoro", "kokoro-82m-bf16").cpu_realtime).toBeGreaterThan(0);
  // The measured ones; German and Italian at 16 bits were not measured.
  const speeds = Object.fromEntries(
    discoverEngines()
      .get("pocket")
      .module.VARIANTS.filter((r) => r.id.endsWith("-bf16"))
      .map((r) => [r.id, r.cpu_realtime]),
  );
  for (const c of ["en", "es", "pt"]) expect(speeds[`pocket-${c}-bf16`]).toBeTruthy();
  expect(speeds["pocket-de-bf16"]).toBeFalsy();
  expect(speeds["pocket-it-bf16"]).toBeFalsy();
});

// ─── 5e: installs ────────────────────────────────────────────────────────────

test("every_pinned_archive_carries_its_checksum", () => {
  for (const b of release.binaries()) {
    expect(b.sha256, b.assetUrl).toBeTruthy();
    if (b.runtimeUrl) expect(b.runtimeSha256, b.runtimeUrl).toBeTruthy();
  }
  expect(release.binaries().filter((b) => b.gpu === "cpu").every((b) => b.assetUrl.includes("cpu-portable"))).toBe(true);
});

test("a_model_file_that_does_not_match_its_checksum_is_deleted", async () => {
  const f = path.join(tmpPath(), "m.gguf");
  writeFileSync(f, "model");
  await _verifyLfsSha256(f, createHash("sha256").update("model").digest("hex")); // matches: kept
  await _verifyLfsSha256(f, "a".repeat(40)); // a git blob id: not checked
  expect(existsSync(f)).toBe(true);
  await expect(_verifyLfsSha256(f, "0".repeat(64))).rejects.toThrow(/published checksum/);
  expect(existsSync(f)).toBe(false);
});

// ─── 5f: leaks ───────────────────────────────────────────────────────────────

test.todo("a_candidate_clip_is_reused_and_old_ones_are_cleared — waits for api/voice_preview_api.js");

test("voice_packs_are_touched_on_reuse_and_only_the_newest_kept", () => {
  const tmp = tmpPath();
  vi.spyOn(slot, "_dataDir").mockReturnValue(tmp);
  slot.cfg.VOICE_PACKS_KEPT = 3;
  const folder = path.join(tmp, "cache", "kokoro-voice-packs");
  mkdirSync(folder, { recursive: true });
  const now = Date.now() / 1000;
  for (let i = 0; i < 4; i++) {
    const p = path.join(folder, `old${i}.bin`);
    writeFileSync(p, "x");
    utimesSync(p, now - 1000 + i, now - 1000 + i);
  }
  const first = slot.writeVoicePack(new Array(256).fill(1.0));
  expect(existsSync(first)).toBe(true);
  expect(readdirSync(folder).filter((n) => n.endsWith(".bin")).sort()).toEqual([path.basename(first), "old2.bin", "old3.bin"].sort());
  utimesSync(first, now - 5000, now - 5000);
  expect(slot.writeVoicePack(new Array(256).fill(1.0))).toBe(first);
  expect(statSync(first).mtimeMs / 1000).toBeGreaterThan(Date.now() / 1000 - 60);
  expect(readdirSync(folder).filter((n) => n.endsWith(".tmp"))).toEqual([]);
});

test("the_log_rolls_over_past_ten_megabytes", () => {
  runtime.cfg.LOG_ROTATE_BYTES = 10;
  const tmp = tmpPath();
  const log = path.join(tmp, "audiocpp-server.log");
  writeFileSync(log, "short");
  runtime._rotateLog(log);
  expect(existsSync(log)).toBe(true);
  writeFileSync(log, "a long enough log");
  runtime._rotateLog(log);
  expect(existsSync(log)).toBe(false);
  expect(readFileSync(path.join(tmp, "audiocpp-server.1.log"), "utf8")).toBe("a long enough log");
});

test("the_log_tail_reads_only_the_end", () => {
  const log = path.join(tmpPath(), "x.log");
  writeFileSync(log, Array.from({ length: 50_000 }, (_, i) => `line ${i}`).join("\n"));
  const srv = new AudioCppServer("gpu", "tts");
  srv._run = { logPath: log };
  expect(srv.logTail(3).split("\n")).toEqual(["line 49997", "line 49998", "line 49999"]);
});

test("an_oversized_transcription_upload_leaves_no_file", async () => {
  // The spool (Python's tempfile.tempdir) is a folder of this test's own.
  const spool = tmpPath();
  vi.stubEnv("TEMP", spool);
  vi.stubEnv("TMP", spool);
  captures.cfg._MAX_UPLOAD_MB = 0;
  const { c } = await appClient(path.join(tmpPath(), "data"));
  const r = await c.post("/v1/transcribe", { files: { file: ["a.wav", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(64)]), "audio/wav"] } });
  expect(r.status).toBe(400);
  const wavs = readdirSync(spool, { recursive: true }).filter((n) => String(n).endsWith(".wav"));
  expect(wavs).toEqual([]);
});

test("system_info_reports_only_runtimes_this_app_can_use", () => {
  expect(_detectRuntimes({ cuda: true, vulkan: true })).toEqual({ cpu: true, cuda: true, vulkan: true });
  expect(_detectRuntimes(null)).toEqual({ cpu: true });
});

// ─── 5g: counts that follow the pin ──────────────────────────────────────────

test("kokoro_and_chatterbox_texts_count_what_is_offered", () => {
  const k = discoverEngines().get("kokoro").module;
  expect(k.DESCRIPTION).toContain(`${k.STATIC_VOICES.length} preset voices`);
  expect(k.VARIANTS[0].languages).toEqual([...new Set(k.STATIC_VOICES.map((v) => v.language))]);
  const cb = discoverEngines().get("chatterbox").module;
  const n = cb.VARIANTS[0].languages.length;
  expect(lookup("chatterbox-multilingual").notes[0].startsWith(`${n} languages`)).toBe(true);
});

// ─── 5h: runtime options ─────────────────────────────────────────────────────

test("flash_attention_is_offered_only_on_8bit_qwen3", () => {
  for (const r of discoverEngines().get("qwen3").module.VARIANTS) {
    const keys = runtimeOptions.offeredFor(r).map((o) => o.key);
    if (r.id.endsWith("-q8")) expect(keys, r.id).toEqual(["qwen3_tts.perf_mode", "qwen3_tts.conv_weight_type"]);
    else expect(keys, r.id).toEqual(["qwen3_tts.conv_weight_type"]);
  }
  expect(runtimeOptions.offeredFor(row("kokoro", "kokoro-82m-q8"))).toEqual([]);
});

test("runtime_options_are_validated_and_defaults_dropped", () => {
  const r = row("qwen3", "qwen3-cv-1.7b-q8");
  // 16-bit is the app's default (heard as no different, 2026-10-04): only 32-bit is saved.
  expect(runtimeOptions.validate(r, { "qwen3_tts.perf_mode": "off", "qwen3_tts.conv_weight_type": "f32" })).toEqual({
    "qwen3_tts.conv_weight_type": "f32",
  });
  expect(runtimeOptions.validate(r, { "qwen3_tts.conv_weight_type": "f16" })).toEqual({});
  expect(() => runtimeOptions.validate(r, { "qwen3_tts.perf_mode": "turbo" })).toThrow(/must be one of/);
  expect(() => runtimeOptions.validate(r, { "qwen3_tts.mem_saver": "true" })).toThrow(/no runtime option/);
});

test("saved_runtime_options_ride_the_models_registration", () => {
  const r = row("qwen3", "qwen3-cv-1.7b-q8");
  vi.spyOn(runtimeOptions, "savedFor").mockReturnValue({ "qwen3_tts.perf_mode": "flash_attention", "stale.key": "x" });
  vi.spyOn(slot, "_dataDir").mockReturnValue(tmpPath());
  const entry = slot._entriesFor(discoverEngines().get("qwen3"), r)[0];
  // 16-bit decoder weights ride by default — audio.cpp's own default is 32-bit.
  expect(Object.fromEntries(entry.sessionOptions)).toEqual({
    "qwen3_tts.perf_mode": "flash_attention",
    "qwen3_tts.conv_weight_type": "f16",
  });
  vi.spyOn(runtimeOptions, "savedFor").mockReturnValue({ "qwen3_tts.conv_weight_type": "f32" });
  expect(Object.fromEntries(slot._entriesFor(discoverEngines().get("qwen3"), r)[0].sessionOptions)).toEqual({});
});

test("the_model_row_reads_and_saves_its_runtime_options", async () => {
  const { c } = await appClient();
  const url = "/v1/engines/qwen3/models/qwen3-cv-1.7b-q8/runtime-options";
  let r = await c.put(url, { json: { options: { "qwen3_tts.perf_mode": "flash_attention" } } });
  expect(r.status).toBe(200);
  expect(r.json().reload).toBe(false);
  const v = (await c.get("/v1/engines/qwen3/models")).json().variants.find((x) => x.id === "qwen3-cv-1.7b-q8");
  expect(Object.fromEntries(v.runtime_options.map((o) => [o.key, o.value]))).toEqual({
    "qwen3_tts.perf_mode": "flash_attention",
    "qwen3_tts.conv_weight_type": "f16",
  });
  let ov = (await c.get("/v1/settings")).json().engines.engine_overrides.qwen3;
  expect(ov.runtime_options).toEqual({ "qwen3-cv-1.7b-q8": { "qwen3_tts.perf_mode": "flash_attention" } });
  expect((await c.put(url, { json: { options: { "qwen3_tts.perf_mode": "x" } } })).status).toBe(400);
  r = await c.put(url, { json: { options: { "qwen3_tts.perf_mode": "off" } } });
  ov = (await c.get("/v1/settings")).json().engines.engine_overrides.qwen3;
  expect(ov.runtime_options).toEqual({});
});

test("the_runtime_row_keeps_a_setting_it_does_not_send", async () => {
  runtime.cfg.HW = discrete();
  vi.spyOn(runtime, "installedExe").mockReturnValue(null);
  const { c } = await appClient();
  expect((await c.put("/v1/speech-runtime", { json: { backend: "auto", request_timeout_s: 1800 } })).status).toBe(200);
  expect((await c.put("/v1/speech-runtime", { json: { backend: "vulkan", gpu: 0 } })).status).toBe(200);
  const sr = (await c.get("/v1/settings")).json().engines.speech_runtime;
  expect(sr.backend).toBe("vulkan");
  expect(sr.request_timeout_s).toBe(1800);
  expect((await c.put("/v1/speech-runtime", { json: { backend: "vulkan", gpu_threads: 0 } })).status).toBe(400);
});
