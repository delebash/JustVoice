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
  (npm, git-dep). Extract provider form / model browser / quick-setup /
  usage from both apps' existing UIs.
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
bridges via a provider-backend adapter.

- [ ] Normalize provider shape to **camelCase** across both (JW already
  camelCase; JV `models.py` LLMProviderConfig is snake_case → camelCase or
  aliases). Target shape: `{id,name,providerType,baseUrl,apiKey,
  defaultModel,embeddingModel,timeoutSeconds,builtIn,extra}`.
- [ ] **Drop TTS from JW's provider model** (`kind: tts|both`, `ttsModel`,
  `ttsVoices`, ElevenLabs/Speechify/Voicebox clients) — audio → JustVoice.
- [ ] **Seed same default providers in both** + add `local-llamacpp` as the
  recommended local default. (JW seeds 6; JV seeds none.)
- [ ] Unify feature-pins model; unify usage ledger.
- [ ] **Fix stale data:** JW `stores/ai.js` `MODEL_PRICING` has
  `claude-opus-4-7`, missing `claude-opus-4-8`.

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
