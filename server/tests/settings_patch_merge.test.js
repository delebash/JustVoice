// SPDX-License-Identifier: MIT
// Regression: PATCH /v1/settings deep-merges instead of replacing subtrees (the port of
// tests/test_settings_patch_merge.py). Found live 2026-06-11: PATCHing
// {"engines": {"external": [...]}} replaced the WHOLE engines section with defaults, wiping
// engines.llm. The store deep-merges dicts; lists still replace wholesale.
// (`SettingsPatch.model_validate(x)` → the patch is passed as the client sent it.)
import { afterEach, expect, test } from "vitest";
import { construct, ExternalEngineConfig, LLMProviderConfig } from "../src/models.js";
import { SettingsStore } from "../src/storage/settings_store.js";
import { closeModuleDb, initDbAt, tmpPath } from "./helpers.js";

afterEach(() => closeModuleDb());

function store(tmp) {
  // The store persists through the module-global database; point it at THIS test's own file.
  initDbAt(tmp);
  return new SettingsStore(tmp);
}

test("patch_engines_external_preserves_llm_providers", () => {
  const s0 = store(tmpPath());
  const s = s0.get();
  s.engines.llm.push(
    construct(LLMProviderConfig, {
      id: "ollama-pc",
      name: "Ollama",
      providerType: "ollama",
      baseUrl: "http://localhost:11434",
      defaultModel: "qwen3:8b",
      embeddingModel: "nomic-embed-text",
    }),
  );
  s0.set(s);

  const [next] = s0.patch({
    engines: {
      external: [
        { id: "elevenlabs", name: "ElevenLabs", provider_type: "openai-compat", base_url: "https://api.elevenlabs.io/v1" },
      ],
    },
  });
  expect(next.engines.external.map((e) => e.id)).toEqual(["elevenlabs"]);
  // The llm list must survive the sibling-key patch.
  expect(next.engines.llm.map((p) => p.id)).toEqual(["ollama-pc"]);
  expect(next.engines.llm[0].embeddingModel).toBe("nomic-embed-text");
});

test("patch_lists_replace_wholesale", () => {
  const s0 = store(tmpPath());
  const s = s0.get();
  s.engines.external.push(construct(ExternalEngineConfig, { id: "old", name: "Old", base_url: "http://old" }));
  s0.set(s);
  const [next] = s0.patch({ engines: { external: [] } });
  expect(next.engines.external).toEqual([]);
});

test("patch_scalar_section_still_works", () => {
  const s0 = store(tmpPath());
  const [next] = s0.patch({ logging: { level: "debug" } });
  expect(next.logging.level).toBe("debug");
});
