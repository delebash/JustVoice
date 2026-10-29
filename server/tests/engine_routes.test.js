// SPDX-License-Identifier: MIT
// JustVoice's engine routes on the kit's audio.cpp runtime (round E, docs/plans/2026-10-29-round-e-
// onto-the-kit.md §4 step 4): the kit's /v1/ai/runtimes/audiocpp routes install, load, place, delete
// and measure, so ours for them are gone; GET /v1/engines and /v1/engines/current keep JustVoice's
// catalog with its facts, their state read from the kit (installed from its status, loaded from its
// `loaded()`); GET /v1/engines/{id}/models keeps each version's facts, downloaded from the kit's
// models cache; a model's load options stay ours, and a loaded model whose options changed is let go
// through the kit; the dictation readiness reads the Transcription feature's.
import { afterEach, expect, test, vi } from "vitest";
import * as kitSpeech from "../src/engines/audiocpp/kit_speech.js";
import { appClient, closeApps } from "./app_helpers.js";
import { endSpeech, fakeSpeechRuntime } from "./engines_helpers.js";

afterEach(async () => {
  endSpeech();
  await closeApps();
});

test("the_routes_the_kit_has_now_are_gone", async () => {
  const { c } = await appClient();
  for (const [method, url] of [
    ["post", "/v1/engines/kokoro/install"],
    ["post", "/v1/engines/kokoro/load"],
    ["post", "/v1/engines/kokoro/cancel-load"],
    ["post", "/v1/engines/unload"],
    ["delete", "/v1/engines/kokoro"],
    ["delete", "/v1/engines/kokoro/models/kokoro-82m-q8"],
    ["put", "/v1/engines/kokoro/models/kokoro-82m-q8/placement"],
    ["delete", "/v1/engines/kokoro/models/kokoro-82m-q8/card-failure"],
    ["get", "/v1/speech-runtime"],
    ["post", "/v1/speech-runtime/japanese-dictionary"],
    ["get", "/v1/jobs/abc"],
    ["get", "/v1/engines/vram"],
    ["post", "/v1/engines/speech-cache/clear"],
    ["get", "/v1/engines/leftovers"],
    ["get", "/v1/engines/kokoro/sources"],
  ]) {
    const r = await c[method](url, method === "get" || method === "delete" ? undefined : { json: {} });
    expect([404, 405], `${method} ${url}`).toContain(r.status);
  }
  // the kit's own routes for the runtime answer instead
  expect((await c.get("/v1/ai/runtimes/audiocpp/engine/status")).status).toBe(200);
});

test("the_engine_list_keeps_our_facts_and_reads_its_state_from_the_kit", async () => {
  const { c } = await appClient();
  fakeSpeechRuntime({ installed: false });
  let list = (await c.get("/v1/engines")).json();
  const kokoro = () => list.engines.find((e) => e.id === "kokoro");
  expect(kokoro()).toMatchObject({ status: "not_installed", current: false, current_variant_id: null, resolved_device: null, placement_reason: "" });
  expect(kokoro().licence).toBeTruthy(); // its facts, ours
  fakeSpeechRuntime({ loaded: [{ modelId: "kokoro-82m-bf16", placement: "cpu", reason: "it runs fast enough on the CPU" }] });
  list = (await c.get("/v1/engines")).json();
  expect(list.current).toBe("kokoro");
  expect(kokoro()).toMatchObject({ status: "loaded", current: true, current_variant_id: "kokoro-82m-bf16", resolved_device: "cpu", placement_reason: "it runs fast enough on the CPU" });
  expect(list.engines.find((e) => e.id === "qwen3").status).toBe("installed");
  const cur = (await c.get("/v1/engines/current")).json();
  expect(cur.engine).toMatchObject({ id: "kokoro", status: "loaded", current: true });
});

test("a_versions_facts_are_ours_and_on_disk_is_the_kits", async () => {
  const { c } = await appClient();
  fakeSpeechRuntime({ onDisk: ["kokoro-82m-q8"], files: { "kokoro-82m-q8": { model: "C:/cache/hf/kokoro/kokoro.gguf" } } });
  const variants = (await c.get("/v1/engines/kokoro/models")).json().variants;
  const q8 = variants.find((v) => v.id === "kokoro-82m-q8");
  expect(q8).toMatchObject({ on_disk: true, directed_by: "sliders" });
  expect(q8.local_dir.replaceAll("\\", "/")).toBe("C:/cache/hf/kokoro");
  expect(variants.find((v) => v.id === "kokoro-82m-bf16").on_disk).toBe(false);
  // where it runs and what it measured are the kit's model list's now
  for (const gone of ["placement", "runs_on", "runs_on_reason", "cpu_realtime", "cpu_realtime_here", "measured_mb", "failed_on_card"]) expect(q8).not.toHaveProperty(gone);
});

test("changed_load_options_let_the_loaded_model_go_through_the_kit", async () => {
  const { c } = await appClient();
  const svc = fakeSpeechRuntime({ loaded: [{ modelId: "qwen3-cv-1.7b-q8" }] });
  const url = "/v1/engines/qwen3/models/qwen3-cv-1.7b-q8/runtime-options";
  let r = await c.put(url, { json: { options: { "qwen3_tts.perf_mode": "flash_attention" } } });
  expect(r.status, r.text).toBe(200);
  expect(r.json().reload).toBe(true);
  expect(svc.unloads).toEqual(["qwen3-cv-1.7b-q8"]);
  // the same options again change nothing; a model not loaded is not touched
  r = await c.put("/v1/engines/qwen3/models/qwen3-cv-0.6b-q8/runtime-options", { json: { options: { "qwen3_tts.perf_mode": "flash_attention" } } });
  expect(r.json().reload).toBe(false);
  expect(svc.unloads).toEqual(["qwen3-cv-1.7b-q8"]);
});

test("dictation_is_ready_when_the_transcription_model_is_downloaded", async () => {
  const { c } = await appClient();
  const ready = vi.spyOn(kitSpeech, "transcriptionReadiness");
  ready.mockReturnValue({ ready: false, need: "model-not-downloaded", model: "qwen3-asr-1.7b-q8", modelState: { name: "Qwen3-ASR 1.7B", bytes: 2 * 1024 * 1024 * 1024, status: "downloading", downloaded: 512, total: 1024, error: "" } });
  let stt = (await c.get("/v1/capture/readiness")).json().stt;
  expect(stt).toMatchObject({ ready: false, display_name: "Qwen3-ASR 1.7B", size_mb: 2048, downloading: true, progress: 50 });
  ready.mockReturnValue({ ready: true, need: "", model: "qwen3-asr-1.7b-q8", modelState: { name: "Qwen3-ASR 1.7B", bytes: 1024 * 1024, status: "downloaded" } });
  stt = (await c.get("/v1/capture/readiness")).json().stt;
  expect(stt).toMatchObject({ ready: true, downloading: false, size_mb: 1 });
  // no preset set: its words
  ready.mockReturnValue({ ready: false, need: "no-stt-model", model: "", modelState: null });
  expect((await c.get("/v1/capture/readiness")).json().stt).toMatchObject({ ready: false, display_name: "No speech-recognition model" });
});

test("generate_on_an_external_server_that_wont_load_points_at_its_test_connection", async () => {
  const { c } = await appClient();
  const { getState } = await import("../src/app_state.js");
  const { EngineMeta, PresetVoice } = await import("../src/engines/base.js");
  getState().engines.register({
    meta: new EngineMeta({ engineId: "my-server", displayName: "My server", backend: "external", supportedRuntimes: ["cpu"] }),
    ready: () => false,
    load: async () => {
      throw new Error("External TTS server at http://127.0.0.1:9 is not responding");
    },
    unload() {},
    voices: () => [new PresetVoice({ id: "sv_1", name: "SV" })],
    synthesize: async () => {
      throw new Error("never reached");
    },
  });
  const r = await c.post("/v1/generate", { json: { voice: "sv_1", text: "Hello." } });
  expect(r.status).toBe(400);
  expect(r.json().detail).toBe(
    "engine 'my-server' failed to load on first use: External TTS server at http://127.0.0.1:9 is not responding. Try Test connection on AI Settings → Speech.",
  );
});
