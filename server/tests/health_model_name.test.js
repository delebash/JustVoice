// SPDX-License-Identifier: MIT
// The top bar and Home show the loaded model by its name, never the engine id (2026-10-06, one
// wording per fact — docs/plans/2026-10-06-one-word-one-meaning-audit.md B3) — the model the kit's
// audio.cpp runtime holds (round E). The port of tests/test_health_model_name.py.
import { afterEach, expect, test } from "vitest";
import { loadedModelName } from "../src/api/health_api.js";
import { getManifest } from "../src/engines/model_catalog.js";
import { endSpeech, fakeSpeechRuntime } from "./engines_helpers.js";

afterEach(() => endSpeech());

test("the_loaded_model_is_named_by_its_catalog_row", () => {
  fakeSpeechRuntime({ loaded: [{ modelId: "qwen3-cv-1.7b-q8" }] });
  expect(loadedModelName("qwen3")).toBe("Qwen3-TTS CustomVoice 1.7B");
});

test("no_loaded_variant_falls_back_to_the_engines_name", () => {
  fakeSpeechRuntime();
  expect(loadedModelName("kokoro")).toBe(getManifest("kokoro").name);
  expect(loadedModelName("kokoro")).not.toBe("kokoro");
});

test("nothing_loaded_names_nothing", () => {
  expect(loadedModelName(null)).toBeNull();
});
