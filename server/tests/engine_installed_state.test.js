// SPDX-License-Identifier: MIT
// Load-door pins (phase ②, plan doc §12, and the 2026-10-01 switch). Since round E (docs/plans/
// 2026-10-29-round-e-onto-the-kit.md) the kit's audio.cpp runtime downloads a model's files into its
// models cache and loads them, and tests that — the manager's own fetch-before-load and its folder on
// /load are gone. What stays ours: an engine's state reads the runtime, never its files — weights on
// disk are not the program (kit_speech.js `engineStatus`). The port of tests/test_engine_local_load.py.
import { afterEach, expect, test } from "vitest";
import { endSpeech, fakeSpeechRuntime } from "./engines_helpers.js";
import * as kitSpeech from "../src/engines/audiocpp/kit_speech.js";

afterEach(() => endSpeech());

test("model_files_on_disk_do_not_make_an_engine_installed", () => {
  // Weights are not the program. An engine is installed when the speech runtime is.
  fakeSpeechRuntime({ onDisk: ["kokoro-82m-q8"], installed: false });
  expect(kitSpeech.onDisk("kokoro-82m-q8")).toBe(true);
  expect(kitSpeech.engineStatus("kokoro")).toBe("not_installed");
  fakeSpeechRuntime({ onDisk: ["kokoro-82m-q8"], installed: true });
  expect(kitSpeech.engineStatus("kokoro")).toBe("installed");
});
