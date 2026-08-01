// SPDX-License-Identifier: MIT
//
// JustVoice REST adapter for the shared `@delebash/llm-ui` ProviderBackend
// contract (Thread 3 / T3.3). The shared UI components call these methods and
// NEVER touch fetch directly.
//
// As of 2026-06-21 the server's LLM-config wire is camelCase-NATIVE (the shared
// llm_runner schema dropped its snake_case aliases — one name per field), so
// these shapes already MATCH the `@delebash/llm-ui` camelCase contract. The
// mapping below is now an explicit identity pass-through (no snake↔camel
// translation), kept as the single, documented boundary the shared UI calls.
//
// `api` is the Pinia api store ({ get, post, patch, put, del } over request).
// Inject a stub with the same surface to unit-test (scripts/verify-llm-backend.js).

function providerFromApi(p) {
  return {
    id: p.id,
    name: p.name,
    providerType: p.providerType,
    baseUrl: p.baseUrl || "",
    defaultModel: p.defaultModel || "",
    embeddingModel: p.embeddingModel || "",
    timeoutSeconds: p.timeoutSeconds,
    hasApiKey: !!p.hasApiKey,
    registered: !!p.registered,
  };
}

// ProviderDraft -> the server's UpsertLLMProviderRequest (both camelCase).
// The server upsert requires id/name/providerType; optional fields are only
// sent when present so a partial patch doesn't clobber with empty strings.
function providerToApi(d) {
  const body = { id: d.id, name: d.name, providerType: d.providerType };
  if (d.baseUrl !== undefined) body.baseUrl = d.baseUrl;
  if (d.apiKey !== undefined) body.apiKey = d.apiKey;
  if (d.defaultModel !== undefined) body.defaultModel = d.defaultModel;
  if (d.embeddingModel !== undefined) body.embeddingModel = d.embeddingModel;
  if (d.timeoutSeconds !== undefined) body.timeoutSeconds = d.timeoutSeconds;
  return body;
}

function modelFromApi(m) {
  // /v1/llm-providers/{id}/models returns a bare string list today; tolerate
  // an object form too so a richer server response Just Works.
  return typeof m === "string" ? { id: m } : { id: m.id, label: m.label, tier: m.tier };
}

export function createJustVoiceBackend(api) {
  const enc = encodeURIComponent;
  return {
    async listProviders() {
      const r = await api.get("/v1/llm-providers");
      return (r.providers || []).map(providerFromApi);
    },
    async addProvider(draft) {
      return providerFromApi(await api.post("/v1/llm-providers", providerToApi(draft)));
    },
    async updateProvider(id, patch) {
      // Server PATCH is a full upsert (id immutable) — callers pass the merged
      // draft, not a sparse patch.
      return providerFromApi(
        await api.patch(`/v1/llm-providers/${enc(id)}`, providerToApi({ id, ...patch })),
      );
    },
    async removeProvider(id) {
      await api.del(`/v1/llm-providers/${enc(id)}`);
    },
    async ping(id) {
      const r = await api.post(`/v1/llm-providers/${enc(id)}/ping`);
      return { ok: !!r.ok, message: r.error || undefined };
    },
    async fetchModels(id) {
      const r = await api.get(`/v1/llm-providers/${enc(id)}/models`);
      return (r.models || []).map(modelFromApi);
    },
    async detectLocal() {
      const r = await api.get("/v1/llm-providers/detect-local");
      return (r.detected || []).map((d) => ({
        providerType: d.providerType,
        name: d.name,
        baseUrl: d.baseUrl,
        models: d.models || [],
        alreadyRegistered: !!d.alreadyRegistered,
      }));
    },
    async classifyTier(modelId) {
      const r = await api.post("/v1/llm-providers/classify-tier", { model: modelId });
      return r.tier;
    },
    async usage() {
      // The server ledger records model (not provider id), so providerId is
      // left empty; cost is omitted (JustVoice has no server-side price table).
      const r = await api.get("/v1/ai-usage");
      return (r.recent || []).map((e) => ({
        ts: Math.round((e.at || 0) * 1000),
        feature: e.feature,
        providerId: "",
        model: e.model || "",
        promptTokens: e.prompt_tokens || 0,
        completionTokens: e.completion_tokens || 0,
      }));
    },
    async featurePins() {
      const r = await api.get("/v1/feature-pins");
      return (r.pins || []).map((p) => ({
        feature: p.feature,
        providerId: p.providerId,
        model: p.model || undefined,
      }));
    },
    async setFeaturePin(feature, pin) {
      await api.put("/v1/feature-pins", {
        feature,
        providerId: pin.providerId,
        model: pin.model || "",
      });
    },
  };
}
