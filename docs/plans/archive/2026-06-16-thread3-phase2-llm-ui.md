# Thread 3 (AI-provider standardization) + Phase 2 (shared Vue `llm-ui`)

> ⚠️ **SUPERSEDED** by `docs/plans/2026-06-20-shared-ai-stack-plan.md` (the authoritative AI-stack plan, which folds in the cutover tables). Kept for history.

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
- [~] **T3.5 — seed same defaults.** JustWrite: DONE — added `local-llamacpp`
  (recommended local default) to `DEFAULT_PROVIDERS` (now 7). JustVoice:
  deliberately NOT seeded into the active registry. Finding: JV's
  `engines.llm[]` is the *registered* set (each entry is constructed +
  registered at boot), unlike JW's DEFAULT_PROVIDERS which are *templates* the
  user activates. Seeding it would (a) replace the clean no-pin 501 "add a
  provider" UX with confusing 401s from `adapters[0]`, and (b) seeding
  `local-llamacpp` active would route `speaker_attribution` (P1.5 dispatch
  default) to a dead `127.0.0.1:8080` until P1.5b auto-spawn exists. JV parity
  needs a *suggested-providers catalog* (UI offers to add), separate from the
  active `llm[]` — follow-on; `local-llamacpp` seeding waits for P1.5b.
- [ ] **T3.6 — drop TTS from JW provider model** (`kind:tts|both`, `ttsModel`,
  `ttsVoices`). GATED on Thread 2's Edge/Web-Speech decision (don't break JW
  TTS before the gap is resolved).
- [x] **T3.7 — JV camelCase wire aliases (non-breaking half)** — DONE.
  `LLMProviderConfig` + `FeaturePinConfig` carry `alias_generator=to_camel` +
  `populate_by_name=True`: the API now ACCEPTS snake AND camel input and CAN
  emit camel via `by_alias`. The settings routes pin
  `response_model_by_alias=False`, so `/v1/settings` still EMITS snake
  (renderer unaffected; net emission change = zero) and `settings.json`
  persistence stays snake. Tests: `test_camel_aliases.py` (4). The full
  emission flip (`response_model_by_alias=True` on the provider/pin endpoints)
  is deferred to the renderer's llm-ui adoption — flipping now breaks the live
  snake-reading UI and isn't verifiable in-container.

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
DONE this session: T3.1 (contract), T3.2 (JW pricing), T3.3 (JV REST adapter),
T3.5 JW half (seed local-llamacpp), T3.7 non-breaking half (JV camelCase
aliases, emission still snake). Remaining:
- **T3.4** — JustWrite Pinia adapter for `ProviderBackend` (over its
  `OpenAICompatClient` / `ai` store). In-container-verifiable like T3.3.
- **T3.5 JV half** — suggested-providers catalog (not active-registry seeding;
  see the T3.5 note) + `local-llamacpp` active seeding, gated on P1.5b.
- **T3.6** — drop TTS from JW's provider model. GATED on Thread 2's Edge/
  Web-Speech decision.
- **T3.7 emission flip** — deferred to the renderer's llm-ui adoption.
- **Phase 2 P2.2+** — extract/migrate components (LlmProviderForm first); needs
  the full Vue toolchain in `ui/` + a live-app run to verify (the QC loop).
