# Session Handoff — outstanding work (authored 2026-06-16, busy-rubin)

**Master list of everything in flight across JustVoice + JustWrite.** A new
session should read this AFTER `CLAUDE.md` + `MORNING_RECAP.md`. Detailed
plans live in the linked `docs/plans/*` files; this is the index + status.

## Read order for a new session
1. `CLAUDE.md` (rules) + `MORNING_RECAP.md` (recent state).
2. `docs/plans/2026-06-16-builtin-llm-runner.md` — the big active thread
   (STATUS section first).
3. This file — the full outstanding checklist across all threads.

## First 30 minutes — do this exactly
1. Read the three docs above in order.
2. **Check publish status of `delebash/just-llm-runner`**:
   `git ls-remote https://github.com/delebash/just-llm-runner.git 2>&1`
   - If repo is empty → ask the user: "did you push the tarball, or should I
     try pushing now?" If session scope now includes the repo, push from
     the in-repo snapshot:
     ```bash
     cp -r docs/plans/just-llm-runner-snapshot ~/just-llm-runner
     cd ~/just-llm-runner && git init && git add -A
     git commit -m "init from snapshot" -S
     git remote add origin <session-proxy-url>/delebash/just-llm-runner
     git push -u origin main
     ```
   - If the repo is populated → proceed to step 3.
3. **JustVoice switchover** (only after the standalone repo exists):
   ```bash
   cd /home/user/JustVoice/server
   rm -rf justvoice/llm_runner tests/test_llm_runner_manifest.py tests/test_llm_runner_binary.py
   # repoint the API router import:
   sed -i 's|from ..llm_runner|from llm_runner|' justvoice/api/llm_runner_api.py
   # add the git-dep (pin a SHA when there's one):
   #   in pyproject.toml dependencies: "llm-runner @ git+https://github.com/delebash/just-llm-runner.git@main"
   pip install -e .
   ruff check . && python -m pytest -q
   ```
4. Then continue at **P1.3 — GGUF model download** (see Thread 1 below).

## Decision-replay (so a new session doesn't re-litigate)
- **Why not "just recommend Ollama"?** User wants zero external install
  (one-click), and Ollama hides the per-flag tuning we need
  (`--n-cpu-moe`, MTP, KV-quant). We support Ollama AS a provider
  alongside the built-in runner, not instead of it.
- **Why not a shared Rust crate?** Tried; user values "easiest to maintain
  + one-click." JustVoice already needs Python (STT/TTS); a Python core
  shares the most (runner + full provider registry + manifest) without
  forcing a second language. Rust = thin shell plumbing only.
- **Why not pywebview + PyInstaller everywhere (drop Rust)?** Considered.
  Tauri's first-party signed auto-updater + mature msi/dmg/deb packaging +
  the fact that both apps already WORK on Tauri outweighs the
  one-language win. Don't rewrite working shells.
- **Why not Electron?** ~150MB Chromium+Node bundle, memory, slow start.
- **Why share via a private git-dep, not pip/npm publish?** The core isn't
  an independent product. Internal libs over git deps satisfy both apps
  with zero registry overhead. End users never install it (frozen into
  the bundle via PyInstaller → Tauri sidecar).
- **Why MoE candidate (Qwen3.6-35B-A3B), not dense 14B/8B?** User verified
  8B fails attribution and dense-14B is slow on 8GB. MoE's `--n-cpu-moe`
  offload lets a "bigger" model run faster on low VRAM (only ~3.6B active
  params/token). It's a CANDIDATE — P1.6 benchmark picks the actual model.
- **Why camelCase?** User decision 2026-06-16. The shared UI lives in
  Vue + the manifest is data-the-UI-reads; one shape across the wire and
  in the JSON keeps things mechanical.

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
- [ ] **P1.3 — GGUF model download.** Working reference already exists in
  JustVoice at `server/justvoice/installer.py::_hf_snapshot_to` (line ~660;
  see commit 037f474 — the `huggingface_hub`-dep rip). Port the same logic
  into `just-llm-runner/llm_runner/models.py` (new file).
  Endpoints to call (no auth for public repos):
  ```
  GET https://huggingface.co/api/models/{repo}/revision/{rev}  → commit sha
  GET https://huggingface.co/api/models/{repo}/tree/{rev}?recursive=true
       → file list (filter by `quant` substring + ".gguf"; also pull
         mmproj-*.gguf if manifest entry.mmproj is set)
  GET https://huggingface.co/{repo}/resolve/{rev}/{path}       → file bytes
  ```
  HF cache layout the worker writes (so llama.cpp finds files):
  ```
  ~/.cache/huggingface/hub/models--<owner>--<repo>/
    refs/<rev>            # text: commit sha
    blobs/<oid>           # actual file
    snapshots/<sha>/<path>  # relative symlink → ../../blobs/<oid>
                             # (copy fallback on Windows w/o symlink priv)
  ```
  Resolve cache root from env: `HF_HUB_CACHE` → `$HF_HOME/hub` →
  `~/.cache/huggingface/hub`. Reuse `download.stream_download`.
  Expose `select_files(repo, quant, mmproj)` + `acquire_model(repo, quant)`
  → returns the snapshot dir path llama.cpp loads from.
- [ ] **P1.4 — spawn `llama-server` + VRAM-fit.**
  **VRAM-fit formula** (in `runner.py` new file):
  ```
  layerBytes  = totalParamBytes / nLayers                     # from GGUF header
  activeKvMb  = ctxLen * nLayers * dim * 2 * (4 if cache_type_k=="q8_0" else 2) / 1e6
  budgetMb    = detectedVramMb − vramFit.safetyMarginMb       # manifest
  nGpuLayers  = min(nLayers, max(0, floor((budgetMb − activeKvMb) / layerBytes)))
  # for MoE models, prefer offloading expert layers to CPU:
  nCpuMoe     = max(0, nMoeLayers − nGpuLayers)
  ```
  Compose: `flagPresets.base + (flagPresets.mtp if model.mtp) +
  ["--n-gpu-layers", str(nGpuLayers), "--n-cpu-moe", str(nCpuMoe),
   "-m", <gguf_path>, "--port", str(port), "--host", "127.0.0.1"]`.
  **Probe-and-back-off**: spawn → wait ≤30s for `/health` 200 OR exit. If
  CUDA OOM in stderr or non-zero exit, retry with `nGpuLayers -= 4`
  (minimum 0). Cache the working `(model_id, nGpuLayers, nCpuMoe, ctx)`
  triple in `cache_root/llamacpp/working-configs.json` so subsequent
  loads skip probing.
  Lifecycle: `Runner.start(model_id) -> Runner`, `.stop()`, `.url`,
  `.health()`, `.is_alive()`. All knobs overridable via settings (passed
  in as `Overrides{nGpuLayers, nCpuMoe, ctx, extraFlags}`).
- [ ] **P1.5 — register provider + demote built-in qwen3-llm.**
  In `server/justvoice/engines/llm/`:
  - Add adapter `local_llamacpp.py` (~50 lines: OpenAI-compat client
    pointing at `http://127.0.0.1:<port>/v1`, started by the runner).
  - Register `"local-llamacpp"` provider type in `registry.py` `construct()`.
  - In `server/justvoice/engines/model_catalog.py::_qwen3_llm_variants`:
    delete the 4B row (`("qwen3-llm-4b", ..., 8000, 9000, 85, ...)`).
    Keep 0.6B/1.7B as fallbacks.
  - In `manifest.py` for qwen3_llm, mark `REQUIREMENTS["preferred"]=False`
    or similar so it's not the auto-recommend.
  - Wire `feature_pins` for `speakerAttribution` to default to
    `local-llamacpp` when present.
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
  Two-bundle architecture:
  | App        | Bundle             | Source                       | Size est. |
  |---|---|---|---|
  | JustVoice  | `justvoice-server` | `server/` (full ML server)   | 2–4 GB (torch + CUDA + sherpa-onnx)
  | JustWrite  | `llm-runner-sidecar`| `just-llm-runner/` only      | 30–60 MB |
  Tauri externalBin naming requires the target triple appended:
  ```json
  // src-tauri/tauri.conf.json
  "bundle": { "externalBin": ["binaries/justvoice-server"] }
  // CI produces: binaries/justvoice-server-x86_64-pc-windows-msvc.exe,
  // binaries/justvoice-server-aarch64-apple-darwin, etc.
  ```
  PyInstaller spec per OS:
  ```bash
  pyinstaller --onefile --name justvoice-server \
    --hidden-import sherpa_onnx --hidden-import torch \
    --collect-data torch --add-binary "<cuda.dll>:." \
    server/justvoice/cli.py
  ```
  **Known issues (verified gotchas, not speculation):**
  - Windows: onefile exes trip Windows Defender — must code-sign (EV cert)
    OR ship as onedir (folder install, no AV scan).
  - macOS: must notarize OR users get "developer unidentified" block.
  - torch wheels include MASSIVE optional deps (~3GB); use
    `--exclude-module torchvision --exclude-module torchaudio` if unused.
  - CUDA: bundled cudart.dll/.so is per-CUDA-version; ship CUDA-12 and
    CUDA-13 variants (matches the llama.cpp asset matrix).
  - Linux: `.deb`/`.AppImage` from Tauri; appimage needs `--no-strip` for
    Python extensions or it segfaults.
  Per-OS CI matrix (GitHub Actions): `windows-latest`, `macos-14` (arm64),
  `ubuntu-latest`. Build llama.cpp asset is NOT bundled (downloaded at
  first run from the manifest's pinned build).

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
- [ ] **Resolve gaps FIRST (NOT in JustVoice yet):**
  - **Edge TTS** (Microsoft Edge "Read Aloud"): JustWrite calls it through
    a Rust crate via Tauri bridge — see `services/tts.js` "special-case
    providers wired through the Tauri bridge (currently: Microsoft Edge
    "Read Aloud" via the msedge-tts Rust crate)." The Rust IPC lives in
    `src-tauri/src/lib.rs`. JustVoice's stub: `engines/tts_providers/`
    (the `edge-tts` entry is marked deferred — "needs Tauri-side msedge-
    tts wiring"). **Decision needed**: port the msedge-tts Rust binding
    to JustVoice's Tauri shell, OR drop Edge TTS support.
  - **Web Speech** (browser realtime preview): JustWrite has it as a
    `realtimeOnly` provider in `services/webSpeech.js`. **Decision needed**:
    JustVoice has none — port (it's pure browser-side, no Rust needed),
    OR drop realtime preview.
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

- [ ] **USER VERIFICATION on real hardware.**
  **Repro steps:**
  1. Pull/build current main on the user's Win10 box (RTX 2070 SUPER).
  2. Start the server: `cd server && pip install -e .[kokoro] &&
     justvoice-server serve`.
  3. Open the desktop app → Engines tab.
  4. Click "Load" on a Qwen3 row (HF-distributed engine).
  **Previous symptoms (now expected to be GONE):**
  - "huggingface_hub is required for HF-distributed engines but isn't
    available in this Python environment" → fixed by 037f474 (rip the
    dep, stream via plain HTTPS, write HF cache layout ourselves).
  - "type object '_Reporter' has no attribute 'get_lock'" → moot; the
    tqdm-shaped reporter is gone with the dep.
  - FAILED strip stuck with no dismiss → fixed by f3189e0 (Dismiss button).
  **Success criteria:**
  - Download progress strip shows real bytes + MB/s + ETA, smooth across
    download → extract phases (no freeze at extracting-model).
  - Files land in `~/.cache/huggingface/hub/models--<owner>--<repo>/` with
    correct refs/blobs/snapshots layout (`huggingface_hub.try_to_load_from
    _cache` finds the config.json once it's published — not testable
    without the dep, but the on-disk shape is the contract).
  - Load completes; first generation succeeds.

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
