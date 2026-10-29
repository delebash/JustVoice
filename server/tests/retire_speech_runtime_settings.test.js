// SPDX-License-Identifier: MIT
// The speech runtime's eleven settings move into the kit's audio.cpp runtime (round E, docs/plans/
// 2026-10-29-round-e-onto-the-kit.md §4 step 1): each `engines.speech_runtime.<name>` in the stored
// settings row becomes the kit's runner setting `<name>:audiocpp` — the same names and defaults — and
// leaves the row (the kit's retireSettings, read from the row as stored). The transcription model's
// setting stays for its own move.
import { afterEach, expect, test } from "vitest";
import { stores } from "@delebash/core/llm";
import { DEFAULT_AUDIOCPP_SETTINGS } from "@delebash/core/runner/config";
import { retireSpeechRuntimeSettings, SPEECH_RUNTIME_SETTINGS } from "../src/database/seed.js";
import * as session from "../src/database/session.js";
import { SpeechRuntimeSettings } from "../src/models.js";
import { deleteStoredSetting, storedSetting } from "../src/storage/settings_store.js";
import { endState, useState } from "./engines_helpers.js";

afterEach(() => endState());

const row = () => JSON.parse(session.cfg.handle.get("settings", "singleton").data);

test("the eleven are the kit's, by name and default", () => {
  expect(SPEECH_RUNTIME_SETTINGS).toEqual(Object.keys(DEFAULT_AUDIOCPP_SETTINGS));
  expect(Object.keys(SpeechRuntimeSettings.properties)).toEqual(SPEECH_RUNTIME_SETTINGS);
  for (const name of SPEECH_RUNTIME_SETTINGS) expect(SpeechRuntimeSettings.properties[name].default, name).toEqual(DEFAULT_AUDIOCPP_SETTINGS[name]);
});

test("each one stored moves into the kit's runner setting and leaves the row; the rest of the row stays", () => {
  const st = useState();
  st.settings.patch({ engines: { speech_runtime: { backend: "vulkan", cpu_threads: 6, start_timeout_s: 75.5 } } });
  expect(row().engines.speech_runtime.backend).toBe("vulkan");

  const { moved, kept } = retireSpeechRuntimeSettings();
  expect(kept).toEqual([]);
  expect(moved).toEqual(SPEECH_RUNTIME_SETTINGS.map((n) => `engines.speech_runtime.${n}`));
  const kit = stores.getRunnerConfigStore().getRuntimeConfig("audiocpp").settings;
  expect(kit).toEqual({ ...DEFAULT_AUDIOCPP_SETTINGS, backend: "vulkan", cpu_threads: 6, start_timeout_s: 75.5 });
  expect(stores.getRunnerConfigStore().getSetting("request_timeout_s:audiocpp")).toBe("900.0");

  const after = row();
  expect(after.engines.speech_runtime).toBeUndefined();
  // the rest as it was: the transcription model's own setting, and floats still written as floats
  expect(after.captures.stt_model).toBe("qwen3-asr-1.7b-q8");
  expect(session.cfg.handle.get("settings", "singleton").data).toContain('"loudness_target_lufs": -20.0');
  // nothing left to move
  expect(retireSpeechRuntimeSettings().moved).toEqual([]);
});

test("the stored row's values by their dotted keys, read and removed as stored", () => {
  useState();
  const h = session.cfg.handle;
  expect(storedSetting(h, "engines.speech_runtime.gpu")).toBe(0);
  expect(storedSetting(h, "engines.nothing.here")).toBeUndefined();
  deleteStoredSetting(h, "engines.speech_runtime.gpu");
  expect(storedSetting(h, "engines.speech_runtime.gpu")).toBeUndefined();
  expect(storedSetting(h, "engines.speech_runtime.backend")).toBe("auto");
  deleteStoredSetting(h, "engines.nothing.here"); // nothing to remove: the row unchanged
  expect(row().engines.speech_runtime.backend).toBe("auto");
});
