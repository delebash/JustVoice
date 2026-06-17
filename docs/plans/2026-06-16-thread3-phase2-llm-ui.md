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
- [ ] **T3.1 — `llm-ui` package skeleton + locked contract** (Phase 2 step 1
  merged here — it IS the shape lock). `just-llm-runner/ui/`: package.json
  (`@delebash/llm-ui`, vite lib), tsconfig, vite.config.ts, `src/types.ts`,
  `src/adapters/ProviderBackend.ts`, `src/index.ts`. tsc-verified. ← FIRST
- [ ] **T3.2 — JustWrite pricing fix.** `stores/ai.js MODEL_PRICING`:
  `claude-opus-4-7` → `claude-opus-4-8` (+ keep 4-7 if still offered). Safe data fix.
- [ ] **T3.3 — JustVoice REST adapter** for `ProviderBackend` (translates the
  existing snake_case `/v1/llm-providers*` + `/v1/ai-usage` + feature_pins ↔
  camelCase). Lives app-side (`src/renderer/src/services/llmBackend.js`).
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
T3.1 in progress (this session).
