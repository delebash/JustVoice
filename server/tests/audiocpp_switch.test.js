// SPDX-License-Identifier: MIT
// The audio.cpp switch (docs/plans/2026-10-01-audiocpp-switch.md): the catalog, the request
// mapping per family, and the runtime's own bookkeeping. No binary, no GPU (the port of
// tests/test_audiocpp_switch.py; Python's parametrized tests loop over their cases).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import { appClient, closeApps } from "./app_helpers.js";
import { discrete } from "./engines_helpers.js";
import { parseWavHeader, writeWavContainer } from "../src/audio/wav.js";
import * as dspClient from "../src/audio/dsp_client.js";
import * as espeak from "../src/engines/audiocpp/espeak.js";
import * as release from "../src/engines/audiocpp/release.js";
import * as runtime from "../src/engines/audiocpp/runtime.js";
import { ModelEntry } from "../src/engines/audiocpp/runtime.js";
import * as slot from "../src/engines/audiocpp/slot.js";
import { toSpeechRequest } from "../src/engines/audiocpp/slot.js";
import { lookup } from "../src/engines/capability_details.js";
import * as chatterboxManifest from "../src/engines/chatterbox/manifest.js";
import * as manager from "../src/engines/manager.js";
import { discoverEngines, EngineManager } from "../src/engines/manager.js";
import * as qwen3Manifest from "../src/engines/qwen3/manifest.js";
import { tmpPath } from "./helpers.js";

afterAll(() => dspClient.stop());

const row = (engine, variant) => discoverEngines().get(engine).module.VARIANTS.find((r) => r.id === variant);

// ─── the catalog ─────────────────────────────────────────────────────────────

test("every_switched_engine_runs_on_audiocpp", () => {
  for (const engine of ["kokoro", "qwen3", "chatterbox", "asr"]) {
    const m = discoverEngines().get(engine);
    expect(m.usesAudiocpp).toBe(true);
    expect(m.module.VARIANTS.map((r) => r.id)).toContain(m.defaultVariantId);
    // audio.cpp's own repo, or our conversion of a model it does not publish (gap 4; Turbo
    // and Nano, gap 1, offered from v0.9.0-jv.4).
    const pinned = {
      [release.MODEL_REPO]: release.MODEL_REVISION,
      [qwen3Manifest.CV_06_REPO]: qwen3Manifest.CV_06_REVISION,
      [chatterboxManifest.TURBO_REPO]: chatterboxManifest.TURBO_REVISION,
      [chatterboxManifest.NANO_REPO]: chatterboxManifest.NANO_REVISION,
    };
    for (const r of m.module.VARIANTS) {
      const src = r.sources[0];
      expect(Object.hasOwn(pinned, src.hf_repo), r.id).toBe(true);
      expect(src.revision).toBe(pinned[src.hf_repo]); // a commit, never a branch
      expect(src.files).toContain(r.audiocpp.file);
    }
  }
});

test("every_switched_variant_reaches_a_capability_row", () => {
  for (const engine of ["kokoro", "qwen3", "chatterbox"]) {
    for (const r of discoverEngines().get(engine).module.VARIANTS) expect(lookup(r.id), r.id).not.toBeNull();
  }
});

test("qwen3_family_still_reads_off_the_variant_id", async () => {
  // voice_model.modelOfVariant walks the id down to its capability row:
  // qwen3-<family>-<size>-<precision> → qwen3-<family>.
  const { modelOfVariant } = await import("../src/voice_model.js");
  const ids = discoverEngines().get("qwen3").module.VARIANTS.map((r) => r.id);
  expect(new Set(ids.map((i) => modelOfVariant(i)))).toEqual(new Set(["qwen3-cv", "qwen3-base", "qwen3-vd"]));
});

test("kokoro_offers_only_voices_audiocpp_can_speak", () => {
  // Since v0.9.0-jv.4 the pinned runtime reads Japanese: all 54, the five Japanese among them.
  const voices = discoverEngines().get("kokoro").staticVoices;
  expect(voices.length).toBe(54);
  expect(voices.filter((v) => v.language === "ja").length).toBe(5);
});

test("the_aligner_rides_with_speech_recognition", () => {
  const r = row("asr", "qwen3-asr-1.7b-q8");
  const comp = r.audiocpp.companions[0];
  expect(comp.role).toBe("aligner");
  expect(r.sources[0].files).toContain(comp.file);
});

test("turbo_has_its_own_row_again_and_only_multilingual_has_min_p", () => {
  expect(lookup("chatterbox-turbo-q8").engine_id).toBe("chatterbox-turbo");
  expect(lookup("chatterbox-multilingual").knobs.map((k) => k.key)).toContain("min_p");
  expect(lookup("chatterbox-turbo").knobs.map((k) => k.key)).not.toContain("min_p");
});

// ─── request mapping ─────────────────────────────────────────────────────────

test("kokoro_maps_voice_language_speed_and_seed", () => {
  const req = toSpeechRequest(row("kokoro", "kokoro-82m-q8"), {
    voice_id: "bf_emma",
    text: "Hello.",
    language: null,
    seed: 7,
    delivery: { speed: 1.1 },
  });
  expect(req).toEqual({ model: "kokoro-82m-q8", input: "Hello.", seed: 7, voice: "bf_emma", language: "en-gb", speed: 1.1 });
});

test("qwen3_customvoice_takes_speaker_instruct_and_a_language_name", () => {
  for (const variant of ["qwen3-cv-1.7b-q8", "qwen3-cv-0.6b-q8"]) {
    const req = toSpeechRequest(row("qwen3", variant), {
      voice_id: "Ryan",
      text: "Hi.",
      language: "en-US",
      delivery: { instruct: "Whisper it.", temperature: 0.7, engine: { talker_top_k: 40, repetition_penalty: 1.1 } },
    });
    expect(req.language).toBe("English"); // "en" is rejected by audio.cpp
    expect(req.options).toEqual({ speaker: "Ryan", instruct: "Whisper it.", temperature: 0.7, top_k: 40, repetition_penalty: 1.1 });
  }
});

test("qwen3_base_clones_from_the_clip_and_its_transcript", () => {
  const req = toSpeechRequest(row("qwen3", "qwen3-base-1.7b-q8"), {
    voice_id: "v1",
    text: "Hi.",
    audio_prompt_path: "C:\\voices\\v1\\ref.wav",
    ref_text: "The reference words.",
  });
  expect(req.voice_ref).toBe("C:/voices/v1/ref.wav");
  expect(req.reference_text).toBe("The reference words.");
  expect("speaker" in (req.options || {})).toBe(false);
});

test("qwen3_refuses_the_wrong_family_by_name", () => {
  for (const cv of ["qwen3-cv-1.7b-q8", "qwen3-cv-0.6b-q8"]) {
    expect(() => toSpeechRequest(row("qwen3", cv), { voice_id: "x", text: "Hi.", audio_prompt_path: "a.wav" })).toThrow(/cannot clone/);
  }
  expect(() => toSpeechRequest(row("qwen3", "qwen3-base-1.7b-q8"), { voice_id: "Ryan", text: "Hi." })).toThrow(/clone-only/);
});

test("qwen3_voicedesign_speaks_from_its_description", () => {
  const req = toSpeechRequest(row("qwen3", "qwen3-vd-1.7b-q8"), {
    voice_id: "d1",
    text: "Hi.",
    delivery: { instruct: "A gravel-voiced harbour-master." },
  });
  expect(req.instructions).toBe("A gravel-voiced harbour-master.");
  expect(() => toSpeechRequest(row("qwen3", "qwen3-vd-1.7b-q8"), { voice_id: "d1", text: "Hi." })).toThrow(/description/);
});

test("chatterbox_maps_cfg_to_guidance_scale_per_line", () => {
  const req = toSpeechRequest(row("chatterbox", "chatterbox-multilingual-v2-q8"), {
    voice_id: "c1",
    text: "Hallo.",
    language: "de",
    audio_prompt_path: "/v/ref.wav",
    delivery: { temperature: 0.8, engine: { exaggeration: 0.7, cfg_weight: 0.3 } },
  });
  expect(req.voice_ref).toBe("/v/ref.wav");
  expect(req.language).toBe("de");
  expect(req.options).toEqual({ exaggeration: 0.7, guidance_scale: 0.3, temperature: 0.8 });
});

test("chatterbox_needs_a_clip", () => {
  expect(() => toSpeechRequest(row("chatterbox", "chatterbox-multilingual-v2-q8"), { voice_id: "c1", text: "Hi." })).toThrow(
    /cloned voices/,
  );
});

// ─── the runtime's bookkeeping ───────────────────────────────────────────────

test("model_entry_writes_the_config_row", () => {
  const e = new ModelEntry("kitten-mini-0.8", "kitten_tts", "tts", "C:/m/k.gguf", [["kitten_tts.espeak_data_path", "C:/e/data"]]);
  expect(e.toConfig()).toEqual({
    id: "kitten-mini-0.8",
    family: "kitten_tts",
    task: "tts",
    mode: "offline",
    path: "C:/m/k.gguf",
    session_options: { "kitten_tts.espeak_data_path": "C:/e/data" },
  });
});

// ─── eSpeak NG reaches both phonemizers (audit 2026-10-04 §5 A1–A2) ──────────

function espeakInstalled(root) {
  const home = espeak.home(root);
  mkdirSync(path.join(home, "espeak-ng-data"), { recursive: true });
  writeFileSync(path.join(home, "espeak-ng.dll"), "x");
  return [path.join(home, "espeak-ng.dll"), path.join(home, "espeak-ng-data")];
}

test("kokoro_finds_our_espeak_through_the_runtimes_environment", () => {
  // Kokoro reads ONLY AUDIOCPP_ESPEAK_LIBRARY / _DATA (audio.cpp g2p_multilingual.cpp:92-93);
  // without them it loads whatever eSpeak NG the system path finds.
  const tmp = tmpPath();
  vi.spyOn(runtime, "_runtimeRoot").mockReturnValue(tmp);
  vi.stubEnv("AUDIOCPP_ESPEAK_LIBRARY", "C:/somewhere/else.dll");
  let env = runtime._childEnv();
  expect("AUDIOCPP_ESPEAK_LIBRARY" in env).toBe(false);
  expect("AUDIOCPP_ESPEAK_DATA" in env).toBe(false);
  const [lib, data] = espeakInstalled(tmp);
  env = runtime._childEnv();
  expect(env.AUDIOCPP_ESPEAK_LIBRARY).toBe(lib);
  expect(env.AUDIOCPP_ESPEAK_DATA).toBe(data);
});

test("kitten_gets_its_own_prefixed_espeak_options_and_kokoro_gets_none", () => {
  // Kitten reads `kitten_tts.espeak_*` (audio.cpp kitten_tts/session.cpp:74); Kokoro would
  // refuse a session option it doesn't know, so it gets none.
  const tmp = tmpPath();
  const [lib, data] = espeakInstalled(tmp);
  vi.spyOn(manager, "enginesRuntimeRoot").mockReturnValue(tmp);
  vi.spyOn(slot, "_dataDir").mockReturnValue(path.join(tmp, "data"));
  const kitten = discoverEngines().get("kitten");
  const entries = slot._entriesFor(kitten, row("kitten", "kitten-mini-0.8"));
  expect(entries.length).toBe(1);
  expect(Object.fromEntries(entries[0].sessionOptions)).toEqual({
    "kitten_tts.espeak_library_path": lib,
    "kitten_tts.espeak_data_path": data,
  });
  const kokoro = discoverEngines().get("kokoro");
  const [entry] = slot._entriesFor(kokoro, row("kokoro", "kokoro-82m-q8"));
  expect(entry.sessionOptions.some(([k]) => k.includes("espeak"))).toBe(false);
});

test("every_platform_finds_its_espeak_wheel", () => {
  // PyPI's own file list for espeakng-loader 0.2.4, read 2026-10-04.
  for (const [filename, tag] of [
    ["espeakng_loader-0.2.4-py3-none-macosx_10_12_x86_64.whl", "macosx_10_12_x86_64"],
    ["espeakng_loader-0.2.4-py3-none-macosx_11_0_arm64.whl", "macosx_11_0_arm64"],
    ["espeakng_loader-0.2.4-py3-none-manylinux_2_17_x86_64.manylinux2014_x86_64.whl", "manylinux_2_17_x86_64"],
    ["espeakng_loader-0.2.4-py3-none-manylinux_2_28_aarch64.whl", "manylinux_2_28_aarch64"],
    ["espeakng_loader-0.2.4-py3-none-win_amd64.whl", "win_amd64"],
    ["espeakng_loader-0.2.4-py3-none-win_arm64.whl", "win_arm64"],
  ]) {
    expect(Object.hasOwn(espeak._SHA256, tag)).toBe(true);
    expect(espeak.wheelMatches(filename, tag)).toBe(true);
    const others = Object.keys(espeak._SHA256).filter((t) => t !== tag);
    expect(others.some((t) => espeak.wheelMatches(filename, t)), filename).toBe(false);
  }
});

test("release_rows_pin_one_tag_and_ship_the_windows_cuda_runtime", () => {
  const rows = release.binaries();
  expect(rows.every((r) => r.assetUrl.includes(`/${release.cfg.TAG}/`))).toBe(true);
  const winCuda = rows.filter((r) => r.platform === "windows" && r.gpu.startsWith("cuda"));
  expect(winCuda.length).toBeGreaterThan(0);
  expect(winCuda.every((r) => r.runtimeUrl && r.runtimeUrl.includes("cudart"))).toBe(true);
});

test("an_audiocpp_engine_runs_where_the_runtime_runs", () => {
  vi.spyOn(runtime, "installedExe").mockReturnValue("C:/rt/audiocpp/v0.9.0/vulkan/audiocpp_server.exe");
  const m = discoverEngines().get("kokoro");
  // Neither a per-call device nor the old per-engine Device setting moves one model off the
  // shared server.
  expect(new EngineManager()._resolveDevice(m, "cpu")).toBe("vulkan");
});

// ─── the runtime row and the delete (the API) ────────────────────────────────

/** A client on a fresh app over fake hardware, with the runtime's install answer pinned. */
async function runtimeClient(dir, { installed = null } = {}) {
  runtime.cfg.HW = discrete();
  vi.spyOn(runtime, "installedExe").mockReturnValue(installed);
  return (await appClient(dir)).c;
}

test("the_runtime_row_reads_and_saves_its_backend", async () => {
  const c = await runtimeClient(tmpPath());
  let r = (await c.get("/v1/speech-runtime")).json();
  expect(r.installed).toBe(false);
  expect(r.backend_setting).toBe("auto");
  expect(new Set(r.backends)).toEqual(new Set(["cuda", "vulkan", "cpu"]));
  expect(r.gpus).toEqual(["fake"]);
  r = await c.put("/v1/speech-runtime", { json: { backend: "vulkan", gpu: 0 } });
  expect(r.status).toBe(200);
  expect(r.json().backend_setting).toBe("vulkan");
  expect((await c.get("/v1/settings")).json().engines.speech_runtime).toEqual({
    backend: "vulkan",
    gpu: 0,
    cpu_threads: 0,
    cpu_min_realtime: 2.0,
    gpu_threads: 4,
    start_timeout_s: 60.0,
    request_timeout_s: 900.0,
  });
});

test("the_runtime_row_saves_the_cpu_process_threads_without_touching_the_build", async () => {
  // CPU placement (2026-10-02): the CPU process's threads are a setting; 0 means the physical
  // core count, and changing them keeps the backend the user chose.
  vi.spyOn(runtime, "physicalCores").mockReturnValue(8);
  const c = await runtimeClient(tmpPath());
  let r = (await c.get("/v1/speech-runtime")).json();
  expect([r.cpu_threads, r.cpu_threads_used, r.physical_cores]).toEqual([0, 8, 8]);
  expect(r.cpu_min_realtime).toBe(2.0);
  expect(r.cpu_running).toBe(false);
  await c.put("/v1/speech-runtime", { json: { backend: "vulkan", gpu: 0 } });
  r = await c.put("/v1/speech-runtime", { json: { backend: "vulkan", gpu: 0, cpu_threads: 6 } });
  expect(r.status).toBe(200);
  expect(r.json().cpu_threads_used).toBe(6);
  expect(r.json().backend_setting).toBe("vulkan");
  expect((await c.put("/v1/speech-runtime", { json: { backend: "vulkan", cpu_threads: -1 } })).status).toBe(400);
  expect((await c.put("/v1/speech-runtime", { json: { backend: "vulkan", cpu_min_realtime: 0 } })).status).toBe(400);
});

test("the_runtime_row_refuses_a_build_this_os_has_none_of", async () => {
  const c = await runtimeClient(tmpPath());
  expect((await c.put("/v1/speech-runtime", { json: { backend: "metal" } })).status).toBe(400);
  expect((await c.put("/v1/speech-runtime", { json: { backend: "cpu", gpu: -1 } })).status).toBe(400);
});

test("deleting_an_engines_models_says_so_when_files_stay", async () => {
  // Windows refuses to delete a file a process holds open; the delete must not report success
  // over files that are still there.
  const dir = tmpPath();
  const c = await runtimeClient(dir);
  const model = path.join(dir, "speech-cache", "kokoro", "kokoro-82m-q8", "kokoro-82m-q8_0.gguf");
  mkdirSync(path.dirname(model), { recursive: true });
  writeFileSync(model, "gguf");
  const spy = vi.spyOn(manager, "_rmtree").mockImplementation(() => {});
  const r = await c.delete("/v1/engines/kokoro");
  spy.mockRestore();
  expect(r.status).toBe(409);
  expect(r.text).toContain("still in use");
  expect((await c.delete("/v1/engines/kokoro")).status).toBe(200);
  expect(existsSync(model)).toBe(false);
});

// ─── the aligner's input rate ────────────────────────────────────────────────

function toneWav(rate, seconds, channels = 1) {
  const n = Math.trunc(rate * seconds);
  const b = Buffer.alloc(n * channels * 2);
  for (let i = 0; i < n; i++) {
    const v = Math.trunc(Math.sin((2 * Math.PI * 220 * i) / rate) * 8000);
    for (let c = 0; c < channels; c++) b.writeInt16LE(v, (i * channels + c) * 2);
  }
  return writeWavContainer(b, rate, channels);
}

test("the_aligner_gets_16k_mono_so_its_seconds_are_right", async () => {
  // audio.cpp v0.9.0 reports aligned seconds at the INPUT rate: a 24 kHz render came back at
  // 2/3 of its real times. The slot sends 16 kHz mono, same length.
  for (const [rate, channels] of [
    [24000, 1],
    [44100, 2],
    [48000, 1],
  ]) {
    const [fmt] = parseWavHeader(await slot.asAudio16kMono(toneWav(rate, 2.0, channels)));
    expect([fmt.sampleRate, fmt.channels]).toEqual([16000, 1]);
    expect(Math.abs(fmt.durationSec - 2.0)).toBeLessThanOrEqual(0.01);
  }
});

test("16k_mono_goes_as_it_is", async () => {
  const w = toneWav(16000, 1.0);
  expect(await slot.asAudio16kMono(w)).toBe(w);
});

// ── VoxCPM2 (gap 9) ──────────────────────────────────────────────────────

test("voxcpm2_clones_from_the_clip_and_sends_direction_as_its_prefix", () => {
  const req = toSpeechRequest(row("voxcpm2", "voxcpm2-q8"), {
    voice_id: "v1",
    text: "The lights came on.",
    audio_prompt_path: "C:\\voices\\v1\\ref.wav",
    ref_text: "The reference words.",
    delivery: { instruct: "Whispered, (tired)" },
  });
  expect(req.voice_ref).toBe("C:/voices/v1/ref.wav");
  expect(req.reference_text).toBe("The reference words.");
  // Brackets inside the direction would end the tag early; they go.
  expect(req.input).toBe("(Whispered, tired)The lights came on.");
});

test("voxcpm2_designs_from_a_description_and_refuses_a_voice_with_neither", () => {
  const req = toSpeechRequest(row("voxcpm2", "voxcpm2-q8"), { text: "Hi.", delivery: { instruct: "A deep, slow, elderly man's voice" } });
  expect(req.input).toBe("(A deep, slow, elderly man's voice)Hi.");
  expect("voice_ref" in req).toBe(false);
  expect(() => toSpeechRequest(row("voxcpm2", "voxcpm2-q8"), { voice_id: "x", text: "Hi." })).toThrow(
    /neither a reference clip nor a description/,
  );
});

test("voxcpm2_speaks_a_lines_own_brackets_as_dashes", () => {
  // VoxCPM2 does not speak parenthesised text, anywhere in the line (measured 2026-10-02).
  const r = row("voxcpm2", "voxcpm2-q8");
  expect(toSpeechRequest(r, { text: "He left (quietly, without a word) and shut it.", audio_prompt_path: "a.wav" }).input).toBe(
    "He left — quietly, without a word — and shut it.",
  );
  expect(toSpeechRequest(r, { text: "(Aside) He left.", audio_prompt_path: "a.wav" }).input).toBe("Aside — He left.");
  expect(toSpeechRequest(r, { text: "(Aside) He left.", delivery: { instruct: "Dry" } }).input).toBe("(Dry)Aside — He left.");
});

afterEach(async () => {
  await closeApps();
  runtime.cfg.HW = null;
  runtime.forgetInstalled();
});

