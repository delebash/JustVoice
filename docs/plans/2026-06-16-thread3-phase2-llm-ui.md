# Thread 3 (AI-provider standardization) + Phase 2 (shared Vue `llm-ui`)

**Authored 2026-06-16 (admiring-galileo).** Executes SESSION-HANDOFF Threads 3
+ Phase 2 together (they're intertwined: Thread 3 locks the shapes the
`llm-ui` adapter exposes). Single-item queue (RULE #2).

## Key sequencing decision (why the obvious order is wrong)
JustVoice's **current** Vue renderer consumes `/v1/llm-providers` etc. expecting
**snake_case**. Flipping the server to camelCase now would break the live UI
before Phase 2 migrates it. So:
- The shared **camelCase contract lives in `llm-ui`**; translation snake↔camel
  happens in each app's **`ProviderBackend` adapter**, not by flipping servers.
- JustVoice's server stays snake_case until its renderer adopts `llm-ui`
  (then the REST adapter absorbs the shape; a later optional server flip is
  pure cleanup). `settings.json` persists by field-name (`model_dump()` w/o
  `by_alias`, verified `storage/settings_store.py`), so adding Pydantic
  camelCase *aliases* later is non-breaking for persistence.
- JustWrite has **no test runner** (its CLAUDE.md) — JW changes are verified by
  read + (where possible) a vite build, not unit tests.

## Locked shared shapes (camelCase) — `llm-ui/src/types.ts`
```ts
Provider = { id, name, providerType, baseUrl, apiKey?, defaultModel,
             embeddingModel?, timeoutSeconds?, builtIn?, extra? }   // LLM+embed only, no TTS
ProviderDraft = Omit<Provider,"..."> + apiKey write path
FeaturePin = { feature, providerId, model }
UsageRow   = { ts, feature, providerId, model, promptTokens, completionTokens, cost }
ModelEntry = { id, label?, tier? }
DetectedLocalProvider = { providerType, name, baseUrl, models, alreadyRegistered }
TierKey = "quick" | "accuracy" | string
```
`ProviderBackend` (the UI never calls fetch directly):
```ts
interface ProviderBackend {
  listProviders(): Promise<Provider[]>
  addProvider(p: ProviderDraft): Promise<Provider>
  updateProvider(id: string, patch: Partial<ProviderDraft>): Promise<Provider>
  removeProvider(id: string): Promise<void>
  ping(id: string): Promise<{ ok: boolean; message?: string; ms?: number; modelsCount?: number }>
  fetchModels(id: string): Promise<ModelEntry[]>
  detectLocal(): Promise<DetectedLocalProvider[]>
  classifyTier(modelId: string): Promise<TierKey>
  usage(): Promise<UsageRow[]>
  featurePins(): Promise<FeaturePin[]>
  setFeaturePin(feature: string, pin: { providerId: string; model?: string }): Promise<void>
}
```

## Thread 3 queue
- [x] **T3.1 — `llm-ui` package skeleton + locked contract** — DONE
  (just-llm-runner `e2c9da5`). `ui/` package (`@delebash/llm-ui`, vite lib),
  `src/types.ts` (camelCase contract), `src/adapters/ProviderBackend.ts`,
  `src/index.ts`. tsc-verified.
- [x] **T3.2 — JustWrite pricing fix** — DONE (justwrite-app `7390cfe`).
  Corrected `claude-opus-4-7` (was wrongly 15/75 → 5/25), added
  `claude-opus-4-8` (5/25) + `claude-fable-5` (10/50); verified via claude-api.
- [x] **T3.3 — JustVoice REST adapter** — DONE (`services/llmBackend.js`).
  `createJustVoiceBackend(api)` implements `ProviderBackend` over the
  snake_case `/v1/llm-providers*` + `/v1/feature-pins` + `/v1/ai-usage`
  endpoints, mapping to/from the camelCase contract. Verified by
  `scripts/verify-llm-backend.mjs` (11 mocked-fetch checks, no app/build).
- [ ] **T3.4 — JustWrite Pinia adapter** for `ProviderBackend` over its `ai`
  store / `OpenAICompatClient`.
- [ ] **T3.5 — seed same defaults both apps** incl. `local-llamacpp`
  (recommended local). JV seeds none today; JW seeds 6 (drop TTS fields).
- [ ] **T3.6 — drop TTS from JW provider model** (`kind:tts|both`, `ttsModel`,
  `ttsVoices`). GATED on Thread 2's Edge/Web-Speech decision (don't break JW
  TTS before the gap is resolved).
- [ ] **T3.7 — (optional, later) flip JV server to camelCase** once only the
  adapter consumes it (Pydantic alias-generator on response models + tests).

## Phase 2 queue (after the contract + adapters exist)
- [ ] **P2.2 — migrate `LlmProviderForm`** first (JustVoice
  `components/ProviderForm.vue` is the most mature) → `llm-ui`, wired via the
  JustVoice REST adapter.
- [ ] **P2.3 — migrate the rest** one at a time (ModelPicker, ProviderSelect,
  QuickSetup, RecommendCard, UsageView, RunnerStatus[new], DownloadStrip) —
  JustVoice first each time. Source paths: SESSION-HANDOFF Thread 1 table.
- [ ] **P2.4 — JustWrite adopts `llm-ui`** via its Pinia adapter.
- [ ] **P2.5 — delete the now-duplicated per-app source.**

## Status
T3.1 (contract) + T3.2 (pricing) DONE — see SHAs above. The shared camelCase
contract now exists, so both threads can proceed. Next in-container item:
T3.3 (JustVoice REST adapter — plain JS, verifiable with a mocked-fetch node
test). The Phase-2 component migration (P2.2+) needs the full Vue toolchain
installed in `ui/` + a live-app run to verify — best done as a focused pass
on a machine running both apps.
