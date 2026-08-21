# 2026-08-22 — Engine environments, cross-platform acceleration, and the roster: the full research record

**What this doc is.** The complete record of the 2026-08-22 research session (Opus 5 +
Fable 5): every claim verified, every measurement, every test render, every user ruling.
The companion implementation doc — **`2026-08-22-env-migration-implementation.md`** — is
the hand-off Opus codes from. Read THIS doc to understand *why*; read that doc to *do*.
Nothing here has been implemented; the repo is unchanged except these docs.

Method note (user order): everything below was verified against code, this machine,
PyPI JSON, live wheel indexes, the HF API, or upstream repos — never recalled, never
trusted from our own manifests alone. Where a claim could not be verified it says so.

---

## §1 The rulings (user's words, in order given)

1. **"this is crossplatform app and all hardware acceleration should work for all
   modeles"** — and later, on torch 2.6.0 excluding RTX 50 / ROCm 7:
   *"i expliciltly stated i want all working on crossplatfrom andd all acceleration
   this is a limitation i will not accepts."* → torch 2.6.0 is dead as a target;
   the modern-torch line is mandatory.
2. **"we have 4 engines chatterbox kokoro pockettts qwen and luxtts should be
   removed"** — later REVERSED for pocket/lux (see 4/5).
3. **"stop looking at what we have but research what can and should be done"** —
   greenfield research, not an audit of the status quo.
4. **"i dont like requireing hf auth so pocket tts is out"** — Pocket TTS rejected.
   The cause: its VOICE-CLONING weights are HF-gated (verified live: `kyutai/pocket-tts`
   `gated: auto`, anonymous download 401). Presets are ungated and worked anonymously,
   but cloning was the slot.
5. **"no supertonic no pocket keep lux, verify lux works with our python and pytorch
   updgade"** — LuxTTS keeps the CPU-cloning slot; verification ordered and PASSED (§4).
   Supertonic 3 rejected (its open-source version has **no voice cloning** — "fixed-voice,
   local TTS", custom voices only via Supertone's commercial services).
6. TADA: user asked for opinion; my rec = keep it exactly where the 2026-08-17 roster
   put it (marked, hidden, not deleted). **No user word either way yet** — TADA state
   unchanged.
7. **"never visit pixi.sh"** — that domain is flagged by the user's security tooling.
   Permanent constraint for research. (conda/micromamba were dropped from scope by me,
   user did not order it; conda remains un-researched.)
8. **"you can download and run any tests you need to verify everyhting"** — the go
   for the scratch-venv render tests in §4.
9. **"i want opus to code this so make doc that opus can follow without thinking too
   much"** — the companion implementation doc.

**Resulting roster: chatterbox · kokoro · qwen3 · luxtts (+ Whisper STT).**
Pocket TTS: excise. Supertonic: never added. TADA/MOSS: still marked-not-deleted.

---

## §2 The decided architecture

> **AMENDED 2026-08-22 (rethink, user-approved):** *"576mb is not bad so if you
> still think per engine venvs is ok go with that."* The environment model is
> **ONE VENV PER ENGINE with a single family-wide torch pin** — not one shared
> venv. Rationale: measured cost is ~576 MB total (uv hardlinks; divergent torch
> would cost 4.3 GB but the family pin forbids it), and per-engine structurally
> deletes constraints.txt, the `--no-deps` hand-mirroring hazard, the
> manifest-drift class (the peft hole), cross-engine re-resolution, kokoro's
> special-casing, AND gives every engine a real Uninstall. Engines already run
> one-subprocess-each; `ISOLATION="venv"` is proven code (kokoro runs it today).
> One correction from the final pass: chatterbox must stay `--no-deps` even in
> its own venv — its metadata pins `torch==2.6.0` below py3.14 and a with-deps
> install would downgrade torch. The bullets below are superseded where they say
> "shared"; Python 3.13, torch line, indexes, roster all stand.

- **~~One shared venv~~ → one venv per engine, Python 3.13** (from 3.12).
  Python 3.13 remains the numpy fix: chatterbox's own PyPI markers are
  `numpy>=1.24,<2.0 ; python_version < "3.13"` / `numpy>=2.0 ; python_version >= "3.13"`.
  On 3.13, numpy 2.5 + numba 0.67 + librosa satisfy every engine, and kokoro's
  isolation stops being special — every engine is isolated, one rule.
- **Python 3.14: rejected** — buys nothing (no engine needs it), costs friction
  (kokoro-onnx `requires_python <3.14`; the cap is artificial per
  thewh1teagle/kokoro-onnx issue #187 but real until lifted; torch 2.6.0 has zero
  cp314 wheels — moot since we leave 2.6.0, but 3.13 has full cp313 wheel coverage
  for every compiled dep: spacy-pkuseg, numba, llvmlite, sentencepiece, onnxruntime,
  torch 2.6.0→2.13, torchaudio, piper-phonemize 1.4.7 — ALL verified).
- **Torch: the modern line — target 2.13.0 (+ torchaudio 2.11.0), proven band
  2.9.1→2.13.0** (§4). torchaudio stopped shipping after 2.11.0 (release note:
  "compatible with future versions of torch"; its `torch==` pin was removed) —
  2.11.0 is the permanent pairing for torch ≥2.12.
- **CUDA index by GPU tier, ridden from the kit** (`llm_runner/runner/binary.py:_cuda_key`,
  `cuda13 if compute_cap >= 10.0 else cuda12` — the boundary is **Blackwell**, cap 10.0/12.0):
  cap<10 → **cu126** (carries torch 2.6.0 through 2.13.0 — the one bridge index),
  cap≥10 → **cu130**. cu124 is a dead index (stops at 2.6.0); cu128 died after 2.11.0.
- **AMD Linux → rocm7.2** (carries torch 2.11.0/2.12.x/2.13.0, cp310–cp315,
  manylinux only). Today's `rocm6.2` pin is a live bug — that index stops at torch
  **2.5.1** and can never satisfy even the current 2.6.0 pin.
- **AMD Windows → AMD's own wheel index** (ROCm 7.2.1 + **torch 2.9.1** + Python 3.12,
  Radeon RX 7900 XTX class / AI PRO R9700 only; AMD docs present it as shipped, no
  "preview" label found, but GPU list is short). Documented override path, not
  auto-detected (no AMD hardware here to verify detection).
- **macOS**: shared venv (CPU/MPS) for chatterbox, luxtts, kokoro, whisper;
  **qwen3 stays in its own MLX venv** (already coded: `ISOLATION = "venv" if darwin`).
  Reason is irreconcilable metadata: `mlx-audio 0.5.0` needs `transformers>=5.14.0`
  and no torch; `qwen-tts 0.1.1` pins `transformers==4.57.3`. torch 2.13 macOS wheel
  is `macosx_14_0_arm64` → **macOS 14+ floor accepted** (torch 2.11.0 = macOS 11+ is
  the fallback if that ever matters; macOS x86 torch died at 2.2.2 in 2024).
- **ONNX: kokoro only** (plus LuxTTS's own CPU path which uses onnxruntime internally).
  No ONNX strategy: training (peft) makes torch mandatory for chatterbox/qwen3
  anyway; chatterbox's paralinguistic tags are a shipped feature ONNX exports handle
  poorly; ONNX Runtime's CoreML EP is *preview* and its ROCm EP is *deprecated*
  (onnxruntime.ai EP index); onnxruntime-directml is stalled at 1.24.4 vs mainline
  1.29.0. PyTorch `kokoro` 0.9.4 requires Python <3.13 → on the 3.13 env,
  kokoro-onnx is the ONLY Kokoro that installs. ONNX is load-bearing there, dead
  weight nowhere else.
- **chatterbox stays `--no-deps` from the pinned git SHA** with sub-deps listed in the
  manifest (the voicebox pattern, shipping in production there). Its `transformers==5.2.0`
  is the one irreconcilable pin vs qwen-tts `==4.57.3`; it has run at 4.57.3 in this
  app for weeks and in voicebox for its whole life.
- **No auth anywhere**: chatterbox / qwen3 / kokoro / luxtts weights all download
  anonymously (verified live, HTTP 200 each; `gated: False`).
- **UV_CACHE_DIR must be pinned by the app** on the same volume as the venvs
  (plus link-mode awareness). Hardlinking works on this machine ONLY because the
  user set `UV_CACHE_DIR=E:\UV_CACHE_DIR` personally; the repo sets it nowhere;
  uv silently falls back to full copies across drives (measured, `LinkType: ''`).

---

## §3 Measurements (this machine: RTX 2070 SUPER 8 GB, Windows 11, E: = venvs+cache)

Disk economics (uv 0.12.0, hardlink mode on same volume):
- Shared venv apparent size **5,463 MB** (47,476 files); torch alone **4,447 MB** (81%).
- Second venv, same torch 2.6.0+cu124: **+11 MB, 7.6 s** (hardlinks).
- Divergent torch (2.11.0+cu128): **+4,307 MB, 54 s** — version divergence is the
  ONLY real cost of per-engine venvs.
- Per-engine venvs at their own true pins: chatterbox **270 MB**, qwen3 **118 MB**,
  pocket-tts **19 MB**, kokoro **169 MB** (apparent ~5 GB each — hardlink illusion).
- Cross-drive cache (cache C:, venv E:): uv falls back to **full copies**
  (`LinkType: ''`, one link). uv docs confirm: clone→hardlink→copy chain, one warning.
- Model weights on disk: chatterbox 6,919 MB · qwen3 6,711 MB · whisper 1,829 MB ·
  luxtts 1,408 MB · kokoro 1,208 MB ≈ **17.5–19 GB** — the environment choice moves
  ~3% of total footprint; weights dominate everything.
- uv auto-downloaded CPython 3.13.14 on demand for the test venvs (managed-python
  flow works with zero user Python).

---

## §4 The proof renders (all run 2026-08-22, this machine, real audio asserted non-silent)

Test venv A: **Python 3.13.14 + torch 2.9.1+cu128 + torchaudio 2.9.1** + transformers
4.57.3 + accelerate 1.12.0 + qwen-tts 0.1.1 + kokoro-onnx 0.6.1 + peft 0.20.0 +
librosa 0.11.0 + chatterbox sub-deps + resemble-perth@ce86c49d029f +
chatterbox-tts@5de7a54a (`--no-deps`) + piper-phonemize 1.4.7 + linacodec@c0ae7c7285e1 +
zipvoice(LuxTTS)@28ae6a611516. **Installed with zero resolver errors, torch untouched.**
Test venv B: Python 3.13 + **torch 2.13.0 (CPU) + torchaudio 2.11.0** + chatterbox chain.

| test | result |
|---|---|
| all imports (chatterbox, qwen_tts, pocket_tts, kokoro_onnx, peft, torchaudio) | PASS; qwen warns flash-attn absent and **runs the manual PyTorch path — flash-attn is optional** |
| numpy 2.5.2 ↔ torch round-trip | PASS |
| chatterbox Multilingual v2, **torch 2.9.1+cu128, CUDA** | **PASS** — 2.44 s audio in 13.9 s, rms 0.1012, from cached weights |
| chatterbox Multilingual v2, **torch 2.13.0, CPU, HF_HUB_OFFLINE=1** | **PASS** — 2.60 s in 21.0 s, rms 0.1175 (offline load also proven) |
| chatterbox at its **declared `transformers==5.2.0`** (torch 2.13.0 CPU, py3.13) | **PASS** — 2.56 s in 10.4 s, rms 0.1116 (run 2026-08-22 after the per-engine rethink; the 4.57.3 era was the shared venv's compromise) |
| kokoro-onnx on numpy 2.5.2 (app's kokoro-v1.0 files) | **PASS** — 2.87 s in 1.0 s CPU |
| **LuxTTS clone render, torch 2.9.1+cu128, CUDA, py3.13** | **PASS** — load 2.9 s, prompt encode 2.3 s (whisper-base transcription ran inside it → transformers-Whisper on the new stack proven too), 2.39 s of 48 kHz audio in **0.9 s**, rms 0.0492 |
| pocket-tts anonymous (fresh HF_HOME, no token) | load 0.7 s `has_voice_cloning=False`; preset "alba" render 2.56 s in **0.8 s CPU** (≈3.2× realtime) — engine rejected anyway per ruling |
| qwen3 full render | not repeated in scratch (renders daily in-app at these exact transformers/torch-class versions); imports + flash-attn-optional proven |

Community corroboration for chatterbox-on-modern-torch (user-supplied, aligned with
our own renders): RTX 5070 guide (torch 2.9.1+cu128 + chatterbox 0.1.6),
Chatterbox-TTS-Server (2.9.0+cu128, RTX 5090), resemble-ai/chatterbox issue #488
(Kaggle torch 2.9 + `--no-deps`), voicebox shipping `torch>=2.2.0` unpinned.

Test scripts preserved in the implementation doc appendix. WAVs (scratchpad, transient):
`lux_cuda.wav`, `cb_2.9.1_cuda.wav`, `cb_2.13.0_cpu.wav`.

---

## §5 Upstream truth table (PyPI JSON / repo files, read 2026-08-22)

| package | latest | key requirements |
|---|---|---|
| chatterbox-tts | 0.1.7 (PyPI 2026-03-26); git master = our pin `5de7a54a` (2026-07-21, HEAD) | `torch==2.6.0;py<3.14` / `>=2.9.0;py>=3.14`; `numpy<2;py<3.13` / `>=2;py>=3.13`; `transformers==5.2.0`; `librosa==0.11.0`; `torchaudio==2.6.0` |
| qwen-tts | 0.1.1 (2026-02-06); git = our pin `022e286b` (2026-03-17, HEAD) | **`transformers==4.57.3`**, `accelerate==1.12.0`, torchaudio/librosa/onnxruntime unpinned |
| kokoro-onnx | 0.6.1 (2026-08-19) | `numpy>=2.0.2`, `onnxruntime>=1.20.1`, py `>=3.10,<3.14` |
| kokoro (torch) | 0.9.4 (2025-04-05) | py `>=3.10,<3.13` → **cannot exist on the 3.13 env** |
| pocket-tts | 2.1.0 | torch>=2.5, numpy>=2, py<3.15; base+presets from UNGATED `kyutai/pocket-tts-without-voice-cloning`; cloning weights from GATED `kyutai/pocket-tts` |
| mlx-audio | 0.5.0 (2026-08-17) | `transformers>=5.14.0`, `mlx>=0.31.1`, **no torch**; Apple-Silicon-only; supports Kokoro, Chatterbox, **Qwen3-TTS** (mlx-community 8-bit exports, same Vivian/Ryan presets we ship) |
| LuxTTS chain | zipvoice 0.0.11 @ our pin; linacodec @ our pin; piper-phonemize 1.4.7 | torch unpinned; **piper-phonemize ships cp312/cp313/cp314 wheels for win_amd64+win32, macOS x86+arm64, manylinux x86+aarch64** (k2-fsa index, verified) |
| torch | 2.13.0 (2026-07-08) | torchaudio final = 2.11.0 (no torch pin); macOS floors: 2.11=11.0+, 2.12+=14.0+ |
| onnxruntime | 1.29.0; onnxruntime-directml stalled 1.24.4 | ORT EPs: CoreML preview, ROCm deprecated, DirectML production |
| numba | 0.67.0 → numpy<2.6 | ceiling chain dead on 3.13 |
| hume-tada | 0.1.9; repo quiet since 2026-05-11 | **`torch>=2.7,<2.8`** (collides with the new line), Llama-3.2 weights ("Built with Llama" obligation), 19.61 GB, engine reads no delivery field (measured 2026-08-17); repos ungated (anon 200) — **left marked-not-deleted, no new word** |

Live wheel-index receipts: cu124 max=2.6.0 · rocm6.2 max=**2.5.1** (our current AMD
target — broken) · rocm6.2.4 has 2.6.0 · rocm7.2 = 2.11/2.12/2.13 · cu126 = 2.6.0→2.13.0
· cu128 has 2.9.1, no 2.6.0, dead after 2.11 · cu130/cu132 = modern only ·
torch 2.6.0 cp314 = zero anywhere.

---

## §6 Corrections ledger (claims made earlier in the session, fixed by verification)

1. "The shared env cannot work" → **retracted.** Voicebox ships one shared env
   (verified at raw source: `transformers<=4.57.6`, `numpy<2`, `numba<0.61`,
   torch-Kokoro, justfile `--no-deps` for chatterbox/tada/mlx-lm) and our own app has
   rendered chatterbox at transformers 4.57.3 for weeks. The REAL defects were:
   peft missing (LoRA refuses today) and the numpy eviction (self-inflicted via
   Python 3.12 + kokoro-onnx, dissolves on 3.13).
2. "Pocket TTS needs an HF account" → **half-right.** Two repos: ungated
   base+presets (worked anonymously, 3.2× realtime measured), gated cloning weights
   (401 anonymous, `VOICE_CLONING_UNSUPPORTED` error names it). Cloning was our slot
   → user rejected the engine.
3. "Kokoro needed isolation" → **self-inflicted**: the numpy conflict came from
   choosing kokoro-onnx on Python 3.12; on 3.13 it co-resolves. (And my earlier
   ONNX-size argument was circular — ONNX's 169 MB vs 4,447 MB only matters if
   Kokoro is isolated. The surviving ONNX reason is the py<3.13 cap on torch-Kokoro.)
4. "qwen3 has no Apple path" → **wrong as phrased**: upstream repo is CUDA-only
   (hardcoded `cuda:0`+flash-attn, Mac support = two unmerged PRs), but the
   community MLX path (mlx-audio + mlx-community exports) works and is already what
   our manifest ships (5 `-mlx` variants).
5. voicebox as origin of our shared venv → **false**: voicebox dev uses one plain
   pip venv, production ships PyInstaller frozen binaries + downloaded CUDA-variant
   binaries. Our uv model is our own.
6. "kit CUDA-12/13 boundary is the RTX 2070" → the kit rule is
   `compute_cap >= 10.0` = **Blackwell**; 20/30/40-series all take the cuda12 build.
7. AMD-on-Windows "production-ready" → AMD's docs say shipped/updated (ROCm 7.2.1,
   torch 2.9.1), no status label, short GPU list. Documented, not measured.
8. The earlier "all four resolve on 3.13" compile paired torchaudio 2.11.0 with
   torch 2.6.0 — runtime-unsafe pairing; correct pairing was verified after
   (2.6.0↔2.6.0; and for the new line 2.13.0↔2.11.0, render-proven).

---

## §7 Broken today (verified defects, all addressed in the implementation doc)

1. `peft` declared by chatterbox+qwen3 manifests (added in 228a28e) but **not
   installed** in the shared venv — LoRA train and LoRA-voice render refuse right
   now. Cause: `_install_engine_shared` only checks the venv EXISTS; a manifest
   gaining a package never reaches an existing install (no drift detection).
2. `_detect_torch_index_url` (manager.py:660-700): returns **cu124 for every NVIDIA
   GPU** (GPU-blind; cu124 is a dead index; Blackwell gets a wheel that cannot
   target sm_120) and **rocm6.2 for Linux AMD** (index max 2.5.1 < the 2.6.0 pin —
   cannot install at all).
3. **PyInstaller `--onefile` × `ENGINES_DIR = Path(__file__).parent`** (release.yml
   :50/:57/:72; manager.py:55): in the shipped binary that path resolves inside the
   temp extraction dir — venvs, weights, and the venv-origin stamp land in a folder
   deleted on exit. Engine install cannot survive packaging as built.
4. Weights live inside the app tree (`engines/<id>/models/hf`, `HF_HOME` pinned
   there at manager.py:1214-1222) — violates the family data-location law; only
   kokoro's speech-cache (1.2 GB) is in the data dir.
5. Model `revision: "main"` on every variant (no reproducibility, silent upstream
   drift) + dead fallback key `src.get("hf_revision")` at manager.py:1998 that no
   manifest writes.
6. No `UV_CACHE_DIR` / link-mode management anywhere in the repo (§3 consequence:
   packaged users on non-C: installs pay full copies per venv).
7. Shared engines have **no uninstall** (SpeechEnginesTab: only isolated+installed
   engines render the button; chatterbox/qwen rows say "installed automatically").
8. `constraints.txt` numpy<2.0 ceiling + kokoro `ISOLATION="venv"` + the tada
   `numba<0.61` pin — all fossils of the 3.12 era, wrong under the new plan.

---

## §7b AMD-on-Windows wrinkle (surfaced at the final save — do not lose)

AMD's Windows PyTorch wheels (ROCm 7.2.1 line) **require Python 3.12** per AMD's
own install doc (also: torch 2.9.1, Radeon driver 26.2.2, RX 7900 XTX class /
AI PRO R9700 only; install = AMD's ROCm SDK pip packages first, then torch from
their index — `rocm.docs.amd.com/projects/radeon-ryzen` → install → Windows →
PyTorch). Our venvs are Python 3.13 → the AMD-Windows override venv must be built
`--python 3.12`. Per-engine venvs make this LEGAL where the shared venv could not:
on 3.12 chatterbox's marker flips back to `numpy<2` while kokoro-onnx needs
`numpy>=2` — irreconcilable in ONE venv, irrelevant across separate venvs.
(kokoro needs no torch anyway; only the torch engines would take the 3.12/AMD
variant.) Recorded in the implementation doc Slice 7 recipe.

## §8 Voicebox (for the record; full audit in session transcript)

Production = PyInstaller frozen binaries (CPU base + downloaded CUDA/ROCm variant
tarballs, sha256-verified, version-probed with CPU fallback), 543 MB installer, one
shared dep set with hand-mirrored `--no-deps` sub-deps. Worth stealing: fail-closed
download hygiene; version-probe-then-fallback launcher; the Phase-0 dependency audit
(grep a candidate engine for `inspect.getsource` / `@typechecked` /
`importlib.metadata` / `lazy_loader` / `torch.load` sans map_location / `token=True`
before accepting it). Their single-env weaknesses (global transformers cap, hand-
mirrored deps, one requirements.txt across platforms mis-resolving torch per-OS) are
documented in their own tracker (#505, #1009, #131). Parity state + their roadmap →
`docs/dev/ROADMAP.md` (separate; not in Opus's implementation scope).

## §8b Adjacent research worth keeping (condensed from the session's agent reports)

**HF delivery stack, 2026 state** (matters when we upgrade huggingface_hub past our
pinned 0.36.2, and for the SHA-pin slice):
- huggingface_hub is at **v1.x** and the break REMOVED: `resume_download`,
  `local_dir_use_symlinks`, `force_filename`, `hf_transfer`/`HF_HUB_ENABLE_HF_TRANSFER`
  (Xet replaced it — "all repositories on the Hub are Xet-enabled"), the
  `huggingface-cli` binary (now `hf`), the `requests` backend (now httpx), and the
  git `Repository` class. Code using those TypeErrors or no-ops on v1.x.
- `HF_XET_HIGH_PERFORMANCE` wants ~64 GB RAM for buffering — never set it by default.
- Env vars are read AT IMPORT of huggingface_hub — set `HF_HOME`/`HF_HUB_CACHE`
  before first import or pass `cache_dir=` per call.
- `HF_HUB_DISABLE_SYMLINKS=1` is the documented ship answer for a Windows cache
  without Developer Mode (cost: duplicated blobs). (User already REJECTED dev-mode.)
- Useful new primitives: `dry_run=True` (size preview per file), `IncompleteSnapshotError`
  (no more silent partial snapshots), `hf cache verify` (checksum a cached revision),
  `resolve_revision()` (freeze branch→sha once). Blob names ARE hashes (git-sha1 /
  lfs-sha256) — content addressing is free.
- Anonymous rate limits are per-IP, 5-min windows (~3,000 resolver calls); hub ≥1.2
  auto-waits on 429. Gated-repo acceptance is browser-only. Never ship an HF token —
  there is a public revoke endpoint anyone can call on a found token.
- The HF cache layout is a published cross-language spec (llama.cpp adopted it) —
  a pre-seeded cache ships portably ONLY if built with symlinks disabled.

**Apple-path verdicts per engine** (from the MLX/CoreML sweep, 2026-08-22):
- mlx core 0.32.1 now ships CUDA (Linux, official) and even Windows wheels, but the
  backend extras are NOT wired for Windows and **mlx-audio declares Apple Silicon
  only** — there is no cross-platform MLX TTS stack; MLX stays the MAC arm only.
- CoreML conversions EXIST for Kokoro (FluidInference et al.), Qwen3-TTS (5-stage
  ~5.9 GB, early), and Pocket (moot); **no complete CoreML Chatterbox exists**
  (only partial hybrids; its flow/AR loops resist conversion — the loop always
  stays in host code; whisper.cpp's CoreML runs only the ENCODER on ANE).
- WhisperKit/Argmax (MIT) is the mature Apple STT; FluidAudio (Apache-2.0) is the
  mature Apple-only speech SDK. Both macOS/iOS only — irrelevant to Win/Linux.
- ONNX Runtime's CoreML EP is *preview*; sherpa-onnx remains the only runtime that
  runs Kokoro-class TTS on literally every OS.
- Conclusion already embodied in the plan: torch-MPS/MLX on Mac, no CoreML work.

**Process-model corroboration** (why our one-subprocess-per-engine design is right):
Ollama runs every model via a spawned llama-server subprocess over local HTTP with
Ping/WaitUntilRunning/HasExited/VRAM accounting; Triton's python_backend spawns a
process per model instance with per-model packed envs; ComfyUI (shared interpreter)
is the documented counterexample — their own blog calls custom-node dependency
conflicts a top issue and aspires to per-node processes. Residency policy prior
art: Ollama `keep_alive` 5 min default + `OLLAMA_MAX_LOADED_MODELS`; per-process
CUDA context costs ~300–500 MB (user-measured, why "keep everything warm" is
impossible on one consumer GPU). Wire-format lesson (Ray docs): pickle across
mismatched envs breaks — JSON + raw bytes only, which is what our plugin protocol
does.

**Variant-binary download hygiene** (voicebox's, worth copying if we ever ship
accelerator packs): fetch the `.sha256` FIRST and fail hard if unfetchable; stream
to `.tmp`; verify; `tar.extractall(filter="data")`; unlink in `finally`; one lock
around the whole swap; version-probe the binary from its own dir and fall back to
CPU on mismatch; a stale pin self-heals instead of wedging.

## §9 Open for the user's word

1. **The implementation itself** — Opus codes from the companion doc.
2. TADA / MOSS: leave marked (my rec) or full excision alongside Pocket — no word yet.
3. Model-revision SHA pinning is IN the implementation doc (rec'd, fits "no silent
   drift"); say so if you want it dropped.
4. Older items unchanged: R8 class collapse, grid progress bar (Blend session),
   Alder/Wren training, rendered-live verify of the 08-21 Clone/Import pass.
5. **qwen3 CustomVoice presets on the Voices tab** (user question 2026-08-22): the
   9 STATIC_VOICES (Vivian, Serena, Uncle Fu, Dylan, Eric, Ryan, +3) ARE declared
   (`qwen3/manifest.py:246`) and `/v1/voices` serves static presets from every
   manifest UNCONDITIONALLY (`voices_api.py:53-66` — "always available, no
   subprocess needed"). If they are missing from the rendered grid the cause is a
   stale sidecar (restart) or a grid filter — needs a rendered-live check, code is
   correct.
