// SPDX-License-Identifier: MIT
// The settings that moved into the kit (round E, docs/plans/2026-10-29-round-e-onto-the-kit.md §4
// steps 1 and 3): the speech runtime's eleven — each `engines.speech_runtime.<name>` in the stored
// settings row becomes the kit's runner setting `<name>:audiocpp`, the same names and defaults — and
// the transcription model, `captures.stt_model`, onto the Transcription feature's preset; each leaves
// the row (the kit's retireSettings, read from the row as stored — the settings schema has neither
// any more).
import { afterEach, expect, test } from "vitest";
import { stores } from "@delebash/core/llm";
import { pyJson, pyJsonParse } from "@delebash/core/platform/pyjson";
import { DEFAULT_AUDIOCPP_SETTINGS } from "@delebash/core/runner/config";
import { retireSpeechRuntimeSettings, retireTranscriptionModel, SPEECH_RUNTIME_SETTINGS } from "../src/database/seed.js";
import * as session from "../src/database/session.js";
import { FEATURE_CATALOG, TRANSCRIPTION_FEATURE } from "../src/feature_catalog.js";
import { EngineOverrides, Settings } from "../src/models.js";
import { DEFAULT_ENGINE_PRESETS, DEFAULT_FEATURE_PRESETS } from "../src/seed_presets.js";
import { deleteStoredSetting, storedSetting } from "../src/storage/settings_store.js";
import { endState, useState } from "./engines_helpers.js";

afterEach(() => endState());

const row = () => pyJsonParse(session.cfg.handle.get("settings", "singleton").data);

/** The stored row as an older install wrote it: `edit(data)` changes it in place. */
function storeRow(edit) {
  const data = row();
  edit(data);
  session.cfg.handle.update("settings", { data: pyJson(data) }, { id: "singleton" });
}

/** The Transcription feature on its seeded preset, its provider the kit's (seedLlm's rows). */
function transcriptionPreset() {
  const p = DEFAULT_ENGINE_PRESETS.find((x) => x.id === DEFAULT_FEATURE_PRESETS[TRANSCRIPTION_FEATURE]);
  stores.getProviderStore().add({ id: p.provider_id, name: "Built-in — audio.cpp (stt)", kind: "stt", providerType: "local-audiocpp", local: true });
  stores.getEnginePresetStore().save({ id: p.id, name: p.name, providerId: p.provider_id, model: p.model, kind: p.kind, params: p.params });
  stores.getFeaturePresetRefStore().set(TRANSCRIPTION_FEATURE, p.id);
  return p.id;
}

test("the_eleven_are_the_kits_and_the_schema_keeps_neither", () => {
  expect(SPEECH_RUNTIME_SETTINGS).toEqual(Object.keys(DEFAULT_AUDIOCPP_SETTINGS));
  expect(Object.keys(Settings.properties.engines.properties)).not.toContain("speech_runtime");
  expect(Object.keys(Settings.properties.captures.properties)).not.toContain("stt_model");
  // where each model runs is saved by the kit per model (placement:audiocpp:<id>) — ours went, nothing carried
  expect(Object.keys(EngineOverrides.properties)).not.toContain("placements");
  // its feature sits with dictation cleanup, in words like its neighbours'
  expect(FEATURE_CATALOG.find((f) => f.key === TRANSCRIPTION_FEATURE)).toMatchObject({
    label: "Transcription",
    hint: "Turns speech into text — your dictation, the read-back that checks each take, and agents' transcriptions.",
    group: "Editing",
    kind: "stt",
  });
  // the Transcription preset starts on the model the setting named by default
  expect(DEFAULT_ENGINE_PRESETS.find((p) => p.id === "p_transcription")).toMatchObject({ provider_id: "local-audiocpp-stt", model: "qwen3-asr-1.7b-q8", kind: "stt", params: { placement: "auto" } });
});

test("each_runtime_setting_stored_moves_into_the_kits_runner_setting_and_leaves_the_row", () => {
  useState();
  storeRow((d) => {
    d.engines.speech_runtime = { backend: "vulkan", cpu_threads: 6, start_timeout_s: 75.5 };
  });
  const { moved, kept } = retireSpeechRuntimeSettings();
  expect(kept).toEqual([]);
  expect(moved).toEqual(["engines.speech_runtime.backend", "engines.speech_runtime.cpu_threads", "engines.speech_runtime.start_timeout_s"]);
  const kit = stores.getRunnerConfigStore().getRuntimeConfig("audiocpp").settings;
  expect(kit).toEqual({ ...DEFAULT_AUDIOCPP_SETTINGS, backend: "vulkan", cpu_threads: 6, start_timeout_s: 75.5 });
  expect(row().engines.speech_runtime).toBeUndefined();
  // floats are still written as floats, and nothing is left to move
  expect(session.cfg.handle.get("settings", "singleton").data).toContain('"loudness_target_lufs": -20.0');
  expect(retireSpeechRuntimeSettings().moved).toEqual([]);
});

test("the_transcription_model_moves_onto_its_preset_and_leaves_the_row", () => {
  useState();
  storeRow((d) => {
    d.captures.stt_model = "qwen3-asr-0.6b-q8";
  });
  // no preset yet (the kit's rows not seeded): kept for the next seed
  expect(retireTranscriptionModel().kept.map((k) => k.key)).toEqual(["captures.stt_model"]);
  expect(row().captures.stt_model).toBe("qwen3-asr-0.6b-q8");
  const id = transcriptionPreset();
  expect(retireTranscriptionModel().moved).toEqual(["captures.stt_model"]);
  expect(stores.getEnginePresetStore().get(id)).toMatchObject({ model: "qwen3-asr-0.6b-q8", kind: "stt", params: { placement: "auto" } });
  expect(row().captures).not.toHaveProperty("stt_model");
  expect(row().captures.language).toBe("auto"); // the rest of the section stays
  expect(retireTranscriptionModel().moved).toEqual([]);
});

test("the_stored_rows_values_by_their_dotted_keys_read_and_removed_as_stored", () => {
  useState();
  storeRow((d) => {
    d.engines.speech_runtime = { gpu: 0, backend: "auto" };
  });
  const h = session.cfg.handle;
  expect(storedSetting(h, "engines.speech_runtime.gpu")).toBe(0);
  expect(storedSetting(h, "engines.nothing.here")).toBeUndefined();
  deleteStoredSetting(h, "engines.speech_runtime.gpu");
  expect(storedSetting(h, "engines.speech_runtime.gpu")).toBeUndefined();
  expect(storedSetting(h, "engines.speech_runtime.backend")).toBe("auto");
  deleteStoredSetting(h, "engines.nothing.here"); // nothing to remove: the row unchanged
  expect(row().engines.speech_runtime.backend).toBe("auto");
});
