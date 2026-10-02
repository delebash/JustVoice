<!-- SPDX-License-Identifier: MIT -->
# JustVoice speaks through audio.cpp — the switch

**Decided 2026-10-01** (TASKS "Every Python speech engine is replaced by our own copy of
audio.cpp — one cut, then the gaps"). The user's words, verbatim:

- "we do a full switch" · "i dont want to do anything side by side"
- "maybe we just copy the repo and make it our own"
- "the app is not in production so no need for it to remain running lets do the cut all at once
  then add the missing features"
- "as long as qwen asr is as good as whisper we can drop whisper" · "dont care about watermark"
- on a one-author project: "1 author wroter our current code"
- go for this doc and the code: "run the pre-cut checks, go your rec do the design and coding go"

This doc is the build record. §1 says what the switch IS before any slice (plans must carry the
design). §2 is the evidence. §4 lists the calls made under "your rec" and the ones still the
user's. §7 is the blast radius, every row a pasted grep.

---

## 1. What it is

**Today** every speech engine is its own Python program: a uv-built venv per engine (torch,
transformers, the model's reference package — 431 MB deduped on top of one 4.3 GB torch), spawned
as `engines/<id>/.venv/python engine.py serve` and driven over loopback HTTP by
`engines/manager.py` (2,665 lines). Kokoro, Qwen3, Chatterbox, LuxTTS and Whisper each have one.

**After the cut** there is ONE native program: `audiocpp_server` from audio.cpp (Apache-2.0,
ggml/C++), our pinned copy. It loads GGUF model files and serves `/v1/audio/speech`,
`/v1/audio/transcriptions`, `/v1/audio/alignments`. Our Python server keeps everything it does
today — projects, scripts, casting, lexicons, the render cache, mastering, effects, the UI's API —
and stops being a speech engine itself. No torch on the render path; no per-engine venvs; no uv
for speech.

What the user sees:

| Screen | Today | After |
|---|---|---|
| AI page → speech engines | per engine: Install (builds a venv), models, Load/Unload, device | one **runtime row** (audio.cpp version, backend, update) + the same engine → models → Download / Load / Unload / Delete rows |
| Model downloads | safetensors / ONNX folders into the speech cache | one or two GGUF files per model, same speech cache, same download bar |
| Device setting | per engine (cuda / cpu / directml …) | the runtime's backend (CUDA, Vulkan, CPU, Metal) + which GPU |
| Generate, persona editor | per-engine knobs from `capability_details.py` | the same, mapped onto audio.cpp's options |
| Speech → text (dictation, clone transcripts, captions, training prep) | Whisper (Python) | audio.cpp's recogniser + Qwen3 word aligner (§2.3) |

audio.cpp's own web UI is never used — its server runs headless (`--no-ui`), driven by ours.

## 2. Evidence (measured 2026-10-01, RTX 2070 SUPER 8 GB, Windows 11, driver 610.88)

Harness and every WAV: session scratchpad `abtest/` (temporary). audio.cpp v0.9.0 CUDA 12.4.

### 2.1 Side by side — same 20 Ninth Facet lines, same seeds and settings

| Engine | Ours today | audio.cpp | |
|---|---|---|---|
| Qwen3 CustomVoice 1.7B | 0.26× real time · load 24 s · 7.1 GB | 2.0× (8-bit) / 2.02× (fp16) · load 3–4 s · 6.9 / 7.5 GB | 7.7× (6.5× at matched fp16; ours fp16 0.31×, 5.8 GB) |
| Chatterbox Multilingual (clone) | 0.92× · 34 s · 5.4 GB | 2.08× · 3.9 s · 3.2 GB | 2.3× |
| Kokoro | 3.96× on CPU · 2.7 s | 11.9× CUDA (2.5 GB) · 2.84× CPU | 3× GPU, 0.7× CPU |

Words wrong (our Whisper round trip): level within run-to-run noise on every engine. One short
line ("Kell said, to Vasht, without heat.") came out as gibberish on Qwen3 under BOTH runtimes —
the model, not the runtime. Same seed → same audio: audio.cpp on all three; ours only Qwen3.
Instruct (Qwen3) and exaggeration (Chatterbox) work per request on both.

### 2.2 Recognition — 197 clips with known text (73 human LibriSpeech, 120 rendered, 4 German)

| | Whisper turbo (ours) | Qwen3-ASR 1.7B 8-bit | 1.7B fp16 | 0.6B fp16 |
|---|---|---|---|---|
| Human English | 5.8% wrong | **4.3%** | 4.3% | 4.7% |
| Rendered lines | 9.9% | **8.6%** | 8.6% | 9.4% |
| German, language given | **0%** | 23% | 16% | 57% |
| German, no language | **4/4** | 1/4 | 1/4 | 1/4 |
| Confidence | yes | none | none | none |
| VRAM | 2.2 GB | 4.0 GB | 5.6 GB | 3.4 GB |

Qwen3's word aligner timed 25/25 clips sanely (0.11 s each). **Ours could not:** `/v1/align`
answers "whisper: generate returned no token_timestamps — word alignment is unavailable on this
build" — chapter captions are broken today.

### 2.3 Pre-cut checks (2026-10-01) — see §8 for the numbers as they land

A · whole book · B · LLM alongside · C · Vulkan · D · recognition in seven languages.

## 3. How it is built

### 3.1 The runtime

- **Binary.** audio.cpp's release assets, pinned (`v0.9.0` at the cut): `audio-<tag>-bin-
  windows-x64-cuda12.4.zip` + `audio-<tag>-cudart-windows-x64-cuda12.4.zip`, CUDA 13.3 for
  Blackwell, Vulkan, CPU; Linux and macOS archives the same way. Acquired by the **kit's** binary
  acquisition (`llm_runner/runner/binary.py: acquire_binary` — staged download, cudart companion,
  launch-verify, atomic swap), generalised from llama.cpp-only to a runtime spec. One downloader
  for the family; JW and docgen are unaffected (additive).
- **Where.** `<engines-runtime>/audiocpp/<tag>/<gpu>/` — `engines_runtime_root()` already roots
  this (the source tree unfrozen, `<data_dir>/engines-runtime` frozen).
- **The process.** One `audiocpp_server --config <generated> --no-ui`, our port, started by our
  server, stopped with it, orphans found by `engines/leftovers.py` (process name instead of
  `engine.py serve`). The config lists every installed model (id = our variant id, family, task,
  path = the speech-cache file, session options), `lazy_load: true`; our manager decides what is
  resident (§3.3) and calls `/v1/tasks/unload_models`. Installing or deleting a model rewrites the
  config and restarts the process.
- **Our copy of the repo.** The cut runs upstream's v0.9.0 binaries unchanged — no C++ change is
  needed to cut over. Our own copy (fork) starts with the first gap that needs C++ (§5); its
  build pipeline is decided then (§4, Q1).

### 3.2 Models

`engines/<id>/manifest.py` stays the one catalog, minus everything about environments (`INSTALL`,
`ACCEL_INSTALL`, `REQUIREMENTS`'s torch tiers, `SUPPORTED_OSES` arguments about wheels). Each
variant's `sources` becomes the GGUF file(s), pinned by commit in `audio-cpp/audio.cpp-gguf`, and
downloads through the existing `speech_cache.fetch_hf_variant` unchanged. A variant gains the
audio.cpp `family`, `task` and any session options. Engine ids, voice ids and variant ids stay,
so personas, voices and settings survive the cut.

At the cut:

| Engine | Variants (8-bit GGUF) | Gone until §5 |
|---|---|---|
| kokoro | Kokoro 82M (54 voices) | blends, IPA lexicon entries, Japanese (needs MeCab/UniDic) |
| qwen3 | CustomVoice 1.7B · Base 1.7B · Base 0.6B · VoiceDesign 1.7B | CustomVoice 0.6B, trained voices, the Mac MLX rows |
| chatterbox | Multilingual v2 · v3 (one file, a session option) | Turbo, Nano, he/ja/ru/zh |
| speech→text | §8 D decides (Qwen3-ASR and/or Parakeet v3) + Qwen3 aligner | Whisper's confidence score |
| luxtts | — | the CPU cloner (§5) |

### 3.3 The engine manager keeps its door

`EngineManager`'s public methods (`load`, `unload`, `synth`, `transcribe`, `align`, `voices`,
`current_for`, `current_variant_id`, `resolved_default_variant`, `request_cancel_load`,
`bump_engine_reservation`, …) are what 19 files call (§7). They keep their signatures. What
changes is underneath: a loaded "engine" is a model resident in the one audio.cpp process instead
of a Python child; `EngineProcess` becomes a slot over the shared server; `synth` maps our
`SynthRequest` onto `/v1/audio/speech` per family (§3.4). Per-kind residency stays ours (one TTS
model + one speech→text model), the kit's VRAM arbiter keeps its bookings (the server PID's
measured footprint, as today).

### 3.4 Request mapping (verified against audio.cpp v0.9.0 on this box)

| Ours | Kokoro | Qwen3 | Chatterbox |
|---|---|---|---|
| voice | `voice` = preset id | `options.speaker` (CustomVoice) · `voice_ref` + `reference_text` (Base) · `instructions` (VoiceDesign) | `voice_ref` (+ `reference_text`) |
| language | voice prefix code (`en-us` …) | **a name** (`English`; `en` is rejected) | code (`en`, `de` …) |
| speed | `speed` | — (host-side, later) | — |
| temperature / sampling | — | `options.temperature`, `top_k`, `top_p`, `repetition_penalty`, `do_sample`, subtalker_* | `options.temperature`, `top_p`, `repetition_penalty` |
| instruct (persona + line) | — | `options.instruct` | — |
| exaggeration / cfg | — | — | `options.exaggeration`, `options.guidance_scale` (per request — verified) |
| seed | `seed` | `seed` | `seed` |

### 3.5 What goes at the cut

Every `engines/<id>/engine.py`, every engine venv, the uv/torch install machinery in `manager.py`
(`install_engine`, `_detect_torch_index_url`, `_run_uv_pip`, the accel arms, venv fingerprints),
`installer.py`'s engine setup, `chatterbox/mps_patch.py`, the `luxtts`, `whisper`, `tada`,
`moss_tts` engine folders, the `check:engines` script, and their tests and docs.

## 4. Calls

**Made under "your rec"** (each with what it costs if wrong):

- R1 · Own copy, pull upstream releases, send a change up only when it saves merge work. Cost: a
  manual merge every few weeks.
- R2 · The cut uses upstream's v0.9.0 binaries; the fork's first change waits for the first gap.
  Cost: none until a gap needs C++.
- R3 · 8-bit models by default (the Q8 row is what fits an 8 GB card next to the LLM); 16-bit
  rows come back as a choice after the cut. Cost: a measured-but-small quality gap on Qwen3.
- R4 · Runtime binary acquisition lives in the kit (family sameness), generalised additively.
  Cost: a kit change that JW/docgen must build against.
- R5 · **One backend setting for the runtime** (`settings.engines.speech_runtime` —
  `backend` auto/cuda/vulkan/cpu/metal + `gpu` index), set from the runtime row through
  `PUT /v1/speech-runtime`, which frees the speech slots and stops the server so the next load
  starts the chosen build. The per-engine Device select goes. Cost if wrong: one setting moves
  to another surface.
- R6 · **Models can download before the runtime is installed** — a download is a file fetch and
  never needs the program; only Load waits for it. Cost: none.
- R7 · **Each kind books only its own share of the shared server.** audio.cpp holds speech and
  speech→text in ONE process, so measuring that process for the second kind counted the first
  model twice; the second kind now books the measurement less what the other kind already
  booked (`EngineManager._own_share_mb`). Cost if wrong: the process overhead (~300 MB) sits on
  whichever kind loaded first.
- R8 · **Deleting an engine's models says so when a file stays** — Windows refuses to delete a
  file another process holds; the delete used to report success over files still on disk. It
  now answers 409 with the folder. Uninstall also releases the engine's memory booking (it
  didn't, on any engine).
- R9 · **SUPERSEDED 2026-10-02 by Q2's answer — training removed everywhere.** As made at the
  cut: **Training is left standing through the cut** pending Q2: `training_runner`, both
  `train_lora.py` files and `_venv_python` stay; everything else in §3.5 goes. Consequence: a
  fresh install can no longer build a training environment (it never could without the
  per-engine installer); trained voices can't render either way (§5).
- R10 · **Voice engine setup installs the runtime once**; the tiers only pick which engines'
  models you'll download (on first load). Tiers collapse to CPU / 8 GB / 12 GB+ — the 16/24/32 GB
  tiers only added the removed engines; Qwen3 1.7B starts at 12 GB because it peaked at 7.8 GB alone.
- R11 · **A download-source override swaps the repo and keeps the pinned file names** (a
  whole-tree fetch of the GGUF repo would be many gigabytes); the `url` override went with the
  tarball engines.
- R12 · **The "marked for removal" mechanism stays** with nothing marked — it is generic, and its
  tests now mark Kokoro for the length of a test.
- R13 · **The Speech engines tab lists managed engines only.** External providers have their own
  panel; listed here they got an Install that 404'd and a Device select that did nothing
  (pre-existing).
- R14 · **Legacy model locations are gone**: on-disk status, delete and clear read the speech cache
  only — the old per-engine folders and the HF cache are not consulted (the HF probe would now be
  wrong outright: every variant comes from one repo). `POST/GET /v1/engines/setup` went too — no
  caller anywhere (UI, JustWrite, docs), and its job was building every engine's environment.
- R15 · **The runtime is spawned through the kit's `spawn_child`** (exposed publicly in the kit,
  additive): on Windows a kill-on-close Job Object ends it with its server however the server dies
  (proven by a real-process test), plus the virus-scanner retry. The Python engines watched their
  server themselves; audio.cpp does not.

**Still the user's** (asked in the report):

- Q1 · CI on the fork's repo to publish binaries (needed only at the first C++ gap).
- Q2 · Training at the cut. Rendering trained voices is a gap; LoRA training itself is PyTorch.
  Keep the training environment and its UI through the cut (trained voices render again when
  merge + convert lands), or remove training at the cut and rebuild it on audio.cpp later.
  **DECIDED 2026-10-02:** "q2 remove traingin and rebuild" → "go on both removing". Removed
  everywhere the same day: the training API and runner, both trainer scripts, the dataset
  preparer and builder (API, storage, segmenter, screens), the training settings, the `lora`
  voice source and `adapter_path`, the training webhook events, the SNR measurement (training
  was its only reader), speech recognition's confidence score (same), tests and docs. The
  Default voice language setting moved to `generation`. The rebuild is a new item when it starts.
- Q3 · Kokoro on the CPU (keeps the GPU free for the LLM) means a second audio.cpp process on the
  CPU backend — §8 B decides whether it is needed.
- Q4 · The recogniser — §8 D.

## 5. After the cut — the gaps, in order

1. Chatterbox Turbo cloning (and Nano with it) — fork C++: repack the voice-encoder and S3
   tokenizer weights, wire core Chatterbox's conditioning into the Turbo family.
2. Kokoro blends — fork: a voice-vector input.
3. Single-word IPA from lexicons — fork: a text+IPA splice (eSpeak stays out of our MIT server).
4. Qwen3 CustomVoice 0.6B — our conversion with `audiocpp_gguf` from the official checkpoint.
5. Training — removed 2026-10-02 (Q2); rebuilt on the speech runtime as its own item. Rendering
   a trained voice means merging each LoRA into its base and converting (no C++); written
   direction on a trained voice needs the fork.
6. The CPU cloner — MOSS-TTS-Nano, ZipVoice or a LuxTTS port, chosen by ear.
7. Chatterbox Hebrew, Japanese, Russian, Chinese; Kokoro Japanese.
8. Host-side speed (time-stretch) for engines without a native speed — already a dependency.
9. 16-bit model rows; new engines from the catalogue (VoxCPM2 first).
10. Fix in our copy: the aligner's seconds at the input rate (§8, live run) — the slot's 16 kHz
    resample is the workaround until then.
11. Kokoro in a second runtime process on the CPU build, so it never costs the loaded LLM (Q3, §8 B).

## 6. Slices (the cut is one change; coded in this order)

1. **Kit** — generalise `acquire_binary` to a runtime spec; tests; both consumers build.
2. **Runtime** — `engines/audiocpp/` (binary paths, config writer, process lifecycle, HTTP
   client, orphan handling) + the runtime row's API.
3. **Manager** — the slot over the shared server; request mapping per family; speech→text and
   alignment; capability rows mapped.
4. **Catalog** — manifests rewritten to GGUF variants; speech-cache downloads; model list.
5. **UI** — runtime row, device → backend, the install step → runtime; QuickSetup.
6. **Delete** — §3.5, removed everywhere (code, tests, docs, settings).
7. **Docs** — engines.md, code-map §3e, getting started, whats-new.
8. **Gates** — server suite, renderer unit, ruff/biome, vite build, smoke on the real data dir,
   and a live render of The Ninth Facet through the app.

## 7. Blast radius (greps run 2026-10-01)

Callers of the engine manager — every call site below keeps working because the public methods
keep their signatures (§3.3):

```
$ grep -c "engines.manager import|from .manager import|…" server/justvoice   (non-venv)
app.py:1 render_core.py:6 data_admin.py:1 synth_scheduler.py:1 training_runner.py:1
engines/leftovers.py:1 engines/model_catalog.py:2 api/health_api.py:1 api/generate_api.py:1
installer.py:3 api/engine_sources_api.py:1 api/captures_api.py:1 api/engines_models_api.py:2
api/engines_api.py:2 api/voice_preview_api.py:3 api/system_api.py:1 api/voices_api.py:1
api/voice_bundle_api.py:1 api/models_api.py:4            — 34 occurrences across 19 files
```

| What changes | Callers / producers (pasted) | Effect |
|---|---|---|
| `mgr.load` / `unload` / `current_for` | captures_api:63,67 · engines_api:316 · engines_models_api:85,102,147,155 · generate_api:182 · render_core:683,685 · voice_preview_api:340-341,660,679,689 · data_admin:54 · training_runner:239 | same signature, new slot |
| `mgr.synth` | generate_api:318 · render_core:694 · voice_preview_api:342 | same signature; body mapped per family |
| `mgr.transcribe` / `mgr.align` | captures_api:82 · align_api:43 | speech→text model + aligner |
| `mgr.install` / `uninstall` | installer:191 · engines_models_api:182 | install = the runtime; uninstall per engine dies |
| `current_variant_id` / `resolved_default_variant` | engines_api:98,103,320 · render_core:210,297 · model_catalog:82 | unchanged meaning |
| `bump_engine_reservation` / `pool_used_mb` | synth_scheduler:182 · engines_api:302 | the server PID's footprint |
| venv / `engines_runtime_root` users | manager.py:35 · training_runner.py:3 · engines_models_api.py:1 · leftovers.py:1 · kokoro/manifest.py:1 | training_runner hangs on Q2 |
| voice-source fields `voice_vector` `adapter_path` `xvector_only` `ref_text` `ipa_map` `phonemes` | render_core 26 · generate_api 8 · voice_preview_api 6 · training_* 18 · engines/* 58 · base 6 · models 4 | blends, trained voices and IPA refuse with a named gap until §5 |
| Whisper users | captures_api 14 · capture_readiness_api 5 · training_prep 4 · align_api 2 · mcp/tools 3 · inline_tags 4 · manager 3 | speech→text family |
| Frontend engine routes | ttsJobChannel.js:35,84,100 · VoicesView.vue:650,784 · SpeechEnginesTab.vue:222,338,385,406,474,615 · HomeView.vue:298 · LeftoverEnginesHelp.vue:26,57 · SettingsView.vue:829,1024 | routes kept; install → runtime |

## 8. Pre-cut check results

### A · The whole book (The Ninth Facet, 289 lines, audio.cpp v0.9.0 CUDA, 8-bit models)

| Engine | Lines | Failures | Speed | Memory over the run | Notes |
|---|---|---|---|---|---|
| Kokoro | 289/289 | 0 | 11.75× real time | process RAM flat ≈ 550 MB | — |
| Qwen3 CustomVoice 1.7B | 289/289 | 0 | 1.94× (1,360 s for 2,635 s of audio) | VRAM peak 7.8 GB, ends 4.0 GB · RAM 4.1 → 4.7 GB, peak 5.8 GB | line 208 came out far longer than its text (the model running on — seen on our runtime too, §2.1) |
| Chatterbox Multilingual | 289/289 | 0 | 2.1× (1,020 s for 2,146 s of audio) | VRAM peak 3.2 GB · RAM peak 1.0 GB | the first attempt stopped at line 74 when the harness's own server hit its background time limit — not audio.cpp; the re-run finished clean |

Qwen3's process RAM stepped up once (4.1 → 4.7 GB around line 250) and did not climb after —
a cache settling, not a leak at this length. Its VRAM swings 3–5 GB line to line (per-line
allocations freed after each). Line 208 is flagged "far longer than the norm" on both Qwen3 and
Chatterbox.

The whole book read back through Qwen3-ASR (the recogniser the cut ships): mean word error
7.3 % Kokoro · 10.2 % Qwen3 · 8.9 % Chatterbox, medians 0–1.3 %. The misses are almost all the
book's invented names (Ferren → Faren, Cael → Kale/Kyle, Iven → Ivan).

### D · Recognition on human speech, seven languages (Q4)

FLEURS (15 clips each: de fr es ru ja zh) + LibriSpeech English (73). Mean error — word error
rate, character error for ja/zh — with the language given / with none (auto-detect):

| | en | de | fr | es | ru | ja | zh | s / clip |
|---|---|---|---|---|---|---|---|---|
| Whisper turbo (ours, same model + transformers, fp16) | 5.3 % | 2.6 % | 10.8 % | 2.8 % | 4.5 % | **4.2 %** | **5.8 %** | 0.52 |
| Qwen3-ASR 1.7B 8-bit | **4.3 %** | **2.3 %** | **7.3 / 7.7 %** | 2.9 / 2.6 % | **3.8 %** | 5.5 % | 8.6 % | 0.53 |
| Parakeet-TDT 0.6B v3 | 4.4 % | 3.7 % | 8.8 % | 3.3 % | 7.1 % | — | — | **0.08** |

Auto-detect costs nothing on clean human speech for any of the three (the two numbers match).
Whisper ran directly in its own environment for this — its JustVoice engine code had already
been removed — with the same checkpoint and library the engine used.

**Q4 → Qwen3-ASR stays the recogniser.** It wins five of seven languages and trails Whisper on
Japanese (+1.3 points) and Chinese (+2.8). Parakeet is 6.5× faster but has no Japanese or Chinese
and is weaker on Russian and French — a candidate for a fast English/European dictation row
later, not the default.

### B · Speech beside the local language model (Q3)

Live, through JustVoice on the real data dir, RTX 2070 SUPER 8 GB, Gemma 4 26B-A4B QAT as
the AI model (the user's): loading Gemma with the recogniser resident evicted the idle
recogniser (2,957 MB booked) — the arbiter's design — and Gemma came up at 6,844 MB measured.
Then loading **Kokoro** (567 MB measured on CUDA) evicted **all of Gemma**: 6,844 + 567 + the
1,024 MB safety margin is more than the card. Before the switch Kokoro ran on the CPU and the two
coexisted.

**Q3 → measured, still the user's call:** on an 8 GB card a Kokoro render now costs the loaded
AI model (it reloads itself, with a toast, the next time a feature asks). A second runtime
process on the CPU build for Kokoro (2.8× real time measured) would keep the GPU for the LLM.
Not built.

### C · Vulkan

The real settings path: `PUT /v1/speech-runtime {backend: vulkan}` → every engine read "needs the
speech runtime" → one install job fetched the 60 MB Vulkan build in 4 s → loads came up on
`vulkan` (the card says so). Five lines each, on the NVIDIA card: **Kokoro 2.78×** real time
(CUDA 11.9×), **Qwen3 CustomVoice 1.69×** (CUDA ~2.0×). First Vulkan start 16 s (one-time).
Restored to Auto afterwards; both builds stay installed.

### Live end to end (2026-10-01, through JustVoice, real data dir)

| Step | Result |
|---|---|
| Runtime row | v0.9.0, CUDA 12 build, backends cuda/vulkan/cpu, the GPU listed |
| Download Kokoro / Qwen3 CV / Chatterbox / ASR+aligner | job → speech cache, exact sizes; 190 MB · 2.8 GB in 33 s · 2.1 GB in 26 s · 3.6 GB in 46 s |
| Load | Kokoro 9 s · Qwen3 12 s · Chatterbox 5 s (each includes the runtime (re)start) |
| Kokoro en-US, en-GB, **Mandarin, Hindi** | all speak; read back word-perfect by Qwen3-ASR (Mandarin and Hindi verified this way) |
| Qwen3 plain / "whisper it, slowly and fearfully" / German | 4.8 s → 7.9 s with the direction; German read back exact |
| Chatterbox clone (LibriSpeech reference, test voice deleted after) | English exact; French near-exact; `[laugh]` dropped, not spoken; ~1.0–1.1× per single line (re-encodes the reference each request) |
| Transcribe | exact on every engine's output |
| Captions (`/v1/align`) | 14/14 words timed — **after the fix below** |
| Two kinds in one process (R7) | Qwen3 3,115 MB + recogniser 2,326 MB booked separately |
| Hard stop of the server | runtime gone, GPU back to 244 MB |

**Found and fixed during the live run:**

- **Caption times were 2/3 of real** on 24 kHz audio: audio.cpp v0.9.0's aligner resamples to
  16 kHz correctly but converts sample positions to seconds with the INPUT rate (identical sample
  indices, wrong seconds — measured). The slot now sends 16 kHz mono (`slot.as_16k_mono`); times
  match the speech (0.32–4.32 s against a measured 0.30–4.30 s). The earlier "25/25 clips sane"
  used 16 kHz test clips, which is why it missed this. An upstream fix belongs in our copy (§5).
- **The loaded recogniser was labelled "whisper-turbo"**: the user's stored dictation setting still
  names it; the slot loaded the default correctly, the manager echoed the request. It now records
  what the slot says it loaded.
- **Qwen3 was refused outright** ("needs ~7,115 MB + 1,024") with nothing else loaded: the prior
  footprint came from the PyTorch engine's pre-switch rows (the lookup takes the max across an
  engine's variants). Only rows for variants the catalog still offers count now.
