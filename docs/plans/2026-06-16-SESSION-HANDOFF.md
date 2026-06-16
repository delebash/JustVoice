# Session Handoff — outstanding work (authored 2026-06-16, busy-rubin)

**Master list of everything in flight across JustVoice + JustWrite.** A new
session should read this AFTER `CLAUDE.md` + `MORNING_RECAP.md`. Detailed
plans live in the linked `docs/plans/*` files; this is the index + status.

## Read order for a new session
1. `CLAUDE.md` (rules) + `MORNING_RECAP.md` (recent state).
2. `docs/plans/2026-06-16-builtin-llm-runner.md` — the big active thread
   (STATUS section first).
3. This file — the full outstanding checklist across all threads.

---

## THREAD 1 — Built-in LLM runner (`just-llm-runner`)  ← PRIMARY ACTIVE

Full plan: `docs/plans/2026-06-16-builtin-llm-runner.md`.
Source snapshot: `docs/plans/just-llm-runner-snapshot/` (durability copy;
delete once the standalone repo is populated).

**Locked decisions:** keep Tauri (both apps); shared **Python** core in its
own **private repo `delebash/just-llm-runner`**, consumed as a **git
dependency** (NOT published to PyPI/npm); JustVoice mounts it in-process,
JustWrite bundles it as a small Python sidecar; **camelCase** wire shape;
**CUDA bundled** in the llama.cpp prebuilt (detection only, no toolkit);
one-click via **PyInstaller → Tauri sidecar**.

**DONE (built + tested locally, 11/11, ruff clean):**
- P1.1 — manifest schema (`schema.py`, camelCase `CamelModel`) + loader +
  `runner-manifest.json` + mountable FastAPI router (`api.py`:
  GET `/v1/llm-runner/{manifest,hardware}`).
- P1.2 — binary acquisition (`binary.py`): detect → select asset by
  platform/GPU → download (`download.py`) → unzip. Self-contained
  (`hardware.py` own detection). github-zip path wired; Linux-CUDA docker
  raises (later item).

**OUTSTANDING:**
- [ ] **PUBLISH the repo.** `delebash/just-llm-runner` exists but is EMPTY.
  This session's git proxy allow-lists only justvoice/justwrite-app/
  voicebox, so pushing it returns "repository not authorized." Unblock:
  add `just-llm-runner` to the session's allowed repos (then push from a
  session), OR push the chat tarball from the user's machine
  (`git remote set-url origin https://github.com/delebash/just-llm-runner.git
  && git push -u origin main`).
- [ ] **Switch JustVoice to consume the package.** Delete in-tree
  `server/justvoice/llm_runner/` (pre-extraction copy, commits dfd2283
  /cf3ca91) + its tests; repoint `server/justvoice/api/llm_runner_api.py`
  import `from justvoice.llm_runner` → `from llm_runner`; add the git-dep
  to `server/pyproject.toml`. Then re-run pytest.
- [ ] **P1.3 — GGUF model download.** Add to the package: resolve actual
  filenames from the HF tree by `quant` (HF Hub API `/api/models/{repo}/
  tree`), download the GGUF (+ `mmproj` sidecar if the model needs one) via
  `download.py` into the HF cache layout (so llama.cpp finds it). Progress
  + cancel. (JustVoice already has a plain-HTTPS HF fetcher in installer.py
  to mirror — but the package must be self-contained.)
- [ ] **P1.4 — spawn `llama-server` + VRAM-fit.** Compute `-ngl` /
  `--n-cpu-moe` from detected VRAM + model layer bytes + post-quant KV
  bytes (manifest `vramFit.safetyMarginMb`); compose flags from
  `flagPresets.base` (+ `mtp` for MTP GGUFs); **probe-and-back-off** on OOM
  (retry fewer GPU layers / smaller ctx, remember working config); lifecycle
  (health / stop / cancel). Expose all knobs as overridable settings.
- [ ] **P1.5 — register provider.** Add `local-llamacpp` (OpenAI-compat)
  to JustVoice's LLM registry pointing at the spawned llama-server →
  attribution/rewrite/dictation route to it. **Demote** the transformers
  `qwen3-llm` engine to the no-GPU tiny fallback; **drop its 4B variant**
  (worst trade — heavy VRAM, unquantized).
- [ ] **P1.6 — verify (the proof).** Benchmark a MoE candidate (e.g.
  `unsloth/Qwen3.6-35B-A3B-MTP-GGUF` UD-Q4_K_XL, `--n-cpu-moe`) vs dense-14B
  on the user's REAL speaker-attribution cases. User data so far: 8B fails
  attribution, dense-14B works-but-slow on 8GB. MoE is a CANDIDATE, not a
  mandate — the model is chosen by this benchmark.
- [ ] **Phase 2 — shared Vue `llm-ui`** + camelCase provider-shape
  normalization (see Thread 3). Lives in the same `just-llm-runner` repo
  (npm, git-dep). Detailed below; see Thread 3 for the cross-app
  normalization checklist that pairs with it.

  **Repo layout** (when the Python core is published):
  ```
  just-llm-runner/                # the GitHub repo
    llm_runner/                   # Python package (DONE)
    ui/                           # Vue package — TO BUILD
      package.json                # name: "@delebash/llm-ui" (private),
                                  # build: vite library mode → dist/
      src/
        components/               # the extracted components
        composables/              # useProviders / useModels / useRunner
        adapters/                 # provider-backend adapter (see below)
        styles.css                # tokens needed by the lib
    runner-manifest.json          # shared by both sub-packages
  ```
  Consumed as a git dep: `"@delebash/llm-ui": "github:delebash/just-llm-runner#v0.2.0&path:/ui"`
  (or pin a SHA; submodule is the fallback if path-deps don't work).

  **Provider-backend adapter contract** — the UI never calls fetch
  directly; it gets an object that satisfies:
  ```ts
  interface ProviderBackend {
    listProviders(): Promise<Provider[]>;
    addProvider(p: ProviderDraft): Promise<Provider>;
    updateProvider(id, patch): Promise<Provider>;
    removeProvider(id): Promise<void>;
    ping(id): Promise<{ok, message, ms, modelsCount?}>;
    fetchModels(id): Promise<ModelEntry[]>;
    detectLocal(): Promise<DetectedLocalProvider[]>;
    classifyTier(modelId): Promise<TierKey>;
    usage(): Promise<UsageLedger>;
    featurePins(): Promise<FeaturePin[]>;
    setFeaturePin(feature, pin): Promise<void>;
  }
  ```
  - JustVoice supplies a REST adapter (calls `/v1/llm-providers/*`).
  - JustWrite supplies a Pinia-store adapter (calls its existing
    `OpenAICompatClient` directly).
  - Same components, both apps, no forks.

  **Components to extract (with current source paths so the move is
  mechanical, not exploratory):**

  | Component (in llm-ui) | JustVoice source                                 | JustWrite source                                 |
  |---|---|---|
  | `LlmProviderForm`     | `src/renderer/src/components/ProviderForm.vue`   | `src/renderer/src/views/SettingsProviderForm.vue` |
  | `LlmModelPicker`      | (in ProviderForm; split out)                     | `src/renderer/src/components/ModelPicker.vue`     |
  | `LlmProviderSelect`   | inline in views                                  | `src/renderer/src/components/ProviderSelect.vue`  |
  | `LlmQuickSetup`       | `src/renderer/src/components/QuickSetup.vue`     | `src/renderer/src/services/quickSetupPresets.js` (+ wizard UI) |
  | `LlmRecommendCard`    | `src/renderer/src/components/RecommendCard.vue`  | `src/renderer/src/stores/hardwarePresets.js` (data) |
  | `LlmUsageView`        | `src/renderer/src/views/SettingsView.vue` (AI Usage tab) | `src/renderer/src/stores/ai.js` recordUsage/MODEL_PRICING |
  | `LlmRunnerStatus` (new)| n/a — built fresh on the new runner endpoints   | n/a                                              |
  | `LlmDownloadStrip`    | `src/renderer/src/views/EnginesView.vue` `.jv-install-strip` | reuse the same class |

  **Phasing** (RULE #2 single-item):
  1. Stand up `ui/` skeleton in the published repo (package.json, vite
     lib config, styles passthrough, the adapter interface).
  2. Migrate ONE component (start with `LlmProviderForm` — biggest, most
     mature in JustVoice). Wire JustVoice to consume it via REST adapter.
  3. Migrate the rest one at a time, JustVoice first each time.
  4. Stand up JustWrite's Pinia adapter; wire JustWrite to the same lib.
  5. Delete the now-duplicated source in each app.
- [ ] **Phase 3 — JustWrite** consumes the package as a Python sidecar
  (Tauri externalBin), adopts `llm-ui`.
- [ ] **Packaging (one-click): wire PyInstaller → Tauri sidecar.**
  JustVoice's heavy ML freeze (torch/CUDA, GBs) is UNSOLVED and NOT wired
  in `src-tauri/tauri.conf.json` (no externalBin). JustWrite's core sidecar
  is light (~tens of MB). Per-OS CI matrix; code-signing to avoid AV flags.

**llama.cpp perf knobs (research done — apply in P1.4):** MoE offload
`--n-cpu-moe`; MTP `--spec-type draft-mtp --spec-draft-n-max 3` (needs
MTP-tagged GGUF; best on structured output like attribution); KV-quant
`--cache-type-k/v q8_0`; `--flash-attn on`; `--mlock`. TurboQuant
(`turbo4/turbo3`) is a FORK → experimental/optional only. Plan §5 has detail
+ sources.

---

## THREAD 2 — JustWrite audio removal (audit DONE, work outstanding)

JustVoice owns audio; remove it from JustWrite. Full audit in chat +
`MORNING_RECAP`. Verify file-by-file before deleting.

- [ ] **Remove from JustWrite** (JustVoice already has equivalents):
  `views/SpeakerLabView.vue` (1918) + `services/speakerAttribution.js` (497);
  `views/StudioView.vue` (1434) + `stores/studio.js`; `services/render.js`,
  `m4b.js`, `audioStore.js`; TTS clients `elevenlabs.js`/`speechify.js`/
  `voicebox.js`/`tts.js`/`voiceGender.js`; components `RenderLabPanel.vue`,
  `RenderPresetsCard.vue`, `VoiceParamsModal.vue`. **Keep**
  `services/export/justvoice.js` (the JustVoice handoff).
- [ ] **Resolve gaps FIRST (NOT in JustVoice yet):** Edge TTS (msedge-tts —
  JustVoice marks it *deferred*) and Web Speech (absent in JustVoice). Decide
  if either must land in JustVoice before deleting from JustWrite.
- [ ] **DO NOT remove** (authorial-voice WRITING features, no audio):
  `services/voiceFingerprint.js`, `services/analysis/voiceDrift.js`.

---

## THREAD 3 — Cross-app AI-provider standardization (audit DONE)

Both apps have near-identical provider management (CRUD, fetch-models,
ping, detect-local, quick-setup, tiers, usage ledger, feature pins). JV is
server-side (Python REST); JW is client-side (Pinia/JS). Shared `llm-ui`
(Thread 1 Phase 2) bridges via a provider-backend adapter — this thread
locks the data shapes the adapter exposes.

**Target shared shape (camelCase, LLM+embedding only):**
```ts
Provider = { id, name, providerType, baseUrl, apiKey, defaultModel,
             embeddingModel, timeoutSeconds, builtIn, extra }
FeaturePin = { feature, providerId, model }
UsageRow   = { ts, feature, providerId, model, promptTokens,
               completionTokens, cost }
```

**Field-shape diff to close:**
- JustWrite already camelCase (`chatModel`/`baseUrl`) — but carries TTS
  fields (`kind: tts|both`, `ttsModel`, `ttsVoices`) to be dropped.
- JustVoice `models.py LLMProviderConfig` is snake_case (`provider_type`,
  `base_url`, `default_model`, `embedding_model`, `timeout_seconds`). Two
  options: full rename, OR add Pydantic alias-generator (`to_camel`,
  `populate_by_name=True`) — same pattern the new `llm_runner` package
  uses. Prefer aliasing first (non-breaking), full rename in a follow-up.

**Checklist:**
- [ ] JustVoice: add camelCase aliases to `LLMProviderConfig` +
  `FeaturePinConfig` + usage payloads (alias-generator pattern); set
  `response_model_by_alias=True` on the related endpoints.
- [ ] JustWrite: drop TTS-in-provider model. Remove `kind: tts|both`,
  `ttsModel`, `ttsVoices` from `DEFAULT_PROVIDERS` (`domain/seed.js`) and
  the `ai` store. Migrate existing user data (split TTS providers into
  audio handed off to JustVoice).
- [ ] **Seeded defaults — make both match:** 7 entries =
  `openai-compat-local` (Ollama/LM Studio), `openai`, `claude`, `gemini`,
  `deepseek`, `openrouter`, **`local-llamacpp`** (the new built-in,
  recommended-local default). JV currently seeds none; JW seeds 6.
- [ ] **Feature pins**: unify shape across apps (id-by-feature; JV's
  `feature_pins` list + `llm_roles` collapses to JW's
  `{ feature: pin }` map or vice-versa — pick one).
- [ ] **Usage ledger**: unify. JV has `/v1/ai-usage`; JW has client-side
  `MODEL_PRICING` + `recordUsage`. Decide canonical home (recommend:
  server-side for JV, client-side IDB for JW; both expose the same shape
  to the shared `LlmUsageView`).
- [ ] **Fix stale data**: JW `stores/ai.js` `MODEL_PRICING` has
  `claude-opus-4-7`, missing `claude-opus-4-8`. Move pricing into the
  `runner-manifest.json` so it's data-not-code in BOTH apps?
  (decide — possibly out of scope for v0).

---

## THREAD 4 — Engines Download/Load (DONE this session — verify on user box)

Shipped + pushed (JustVoice): source overrides (S0), unified prefetch
worker (S1), per-variant state (C1/C2), cancel + big inline progress strip
(S2/C3), source pill (C4), progress accuracy (smooth bar through download+
extract), Ollama-style **one-button** collapse, Dismiss on failed strips,
and **ripped the `huggingface_hub` dep** (server now streams HF via plain
HTTPS + writes the cache layout itself). Plans: `2026-06-14-engines-
download-contract.md`, `-progress-accuracy.md`, `2026-06-15-engines-one-
button.md`.

- [ ] **USER VERIFICATION:** confirm Qwen3 (and other HF engines) download
  + load works on the user's Windows box with the plain-HTTPS fetcher (the
  original "huggingface_hub is required" / "_Reporter get_lock" errors that
  drove the rip). Not yet confirmed live by the user.

---

## Locked decisions (quick reference)
- Tauri for both apps (Electron + pywebview rejected). Rust = thin shell
  plumbing only; no LLM logic in Rust.
- Shared **Python** core for the LLM runner, own private repo, **git-dep**
  (not published). JustVoice mounts; JustWrite = light Python sidecar.
- camelCase wire shape everywhere new.
- CUDA: prebuilt llama.cpp bundles cudart; **no toolkit install**; detect +
  pick build; only the NVIDIA driver is a prereq.
- One-click installers via Tauri; Python frozen via PyInstaller sidecar.
- Model: MoE (Qwen3.6-35B-A3B class) is the leading CANDIDATE for low-VRAM
  attribution — confirm by benchmark (P1.6).

## Non-repo loose ends
- Claude Code UI reverting model 4.7→4.8 on refresh = harness/account
  setting, not a codebase issue. No action in repos.
