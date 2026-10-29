// SPDX-License-Identifier: MIT
// Audit 2026-10-04, step 5 (docs/plans/2026-10-04-audiocpp-switch-audit.md §13.5): the
// requests, gates, runtime limits, leaks and options batches. No binary, no GPU (the port of
// tests/test_audit_step5.py; parametrized tests loop over their cases). Since round E
// (docs/plans/2026-10-29-round-e-onto-the-kit.md) the kit's audio.cpp runtime runs the servers —
// their errors and time-outs, their logs, where a model runs and its CPU speed, the pinned
// archives and the downloads' checksums are the kit's, tested there; the limits are the kit's
// runtime settings (kit_settings.js), the saved load options ride every load through our hook
// (kit_hooks.js `sessionOptions`), and what stays here is ours.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stores } from "@delebash/core/llm";
import { afterEach, expect, test, vi } from "vitest";
import * as captures from "../src/api/captures_api.js";
import * as voicePreview from "../src/api/voice_preview_api.js";
import { appClient, closeApps } from "./app_helpers.js";
import { endState, useState } from "./engines_helpers.js";
import { writeWavContainer } from "../src/audio/wav.js";
import * as vmod from "../src/voice_model.js";
import * as hooks from "../src/engines/audiocpp/kit_hooks.js";
import { runtimeModelRows } from "../src/engines/audiocpp/kit_models.js";
import * as kitSettings from "../src/engines/audiocpp/kit_settings.js";
import * as runtimeOptions from "../src/engines/audiocpp/runtime_options.js";
import * as slot from "../src/engines/audiocpp/slot.js";
import { toSpeechRequest } from "../src/engines/audiocpp/slot.js";
import { lookup } from "../src/engines/capability_details.js";
import { discoverEngines } from "../src/engines/model_catalog.js";
import { _detectRuntimes } from "../src/system_info.js";
import { tmpPath } from "./helpers.js";

const row = (engine, variant) => discoverEngines().get(engine).module.VARIANTS.find((r) => r.id === variant);
const KEPT = slot.cfg.VOICE_PACKS_KEPT;
afterEach(async () => {
  await closeApps();
  endState();
  slot.cfg.VOICE_PACKS_KEPT = KEPT;
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
  vi.spyOn(kitSettings, "runtimeNumber").mockReturnValue(900.0);
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
  // The build the app ships (kit_settings.js `shippedHas`) — what the kit's Update installs.
  vi.spyOn(kitSettings, "shippedHas").mockReturnValue(true);
  expect(slot.featureRefusal("voice_pack")).toContain("needs the speech runtime update");
  vi.mocked(kitSettings.shippedHas).mockReturnValue(false);
  const msg = slot.featureRefusal("voice_pack");
  expect(msg.startsWith("Blended voices — ")).toBe(true);
  expect(msg).toContain("isn't in this version");
  expect(msg).not.toContain("Update");
});

// ─── 5c: runtime limits ──────────────────────────────────────────────────────

test("the_request_and_start_limits_are_settings", () => {
  // The kit's audio.cpp runtime's settings (`<name>:audiocpp`), each at the kit's default until
  // one is saved; a limit that isn't a positive number reads as the default.
  useState();
  const limits = () => ["gpu_threads", "start_timeout_s", "request_timeout_s"].map((n) => kitSettings.runtimeNumber(n));
  expect(limits()).toEqual([4, 60.0, 900.0]);
  stores.getRunnerConfigStore().setSetting("request_timeout_s:audiocpp", "1800");
  expect(limits()).toEqual([4, 60.0, 1800]);
  stores.getRunnerConfigStore().setSetting("request_timeout_s:audiocpp", "0");
  expect(kitSettings.runtimeNumber("request_timeout_s")).toBe(900.0);
});

// ─── 5d: CPU speeds in the catalog ───────────────────────────────────────────

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

// ─── 5f: leaks ───────────────────────────────────────────────────────────────

test("a_candidate_clip_is_reused_and_old_ones_are_cleared", () => {
  // Python patched tempfile.gettempdir; Node's os.tmpdir() reads the environment.
  const tmp = tmpPath();
  vi.stubEnv("TEMP", tmp);
  vi.stubEnv("TMP", tmp);
  vi.stubEnv("TMPDIR", tmp);
  const old = path.join(tmp, "justvoice-candidate-clips", "old.wav");
  mkdirSync(path.dirname(old));
  writeFileSync(old, "x");
  const then = Date.now() / 1000 - 7200;
  utimesSync(old, then, then);
  const a = voicePreview._candidateClip(Buffer.from("RIFF-one"));
  expect(voicePreview._candidateClip(Buffer.from("RIFF-one"))).toBe(a);
  expect(readFileSync(a).toString("latin1")).toBe("RIFF-one");
  expect(existsSync(old)).toBe(false);
});

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

test("flash_attention_is_offered_on_every_qwen3_row", () => {
  // Every load option the spec lists is offered since the adoption plan's E4 (was: these two
  // alone). audio.cpp takes flash attention on any weights since upstream's v0.9.3 merge (our
  // fork's dacb0d7f), so every row offers it, with audio.cpp's three presets. (was: on Q8_0 rows
  // only, which audio.cpp alone accepted — until then.)
  for (const r of discoverEngines().get("qwen3").module.VARIANTS) {
    const offered = runtimeOptions.offeredFor(r);
    const perf = offered.find((o) => o.key === "qwen3_tts.perf_mode");
    expect(perf, r.id).toBeTruthy();
    expect(perf.choices.map(([c]) => c), r.id).toEqual(["off", "flash_attention", "cuda_perf"]);
    expect(perf.hint, r.id).not.toMatch(/8-bit|Q8/);
    // It sets more than attention now: "Speed mode", audio.cpp's cuda_perf in our words (decided 2026-10-29).
    expect(perf.label, r.id).toBe("Speed mode");
    expect(perf.choices, r.id).toEqual([["off", "Exact"], ["flash_attention", "Flash attention"], ["cuda_perf", "All speed-ups (CUDA)"]]);
    expect(perf.hint, r.id).toContain("Flash attention: about 9 % faster");
    expect(perf.hint, r.id).toContain("All speed-ups (CUDA): flash attention plus audio.cpp's other CUDA speed-ups — not measured here yet; it can change the take and the memory.");
    expect(offered.map((o) => o.key), r.id).toContain("qwen3_tts.conv_weight_type");
  }
});

test("runtime_options_are_validated_and_defaults_dropped", () => {
  const r = row("qwen3", "qwen3-cv-1.7b-q8");
  // 16-bit is the app's default (heard as no different, 2026-10-04): only 32-bit is saved.
  expect(runtimeOptions.validate(r, { "qwen3_tts.perf_mode": "off", "qwen3_tts.conv_weight_type": "f32" })).toEqual({
    "qwen3_tts.conv_weight_type": "f32",
  });
  expect(runtimeOptions.validate(r, { "qwen3_tts.conv_weight_type": "f16" })).toEqual({});
  expect(() => runtimeOptions.validate(r, { "qwen3_tts.perf_mode": "turbo" })).toThrow(/must be one of/);
  expect(() => runtimeOptions.validate(r, { "qwen3_tts.not_an_option": "true" })).toThrow(/no runtime option/);
});

test("saved_runtime_options_ride_the_models_registration", () => {
  // Every load of the model registers them: the kit reads our hook (kit_hooks.js
  // `sessionOptions`) for its row.
  const kitRow = runtimeModelRows().find((r) => r.id === "qwen3-cv-1.7b-q8");
  vi.spyOn(runtimeOptions, "savedFor").mockReturnValue({ "qwen3_tts.perf_mode": "flash_attention", "stale.key": "x" });
  // 16-bit decoder weights ride by default — audio.cpp's own default is 32-bit.
  expect(hooks.sessionOptions(kitRow)).toEqual({
    "qwen3_tts.perf_mode": "flash_attention",
    "qwen3_tts.conv_weight_type": "f16",
  });
  vi.mocked(runtimeOptions.savedFor).mockReturnValue({ "qwen3_tts.conv_weight_type": "f32" });
  expect(hooks.sessionOptions(kitRow)).toEqual({});
});

test("the_model_row_reads_and_saves_its_runtime_options", async () => {
  const { c } = await appClient();
  const url = "/v1/engines/qwen3/models/qwen3-cv-1.7b-q8/runtime-options";
  let r = await c.put(url, { json: { options: { "qwen3_tts.perf_mode": "flash_attention" } } });
  expect(r.status).toBe(200);
  expect(r.json().reload).toBe(false);
  const v = (await c.get("/v1/engines/qwen3/models")).json().variants.find((x) => x.id === "qwen3-cv-1.7b-q8");
  const values = Object.fromEntries(v.runtime_options.map((o) => [o.key, o.value]));
  expect(values["qwen3_tts.perf_mode"]).toBe("flash_attention");
  expect(values["qwen3_tts.conv_weight_type"]).toBe("f16");
  let ov = (await c.get("/v1/settings")).json().engines.engine_overrides.qwen3;
  expect(ov.runtime_options).toEqual({ "qwen3-cv-1.7b-q8": { "qwen3_tts.perf_mode": "flash_attention" } });
  expect((await c.put(url, { json: { options: { "qwen3_tts.perf_mode": "x" } } })).status).toBe(400);
  r = await c.put(url, { json: { options: { "qwen3_tts.perf_mode": "off" } } });
  ov = (await c.get("/v1/settings")).json().engines.engine_overrides.qwen3;
  expect(ov.runtime_options).toEqual({});
});

test("each_speech_model_says_how_it_is_directed", async () => {
  // The Engines page's model rows (2026-10-09): voice_model.directedBy, per model family.
  const { c } = await appClient();
  const directed = async (engine) =>
    Object.fromEntries((await c.get(`/v1/engines/${engine}/models`)).json().variants.map((v) => [v.id, v.directed_by]));
  expect((await directed("qwen3"))["qwen3-cv-1.7b-q8"]).toBe("words");
  expect(new Set(Object.values(await directed("kokoro")))).toEqual(new Set(["sliders"]));
  const chatterbox = await directed("chatterbox");
  const turbo = Object.keys(chatterbox).find((id) => vmod.modelOfVariant(id) === "chatterbox-turbo");
  expect(chatterbox[turbo]).toBe("tags");
  expect(new Set(Object.values(await directed("asr")))).toEqual(new Set([null]));
});
