<!-- SPDX-License-Identifier: MIT -->
# Research register — what we already know, and where the proof is (JustVoice)

**Read the section for your subject before researching anything** — before reading code to
answer a question, before measuring, before briefing an agent. Then grep `docs/plans` for
anything newer. Most of what a session "discovers" is already written down somewhere below.

## Why this page exists

Decided 2026-10-04. The user: *"why do we keep re researching stuff, we need a primary research
doc that we point to so we dont keep duplicating or forgeting what we have done in the past"*.
That day four review agents re-read the code to find that installing a model restarts the speech
runtime — a design decision written in the switch record three days earlier. Nothing pointed at
it: 39 plan docs (1.2 MB) are named by date, a fact sits as one bullet inside a story, and
memory is organised by session, not by subject. The answer, approved "your rec on all go":

- **One register per repo** (`docs/dev/RESEARCH.md`), organised by subject. The kit's holds the
  shared AI-stack facts; this one holds JustVoice's.
- **Before research:** read the subject's section here and grep `docs/plans`. An agent's brief
  carries that section and the line *"don't re-derive these; re-check one only if the code it
  cites changed after its date"*.
- **After research:** its facts land here in the same change. A research doc with no entry here
  is not done. The family guard (`../../../just-llm-runner/scripts/check-family.js`, check 15)
  fails any `docs/plans/YYYY-MM-DD-*.md` dated 2026-10-04 or later that this page does not link,
  and any link here that points nowhere. (It can check the link, not that the facts came with
  it — that part is the rule.)
- **Filled as each subject comes up.** Speech runtime and speech memory were filled on
  2026-10-04; every other subject is indexed under "Records not yet distilled" until work
  touches it.

How this differs from its neighbours: `design-decisions.md` says what we DECIDED; `TASKS.md`
says what is OPEN; this page says what is TRUE — measured, read in code, or checked on the web —
and where the proof lives. Plan docs stay as the evidence.

## How an entry reads

One fact per bullet, then *how it was checked and when*, then where the proof is.

- **measured** — run on a machine (which one is in the proof) · **code** — read in source ·
  **web** — checked against an upstream page · **git** — read from history · **record** —
  carried from a record and not re-checked since · **agent** — found by a review agent reading
  code and not re-checked by the session that recorded it.
- A fact that turns out wrong is **rewritten**, ending "(was: … until <date>)". Never leave a
  fact standing beside its correction.
- A fact cites code by `file:line`. If that file changed after the fact's date, re-check that
  one fact — don't redo the research.

Subjects: [1 · Speech runtime](#1--speech-runtime-audiocpp) ·
[2 · Speech memory](#2--speech-memory-graphics-memory-and-the-booking) ·
[3 · Render and takes](#3--render-and-takes) ·
[4 · The app's view of the AI model](#4--the-apps-view-of-the-ai-model) ·
[5 · The narrator and the chapter run](#5--the-narrator-and-the-chapter-run) ·
[6 · The app stack: Electron, Node, phones](#6--the-app-stack-electron-node-phones) ·
[7 · Where an AI task shows](#7--where-an-ai-task-shows) ·
[8 · Character voices](#8--character-voices-effects-formants-conversion-creature-sounds) ·
[Records not yet distilled](#records-not-yet-distilled)

---

## 1 · Speech runtime (audio.cpp)

**Records** (newest last):
[`2026-10-01-audiocpp-switch.md`](../plans/2026-10-01-audiocpp-switch.md) — the switch: why,
side-by-side and pre-cut measurements, calls R1–R15, the gaps ·
[`2026-10-01-tts-engine-scan.md`](../plans/2026-10-01-tts-engine-scan.md) — the 2026 TTS engine
scan (IndexTTS 2.5, FireRedTTS3, audio.cpp's catalogue and the field) ·
[`2026-10-02-cpu-placement.md`](../plans/2026-10-02-cpu-placement.md) — which models run on the
CPU, measured; Auto/GPU/CPU (§8–9) ·
[`2026-10-02-our-audiocpp-copy.md`](../plans/2026-10-02-our-audiocpp-copy.md) — the fork, its
releases, the pin, the C++ gaps; the local CUDA build recipe (§6) ·
[`2026-10-02-gap-4-customvoice-0.6b.md`](../plans/2026-10-02-gap-4-customvoice-0.6b.md) ·
[`2026-10-02-gap-8-speed.md`](../plans/2026-10-02-gap-8-speed.md) ·
[`2026-10-02-gap-9-16bit-and-voxcpm2.md`](../plans/2026-10-02-gap-9-16bit-and-voxcpm2.md) ·
[`2026-10-03-gap-1-turbo-cloning.md`](../plans/2026-10-03-gap-1-turbo-cloning.md) ·
[`2026-10-03-gap-2-kokoro-blends.md`](../plans/2026-10-03-gap-2-kokoro-blends.md) ·
[`2026-10-03-gap-3-kokoro-ipa.md`](../plans/2026-10-03-gap-3-kokoro-ipa.md) ·
[`2026-10-03-gap-7-more-languages.md`](../plans/2026-10-03-gap-7-more-languages.md) ·
[`2026-10-04-turbo-tag-check.md`](../plans/2026-10-04-turbo-tag-check.md) — all 19 tags on
Turbo and Nano ·
[`2026-10-04-audiocpp-switch-audit.md`](../plans/2026-10-04-audiocpp-switch-audit.md) — the
audit: every decision checked against code, memory measured, findings ranked.
User-facing half: [`../engines.md`](../engines.md).

Before the switch (Python engines, history): [`2026-08-17-engine-roster-and-platform.md`](../plans/2026-08-17-engine-roster-and-platform.md) ·
[`2026-08-22-engine-environment-and-platform-research.md`](../plans/2026-08-22-engine-environment-and-platform-research.md) ·
[`2026-08-22-env-migration-implementation.md`](../plans/2026-08-22-env-migration-implementation.md) ·
[`2026-09-30-lifetime-leftovers.md`](../plans/2026-09-30-lifetime-leftovers.md).

### 1.1 The process and its life

- One `audiocpp_server` per placement AND kind: **gpu** (the installed build's backend) and
  **cpu** (the same build with `backend: cpu`), each for speech (`tts`) and for speech recognition
  (`stt`) — up to four, `audiocpp-server[-cpu][-stt]`; a CPU-only build runs only the cpu ones.
  Each starts from a generated config and `--no-ui`. A build with our `model_management` starts
  with no models and registers each on Load; an older build's config lists its kind's installed
  models (`lazy_load: true`). (was: one process per placement holding both kinds and listing
  every installed model — until 2026-10-04.) — *code + live, 2026-10-04* ·
  `engines/audiocpp/runtime.py` `AudioCppServer`, `slot.py` `ensure_server`; audit §13.2.
- **Downloading or deleting a model no longer restarts anything** on a build with
  `model_management`: live, a first download (`pocket-de-q8`) loaded with both processes keeping
  their ids, and speech recognition transcribed again without reloading. Swapping the speech
  model (Qwen3 → Chatterbox Turbo → Kokoro) with recognition loaded left both processes' pids and
  recognition's one booking unchanged, and every transcription read back exactly (2026-10-04). On an older build it
  still restarts that kind's own process on its next load — never the other kind's. (was: any
  first download restarted the shared process and killed the other kind's model — design choice
  at the cut, switch §3.1 — until 2026-10-04.) — *live, 2026-10-04* · audit §13.1 (the old
  behaviour, live), §13.2.
- **Registering at run time without the WebUI's powers:** audio.cpp's `POST /v1/models/load`
  (`id`, `family`, `task`, `path`, session options; loads at once; changed options reload the
  model) was reachable only under `ui_management`, which also opens a settable models root,
  model-package deletion, downloads, uploads and directory browsing on the loopback port with no
  sign-in and no CORS headers. Our fork's `model_management` config key opens only
  `/v1/models/load` and `/unload` (`/health` reports it). Both upstream v0.9.0 and our builds
  are compiled with the model manager. — *code + C++ unit test + live, 2026-10-04* ·
  `../audio.cpp/app/server/config.h`, `config.cpp`, `runtime.cpp` (`handle_model_load`),
  `tests/unittests/test_server_config.cpp` `test_model_management_alone`; `release.py` FEATURES
  `model_management`.
- A model loads when it is registered, so on a `model_management` build Load means loaded for
  every family. On an older build a lazy config loads a model on its first request: the slot's
  warm-up covers Kokoro, Kitten, Pocket, Qwen3 CustomVoice, speech recognition, VoxCPM2 and
  Turbo — **not** Chatterbox Multilingual, Qwen3 Base or Qwen3 VoiceDesign, which load (and
  book) on their first line there. — *code, 2026-10-04* · `slot.py` `_load`, `_warm`.
- A failed warm-up fails the load. (was: logged at info, and the load reported success — until
  2026-10-04.) — *code + tests, 2026-10-04* · `slot.py` `_warm`; audit §5 B4, §13.3.
- Unload frees the memory: after `/v1/tasks/unload_all_models` the gpu process held 103–105 MB
  every time. An empty process holds the same — the switch assumed ~300 MB (R7). — *measured,
  2026-10-04* · audit §3.2.
- A slot whose process died is dropped with its booking the next time anything asks for the
  kind's slot (`loaded_for`, and the memory strip before it reads the bookings); Cancel frees its
  booking, and a load cancelled while its model came in unloads it. Live: killing the GPU speech
  process dropped `tts:qwen3 (1913 MB)`; a Cancel 3 s into a VoiceDesign load ended it with
  nothing booked. (was: a dead slot stayed in `_loaded` with its booking, so a reload was refused
  against its own ghost — until 2026-10-04.) — *code + live, 2026-10-04* · `engines/manager.py`
  `loaded_for`, `_drop_dead_slot`, `request_cancel_load`; audit §13.2.
- The engine endpoints run on FastAPI's thread pool (plain `def`): live, the engine list answered
  in 8 ms and Cancel in 3 ms while a model loaded. (was: `async def` handlers calling the blocking
  manager on the event loop, so Cancel and the progress polls waited for the load — until
  2026-10-04.) — *code + live, 2026-10-04* · `api/engines_models_api.py`, `engines_api.py`,
  `models_api.py`; `tests/test_runtime_life.py`.
- On Windows the runtime runs in a kill-on-close Job Object and dies with our server however it
  dies; elsewhere nothing ties them. A clean shutdown stops the runtime FIRST, then lets the
  slots go, so it no longer waits for a line in flight. (was: each slot unloaded first — up to
  15 minutes for a line, longer than Tauri's 15 s, so off Windows the runtime outlived the app;
  and under `_manager_lock`, a deadlock against a load — until 2026-10-04.) — *record (R15) +
  code, 2026-10-04* · switch R15; `manager.py` `shutdown_manager`; audit §5 C4, C6, §13.5.
- audio.cpp answers 400, 503 `insufficient_memory`, 503 `server_busy` or 500 (an `error` that is
  an object with a message, or from some handlers a bare string). We keep the status end to end
  — `AudioCppError.status` → `EngineRequestError` → the API — and a timeout or a dropped
  connection is a 503 naming the limit or quoting the log's end. (was: only the message, every
  one a 500, and a string `error` body raised AttributeError — until 2026-10-04.) Its own
  free-memory guard is off (`min_free_memory_mb` 0). — *code + tests, 2026-10-04* ·
  `runtime.py` `_raise_for`, `_post`; audit §5 C8, D8, §13.5.
- A runtime log over 10 MB becomes `<name>.1.log` at its process's next start, and an error
  quotes only the log's last 64 KB. (was: never rotated, and read whole for every error —
  until 2026-10-04.) — *code + tests, 2026-10-04* · `runtime.py` `_rotate_log`, `log_tail`.
- The start limit (60 s), one request's limit (900 s) and the graphics process's CPU threads (4)
  are settings: `speech_runtime.start_timeout_s`, `request_timeout_s`, `gpu_threads`. A
  transcription gets the request limit or three times its length. — *code, 2026-10-04* ·
  `models.py` `SpeechRuntimeSettings`; `slot.py` `_transcribe_timeout`; audit §5 D9, F.

### 1.2 Requests, options and defaults

- Request mapping per family: Kokoro `voice` = preset id, language = the voice-prefix code;
  Qwen3 `options.speaker` (CustomVoice), `voice_ref` + `reference_text` (Base), `instructions`
  (VoiceDesign), language **a name** (`English` — `en` is rejected); Chatterbox `voice_ref`,
  language a code. — *measured on v0.9.0, 2026-10-01* · switch §3.4.
- Only Kokoro and Kitten reject an unknown option name; Qwen3, Chatterbox, Turbo, VoxCPM2 and
  Pocket ignore it silently. — *agent, 2026-10-04* · audit §5 (group D).
- **eSpeak NG:** Kokoro reads only the environment variables `AUDIOCPP_ESPEAK_LIBRARY` /
  `AUDIOCPP_ESPEAK_DATA`, else loads `espeak-ng.dll` / `libespeak-ng.dll` by name; Kitten reads
  `kitten_tts.espeak_library_path` / `kitten_tts.espeak_data_path`; Kokoro refuses a session
  option it doesn't know. We set the environment on every runtime process and Kitten's prefixed
  options; live, both processes then loaded the app's `espeak-ng-0.2.4\espeak-ng.dll`, and
  Kokoro's line read back word for word. (was: unprefixed session options that neither read,
  so both loaded the system copy `C:\Program Files\eSpeak NG\` on this PC's PATH and would
  fail elsewhere — until 2026-10-04.) — *code + process modules + measured, 2026-10-04* ·
  `../audio.cpp/src/models/kokoro_tts/g2p_multilingual.cpp:92-103`,
  `src/community_models/kitten_tts/session.cpp:74`, `src/framework/text/espeak_phonemizer.cpp:71-93`;
  ours `engines/audiocpp/runtime.py` `_child_env`, `slot.py` `_entries_for`; audit §13 step 1.
- **Seeds:** random per request on Qwen3, Chatterbox and Pocket. Kokoro and Kitten keep the
  session's seed until a request sends one — Kokoro, measured: no seed twice gives identical
  audio, and an unseeded line repeats the last seed sent. Turbo: none or 0 = a fixed seed.
  VoxCPM2: none = 1234. Seed 0 is a literal seed everywhere. — *measured (Kokoro) + agent,
  2026-10-04* · audit §5 D1.
- **The app sends a random seed when none is set, or 0**, so "no seed" is a new take on every
  family. (was: nothing sent — Kokoro, Kitten, Turbo and VoxCPM2 repeated — until 2026-10-04.)
  — *code + tests, 2026-10-04* · `slot.py` `to_speech_request`; audit §13.5.
- **Defaults inside audio.cpp:** Qwen3 temperature 0.9, top-k 50, top-p 1.0, repetition 1.05,
  `max_new_tokens` 8192 (the model's own `generation_config.json`); Chatterbox temperature 0.8,
  repetition 1.2, min-p 0.05, top-p 1.0 (upstream `mtl_tts.py` on master says the same); Turbo
  0.8 / top-p 0.95 / top-k 1000 / 1.2; VoxCPM2 guidance 2.0, 10 steps. Our Chatterbox knob shows
  1.2 (was: 2.0, while 1.2 was used — until 2026-10-04). — *code + web, 2026-10-04* · `../audio.cpp/include/engine/models/chatterbox/tts.h:22-25`,
  `capability_details.py:173, 203`; audit §5 D3, §7.
- Temperature 0: Qwen3 refuses it, Chatterbox divides by it, Turbo treats it as 1.0. Qwen3
  top-p 0 turns the filter off. The app floors every temperature and top-p at 0.05, in the knobs
  and the request mapping. — *agent + code, 2026-10-04* · audit §5 D4, D9, §13.5.
- **audio.cpp splits a request's text itself:** budgets Chatterbox and Turbo 128 characters,
  Kokoro 240, Kitten 400, VoxCPM2 2,048, Qwen3 8,192; `options.text_chunk_size` overrides. It cuts
  at a sentence end, then a clause, then a space, and joins the pieces with no crossfade. Our
  host splits above `max_chunk_chars` (800) at sentence ends with a 50 ms crossfade. — *code,
  2026-10-04* · `../audio.cpp/src/framework/text/chunking.cpp:332-397`; `render_core.py:774-797`;
  audit §5 D5.
- Options the runtime reads, per engine — audit §7. Only Kokoro's model spec lists its options
  (`model_specs/kokoro_tts.json`: request, session, load); the Qwen3, Chatterbox, VoxCPM2 and
  Pocket specs list none. — *code, 2026-10-04*.
- **Chatterbox reads per request** `min_p` (0.05), `s3gen_cfg_rate` (0.7, the flow decoder's
  CFG), `max_tokens` (384), `do_sample`, `stop_on_eos`, `greedy`. Turbo's meanflow decoder
  ignores `s3gen_cfg_rate`. (was: "the runtime takes no min-p", the switch's reading — until
  2026-10-04.) — *code, 2026-10-04* · `../audio.cpp/src/models/chatterbox/session.cpp:45-80`,
  `include/engine/models/chatterbox/tts.h:19-32`, `s3gen_inference.cpp:541-545`.
- **Qwen3 reads per request** `subtalker_temperature` / `subtalker_top_k` / `subtalker_top_p`
  (0.9 / 50 / 1.0 — the sub-talker that fills in each frame's finer codes), `subtalker_do_sample`,
  `do_sample`, `max_tokens`. Session: `qwen3_tts.perf_mode` `off` | `flash_attention` (refused on
  anything but Q8_0 weights), `qwen3_tts.conv_weight_type` `native` | `f32` | `f16`. — *code,
  2026-10-04* · `../audio.cpp/src/models/qwen3_tts/session.cpp:29-90, 127-136, 184-191, 277-296`,
  `include/engine/models/qwen3_tts/types.h:24-33`.
- **VoxCPM2 reads per request** `min_tokens` (2), `max_tokens` (4096; 0 = the model's
  `max_length`), `retry_badcase` (on), `retry_badcase_max_times` (3 tries in all),
  `retry_badcase_ratio_threshold` (6.0). The ratio is also the length cap: a take stops at text
  tokens × ratio + 10 patches, and one that reaches the ratio is made again. Streaming needs
  `retry_badcase` off. — *code, 2026-10-04* · `../audio.cpp/src/models/voxcpm2/session.cpp:595-660`,
  `generator.cpp:89-107, 1236-1260`, `include/engine/models/voxcpm2/types.h:17-23`.
- **Pocket TTS's speech request applies only** `frames_after_eos`, `max_tokens` and
  `text_chunk_size`; `temperature` (0.7), `noise_clamp` (−1) and `eos_threshold` (−4) are read
  only by a voice-state preparation request. — *code, 2026-10-04* ·
  `../audio.cpp/src/models/pocket_tts/session.cpp:135-191`.
- **What the app exposes of these** (since 2026-10-04): Chatterbox `min_p` and `s3gen_cfg_rate`;
  Qwen3's three sub-talker settings; VoxCPM2's two runaway settings — advanced knobs at the
  runtime's defaults; Qwen3's `perf_mode` (8-bit rows) and `conv_weight_type` as per-model
  runtime options on the model row, passed at registration. Max-token caps are not offered (the
  models' positional limits unchecked). — *code + tests, 2026-10-04* · `capability_details.py`,
  `engines/audiocpp/runtime_options.py`; audit §13.5.
- Qwen3: a missing or unsupported language goes as "Auto", audio.cpp's own default. (was:
  "English" — until 2026-10-04.) Speech recognition and the aligner get the language's name for
  all 30 Qwen3-ASR languages, detection for anything else. (was: raw codes for the 20 outside
  `QWEN_LANGUAGE`, and "English" to the aligner — until 2026-10-04.) — *code + tests,
  2026-10-04* · `slot.py` `QWEN_LANGUAGE`, `ASR_LANGUAGE`; audit §5 D6, D7, §13.5.
- A Qwen3 clone decodes the **whole** reference clip again with every line, then trims it; the
  decoder works in 300-frame chunks with 25 frames of left context. — *code, 2026-10-04* ·
  `../audio.cpp/src/models/qwen3_tts/tokenizer_speech_decoder.cpp:47-48, 1267-1292`.

### 1.3 Quality and speed, measured

- Against the old Python engines (RTX 2070 SUPER 8 GB, same 20 lines and seeds): Qwen3
  CustomVoice 1.7B 2.0× real time vs 0.26×; Chatterbox Multilingual 2.08× vs 0.92×; Kokoro 11.9×
  on CUDA, 2.84× on the CPU. Word errors level. — *measured, 2026-10-01* · switch §2.1.
- A whole book (289 lines) on Kokoro, Qwen3 CustomVoice and Chatterbox: 0 failures; read back
  by Qwen3-ASR at 7.3 / 10.2 / 8.9 % word error (medians 0–1.3 %, misses are invented names).
  Qwen3 line 208 ran on far past its text — the model, seen on both runtimes. — *measured,
  2026-10-01* · switch §8 A.
- Speech recognition: Qwen3-ASR 1.7B 8-bit beats Whisper turbo in 5 of 7 languages, trails on
  Japanese (+1.3 points) and Chinese (+2.8); Parakeet-TDT 0.6B v3 is 6.5× faster with no
  Japanese or Chinese. — *measured, 2026-10-01* · switch §8 D.
- Vulkan on the NVIDIA card: Kokoro 2.78×, Qwen3 CustomVoice 1.69× (CUDA 11.9×, ~2.0×). —
  *measured, 2026-10-01* · switch §8 C.
- Splitting long lines costs no speed: Qwen3 VoiceDesign, 752 characters, 27.1 s whole, 23.9 s
  in 200-character pieces. — *measured, 2026-10-04* · audit §3.3.
- **By ear (the user, 2026-10-04), same line, same seed:** a voice made from words split into
  200-character pieces changes person slightly from piece to piece — Qwen3 VoiceDesign and a VoxCPM2
  description alike — so description voices are spoken whole; a Qwen3 Base clone decoding only its
  reference's last 25 frames sounds no different from decoding the whole clip; Qwen3 CustomVoice's
  decoder at 16-bit weights can't be told from 32-bit (2.04 dB log-spectral apart), so 16-bit is
  the default since. — *listened, 2026-10-04* · audit §13.6; "1 no it changes persons on the 200 slightly 2 person changes 3 no difference 4 cant tell a difference".
- Chatterbox Multilingual drops `[laugh]` rather than speaking it. — *measured, 2026-10-01* ·
  switch §8 live.
- v0.9.0's aligner gave seconds at the input rate (2/3 of real on 24 kHz); fixed in our build
  jv.1, and the slot still sends 16 kHz mono. — *measured, 2026-10-01* · switch §8 live;
  our-audiocpp-copy.

### 1.4 Builds, releases and installs

- **Pinned build `v0.9.0-jv.4`** — tag at our copy's `f7d8140a`, published 2026-10-05 01:25 UTC
  by release run 37243444087 after dry run 37235747073 passed on every platform. Builds in order
  `v0.9.0`, `v0.9.0-jv.1`, `v0.9.0-jv.4`; an install on either older one keeps working until
  updated. Features: `voxcpm2_transcript` jv.1; `voice_pack`, `inline_ipa`, `turbo_clone`,
  `chatterbox_he_ru_zh`, `japanese`, `model_management` jv.4. (was: pinned jv.1, with jv.2 / jv.3
  placeholders — until 2026-10-04.) — *code + GitHub API, 2026-10-05* ·
  `engines/audiocpp/release.py`.
- Tags `v0.9.0-jv.2` (`42db68d9`) and `v0.9.0-jv.3` (`3865d245`) exist on commits whose macOS
  build failed; nothing was published for them, and their names are not reused (decided
  2026-10-04). — *git, 2026-10-04* · audit §5 E2.
- **Live, the update jv.1 → jv.4** through the app's own install job on the real data folder
  (headless server on the pinned release): 464 MB + 607 MB downloaded and checksum-checked,
  swapped in, jv.1 deleted, no `.downloads` left, in 23 s. On the published build: Kokoro
  `jf_alpha` Japanese read back exactly; a Kokoro blend played; a Chatterbox Turbo clone (with
  `[laugh]`) read back word for word; Chatterbox Russian and Chinese read back exactly. —
  *measured, 2026-10-05* · TASKS (the release item).
- Every build feature a line needs is checked against the INSTALLED build, and the refusal
  offers an update only when the pin has the feature. (was: only `voice_pack`, `turbo_clone` and
  `inline_ipa` were checked; the other three were offered from the pin alone — until
  2026-10-04.) — *code + tests, 2026-10-04* · `slot.py` `features_needed`, `feature_refusal`;
  audit §5 E1, §13.5.
- v0.9.0-jv.4's Windows archives: CUDA 12.4 464 MB + its CUDA runtime 607 MB; CUDA 13.3 275 MB +
  575 MB; Vulkan 63 MB; CPU (portable) 28 MB. Linux: x86-64 only (Vulkan, CPU, a Colab CUDA
  build); macOS: Metal for arm64 (32 MB) and x64 (33 MB). (was: jv.1's — 461, 273, 60, 26 MB —
  until 2026-10-04.) — *GitHub API, 2026-10-05* · release v0.9.0-jv.4.
- Each pinned archive carries its published sha256 (GitHub's asset digest); the kit refuses and
  deletes a mismatch before unpacking, downloads into `<build>/.downloads/` so a stopped download
  resumes, and deletes the archives after the swap. The CPU rows are the portable builds (the
  plain one exits on a CPU without the newest instructions, audio.cpp #352). (was: URLs only on
  a re-uploadable tag, launch-verified; archives inside staging, wiped every attempt; the plain
  CPU build — until 2026-10-04.) — *code + tests, 2026-10-04* · `release.py` `SHA256`; kit
  `runner/binary.py` `_stage_and_swap`; audit §5 E6, E7, §13.5.
- eSpeak NG 0.2.4's wheels on PyPI: `macosx_10_12_x86_64`, `macosx_11_0_arm64`,
  `manylinux_2_17_x86_64.manylinux2014_x86_64` (two tags in one name), `manylinux_2_28_aarch64`,
  `win_amd64`, `win_arm64`. The install matches any one tag of a name. (was: an exact suffix
  match that missed the Linux x86_64 file, so the runtime install couldn't finish there — until
  2026-10-04.) — *web (PyPI JSON) + code, 2026-10-04* · `espeak.py` `wheel_matches`; audit §5 A2.
- Model files come from `audio-cpp/audio.cpp-gguf` pinned at commit `7bf52723…`. A file whose
  LFS oid is a sha256 is checked against it after download and deleted on a mismatch; two
  fetches of one model are serialized. (was: size only, and two fetches raced — until
  2026-10-04.) — *code + tests, 2026-10-04* · `release.py` `MODEL_REVISION`; `speech_cache.py`
  `_verify_lfs_sha256`, `_fetch_lock`; audit §5 E6.
- **libmecab (Japanese) on every platform:** every build stages it beside the executable from
  fugashi 1.5.2's wheel for its platform — `libmecab.dll`, `libmecab.2.dylib` (universal2) or
  `libmecab.so.2` — with `libmecab.LICENSE.txt`, and the loader tries that copy first on macOS
  and Linux too. Checked in the jv.4 dry run's Windows, macOS arm64 and Linux bundles. (was:
  Windows only; macOS and Linux asked for `libmecab.so.2` by bare name, which never looks beside
  the executable and is the wrong name on macOS — until 2026-10-04.) A
  `file(ARCHIVE_EXTRACT … PATTERNS)` that matches nothing fails the configure, so each wheel's
  extract names only its own folder. — *code + CI, 2026-10-04* · our copy `9e5a4887`,
  `f7d8140a`; `cmake/text_dictionaries.cmake`, `src/framework/text/mecab.cpp`.
  fugashi 1.5.2's cp312 wheels carry libmecab 0.996 (BSD, `LICENSE.mecab`) on every platform:
  macOS `fugashi/.dylibs/libmecab.2.dylib` (arm64, x86_64 and universal2), Linux
  `fugashi.libs/libmecab-<hash>.so.2.0.0` (manylinux2014 x86_64 `eada4a80`, aarch64
  `608f3a6a` — the name carries auditwheel's hash, so a copy must be renamed); libmecab is each
  wheel's only bundled library. — *web (PyPI) + wheel contents, 2026-10-04*.
- Qwen3-ASR has no Hebrew: a Hebrew line read back as Spanish-looking words — Chatterbox's
  Hebrew can't be checked by read-back. — *measured, 2026-10-05* · `slot.py` `ASR_LANGUAGE`.
- `npm run dev` runs our checkout's build (`../audio.cpp/build/jv-dev`); on this card (Turing)
  CUDA graphs are disabled by ggml. — *code + runtime log, 2026-10-04*.

---

## 2 · Speech memory (graphics memory and the booking)

**Records:** [`2026-10-04-audiocpp-switch-audit.md`](../plans/2026-10-04-audiocpp-switch-audit.md)
§3 (measurements, cause, levers) and §5 B (the booking) ·
[`2026-10-01-audiocpp-switch.md`](../plans/2026-10-01-audiocpp-switch.md) §8 A–B ·
[`2026-10-02-cpu-placement.md`](../plans/2026-10-02-cpu-placement.md).
Before the switch (Python engines, history): [`2026-08-08-vram-think.md`](../plans/2026-08-08-vram-think.md) ·
[`2026-08-13-speech-catalog-redesign.md`](../plans/2026-08-13-speech-catalog-redesign.md).
The arbiter and the probes are the kit's: [`../../../just-llm-runner/docs/dev/RESEARCH.md`](../../../just-llm-runner/docs/dev/RESEARCH.md).

### 2.1 What a line costs

All on an RTX 2070 SUPER 8 GB, Windows 11, driver 610.88, our dev build on CUDA, the AI model
unloaded — audit §3.1 has the method.

- **Peak memory grows with the length of the line, on every engine.** Peak above idle for 14 /
  752 characters: Kokoro 609 / 2,735 MB; Qwen3 CustomVoice 1.7B 2,528 / 6,872; Qwen3
  VoiceDesign 1.7B 2,356 / 7,122; Chatterbox Multilingual 1,758 / 3,480; Turbo 1,812 / 2,856;
  VoxCPM2 4,160 / 6,438. — *measured, 2026-10-04* · audit §3.2.
- **Splitting caps it:** VoiceDesign 752 characters 7,122 → 3,976 MB in 200-character pieces,
  3,100 in 120; Kokoro 2,735 → 1,235 in 120; VoxCPM2 6,438 → 5,230 in 200. — *measured,
  2026-10-04* · audit §3.3.
- **A Qwen3 clone pays for its clip on every line:** a 15.5 s clip with its words puts a
  14-character line at 5,407 MB, and 200-character pieces don't lower it; sound-only cloning
  (`x_vector_only_mode`) puts that line at 2,219. — *measured, 2026-10-04* · audit §3.2–3.3.
- Readings near 7.6 GB are the card's ceiling — floors, not peaks. A peak also depends on the
  line before it: the same medium Base line read 7,135 MB after a short line, 6,084 first. —
  *measured, 2026-10-04* · audit §3.2–3.3.
- Memory held after a line follows that line until the next one resizes it (VoiceDesign held
  6,249 MB after a 752-character line, 2,843 after the next short one); VoxCPM2 drops back to
  2,939 after every line. — *measured, 2026-10-04* · audit §3.2.
- Over a whole book Qwen3 CustomVoice peaked at 7.8 GB and ended at 4.0, swinging 3–5 GB line
  to line; Chatterbox peaked at 3.2 GB; Kokoro's RAM stayed at ~550 MB. — *measured,
  2026-10-01* · switch §8 A.
- **Why (Qwen3, from the source):** the audio decoder's working memory scales with the line's
  frames (up to 325) and includes a 7× im2col copy in 32-bit; the KV cache is 32-bit and only
  grows. Upstream's own report: 6,397 MiB peak in a long session, 8,138 long-form. Two more
  causes are FIXED in our fork (was: a new decoder buffer built before the old one was freed;
  the talker's prefill giving every intermediate of all 28 layers its own memory; a clone
  decoding its whole reference clip with every line — until 2026-10-04): byte-identical audio,
  peak above the loaded model CustomVoice 3,208/4,358 → 2,538, VoiceDesign 3,286/4,886 → ~2,500,
  Base clone 4,364/4,868 → 1,670 MB (the clone's trim moves its audio 2.69 dB log-spectral; two
  takes are 19 dB apart). — *agent (code) + measured, 2026-10-04* · audit §3.5, §13.4.
- **CustomVoice 1.7B's 752-character line in 200-character pieces, on the fixed build: 3,433 MB
  above idle**, 48.9 s of audio in 23.9 s. Session options on that line: `mem_saver` changes
  nothing (identical audio, same peak); `perf_mode=flash_attention` −194 MB, 9 % faster, a
  different take; `conv_weight_type=f16` −492 MB, audio 2.04 dB away (close). — *measured,
  2026-10-04* · audit §13.4.

### 2.2 Beside the AI model

- Gemma 4 26B-A4B QAT measured 6,844 MB. Loading Kokoro on CUDA (567 MB at load) evicted all of
  it: 6,844 + 567 + the 1,024 MB safety margin is more than the card. Before the switch Kokoro
  ran on the CPU and the two coexisted. — *measured, 2026-10-01* · switch §8 B. CPU placement
  was built for this (cpu-placement §8).
- On an 8 GB card Qwen3 at any piece size (3–4 GB) cannot sit beside that model; the two take
  turns. — *measured numbers above, 2026-10-04*.

### 2.3 The booking (admission and placement)

- **The price of a load is exactly that model's own measured peak**, on this machine and
  device, at the piece length it is given (`"peak"` rows, flag `split_chars`); placement and
  the memory check both read it (`_price_mb`). A model with no price on the card calibrates on
  its first load: its warm-up is a full-length piece. Live (gemma resident): Qwen3 CustomVoice
  1.7B's first load unloaded gemma, calibrated at 200 characters and recorded 4,057 MB in 17 s;
  its next load beside a freshly loaded gemma was admitted by evicting gemma and took 10.6 s.
  (was: the check took the largest load reading of ANY variant of the engine — VoiceDesign was
  priced at CustomVoice 0.6B's 6,249 MB — and placement the newest of the exact one, from a
  shared process — until 2026-10-04.) — *code + live, 2026-10-04* · `engines/manager.py`
  `_price_mb`, `effective_split`; audit §5 B1, §13.3.
- **A load is checked before anything changes**: placement → the memory check (crediting the
  same-kind occupant it replaces; variant switches included) → the download → Auto's AI-model
  unload, which now waits for the memory to drain. (was: download, then unload the AI model,
  then the check — a refusal left both done; a variant switch skipped the check — until
  2026-10-04.) — *code + tests, 2026-10-04* · audit §5 B2, B5, §13.3.
- **A price belongs to the runtime build that measured it** (flag `runtime`); a new build
  calibrates again, because a price only rises within a build. — *code, 2026-10-04* · audit §13.4.
- Each kind books its own process's measured memory — its model plus ~100 MB of process. (was:
  one shared process, each kind booking the total less the other kind's booking (`_own_share_mb`,
  R7) — a computed share; one variant's stored readings ranged 105–6,249 MB — until 2026-10-04.)
  — *code, 2026-10-04* · audit §5 B8, §13.2.
- A model's CPU speed is the best of the newest five readings at the current CPU-thread count;
  the 16-bit Kokoro and Pocket TTS (English, Spanish, Portuguese) rows carry their own reference
  speeds (Kokoro bf16 2.61×, Pocket 3.11 / 3.02 / 2.85×, measured like their 8-bit rows: 2.60
  and 2.91×). (was: the newest reading alone, any thread count — one slow line kept a model off
  the CPU for good; 16-bit rows had no speed, so Auto unloaded the AI model for a 212 MB Kokoro —
  until 2026-10-04.) — *code + measured, 2026-10-04* · `manager.py` `cpu_speed`; audit §5 B6,
  B7, §13.5.
- On a machine whose graphics share its memory, Auto places on the graphics and says the CPU
  would free nothing. (was: always "nothing else is on the graphics card" — until 2026-10-04.) —
  *code, 2026-10-04* · `manager.py` `_card_is_its_own_memory`; audit §5 B9.
- The safety margin is 1,024 MB (the kit's setting; the manager falls back to the same). —
  *code, 2026-10-04* · `manager.py:800-803`.

### 2.4 What the app shows of it

- AI Settings' strip reads `GET /v1/llm-runner/resident`: `vramTotalMb`, `usedMb` (measured;
  null on a box with no probe → the strip says "reserved" and uses `committedMb` /
  `remainingMb`), `memArch` ("discrete" → VRAM, else "Memory") and `models[]` (`status`,
  `vramMb` — the LLM cell sums the awake ones). The cells are built inside the kit's
  `AiModelsArea.vue` (`memCells`, not exported) with SCOPED styles (`.lu-hwstat`), so no other
  screen can borrow either. JustVoice adds TTS · STT (and Busy) from `/v1/engines/vram`
  through `services/vramFeed.js` `hostCells`. — *code + live, 2026-10-06* (live: 8,192 MB
  total, 855 MB used, discrete).
- Home shows the same cells — VRAM used · Free · LLM through JustVoice's copy of that reading
  (`vramFeed.residentCells`, the kit left untouched by the user's word) and TTS · STT from
  `hostCells` — and nothing else; checked cell for cell against AI Settings. (was: Home read
  `gpus[0].vram_used_mb` from `/v1/system/info`, a field that endpoint never had — "VRAM NaN /
  8 GB" — until 2026-10-06.) — *code + live, 2026-10-06* · `HomeView.vue` (`memoryCells`).
- `/v1/health` carries `current_model`, the loaded speech model's catalog name (*Kokoro 82M*),
  beside `current_engine` (the id). The top bar's pill shows the name. — *code + live,
  2026-10-06* · `api/health_api.py` (`loaded_model_name`).

- **What a preview says about a load**: a ▶ that needs a model not loaded asks first ("Load
  Kokoro?" → **Load & play**), then shows "Loading Kokoro… this can take up to a minute." and
  "Kokoro loaded." (`services/voiceAudition.askingToLoad`; the Voices table its own copy). With
  **Always auto-load** on it skips the question and still says both (since later on 2026-10-07 —
  every preview asks the server without loading first; was: it loaded in silence). A preview heard
  before plays from the server's memory and loads nothing. There is no Generate page any more —
  `/v1/generate` serves MCP and JustWrite. — *code + live, 2026-10-07*.

---

## 3 · Render and takes

**Records** (newest last):
[`2026-09-30-mock-vs-app-and-slice-4.md`](../plans/2026-09-30-mock-vs-app-and-slice-4.md) — the
mock against the app, and Slice 4's research (§3) ·
[`2026-10-04-slice-4-render.md`](../plans/2026-10-04-slice-4-render.md) — Slice 4's build plan,
its blast radius and the gaps.

- Both render doors — a chapter (`render_chapter_api._resolve_scene_to_lines`) and one line
  (`export_voicelines.render_block_take`: a take, Lines ↻, the game export, render jobs) — plan
  the line with the same `line_takes.plan_block` (over `persona_render.plan_line`, with the line's
  own numbers as the request), then `render_core.render_line`. — *code, 2026-10-04* ·
  `export_voicelines.py` (`render_block_take`); `render_chapter_api.py` (the resolver's loop).
  (was: both called `plan_line` directly — until 2026-10-04.)
- The chapter, the M4B export, the ACX check and captions play each line's ★ take where it has
  one with audio on disk, and render the rest through the render cache; captions use the take's
  own words. — *code, 2026-10-04* · `render_chapter_api.render_scene_lines(_async)`,
  `played_texts`; `align_api.scene_captions`. (was: chapter audio never read a take — until
  2026-10-04.)
- A take keeps its audio (`generations/<id>.wav`, stored relative to the data folder), the seed
  and inputs key it was made with (`Generation.seed`, `Generation.cache_key`), its direction
  (`instruct`) and its real length, and becomes the line's only ★ take. — *code, 2026-10-04* ·
  `render_jobs.persist_block_take`. (was: no audio, no seed or key, a 16 kHz length, and the old
  default never cleared — until 2026-10-04.)
- An MCP generation's length is read from the WAV's own header (any sample rate), rounded to 3
  places, and its row stores the language it was spoken in — the call's, else the persona's, else
  `en`. — *code + test, 2026-10-08* · `server/src/mcp/tools.js` `speak`,
  `server/tests/mcp_rulings.test.js`. (was: it assumed 16 kHz, 16-bit mono and stored the call's
  language or `en` — until 2026-10-08, the clean-room rewrite's rulings 12 and 13.)
- A line is STALE when the inputs key of what it is made from now differs from its ★ take's key;
  the key is the render cache's (`render_core._inputs_key`, one builder for the render, the probe
  and the check). A ↻ New take take (`Generation.source` "new_take") is judged with its own seed,
  any other with the persona's seed now. A take with no key or no audio reads stale. — *code,
  2026-10-04* · `line_takes.take_is_current`.
- Rendering a line again with nothing changed gives back the same audio — the render cache hits.
  ↻ New take rolls a seed (`line_takes.roll_seed`) so the key misses; ↻ Re-render all renders
  past the cache (a render job made with `fresh`). — *code, 2026-10-04* · `takes_api.render_block`;
  `render_jobs._job_is_fresh`.
- A deleted take's generation and file go with it: `DELETE /v1/takes/{id}` deletes both, and
  `line_takes.sweep_orphan_takes` removes take generations left by a line, chapter, book or sheet
  re-import delete (FK cascade takes the take; `Generation.block_id` is SET NULL), after those
  deletes and at boot. — *code, 2026-10-04* · `projects_api.py` delete sites; `app.py` boot.
  (was: rows outlived their takes — until 2026-10-04.)
- `PATCH /v1/blocks/{id}` with `metadata` replaces the block's whole metadata JSON (which also
  holds `prev_speaker_id`, `marker`, `pause_after_ms`); `line_override` merges only the line's
  own numbers (speed, pitch, gain_db, pause_after_ms) into it. — *code, 2026-10-04* ·
  `projects_api.update_block`; `line_takes.merge_override`.
- A chapter's position PATCH swaps it with the chapter already at that position; deleting a
  chapter moves the ones after it up. — *code, 2026-10-04* · `projects_api.update_scene`,
  `delete_scene`.
- A line's own pause after (imported `pause_after_ms`, or the ⚙ hatch) wins over its persona's.
  — *code, 2026-10-04* · `line_takes.override_delivery` via `plan_block`. (was: the persona's
  won — until 2026-10-04, decided G7.)
- There is no Stories tab or timeline page: the placeholder was removed 2026-10-06 (the
  2026-08-15 ruling); its tables `stories` / `story_items` stay, with nothing reading them.
  — *code, 2026-10-06* · `database/models.py:417-440`; no `/stories` route in
  `router/index.js`. (was: an inert tab, the rail its only door — until 2026-10-06.)
- A JustWrite chapter's lines keep the book scene each came from: the import writes
  `source_ref` = `chapter:<id>#scene:<id>#block:<n>` into the line's metadata, and a scene
  ends where the next line names another scene. Analyze gives every line it cuts from one
  paragraph that paragraph's `source_ref`; split, ✎ Edit text and ＋ Add text make lines with
  none. — *code, 2026-10-06* · `imports/adapters/justwrite.py:212`, `projects_api.py:916`,
  `extraction_api.py:539`, `projects_api.py:613`, `line_takes.scene_ends`.
- The pause at a scene break joins lines only: it is set on the rendered line in
  `_join`, never in its delivery, because the delivery is hashed into the line's audio key
  (`render_core._inputs_key`) — a pause there would make the line stale. A line's own
  `pause_after_ms` wins; a persona's pause after does not. — *code, 2026-10-06* ·
  `render_chapter_api._join`, `_resolve_scene_to_lines`.
- Every mastering target encodes MP3, YouTube's too, and is served as `audio/mpeg`.
  — *code, 2026-10-06* · `models.py:214` (`format="mp3"`), `master_api.py`,
  `render_chapter_api.py` media maps. (was: YouTube served as `audio/aac` — until 2026-10-06.)
- Kokoro's pack mean sums the voices in `voices.json` order, so the "mean" blend is the same
  bits on every run. — *code, 2026-10-06* · `engines/blending.py` `_kokoro_pack` (a list).
  (was: a set, in Python's per-process hash order — 82 % of values differed across three
  seeds, max 4.5e-8 — until 2026-10-06.)
- A chapter line's language and seed come from the one resolver: `persona_render.plan_line` →
  `ChapterLine(language=plan.language, seed=plan.seed)` (`render_chapter_api.py:183-185`). The
  language is the persona's when its model speaks it, else the voice's own, else the model's
  first (`persona_render.persona_language`, `:168`); the seed is the persona's for that model
  (`model_settings`). The speech runtime sends both to every model — `slot.py:655` (the seed;
  random when none), `:663` (Kokoro), `:691` (Qwen3's language names), `:765` (Chatterbox).
  — *code, 2026-10-05* (was: "language never reaches Chatterbox or Qwen3" and "a persona's seed
  is ignored when a chapter renders" — both true on the Python engines until the 2026-10-01
  switch and the 2026-10-03 resolver; the two TASKS findings were closed 2026-10-05).
- A line's Render overrides: the four numbers at the top of its block metadata (`speed`,
  `pitch`, `gain_db`, `pause_after_ms`) and, per model, `{knobs, emotion, register_tag}` under
  `line_models` — the shape of a persona's `PersonaModelSettings`; `emotion: ""` = none on the line.
  `PATCH /v1/blocks/{id}` `line_override` merges both (a value sets, null clears; `models: null`
  clears every model). `plan_block` passes `line_models` to `plan_line`, whose
  `model_settings(persona, model, line)` lays the line's settings for THAT model over the
  persona's — so another model's never reach the render — and the inputs key changes, so the line
  turns stale. — *code + test, 2026-10-06* · `line_takes.py`, `persona_render.py`,
  `server/tests/test_line_model_settings.py`.
- A chapter's text can be edited as a whole: `GET`/`PUT /v1/scenes/{id}/text`
  (`projects_api.text_edit_plan`, difflib over whitespace-normalised lines). Unchanged lines keep
  their id, speaker and takes; changed and new paragraphs are new `source="manual"` lines, which
  `ScriptChapter.edited_since` counts on an analyzed chapter (an Analyze rewrites every line's
  source but "corrected", so none are left after it). Analyze then keeps the lines
  (`extraction_api._lines_to_keep`), reading a hand-added line as its own paragraph. — *code,
  2026-10-05* · `server/tests/test_chapter_text.py` ·
  [`2026-10-05-chapter-text-edit.md`](../plans/2026-10-05-chapter-text-edit.md).
- Dictation can't be started from the app: the shell's hotkey monitor
  (`src-tauri/src/hotkey_monitor.rs`, `enable_hotkey` / `update_chord_bindings`) is never armed
  by the renderer (`services/native.js:19`), the Captures tab's Record is off, and paste isn't
  built; the server side works (`POST /v1/captures`). The server reads `captures.language` and
  the three cleanup flags; Home's banner reads `hotkey_enabled` and the chord lists. — *code,
  2026-10-05* · [`2026-10-05-five-small-findings.md`](../plans/2026-10-05-five-small-findings.md).
- Only Kokoro speaks IPA (runtime v0.9.0-jv.4, `kokoro/manifest.py:33`); the capabilities row's
  `supports_phoneme_input` is the installed truth (`engines_api.py:252`). — *code, 2026-10-05*.
- A second look at lines Analyze leaves blank — one extra model call per blank line, with the
  end of the previous chapter and the start of the next — went 30/30, 0 wrong: The Ninth
  Facet's unrevealed voice (Bigger Inside D39) found as Odeline Marran from the next chapter,
  speakers not in the cast (Sedge ×5, the Speckled Band's driver ×3) kept unknown, 21 known
  lines asked as if blank all right. ~5–15 s per blank line on a normal chapter, ~23 s on a
  12.6 k-token one. Tested, not built. — *measured, 2026-10-05, the user's machine* ·
  [`2026-10-05-second-look-test.md`](../plans/2026-10-05-second-look-test.md).
- Where a second look plugs in (mapped 2026-10-05, an agent's read with the source greps
  re-run): after `pipeline.analyze_scene`'s rows (:750–752); every reader of a line's source
  (`PIPELINE_SOURCES`, `flags.DECIDED`, the *AI decided* count, `scriptReview.js`, `attribution.js`);
  seeds insert missing prompt keys on every start but don't refresh changed ones (kit `seed.py:1290`);
  the attribution Lab adapter is chosen by feature, so a prompt under `speaker_attribution` would
  run as the main call. — *agent + code, 2026-10-05* ·
  [`2026-10-05-second-look-build.md`](../plans/2026-10-05-second-look-build.md) §2.
- The attribution prompt's cast list (`prompts.format_characters`) carries id, name, role,
  gender, pronouns and aliases — never the speaker's description. The second look needs it
  ("Answers to Ode." links Odeline Marran to the "Ode" the next chapter names): without it, live
  Re-analyze left Bigger Inside's last line blank; with it, 3/3 + the live run found her. — *measured,
  2026-10-05* · `second_look.cast_lines` · plan §3.
- A chapter render on the dev machine with the AI model loaded (7.5 GB of the 8 GB card in use):
  The Same Hour, 81 lines (8 Kokoro voices, 1 Kitten) in about 4.5 min — Kokoro on the CPU, then
  swapped out for Kitten ("unloading tts engine kokoro before loading kitten"); joined and mastered
  to ACX: about 9.6 min, RMS −21.1 dBFS, peak −3.5 dB. — *measured, 2026-10-05* ·
  `logs/justvoice.log` 16:51–16:55.
- A persona can be saved with no delivery settings (`default_delivery` None — `POST /v1/personas`
  passes it through; Cast's batch makes them so); the project export writes `{}` for it. — *code
  + test, 2026-10-05* · `server/tests/test_project_export.py`. (was: the export crashed with a 500
  on such a persona — measured on the dev app until 2026-10-05.)
- A take's generation records the engine and the model that spoke it (`RenderedLine.engine` /
  `.model` → `generations.engine` / `generations.model`; the MCP path too). (was: every render
  saved `engine = "managed"` — `render_jobs.py` used `state.engines.current()`, which is never
  current for the speech runtime; 83 of 83 rows on the dev DB — and no model at all, until
  2026-10-06.) The Cache page names both; older rows read "not recorded". `generations.model`
  is schema only — the dev DB was reset for it. — *code + live, 2026-10-06* ·
  `render_core.py` (`RenderedLine`), `render_jobs.py`, `api/cache_api.py`.
- `/v1/takes/recent` (Home's Recent generations) names the persona that spoke each row. (was: it
  sent the legacy `profile_id`, which no render sets — every row said "?" — until 2026-10-06.) —
  *code + live, 2026-10-06* · `api/takes_api.py`.
- "Rendered" means a take made from what the line is now; a stale line has a take but is not
  counted rendered — Overview, the step cards, Home and Render's grid all count it so
  (`services/lineStates.js`). (was: Overview and Render's grid counted rendered + stale, Render's
  header did not — until 2026-10-06.) — *code, 2026-10-06*.
- ACX QC checks peak ≤ −3.0 dB (`export_audiobook.ACX_PEAK_MAX_DB`, the ACX limit); the ACX
  preset masters to −3.5 dB for headroom (`models.MasterPresetSettings.acx`). Export's
  checklist "Peak ≤ −3 dB" is right; the audit's C1 was wrong. — *code, 2026-10-06*.
- **Pace on Kokoro and KittenTTS is the model's own.** The request carries `speed`
  (`engines/audiocpp/slot.py:681-682` Kokoro, `:740-741` KittenTTS); both are `speed_native`
  (`capability_details.py:141`, `:159`), so `render_core.server_speed` returns None and the server
  never stretches them (the registry check before it only finds external providers —
  `app.py:469` registers nothing else). Our audio.cpp's Kokoro divides each token's predicted
  duration by the speed, rounds it and keeps it ≥ 1 frame (`src/models/kokoro_tts/predictor.cpp:968-972`)
  — upstream Kokoro's own rule, `torch.sigmoid(duration).sum(axis=-1) / speed`, then
  `round().clamp(min=1)`. — *code + web, 2026-10-07* · hexgrad/kokoro `kokoro/model.py`.
- **Every other model's pace is the server's**: Signalsmith Stretch time-stretches the finished line,
  pitch kept, 0.5–2.0 (`render_core.STRETCH_RANGE`), before gain and pitch — one `shape` request
  to `audiocpp_dsp` (`render_core.line_shape` → `audio/dsp_client.shape`). — *code, 2026-10-07*.
- **Pitch is the server's on every model** — no model reads `delivery.pitch`. `pitch_shift`
  (Signalsmith Stretch 1.4.0 inside `audiocpp_dsp`, the fork's `dsp/src/stretch.cpp`, seed fixed)
  transposes the finished line, length kept, clamped to ±12 st, after gain and before the effects
  chain. No formant control is wired yet, so a voice's formants move with its pitch: a few
  semitones sound natural, ±12 sounds like a much smaller or larger speaker. The library itself
  can shift formants (`setFormantSemitones`, `compensatePitch`) — §8. (was: python-stretch 0.3.1,
  the library at commit `ffa45981`, whose binding has no formant calls, seeded at random — until
  2026-10-07.) — *code, 2026-10-07*.
- **Gain is the server's**: `audiocpp_dsp`'s `apply_gain_db` (the fork's `dsp/src/line.cpp`; until
  2026-10-07 `delivery.apply_gain_db`, the same maths) multiplies the 16-bit samples and hard-clips
  at full scale — no limiter; clamped −24…+12 dB (`render_core.py:457`; Render's slider ±12). A
  boost on a line that already peaks near full scale clips it. The chapter is mastered after the
  lines are joined (`render_chapter_api._master_scene_pcm`, `:526`), so a line's gain sets only
  its level against the others — and its clipped peaks stay. — *code, 2026-10-07*.
- **A program the server starts without `CREATE_NO_WINDOW` inherits the server's console — and
  when the shell that started the app is gone, it can't start at all: exit `0xC0000142`
  (3221225794).** That is how every chapter's mastering failed on 2026-10-07: the app had been
  started by `npm run dev` in a background shell that later closed; no console host served the
  app's process tree, while the speech runtime and llama-server each had one of their own.
  Reproduced outside the app: a test process's console host killed, then ffmpeg without the flag
  → `0xc0000142`, with it → exit 0; a detached process with no console at all starts ffmpeg fine
  either way. Every program JustVoice's server starts — mastering's and the M4B export's ffmpeg,
  system info's `wmic` and `ffmpeg -version`, the speech runtime — and every program the kit
  starts (nvidia-smi and the other hardware probes, llama-server) goes through the kit's
  `llm_runner/platform/procs.py` (`NO_CONSOLE`); the kit register §5 has the kit's half. (was:
  JustVoice's own `procs.py`, the kit's spawns without the flag — until later on 2026-10-07; under
  a dead console the kit then found no GPU and llama-server could not start.) — *measured + code,
  2026-10-07*.
- **A take carries the model's own silence at both ends**: Kokoro, Brass Rank's first 30 takes —
  ~265 ms before the sound (up to 500) and ~715 ms after (up to 960), exact digital zero (the
  first and last 100 ms at −180 dBFS; the loudest tail −78 dBFS). Our code adds none. So until
  2026-10-07 a 600 ms pause between lines played as ~1.6 s, uneven by line. Since then
  `render_core.concat_lines` trims each line to 50 ms either side of anything louder than
  −70 dBFS as it joins (`_trim_pcm`); the take and its key are unchanged. A −45 dBFS threshold
  would have cut real sound: the two thresholds differ by up to 710 ms at a take's end, 50 ms at
  its start. Brass Rank joined + mastered: 10:04 → 9:04. — *measured, 2026-10-07* ·
  `server/tests/test_pause_heard.py`.
- **Lines of one paragraph share a `source_ref`** (the JustWrite import's `…#block:<n>`, kept by
  Analyze's cuts): Brass Rank's lines 3–5 — quote · *she told it,* · quote — all `#block:2`.
  `line_takes.paragraph_joins` finds them; the chapter joins them with
  `generation.pause_within_paragraph_ms` (250) the way the scene break works — set on the
  rendered line in `_join`, a line's own `pause_after_ms` wins, a persona's does not. Render's
  line list says so (`paragraph_next`). — *code + test, 2026-10-07*.
- **Long lines also hold ~0.9–1 s silences inside the take**: 17 in 14 of Brass Rank's 78 lines,
  all in narration lines over 240 characters — where OUR server cut the line into pieces at the
  model's piece size (Kokoro's catalog: 240, `render_core.line_split_chars`, `:883`) and joined
  them in `audio/chunked.concatenate_audio_chunks` with a 50 ms crossfade, each piece keeping its
  ~715 ms tail and ~265 ms lead. Kokoro's own pause at a sentence end inside a piece: median
  260 ms (middle half 210–310, 214 pauses); an em dash in one piece: 170 ms. audio.cpp never
  splits these lines (each piece is under its budget). (was: "where audio.cpp cut Kokoro's text …
  and joined them" — wrong, until later on 2026-10-07.) Since 2026-10-07
  `concatenate_audio_chunks` cuts the quiet at a piece join down to 260 ms, quiet judged the way
  the 260 ms was measured — 10 ms windows under −60 dBFS (a per-sample −70 dBFS left a faint fade
  and the joins measured 440–480 ms). Through the app's path, fresh renders of lines 2, 7, 11:
  950 → 250, 870/880 → 260/270, 990 → 250 ms. Takes rendered before keep their gaps until
  rendered again past the cache. Voice previews take the same seam since 2026-10-07
  (`audio/chunked.join_pieces`; the stream holds each piece's trailing quiet back for the next
  seam, `held_for_next_seam`, and gives exactly the line's join — tested): the POST preview's
  join 990 → 260 ms, the stream's 870/880 → 260/270 ms. (was: "still hold the padding" — until
  later on 2026-10-07.) — *measured, 2026-10-07*.
- **Our audio.cpp copy joins a request's own pieces at 260 ms** (fork `a2d7c161`,
  `kokoro_tts/session.cpp` `piece_join_cut`): it cuts what is quieter than −70 dBFS on either
  side down to Kokoro's sentence pause and shifts word timings. Measured straight from the
  runtime on a 423-character line: the join 950 ms → ~250 ms. Only reached by a request longer
  than audio.cpp's own budget, which the app never sends. Since later on 2026-10-07 it judges
  quiet as the server's join does — 10 ms windows under −60 dBFS (fork `a2601edf`). Measured
  again straight from the runtime (`build/jv-dev`, af_heart): the 423-character line is cut
  after its second sentence (the first 13.58 s agree sample for sample with those 232
  characters rendered alone) and the join is 260 ms. Kokoro's own pauses at the two sentence
  ends inside the pieces of that line were 650 and 560 ms — the 260 ms target is the book's
  median, not every pause. (was: "its threshold is still per-sample −70 dBFS, not the server
  join's −60 dBFS windows".) — *measured, 2026-10-07*.
- **The M4B export, as a job** (`api/export_jobs_api.py`): The Ninth Facet — 4 chapters at ~6 s
  each (every line already had its take), then ~23 s encoding; 49 s, a 31.7 MB, 34.2 min M4B with
  the four chapter titles. The file is handed over once, then the job is gone. — *measured,
  2026-10-07*.
- **The desktop window saved no export until 2026-10-07**: the kit's `saveBlob` opens a Save dialog
  only when the host wired `configureFileSave`, which JustVoice never did, so it fell back to a
  blob download — and WebView2 ignores `<a download>` on blob: URLs (JustWrite's `lib.rs` says so
  where it wires its own). The export said "M4B exported." either way. JustVoice now has
  JustWrite's `shell_save_file` and `saveFile`, byte-identical. — *code, 2026-10-07*.
- **"⬇ Chapter WAVs (zip)" is chapter audio since 2026-10-07**: an export job
  (`POST /v1/projects/{id}/export_chapters/start`) zips `chapters/NN Title.wav` (joined, the
  model's rate) and `masters/NN Title.wav` (mastered to the book's target). The Ninth Facet: 26 s,
  279 MB; chapters 24 kHz at about −25.5 dBFS RMS, masters 44.1 kHz at −20.5, peaks −3.5 dB.
  (was: the button saved the project package — book data and each line's take — while Export's
  row said "per-chapter WAV + masters (zip)", until 2026-10-07.) The package
  (`GET /v1/projects/{id}/export`) is Overview's; it holds each line's take in use, never a
  master. (was: "its `include_masters` is still accepted and writes nothing" — the option went
  later on 2026-10-07.) — *code + measured, 2026-10-07* · `api/export_jobs_api.py`.
- **A render job's progress**: a line reads `running` from the moment the scheduler starts it
  (`render_jobs._rendering`) until the runner saves it (`completed`), fails it, or withdraws it
  (`pending`). `GET /v1/render_jobs/{id}` also returns `audio_seconds` (the finished lines'
  `Generation.duration_sec` summed) and `current` — the running lines, newest first, each with
  its number in its chapter (`line_takes.heard_blocks`) and its speaker's name; a line that has
  finished but is still being saved reads running beside the next for a moment.
  `?include_blocks=true` adds every line's state. — *code + test, 2026-10-07* ·
  `server/tests/test_render_jobs.py`.
- **A waiting render says what it waits for** (2026-10-07): every set sent to the speech
  queue names its owner — `{"label": "2 · Bigger Inside", "kind": "chapter"}` or
  `{"label": "the M4B export", "kind": "work"}` (`synth_scheduler.chapter_owner` /
  `work_owner`; all ten senders give one). `SynthScheduler.ahead(set_ids)` runs the pick rule
  to the end over the pending lines (interactive first, then the loaded model's lines, then the
  model of the oldest line) and returns the work before the set's next line, grouped by owner and
  model, the line running first; None while one of the set's own lines runs. A newer chapter on
  the loaded model goes before an older one on another model. `GET /v1/render_jobs/{id}` returns
  it as `waiting` (models by name) while the job runs. — *code + test, 2026-10-07* ·
  `server/tests/test_synth_scheduler.py`, `test_render_jobs.py`.
- **A render's model loads inside its first line**: `render_core.render_line` →
  `voice_model.ensure_model_loaded` → `EngineManager.load(engine, variant=…)`, on the queue's
  worker and with no `progress` callback — so a run shows that line *rendering…* for the whole
  load (Qwen3 1.7B: 17 s on a first load, 10.6 s after, §2.3), and nothing records "loading this
  model now". The manager reports its load steps (`loading`, `loading_weights`) only to a
  caller's `progress` (AI Settings' Load passes one). Since later on 2026-10-07 the load is noted
  (`voice_model.loading_now`) and a render job carries it while its line runs (`loading`); Render's
  strip says "loading Kokoro — 7 s" (measured: Kokoro took ~7 s from unloaded).
  — *code + measured, 2026-10-07*.
- **A deleted line's render is skipped**: deleting a book, a chapter or a line takes its
  render-job rows with it (the database's cascade), and the queue skips a line whose row is gone
  when it reaches it (`render_jobs._rendering` → `LineGone`); a line deleted while it renders
  finishes and is dropped, not saved. Live: a book deleted with a line rendering — that line
  dropped, the other five skipped within 5 ms, no errors. (was: a deleted book's lines all
  rendered, each then failing to save — `FOREIGN KEY constraint failed` on the `generations`
  insert, before the WAV was written; a two-chapter book's ~56 lines held the queue about two
  minutes — until later on 2026-10-07.) — *measured, 2026-10-07*.
- **A chapter page's runs are per chapter**: `StudioRenderChapter.vue` keeps `runs[sceneId]`, so
  chapter 1's run greys only chapter 1's verbs; chapter 2's ⚡ queues behind it and says so.
  (was: one `running` for the page — chapter 2's verbs greyed with no reason shown, until later
  on 2026-10-07.) — *measured, 2026-10-07*.
- **A chapter of 400 lines needs no virtualization**: on a temporary 400-line chapter (the
  sample book's paragraphs, deleted after), headless Chrome against the real app, Script's
  chapter page opened in 178–462 ms and Render's in 127–181 ms to all 400 rows, and both
  scrolled at 16.7 ms a frame (worst 17.1 and 19.3 ms). The longest real chapter, 78 lines,
  opened in 183–326 ms (2026-09-29). — *measured, 2026-10-07*.
- **A game project's Studio**: a 12-line sheet imported as `csv_lines` opens with Overview ·
  1 · Lines · 2 · Cast · 3 · Render · 4 · Export, and 1 · Lines shows the sheet. The Lines
  card reads "No lines yet — re-import the sheet" until each chapter's blocks have loaded
  (1–3 s; `studioStatus.stepStatus` has no loading word for it, as Render's "Checking what is
  rendered…" has). — *measured, 2026-10-07*.

---

## 4 · The app's view of the AI model

**Records:** TASKS "The header and Script hear an AI-model load made anywhere" (2026-10-05).

- The kit keeps ONE shared list of the built-in runner's models (`useRunnerModels`, exported
  with `refreshRunnerModels`): each model's status — `loaded`, `loading`, `disk`, `available`,
  `error`. AI Settings' catalog reads it and refreshes it after its own Load and Unload; it polls
  itself only while a model is `loading`. — *code, 2026-10-05* ·
  `../just-llm-runner/ui/src/composables/useRunnerModels.js` (`refresh`, `_startPoll`),
  `components/LuModelCatalog.vue` (`unloadModel`).
- The kit's LLM engine setup loads through its own task and re-reads that list only after its
  speed measure succeeds; its host hook `quickSetupCopy.onApplied({ modelId })` fires the moment
  the load is done. JustVoice dispatches `jv:health-refresh` from it. — *code, 2026-10-05* ·
  kit `views/QuickSetup.vue` (`finishApply`, `measureAfterApply`); `src/main.js`.
- JustVoice's header pill reads that list (`App.vue`, `llmLive`) and re-reads it on health
  events and when an AI task starts or ends; Script's "Analyze needs a language model" reads
  `/v1/extraction/config` through `composables/useAnalyzeModel.js` — on mount, on coming back,
  and on any change to the list. Live: Unload in AI Settings → the header said "No language
  model" in 2 s; Load now → gemma in 15 s; Script re-read each time. (was: both kept their own
  copy — the header of `/v1/llm-runner/status`, Script read once on mount — so a load from the
  setup or AI Settings never reached them, until 2026-10-05.) — *code + live, 2026-10-05*.
- While a model loads, the list can already say `loaded` while `/v1/llm-runner/status` still
  says `starting · loading into VRAM` (seen 2026-10-05, a few seconds). — *live, 2026-10-05*.

---

## 5 · The narrator and the chapter run

**Records:** [`2026-10-05-narrator-flow.md`](../plans/2026-10-05-narrator-flow.md) — the flow
decided 2026-10-05 and its blast radius.

- Narration is a line that is read and not spoken (`extraction/flags.spoken_block` false, not a
  marker). Analyze gives it to the narrator without asking the model; with no narrator it stays
  with no speaker. — *code, 2026-10-05* · `extraction_api.py` (`speaker == "narrator"` →
  `narrator_id`); `_chapter_script`.
- No book gets a narrator on its own (decided 2026-09-29). `POST /v1/projects/{id}/narrator`
  (Cast's Add Narrator) is idempotent: a speaker called Narrator takes the role, or one is made
  — cast with the persona of exactly that name — and the narration with no speaker moves to it
  (`moved_lines`). — *code, 2026-10-05* · `speakers_api.ensure_narrator`.
- While a book has no narrator, narration with no speaker is `waits_for_narrator` /
  `narration_waiting` and is left out of `no_speaker` and `to_check` (was: counted as No speaker
  and To check on every line — The Ninth Facet's four chapters read 43 · 46 · 39 · 31 "no
  speaker", nearly all narration, until 2026-10-05). — *code, 2026-10-05* · `_chapter_script`.
- Discover's scan and Script's Analyze share ONE queue per book (`services/chapterRun.js`) —
  one model call, one chapter at a time; each chapter is an inline kit task
  (`speaker_identification` / `speaker_attribution`, `meta.run`). The kit lists tasks oldest
  first and a finished one lingers, so a strip must prefer the running task (`runStripTask`).
  — *code, 2026-10-05*.
- Each step has its own part of that queue (since 2026-10-05, [`2026-10-05-page-tasks.md`](../plans/2026-10-05-page-tasks.md)):
  a chapter is queued once per step (`inRun(…, kind)`), each step counts its own batch
  (`stepRun` — total, finished, its own time; a step queued behind the other is `waiting`),
  and Cancel stops one step's chapters (`cancelRun(projectId, kind)`, one AbortController per
  chapter). (was: one banner, one count and one Cancel for the whole queue, shown on both
  pages.) — *code, 2026-10-05*.
- **A speaker's description in Analyze's cast list doesn't help**: the main pass with each cast
  line carrying `description="…"` (200 characters) against the live prompt, two runs each, the
  eval's cast and answer keys: The Ninth Facet 272/272 without, 271/272 with (D24 to Cael, not
  Nettle, once); The Salt-Iron Road 263/264 both ways (D7 "Quartermaster." to Sable, not Ino,
  once each way — run-to-run noise). The descriptions add 744 characters to The Ninth Facet's
  cast list and 1,228 to The Salt-Iron Road's, on every call.
  — *measured, 2026-10-07* (the scripts: a one-off `--user` template, nothing saved).
- Measured on The Ninth Facet (gemma 26B-A4B on the RTX 2070 SUPER, ~40–46 tokens/s): a Discover
  call ≈ 7 s per chapter (2,200–2,800 prompt tokens, 52–68 generated); an Analyze call ≈ 35–65 s
  per chapter (2,300–3,000 prompt tokens, 1,500–2,300 generated). — *measured, 2026-10-05* ·
  `ai-runtime/logs/router-20261005-010917.log`.

---

## 6 · The app stack: Electron, Node, phones

**Records:** [`2026-10-05-electron-node-study.md`](../plans/2026-10-05-electron-node-study.md)
(the study, with every measurement and source);
[`2026-10-07-electron-node-plan.md`](../plans/2026-10-07-electron-node-plan.md) (the plan, and
the step-0 spikes' measurements, §1); TASKS "The family moves to Electron and a Node
server". The shared-stack half (Electron, Node, SQLite, Capacitor, process trees) is in the
kit's register §2.

**Size, memory, startup** (*measured, 2026-10-05*, Windows 11 · RTX 2070 SUPER — study §1):

- Today's server frozen with PyInstaller onefile is **76.9 MB**, and takes **6.7–8.1 s** to
  print `--help` (it unpacks to temp every launch); an unfrozen `import justvoice.app` takes
  2.6–5.5 s.
- An Electron 44.5.1 NSIS installer holding JustVoice's `dist/` is **111.7 MB** (370 MB
  installed) — about 35 MB more than today's shell + sidecar; the speech runtime (≥1 GB) and
  models dominate either way.
- The same JustVoice UI: the Tauri window (justvoice.exe + 7 WebView2 processes) ~322 MB
  private; an Electron window 256 MB (dev UI) / 204 MB (built UI). Rough — the WebView2 window
  had been in use for hours.

**The release build** (*measured + code*, study §1, §10):

- `release.yml`'s `pyinstaller --onefile server/justvoice/__main__.py` builds an exe that dies
  on start: `__main__.py:25` is a relative import (`from .serve import main`). An
  absolute-import entry with `--collect-submodules justvoice/llm_runner` works.
- The release job installs `./server[dev]` without the `bundle` extra
  (`.github/workflows/release.yml:42`), so the kit is never in the frozen build.

**The shell** (*code*, study §4):

- The shell registers 23 commands (`src-tauri/src/lib.rs:918-942`); the renderer calls 5
  (`src/services/native.js:33-69`). Hotkeys, paste, system-audio capture, the macOS permission
  checks and server start/stop/restart have no caller (recorded at `native.js:18-22`), and
  `list_audio_output_devices` / `play_audio_to_devices` are placeholders (`lib.rs:612-633`).
  No dictation feature runs today.
- `window.__TAURI__` exists only with `withGlobalTauri`, which no config sets. The tray listeners
  and "Open log file" go through the kit's `isTauriShell` / `openPath` since 2026-10-05 and work
  (checked in the app window). No updater exists — no plugin in any `Cargo.toml`, no signed feed;
  Settings → Updates shows the version and release notes only since 2026-10-06. (was: all three
  read `window.__TAURI__` and never ran, and the updater UI always said "latest" — until
  2026-10-05/06.)
- The app window's boot check (`checkServer`, 8 tries, about 7.5 s) can give up before the dev
  sidecar answers; since 2026-10-06 the kit's ConnectionError then asks every 2 s and opens the
  app when the server answers (1.9 s after, measured). (was: only Retry left the screen — until
  2026-10-06.) — *live, 2026-10-06* · `main.js:192`; kit `ConnectionError.vue` ·
  [`2026-10-06-batch-pick-and-findings.md`](../plans/2026-10-06-batch-pick-and-findings.md).
- Of JustVoice's 2,738 lines of Rust, 956 are `audio_capture/`, 312 `synthetic_keys.rs`, 290
  `hotkey_monitor.rs`, 120 `permissions.rs`.

**The audio math** (*measured*, an agent, study §2 — the app's functions against plain-JS ports):

- Every filter, EQ, delay, reverb, compressor, chorus, distortion, the four shipped effect
  chains (except Deep Voice's pitch), resampling, crossfades, the analyzer, Kokoro blends and
  delivery gain match in JavaScript — bit-identical, or float error with **0** differing 16-bit
  samples. ACX mastering is an ffmpeg subprocess (byte-identical from Node).
- **Signalsmith Stretch (pitch, speed) can't be matched in any build** (34–57 dB SNR pitch,
  13.5–58 dB speed): the library moves its own output that much on a 1-ulp input nudge, and it
  seeds from `std::random_device` when the internal ratio exceeds 2 (speed 0.5 at 22.05 or
  44.1 kHz) — so today's output isn't repeatable either.
- **pyloudnorm is declared but never imported** (`server/pyproject.toml:27`); ACX QC uses the
  analyzer's RMS/peak, normalisation is ffmpeg `loudnorm`. `docs/mastering.md:19` is stale.
  Also never imported: `requests`, `rich`.
- **The Kokoro "mean" blend changes in its last bits each restart**: `_kokoro_pack` returns the
  names as `set(pack)` (`engines/blending.py:212`) and `_kokoro_pack_mean` sums in that order,
  which follows per-process string hashing (max 4.5e-8 over three seeds).
- `effects_chain_hash` (`audio/effects.py:181`) and `delivery.canonical_json`
  (`delivery.py:26`) hash Python's `json.dumps`, which writes `1.0` where JavaScript writes
  `1` — a naive port changes every render-cache key.
- `as_16k_mono` (`engines/audiocpp/slot.py:540`) works around a v0.9.0 aligner bug that our
  jv.1 build fixed (§1.3).

**The database** (*measured 2026-10-07*, a read-only snapshot of the dev root's `justvoice.db`
— plan [`2026-10-07-electron-node-plan.md`](../plans/2026-10-07-electron-node-plan.md) §1.3):

- 49 tables (JustVoice 23 + the kit 26), 1,690 rows, 17,374 cells, journal mode `delete`.
- `DATETIME` is text with six fractional digits (`2026-10-06 19:45:42.582131`); `BOOLEAN` is
  `0`/`1`. No integer is beyond 2^53 — the largest, a `BIGINT`, is 14,249,047,104.
- JSON text is Python's `json.dumps` with its defaults: 347 cells with `", "` / `": "`, and 4
  holding non-ASCII text escaped as `\uXXXX`. The render-cache key hashes a compact, key-sorted
  dump (`audio/effects.py:196`).
- Absolute paths stored: 1 `runner_setting.cache_root` and 3 `measurement_switches.flag_value`
  point into JustWrite's dev root (the shared model cache — kit register §2). None point into
  JustVoice's own root.
- **Whole-number floats are stored as `1.0`.** 5 of the 355 JSON cells hold them: 4
  `effect_presets.chain_json` (effect parameters such as `"depth": 1.0`) and `settings.data`
  (`"loudness_target_lufs": -20.0`). A JavaScript writer must know those fields are floats to
  write the same text.
- **Foreign keys** are turned on per connection (`database/session.py:71-73`); restore turns them
  off (`data_admin.py:162`).
- **`LexiconStore` answers in two time formats.** `create` returns zone-aware times
  (`…:01.123456Z`); `get`, `list` and `update` read them back from the database and return them
  without the `Z` (measured with the real store, the plan's §1.5).
- Render-cache keys: an effects chain's key carries `DSP_VERSION`
  (`audio/effects.py:181-197`), a render without effects is keyed `noeffects`, and speed enters
  through the delivery JSON (`render_core.py:641-642`).

**The DSP program — step 1, built 2026-10-07** (*code + measured*; plan
[`2026-10-07-electron-node-plan.md`](../plans/2026-10-07-electron-node-plan.md) §3, the fork's
`dsp/README.md`):

- `audiocpp_dsp` (426 KB, Windows) holds all of the server's sample math: the effects chain, a
  line's pace, gain and pitch, the joins between pieces (and the streamed preview's seams), a
  line's trim and fit into a chapter, the analyzer, Kokoro blends. No models, no GPU, no ggml —
  it reuses the runtime's `app/server/http.cpp` and `multipart.cpp`.
- The server reaches it through `audio/dsp_client.py`: started on first use through the kit's
  `spawn_child` (kill-on-close job), on a free loopback port, logged to
  `<data>/logs/audiocpp-dsp.log`, started again if it died; found at `JUSTVOICE_DSP_EXE`, the dev
  build, beside a packaged server, or `../audio.cpp/build/jv-dev/bin`.
- **Proven against the Python it replaced** (the fork's `dsp/tests/parity/`, JustVoice `7d0cecb`
  as the reference): identical 16-bit output in 859 cases (effects 369, shaped lines 52, joins 72,
  streamed seams 20, fits 224, aligner input 18, analyzer 90, vectors 14), including 8 real renders from the dev
  cache. Signalsmith (155 cases) repeats exactly, keeps every length, is never shifted (best lag
  0 ± 1 sample); against python-stretch its waveform differs (0.2–43 dB SNR) and its long-term
  spectrum stays within 0.003–0.26 dB on speech. The same wrapper on python-stretch's library
  (`ffa45981`) matched python-stretch to 23–93 dB — the difference is the library update.
- **Two Python rules the port had to copy, found by the harness:** a parameter read through
  `float()` accepts a numeric string while one read through `np.clip` or plain arithmetic fails
  its effect (e.g. `eq_mid`'s `q` vs its `gain_db`); and cJSON prints 15 significant digits, so
  numbers go out in their shortest exact form.
- **What the cache re-renders:** a chain with a pitch shift is keyed `dsp1+ss-1.4.0`
  (`effects_chain_hash`), a line the server paces or pitches carries `speed_by: server ss-1.4.0` /
  `pitch_by: ss-1.4.0` (`render_core._key_delivery`); every other cached line stays valid.
- `engines/audiocpp/slot.as_16k_mono` (the aligner's 16 kHz input, which an install still on
  upstream v0.9.0 needs) is the program's `aligner-input`, ported exactly (18 of 18 identical);
  the server has no numpy or scipy left — numpy stays only in the `dev` extra for tests that
  build signals with it. (was: still numpy + scipy — until later on 2026-10-07.)

**The server** (*code*, an agent, study §3):

- JustVoice's server: 176 files / 36,380 lines, 113 test files / 19,924 lines, 971 test
  functions, 188 routes, 23 tables. Its wire format is **snake_case** (284 of 285 fields in
  `models.py`); nothing generates a client from its OpenAPI.
- JustWrite never calls JustVoice at runtime — the handoff is a book `.zip`
  (`docs/dev/design-decisions.md:101-104`).
- `justvoice-server serve` is argparse (`serve.py:14`); typer is only the dev `cli.py`.
- The OpenAPI licence says MIT (`server/justvoice/app.py:139`), as the project is. (was: Apache-2.0
  — until 2026-10-05.)

**The port to JavaScript — wave A, the foundation** (*measured 2026-10-08*, an agent's checks;
`server/src/` and `server/scripts/compare-*.js`):

- The JS models, seed and stores match Python: 106 models field by field (order, int vs float,
  constraints, defaults); a fresh seed 49 tables / 2,521 cells, 0 different; 31 store writes
  replayed on both, 204 cells, 0 different; every persona and the settings row of a COPY of the
  real dev database read back and rewritten unchanged, 19,115 cells, 0 different; 1,320
  generated cases of the pure functions (difflib, alignment, captions, inline tags,
  `canonicalJson`, the delivery merge, the cache key) identical.
- **Voice manifests are CRLF on Windows** — Python wrote them in text mode; the JS
  `atomicWriteJson` writes the platform's line ending too.
- **Free-form stored JSON keeps Python's floats** (`1.0` in an effects chain): the JS reads such
  text with `pyJsonParse` (a float stays a `PyFloat`, written back as `1.0`) and gives typed
  fields their floats back from the schema (`floatify`). This is what keeps the render-cache keys
  — hashes of Python's json.dumps — identical.
- `difflib.SequenceMatcher` is ported exactly (`server/src/difflib.js`); on a JS string it counts
  UTF-16 units, so callers pass arrays.
- Python's factory reset leaves foreign keys OFF on its pooled connection after dropping tables
  in place; the JS restores the previous setting.
- **Where the speech runtime lives** (decided 2026-10-08, rec applied under the go): always
  `<data_dir>/engines-runtime` in the JS server — Python used the source tree when unfrozen and
  that folder when frozen. The downloaded runtime on this machine moves there with the data-root
  move.

**The port to JavaScript — wave B, the speech engines and audio** (*measured 2026-10-08*, an
agent's checks, re-run by me; `server/src/engines/`, `server/src/audio/`, `speech_cache.js`,
`installer.js`):

- 308 of the 309 Python tests are ported (262 pass; 46 wait for a later wave's module and name
  it). The one not ported checks FastAPI's threadpool, which has no JS counterpart.
- The engine manager answers as Python does on copies of the dev data: 5,063 values across 13
  sections (manifests, status, variants, sources, placements beside a booked 6.8 GB AI model,
  prices, runtime readers), 0 different; 5,064 with a stand-in dev build. `dsp_client` against
  `../audio.cpp/build/jv-dev/bin/audiocpp_dsp.exe`: 31 operations, 2,096,984 bytes, 0 different.
  (`server/scripts/compare-engines.js`, `compare-dsp.js`.)
- **Real synthesis is byte-identical:** kokoro-82m-q8 (193,244 bytes) and kitten-mini-0.8
  (328,444 bytes) from the JS and the Python through the same runtime, with the same peak rows
  and runtime config files; Qwen3-ASR 1.7B q8 gives the same transcript and all 12 word times.
  Graphics memory 533 MiB before and after each run, no process left. (`compare-synth.js`,
  `compare-asr.js`.)
- The JS installs of eSpeak NG (365 files) and UniDic (21 files) are file-for-file Python's — the
  wheels are downloaded and unpacked in JS, no Python at runtime. (`compare-installs.js`.)
- **The boot must `await runtime.ensureHardware()` once:** hardware detection is async in JS, and
  the sync readers (`installedExe`, `selectedAsset`, `hasFeature`, the placement readers) throw
  "hardware not detected yet" before it. `manager.load()` and `placementFor()` await it themselves.
- **Leftover runtimes are found by reading their environment** (`JUSTVOICE_SERVER_PID`): on
  Windows from the process's PEB through koffi (offsets 0x20 → 0x80 → 0x3F0, checked working), on
  Linux from `/proc`; macOS can't read it and falls back to the parent-pid check. Physical cores
  come from CIM `Win32_Processor.NumberOfCores`.
- Where the JS differs on purpose: a request timeout is a total limit (fetch abort), not httpx's
  per-read limit; "stopped answering (<kind>)" names the Node error code where Python named the
  httpx class; `wavRateChannels` accepts a non-PCM WAV where Python's `wave` raised.
- `manager._ensureVariantLocal` returns null until `api/engine_sources_api.js` exists — that
  module must export a sync `resolveSource(engineId, variantId)` → `[source, provenance]`.
- Two kit bugs it found are fixed in the kit (its register has them): a `.tar.gz` extraction left
  the archive open, and an app's `FormData` reached the kit's HTTP client as "[object FormData]".

**The port to JavaScript — wave C, the render layer** (*measured 2026-10-08*, an agent's checks,
the suite re-run by me; `render_core`, `render_jobs`, `line_takes`, `synth_scheduler`,
`persona_render`, `voice_model`, `refinement`, `voice_bundle`, `export_audiobook`,
`export_voicelines`, `mastering`):

- **Render-cache keys are Python's:** on a copy of the dev data, augmented through Python's own
  stores with what it lacked (stored voices of every source, 13 personas with float deliveries,
  per-model knobs, emotions, effects, lexicons; a second book with per-line numbers, direction,
  tags, a marker, a dialogue tag, a long line), all 340 keys and 343 take-path keys match, and
  every one of the 289 real-book keys names a file Python wrote in the real render cache. With
  the read answers (`voice_model`, `persona_render`, `sceneLines`, render states, takes,
  `jobStatus`), 36,527 values, 0 different, key order included. (`server/scripts/compare-render.js`.)
- **A delivery's floats must stay `PyFloat`s** (`persona_render.modelSettings`, `line_takes`,
  `render_chapter_api._deliveryOf` through `floatify(Delivery)`), or the keys change; code that
  reads one unwraps it with `num()`/`Number()`. (*code*, confirmed by the check.)
- **A real Kokoro render job is byte-identical** — three real lines (one of 372 characters, through
  the split-and-join path): the generation, take and job-block rows (ids aside), the take WAVs,
  the 7 render-cache files and the voice-line zip's entries. With ffmpeg 8.1.1: an ACX chapter
  WAV, the M4B and one take mastered with all 4 presets (MP3 with tags and WAV) are
  byte-identical, and the ffmpeg command lines match (temp paths aside). Graphics memory 533 MiB
  before and after. (`compare-render-real.js`.)
- A line with no seed is sent a random seed (`slot.to_speech_request`), so a repeatable Kokoro
  take needs a persona seed. (*code*.)
- Voice resolution is async in JS (a registry engine's `voices()` may need the network), so the
  key, plan and scene readers are async (`lineInputsKey`, `planLine`, `planBlock`, `sceneLines`,
  `projectRenderState`, …). The scheduler's worker is an async loop; `waitAsync({signal})`
  stands in for asyncio's cancellation — a rendering route passes its request's AbortSignal.
- The JS DSP program keeps `<data>/logs/audiocpp-dsp.log` open until `dspClient.stop()`; the
  server's shutdown must call it.
- The boot runs `render_jobs.sweepStaleJobs()` and `line_takes.sweepOrphanTakesNow()` after the
  database, the state and `await runtime.ensureHardware()` — before it, `_supportsPhonemeInput`
  reads "no IPA".
- Five Python Generate tests fail today (`test_project_lexicon` ×2, `test_speed_everywhere` ×3):
  their fake scheduler's `submit` lacks the `owner=` argument added on 2026-10-07. (*measured*,
  pytest.)

**The port to JavaScript — wave D, Analyze, imports, labs and MCP** (*measured 2026-10-08*, an
agent's checks, the suite and the extraction check re-run by me; `extraction/`, `imports/`,
`labs/`, `mcp/`, plus the helper halves of `projects_api`, `voices_api`, `captures_api`):

- **Imports are Python's:** 101 inputs (the samples, a fresh JustWrite book export with its zip,
  EPUB and DOCX, the test fixtures, about 70 hard cases) through every adapter, split mode and
  renamed extension — 1,717 jobs. 814 imported and 868 refused identically (status and words),
  the 35 Python 500s fail in JS too, 1,313 dry-run previews match, 269 HTML texts (2,694 blocks)
  match, and the rows written into two database copies match: 43,931 cells, 0 different.
  (`server/scripts/compare-imports.js`.)
- `imports/adapters/html_parser.js` is CPython 3.12.9's `html.parser` and `html.unescape`, line for
  line (`close()` flushes a pending block before the remaining text, as Python does);
  `etree.js` is the ElementTree subset the importers use, to expat's rules and error words
  (76 cases, 0 different). `py_compat.js` held Python's `json.loads`, UTF-8 decode errors,
  `splitlines`, `float()`, `title` and friends (`compare-pycompat.js`: 6,863 cases, 0 different);
  since 2026-10-08 they are the kit's `platform/py.js` / `pyjson.js` and `py_compat.js` is gone
  (the kit's register, "One copy of the Python helpers"). `compare-pycompat.js` still imports
  `../src/py_compat.js` — not edited by that sweep; it runs again only once its import names the
  kit's two modules.
- **Analyze and Discover send Python's requests and write Python's results:** against a fake
  llama-server (no model loaded), 4 real chapters × Analyze with the second look, Analyze of an
  edited chapter, Analyze streamed on the guided route, and Discover — 243 requests byte for
  byte identical, 867 rows, the run reports, deltas, progress, thinking frames and candidates
  identical, 49 tables / 18,742 cells identical. Chapters were read in 2–3 pieces and the
  second look's not-in-cast offer was exercised. (`compare-extraction.js`.) Until the kit's
  fix the same day, 104 of those requests differed: the kit sent a preset's `temperature` 0.0
  as `0` (the kit register, "JustVoice's server port").
- **MCP answers as Python's did:** Python on a bare FastAPI and JS on a bare Fastify, each on a
  free port with its own database copy — 47 exchanges, 0 different: initialize with 4 protocol
  versions, `tools/list`, `list_voices` (91 voices and every refusal), `list_personas`, 11
  `transcribe` refusals, bad arguments, unknown tool and method, ping, the empty prompt and
  resource lists, the transport's refusals and the stamped `mcp_bindings` row. `speak` was not
  called. (`compare-mcp.js`.)
- **The MCP SDK's lines** (*web*, its GitHub releases, 2026-10-09): `@modelcontextprotocol/sdk`
  1.32.1 (2026-10-05) is the newest of the 1.x line JustVoice runs, pinned exact. 1.31 binds stored
  OAuth credentials to their issuer (client side); 1.32 makes the HTTP client transports follow
  only same-origin redirects and adds two options that stay off unless set (`maxToolInputElements`
  on `McpServer`, `expectedResource` on `requireBearerAuth`) — nothing JustVoice's server calls
  changed (`npm run test:server` 1061/1061 on it). The 2.x line is new packages
  (`@modelcontextprotocol/server`, `/client`, `/core`, per-framework adapters, a codemod), and the
  1.x README now points at it: moving there is a migration, not an update.
- fastmcp's wire (*probed on the live Python app*): capabilities include prompts, resources and
  `extensions`; protocol versions 2024-11-05 to 2025-11-25 are accepted and any other gets
  2025-11-25; `serverInfo.version` is fastmcp's own, "3.4.5"; tool errors read "Error calling
  tool '…': …" and "Unknown tool: '…'", argument errors are pydantic 2.13's text.
- What JS doesn't match, none of it reached by a real input: SSE frames end in LF where Python
  writes CRLF and the JSON-RPC envelope's key order differs (JSON-equal); inside an MCP session
  the SDK's own refusal words; a whole-number float argument reported as `input_type=int`;
  pydantic's truncation of long inputs; Python's IGNORECASE letting `İ`/`ı` match `i`; integer-
  looking keys iterating first in a JS object (a CSV delivery dict's key order); XML DTD
  attribute defaults, parameter entities and encodings beyond UTF-8/16, Latin-1, ASCII, cp125x.
- The port found 35 import runs that were Python 500s: a non-EPUB zip named `.epub`, a
  corrupt zip (its directory, a member's CRC, its deflate data), a CSV with a lone CR, a
  JustWrite file whose `project`/`scenes`/`characters`/`chapters`/`aliases`/`body` had a type
  that crashed. Fixed in both languages 2026-10-08 (the user's go): each is a 400 that names
  the problem; the CSV is read with `newline=""` as the csv module asks, so a lone CR ends a
  row. A wrong type a `for` loop walks without raising (a dict's keys, a str's characters)
  is still walked and skipped as before — only the crashes changed. `compare-imports`: 815
  imported, 902 refused, 0 crashed, JS identical; `compare-pycompat`'s CSV cases read with
  `newline=""` on both sides, 0 different. (`tests/test_import_refusals.py` and its twin.)
- The labs CLI never installs the LLM, so every passage reports ✗ — the tracked
  `latest-auto.md` shows that and still says "Tier".
- Two Python second-look route tests fail today: Analyze's own second look has been off by
  default since 2026-10-06 and the tests never turn it on. (*measured*, pytest.)
- `test_extraction_stream.py::test_stream_emits_deltas_then_a_done_frame_with_rows_and_usage`
  fails too: its fake stream delta (a SimpleNamespace) has no `reasoning`, which the kit's
  stream reader now reads, so the call fails and no delta is sent. The whole Python suite on
  2026-10-08: 1,115 passed, 8 failed — these three, the five Generate tests of wave C.
  (*measured*, pytest, full run.)
- The MCP mount (`mcp.mountInto(app)`) registers `/mcp` and `/mcp/` and an `onResponse` hook
  stamping `last_seen_at` for requests carrying `X-JustVoice-Client-Id`; it needs
  `await runtime.ensureHardware()` first (`list_voices`). Python's `ClientIdMiddleware` wrapped
  every request.

**The port to JavaScript — the API wave, agent 1: the app shell, system and engine routes**
(*measured 2026-10-08*, an agent's checks, the suite re-run by me; `app.js`, `serve.js`,
`cli.js`, 22 routers):

- **The route diff** (the kit's `scripts/route-diff/route-diff.js --app --target justvoice`,
  Python `-m justvoice.serve` on 8790 and `server/src/serve.js` on 8791, each on its own copy
  of the dev data): reads 160 — 103 identical with key order, 17 volatile (logs, disk usage,
  the backup zip, live hardware, VRAM, leftovers, the runner's probes, `/v1/system/info`),
  40 not ported yet, 0 different. Writes 130 on fresh copies (the kit's 37 steps and 93
  JustVoice steps, ending in `POST /v1/shutdown`): 127 identical; 2 were the kit's Literal 422
  wording (fixed in the kit the same day); 1 is `GET /v1/personas/{id}/channels`, which has
  no ORDER BY, so rows come in each side's random-UUID order. Databases: 49 tables, 17,042
  cells, 0 different. Nothing loaded a model, installed, synthesized or downloaded; VRAM
  559 MiB before and after.
- **The boot order** (`server/scripts/check-boot.js`, the server's debug log): initDb →
  setState → `await runtime.ensureHardware()` → `sweepStaleJobs` → `sweepOrphanTakesNow` →
  engine discovery and external engines → createServer → CSRF / CORS / auth → routers in
  app.py's order → installLlm → MCP `mountInto` → onClose (MCP close, `shutdownManager`,
  `dspClient.stop`) → static mounts. `/mcp` initialize and `tools/list` on the whole app are
  JSON-identical to Python's whole app. `POST /v1/shutdown` stops the DSP program, exits 0
  and frees the port. Up to the first good health answer: Python 2.3 s, Node 3.3 s.
- The kit's auth and CSRF hooks guard the path prefixes an app names (`prefixes`, `["/v1"]` by
  default); JustVoice names `/v1` and `/mcp` (`app.js` `GUARDED_PREFIXES`), so an MCP client needs
  the token like any API client and a foreign page's POST to `/mcp` is refused 403. (*code + test,
  2026-10-08*, the kit's `auth.js` / `csrf.js` and `tests/guarded_prefixes.test.js`,
  `server/tests/mcp_rulings.test.js`.) (was: they gated only `/v1*`, so `/mcp` passed them as under
  Python's middlewares — until 2026-10-08, the user's ruling.)
- FastAPI's `Form()` treats an empty string as not sent: a required field answers 422
  "missing". pydantic's `HttpUrl` `str()` equals WHATWG `URL.href` for scheme and host case,
  the default port, an empty path and an IDN host. (*code*, and identical route-diff answers.)
- **Float bodies:** `JSON.parse` turns `1.0` and `1e3` into `1` and `1000`; a route that stores
  a free-form body opts in (`config: {pyFloats: true}`, or `PY_FLOAT_ROUTES` for a kit-built
  router such as `PATCH /v1/prefs`) and gets PyFloats, so prefs store `1.0` / `1000.0` as
  Python did. Built in `app.js` first; since 2026-10-08 it is the kit's
  `createServer({pyFloats: {routes}})` (`platform/server.js` `installPyFloatBodies`), JustVoice
  passing `PY_FLOAT_ROUTES`. An app that doesn't pass it (JustWrite, docgen) parses as before.
- Not matched: there is no `/openapi.json`, `/docs` or `/redoc` (`cli.js open-api` exits 1 and
  says so); network and SQL-constraint error texts are undici's and better-sqlite3's; HttpUrl
  reasons beyond "relative URL without a base" and "empty host" are approximate; a
  `--log-level` above INFO is lowered to INFO by the kit's `installFileLog`.
- Python bugs the port copies on purpose (FINDING in TASKS): the generation status stream
  re-queries through one SQLAlchemy session, whose identity map returns the first row
  unrefreshed, so it never reports a status change (only a deletion); clearing an engine's
  last source override deletes its whole `engine_overrides` entry — placements, runtime
  options, accepted terms, the default model; `PUT /v1/speech-runtime` always writes
  `backend`, so a request without one resets a saved backend to "auto" and stops both
  processes; `POST /v1/captures` leaves the uploaded WAV behind when transcription fails;
  `utils.progress` was never written, so active tasks' downloads are always `[]` and
  `/v1/models/progress/*` sends one error frame; `webhooks.dispatch_event` has no callers.
  (*measured* with probe scripts and *code*, by the agent.)

**The port to JavaScript — the API wave, agent 2: voices, personas, previews, Generate and
render routes** (*measured 2026-10-08*, an agent's checks, the suite re-run by me; generate,
voice_preview, render_chapter/lines/jobs, takes, voices, personas, voice_bundle, master,
effect_presets, lexicons, pronunciation):

- **The route diff:** reads 180 — 143 identical, 21 volatile, 16 not ported yet (agent 3's),
  0 different; among the identical, cache-stats over all 289 real lines against the real
  render cache, render state, every chapter's render_lines, takes and lineage, a generation's
  audio bytes, personas with usage. Writes 296 (the kit's 37, agent 1's 93, agent 2's 166 —
  voices clone/design/copy/patch/delete, personas create/patch/merge/delete, lexicons, the
  pronunciation scan over 289 lines, effect presets, takes bookkeeping, render jobs, refusals),
  all identical; 49 tables / 17,040 cells, 0 different; the 5 stored voices' manifests and
  clips identical. A voice bundle's zip carries its write time, so `bundle.zip` is volatile.
- **A real render through both servers' routes is byte-identical** (`server/scripts/
  compare-api-render.js`, Kokoro, one server at a time on copies, warm-on-boot off):
  `POST /v1/blocks/{id}/render` ×3 (one line split and joined), `/v1/generate` ×2 (a preset
  voice with a seed; a persona at speed 1.1), `/v1/render_chapter` in scene mode with the ACX
  master — every answer, the rows, the 3 take WAVs, both Generate WAVs, the chapter WAV and
  its X-Master headers, the 5 render-cache files. VRAM 481 → 1,040 → 481/499 MiB; no runtime
  left.
- A rendering route cancels on disconnect through `generate_api.clientGone(req, reply)` (the
  response closing before it finished aborts the signal passed to `waitAsync` / `warmLines`).
  FastAPI's optional body (`X | None = None`) is `nullable(Model)` as the Fastify body schema.
  pydantic's `model_fields_set` for a nested model rides a Symbol-keyed set
  (`voice_preview_api.markSent`). cachetools 7.1.7's TTLCache is ported in
  `voice_preview_api.TTLCache` (a TTL runs from the last set; `get` promotes; `in` does not).
- Not matched: a stream audition failing on its first piece — Starlette had already sent a
  200, Fastify sends the real error; a pydantic ValidationError raised inside a handler — the
  kit's `ModelValidationError` text gives one line and counts a nullable union's null branch
  ("2 validation errors" where pydantic says 1; kit TODO); whole-number floats in JSON answers
  print `2` where Python printed `2.0` (JSON-equal).
- Python bugs copied on purpose (FINDING in TASKS, fixed in JS after the final comparison): a
  clone on an engine that can't clone (Kokoro) stores a voice with the engine id as its model
  (201); `ref_wav_b64: "%%%"` stores an empty clip (non-strict base64, 201); a blended
  stream-ticket with no ids or weights is a 500; a voice name past latin-1 makes `bundle.zip`
  a 500 (the Content-Disposition — the kit's `attachment()` fixes it); an invalid row-preview
  delivery is a 500, not a 422; a ticket's stream caches its WAV under a None key nothing
  reads; `RecentTakeRow.take` / `.effects` are always null. Two Python test files depend on
  order (`test_pause_between_lines` ×2, `test_takes` TestGenerationAudio ×2 fail alone).
- The test suites left a temp folder per test in %TEMP% (45,568 entries there on 2026-10-08,
  from every family suite). Since 2026-10-08 each server suite's vitest config runs the kit's
  `platform/vitest_tmp.js`: one folder per run, TMP/TEMP/TMPDIR pointed at it, removed at the
  end — measured: a full JV, JW, docgen and kit run leave 0 entries.

**The port to JavaScript — the API wave, agent 3: projects, Analyze and the rest; the final
comparison** (*measured 2026-10-08*, an agent's checks, the suite re-run by me; projects,
extraction, speakers, smart_assign, project_export, export_jobs, bulk_delete, _speaker_helpers):

- **The final whole-server route diff** (every router ported; the kit's
  `scripts/route-diff/route-diff.js --app --target justvoice`): reads 188 — 166 identical, 22
  volatile, 0 not ported, 0 different. Writes 508 — 506 identical; the 2 others are the
  persona-channels UUID order (no ORDER BY) and a merge's 422 text ("List should have at least
  2 items after validation" — pydantic 2.13 adds ", not 1"; kit fix the same day). Databases:
  49 tables, 17,114 cells, 0 different. The writes covered projects, chapters, a line's PATCH
  (numbers, text, metadata, source, speaker with its saved fix and Undo), split, merge, the
  chapter-text edit, speakers (add, rename, cast, narrator, uncast, remove), corrections,
  Discover's ignore/promote, Analyze on a chapter with no speech, imports (CSV dry run, real,
  re-import; every refusal; a JustWrite raw body), an empty book's M4B and export jobs, the QC
  refusal, and bulk delete (dry runs and one real delete).
- **Analyze and Discover through the routes are identical** (`server/scripts/
  compare-analyze-routes.js`, both whole servers on copies, every model call answered by the
  fake llama-server, `server/scripts/fake-llama.js`): 179 LLM requests byte-identical (96 chat,
  83 streamed), 36 answers identical including 10 SSE streams of 1,056 frames, 49 tables /
  20,827 cells identical — all 4 real chapters in place, streamed, with the second look, and
  Discover; the Lab's analyze-text; smart-assign, show-notes, rewrite; a fresh JustWrite book
  re-cut. A cancel during the main pass writes nothing, during the second look the main pass is
  written — on both servers.
- **The smoke gate passes on the JS server** (a copy, warm-on-boot off, port 8741): 11 views,
  zero JS errors.
- Node's `writeHead` holds an SSE response's headers until the first write, where uvicorn sends
  them at once; `sse_streams_api.sseResponse` now flushes them (a cancel during Analyze's main
  pass couldn't land before). SQLAlchemy's flush order decides rowids (within one flush a
  table's INSERTs run before its DELETEs; a resegment deletes before it inserts) — emulated in
  `_updateProjectFromStandard`, the chapter-text edit and `_persistAttribution`; an attribute set
  to its current value issues no UPDATE and no `onupdate` stamp (`_dirtyUpdate`). The import
  route reads a form or a raw body through a child Fastify context with its own parsers.
  pydantic's datetime from a query string accepts a date alone, HH:MM and Unix seconds or
  milliseconds (above 2e10); the refusal texts are in `bulk_delete_api.js`. The old server ran
  pydantic 2.13.4, FastAPI 0.141.1, Starlette 1.3.1, SQLAlchemy 2.0.51.
- Not matched: the chapter-WAVs zip's members are DEFLATED where Python wrote STORED (same
  bytes inside); SQL constraint 500s carry better-sqlite3's text; rare malformed `older_than`
  inputs get approximate words; free-form dicts in Analyze/Discover requests aren't read as
  PyFloats; a long Analyze re-reads lines at write time where Python's session served stale
  ones (only under concurrent edits).
- Python bugs copied on purpose (FINDING in TASKS): a project export with a played persona that
  has a saved delivery is a 500 ("'str' object has no attribute 'model_dump'"); `DELETE
  /v1/generations?scope=<anything>&confirm=true` deletes every generation (scope counts as a
  filter but filters nothing); `PATCH /v1/projects/{id}` always answers `scene_count: 0`; an
  unknown `speaker_id` on a line is a 500, not a 404; a speaker renamed to blanks stores an
  empty name; smart-assign reads booleans as "True"/"False" ids (filtered out, harmless).

**The desktop switch and the data move** (*measured 2026-10-08*, by me):

- **The dev data root moved** (the plan's ruling 6, with no app or server running — ports 17494,
  8741, 1430, 1431, 8790, 8791 free; no justvoice, audio.cpp or llama process):
  `src-tauri/target/debug/data` → `<repo>/data` (a rename on the same drive). The empty headless
  root that sat at `<repo>/data` (a 483 KB database with 0 projects, scenes, blocks, takes,
  personas and lexicons, and logs from 2026-08-22 to 09-30 — bare `serve` runs) was renamed aside
  to `data-old-2026-08-22/`, as JustWrite's was in step 4. The speech runtime's four folders
  (`v0.9.0` 169 MB, `v0.9.0-jv.4` 2.0 GB, `espeak-ng-0.2.4` 19 MB, `unidic-lite-1.0.8` 249 MB)
  moved from `server/justvoice/engines/audiocpp/` to `data/engines-runtime/audiocpp/`, where
  the JS server reads them; their 129 upstream Python reference scripts were deleted (new
  installs leave them out — the kit's `acquireRuntime({dropFiles})`). Nothing named the old
  places: 0 database cells, 0 config files (`engines-runtime-config/*.json` hold no paths). The
  family registry's JustVoice line (`%LOCALAPPDATA%\just-ai\caches.json`) was pointed at the new
  root (backup beside it). The registry also holds 8 lines naming temporary folders — test and
  comparison runs registering themselves. Harmless: each names JustWrite's live cache, and the
  kit's `cache_registry.read()` drops a row only when its cache folder is gone, so they repeat
  a real offer rather than invent one.
- **The Electron shell, checked on JustVoice's own window** (a temporary data folder; Playwright's
  Electron driver): the page loads from `app://justvoice` (Projects), `window.appShell` answers
  and refuses an unknown command, the page has no Node, the clipboard and the microphone are
  allowed and notifications and location denied, the server answers, a second launch exits in
  147 ms while the first keeps serving, and quitting closes the port. The same check passed on
  JustWrite's and docgen's real apps (microphone denied there), and a packaged JustWrite with its
  fuses started, served, and ran the headless form.
- **The real app, on the real data** (2026-10-08, Playwright's Electron driver on the
  desktop app — the JS server, `<repo>/data`, the dev audio.cpp build `44518561`; scratchpad
  `real_render.js`, `real_synth.js`): the runtime row reads `dev · 44518561`, CUDA; Studio →
  The Ninth Facet → 4 · Render → **▶ Render** on The Keystone (50 lines, every line already
  with its take) joined and mastered the 8.4-minute chapter and the row's player was playing
  8 s later, no page errors. A row audition (`POST /v1/voices/af_alloy/preview?auto_load=true`,
  nothing saved) loaded Kokoro and synthesized a 5.5 s 24 kHz line in 15 s; VRAM 564 →
  7,217 MiB (Kokoro + the warm-on-boot chat model) → 479 MiB after quitting, no runtime,
  DSP or llama process left, the port closed.
- **The clean-room rewrite, checked** (2026-10-08 — TASKS, the Electron item's clean-room
  entries; JV `64edd25`; the plan: [`docs/plans/2026-10-08-clean-room-rewrite.md`](../plans/2026-10-08-clean-room-rewrite.md)):
  - Refinement, old vs new, through production's own `refineTranscript` on the real data
    folder's model (gemma-4-26b-a4b-qat) and settings, 22 dictations (14 made up + the old and
    new refine Lab samples): with all three toggles on, both 19/22 (the 3 misses are the
    checker's case strictness, identical for both); the new wording also drops a leading
    "So"/"Okay, so". With every toggle off the new one keeps self-corrections ("Mark — no,
    wait, … Sarah") as ruled, the old one removed them; both still drop "um"/"uh" — gemma does
    that on its own. — *measured, 2026-10-08* · scratchpad harness `refine-compare/`:
    `createApp(<data>)` + the provider registry from the database (`loadFromConfigs`, what
    `seedWorkspace` step 7 does) + each module's `refineTranscript`, which returns
    `[text, model]`.
  - The UI is served at `/`: `/ui/` answers 307 to `/` and drops the query, so the dictation
    window is `/?view=dictate`. At rest it renders nothing (`DictateWindow.vue`: the pill
    shows only while `state !== "rest"`), and nothing in the app starts a cycle today, so its
    states are proven by unit tests only. — *measured + code, 2026-10-08*.
  - MCP through the SDK's own client (`Client` + `StreamableHTTPClientTransport`) on the
    headless server: speak with neither voice nor persona and no `mcp.default_voice` refuses
    "No voice resolved for this call…"; speak through a persona whose engine isn't loaded refuses
    "…which is not currently loaded…" (the headless server starts with no speech engine loaded —
    `POST /v1/engines/kokoro/load` first); loaded, it returns a 24 kHz WAV whose
    `duration_sec` matches its header, and transcribing that WAV gives the text back. —
    *measured, 2026-10-08* · scratchpad `mcp-proof.js`.
  - Building the fork by hand: `cmake` isn't on Git Bash's PATH — `scripts/audiocpp-dev.js`
    runs it inside Visual Studio's `vcvarsall.bat` (toolset 14.44), and its build names only
    `audiocpp_server` and `audiocpp_dsp`, so the dsp test program needs
    `cmake --build ../audio.cpp/build/jv-dev --target audiocpp_dsp_test` in that environment. —
    *measured, 2026-10-08*.

---

## 7 · Where an AI task shows

- Only Discover adds speakers (since 2026-10-06), and Discover's Speakers found is the scans'
  results only. A name the second look hears on a line with no speaker, who isn't in the book
  (`metadata.not_in_cast`), stays on the line; Script's banner names it and opens Discover with the
  chapter ticked for Scan (`StudioView.openDiscover` → `StudioDiscover` `focusScene`). — *code,
  2026-10-06*. (was: the chapter list derived `second_look_found` and Discover listed it beside the
  scans — built and removed the same day, "you are messing the whole flow up".)
- A speaker's origin is `Speaker.imported_from` (the import's source, "justwrite"); Discover's
  ＋ Add, the narrator and Script's old add set none. `GET /v1/projects/{id}/speakers` carries it
  since 2026-10-06; Discover groups the book's speakers by it (From the book / Added here) and
  Cast's cards show it. — *code, 2026-10-06* · `speakers_api._out`, `projects_api.py:866,890`.

- Analyze's own second look is off by default since 2026-10-06 (`ExtractionSettings.second_look`
  False): Analyze does its main pass only; Script's 🔎 Second look asks about the blank spoken
  lines. A line the second look asked about and could not name carries
  `metadata.second_look_asked`, which Script's Check column reads. A factory reset re-seeds the
  setting from the running server's default. — *code + live, 2026-10-06* (Bigger Inside: 6 asked,
  1 named, 5 marked).

- Script's 🔎 Second look (`POST /v1/scenes/{id}/second-look/stream`) asks about the chapter's
  spoken lines with no speaker and not set by you (`_second_look_asks`; the client's
  `secondLookCandidate` is the same rule), through `second_look.look_at` — Analyze's own
  question and context — and saves each answer to its line alone (`_save_second_look`). It runs
  as an "analyze" item with `mode: "second_look"` in `services/chapterRun.js`, so Script's strip,
  its running checks and its reload are Analyze's. Measured on The Keystone with one line made
  blank: 1 of 1 asked in 9.3 s, named right, the chapter's other 49 lines untouched. — *measured,
  2026-10-06*.

- The second look runs at temperature 0 (`p_classify`, since 2026-10-06). At 0.2 (`p_extract`)
  Bigger Inside's candle line came back Odeline Marran 6 of 8 and unknown 2 of 8, streamed or
  not; at 0, 4 of 4. On the 30 answer-keyed lines: 30 right at 0, 29 right + 1 blank at 0.2, no
  wrong name either way. — *measured, 2026-10-06, gemma 26B-A4B* ·
  [`2026-10-05-second-look-test.md`](../plans/2026-10-05-second-look-test.md) (2026-10-06 section).

- Analyze's second look (one model call per line left blank) streams its tokens on the same
  Analyze strip and reports `{step: {name: "second_look", done, total}}` as it starts and after
  each line; the strip shows *second look · 2 of 6 lines* with the hint as its tooltip, and the
  run's usage includes its calls. Before 2026-10-06 its calls didn't stream, so the strip said
  *stuck* for the minute it ran (six lines × ~11 s on Bigger Inside). — *measured, 2026-10-06,
  gemma 26B-A4B* · `extraction/second_look.py`, `services/chapterRun.js`.
- A cancel during the second look saves the chapter as the second look last left it whole (a
  copy kept at each step) and stops it before its next line; a cancel during the main pass
  writes nothing. Measured: closed at line 2 of 6 → saved at once, the call in flight finished,
  no further calls; closed in the main pass → `analyzed_at` unchanged. — *measured, 2026-10-06*
  · `api/extraction_api.py` analyze stream (`kept`, `_save_on_cancel`).

**Records:** [`2026-10-05-page-tasks.md`](../plans/2026-10-05-page-tasks.md) — the rule
(decided 2026-10-05, "a page shows only its own tasks"), the table of each task's page, the
blast radius.

- Each task's strip is on the page that started it (`PageTaskStrips.vue` over
  `services/pageTasks.js`, by feature and by the meta the page stamps). (was: `App.vue` showed
  every non-inline task at the top of every page.) — *code, 2026-10-05*.
- The kit's task panel (the ✨ button) lists every task whatever `inline` says; `inline` only
  told a global stack to skip a task (`just-llm-runner/ui/src/stores/aiTasks.js`, start()).
  — *code, 2026-10-05*.
- JustWrite has no app-wide strip — 22 surfaces each mount `AiTaskStrip` for their own task;
  docgen has one surface, no stack. — *code, 2026-10-05* · `grep -rln AiTaskStrip src`.
- Engine installs, downloads and loads never used the AI task store (`useDownloadTask.js`
  imports none); they report on their own rows. — *code, 2026-10-05*.
- Cast's ＋ New persona batch reuses Smart-assign's prompt, which says "If no voice fits, omit
  that character" (`seed_feature_prompts.py:46`); the model drops speakers it has little to go on,
  at random. Replayed against the app on The Ninth Facet (no speaker has pronouns), full cast, 5
  runs: the Narrator skipped in 2, Old Sedge in 5; three speakers alone, 4 runs: Old Sedge in 1.
  — *measured, 2026-10-05, gemma 26B-A4B* · TASKS "The demo cast for Render…". Since 2026-10-06
  a skipped speaker's row in the batch's list has a Voice list of the same voices
  (`CastNewPersonas.vue`).
- Smart-assign sends each speaker's pronouns and each persona's gender as its VOICE's gender
  (`voiceGender.js`: your override on Voices, else the catalog's, else a guess from the id or
  first name; "?" is sent as no gender). A persona has no gender field of its own. — *code,
  2026-10-05* · `StudioCast.vue` (the smart-assign request). The server formats it as
  `gender="…"` per voice (`smart_assign_api._format_voices`); the seeded prompt judges "age,
  gender and tone" against "Available voices" (`seed_feature_prompts.py:165`).
- `POST /v1/llm/smart-assign` is generic — `characters` + `voices` (id, name, gender, age,
  accent, tone, language) → `{character_id: voice_id}` — so it can match speakers to library
  VOICES as well as personas. A persona needs only a `name` to be created (`voice_id`
  optional; with none its lines are *needs a voice*). — *code, 2026-10-05* ·
  [`2026-10-05-cast-render-persona.md`](../plans/2026-10-05-cast-render-persona.md) §2.
- Generate vs the persona page: the persona page has no Compose / Rewrite, no lexicon preview
  and no History; Generate also plays a voice with no persona (Voices' test line does too).
  The full table: [`2026-10-05-cast-render-persona.md`](../plans/2026-10-05-cast-render-persona.md)
  §2. — *code, 2026-10-05*.
- Generate was removed 2026-10-05 (its History and the ★ favorite with it); `/v1/generate`
  stays — RenderLab, MCP and the API call it. `generations.is_favorited` is gone from the model
  and the app's database (dropped and the database reset 2026-10-05). — *code, 2026-10-05* ·
  [`2026-10-05-cast-render-persona.md`](../plans/2026-10-05-cast-render-persona.md) §4. (was: the
  database kept `is_favorited BOOLEAN NOT NULL` with no default, so the ORM column had to stay
  until a reset — true until the reset of 2026-10-05.)
- A voice's model is a FAMILY (`qwen3-cv`, …); its size and precision (1.7B / 0.6B, 8-bit /
  16-bit) stay AI Settings' choice (persona redesign §6.2 call 4). A render picks the variant:
  the loaded one if it is this family, else the engine's default if it is, else an installed one
  of the family (same size and precision first), else the same pick among all of the family's
  variants, and the load fetches it. A loaded version of the family keeps speaking after
  the default changes, until the chosen one is loaded. The persona page shows it since
  2026-10-05: `GET /v1/voices/{id}/model-version` (`voice_model.versions_of` — the render's
  own pick, the loaded one, the default, the family's versions with `on_disk`). — *code,
  2026-10-05* · `voice_model.variant_for_model` (`voice_model.py:372`).
- Every multi-filter list follows one rule — each filter lists only what the others leave,
  counts match, a chosen option nothing fits stays with (0) — through `services/facets.js`
  (since 2026-10-05; the audit of every filter set and what broke:
  [`2026-10-05-filters-narrow-each-other.md`](../plans/2026-10-05-filters-narrow-each-other.md)).
  — *code, 2026-10-05*.
- The persona page is KeepAlive-cached (`App.vue:642`), and opening another persona used to
  reset only its Voice card's Type (`load()` set `kind`), so direction, Model, Gender and
  Voice's language carried over from the last persona; since 2026-10-05 `fitFiltersToVoice()`
  resets them on open and Revert, and a filter change that leaves the voice out empties the
  Voice box. — *code, 2026-10-05* ·
  [`2026-10-05-filters-narrow-each-other.md`](../plans/2026-10-05-filters-narrow-each-other.md) §5.

---

## 8 · Character voices: effects, formants, conversion, creature sounds

**Records:** [`2026-10-07-character-voice-controls.md`](../plans/2026-10-07-character-voice-controls.md)
— the controls the user wants for characters, the C++/Node library survey and the local-AI
survey (asked and recorded 2026-10-07; nothing decided or built). User-facing half:
[`../effects.md`](../effects.md). Where the DSP goes after the move: §6 and the Electron/Node
study's §9.

**Today** (*code, 2026-10-07*):

- The only effects chain is the persona's (`docs/effects.md:38`): twelve primitives in
  `audiocpp_dsp`, the DSP program built from our fork (`dsp/src/effects.cpp`; the editor's "EQ
  (3-band)" is three of them) — new effects for characters belong there. Every effect returns
  its input's length, and a change to an effect's output needs `DSP_VERSION` bumped — it is in the
  render-cache key (`audio/effects.py` `effects_chain_hash`). (was: numpy, scipy and python-stretch
  in `audio/dsp/` — until 2026-10-07.)
- The delay effect takes any delay of one sample or more and feedback up to 0.999
  (`dsp/src/effects.cpp` `delay`), so a few-millisecond comb filter is possible — but the editor's
  Delay runs 0–4 s in 0.05 s steps (`api/effect_presets_api.py:105`): only a preset or the API
  can set one.
- No catalog model (`engines/*/manifest.py`: asr, chatterbox, kitten, kokoro, pocket, qwen3,
  voxcpm2) is a sound-effect or voice-conversion model, and no server code names a `vc` task. The
  only non-speech sounds are Chatterbox Turbo's and Nano's nine non-verbal tags, all human
  (`engines/capability_details.py:328-338`).

**Formants and pitch-track tools** (*web, 2026-10-07*):

- Signalsmith Stretch (MIT; `version` 1.3.2 on main) shifts formants —
  `setFormantFactor(multiplier, compensatePitch=false)`, `setFormantSemitones(semitones,
  compensatePitch=false)`, `setFormantBase(baseFreq=0)` (0 = detect the pitch) — and maps
  frequencies with `setFreqMap(fn)`. `compensatePitch` adjusts for the pitch shift (or the map)
  when correcting or shifting formants. Its README warns the formant correction is less sharp
  than monophonic methods such as PSOLA and wants a rough fundamental. ·
  `github.com/Signalsmith-Audio/signalsmith-stretch` (`signalsmith-stretch.h`, README).
- python-stretch 0.3.1 (2025-02-14) is still the newest release, and it binds none of those
  calls (§3). Whether Signalsmith's WASM or npm `signalsmith-stretch` 1.3.2 exposes them: not
  checked. · `pypi.org/pypi/python-stretch/json`.
- WORLD (modified-BSD; "no patent in all algorithms") estimates F0, aperiodicity and the
  spectral envelope and resynthesizes from them; pyworld (MIT) wraps it. pyworld 0.3.6
  (2026-08-20) ships only five Windows wheels, CPython 3.6–3.8; 0.3.5 (2025-01-21) has win_amd64
  wheels for 3.6–3.13 and a source archive; neither has macOS or Linux wheels. ·
  `github.com/mmorise/World`, `pypi.org/pypi/pyworld/0.3.5/json`, `…/0.3.6/json`.

**C++ and Node libraries** (*web — the GitHub API and the npm registry, 2026-10-07*; ★ = stars,
dates = last commit):

- Permissive, maintained, fit: Signalsmith Stretch 563★ MIT (2026-09-25) · Signalsmith DSP 277★
  MIT, header-only C++11 — filters, delay, envelopes, FFT, spectral/STFT, windows, mix, rates
  (2026-08-23) · Airwindows Consolidated (`baconpaul/airwin2rack`) 722★, MIT for `src`,
  `libs/airwindows` and `res/awdoc`: 530 effect headers behind one static library
  (`airwin-registry`, `AirwinRegistry.h`), among them RingModulator, Vibrato, Tremolo, DeRez
  (bitcrush), Distortion, PitchNasty, VoiceOfTheStarship, Galactic; its DAW and Rack plugin
  targets bring in GPL (2026-10-04; Airwindows itself 1,246★ MIT) · WORLD 1,348★ (2025-02-21;
  release v1.0.1 2026-02-18) · SPTK 4 249★ Apache-2.0, a C++11 library and CLI — pitch by
  RAPT, SWIPE' or REAPER, mel-cepstral analysis, MLSA/MGLSA, LPC (2026-10-06; v4.4 2025-12-24)
  · DaisySP 1,248★ MIT — autowah, chorus, decimator, flanger, overdrive, phaser, pitchshifter,
  sample-rate reducer, tremolo, wavefolder; its LGPL parts live in DaisySP-LGPL (2026-09-28) ·
  Q (cycfi) 1,431★ MIT, header-only C++20 — BACF pitch detector, filters, envelope followers,
  dynamics (2026-10-07) · stftPitchShift 195★ MIT — pitch and timbre shifting with cepstral
  formants (2025-09) · r8brain-free-src 744★ MIT · libsamplerate 746★ BSD-2 · CloudSeedCore
  79★ MIT (2024-09).
- Node: `node-web-audio-api` 2.2.0, BSD-3, 74,297 downloads a week, a Rust core with prebuilt
  Windows, macOS and Linux binaries — standard Web Audio nodes, no pitch or formants ·
  `signalsmith-stretch` 1.3.2 MIT, 43,861 a week · `@elemaudio/core` 4.0.1 MIT, 1,687 a week,
  last commit 2024-12-21 · `pitchy` 4.1.0 MIT.
- Out on licence: Rubber Band GPL-2.0 · essentia AGPL-3.0 · aubio GPL-3.0 · KFR GPL-2.0 ·
  `pitchfinder` GPL-3.0 · `@grame/faustwasm` LGPL-3.0. Bungee is MPL-2.0 (file-level copyleft).
  Archived: google/REAPER (2021; SPTK bundles it) and magenta/ddsp-vst (2023).

**Platforms** (*web — the GitHub API, READMEs, CI files and release assets, 2026-10-07*):

- Airwindows Consolidated's CI builds Windows x64, Windows with JUCE 7, Windows arm64ec, macOS
  and Linux x64 (`.github/workflows/build-daw-plugin.yml`); its 2026-10-04 DAW release has a
  macOS `.dmg`, a Linux zip and Windows installers (64-bit, arm64ec, Windows 7), and its VCV Rack
  builds cover lin-x64, mac-arm64, mac-x64 and win-x64. The original airwindows repo's
  `plugins/` holds WinVST, MacVST, MacAU, MacSignedVST, MacSignedAU and LinuxVST.
- Signalsmith Stretch: python-stretch 0.3.1 vendors it as a submodule (`include/stretch`) and
  ships wheels for Windows (32- and 64-bit), macOS (x86_64, arm64) and Linux (manylinux,
  musllinux; i686, x86_64) — of commit `ffa45981` (§6's study §2.1); npm `signalsmith-stretch`
  1.3.2 is its WASM. The 1.3.2 header includes `signalsmith-linear/stft.h`: Signalsmith Linear
  (MIT, header-only C++11, 28★, last push 2026-10-04, "designed for internal use") links Apple's
  Accelerate on a Mac by default (CMake `SIGNALSMITH_USE_ACCELERATE`) and IPP only when asked
  (`SIGNALSMITH_USE_IPP`, off), and works without either. When that dependency arrived: not
  checked.
- Signalsmith DSP is header-only C++11; its README names no platforms and its tests live in a
  separate repo — no per-platform CI found.
- WORLD ships `visualstudio2015`, `visualstudio2019` and `visualstudio2022` projects, a
  `makefile` and a `CMakeLists.txt`; it has no CI workflows; pyworld's win_amd64 wheels compile
  it.
- Q's CI (`build.yml`) builds on windows-latest (MSVC), ubuntu-latest (GCC) and macos-latest
  (Clang); it needs C++20. SPTK's README lists Linux, macOS and Windows; DaisySP's lists desktop,
  iOS and Android; stftPitchShift has CMake, vcpkg and WASM builds (CI `cpp.yml`, `python.yml`,
  platforms not checked); node-web-audio-api is prebuilt for Windows x64/arm64, macOS
  x64/aarch64 and Linux x64/arm/arm64.
- The models below run wherever the pinned audio.cpp build does (§1.4): Windows CUDA, Vulkan
  and CPU; macOS Metal on arm64 and x64; Linux x86-64 only. Which of those backends each model
  supports: not checked.

**Models in our pinned build** (*code* — the fork's docs at `f7d8140a`; licences *record* —
audio.cpp's `docs/model_licenses.md`, checked upstream 2026-09-21…27). Their specs ship in
`engines/audiocpp/v0.9.0-jv.4/cuda12/model_specs/`; the app registers none of them.

- Voice conversion (`vc`: source audio + `voice_ref`): `chatterbox` MIT · `tone_color_vc`
  (OpenVoice V2's converter; mono 22,050 Hz; `seed`, and `temperature` = upstream's `tau`, 0.3)
  MIT · `meanvc2` Apache-2.0 · `miocodec` MIT · `rvc` — base models MIT, packaged voices
  unlicensed; a user `.pth` (`voice_model_path`), `semitone_shift`, `pitch_path` (a `time,Hz`
  CSV that replaces the pitch curve), `retrieval_blend`, `unvoiced_protection`, `rms_mix_rate` ·
  `seed_vc` GPL-3.0 weights · `vevo2` CC-BY-NC-ND-4.0. · `../audio.cpp/docs/audio_tools.md`,
  `docs/tts.md:77-104`, `docs/models/tone_color_vc.md`.
- `dots_tts` Edit (Apache-2.0) edits an existing line: `template_name=edit`, `source_audio`, and
  an instruction tagged `<del>`, `<ins>`, `<sub targ>`, `<emo>`, `<pitch>`, `<rate>`,
  `<enhance>`, `<bg>`, `<pause/>` or `<spk_transfer/>`. · `docs/models/dots_tts.md:39-62`.
- `maya1` (Apache-2.0, SNAC MIT; English, 24 kHz, no cloning) makes a voice from a required
  `instruct` description and takes inline tags; its card names `<laugh> <sigh> <whisper>
  <angry> <giggle> <chuckle> <gasp> <cry>` "and 12+ more" and gives demon and villain
  descriptions. — *code + web* · `docs/models/maya1.md`, `huggingface.co/maya-research/maya1`.
- `midashenglm_gen` (Apache-2.0) generates mixed audio from tagged layers `<|caption|>`,
  `<|asr|>`, `<|speech|>`, `<|music|>`, `<|sfx|>`, `<|env|>`. · `docs/models/midashenglm_gen.md`.
- `stable_audio`: Stable Audio 3 Small SFX (0.6B, text → sound effect), Small Music and Medium.
  Stability AI Community License — free under USD 1M yearly revenue, commercial use registered,
  "Powered by Stability AI" shown, the Gemma terms on its text encoder. `controlfoley` is
  CC-BY-NC-4.0. — *code + web + record* · `docs/models/stable_audio.md`,
  `huggingface.co/stabilityai/stable-audio-3-small-sfx`.

**AI outside our runtime** (*web, 2026-10-07*):

- Step-Audio-EditX (980★, code Apache-2.0) edits existing speech — emotion, styles (whisper,
  child, older, …), paralinguistics, denoise, speed; 3B; ≥12 GB VRAM, an AWQ 4-bit build
  ~6–8 GB; Python/torch only, no GGUF or C++ runtime documented, not in audio.cpp. Its Hugging
  Face weights carry no licence tag (engine scan). · `huggingface.co/stepfun-ai/Step-Audio-EditX`.
- RAVE is CC-BY-NC-4.0 (its LICENSE); DDSP is Apache-2.0 on TensorFlow; Beatrice v2 forbids
  commercial use (a secondary source).
- LLM2Fx (Sony AI and KAIST, WASPAA 2025, arXiv 2505.20770): LLMs predict EQ and reverb
  parameters from a text description zero-shot, better with DSP features, DSP code and
  few-shot examples in the prompt.

---

## Records not yet distilled

Indexed by subject so they can be found; their facts move into a section above when work next
touches the subject. History in [`../plans/archive/`](../plans/archive/) is not listed.

**The 2026-10-06 leftovers batch** (the demo again, the small wrong things, five decisions,
Lexicons and Compare) — [`2026-10-06-leftovers-batch.md`](../plans/2026-10-06-leftovers-batch.md)

**Voices and personas** —
[`2026-08-15-voice-workflow-redesign.md`](../plans/2026-08-15-voice-workflow-redesign.md) ·
[`2026-08-15-voice-workbench.md`](../plans/2026-08-15-voice-workbench.md) ·
[`2026-08-17-voice-model.md`](../plans/2026-08-17-voice-model.md) ·
[`2026-08-20-voices-fixes-and-alexandria-train.md`](../plans/2026-08-20-voices-fixes-and-alexandria-train.md) ·
[`2026-08-21-blend-rework-and-consistency-audit.md`](../plans/2026-08-21-blend-rework-and-consistency-audit.md) ·
[`2026-08-21-lora-alexandria-parity-and-acceleration.md`](../plans/2026-08-21-lora-alexandria-parity-and-acceleration.md)
(training removed 2026-10-02) ·
[`2026-08-22-voice-modes-truth-and-parity.md`](../plans/2026-08-22-voice-modes-truth-and-parity.md) ·
[`2026-09-29-speakers-and-personas.md`](../plans/2026-09-29-speakers-and-personas.md) ·
[`2026-09-30-voice-gender-and-pronouns.md`](../plans/2026-09-30-voice-gender-and-pronouns.md) ·
[`2026-10-03-persona-redesign.md`](../plans/2026-10-03-persona-redesign.md) ·
[`2026-10-04-persona-voice-making.md`](../plans/2026-10-04-persona-voice-making.md).

**Script, chapters and speaker attribution** —
[`2026-08-08-script-tab-restore.md`](../plans/2026-08-08-script-tab-restore.md) ·
[`2026-09-28-chapter-splitting.md`](../plans/2026-09-28-chapter-splitting.md) ·
[`2026-09-28-speaker-attribution-tuning.md`](../plans/2026-09-28-speaker-attribution-tuning.md) ·
[`2026-09-30-script-leftovers.md`](../plans/2026-09-30-script-leftovers.md) ·
[`2026-09-30-mock-vs-app-and-slice-4.md`](../plans/2026-09-30-mock-vs-app-and-slice-4.md).

**Pronunciation** — [`2026-09-30-project-lexicon.md`](../plans/2026-09-30-project-lexicon.md).

**The pipeline and first run** —
[`2026-08-15-pipeline-truth-and-first-run.md`](../plans/2026-08-15-pipeline-truth-and-first-run.md).

**Data folders and disk** —
[`2026-08-22-data-dirs-and-disk-reclaim.md`](../plans/2026-08-22-data-dirs-and-disk-reclaim.md).

**Docs** — [`2026-08-04-docs-coverage-worklist.md`](../plans/2026-08-04-docs-coverage-worklist.md) ·
[`2026-10-06-one-word-one-meaning-audit.md`](../plans/2026-10-06-one-word-one-meaning-audit.md) (speaker / persona / cast and one wording per fact — the list; built 2026-10-06 in five batches, TASKS "One meaning per word").

**Research kept in this folder** —
[`2026-06-24-audiobook-nlp-competitor-research.md`](2026-06-24-audiobook-nlp-competitor-research.md) ·
[`external-import-formats.md`](external-import-formats.md) ·
[`ue-integration-design.md`](ue-integration-design.md) ·
[`journey-podcast.md`](journey-podcast.md).
