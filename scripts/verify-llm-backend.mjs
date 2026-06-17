// SPDX-License-Identifier: GPL-3.0-or-later
//
// Verify services/llmBackend.js — the JustVoice ProviderBackend adapter
// (Thread 3 / T3.3). No app or build needed: inject a stub `api` and assert
// the snake_case<->camelCase mapping both directions.
//   node scripts/verify-llm-backend.mjs
import assert from "node:assert/strict";

import { createJustVoiceBackend } from "../src/renderer/src/services/llmBackend.js";

function makeApi(handler) {
  const calls = [];
  const mk = (method) => async (path, body) => {
    calls.push({ method, path, body });
    return handler(method, path, body) ?? {};
  };
  return { calls, api: { get: mk("GET"), post: mk("POST"), patch: mk("PATCH"), put: mk("PUT"), del: mk("DELETE") } };
}

let checks = 0;
const check = async (name, fn) => { await fn(); checks++; };

// listProviders: server snake -> contract camel
await check("listProviders", async () => {
  const { api } = makeApi(() => ({
    providers: [{
      id: "p1", name: "OpenAI", provider_type: "openai", base_url: "https://x/v1",
      default_model: "gpt", embedding_model: "emb", has_api_key: true, registered: true,
      timeout_seconds: 60,
    }],
  }));
  const list = await createJustVoiceBackend(api).listProviders();
  assert.deepEqual(list, [{
    id: "p1", name: "OpenAI", providerType: "openai", baseUrl: "https://x/v1",
    defaultModel: "gpt", embeddingModel: "emb", timeoutSeconds: 60, hasApiKey: true, registered: true,
  }]);
});

// addProvider: contract draft (camel) -> server upsert (snake), only-present fields
await check("addProvider", async () => {
  const { calls, api } = makeApi(() => ({
    id: "p2", name: "Local", provider_type: "local-llamacpp", base_url: "", default_model: "",
    embedding_model: "", has_api_key: false, registered: true, timeout_seconds: 60,
  }));
  const r = await createJustVoiceBackend(api).addProvider({
    id: "p2", name: "Local", providerType: "local-llamacpp",
    baseUrl: "http://127.0.0.1:8080/v1", apiKey: "k",
  });
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].path, "/v1/llm-providers");
  assert.deepEqual(calls[0].body, {
    id: "p2", name: "Local", provider_type: "local-llamacpp",
    base_url: "http://127.0.0.1:8080/v1", api_key: "k",
  });
  assert.equal(r.providerType, "local-llamacpp");
});

await check("updateProvider", async () => {
  const { calls, api } = makeApi(() => ({
    id: "p1", name: "X", provider_type: "openai", base_url: "", default_model: "",
    embedding_model: "", has_api_key: true, registered: true, timeout_seconds: 60,
  }));
  await createJustVoiceBackend(api).updateProvider("p1", { name: "X", providerType: "openai", apiKey: "" });
  assert.equal(calls[0].method, "PATCH");
  assert.equal(calls[0].path, "/v1/llm-providers/p1");
  assert.deepEqual(calls[0].body, { id: "p1", name: "X", provider_type: "openai", api_key: "" });
});

await check("removeProvider", async () => {
  const { calls, api } = makeApi(() => ({}));
  await createJustVoiceBackend(api).removeProvider("p1");
  assert.equal(calls[0].method, "DELETE");
  assert.equal(calls[0].path, "/v1/llm-providers/p1");
});

await check("ping", async () => {
  const { calls, api } = makeApi(() => ({ ok: false, error: "boom" }));
  const r = await createJustVoiceBackend(api).ping("p1");
  assert.equal(calls[0].path, "/v1/llm-providers/p1/ping");
  assert.deepEqual(r, { ok: false, message: "boom" });
});

await check("fetchModels (string + object forms)", async () => {
  const { api } = makeApi(() => ({ models: ["m1", { id: "m2", label: "M2", tier: "quick" }] }));
  const r = await createJustVoiceBackend(api).fetchModels("p1");
  assert.deepEqual(r, [{ id: "m1" }, { id: "m2", label: "M2", tier: "quick" }]);
});

await check("detectLocal", async () => {
  const { api } = makeApi(() => ({
    detected: [{ provider_type: "ollama", name: "Ollama", base_url: "http://127.0.0.1:11434", models: ["llama"], already_registered: false }],
  }));
  const r = await createJustVoiceBackend(api).detectLocal();
  assert.deepEqual(r, [{ providerType: "ollama", name: "Ollama", baseUrl: "http://127.0.0.1:11434", models: ["llama"], alreadyRegistered: false }]);
});

await check("classifyTier", async () => {
  const { api } = makeApi(() => ({ model: "gpt", tier: "accuracy" }));
  assert.equal(await createJustVoiceBackend(api).classifyTier("gpt"), "accuracy");
});

await check("usage (ledger.recent -> UsageRow)", async () => {
  const { api } = makeApi(() => ({
    recent: [{ feature: "compose", model: "gpt", prompt_tokens: 10, completion_tokens: 5, duration_ms: 100, ok: true, at: 1.5 }],
    by_feature: {}, total_calls: 1,
  }));
  const r = await createJustVoiceBackend(api).usage();
  assert.deepEqual(r, [{ ts: 1500, feature: "compose", providerId: "", model: "gpt", promptTokens: 10, completionTokens: 5 }]);
});

await check("featurePins", async () => {
  const { api } = makeApi(() => ({ pins: [{ feature: "compose", provider_id: "p1", model: "gpt", tier: null }], catalog: [] }));
  const r = await createJustVoiceBackend(api).featurePins();
  assert.deepEqual(r, [{ feature: "compose", providerId: "p1", model: "gpt" }]);
});

await check("setFeaturePin", async () => {
  const { calls, api } = makeApi(() => ({}));
  await createJustVoiceBackend(api).setFeaturePin("speaker_attribution", { providerId: "local-llamacpp", model: "qwen" });
  assert.equal(calls[0].method, "PUT");
  assert.equal(calls[0].path, "/v1/feature-pins");
  assert.deepEqual(calls[0].body, { feature: "speaker_attribution", provider_id: "local-llamacpp", model: "qwen" });
});

console.log(`verify-llm-backend: ${checks} checks passed`);
