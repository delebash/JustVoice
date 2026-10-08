// SPDX-License-Identifier: MIT
// camelCase-NATIVE LLM-config contract (the port of tests/test_camel_aliases.py; the
// 2026-06-21 AI-stack convergence). The shared LLM-config models have ONE name per field —
// camelCase — with NO snake_case aliases. These lock that contract: the field is camel on
// the model and the wire, snake_case is REJECTED on input, and the one-time legacy-snake
// settings migration upgrades pre-existing rows.
//
// The two /v1/settings route tests wait for api/settings_api.js + app.js. The legacy-row
// test initialised the DB through create_app; here through initDb (the part it needs).
import { afterEach, expect, test } from "vitest";
import { pyJson } from "@delebash/llm-runner/platform/pyjson";
import * as session from "../src/database/session.js";
import { construct, LLMProviderConfig, modelDump } from "../src/models.js";
import { _migrateLlmCamel, SettingsStore } from "../src/storage/settings_store.js";
import { closeModuleDb, initDbAt, tmpPath } from "./helpers.js";

afterEach(() => closeModuleDb());

test("provider_config_is_camel_native", () => {
  // camelCase input (the only accepted shape) parses into camel fields.
  const cfg = construct(LLMProviderConfig, { id: "p", name: "P", providerType: "openai", baseUrl: "u", defaultModel: "m" });
  expect(cfg.providerType).toBe("openai");
  expect(cfg.baseUrl).toBe("u");
  expect(cfg.defaultModel).toBe("m");

  // The dump is camel — the single name, no alias layer.
  const d = modelDump(LLMProviderConfig, cfg);
  expect(d.providerType).toBe("openai");
  expect(d.baseUrl).toBe("u");
  expect("provider_type" in d || "base_url" in d).toBe(false);

  // snake_case keys are NOT field names — they land in no field, and the required
  // `providerType` is then missing → a validation error.
  expect(() => construct(LLMProviderConfig, { id: "p", name: "P", provider_type: "openai" })).toThrow(/validation error/);
});

test.todo("settings_emits_camel_for_providers — waits for api/settings_api.js + app.js");
test.todo("settings_patch_rejects_snake_provider — waits for api/settings_api.js + app.js");

test("legacy_snake_settings_row_is_migrated", () => {
  // A pre-2026-06-21 settings row stored the LLM sections in snake_case. Loading it renames
  // those keys to camelCase so no field is dropped. The legacy llm_roles / feature_pins /
  // production_configs sections stay in the payload: the load must TOLERATE them.
  const tmp = tmpPath();
  initDbAt(tmp);
  new SettingsStore(tmp); // the boot's first load writes the row

  const legacy = {
    engines: {
      llm: [
        {
          id: "ollama-pc",
          name: "Ollama",
          provider_type: "ollama",
          base_url: "http://localhost:11434",
          api_key: "k",
          default_model: "qwen3:8b",
          embedding_model: "nomic-embed-text",
          timeout_seconds: 90,
        },
      ],
      feature_pins: [{ feature: "compose", provider_id: "ollama-pc", model: "m" }],
      llm_roles: {
        quick: { provider_id: "ollama-pc", model: "qwen3:0.6b" },
        accuracy: { provider_id: "ollama-pc", model: "qwen3:14b" },
      },
      production_configs: [
        {
          feature: "speaker_attribution",
          name: "v3",
          provider_id: "ollama-pc",
          model: "qwen3:14b",
          system_prompt: "SYS",
          user_prompt: "USR",
          promoted_at: "2026-01-01T00:00:00Z",
        },
      ],
    },
  };
  session.getDb().update("settings", { data: pyJson(legacy) }, { id: "singleton" });

  // Re-load through a fresh store → the migration runs in _readRow.
  const s = new SettingsStore(tmp).get();
  const prov = s.engines.llm[0];
  expect(prov.providerType).toBe("ollama");
  expect(prov.baseUrl).toBe("http://localhost:11434");
  expect(prov.apiKey).toBe("k");
  expect(prov.defaultModel).toBe("qwen3:8b");
  expect(prov.embeddingModel).toBe("nomic-embed-text");
  expect(prov.timeoutSeconds).toBe(90);
  // The pin-era sections were dropped with F1 Phase 2: tolerated, never resurrected.
  expect("llm_roles" in s.engines).toBe(false);
  expect("feature_pins" in s.engines).toBe(false);
  expect("production_configs" in s.engines).toBe(false);
});

test("migration_is_idempotent_on_camel_data", () => {
  // Already-camel data must pass through the migration untouched.
  const camel = {
    engines: {
      llm: [{ id: "p", providerType: "openai", baseUrl: "u" }],
      // legacy roles section: left verbatim (the model ignores the key at validation).
      llm_roles: { quick: { provider_id: "p", model: "m" } },
    },
  };
  const out = _migrateLlmCamel(JSON.parse(JSON.stringify(camel)));
  expect(out.engines.llm[0].providerType).toBe("openai");
  expect(out.engines.llm[0].baseUrl).toBe("u");
  expect("provider_type" in out.engines.llm[0]).toBe(false);
  expect(out.engines.llm_roles).toEqual({ quick: { provider_id: "p", model: "m" } });
});
