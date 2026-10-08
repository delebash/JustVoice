// SPDX-License-Identifier: MIT
// The top bar and Home show the loaded model by its name, never the engine id (2026-10-06, one
// wording per fact — docs/plans/2026-10-06-one-word-one-meaning-audit.md B3). The port of
// tests/test_health_model_name.py.
import { expect, test, vi } from "vitest";
import { loadedModelName } from "../src/api/health_api.js";
import * as manager from "../src/engines/manager.js";

test("the_loaded_model_is_named_by_its_catalog_row", () => {
  const mgr = new manager.EngineManager();
  mgr._currentVariants.set("qwen3", "qwen3-cv-1.7b-q8");
  vi.spyOn(manager, "getManager").mockReturnValue(mgr);
  expect(loadedModelName("qwen3")).toBe("Qwen3-TTS CustomVoice 1.7B");
});

test("no_loaded_variant_falls_back_to_the_engines_name", () => {
  const mgr = new manager.EngineManager();
  vi.spyOn(manager, "getManager").mockReturnValue(mgr);
  expect(loadedModelName("kokoro")).toBe(mgr.getManifest("kokoro").name);
  expect(loadedModelName("kokoro")).not.toBe("kokoro");
});

test("nothing_loaded_names_nothing", () => {
  expect(loadedModelName(null)).toBeNull();
});
