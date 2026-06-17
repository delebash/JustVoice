# Built-in LLM Runner + Cross-App AI-Provider Standardization

**Authored 2026-06-16 (busy-rubin).** Spans **JustVoice** and **JustWrite**.
This doc is the single source of truth for the built-in local LLM runner
and the shared AI-provider/LLM UX across both products. A fresh session
should be able to read this and continue without re-deriving anything.

---

## STATUS (2026-06-16, busy-rubin) — read this first

**Architecture FINAL** (no more churn): both apps keep **Tauri**; the LLM
runner is a **shared Python package** in its **own private repo
`just-llm-runner`**, consumed as a **git dependency** (not published).
JustVoice mounts it; JustWrite bundles it as a small Python sidecar. Shared
Vue `llm-ui` later. camelCase wire shape. CUDA bundled in the llama.cpp
prebuilt (detection only, no toolkit). See §2.

**Code state:**
- ✅ **PUBLISHED.** `delebash/just-llm-runner` is populated (origin/main
  @ `5dff329`) and IN this session's repo scope. The package (P1.1 manifest
  schema + loader + mountable router; P1.2 binary acquisition
  detect→select→download→unpack) is self-contained (own `hardware.py` +
  `download.py` + `api.py`). Cloned locally at `/home/user/just-llm-runner`.
- ✅ **SWITCHOVER DONE (2026-06-16, admiring-galileo).** JustVoice now
  consumes the external package:
  - `server/justvoice/app.py` mounts the package's shared router directly:
    `from llm_runner import router as llm_runner_router` →
    `app.include_router(llm_runner_router)`. This is the package's intended
    surface ("both apps mount this router") and **gains `/v1/llm-runner/
    hardware`** (the in-tree shim only served `/manifest`).
  - Deleted: in-tree `server/justvoice/llm_runner/`, the JustVoice shim
    `server/justvoice/api/llm_runner_api.py`, and the two in-tree unit
    tests (`test_llm_runner_{manifest,binary}.py` — they patched
    `justvoice.installer`/`SystemInfo`, which the self-contained package no
    longer uses; those unit tests live in the just-llm-runner repo now).
  - Added `server/tests/test_llm_runner_mount.py` — a JustVoice-level
    integration test (router mounted; `/manifest` + `/hardware` serve
    camelCase via `create_app`).
  - `server/pyproject.toml`: dropped the dead `justvoice.llm_runner`
    package-data; added the git-dep, pinned to the SHA (no tag yet):
    `llm-runner @ git+https://github.com/delebash/just-llm-runner.git@5dff3295…`.
    **Dev uses an editable install** (`pip install -e ../just-llm-runner`),
    which takes precedence over the pin.
  - **Snapshot deleted**: `docs/plans/just-llm-runner-snapshot/` removed
    (its durability purpose is served now that the standalone repo exists).
  - Verify: ruff clean; `test_llm_runner_mount.py` passes; 257/262 suite
    pass. The 5 non-passers are container-env-only (4 = `fastmcp` not
    installed; 1 = `test_app_boot._route_paths` predates FastAPI 0.137's
    `_IncludedRouter`) — none caused by the switchover.

**Next steps:**
1. ✅ ~~Push `just-llm-runner`~~ — DONE (published, in scope).
2. ✅ ~~Switch JustVoice to consume it~~ — DONE (see above).
3. ✅ ~~P1.3 model download~~ — DONE (2026-06-16, admiring-galileo).
   `just-llm-runner/llm_runner/models.py`: `select_files(repo, quant, mmproj)`
   resolves real GGUF filenames from the HF tree (grabs shards + mmproj);
   `acquire_model(...)` streams them into the HF cache layout
   (blobs/snapshots/refs) llama.cpp loads from, idempotent. 5 tests (16
   total). Pushed to just-llm-runner @ `fdf1ebe`; JustVoice git-dep pin
   bumped to it.
4. ✅ ~~P1.4 spawn `llama-server` + VRAM-fit~~ — DONE (2026-06-16,
   just-llm-runner @ `95e001e`). `gguf.py` (header reader) + `runner.py`:
   `compute_fit` (-ngl/--n-cpu-moe from detected VRAM + KV reserve; corrected
   the sketch's inverted q8_0 KV-byte constant), `compose_flags` (manifest
   presets + MTP), `start_runner`/`Runner` (spawn → /health → shed GPU layers
   on CUDA OOM and retry; start/stop/health/url). 12 tests, all mocked.
   **Deferred sub-item:** persistent working-config cache
   (`working-configs.json`) — back-off currently re-probes on each start;
   cheap to add when there's real hardware to validate against.
5. ✅ ~~P1.5 register `local-llamacpp` provider + demote qwen3-llm~~ — DONE
   (2026-06-16, JustVoice). `local-llamacpp` is now an OpenAI-compat provider
   type (reused `OpenAICompatAdapter` — it already speaks llama.cpp's server —
   instead of a redundant new adapter file), default base `127.0.0.1:8080/v1`.
   qwen3-llm demoted: 4B variant dropped (catalog + manifest + engine map),
   reframed as the lightweight fallback. Dispatch defaults `speaker_attribution`
   to `local-llamacpp` when registered; role recommendations classify it local
   and rank it above the qwen3 fallback. 4 tests; suite green.
6. **P1.5b — auto-spawn orchestration** ← NEXT, but HARDWARE-GATED. Glue that
   ties P1.2 (acquire_binary) + P1.3 (acquire_model) + P1.4 (compute_fit /
   start_runner) into a lifecycle that boots llama-server on first use and
   registers a live `local-llamacpp` adapter at its URL (default_model = the
   loaded GGUF). NOT written yet — it can only be validated with a real GPU +
   multi-GB downloads, so it's built+validated WITH P1.6 (writing it blind in
   the container would invite rework — RULE #2).
7. **P1.6 — benchmark (the proof).** MoE candidate vs dense-14B on the user's
   real attribution cases, on the user's GPU. Chooses the actual model.

---

## 0. Why this exists (user intent, verbatim-ish)

- Local speaker attribution needs a **14B-class model**; the user verified
  8B fails attribution, dense-14B works but is slow on an 8GB card
  (RTX 2070 SUPER, Windows 10). Wants it fast enough via the right flags,
  and flexible across hardware (CPU-only → 8GB → 24GB+).
- Wants a **built-in LLM runner** (zero external install) **in addition to**
  the existing "point at Ollama / remote / cloud" options — standardized
  across **both** JustVoice and JustWrite.
- Wants a **common LLM provider UI** (local / online / built-in "fast"
  default) shared by both apps; "features should match for both."
- Wants to **remove audio (speaker/cast/render/TTS) from JustWrite** —
  that is JustVoice's job — but is unsure what voice code is still in
  JustWrite and whether everything was migrated.
- **HARD REQUIREMENT (2026-06-16): both apps are one-click installer / exe,
  cross-platform; the user installs NOTHING** — no Python, no Ollama, no
  CUDA toolkit. Everything ships with the product (Python frozen into the
  bundle via PyInstaller→Tauri sidecar) or is auto-downloaded on first run
  (llama.cpp binary + GGUF). The *user* installs nothing either way.
- **Field shape: camelCase** (chosen 2026-06-16).
- **Shell: keep Tauri for BOTH** (chosen 2026-06-16). User values Tauri's
  lightness; Electron/Node rejected (≈150MB bundle). pywebview+PyInstaller
  considered (all-Python, no Rust) but rejected: don't rewrite two working
  Tauri shells + lose Tauri's auto-updater/signing. The Rust kept is just
  thin shell plumbing — NO LLM logic in Rust.
- **Python in JustWrite is FINE** (user corrected 2026-06-16 — I had wrongly
  been protecting "no Python in JustWrite"). The real criteria are *easiest
  to maintain + one-click*. JustVoice MUST have Python (STT/TTS) anyway, so
  a shared **Python** core is the least-friction single implementation.
- **The runner is a SHARED PYTHON package** — its own private repo
  `just-llm-runner`, consumed as a **git dependency** (NOT published to
  PyPI/npm; not independently a product). JustVoice mounts it in-process;
  JustWrite bundles it as a small Python sidecar (no ML deps). See §2.
- **CUDA: no toolkit install, ever.** The prebuilt llama.cpp asset bundles
  the CUDA *runtime* (cudart). We only DETECT (platform/GPU/driver) and
  pick the matching build. Only prereq = the NVIDIA driver (user has it).
- llama.cpp specifics (MTP, MoE offload, TurboQuant) researched — see §5.

---

## 1. Verified research (llama.cpp performance) — see web sources in session

- **Ollama is built on llama.cpp** (same kernels). llama.cpp's measured edge
  is ~13% generation / ~10x prompt-processing — minor for generation.
- **For an 8GB card the dominant factor is model fit, not runtime.** A dense
  14B (~8.1GB Q4) does not fit 8GB → partial CPU offload → ~5–10 tok/s.
  An 8B fits fully (~40 tok/s) but the user proved 8B fails attribution.
- **A MoE model is a strong CANDIDATE, not a mandate.** Qwen3.6-35B-A3B
  (35B total, ~3.6B active/token) was the *illustrative example* that
  MoE + `--n-cpu-moe` offload lets modest VRAM punch above its weight
  (idle experts offloaded to RAM; only ~3.6B compute/token; ~30 tps on
  6GB verified, 17 tps on a GTX 1060). The PRINCIPLE is what matters, not
  this exact model — the attribution model is chosen by BENCHMARK on real
  cases, from the tiered catalog (§5), NOT pre-decided as 35B.
- **All GGUFs are pulled from HuggingFace.** "Unsloth" is an HF org
  (`huggingface.co/unsloth/...`), known for dynamic "UD-" quants + MTP
  GGUFs; `Qwen` (official) and `bartowski` are alternatives. The manifest
  stores `hfRepo` + `quant`; the runner resolves filenames from the HF
  tree at download time (no hardcoded/fabricated filenames).
- **Flags that matter (all MAINLINE llama.cpp):**
  - `-ngl 999` (all layers to GPU, back off on OOM)
  - `--n-cpu-moe N` (offload N expert layers to CPU RAM — the MoE lever)
  - `--flash-attn on` (20–50% less KV-cache VRAM, no downside on CUDA)
  - `--cache-type-k q8_0 --cache-type-v q8_0` (halve KV-cache VRAM)
  - `--mlock` / `--no-mmap` (pin in RAM / disable mmap)
  - MTP speculative decoding: `--spec-type draft-mtp --spec-draft-n-max 3`
    (needs an MTP-tagged GGUF, e.g. `...-MTP-...`; best on structured
    output like attribution; favors full-GPU more than CPU-offload).
- **TurboQuant** (`--cache-type-k turbo4 --cache-type-v turbo3`): real
  (arXiv 2504.19874, ICLR 2026), 72–78% KV-cache reduction, but it's a
  **FORK** (TheTom/llama-cpp-turboquant) → **experimental/optional only**,
  never a hard dependency. The headline config (MoE + q8_0 KV + MTP) is
  fully mainline.
- **Distribution**: official llama.cpp GitHub releases ship Windows CUDA
  binaries with **cudart bundled** (`cudart-llama-bin-win-cuda-12.x-x64.zip`),
  macOS Metal binaries, and official Docker CUDA images
  (`ghcr.io/ggml-org/llama.cpp:server-cuda*`). Linux bare CUDA binaries are
  less consistent (use Docker image or a vetted third-party prebuilt).
  **Pin exact build tags** — "latest" breaks when the API changes. Only the
  NVIDIA *driver* is a user prerequisite (same as Ollama); cudart is bundled.
- **Model gotcha**: some MoE GGUFs ship a **two-file pair** (main GGUF +
  `mmproj` sidecar) and recent llama.cpp won't load without the mmproj even
  for text-only. The runner must fetch both.

`llama-server` is **OpenAI-compatible** (`/v1/chat/completions`), and as of
2026 also speaks the Anthropic Messages API. Both apps already have
OpenAI-compatible clients, so the "talk to it" layer is already standard.

---

## 2. Architecture decision — FINAL (2026-06-16)

User's actual criteria (corrected): NOT "no Python in JustWrite" — rather
**easiest to maintain + one-click install**, with a **common core API +
common GUI** for the LLM piece (detect hardware, manage/recommend models,
download llama.cpp + CUDA, spawn). User delegated the how ("not fixed on
any particular way"). JustVoice MUST have Python (STT/TTS). Both desktop
apps are Tauri + Vue (webview).

Decision history (each move was constraint-driven, not churn): recommend-
Ollama → shared Rust crate → shared Python package → per-app (under a
mistaken "no-Python-in-JustWrite") → **FINAL: shared Python core + shared
Vue GUI, both apps on Tauri.** The mistaken constraint is lifted; this is
the simplest design and reuses the work already done (P1.1/P1.2).

### 2.1 The design
- **Shared Python core** (`llm_runner`): the LLM REST API + runner —
  hardware detection, model catalog/recommendation, llama.cpp binary +
  GGUF + CUDA download, VRAM-fit, spawn/lifecycle of `llama-server`
  (OpenAI-compatible). **Self-contained** (own download + HW detection —
  NO dependency on JustVoice's installer/system_info) so it runs
  standalone in JustWrite too.
- **Shared Vue GUI** (`llm-ui`): provider config, model browser/download,
  runner status, quick-setup, usage. Talks to the core's REST API —
  identical in both apps.
- **Both apps stay Tauri** (lite, mature, cross-platform one-click
  installers). Rust = shell plumbing only; **no LLM logic in Rust**.
- **JustVoice**: mounts the core's router in-process (already Python).
- **JustWrite**: bundles the core as a SMALL Python sidecar (LLM core
  only — no torch/ML), spawned by its Tauri shell (Tauri externalBin).

### 2.2 Why this is easiest-to-maintain + one-click
- ONE core implementation (Python), ONE GUI (Vue), ONE shell tech (Tauri)
  → no per-app duplication, no two-language split, no shell rewrite.
- One-click: Tauri bundlers emit msi/exe, dmg/app, deb/AppImage; the
  Python core ships as a bundled sidecar (PyInstaller/PyOxidizer →
  Tauri externalBin). JustVoice needs Python bundling regardless; Just
  Write's sidecar is light (no ML).
- The volatile data stays in the shared `runner-manifest.json` (camelCase).

### 2.3 Headless JustVoice server
The Python core is mountable in the headless `justvoice-server serve`
too (it's a FastAPI router), so headless deployments CAN have the built-in
runner — or point at an external LLM. No special-casing needed (this is
why a Python core beats a Tauri-only Rust crate: it works in every mode).

### 2.4 Cross-repo sharing — DECIDED (2026-06-16)
**Own private git repo `just-llm-runner`** (NOT published to PyPI/npm — it's
not independently a product). Both apps consume it as a **git dependency**
(pinned tag for release; editable/path install during dev). End users never
install it — it's frozen into each app's bundle. Submodule/monorepo were
the alternatives; standalone repo + git-dep chosen (keeps the apps as the
separate repos they already are). The Vue `llm-ui` (npm) will live in the
same repo, consumed as a git dependency too.

### 2.5 The built-in runner is just another provider

It registers as provider type `local-llamacpp` (OpenAI-compat) in each app's
existing provider registry, **alongside** Ollama / remote / cloud — not
replacing them. The transformers-based `qwen3-llm` engine in JustVoice is
**demoted** to the no-GPU tiny fallback.

---

## 3. Cross-app AI-provider audit (verified file-by-file 2026-06-16)

### 3.1 Capability parity — both apps already implement the same set

| Capability | JustWrite (client-side JS/Pinia) | JustVoice (server-side Python REST) |
|---|---|---|
| CRUD providers | `stores/ai.js` actions | `/v1/llm-providers` |
| Fetch models | `fetchModels` (splits chat/embed/tts) | `/v1/llm-providers/{id}/models` |
| Ping/test | `pingClientFor` | `/v1/llm-providers/{id}/ping` |
| Detect local | `detectRunner` | `/v1/llm-providers/detect-local` |
| Quick-setup wizard | hardware-tier presets | `detect→confirm→install→done` |
| Model tiers | `services/modelMeta.js TIERS` | `engines/llm/tiers.py` + `classify-tier` |
| VRAM recommend | `stores/hardwarePresets.js` | `recommend_for_vram` / RecommendCard |
| Usage ledger | `MODEL_PRICING` + `recordUsage` | `/v1/ai-usage` |
| Feature pins | `featurePins` | `feature_pins` + `llm_roles` |

**Structural split**: JustVoice provider logic is server-side (Python REST);
JustWrite's is client-side (renderer). The shared `llm-ui` bridges this via
a provider-backend adapter.

### 3.2 Provider model shapes (normalize to camelCase)

- **JustWrite** (`domain/seed.js DEFAULT_PROVIDERS`):
  `{ id, name, kind: "llm"|"tts"|"both", runner, baseUrl, chatModel,
     ttsModel, ttsVoices, builtIn }` — LLM **and** TTS mixed.
- **JustVoice** (`models.py LLMProviderConfig`, snake_case):
  `{ id, name, provider_type, base_url, api_key, default_model,
     embedding_model, timeout_seconds, extra }` — LLM only.
- **Target shared shape (camelCase, LLM+embedding only)**:
  `{ id, name, providerType, baseUrl, apiKey, defaultModel, embeddingModel,
     timeoutSeconds, builtIn, extra }`.
  - Drop TTS fields/clients from JustWrite (audio → JustVoice).
  - JustVoice currently snake_case server-side → new shared surfaces use
    camelCase (Pydantic alias generator / `populate_by_name`); a full
    rename of existing endpoints is a follow-up, not a blocker.

### 3.3 Seeded defaults

- JustWrite seeds 6 (local openai-compat, OpenAI, Claude, Gemini, DeepSeek,
  OpenRouter). JustVoice seeds **none** (`llm: list = []`).
- **Target**: both seed the same set **plus** the built-in `local-llamacpp`
  runner as the recommended local default ("fastllm default").
- Stale data to fix: JustWrite `MODEL_PRICING` has `claude-opus-4-7`,
  missing `claude-opus-4-8`.

---

## 4. Voice-migration audit (JustWrite → remove; JustVoice owns audio)

### 4.1 Remove from JustWrite (JustVoice already has equivalent)
- `views/SpeakerLabView.vue` (1918) + `services/speakerAttribution.js` (497)
  — JustVoice has speaker discovery (18 files).
- `views/StudioView.vue` (1434) cast/script/render + `stores/studio.js` (369).
- `services/render.js` (167), `m4b.js` (149), `audioStore.js` (126).
- TTS clients: `elevenlabs.js`, `speechify.js`, `voicebox.js`, `tts.js`,
  `voiceGender.js` — JustVoice has `engines/tts_providers/*` + engine pool.
- Components: `RenderLabPanel.vue`, `RenderPresetsCard.vue`,
  `VoiceParamsModal.vue`.
- **Keep** `services/export/justvoice.js` — it's the JustWrite→JustVoice
  handoff, not audio rendering.

### 4.2 Gaps — NOT in JustVoice yet; resolve BEFORE deleting from JustWrite
- **Edge TTS (msedge-tts)** — JustVoice marks it *deferred* ("needs
  Tauri-side msedge-tts wiring"). JustWrite has it working via a Rust crate.
- **Web Speech** — 0 references in JustVoice; JustWrite uses it for realtime
  preview (preview-only provider).

### 4.3 DO NOT remove — "voice" in name but WRITING features (no audio)
- `services/voiceFingerprint.js` ("match my style" — authorial voice).
- `services/analysis/voiceDrift.js` (style-consistency analytics).
  Both confirmed to have zero TTS/audio references.

---

## 5. `runner-manifest.json` schema (camelCase)

```jsonc
{
  "schemaVersion": 1,
  "llamacpp": {
    "pinnedBuild": "b9644",                  // exact tag; bump deliberately
    "binaries": [                            // selected by platform + gpu
      { "platform": "windows", "gpu": "cuda12", "assetUrl": "...cudart-llama-bin-win-cuda-12.4-x64.zip", "sha256": "...", "serverExe": "llama-server.exe" },
      { "platform": "windows", "gpu": "cpu",   "assetUrl": "...llama-bin-win-cpu-x64.zip", ... },
      { "platform": "macos",   "gpu": "metal", "assetUrl": "...llama-bin-macos-arm64.zip", ... },
      { "platform": "linux",   "gpu": "cuda12", "source": "docker", "image": "ghcr.io/ggml-org/llama.cpp:server-cuda12-b9644", ... }
    ]
  },
  // Tiered catalog — span CPU/tiny → low-VRAM-MoE → mid → high. The actual
  // attribution pick is benchmark-driven, not pre-decided. hfRepo + quant;
  // the runner resolves real filenames from the HF tree at download time.
  // "Unsloth" repos are HuggingFace orgs; Qwen/bartowski are alternatives.
  "models": [
    {
      "id": "qwen3.6-35b-a3b-mtp",
      "name": "Qwen3.6 35B-A3B (MTP)",
      "tier": "low-vram-moe",                 // MoE offload → big model on small card
      "candidateFor": ["attribution"],         // candidate, validated by benchmark
      "hfRepo": "unsloth/Qwen3.6-35B-A3B-MTP-GGUF",
      "quant": "UD-Q4_K_XL",                   // verified-available variant
      "mmproj": null,                          // MTP variant doesn't use mmproj
      "totalParams": "35B", "activeParams": "3.6B",
      "mtp": true,
      "minRamMb": 24000,
      "recommendedFor": { "minVramMb": 6000 }
    }
    // + dense small (CPU/tiny), dense mid (12-16GB full-GPU), and other MoE
    //   options. Catalog is data — extend without code changes.
  ],
  "flagPresets": {
    "base":  ["-ngl", "999", "--flash-attn", "on", "--cache-type-k", "q8_0", "--cache-type-v", "q8_0", "--mlock"],
    "mtp":   ["--spec-type", "draft-mtp", "--spec-draft-n-max", "3"],
    "turboquant": { "experimental": true, "fork": "TheTom/llama-cpp-turboquant", "flags": ["--cache-type-k", "turbo4", "--cache-type-v", "turbo3"] }
  },
  "vramFit": {
    // compute nGpuLayers / nCpuMoe from detected VRAM + model layer bytes +
    // KV-cache bytes (post quant), with a safety margin; probe-and-back-off
    // on OOM at spawn. Tiers: cpuOnly | low(6-8GB) | mid(12-16GB) | high(24GB+)
    "safetyMarginMb": 1024
  }
}
```

---

## 6. Phases + execution queue (RULE #2 — single-item)

### Phase 1 — JustVoice built-in runner (Python)
1. **P1.1 manifest + schema** *(first code item)*: ship `runner-manifest.json`
   + Pydantic models (camelCase via alias) + loader + endpoint
   `GET /v1/llm-runner/manifest` + unit test.
2. **P1.2 binary acquisition**: detect platform+GPU (`/v1/system`), select
   asset from manifest, download via prefetch worker, unpack, verify.
3. **P1.3 model download**: reuse plain-HTTPS GGUF fetcher (single file +
   mmproj sidecar) through the one-button UI.
4. **P1.4 spawn + VRAM-fit**: compute flags from manifest `vramFit`; spawn
   `llama-server`; probe-and-back-off on OOM; health; stop/cancel.
5. **P1.5 register provider**: `local-llamacpp` (OpenAI-compat) in the LLM
   registry → attribution/rewrite/dictation route to it. Demote `qwen3-llm`.
6. **P1.6 verify**: Playwright + pytest; benchmark Qwen3.6-35B-A3B vs
   dense-14B on real attribution cases.

### Phase 2 — shared Vue `llm-ui` + camelCase provider normalization
- Extract provider form / model browser / quick-setup / usage into `llm-ui`.
- Normalize provider shape to camelCase across both apps.

### Phase 3 — JustWrite
- Implement the runner in JustWrite's **Tauri Rust shell** (NO Python):
  read the shared `runner-manifest.json`, detect HW, download the llama.cpp
  binary + GGUF, spawn `llama-server`. Point JustWrite's existing JS
  provider layer at the local endpoint.
- Adopt the shared `llm-ui` + `runner-manifest.json`. Remove audio (§4.1)
  AFTER resolving gaps (§4.2). Keep §4.3.

---

## 7. Open decisions
- **Cross-repo sharing mechanism** for `runner-manifest.json` + the Vue
  `llm-ui` lib (git submodule / published package / monorepo workspace).
  Decide before Phase 2/3 wiring. (Only DATA + UI are shared now, not a
  code package — smaller surface.)
- **JustVoice production packaging**: wire the Python sidecar into
  `tauri.conf.json` (externalBin via PyInstaller/PyOxidizer) to hit the
  one-click goal. Currently NOT configured.
- (RESOLVED 2026-06-16) Shells stay Tauri. Runner is per-app (Python in
  JustVoice, Rust in JustWrite's shell), NOT a shared Rust crate and NOT a
  shared Python package (the latter would force Python into JustWrite,
  violating the one-click/zero-install requirement). Shared = manifest
  (data) + Vue `llm-ui` + REST shape. Escape hatch if duplication bites:
  a standalone native Rust runner binary both apps spawn (§2.2a).

---

## 8. Verification
- Server: ruff + pytest. New tests per item.
- Renderer: Playwright suites (`scripts/verify-engines-*.mjs` pattern).
- The proof for Phase 1 is a real attribution benchmark on the user's
  hardware: Qwen3.6-35B-A3B (MoE) beating dense-14B on accuracy AND speed.
