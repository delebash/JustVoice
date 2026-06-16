# Built-in LLM Runner + Cross-App AI-Provider Standardization

**Authored 2026-06-16 (busy-rubin).** Spans **JustVoice** and **JustWrite**.
This doc is the single source of truth for the built-in local LLM runner
and the shared AI-provider/LLM UX across both products. A fresh session
should be able to read this and continue without re-deriving anything.

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
- **Field shape decision: camelCase** (chosen 2026-06-16).
- llama.cpp specifics (MTP, MoE offload, TurboQuant) researched — see §5.

---

## 1. Verified research (llama.cpp performance) — see web sources in session

- **Ollama is built on llama.cpp** (same kernels). llama.cpp's measured edge
  is ~13% generation / ~10x prompt-processing — minor for generation.
- **For an 8GB card the dominant factor is model fit, not runtime.** A dense
  14B (~8.1GB Q4) does not fit 8GB → partial CPU offload → ~5–10 tok/s.
  An 8B fits fully (~40 tok/s) but the user proved 8B fails attribution.
- **The real answer is a MoE model, not a dense one**: **Qwen3.6-35B-A3B**
  (35B total, ~3.6B active/token). More capable than dense-14B AND faster
  on low VRAM via `--n-cpu-moe` (offload idle experts to RAM; only ~3.6B
  compute per token). Independently verified ~30 tps on 6GB; the source
  video hit 17 tps on a GTX 1060 6GB. The user has 8GB → expect better.
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

## 2. Architecture decision

### 2.1 The shared thing is the MANIFEST (data), not necessarily the code

The logic that **changes most often** (binary versions, recommended models,
flags, VRAM-fit recipes) lives in a **shared `runner-manifest.json`** with
**camelCase** keys. Both apps read the same manifest → the volatile stuff
cannot drift. The stable spawn/orchestration logic is small.

### 2.2 Runner location (the headless constraint)

JustVoice runs **headless** (`justvoice-server serve`, no Tauri). Speaker
attribution / persona rewrite run server-side, so headless JustVoice must be
able to **manage** (download + spawn) the runner — not just use a remote
provider. Therefore:

- **JustVoice runner = Python**, in the existing server (works headless +
  Tauri; reuses engine-manager, prefetch worker, provider registry, the
  one-button download UI + progress strip we shipped). This is Phase 1.
- **JustWrite runner = OPEN DECISION (Phase 3)**: JustWrite is Tauri-only
  (no headless, no Python server). Options:
  (a) a standalone **Rust `llm-runner` binary** spawned as a sidecar by
      both apps (true shared code, works headless too) — leading candidate;
  (b) JustWrite reimplements the ~100 lines of spawn logic in its Tauri
      Rust shell, reading the same shared manifest (shared data, duplicated
      thin logic).
  Decide this once Phase 1 validates the manifest schema + flag logic.
  Either way the **manifest is shared**, so detection DATA never drifts.

### 2.3 UI

- **Shared Vue `llm-ui` component library** (both renderers are Vue):
  provider-config form, model browser/download, runner status, quick-setup,
  usage view. Backed by a thin **provider-backend interface** each app
  satisfies (JustVoice → its REST endpoints; JustWrite → its JS clients /
  the shared runner). Components identical; only the data adapter differs.

### 2.4 The built-in runner is just another provider

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
  "models": [
    {
      "id": "qwen3.6-35b-a3b-mtp",
      "name": "Qwen3.6 35B-A3B (MTP)",
      "role": "attribution",                 // flagship for speaker attribution
      "hfRepo": "unsloth/Qwen3.6-35B-A3B-MTP-GGUF",
      "files": ["Qwen3.6-35B-A3B-MTP-UD-Q4_K_S.gguf"],
      "mmproj": null,                          // set if a sidecar is required
      "totalParams": "35B", "activeParams": "3.6B",
      "mtp": true,
      "minRamMb": 24000,
      "recommendedFor": { "minVramMb": 6000 } // MoE offload makes this viable low
    }
    // smaller dense fallbacks for no-GPU / tiny setups...
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
- Decide runner location (standalone Rust binary vs Tauri-shell impl),
  both reading the shared manifest.
- Adopt `llm-ui`. Remove audio (§4.1) AFTER resolving gaps (§4.2). Keep §4.3.

---

## 7. Open decisions
- **JustWrite runner location** (§2.2) — decide at Phase 3.
- Whether to extract a standalone Rust `llm-runner` binary shared by both
  (true shared code, headless-safe) vs per-app logic + shared manifest.
- Cross-repo sharing mechanism for `llm-ui` + manifest (npm workspace /
  git submodule / published package).

---

## 8. Verification
- Server: ruff + pytest. New tests per item.
- Renderer: Playwright suites (`scripts/verify-engines-*.mjs` pattern).
- The proof for Phase 1 is a real attribution benchmark on the user's
  hardware: Qwen3.6-35B-A3B (MoE) beating dense-14B on accuracy AND speed.
