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
  is not done. The family guard (`../../../just-core/scripts/check-family.js`, check 15)
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
[9 · Voice training on the speech runtime](#9--voice-training-on-the-speech-runtime) ·
[10 · One-click audiobook, frontier AI and the market](#10--one-click-audiobook-frontier-ai-and-the-market) ·
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
audit: every decision checked against code, memory measured, findings ranked ·
[`2026-10-11-audiocpp-engine-catalog.md`](../plans/2026-10-11-audiocpp-engine-catalog.md) — every
audio.cpp model in the app, built from audio.cpp's own files (§1.5 is what those files hold) ·
[`2026-10-13-narrowings-review/`](../plans/2026-10-13-narrowings-review/README.md) — every choice
the implementer made that the approved words didn't, checked adversarially ·
[`2026-10-13-adopt-everything-audiocpp.md`](../plans/2026-10-13-adopt-everything-audiocpp.md) —
every audio.cpp speech model offered, the seven engines described by our own files on the same
path (decided 2026-10-15; slice 4 built 2026-10-16, §1.6).
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
- Since v0.9.2 the routes live in `app/server/request_dispatch.h` (shared with the parallel
  server) with the same paths and bodies JustVoice sends (`/health` :42, `/v1/models/load` :59,
  `/v1/audio/speech` :100, `/transcriptions/details` :115, `/alignments` :121, the unload routes
  :139, :142), and an invalid request is an `InvalidRequestError` → 400 (:154), which
  `runtime.js` `_raiseFor` passes through. — *code, 2026-10-15* · our fork's merge of v0.9.2
  (`85d97a43`).
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
  (VoiceDesign), language **a name** (`English`); Chatterbox `voice_ref`, language a code. —
  *measured on v0.9.0, 2026-10-01* · switch §3.4. Since v0.9.2 Qwen3-TTS also takes ten language
  codes (`en`, `zh` …; `qwen3_tts/talker.cpp:515`), and its options are `voice_id` and `instruct`,
  the old `speaker` and `instruction` still read (`qwen3_tts/session.cpp:680-699`). (was: `en`
  rejected — until v0.9.2.) — *code, 2026-10-15* · the v0.9.2 merge.
- Only Kokoro and Kitten reject an unknown option name; Qwen3, Chatterbox, Turbo, VoxCPM2 and
  Pocket ignore it silently. — *agent, 2026-10-04* · audit §5 (group D). Since v0.9.2 the check
  reads the runtime's specs (`package.cpp:508-532`): a dev build reads `model_specs/<family>.json`
  from the server's working folder upward (`runtime.js` starts it in `bin/`, so
  `../audio.cpp/model_specs`), a release (`AUDIOCPP_DEPLOYMENT_BUILD=ON`) its built-in copy, the
  GGUF's embedded spec last (`model_spec_override: "embedded"` exists; unused). At v0.9.2 the
  qwen3_tts, chatterbox, voxcpm2 and pocket specs list their request options (at jv.5 none did),
  and many families renamed options — `instruction` → `instruct` (Breeze, CosyVoice3,
  FireRedTTS3, Irodori, OmniVoice, FireRedAudio), IndexTTS2 `duration_factor` →
  `duration_scale`, Chatterbox `s3gen_cfg_rate` → `flow_guidance_scale`, Turbo `max_tokens` —
  each family's code still reads the old name, but no spec has an alias field (a few say so in
  a description). So a setting saved under an old name needs our own map once `catalog.json`
  is built from v0.9.2's specs. — *code, 2026-10-15* · the v0.9.2 merge's spec diff.
- v0.9.2's specs drop numeric bounds the runtime doesn't enforce (ZipVoice shift / feat_scale /
  target_rms, GLM-TTS top_p, Echo TTS max_duration_sec's minimum, IndexTTS duration_scale), as
  `model_specs.md` says; `model_params.json` still names some options the old way (ZipVoice
  `t_shift`, IndexTTS2 `duration_factor` / `lang`). Families check request options against their
  spec (`validate_spec_backed_request_options`) and read a renamed option under both names
  (`zipvoice/session.cpp:316,326`, `index_tts2/request.cpp:171`, `cosyvoice3/session.cpp:175`);
  the jv.5 build reads only the old names. Chatterbox's `flow_guidance_scale` is "captured
  during clone preparation; changing it on the same prepared session is rejected"
  (`chatterbox/loader.cpp:43`). Settings saved under an old name keep working through each
  family's `OLD_OPTION_NAMES` (curated files; applied in `slot.js`, `persona_render.js`,
  `personas_api.js`, `line_takes.js`). Gone with no successor: CosyVoice3's session
  `conv_weight_type` (accepted and ignored), FireRedAudio's `helper_graph_arena_mb`. —
  *code, 2026-10-15* · JustVoice `439d904`.
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
- **Seeds:** random per request on Qwen3, Chatterbox and Pocket, and since v0.9.2 on Kokoro and
  Kitten too (`kokoro_tts/session.cpp:747`, `kitten_tts/session.cpp:267`). Turbo: none or 0 = a
  fixed seed. VoxCPM2: none = 1234. Seed 0 is a literal seed everywhere. (was: Kokoro and Kitten
  kept the session's seed until a request sent one — measured on Kokoro: no seed twice gave
  identical audio — until v0.9.2.) — *measured (Kokoro, 2026-10-04) + code, 2026-10-15* · audit
  §5 D1; the v0.9.2 merge.
- **The app sends a random seed when none is set, or 0**, so "no seed" is a new take on every
  family. (was: nothing sent — Kokoro, Kitten, Turbo and VoxCPM2 repeated — until 2026-10-04.)
  — *code + tests, 2026-10-04* · `slot.py` `to_speech_request`; audit §13.5.
- **The same seed repeats the take on every engine on the CPU, and on the graphics card on all
  but Pocket TTS and Qwen3-TTS, whose take can change slightly with the longest request since
  the model loaded.** Through the app (RTX 2070 SUPER 8 GB), seed 42, the same line, 3–4 takes
  each — first on main `d8cf3055` with audio.cpp dev `8c9a6322`: byte-identical every time on
  Kokoro (CPU and GPU), Qwen3 CustomVoice, Qwen3 Base 1.7B, Chatterbox Multilingual, Chatterbox
  Turbo (a clone) and VoxCPM2; on the CPU, byte-identical on Kitten and Pocket; on the GPU,
  Kitten's two takes unrelated (correlation about 0) and Pocket's identical for the first 2.5 s,
  then drifting; Qwen3 VoiceDesign's first take after a fresh load one 80 ms frame longer than the
  next two (correlation 0.99975), the next two identical. Then on dev `bcc5dfbb`: KittenTTS repeats
  on the GPU and the CPU (the fork's 7ec5c652 — its predictor LSTMs started each compute from what
  the last one left; their zero states were written once, at graph build), the rest as before;
  39 / 39 takes read back. A CPU take and a GPU take of the same seed differ (Kokoro, Kitten,
  Pocket). F5-TTS repeats since the fork's `8c9a6322` (§10.15). **Why Pocket and Qwen3 differ on
  the GPU:** their graphs are sized by the longest request so far — Qwen3's talker step graph
  doubles (`talker.cpp:1862-1892`), Pocket's by the shared capacity controller
  (`session.cpp:325-370`) — and ggml's CUDA flash attention splits its sum by that size
  (`fattn-common.cuh:1057`), so the additions run in another order; the words don't change. A
  first load with no stored price warms up on a full-length piece (800 characters on VoiceDesign),
  which is why a model's first take after a new runtime build differs. Whether to change that
  (in the model, in ggml, or not at all) is the user's (TASKS "Same seed, same take on the graphics
  card"). The app offers every engine a seed — Kitten's since 2026-10-16 (`capability_details.js`
  `kitten`, TASKS "Slice 5's findings" 1). (was: "all but Kitten and Pocket" on the card, Kitten
  offered no seed — until 2026-10-16; before that, "every engine but KittenTTS" repeats, Kitten
  never — 2026-10-01/02, the device not recorded.) — *measured, 2026-10-16* · the slice-4 GPU
  run's `phase1/json/renders.json` (scratch, not kept); TASKS "Same seed, same take on the graphics
  card" BUILT.
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
- Options the runtime reads, per engine — audit §7. At jv.5 Kokoro's model spec lists its options
  (`model_specs/kokoro_tts.json`: request, session, load), and so do Kitten's (request and
  session) and Qwen3-ASR's (two request options); the Qwen3-TTS, Chatterbox, VoxCPM2 and Pocket
  specs list none — upstream added theirs after jv.5 (19859a07, 2026-10-06). (was: "Only
  Kokoro's model spec lists its options" — corrected 2026-10-13, the narrowings review F1.) —
  *code, 2026-10-04; checked against the jv.5 tag 2026-10-13*.
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
  runtime's defaults. Max-token caps are not offered on those seven engines (the models'
  positional limits unchecked). — *code + tests, 2026-10-04* · `capability_details.py`; audit
  §13.5. **Load options:** every session option a model's spec lists (catalog.json
  `options.session`), typed as the spec types it, at audio.cpp's default — except file paths and
  what the app sets for the row — with Qwen3's `perf_mode` (8-bit rows) and `conv_weight_type`
  (16-bit by default) kept on the row with their measured words (curated `LOAD_OPTIONS`). (was:
  those two Qwen3 options alone — until 2026-10-15, the adoption plan's E4.) — *code + tests,
  2026-10-15* · `engines/audiocpp/runtime_options.js`; JustVoice `43007230`.
- **A session option's key and value** (adoption slice 3): the spec names it locally and the
  framework's key is `<family>.<name>` ("load and session options are local names in the spec;
  the framework derives their public keys as `<family>.<name>`", `docs/maintainers/
  model_specs.md`). A server config's or `/v1/models/load`'s `session_options` object becomes a
  map of strings (`app/server/config.cpp:352` → `json_options_map`, `app/cli/request.cpp:253`),
  so JustVoice sends and saves text; a switch reads `true`/`1`/`yes`/`on` or their opposites
  (`parse_bool_option`, `src/framework/runtime/options.cpp:298`). `GET /v1/models?
  include_session_options=true` lists the loaded models with their session options
  (`app/server/request_dispatch.h:44-51`). The spec also has a `load` scope (9 options at v0.9.2:
  Pocket's `language`, VibeVoice's LoRA …), sent as the config's separate `load_options`; the app
  offers only `options.session`, as the plan's E4 says. — *code, 2026-10-15*.
- **Chatterbox Multilingual v3** (`chatterbox.multilingual_t3`, `v2` | `v3`, default `v2`;
  `src/models/chatterbox/session.cpp:299-308`): picks which multilingual T3 a session builds for a
  non-English line — English always uses the English T3 (`chatterbox_language_uses_multilingual_t3`
  is "language != en", `text_tokenizer.cpp:612`). The language list is one for both
  (`supported_chatterbox_language_codes`, 23; "mtl23ls" is the checkpoint's own name for it). The
  pinned `Chatterbox-GGUF/chatterbox-q8_0.gguf` (revision `7bf52723`, unchanged at `f861648c`)
  carries both: `t3_multilingual_v2/*` and `t3_multilingual_v3/*`, 262 tensors each, beside
  `t3_english/*` (its header read on this machine, 3,381 tensors). Not yet loaded through the app.
  — *code + file, 2026-10-15*.
- **A number's ends: audio.cpp's control list against the spec.** Where both give an end they
  differ for seven settings of the generated models at v0.9.2: Audio8 `max_tokens` (spec 0,
  control 1) and `top_k` (spec 1, control 0), CosyVoice3 `min_tokens` (−1 / 0), Echo TTS
  `num_inference_steps` (from 1 / 8–40), Irodori `duration_scale` (from 0 / 0.5–2), Maya1
  `temperature` and `repetition_penalty` (0 / 0.01). The app takes the control list's end where it
  gives one, else the spec's (the plan's §2: "audio.cpp's `model_params.json` where it has them,
  else the spec"), and the request keeps a value to those ends. 161 number settings of the
  generated families (one model per family) have an open end — number boxes now, left out before
  (E2). — *code, 2026-10-15* ·
  `generated.settingsOf`; JustVoice `27f1c140`.
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

- **Pinned build `v0.9.0-jv.5`** — tag at our copy's `55b150f4`, published 2026-10-10 04:10 UTC
  by release run 38015817065 after dry run 38007578452 passed on every platform: jv.4 plus
  `audiocpp_dsp` in every build (release.yml's BUILD_TARGETS; the Linux builds needed
  Signalsmith's headers as SYSTEM includes, 55b150f4). The installer stages the CPU build's copy
  (`scripts/audiocpp-dsp-package.js`, measured 2026-10-10: the Windows CPU-portable archive,
  sha256-checked, `audiocpp_dsp.exe` with its eight MSVC runtime DLLs, launch-checked). Builds in
  order `v0.9.0`, `v0.9.0-jv.1`, `v0.9.0-jv.4`, `v0.9.0-jv.5`; an install on any older one keeps
  working until updated. (was: pinned jv.4, published 2026-10-05 by run 37243444087, until
  2026-10-10.) Features: `voxcpm2_transcript` jv.1; `voice_pack`, `inline_ipa`, `turbo_clone`,
  `chatterbox_he_ru_zh`, `japanese`, `model_management` jv.4. (was: pinned jv.1, with jv.2 / jv.3
  placeholders — until 2026-10-04.) — *code + GitHub API + measured, 2026-10-10* ·
  `server/src/engines/audiocpp/release.js`.
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
- **What our fork carries, and whether upstream has it (upstream main `96269554`, 2026-10-11):**
  22 commits on v0.9.0, 93 files / 13,302 lines added — of which `dsp/` (`audiocpp_dsp`, no ggml,
  its own executable) is 54 files / 11,874 lines; the model and server changes are ~1,400 lines.
  Upstream has **none** of them: Kokoro `voice_pack` (blends) and inline IPA (lexicons), Kokoro
  joins at its sentence pause, Chatterbox Turbo/Nano cloning (upstream's Turbo spec lists no
  `speaker_reference`), Chatterbox Hebrew/Russian/Chinese and Japanese with the dictionaries
  staged, `model_management`, VoxCPM2's transcript as prompt audio, the Qwen3 aligner/ASR
  word-timing fix, Qwen3's decoder memory and last-25-frames speed-up. No pull request from us
  exists upstream (`gh pr list --author delebash`: none). Upstream's own v0.9.1 release ships the
  same platform set our releases do (Windows CPU/Vulkan/CUDA 12.4/13.3, macOS Metal arm64 + x64,
  Ubuntu CPU/Vulkan, CUDA 12.8 Colab). Its CONTRIBUTING asks a PR that changes runtime behaviour
  for "actual runtime validation"; it has no rule on AI-written code. — *git + GitHub API,
  2026-10-11*.
- **Our fork on upstream v0.9.2** (released 2026-10-15, 77 commits after v0.9.1): merged into
  `jv` as `85d97a43`, pushed 2026-10-15. Six conflicts, all in our additions: the README (models
  moved to `docs/models/`), Turbo's doc and spec (upstream's request options kept beside our
  `speaker_reference`, `voice_encoder_weights` and the session option `conditionals_cache_slots`
  our code reads), Turbo's header (upstream moved S3Gen into `engine::codecs::s3gen`; our voice
  holds an `S3GenConditioning`), Kokoro's session (upstream's `voice_id`, `language` and
  per-request seed beside our `voice_pack`), and the server (upstream moved the routes and the
  speech-request build; `/health`'s `model_management` and the load/unload checks kept, our
  VoxCPM2 transcript-as-prompt-audio moved into `build_speech_request`,
  `server_protocol.cpp:213`, with a new `SpeechRequestContext::family` — upstream's VoxCPM2 still
  reads prompt audio only from `audio_input`, `voxcpm2/session.cpp:356-366`). Upstream's #855
  dropped `DEPENDS chatterbox` from `chatterbox_turbo`; our Turbo cloning needs core Chatterbox's
  encoders, so it is back. Every line our fork added against v0.9.1 is present. Built with CUDA
  12.4 in 758 s; ctest 80 of 82 — the two failures are upstream's (`kokoro_word_timings_test`
  isn't compiled `/utf-8`, so its IPA literals break on code page 1252; `lfm2_audio_assets_test`
  needs a model folder). v0.9.2's release workflow adds `lib-*` archives,
  `server-config-examples.zip` and a Windows Vulkan-portable build; the `bin-*` names
  `release.js` pins are unchanged. — *git + build + ctest, 2026-10-15*.
- **The catalog at v0.9.2** (adoption slice 1, JustVoice `439d904`): built at `jv` `4d2f1a2b`
  — the merge plus our additions in our fork's own specs (`68c3ead0`: Kokoro `voice_pack`,
  Chatterbox he/ru/zh/ja, Turbo/Nano cloning packages, VoxCPM2 `reference_text`), catalog
  entries for packages that had none (`21607a3a`: F5-TTS's Habibi checkpoints, VoiceTut-TTS,
  QwenCleo-ASR, DotTTS Edit, Turbo cloning and Nano) and our Qwen3 0.6B CustomVoice
  (`4d2f1a2b`). 122 families (50 speech), 386 packages, 190 entries; built-in voices 193 (171
  speech) in 13 families; options 1,028 request / 587 session / 9 load; 25 generated engines
  with 64 downloads, none of the 47 before removed. `MODEL_REVISION` `f861648c` (2026-10-11):
  81 files added since `7bf52723`, none changed. 13 files named by v0.9.2's specs are missing
  at their sources (audio8_asr ×2, upstream's `chatterbox-turbo-f16.gguf`, mms_forced_aligner
  q8, Orukeet ×2, reuse ×2, sortformer_diar_v2 ×5). — *git + HF API + tests, 2026-10-15*.
  **Pinned to v0.9.2-jv.6 on 2026-10-16** (bcc5dfbb, published 16:35 UTC, 32 assets; the ten
  archives the app downloads checked by their published sha256, `release.js`); the catalog
  rebuilt at the tag changed only its `generated_from` (every spec the same as at `jv`
  4d2f1a2b), so the pin test runs again and the seven engines' proof test passes unchanged.
  (was: the catalog built ahead of the pin, the pin test skipped, the packaged and headless app
  on jv.5 listing Kitten TTS 2 without loading it and sending renamed settings under names jv.5
  doesn't read — until 2026-10-16.) — *GitHub API + tests, 2026-10-16*.

### 1.5 audio.cpp's own web UI

All *code*, our checkout at `55b150f4`, read 2026-10-11 — `../audio.cpp/webui/`.

- One SvelteKit/TypeScript single-file app embedded in `audiocpp_server` (`--ui`; `--ui-management`
  adds load/unload, downloads and uploads; needs `AUDIOCPP_BUILD_NATIVE_MODEL_MANAGER=ON`). Four
  pages: Studio, Arena, Models, Runtime (a browser-side event log). · `webui/README.md`,
  `native/src/lib/i18n.ts:16-21`.
- It reads three data files: `configs/models_catalog.json` (144 entries — `id`, `display_name`,
  `family`, `path`, `task`, `mode` on all; `download_id` 135; `min_vram_gb` 113; a usage hint
  `input_hint_en` 70 / `input_hint` 46; `arena` 8), `configs/model_params.json` (71 keys, by
  entry id or family: each control's `name`, `type` text·number·slider·bool·choice, `label`
  (some only in Chinese, with `label_en`), `default`, `minimum`/`maximum`/`step`, `info`/`info_en`,
  `scope: session` for load-time options), and `native/lang/lang_*.json`. The model specs
  (`model_specs/*.json`) hold the typed options with descriptions; `model_params.json` holds the
  UI's labels, slider-or-number and help text.
- Its controls are not purely data-driven: `resetParams` and `requestOptions` special-case the
  families vibevoice, moss_ttsd, minimax_h3, yue2, canary_asr, universr, auk, controlfoley and
  midashenglm_gen, and three models have their own panels (AuK, LiveAvatar, YuE2). ·
  `native/src/routes/+page.svelte:1067-1371`, `native/src/lib/models/`.
- **Arena** runs one input through a queue of installed models and packages, one after another,
  in TTS, voice-conversion or ASR mode, with a shared voice (model default, built-in demo voice
  or a reference clip) and shared options. Each result shows wall time and real-time factor; ASR
  results show word error rate against a pasted transcript; a model that can't take the shared
  voice is skipped with a note ("requires reference text", "requires a reference voice").
  Results sort by real-time factor. · `native/src/routes/Arena.svelte:258,499-552`, `i18n.ts:28-97`.
- **Models** shows each package's precision choices and sizes, a version status (Up to date ·
  Update available · Version unknown), Stop download, Clean partial download, "HF access
  required", delete, and a models-folder browser. **Studio** shows "{n} GB estimated VRAM" from
  `min_vram_gb`, Load/Unload, splits long text in the browser by sentence into chunks of a set
  size and joins the WAVs (`native/src/lib/text.ts:144`), offers demo voices with their
  transcripts, saves voices in the browser's IndexedDB only, records the microphone, and runs
  live ASR in four-second slices. · `i18n.ts:120-258`.
- The catalog gives CosyVoice3 `min_vram_gb` 8; on this 8 GB card it rendered round 3's 28
  takes at a median 1.4 s each (§10.6). IndexTTS's `lang` option defaults to auto — Han
  characters → zh, otherwise en — and setting `emotion_text` turns on `use_emotion_text`. ·
  `configs/models_catalog.json`, `configs/model_params.json` `index_tts2`.
- `installChoices` is ported whole into `scripts/audiocpp-catalog.js` and checked against
  audio.cpp's own `catalog.ts` run in vitest on the same files: the same downloads for every
  entry. `workflow` decides an entry's tab (DotTTS Edit runs as `tts` with template `edit`,
  `dots_tts/session.cpp:454`, under the conversion tab). v0.9.2's catalog lists DotTTS
  MeanFlow, FireRedTTS3 Base and Irodori v3 before the spec's `recommended_package`, so the app
  orders by the spec (each engine's default unchanged). F5-TTS's Habibi GGUFs carry Vocos (no
  vocoder download), and `vocab.txt` is read from the GGUF's folder
  (`f5_tts/synthesize.cpp:1140`). — *code + tests, 2026-10-15*.
- **How it shows a model's options:** all of them, session-scoped ones too, folded in one
  `<details>` — "Model parameters" and their count — each control by its control-list type: a
  `slider` a range input, a `number` an `<input type="number">` with the control's min, max and
  step (none given = the browser's step of 1), `bool` a switch, `choice` a select, `text` a text
  input (`native/src/routes/+page.svelte:3040-3077`). JustVoice's number box and its folded load
  options follow it (the adoption plan's E2, E4). — *code, 2026-10-15*.

### 1.6 The seven engines described by our own files, on audio.cpp's path (slice 4)

The adoption plan's slice 4 (`docs/plans/2026-10-13-adopt-everything-audiocpp.md` §5), built
2026-10-16 (JustVoice `0e3a89bf`, branch `slice4`) on `catalog.json` as slice 1 left it (fork `jv` `4d2f1a2b`, models `f861648c`). All
*code + tests, 2026-10-16* unless marked; the engines are `generated.ownEngine`, their notes each
family's `curated/<family>.js` (`ENGINE`, `MODELS`, `VOICES` …).

- **Read from audio.cpp's files now:** every download (repository, revision, files, sizes — one
  per package; Qwen3-ASR's aligner as the companion package of its own precision), each model's
  precisions, the task it registers as (its catalog entry's: Chatterbox Multilingual `clon`, Qwen3
  VoiceDesign `vdes`, the rest `tts` / `asr`), the built-in voices and their default (Kokoro's 54
  and `af_heart`, Kitten's 8 and `Leo`, Qwen3 CustomVoice's 9, Pocket's `alba`), the languages
  (Qwen3's 10, Chatterbox's 23 with our fork's he/ru/zh/ja, Turbo's `en`, VoxCPM2's 30, Qwen3-ASR's
  30), audio.cpp's piece budget (`text_chunk_size`: Chatterbox and Turbo 128, Kokoro 240 — also
  Kokoro's `split_chars` — Kitten 400; `slot.FAMILY_BUDGET` gone) and the memory estimate
  (`min_vram_gb`). (was: copied by hand into `engines/<id>/manifest.js` and `kokoro/voices.js` —
  until 2026-10-16, the narrowings review F10.)
- **Kept in our notes, with why:** our ids (engine, model, variant and voice — personas, takes,
  prices and downloads on disk use them), the names and descriptions the app shows, voices'
  genders and display names, and each voice's language as the app writes it (Kokoro's `fr`,
  `en-US`, `pt-BR`, Kitten's `en-US` against the spec's `fr-fr`, `en-us`, `pt-br`, `en`: a
  persona's language, and a take's cache key, are built from it); which Qwen3 checkpoint clones
  (Base), speaks the 9 speakers (CustomVoice) or designs (VoiceDesign) — the spec lists all three
  on one family and its voices on every entry; Pocket's other 19 presets (their files are in the
  model repo, named by no spec package) and its one language per package; the measured facts
  (`cpu_realtime`, `quality`, `split_chars` 200 for Qwen3 and VoxCPM2); Kyutai's terms on Pocket
  cloning; and each engine's request (`slot.js`), which sends the names the pinned build reads
  (v0.9.0-jv.5 reads only the old ones — `speaker`, `s3gen_cfg_rate`). "zh dialects" stays out of
  VoxCPM2's and Qwen3-ASR's languages (a description; how to show it is open).
- **The same, checked** (NOT STANDARD, kept by the user's word by name, 2026-10-16 — TASKS "The
  run's last questions" 1): `server/tests/seven_engines_unchanged.test.js` compares against
  `seven_engines_before.json`, written on main (5bcd223f) before the move — 40 persona requests
  (`runtime._jsonBody`'s bytes, or the refusal's words), every model's registration, warm-up and
  calibrating warm-up, Qwen3-ASR's transcriptions and alignment, a persona's saved settings as a
  render reads them (`modelSettings`), and every model, voice and price key (`load_options`,
  `split_chars`): all the same but what the decisions below change.
- **Added (the plan's E6/E14/F5):** Qwen3-TTS Base 1.7B and VoxCPM2 at their original precision
  (`-orig`, 4.5 GB and 5.0 GB); audio.cpp's own Turbo package (`chatterbox_turbo_q8_0`, 699 MB,
  estimate 4 GB; its f16 file is missing at `f861648c`) — its built-in voice only, no voice
  encoder, so no cloning (refused by name: "‹model› speaks only its own built-in voice"), named
  "Chatterbox Turbo (built-in voice only)" (`curated/chatterbox_turbo.js`; decided 2026-10-16,
  TASKS "Slice 4's gaps" 1 — was: audio.cpp's catalog name whole, "Chatterbox Turbo (tts)", until
  8c54401f, 2026-10-16); and QwenCleo-ASR (`qwencleo_asr_q8_0` /
  `_f16`, 2.48 / 4.09 GB, `mohammedaly22/QwenCleo-ASR-GGUF` at `6884dc20`), with the aligner like
  every Qwen3-ASR row. Pocket TTS French (`pocket_tts_french_q8_0` / `_bf16`, in the spec, not in
  audio.cpp's own install choices) is offered for cloning only: its one preset, cosette, is
  Expresso's, non-commercial, and none of our twenty presets has a French file, so its rows list
  no voice (`curated/pocket_tts.js` `MODELS`, `voices: false`); no CPU speed, so Auto doesn't send
  it to the CPU on speed (decided 2026-10-16, TASKS "Slice 4's gaps" 2; was: not offered, until
  8c54401f, 2026-10-16). — *code, 2026-10-16*.
- **QwenCleo-ASR:** Apache-2.0, "inheriting the Qwen3-ASR license terms"; its card names Egyptian
  Arabic, Modern Standard Arabic and Arabic ↔ English code-switching, "Not optimized for
  pure-English audio", and recommends the language hint "Arabic"; the card's and its GGUF repo's
  language tags are `ar`, `en` (HF API). audio.cpp's doc: "Egyptian Arabic and Arabic-English
  code-switching" (`docs/models/qwen3_asr.md:47-50`). Its languages in our notes: `ar-EG`, `en`, as
  VoiceTut-TTS's (decided 2026-10-15); its request sends "Arabic" for either Arabic tag. — *web
  (HF API, model card) + code, 2026-10-16*.
- **Word timings for Arabic: neither of audio.cpp's aligners gives them as things stand.** The Qwen3
  Forced Aligner covers zh, en, yue, fr, de, it, ja, ko, pt, ru, es (its catalog entry), so a
  QwenCleo transcription has no word timings. audio.cpp's other aligner, `mms_forced_aligner`
  (Meta's MMS-300M, 1,130 languages), takes only romanized words: its own normalization handles
  Dutch and English and rejects other non-Latin text; `text_normalization=pre_romanized` takes the
  caller's ASCII romanization (e.g. Uroman's). Its checkpoint is CC-BY-NC-4.0 and no audio.cpp GGUF
  is published — convert locally (`../audio.cpp/docs/models/mms_forced_aligner.md`). So it would
  need a romanizer and is non-commercial (§10.11 says the same of ctc-forced-aligner's default
  model). — *fork docs + catalog, 2026-10-16*.
- **QwenCleo-ASR's files are in two repositories' folders.** Its model is in
  `mohammedaly22/QwenCleo-ASR-GGUF` and Qwen3's aligner in `audio-cpp/audio.cpp-gguf`, so its
  download has two sources, and `speech_cache.fetchHfVariant` keeps each source in its own folder
  (`<owner>--<name>/`) whenever a variant has more than one. The registration joined the variant's
  folder and the file, so the load failed with "model path does not exist:
  …\qwencleo-asr-q8\qwencleo-asr-q8_0.gguf" (the file was at
  `…\qwencleo-asr-q8\mohammedaly22--QwenCleo-ASR-GGUF\`). The registration now asks
  `speech_cache.variantFilePath`, the download's own rule, with the repository files.json records
  (an operator's mirror replaces it). QwenCleo's two rows are the only ones with two sources at
  `f861648c`; Qwen3-ASR's aligner shares its model's repository and revision (one source, one
  folder), as MioTTS's codec does. The 24 downloads on the user's disk all resolve, at the same
  paths as before. (was: the variant's folder — until 2026-10-16.) — *code + tests, 2026-10-16* ·
  `speech_cache.js` `variantFilePath`, `slot._entriesFor`; TASKS, slice 4's "GPU half, 2026-10-16".
- **Pocket TTS French loads with no voice; only our warm-up asked for alba.** audio.cpp's
  registration reads no voice: the model's voice folder is its file's own folder
  (`pocket_tts/assets.cpp:158`), and a preset's file is opened only when a request names it
  (`session.cpp:369`, `voice_state_assets.cpp:204` — `<model folder>/embeddings/<name>.safetensors`);
  the server picks a default voice only when its config names one (`default_voice_preset`,
  `app/server/config.cpp:371`), which ours never does. audio.cpp's own page sends the spec's
  `default_voice` (alba) when nothing else is chosen (`webui/native/src/routes/+page.svelte:2106`)
  — and doesn't offer the French package at all (it isn't among its install choices). Our
  warm-up spoke every Pocket model in alba, so the French load failed with "failed to open
  safetensors file: …\french\embeddings\alba.safetensors" (its download holds only cosette, which
  we don't offer). A Pocket model with no preset now has no warm-up, and its first line sets its
  price (§7 answer 5); the other languages' warm-up is the same request. (was: alba for every
  language — until 2026-10-16.) — *code (fork `bcc5dfbb`) + tests, 2026-10-16* · `slot._warm`.
- **A built-in voice speaks the languages of the versions that carry it.** A voice's languages
  (`voice_model.describe`, what `/v1/voices`, the persona page, Cast's filters and a persona's
  save read) were every version of its model's: Pocket's twenty presets listed French, which
  only the French model speaks, and it has none of them — so a persona on a preset could be
  saved in French and was refused at its first line. A preset now lists the languages of the
  rows whose `audiocpp.voices` carry it (`presetSpeaks`): English, German, Italian, Portuguese
  and Spanish; a Pocket clone all six. Every other model's built-in voices are on all its
  versions, so theirs are as before; a model whose rows list no voices keeps every version's.
  (was: every version's — until 2026-10-16.) — *code + tests, 2026-10-16* · `voice_model.js`
  `presetSpeaks`; the persona mock's snapshot re-taken.
- **Turbo's and Nano's own voice** (the plan's F4): a line with no clip and the model's own voice
  goes as no voice (`{model, input, seed, options}`), as the warm-up always spoke; listed as
  "Turbo (built-in)" and "Nano (built-in)", gender Not known (decided 2026-10-15, §7 question 6),
  id `<model>_model_default`. Nano shares Turbo's conditioning (gap-1 §2), so it is likely the same
  voice; not heard yet.
- **Memory before a load** (the build's answer 3): the seven get `needOf` as every model — the
  catalog entry's estimate or the files, whichever is more: Kokoro and Kitten 1 GB, Pocket 2,
  Qwen3 Base 0.6B 5, the 1.7B checkpoints 8, Chatterbox Multilingual 12, VoxCPM2 6, Qwen3-ASR 0.6B
  3 and 1.7B 6; our own conversions (CustomVoice 0.6B, Turbo, Nano) and QwenCleo have no estimate,
  so their files decide. Auto weighs an unmeasured one by it (Chatterbox on an 8 GB card: "tries the
  graphics card first", its files fitting); a measured price still decides first. A clone-only one
  (Chatterbox Multilingual, Qwen3 Base, Pocket TTS French) is priced after its first line (§7
  answer 5; how, §2.3 "A first line's price"). (was: none —
  "memory not measured yet", Auto taking the card without a reason — until 2026-10-16.)
- **The seven's settings at audio.cpp's ranges** (TASKS "Slice 3's six questions" 4,
  `capability_details.atAudiocppRange`, ends from `generated.audiocppEnds`): Kitten's Speed from
  0.01; Chatterbox's Top p, Min p and Decoder CFG, Turbo's and Nano's Temperature, Repetition
  penalty and Top p, Qwen3's Detail temperature, VoxCPM2's Tries on a runaway and Runaway limit are
  number boxes (audio.cpp gives no range). **Kept narrower than audio.cpp's, ours, so a saved value
  stays valid:** Kokoro's and Kitten's Speed top 3 (audio.cpp's control list 2), Chatterbox's and
  Qwen3's Repetition penalty top 4 (control list 2). **Kept above audio.cpp's bottom, the app's
  floors:** every temperature and top-p from 0.05 (audio.cpp's 0 on Chatterbox's and Qwen3's
  temperature, Qwen3's top-p and Detail top-p, and its spec's 0 on Qwen3's Detail temperature —
  Qwen3 refuses a temperature of 0, Chatterbox divides by it, Turbo reads it as 1.0, Qwen3 reads a
  top-p of 0 as no filter, §1.2), and VoxCPM2's tries from 1 (its request sends at least 1).
- **A recogniser has no capability row:** Qwen3-ASR's variant ids (`qwen3-asr-1.7b-q8`) walked
  `capability_details.lookup`'s suffixes to Qwen3-TTS's `qwen3` row; `lookup` now answers null
  for every recogniser's variant, as it did for the generated ones. (was: Qwen3-TTS's row —
  until 2026-10-16.)

### 1.7 Round E — the kit's audio.cpp runtime against ours (read 2026-10-29)

The plan: [`2026-10-29-round-e-onto-the-kit.md`](../plans/2026-10-29-round-e-onto-the-kit.md). The kit's own facts
are its RESEARCH §12. All *code* at just-core `75d07f8` / JustVoice `78ca4a0e` unless marked.

- **What the kit ported matches ours:** `runner/audiocpp.js` `AudioCppServer`/`AudioCppPool` is our `runtime.js`
  near line for line; `runner/speech_placement.js` keeps the 512 MB speech card margin, the GPU pin never refused,
  the CPU speed as the best of the newest five at the current thread count, the first line's price inside the
  kind's lock; the nine pinned archives' SHA-256s equal ours (`release.js:86-96`). — *code*.
- **What it changed or left out:** the ledger id is `<kind>:audiocpp:<version>` (ours `<kind>:<engine>:<version>`)
  and the installed build's card word its folder, `cuda12` (ours `cuda`); a transcription load registers its
  companions at once — Qwen3-ASR's aligner, `qwen3-forced-aligner-0.6b-q8_0.gguf`, 1,078 MB on disk here (ours on
  the first alignment); no load downloads, no load cancels; no dead-server drop; no stop at quit; macOS Intel gone.
  The bugs found are the plan's §3.1. — *code; the file size measured*.
- **Its chat load does both:** it downloads (status "downloading", `lifecycle.js` `load`) and cancels — a stop during
  "downloading" or "starting" sets the load's token (`:2284-2289`), checked through `_runLoad`. (was, in my first
  draft of the plan: "the chat load has no cancel" — corrected the same day.) — *code*.
- **Our data against it, on this PC:** 779 speech measurement rows in the kit's own `model_measurements`, none under
  the kit's ids; only 6 models' card prices are for the build running now (`dev · 1de98891`); 39 CPU-speed rows
  (11 models) are build-free. `data/speech-cache`: 32 complete versions, 173 files, 93.6 GB (89.7 GB once
  de-duplicated by SHA-256 — `indextts/indextts-25-q8` is `index_tts2-indextts25-q8`'s bytes), every file's
  manifest id a SHA-256; 23 versions were downloaded before the SHA-256 check (2026-10-04). The installed build is
  `v0.9.0-jv.4/cuda12` (2.0 GB), not the jv.6 pin. The 11 `speech_runtime` settings have the kit's names and
  defaults, and every value here is at its default. JustVoice's `cache_root` is JustWrite's `data/ai-cache`. —
  *measured, read-only, 2026-10-29*.
- **Pocket TTS's preset voice files carry their SHA-256** (`curated/pocket_tts.js` `VOICE_FILES`): 99 files, 198
  entries over its 10 rows, each Hugging Face's LFS id at the pinned revision `f861648c` (its API's tree listing,
  `lfs.oid`); the 79 already downloaded here (English, German, Spanish, Portuguese) carry the same ids in their
  `files.json` (147 entries checked, models included), and every size is the file's `file_bytes`. (was: size only
  — until 2026-10-29.) — *web + the downloaded manifests, 2026-10-29*.
- **A small file Git stores itself has no SHA-256 in `catalog.json`:** its `sha256` is Git's blob id (40 hex, SHA-1),
  which is all Hugging Face lists for a file outside LFS. 29 offered rows on the working tree's catalog have one:
  F5-TTS Habibi's 8 `vocab.txt`, KittenTTS 2's LICENSE, NOTICE, two more LICENSEs and SHA256SUMS in each of its 3
  versions, sanoTTS's 18 `config.json` (all under 13 KB). The kit's download checks SHA-256 and removes a file that
  doesn't match (`runner/models.js` `acquireFileSet`), so each family file now gives those files' SHA-256s
  (`SMALL_FILES`, by repository, revision and path): 36 files fetched at their revisions, every size and Git blob id
  equal to the catalog's — KittenTTS 2's at the pinned `73b762c9` and at `be39e32c`, the uncommitted newer
  catalog's. (was: the Git id passed on, which the kit's download would refuse — until 2026-10-29.) — *code + the
  catalog + the files, 2026-10-29* · `engines/audiocpp/kit_models.js`.
- **audio.cpp's JSON transcription takes only a path on the server's computer** — "audio.cpp's native JSON request
  only takes a server-local path" (`app/server/runtime.cpp:1247-1251`); a multipart `file` part is spooled to a temp
  file by the server. `audio_base64` is read only by task requests (`handle_generic_run`, `:1951-1975`). So a 16 kHz
  copy made for a recogniser is a file, and the kit's transcription hook (`{body, timeout}`) has no step after the
  request that could remove it. — *code, our fork at `1de98891`, 2026-10-29*.
- **The kit's transcription hook runs inside the line, under the stt kind's lock:** `transcribeFeature` calls
  `transcriptionRequest` inside the `fn` it passes `withSpeechModel` (`llm/speech_dispatch.js`), whose `useModel`
  holds the kind's activity lock (`runtime_service.js` `_asKind`) — so no other transcription runs while one is
  shaped and sent. Our hook (`kit_hooks.js` `transcribe`) gives every recogniser but Qwen3-ASR a 16 kHz mono copy
  in `<data>/cache/transcription-16k/`, named by the recording's bytes, and deletes the older copies at each
  conversion (`slot.js` `recognizerInput`). (was: the hook ran before `withSpeechModel`, outside the lock, so a
  hook deleting older copies could delete one a queued transcription still waited to send — until just-core
  `52e663c`.) — *code, just-core `52e663c`, 2026-10-29* · `server/tests/kit_hooks.test.js`.
- **A line's refusals are the kit's routes' problems:** `withSpeechModel` throws the service's refusals as they are
  (an Error with `termsRequired`, `loadCancelled`, `need`, `diskFull`, `busy`; `NotEnoughMemoryError`) — only its
  own "engine-not-on" is an ApiError — and the kit exports the mapping its routes answer them with,
  `llm/runtimes_api.js` `runtimeProblem` (403 terms-required, 409 not-enough-memory / load-cancelled /
  engine-cant-run-here / model-busy, 507 disk-full, 404). Our `EngineRequestError` carries its problem
  (`engines/audiocpp/kit_speech.js` `engineError`); ours on top are audio.cpp's own answers with their status, and a
  licence as our TermsRequired naming the engine, which the app's terms dialog reads (`src/services/
  engineTerms.js`). A runtime not installed (`notInstalled`) is in no mapping: a line says it failed to load. A line
  never gets the load route's 202 "downloading": `useModel` waits for the download (G4). (was: the mapping private
  to the kit's routes, ours a copy of it — until just-core `284c67f`.) — *code, just-core `284c67f`, 2026-10-29*.

---

## 2 · Speech memory (graphics memory and the booking)

**Records:** [`2026-10-04-audiocpp-switch-audit.md`](../plans/2026-10-04-audiocpp-switch-audit.md)
§3 (measurements, cause, levers) and §5 B (the booking) ·
[`2026-10-01-audiocpp-switch.md`](../plans/2026-10-01-audiocpp-switch.md) §8 A–B ·
[`2026-10-02-cpu-placement.md`](../plans/2026-10-02-cpu-placement.md).
Before the switch (Python engines, history): [`2026-08-08-vram-think.md`](../plans/2026-08-08-vram-think.md) ·
[`2026-08-13-speech-catalog-redesign.md`](../plans/2026-08-13-speech-catalog-redesign.md).
The arbiter and the probes are the kit's: [`../../../just-core/docs/dev/RESEARCH.md`](../../../just-core/docs/dev/RESEARCH.md).

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
- **A first line's price** (a model that speaks only from a clip, §7 answer 5) is read while that
  line still holds the slot (`manager._priceFirstLine`, inside `synth`'s and `transcribe`'s
  activity lock), so the next load can't unload the model first; it costs that line one
  per-process probe (a second or two on Windows), once per load. Slice 4's GPU half (2026-10-16)
  found the two ways it failed, both in a render that loads the next persona's model at once:
  the after-line reading ran in the background, found the slot given to the next model and
  dropped the price (Qwen3-TTS Base 1.7B: none after three lines); and a line's background
  probe that landed while the same engine's next model was loading (Chatterbox Multilingual →
  Turbo) read the shared process after Multilingual had left — 105 MB, the CUDA process's own
  share (typeperf's `Dedicated Usage` for an idle `audiocpp_server.exe`: 110,206,976 bytes) —
  passed the re-check, which compared only the engine's id, and wrote it as Multilingual's price
  with the device the next load had already cleared (`backend` ""), a row `_priceMb` never
  reads. A reading now counts only for the same slot with its load confirmed
  (`manager._settled`). The whole card's difference, where the process can't be read, counts
  from a reading taken after the slot's previous model has left and drained (was: before it —
  Qwen3 Base's load logged "2574 -> 2068 MB" with VoiceDesign still loaded). Per-process card
  memory IS read on this machine (typeperf; nvidia-smi says N/A under WDDM): Chatterbox
  Multilingual's first line, with nothing loaded after it, priced 2,595 MB on the card
  (2026-10-16 06:32 UTC). (was: the background probe and the engine-id re-check — until
  2026-10-16.) — *code + tests + the user's database, 2026-10-16* · `manager.js`
  `_priceFirstLine`, `_settled`, `load`; `engine_vram_wiring.test.js`.
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
- Speech's card margin is its own, 512 MB (`speech_runtime.card_margin_mb`), for Auto's
  placement, the card's admission and `/v1/engines/vram`; the system-memory check keeps the kit's
  1,024 MB `safety_margin_mb`, as the AI model's layer split does. A model pinned to GPU is held
  to no margin and never refused for memory — the admission makes what room it can and the load
  goes on, its reason saying it may spill, or that it did (decided 2026-10-16, the user: "do 1
  and 2", after BreezeTTS 2 — measured 7.3 GB at guidance 4 — was refused on an 8 GB card even
  pinned: 7.4 GB + 1 GB against about 7.7 GB free). (was: the kit's 1,024 MB for both, and a pin
  refused like Auto — until 2026-10-16.) — *code + tests, 2026-10-16* · `manager.js`
  `_cardMarginMb`, `_admitMemory`; `engine_vram_wiring.test.js`.
- An unmeasured model whose estimate fits the card only without the margin (Qwen3-TTS Base 1.7B's
  8 GB on an 8 GB card), its files fitting with it, says the card-first words; it is placed as
  before — its estimate, not its files, is the size weighed, so what other programs hold is not
  checked. A model too big by its files says their size in `_gb`'s words (9.5, 12). (was: no
  reason after "Loads on the graphics card", and the files rounded whole — "10 GB" beside the
  row's "9.5 GB" — until 2026-10-16.) — *code + tests, 2026-10-16* · `manager.js` `placementFor`;
  `cpu_placement.test.js`; TASKS "Slice 5's findings: what each one gets" 3.

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
  language or `en` — until 2026-10-08, clean-room gaps 12 and 13, my rec applied under the
  2026-10-08 go (not shown).)
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
- **A line's cached audio is after its effects**: `renderLine` keys the render cache with the
  persona's chain (`_inputsKey(…, effects)`, `server/src/render_core.js:692`) and stores what the
  chain made, so the same line with and without a chain is two renders — on a model that
  samples, two different takes. The chain editor's A / B holds one dry take on the server and
  puts the chain on it instead (`POST /v1/effects/apply`, plan 2026-10-09 §4). — *code,
  2026-10-09*.

---

## 4 · The app's view of the AI model

**Records:** TASKS "The header and Script hear an AI-model load made anywhere" (2026-10-05).

- The kit keeps ONE shared list of the built-in runner's models (`useRunnerModels`, exported
  with `refreshRunnerModels`): each model's status — `loaded`, `loading`, `disk`, `available`,
  `error`. AI Settings' catalog reads it and refreshes it after its own Load and Unload; it polls
  itself only while a model is `loading`. — *code, 2026-10-05* ·
  `../just-core/packages/ui/src/composables/useRunnerModels.js` (`refresh`, `_startPoll`),
  `components/LuModelCatalog.vue` (`unloadModel`).
- The kit's LLM engine setup loads through its own task and re-reads that list only after its
  speed measure succeeds; its host hook — `installLlmUi`'s `onQuickSetupApplied({ modelId })` since
  the i18n plan's step B (2026-10-12) — fires the moment the load is done. JustVoice dispatches
  `jv:health-refresh` from it. — *code, 2026-10-05* · kit `views/QuickSetup.vue` (`finishApply`,
  `measureAfterApply`); `src/boot/jv.js`.
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
  (`speaker_discovery` / `speaker_attribution`, `meta.run` — Discover's was
  `speaker_identification`, a name the server never had, until 2026-10-16, §10.19). The kit lists tasks oldest
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
  that crashed. Fixed in both languages 2026-10-08 (no go recorded; wave D's FINDING asked for
  one; the 400s and their words kept by the user's word on 2026-10-13, the narrowings review
  K10): each is a 400 that names
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
  Python's middlewares — until 2026-10-08, clean-room gap 11, my rec applied under the
  2026-10-08 go (not shown).)
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
  (`voice_preview_api.markSent`). cachetools 7.1.7's TTLCache was ported in
  `voice_preview_api.TTLCache` (a TTL runs from the last set; `get` promotes; `in` does not)
  until 2026-10-13; the `lru-cache` package (`max` + `ttl`) replaced it with the same behaviour
  (its `get` updates recency, `has` doesn't, `ttl` counts from `set` — `updateAgeOnGet` is off
  by default; *code*, lru-cache 11.5.3, `server/tests/voice_preview_lru.test.js`).
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
    wait, … Sarah") as clean-room gap 2 has it (my rec applied under the 2026-10-08 go, not
    shown), the old one removed them; both still drop "um"/"uh" — gemma does
    that on its own. — *measured, 2026-10-08* · scratchpad harness `refine-compare/`:
    `createApp(<data>)` + the provider registry from the database (`loadFromConfigs`, what
    `seedWorkspace` step 7 does) + each module's `refineTranscript`, which returns
    `[text, model]`.
  - The UI is served at `/`: `/ui/` answers 307 to `/` and drops the query, so the dictation
    window is `/?view=dictate`. At rest it renders nothing (`pages/DictatePage.vue`: the pill
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

**The kit's changes of 2026-10-19/20 as JustVoice meets them** (*code + measured 2026-10-20*, on
kit 609bbb9; the kit's half and its reviews are the kit's register §2 "The servers' guards,
attacked" and the sections after it):

- The kit's bearerAuth refuses a request from this computer whose Host is not this computer's own
  name (localhost, `*.localhost`, an IP literal, `os.hostname()`) or one the app allows: 403
  `host-not-allowed`, *"this server answers to this computer's own names, not testserver"*. It made
  `csrf.test.js` "same_origin_mutation_allowed" fail (it sent `host: testserver`); the same post
  with `host: 127.0.0.1` answers 201. JustVoice now reads `JUSTVOICE_ALLOWED_HOSTS` (the template's
  `<APP>_ALLOWED_HOSTS`, `server/src/app.js`), and the suites set it to `testserver`
  (`server/tests/helpers.js`). — *measured, 2026-10-20* · a scratch vitest on `appClient`.
- Windows: a file open inside an asset folder makes the gated restore's rename fail, and the
  restore answers 409 `files-in-use` with nothing changed — a take's `createReadStream`, read a
  little and paused, does it. Closed first (`storage/open_files.js`, the restore's `beforeReplace`
  in `data_admin.js`), the same restore answers 200. — *measured, 2026-10-20* · a scratch vitest
  against `server/tests/restore_gate.test.js`'s case with a plain stream, then the test itself.
- What holds files in the asset folders: the two audio routes' read streams
  (`api/takes_api.js`, `api/captures_api.js`); the book runs, render jobs and export jobs (ffmpeg
  reads the takes) in the background; the speech runtime. A capture upload spools to the OS's temp
  folder and is copied in inside its request, which the gate waits for. Every other audio answer
  is a buffer. — *code, 2026-10-20* (`grep createReadStream|createWriteStream|openSync`).
- Without a `gate` the kit keeps the old restore (tables, then each folder copied over), so a
  restore during playback worked; with it the restore is all or nothing, and the gate refuses
  every other write with 503 while it runs (the template's posture). — *code, the kit's
  `platform/data_api.js` and `maintenance.js`*.
- The template's macOS launcher picks the first file in `Contents/MacOS`; JustVoice puts
  `audiocpp_dsp` there too, so its launcher reads `CFBundleExecutable` from `Info.plist` instead
  (`build/launcher/justvoice-server`). — *code, 2026-10-20* (`quasar.config.js` mac
  `extraFiles`).
- electron-builder 26.15.3 (`src-electron`) takes `toolsets.appimage` `1.0.0`–`1.0.3`; the
  template sets `1.0.3`, the static runtime that needs no FUSE 2 (Ubuntu 24.04 installs none).
  Unchecked for JustVoice until a release runs the `linux-user` job. — *code* (`app-builder-lib`
  `scheme.json`).
- Health names the data folder (`dataDir`, as JustWrite's and the template's do): the release's
  `start-packaged.js --default-data` compares the window's and the headless server's. — *code*.
- JustVoice's dark tokens before the kit's fifteenth review (WCAG contrast, sRGB from OKLCH):
  white on the dark accent 2.83:1 (#1a1a1a 6.15:1); JustVoice had no dark `--danger`, so its
  danger buttons were the light red — white 5.95:1, #1a1a1a 2.92:1 (the template's dark red
  0.660 0.130: #1a1a1a 5.30:1); `--danger-ink` 1.64:1 on the dark surface (the template's 7.92:1);
  `--info-ink` 3.12:1 (8.80:1). `--border-field` #8a867f on JustVoice's own `--bg` #f6f5f1 is
  3.32:1 (3.21 on `--surface-3`). So the dark `--on-accent` comes with the dark `--danger`. JustVoice
  had no dark success either: near-black on the light success fill 3.56:1 (the template's dark
  success 6.15:1). The toasts on JustVoice's pairs: normal 17.40 / 13.17, success 6.30 / 6.92,
  warning (the appearance engine's pair) 8.49 / 9.53, error 8.11 / 7.20, light / dark. — *measured,
  2026-10-20* (a node script).
- **JustVoice's own recursive `rmSync` emptied a linked folder's target** (Electron 44.7, Node 24):
  a junction to an outside folder inside the speech cache, then **Clear** speech models — the
  outside file was gone; the same inside `generations/`, then the factory reset — gone. On
  `fs.promises.rm` both keep it (`server/tests/junction_removers.test.js`, run against the old code
  first: 2 failed, then 2 passed). Changed: the reset's folders (`data_admin.js`), the speech cache
  and a model's files (`api/models_api.js`), an old runtime build (`engines/manager.js`), the eSpeak
  and Japanese dictionary installs. Left on `rmSync`: the OS-temp spools (captures, MCP, exports)
  and a voice's own folder (`storage/voices.js`), which the app makes itself. — *measured,
  2026-10-20*.
- `@internationalized/number` (the kit's UiNumber, a peer since kit 70e6df1) was not in
  JustVoice's packages: in dev it resolved from the kit checkout's own `packages/ui/node_modules`;
  the release installs only `packages/core`. — *code, 2026-10-20*.

---

## 7 · Where an AI task shows

- Script never adds speakers (since 2026-10-06) — they come from the import, Discover's ＋ Add,
  or Cast's ＋ Add for someone Discover missed (and Cast's Add Narrator); Cast's ＋ Add stays
  (decided 2026-10-13, the narrowings review C7). Discover's Speakers found is the scans'
  results only. (was: "Only Discover adds speakers" — false: Cast's ＋ Add, Add Narrator and
  imports add speakers too.) A name the second look hears on a line with no speaker, who isn't in the book
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

- Each task's strip is on the page that started it: the kit's `AiTaskStrips` over its
  `useSurfaceTasks`, by feature and by the meta the page stamps; Studio's run banner uses
  `chapterRun.useStepStrip` over the same helper. (was: JustVoice's own `PageTaskStrips.vue` over
  `services/pageTasks.js` until 2026-10-18, when the kit took them in; before 2026-10-05 `App.vue`
  showed every non-inline task at the top of every page.) — *code, 2026-10-18*.
- The kit's corner stack (`AiTaskStack`, under `<LlmUiHosts />`, kit bc34207, 2026-10-18) shows
  each running task that no mounted strip claims. In JustVoice it would have brought back an
  app-wide display: the pages sit in one `<KeepAlive>` keyed by route name (`MainLayout.vue`), so
  a page's strips stay mounted, but inside Studio (`StudioPage.vue`) Cast and Export are plain
  `v-if` (Discover, Script and Render are kept alive), so a Smart-assign or an export you left
  moved to the corner; a persona's Compose showed there on another persona's page (the strip's
  meta is the persona); and the book run's task (`bookRun.followBookRun`, no strip: its card
  draws the run) showed in the corner on every page, its own Overview included. So JustVoice
  mounts `<LlmUiHosts :task-stack="false" />` (kit option added 2026-10-18), keeping the
  2026-10-05 rule. — *code, 2026-10-18*.
- The kit's task panel (the ✨ button) lists every task whatever `inline` says; `inline` only
  told a global stack to skip a task (`just-core/packages/ui/src/stores/aiTasks.js`, start()).
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
  the loaded one if it is this family; else, among the family's variants on disk, the engine's
  default if it is one of them, else the one sharing most of its size and precision (catalog
  order breaks ties); nothing of the family on disk → the same pick among all of the family's
  variants, and the load fetches it. So a default that isn't downloaded speaks only once a load
  fetches it: until then a downloaded version of the family speaks, as a loaded one keeps
  speaking after the default changes. Kept so (2026-10-13, the narrowings review C5); since then
  the persona page shows Load for the chosen version whenever what speaks differs from it, not
  only while another is loaded. The persona page shows it since 2026-10-05:
  `GET /v1/voices/{id}/model-version` (`voice_model.versionsOf` — the render's own pick, the
  loaded one, the default, the family's versions with `on_disk`). — *code, 2026-10-13* ·
  `voice_model.js` `variantForModel`. (was: "else the engine's default if it is, else an
  installed one" — the default wins only when it is on disk.)
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
  `seed_vc` GPL-3.0 weights (its GitHub repo archived 2025-11-21 — *agent, 2026-10-11*) ·
  `vevo2` CC-BY-NC-ND-4.0. · `../audio.cpp/docs/audio_tools.md`,
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
  child, older, …), paralinguistics, denoise, speed — 14 emotions, in passes, on any audio
  including other systems' TTS; 3B; ~12 GB nominal, **6–8 GB in its memory-efficient mode, 8–10
  GB as AWQ 4-bit** (research agents, 2026-10-11; was: "AWQ ~6–8 GB" until 2026-10-11);
  Python/torch only, not in audio.cpp (our base or upstream main). Code Apache-2.0; its weights
  state no licence. **Vendor vs independent:** StepFun reports emotion accuracy on commercial TTS
  voices rising 56–63 → 68–72% after one pass and 72–75% after three, with speaker similarity
  after editing not reported; independent tests put its edits near chance — 20.9% on ESD where
  chance is 20% (arXiv 2603.09120), 23.08% on doteBench's neutral set against 20.43% unedited
  (§10.9). · `github.com/stepfun-ai/Step-Audio-EditX`.
- RAVE is CC-BY-NC-4.0 (its LICENSE); DDSP is Apache-2.0 on TensorFlow; Beatrice v2 forbids
  commercial use (a secondary source).
- LLM2Fx (Sony AI and KAIST, WASPAA 2025, arXiv 2505.20770): LLMs predict EQ and reverb
  parameters from a text description zero-shot, better with DSP features, DSP code and
  few-shot examples in the prompt.

**Reuse instead of build — engines, plugin hosting, ffmpeg, voice changers** (*agent,
2026-10-11*; two research agents, one of which measured on this machine with a real take looped
to 471 s, 24 kHz mono, one thread):

- **The app does not ship ffmpeg.** `mastering.js:82-84` and `export_audiobook.js:188-189` find it
  on PATH (`hardware.which`), `system_info.js:105-115` reports `bundled: false`, and
  `docs/troubleshooting.md:10` asks users to install it. This machine's is gyan.dev 8.1.1
  "full_build" (`--enable-gpl --enable-version3`, so GPLv3; librubberband and ladspa, no lv2).
  Mastering needs only LGPL filters. BtbN/FFmpeg-Builds ships win64/winarm64/linux64/linuxarm64 in
  `gpl` and `lgpl` variants (n8.1 win64 lgpl 162 MB), no macOS. (was, in the session's answer of
  2026-10-11: "the app already ships ffmpeg for mastering" — wrong.)
- **ffmpeg as a character-voice layer:** no formant shift without a GPL build (`rubberband` needs
  `--enable-librubberband`, a GPL external library; `af_rubberband.c` never calls Rubber Band's
  formant-scale call — a Size workaround `asetrate=sr*0.8,aresample,rubberband=pitch=1.25:
  tempo=1.25:formant=preserved` ran at 121× real time, GPL only); no vocoder and no pitch-track
  editing; textures are covered (`tremolo` as ring mod above 20 Hz, `aeval` ring mod, `afreqshift`,
  `afftfilt` robot 232× / whisper 49×, vibrato, chorus, flanger, phaser, `acrusher`, `afir`).
  Measured: a texture chain at 744× real time; our `audiocpp_dsp` Signalsmith pitch −5 at 120–126×,
  level with rubberband; **each ffmpeg process costs 261–285 ms to start** on a 5 s clip; outputs
  byte-identical across runs on one build, but **lengths drift** (+20 ms, +61 ms, −15 ms), against
  our rule that every effect returns its input's length.
- **Complete engines:** only **Csound** (LGPL-2.1) has formant shift and pitch-with-formants built
  in (`pvswarp`, `pvscale kkeepform`); Faust (compiler LGPL with an exception letting generated code
  take our licence; 2 library functions GPL-3) generates C++ for vocoder, wah, distortion, flanger,
  reverbs but has no formant function; JUCE 9 (AGPLv3 or its EULA — free under US$20k revenue) and
  Tracktion Engine (GPL-3 or commercial) have no formant processor; Cmajor (GPLv3 or commercial;
  generated C++ is ours); miniaudio (public domain / MIT-0) has a voclib vocoder node; LabSound
  (BSD-2, last release 2023), Elementary (MIT, stale), Pedalboard and DawDreamer (GPL-3, Python),
  SoX (GPL-2), STK (MIT-style), CDP8 (LGPL, formant and voice programs).
- **Plugin hosting is licence-clean now:** the **VST3 SDK is MIT since 3.8.0 (2025-10-20)** ("Licensing
  under GPLv3 and the Steinberg proprietary license is no longer available"; hosting code in
  `public.sdk/source/vst/hosting`), CLAP is MIT (`clap-helpers`), LV2's lilv is ISC (`lv2apply.c`
  applies a plugin to a file), LADSPA's header LGPL. But the voice plugins worth having are GPL
  (Surge XT's Vocoder, RingModulator, FrequencyShifter, Treemonster) or Linux-only (Calf, x42 fat1,
  Autotalent); LSP (LGPL) has no pitch, formant or vocoder; **no permissively licensed formant
  plugin was found**. Per the GPL FAQ, a host that loads a GPL plugin in-process forms one program;
  a separate host process, or loading only plugins the user installed, keeps them apart.
- **Permissive code to take into `audiocpp_dsp`:** Signalsmith Basics (MIT; frequency shifter,
  crunch, chorus, dynamics); **mda by Paul Kellett, original code** (MIT-or-GPLv2 per
  `readme.license`; also `elk-audio/mda-vst2`, MIT) — TalkBox (the talking-beast core), Vocoder,
  VocInput, SubSynth (octave down), RingMod, Degrade (bitcrush), Tracker (the ports mda-lv2 and
  mda-vst3 are GPL-3); miniaudio's voclib vocoder (MIT-0); OpenAL Soft's `alc/effects/vmorpher.cpp`
  (BSD-3 inside an LGPL library — a vowel morpher for creature mouths). Godot's and SoLoud's effects
  add nothing over Airwindows. Design references: Praat's "Change gender" (formant ratio, pitch
  median, **pitch range factor**, duration factor — the algorithm, GPL code not reused); Krotos
  Dehumaniser 2 (ten modules, two of each, series or parallel; a sample trigger with 100+ animal
  recordings).
- **The agents' verdict:** keep the character effects in our own DSP with these libraries; no
  engine; ffmpeg stays for mastering; plugin hosting later as an opt-in "use your own VST3/CLAP
  plugins". First experiment proposed: a Size A/B at −5/+4 semitones — Signalsmith
  `setFormantSemitones` against Csound `pvscale`/`pvswarp` (reference only) and WORLD — then port
  `mdaTalkBox`.

---

## 9 · Voice training on the speech runtime

The research for gap 5 — training rebuilt on audio.cpp, no Python (2026-10-09). The reading and the
open questions: [`2026-10-09-voice-training-findings.md`](../plans/2026-10-09-voice-training-findings.md).
Paths: AC = our fork `../audio.cpp`, G = its ggml `AC/external/ggml`, OLD = `git show
1c7398d^:server/justvoice/` (the training removed in the switch). Found by a research agent
2026-10-09, read-only; the optimizer reset, the LoRA loader and Qwen3-TTS's missing LoRA option
re-read by the session.

**What the old training was** (*git*):
- It trained Qwen3-TTS Base, adapted from Alexandria (MIT): PEFT on the talker, targets
  q/k/v/o, rank 32, alpha 128, 20 epochs, learning rate 5e-6, batch 1 with 8-step accumulation,
  AdamW (weight decay 0.01), bf16 on CUDA, gradient clipping — OLD `engines/qwen3/train_lora.py`
  :57-62, :381, :420-437. Loss: the talker's cross-entropy on codebook 0 plus 0.3 × the code
  predictor's (:497).
- A Chatterbox trainer (from gokhaneraslan, Apache-2.0) existed too; its header says no adapter
  it made was ever listened to (OLD `engines/chatterbox/train_lora.py`:3-30).
- Data: each clip through the model's own speech tokenizer (:186), one reference clip for the
  x-vector (:123-148), clips over 30 s dropped (:65, :171); the preparer took Whisper transcripts at
  confidence ≥ 0.85 and SNR ≥ 25 dB (plan 2026-08-20 :151). Alexandria's guidance: 15–30 minutes for
  a premium voice (github.com/Finrandojin/alexandria-audiobook `lora.md`:57).
- A real training run end to end was never verified, so its time and memory were never measured
  (plan 2026-08-21 :129). At render time the adapter went on the talker through
  `PeftModel.from_pretrained` with an x-vector-only prompt (OLD `engines/qwen3/engine.py`:222-256).

**ggml's training support** (*code*, *web*):
- `ggml-opt`: losses mean, sum, cross-entropy, MSE; optimizers AdamW and SGD only; no gradient
  clipping; the cross-entropy op takes no mask (G `include/ggml-opt.h`:31-34, :77-96;
  `include/ggml.h`:2960).
- Backward passes exist for MUL_MAT, RMS_NORM, SOFT_MAX (not its mask), ROPE (with multi-section),
  GET_ROWS, SILU, split SwiGLU, CROSS_ENTROPY_LOSS, IM2COL and the view ops; none for
  FLASH_ATTN_EXT, NORM (LayerNorm), GELU, CONCAT, PAD, CONV_TRANSPOSE_1D, SET_ROWS or fused SwiGLU —
  they abort (G `src/ggml.c`:7144-7623; upstream the same set).
- Backends: CPU and CUDA run the backward ops; Vulkan runs most; Metal has only the optimizer
  steps, so on a Mac the backward pass falls to the CPU (llama.cpp `docs/ops.md`, 2026-10-09).
- The gradient through a frozen weight is `OUT_PROD`: CUDA takes only F32 weights, the CPU F32 or
  quantized but not F16/BF16 (G `src/ggml-cuda/ggml-cuda.cu`:5643-5644, `src/ggml-cpu/ggml-cpu.cpp`
  :468-470, `ops.cpp`:4493-4497). Our ggml copy lacks upstream's Vulkan OUT_PROD (upstream
  f955e394, #23997, 2026-07-15).
- A bug in our copy, read not reproduced: with dynamic graphs the gradient accumulators are zeroed
  only at first allocation — the per-step reset gets a graph pointer the previous step set to null
  (G `src/ggml-opt.cpp`:492-498, :727-729, :828-833). llama.cpp #29364 and #30170 describe it; both
  closed unmerged.
- llama.cpp has full fine-tuning (#10544, merged 2025-05-12: "CPU training seems to work, other
  backends are missing support for some GGML ops"; its README: F32 models, "very much WIP"). No
  LoRA trainer is merged — #20453, #22705, #26794 closed unmerged; #18499: "I don't think we
  currently have a maintainer for llama-finetune".

**audio.cpp and LoRA** (*code*, *git*, *web*):
- No training code in the fork: no `ggml_opt` or backward pass in AC `src`, `include`, `tools`.
- Loading exists: `make_lora_tensor_source` merges B·A into the base weights at load time (AC
  `include/engine/framework/assets/lora_tensor_source.h`:31-51; upstream bd805760, 2026-09-15),
  used by VibeVoice (reads PEFT's `adapter_model.safetensors` + `adapter_config.json`, AC
  `src/models/vibevoice/lora.cpp`) and YuE2. Qwen3-TTS has no LoRA option (nothing in AC
  `src/models/qwen3_tts`); it can load F32 weights (`qwen3_tts.weight_type`, `session.cpp`:173-181).
  So rendering a trained voice is now a wiring job, not "merge and convert" (corrects the switch
  plan's note, 2026-10-01 §5 item 5).
- Upstream: LoRA hot-swapping is "not a near-term priority" (#610); no issue or PR about training.
- The talker (28 layers, hidden 2048, GQA 16/8, M-RoPE, a 5-layer code predictor —
  huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base config.json) is built from audio.cpp's own
  `CausalDecoderModule` (AC `src/models/qwen3_tts/talker.cpp`:229-283). Its fast paths have no
  backward pass — flash attention, the KV cache's set_rows, fused SwiGLU, `ggml_round_bf16`; plain
  alternatives exist (ManualRepeat attention, split SwiGLU — `decoder.h`:15-20, `decoder.cpp`:489-491),
  not verified end to end.

**Elsewhere** (*web*):
- No ggml TTS project that trains was found (not proven absent). QVAC Fabric
  (github.com/tetherto/qvac-fabric-llm.cpp, a llama.cpp fork) trains LoRA for Qwen3/Gemma3 LLMs
  with backward kernels on Vulkan, Metal and CUDA — not upstreamed; Qwen3-1.7B Q8, one epoch: 5.5 min
  on an RTX 4090, 40 min on an M3 Pro (huggingface.co/blog/qvac/fabric-llm-finetune).
- Baseten fine-tuned Qwen3-TTS on 1.5 h of one speaker; it "didn't materially beat zero-shot on
  similarity or MOS-style quality"; an x-vector averaged over 64 clips helped
  (baseten.co/blog/fine-tuning-qwen3-tts-for-high-quality-voice-cloning). Qwen's own recipe is full
  fine-tuning into a named speaker, not LoRA (github.com/QwenLM/Qwen3-TTS `finetuning/README.md`).

**Cloning, measured** (2026-10-10, through the app on CUDA, Qwen3-TTS Base 1.7B 8-bit; the run and
its page: plan 2026-10-09 voice-training findings, "The measurement — results"):
- Exact digital silence inside a Qwen3-TTS Base reference makes the model run away — its length
  does not: one sentence ("The quick brown fox…"), x-vector only unless said: a 26.6 s reference (Kokoro
  speaking known text) → 2.7 s of audio; the same at 22.05 kHz → 3.2 s; a 52.9 s one → 2.8 s, and
  in ICL mode (with its words) 2.6 s; the 26.6 s one cut into four by three 0.25 s gaps of exact
  digital silence → still running after 240 s; the same gaps filled with ±2 LSB of noise
  (about −84 dBFS) → 2.8 s. The LJSpeech references that ran away (32 s → 655 s of audio in 468 s;
  494 s never finished) were clips joined by 0.25 s of digital silence; 2 clips (one gap, 19 s)
  worked. The speaker mel floors its log (`mel_spectrogram_frontend.cpp` `log_floor`), so it is not
  a −infinity there; the mechanism is not found. — *measured*. (was: "a pooled x-vector from a long
  reference makes the model run away" until 2026-10-10.) The app now fills such stretches before a
  Qwen3-TTS Base reference reaches the runtime (`slot.guardedReference`, 2026-10-11): the gapped
  27 s reference speaks a sentence in 2.7 s (ICL) and 3.0 s (x-vector only). — *measured*.
- A runaway line records a speech "peak" measurement of its own — 6,235 and 6,255 MB for Qwen3-TTS
  Base, against ~2.8 GB normally — and the admission prices a model at its largest peak
  (`engines/manager.js` `_priceMb`), which then left the model unloadable on the 8 GB card. — *measured*.
  Since 2026-10-11 a process that ran such a line (audio past 0.5 s a character and 30 s) no longer
  saves peaks (`manager._noteRunaway` / `_prices`); the memory it holds is still booked.
- On 20 LJSpeech lines, word errors (Qwen3-ASR, 336 words): real 1, clip with words 0, clip x-vector
  only 1, 2-clip pooled x-vector 1. — *measured*.
- A request the app cancels (client gone) does not stop the runtime's work: the next request waits
  until the runaway line ends. — *measured*.

**LoRA training in Python, measured** (2026-10-10, RTX 2070 SUPER, the findings' "The LoRA
experiment"): Qwen3-TTS Base 1.7B with the old trainer (Alexandria's) in bf16 — emulated on Turing
(`torch.cuda.is_bf16_supported(including_emulation=False)` is False) — trains a rank-64 q/k/v/o
LoRA (29.0 M parameters) on 120 clips (14 min) in 6.3 GB at ~0.6 s a step: 3 epochs in 201 s
(loss 4.42 → 4.16 → 3.90). The trained voice's lines run 7.06 s on average against her 6.96 s;
untrained 7.71 s. PyTorch inference ~20 s a line here. — *measured*. By ear (the user, 2026-10-10):
all three Python takes — untrained, trained 2 and 3 rounds — sounded worse than the app's audio.cpp
clone of round 1.

**Memory, by arithmetic, unmeasured:** the 1.7B talker is ~1.41B parameters — ~5.6 GB as F32,
2.8 GB as BF16; a rank-32 q/k/v/o adapter ~12.8M parameters, ~200 MB with gradients and AdamW
state; a 30 s clip is 360 frames at 12 Hz. Training on CUDA needs the frozen talker in F32 (CUDA's
OUT_PROD), tight for the 1.7B on an 8 GB card, more plausible for the 0.6B.

---

## 10 · One-click audiobook, frontier AI and the market

The decision these serve: TASKS "One-click audiobook: one pipeline in JV, run by its own AI or by
Claude Code" (2026-10-10). **Records:**
[`2026-10-11-one-click-audiobook.md`](../plans/2026-10-11-one-click-audiobook.md) — the plan, its
steps, recipes and slices, and §13 what the research found that bears on it.

### 10.1 What the pipeline already has

- The AI steps that exist: Analyze (speaker attribution and its second look), Smart-assign
  (speaker → persona), Compose and Rewrite — `docs/ai-features.md` §The features. — *code,
  2026-10-10*.
- A line can carry direction, stored and rendered: Style Instructions on a model that takes
  written direction, Emotion where the model has one, and Chatterbox Turbo's 19 tags (emotion,
  register, non-verbal) — `server/src/engines/capability_details.js:225`. — *code, 2026-10-10* ·
  TASKS-history "Render: a line can change what its model takes" (built 2026-10-06).
- What each model can do with a character voice: Qwen3 CustomVoice takes direction, can't clone
  (`capability_details.js:285`); Qwen3 Base clones and silently drops direction (`:298`); Qwen3
  VoiceDesign makes a voice from words and takes direction (`:318`); VoxCPM2 clones, designs and
  takes direction (`:339`); Chatterbox Turbo clones and takes tags, English only (`:257`). — *code,
  2026-10-10*.
- A voice made from words is not stable across pieces (§1.3, by ear 2026-10-04), so a character
  voice designed from the book has to be designed once, then cloned from a rendered clip. —
  *record* · §1.3.
- A voice from a description: `POST /v1/voices/design` (`server/src/api/voices_api.js:355`). —
  *code, 2026-10-10*.
- The render cache keys a line on engine, voice, text, language, seed, delivery and effects, so
  only changed lines render again (`server/src/render_core.js:692`). — *code, 2026-10-10*.
- JV's MCP server has four tools — speak, list_voices, list_personas, transcribe
  (`server/src/mcp/tools.js:4`) — on the official SDK's `McpServer` over Streamable HTTP
  (`server/src/mcp/server.js:27`). — *code, 2026-10-10*.
- The kit already speaks to Claude with an API key (`../just-core/packages/core/src/llm/anthropic.js`),
  routed per feature in AI Settings → Routing by feature. It doesn't know the 5.5 models yet —
  kit RESEARCH §7. — *code, 2026-10-10*.
- Speaker attribution's Auto picks its route by parameter count alone (Direct from 14 B, else
  Guided — `server/src/extraction/pipeline.js:370`), and reads an unknown size as 0
  (`:326`). A cloud model publishes no size, so `claude-opus-5-5`, `claude-sonnet-5-5` and
  `gpt-6.1-sol` all read as 0 B and get Guided — the small-model recipe (worked examples) with
  its stricter confidence floor, 0.7 against Direct's 0.5 (`:285`); `gemma-4-26b-a4b-qat` reads
  26 B. The two routes differ only in the examples; piece size, thinking (off on both), the cast
  list and the deterministic helpers are shared. — *code, run 2026-10-10* (`modelSizeB` on the
  ids, no database) · `docs/ai-features.md` §Speaker attribution.
- Built since 2026-10-16, each once listed in IDEAS (`docs/dev/IDEAS.md:309`): the direction step
  ("LLM emotion-tag insertion", §10.18), the persona-generation loop (description → design →
  cast, the voices step, §10.20) and the take check (transcribe, compare, re-render; §10.11).
  — *code, 2026-10-16* (was: all three not built and listed in IDEAS — until 2026-10-16).
- Where each step from a book file to an audiobook lives, with its route and what it writes:
  `docs/dev/code-map.md` §7a. The facts a one-click run turns on: — *code, 2026-10-11*, the ✓
  rows of §7a re-read by hand, the rest *agent*.
  - A designed voice can already be frozen into a clone: an audition (`POST /v1/voices/preview`,
    held 10 minutes) saved with `POST /v1/voices/preview/:preview_id/save` becomes the voice's
    `ref.wav` ("THE freeze bridge"). Since 2026-10-16 both routes' work is a function the
    voices step calls too: `previewVoice` and `savePreview` (`api/voice_preview_api.js:406, 438`;
    the bridge itself `:519`). `POST /v1/voices/design` alone keeps no clip
    (`api/voices_api.js:355`).
  - A line's direction is `blocks.direction`; its emotion, tag and knobs per model are
    `blocks.metadata_json.line_models` (`line_takes.js:60`), set one line at a time with `PATCH
    /v1/blocks/:block_id` (`api/projects_api.js:1000`). Analyze never writes them.
  - Smart-assign casts its matches on the server when asked (`apply: true`;
    `applyAssignments`, `api/smart_assign_api.js:155`, never over a narrator's persona, and with
    `onlyUncast` never over any); Cast's ✨ Smart-assign asks (`src/components/StudioCast.vue:505`),
    ＋ New persona — matched to voices — doesn't. — *code, 2026-10-16* (was: "returns matches and
    writes nothing; the renderer casts each one" — until 2026-10-16, slice 3).
  - Only render jobs (persistent, resumed after a restart) and export jobs (in memory) run on the
    server; Analyze, Discover and the chapter run are driven from the window
    (`src/services/chapterRun.js`), and a window closed without keep-running stops them.
- Render speed on the RTX 2070 SUPER 8 GB: Qwen3 CustomVoice 1.7B 2.0× real time, Kokoro 11.9×
  (§1.3), so a 10-hour book is about 5 hours on Qwen3 and under an hour on Kokoro. — *arithmetic
  on §1.3's measurements*.

### 10.2 Claude: subscriptions, Claude Code and API prices

- Anthropic's terms: "Anthropic does not permit third-party developers to offer Claude.ai login
  into their own applications, or to route requests through Free, Pro, or Max plan credentials on
  behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai
  credentials or session tokens." — *web, 2026-10-10* ·
  [code.claude.com/docs/en/legal-and-compliance](https://code.claude.com/docs/en/legal-and-compliance).
- The same page does not stop "an end user from signing in to the unmodified Claude Code binary
  with their own Claude subscription"; running Claude Code inside a product requires the
  Commercial Terms, an unmodified binary, and each end user's own credentials. — *web, 2026-10-10*
  · same page.
- "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code
  and the Agent SDK." — *web, 2026-10-10* · same page.
- The Agent SDK page: "Unless previously approved, Anthropic does not allow third party developers
  to offer claude.ai login or rate limits for their products, including agents built on the Claude
  Agent SDK." — *web, 2026-10-10* ·
  [code.claude.com/docs/en/agent-sdk/overview](https://code.claude.com/docs/en/agent-sdk/overview).
- `claude -p` loads the project's `.mcp.json` and skills like an interactive session; with
  `--bare` it never reads the subscription login and needs an API key. — *web, 2026-10-10* ·
  [code.claude.com/docs/en/headless](https://code.claude.com/docs/en/headless).
- A Claude Code skill lives at `.claude/skills/<name>/SKILL.md`; inside a plugin it is invoked as
  `/plugin-name:skill-name`. — *web, 2026-10-10* ·
  [code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills).
- API prices per million tokens, input/output: Haiku 5.5 $0.10/$0.50 (prompts up to 100K),
  Sonnet 5.5 $2/$10, Opus 5.5 $4/$20, Fable 5.1 $10/$50; the Batch API is half price; cache reads
  about a tenth. — *record* · the Claude Code `claude-api` skill's model table, cached 2026-10-06.
- GPT-6.1 Sol: model id `gpt-6.1-sol`, $2 in / $10 out per million tokens, about a 1M-token
  context, batch at half price. Gemini 4 Argon is announced ($2/$10 at first, then $4/$20) but not
  on the public API. — *web, 2026-10-10, third-party pages only, not checked against OpenAI or
  Google* · [llmreference.com — GPT-6.1 Sol](https://www.llmreference.com/model/gpt-6.1-sol/openai-api),
  [eesel.ai — Gemini 4 Argon pricing](https://www.eesel.ai/blog/gemini-4-argon-pricing).
- One pass over a 100,000-word book (about 130K tokens), with context, is roughly 350K tokens in
  and 100K out: about $0.10 on Haiku 5.5, $1.70 on Sonnet 5.5, $3.40 on Opus 5.5, half that as a
  batch. — *arithmetic, unmeasured*.
- The whole text side of a one-click run on that book — who speaks and direction in one read
  (~300K in, ~150K out with thinking), character descriptions (~150K in, ~20K out) — about 450K
  in and 170K out: Haiku 5.5 ~$0.15, Sonnet 5.5 ~$2.60, Opus 5.5 ~$5, Fable 5.1 ~$13; half as a
  batch. For scale, AudiobookGen's one-voice price for the same book is about $30 (§10.3). —
  *arithmetic, unmeasured, 2026-10-10*.

### 10.3 The commercial tools, for a comparison

- ElevenLabs Free: 10,000 credits a month (about 10 minutes of speech), Studio limited to 3
  projects, no commercial licence; the commercial licence starts at Starter, $6/month for 30,000
  credits. — *web, 2026-10-10* · [elevenlabs.io/pricing](https://elevenlabs.io/pricing).
  JV already has ElevenLabs as a voice provider (`server/src/engines/tts_providers/elevenlabs.js`).
- ElevenLabs' free credits are "shared across all products" — Studio and the API draw on the same
  10,000. Neither the pricing page nor the API pricing page says whether Free includes API access,
  and neither names a Studio (book project) API; third-party guides say every account, Free
  included, can make an API key. — *web, 2026-10-10* · [elevenlabs.io/pricing](https://elevenlabs.io/pricing),
  [elevenlabs.io/pricing/api](https://elevenlabs.io/pricing/api).
- ACX: "Unauthorized use of text-to-speech, AI, or automated recordings in ACX titles is
  prohibited"; an audiobook "must be narrated by a human unless otherwise authorized". The
  technical limits: RMS −23 to −18 dB, peaks below −3 dB, noise floor at most −60 dB RMS, 1–5 s
  room tone, MP3 192 kbps+ CBR 44.1 kHz. Page updated 2026-04-15. — *web, 2026-10-10* ·
  [help.acx.com — ACX audio submission requirements](https://help.acx.com/s/article/acx-audio-submission-requirements).
  JV's ACX check (`docs/studio.md` §The ACX check) measures those limits; it doesn't make an AI
  title acceptable to ACX.
- **Spotify for Authors accepts digital narration** when "This audiobook uses digital voice
  narration" is ticked (Spotify then adds a line to the description; its help names "Google Play
  Books, ElevenLabs, and more" — whether a self-made local-TTS book counts is not stated). Spec
  ("Metadata & Asset Guide", 11/2024): MP3 ≥192 kbps (CBR preferred) 44.1 kHz/16-bit, or WAV/FLAC;
  **RMS −24 to −14 dB**, noise floor under −60 dB, **head 0.5–1 s, tail 1–5 s**, mono or stereo never
  mixed, no "excessive mouth noises", files ≤120 min, sample ≤5 min. **Voices by INaudio (formerly
  Findaway Voices) takes digital narration only as unmodified packages from Google Play Books,
  ElevenLabs or Spoken Press.** — *agent, 2026-10-11* ·
  support.spotifycdn.com/pdf/SFA%20Metadata_Asset%20Guide_2024.pdf,
  voicessupport.inaudio.com/en/articles/3219456.
- KDP Virtual Voice (Amazon's own route for AI narration): "an invite-only beta for eligible KDP
  eBooks"; "After your eBook is Live, we will complete an eligibility check". — *web, 2026-10-10* ·
  [KDP — Audiobooks with virtual voice eligibility and troubleshooting](https://kdp.amazon.com/en_US/help/topic/GJSXT4GZLP4PL62B).
- Google Play Books auto-narration: free "for a limited time"; needs an EPUB in English, Spanish,
  German, French, Hindi or Brazilian Portuguese offered on Google Play, and the audio rights;
  publishers get 52 %; Google calls dialogue-heavy or emotional titles poor fits. — *web,
  2026-10-10* · [play.google.com/books/publish/autonarrated](https://play.google.com/books/publish/autonarrated).
- Speechify: about 10 minutes of downloadable audio a month on the free plan — a third-party
  review only, undated. — *web, 2026-10-10, not checked against Speechify* ·
  [reedsy.com/blog/speechify-review](https://reedsy.com/blog/speechify-review).
- Speechify's API: a free tier of "50K characters / mo · hard cap", no card; Starter $10/month for
  1M characters. JV already has Speechify as a voice provider (`docs/ai-providers.md`). — *web,
  2026-10-10* · [speechify.ai/pricing](https://speechify.ai/pricing).
- Play.ht: reported shut down on 2025-12-31 after Meta took the team; the reports are secondary
  and disagree on dates. — *web, 2026-10-10, not confirmed* ·
  [infrabase.ai/audio/playht](https://infrabase.ai/audio/playht).
- AudiobookGen: one narrator per book from six voices (the sample names Inworld TTS-2); EPUB,
  PDF (with OCR), DOCX, TXT and Markdown in, MP3 out; "$0.054 per 1,000 characters", "$9.99"
  minimum, no subscription; no free conversion, only free voice previews; no word on ACX. A
  100,000-word book (about 550,000 characters) comes to about $30 — *arithmetic*. — *web,
  2026-10-10* · [audiobookgen.com](https://audiobookgen.com/) (was: "no result in a search —
  its URL is needed" until 2026-10-10).
- Resemble AI's "best AI tool" article (2025-11-20) is Resemble's own marketing and ranks itself
  first; it names a free trial and no prices. — *web, 2026-10-10* ·
  [resemble.ai/resources/best-ai-tool-turns-book-audiobook](https://www.resemble.ai/resources/best-ai-tool-turns-book-audiobook).
- Resemble's pricing page: Flex "$0/mo", "Buy credits as you go", "Platform and API access", "No
  credit card needed to try it"; it names no free credit amount, and its per-second rates are for
  detection and intelligence, not speech. — *web, 2026-10-10* ·
  [resemble.ai/pricing](https://www.resemble.ai/pricing/).

### 10.4 The local baseline on Alice VII–VIII

All measured 2026-10-10 on the RTX 2070 SUPER 8 GB, gemma 26B-A4B (`gemma-4-26b-a4b-qat`), the
headless server on the dev data folder, the live prompts and settings, one run;
`npm run eval:attribution -- --sample alice-in-wonderland`.

- Analyze: 227 of 237 dialogue lines right (96 %), 9 WRONG, 1 blank — chapter VII 142/147 in
  117 s, chapter VIII 85/90 in 75 s, each one piece, Auto's route Direct (floor 0.5). — *measured*.
- By what decided the line: the fixed "said X" rule (`tag`) decided 162 of 237 and got 7 wrong;
  propagation decided 5 and got 2 wrong; the model decided 70 and got 69 right (the one miss a
  blank). So 9 of the 10 misses are the rules', on lines the model never decided. The rule's
  misses: the name after the verb taken as the speaker ("he said, turning to Alice"; "the March
  Hare said to Alice"; "said to the Knave"); "she heard one of them say" read as Alice; "Five and
  Seven said nothing, but looked at Two. Two began" read as Seven; "shouted the Queen in a voice
  of thunder" read as Alice. Propagation gave group lines ("they cried out") and "called out" to
  the nearest speaker. — *measured* · the run's rows, VII D2 D29 D108 D115 D117 and VIII D0 D13
  D14 D28 D56.
- Script's flags caught 8 of the 9 WRONG lines (11 groups, 1 with no wrong line); the miss is
  VII D2, a group line. — *measured*.
- Discover (`POST /v1/extraction/discover-speakers`, no known characters): every speaker in both
  chapters — VII Alice, Hatter, March Hare, Dormouse in 16 s; VIII Alice, Two, Five, Seven, the
  Queen, the King, the White Rabbit, the Cheshire Cat in 18 s. It also listed people who are named
  but never speak, each with 0 lines (Time, Elsie, Lacie, Tillie, the Duchess, the executioner)
  except the silent Knave (1 line), and one heading as a name, "THE KING AND QUEEN OF HEARTS". The
  Queen is "Queen of Hearts" in VII and "the Queen" in VIII — two names for one speaker across
  chapters. —
  *measured*.
- Segmentation reads curly double quotes by counting (`segmentation.js` `curlySpans`): the
  Dormouse's speech with the phrase he quotes inside it is one line (VII D141), and the Hatter's
  song between his open speech and “You know the song, perhaps?” is his (VII D72, D73, D77) —
  chapter VII is 150 lines, the other three keyed books split exactly as before. — *code, run
  2026-10-10* (was: the song came out as narration and only the quoted phrase as a line, VII 147
  lines, until 2026-10-10).
- The "said X" rule takes only "Name said" / "said Name" at the edge of a narration, and
  propagation stops at narration that names someone else or tags a speech of its own
  (`anchors.js`). With no model, against the four keys: it decides 205 of 755 lines, 205 right
  (Alice 156, The Speckled Band 31, The Ninth Facet 11, The Salt-Iron Road 7); the old rule's 9
  wrong on Alice are gone, and on the other three books every keyed line keeps its speaker (a
  few "tag" become "propagated"). The model's prompt never carries the rule's decisions — they
  are applied after it answers (`pipeline.js:722`) — so those three books' model runs can't
  move. — *code, run 2026-10-10* · the scratch scripts' output in this session (was: any name
  within 18 characters of any verb anywhere in the narration, 9 wrong on Alice, until
  2026-10-10).
- Analyze after the fix (506ce81), same machine and model: 240 of 240 right — VII 150/150 in
  123 s, VIII 90/90 in 80 s; the rule decided 138 and propagation 18, all right; gemma 84/84,
  the five group lines answered "unknown". With the rule off (`--no-propagate`): 238/240 in
  167 s, gemma giving the group line "Sh! sh!" to the Hatter and the Dormouse's next line to the
  March Hare. One run each. — *measured, 2026-10-10* · `npm run eval:attribution -- --sample
  alice-in-wonderland [--no-propagate]`.

### 10.5 Direction and voice descriptions, local, one-off prompts

One-off prompts through `POST /v1/ai/run` on `speaker_attribution.direct`'s route (gemma
26B-A4B, JSON mode), the chapter text with its lines marked [D#], nothing saved; scored against
the Alice key's `cues`. Measured 2026-10-10, one run.

- Direction on Alice VII (150 lines; 73 whose text says how they're spoken): 44 of the 73 given
  an emotion or a direction (60 %); of the 24 whose key names one of the nine emotions, 12 the
  same (50 %); of the 77 lines with no cue, 3 marked anyway (4 %). 50 s, 4,250 tokens in, 2,104
  out. — *measured*.
- Of the 29 cue lines missed, 19 are a speaker's second or third line in the same paragraph — the
  cue sits beside the first ("“…,” the Hatter grumbled: “…”" marks the first line, not the
  second); the rest are mostly cues in the narration before the line ("shook his head
  mournfully", "looked at it gloomily"). — *measured*, read off the run's misses.
- A carry, applied to that run's answers with no model (2026-10-11): within a paragraph, a
  speaker's direction goes to their other lines there that got none (forward, then back). Cue
  lines with a direction 44 → 64 of 73 (60 % → 88 %); keyed emotions matching 12 → 15 of 24;
  no-cue lines marked 3 → 4 of 77 (4 % → 5 %). It carried onto 22 lines, 2 of them without a
  cue. — *measured* (post-processing the saved run; speakers from the key, which Analyze matched
  240/240).
- With `think: true` the run came back with the same answer and the same token count, so
  thinking did not engage through this door — not a comparison. — *measured*.
- Voice descriptions for Alice, the Hatter, the March Hare and the Dormouse in 5–12 s, one or two
  sentences each with gender, age, pitch, pace and manner (e.g. the Dormouse: "Male, young, low
  and muffled pitch with a sleepy, drowsy timbre … hoarse, feeble, and slow … mumbling as if
  half-asleep"). Whether they make good voices is for the ear. — *measured*.

### 10.6 Slice 0 — direction on the engines, and the frozen voice

Through the app's own routes on the dev data folder, 2026-10-11, RTX 2070 SUPER 8 GB, one seed (7):
the Hatter designed from gemma's description on Qwen3 VoiceDesign (`POST /v1/voices/preview`, an
8.2 s audition), kept as a VoxCPM2 clone (`…/save`) and copied to Chatterbox Turbo; seven of his
cue lines rendered plain and directed (`POST /v1/generate`); every clip read back with
`POST /v1/transcribe`. The blind listening page: claude.ai/artifact/MnB1Ut3iekQoDtsFDSf4rr.

- **VoxCPM2 speaks the direction when the clone carries its clip's words** ("ultimate cloning"):
  7 of 7 directed lines read back with the direction first — "Sighing, dismayed, two days wrong.",
  "Mournful, heavy-hearted, not I…". With the clip alone ("controllable cloning", a copy made with
  an empty transcript) 0 of 9 — the words come back as written. **The authors say so:** "When
  Hi-Fi mode is enabled, the control instruction is ignored" (usage guide,
  voxcpm.readthedocs.io/en/latest/usage_guide.html, checked 2026-10-11); a maintainer: "style
  control is not supported in Ultimate Cloning mode" (OpenBMB/VoxCPM issue #210, agent-read).
  Upstream builds the text as transcript + target, so the "(…)" sits mid-sequence and is read as
  words (`voxcpm2.py` `_generate`; audio.cpp `generator.cpp:1332-1334`, agent-read). Our fork's
  0acac2b1 is what turns a transcript into Hi-Fi mode; upstream's server gives controllable
  cloning only. (was: "the README documents none for ultimate cloning" — until 2026-10-11.)
  audio.cpp only keeps the
  "(…)" tag on a chunk's front (`../audio.cpp/src/models/voxcpm2/session.cpp:99-145`); the model
  decides whether it is spoken. — *measured* · TASKS FINDING "a VoxCPM2 clone kept with its
  clip's words reads its line direction out loud".
- **Chatterbox Turbo:** 4 of 7 directed clips byte-identical to the plain ones — sad,
  contemptuous and shouted have no Turbo tag (`engines/capability_details.js:237`, the value
  map). — *measured*.
- **Speed once loaded:** VoxCPM2 about 2 s a line, Turbo under 1 s, Qwen3 CustomVoice 1–2.7 s;
  VoxCPM2's first line 17 s with the load. `POST /v1/generate` on a preset Qwen3 voice is refused
  until the engine is loaded (`POST /v1/engines/qwen3/load`); the clone voices loaded on demand.
  — *measured*.
- **dots.tts and FireRedTTS3 are in our build** (`v0.9.0-jv.5`; both loaders in the installed
  server; model files at the pinned `MODEL_REVISION`) **but neither puts direction on a cloned
  voice in one request.** FireRedTTS3 has no style control on a clone at all (Base takes only
  the `clon` task; Instruct's clone prompt is fixed and its `instruction` is overwritten by the
  clip's transcript). dots.tts takes emotion only through its separate Edit model — render the
  take, then re-run that audio with `<emo desc="a happy and excited tone">…</emo>` (doteBench's
  Fig. 1, arXiv 2608.02673; audio.cpp passes the attributes through unchecked,
  `src/models/dots_tts/session.cpp:247-258`; was: `<emo type="sad" level="2">`, documented nowhere
  upstream — until 2026-10-11) (`options.template_name = "edit"`, `/v1/tasks/run`), a second 3 GB
  model; `instructions` is ignored on a plain line. doteBench (by the dots team) puts its emotion
  edits at 33.17% on a neutral set against 20.43% unedited.
  Both refuse any option not in their spec (no temperature, no speed). Sizes (Q8): dots SOAR 2.96
  GB, Edit 2.96 GB; FireRedTTS3 Base 4.18 GB, Instruct 4.15 GB. Licences: dots Apache-2.0 per its
  README (the Edit card's HF tag reads "other"); FireRedTTS3 Apache-2.0 with the README's "solely
  for academic research purposes" line, its issue #12 and HF discussion #7 asking about
  commercial use closed by the asker with no reply (§10.13; was: "unanswered" — until 2026-10-11).
  — *agent, 2026-10-11*, not re-checked · `../audio.cpp/src/models/dots_tts/request.cpp:65-212`,
  `../audio.cpp/src/models/fireredtts3/session.cpp:129-182`,
  [github.com/studio-dots-ai/dots.tts](https://github.com/studio-dots-ai/dots.tts),
  [github.com/FireRedTeam/FireRedTTS3](https://github.com/FireRedTeam/FireRedTTS3).
- Every engine is built from audio.cpp's files (`engines/audiocpp/generated.js`); a family that
  needs more than its spec says gets it in its notes (`curated/<family>.js`): its direction, its
  licence reading, a request branch in `engines/audiocpp/slot.js` only where the spec can't say it
  (§1.6). (was: wiring a new engine followed VoxCPM2's — a manifest (`engines/<id>/manifest.js`), an
  entry in `engines/manager.js` `MANIFEST_MODULES`, a capability row, a `toSpeechRequest` branch,
  the renderer's voice-maker notes, the tests that count engines — *agent, 2026-10-11*; until
  2026-10-16, the adoption plan's slice 4.) — *code, 2026-10-16*.
- **By ear, blind (the user, 2026-10-11, the page's 62 answers; one seed per take, one listener):**
  each take rated against the book's description — *like the book / plain / wrong feeling* — and
  each voice *good / OK / bad*.

  | Line (the book) | VoxCPM2 clone: told · not told | Qwen3 CustomVoice (Ryan): told · not told | Turbo clone: told · not told | Best |
  |---|---|---|---|---|
  | 1 sighed | wrong (a laugh) · plain | **like** · wrong | — | Qwen3 CV |
  | 2 angrily | like · like | like · like | plain · like | VoxCPM2 |
  | 3 muttered | plain · plain | **like** · plain | plain · plain | Qwen3 CV |
  | 4 contemptuously | like · like | **like** · plain | — | Qwen3 CV |
  | 5 mournfully | like · like | **like** · wrong | — | VoxCPM2 |
  | 6 triumphantly | plain · plain | wrong · wrong | plain · plain | none |
  | 7 cried (shouted) | **like** · plain | wrong · wrong | — | VoxCPM2 |

  Every voice on every line rated **good**; VoxCPM2's clone "same person" and good over ten
  lines, Turbo's "mostly" and good. Read: the direction changed the result for the better on
  Qwen3 CustomVoice on 4 lines (1, 3, 4, 5) and made none worse; on VoxCPM2 on 1 line (7) and
  worse on 1 (1); on Turbo on none. VoxCPM2's plain takes already sounded like the book on 3
  lines (2, 4, 5) — the words carry some of it. "Triumphantly" worked on no engine. Best line by
  line: Qwen3 CustomVoice 3, VoxCPM2 3, none 1. — *measured by ear* ·
  claude.ai/artifact/MnB1Ut3iekQoDtsFDSf4rr (collection `slice0b`).
- **Round 2** (2026-10-11): the VoxCPM2 clip-only Hatter told in fuller words ("with a long, weary
  sigh, disappointed"), seeds 7, 8 and 9 — 21 takes, every one read back as just its line; the
  Hatter as a Qwen3 VoiceDesign voice (`POST /v1/voices/design`, drawn from his description on
  every line), seven lines told and not told plus three more. One VoiceDesign take ran away —
  line 4 not told, seed 7: no answer in 300 s, the card at 7.8 GB and 80 % until the server was
  stopped (a cancelled take keeps running, §1); its seed-8 try finished normally. The app passes
  no per-take length cap for Qwen3 (`max_tokens` is read by the runtime, not sent by
  `engines/audiocpp/slot.js`). Listening page: claude.ai/artifact/2Z27eh2G5JYjqtXr2yS2PE
  (collection `round2`). — *measured*.
- **Round 2 by ear, blind where it could be (the user, 2026-10-11, 44 answers):**

  | Line | VoxCPM2 clip-only, fuller direction — seeds 7 / 8 / 9 | Qwen3 VoiceDesign: told · not told |
  |---|---|---|
  | 1 sighed | like / plain / wrong | plain · plain |
  | 2 angrily | like / like / like | like · like |
  | 3 muttered | plain / plain / plain | plain · wrong |
  | 4 contemptuously | like / like / plain | like · like |
  | 5 mournfully | like / plain / plain | like · like |
  | 6 triumphantly | like / plain / plain | **like** · plain |
  | 7 shouted | like / like / like | like · like |

  VoxCPM2: 11 of 21 tries like the book, 9 plain, 1 wrong — the same direction gives a different
  result from one seed to the next; at least one of three tries was like the book on 6 of 7 lines
  (none on "muttered"). VoiceDesign: told 5 of 7 like the book, none wrong, every voice good —
  but **"changes" person across ten lines** (overall good). In both, the takes not told already
  sound like the book on several lines (VoiceDesign 4 of 7): the words carry much of it.
  — *measured by ear*.
- **Round 3** (2026-10-11, test branch `test/round3-engines` 1b5bff4, its server on the dev data
  folder): the VoxCPM2 Hatter's clip and its words copied to **CosyVoice3** (Q8, 2.26 GB;
  `template_name` instruct with `instruction` "Speak <direction>.", zero_shot when not told) and
  **IndexTTS 2.5** (Q8, 3.50 GB; `use_emotion_text` with `emotion_text` = the direction). Seven
  lines not told (seed 7) and told in round 2's fuller words (seeds 7, 8, 9) — 56 takes, none ran
  away, every one read back as just its line (two CosyVoice3 slurs: "Two days run", "We cup
  dormouse"). Once loaded, CosyVoice3 took a median 1.4 s a take, IndexTTS 2.5 7.5 s (max 16 s);
  CosyVoice3's first take 18 s with the load. Listening page:
  claude.ai/artifact/Q5D8U4jXRWb1RmHFpAFFgA (collection `round3`). — *measured*.
- **Round 3 by ear (the user, 2026-10-11, 60 answers; the takes not told were for comparison
  and not rated):**

  | Line | CosyVoice3 told — seeds 7 / 8 / 9 | IndexTTS 2.5 told — seeds 7 / 8 / 9 |
  |---|---|---|
  | 1 sighed | plain / plain / plain | **like / like / like** |
  | 2 angrily | like / plain / plain | **like / like / like** |
  | 3 muttered | like / plain / like | plain / plain / plain |
  | 4 contemptuously | plain / plain / plain | plain / plain / plain |
  | 5 mournfully | plain / plain / plain | **like / like / like** |
  | 6 triumphantly | like / plain / plain | like / plain / like |
  | 7 shouted | plain / plain / plain | plain / plain / like |

  IndexTTS 2.5: 12 of 21 tries like the book, 9 plain, none wrong; at least one like on 5 of 7
  lines, and on three lines all three seeds agree. CosyVoice3: 4 of 21 like, 17 plain, none
  wrong; at least one like on 3 of 7. Both: "the Hatter from the clip, on every line" — **same
  person**; the voice good on 6 of 7 lines and OK on one (CosyVoice3 line 7, IndexTTS line 4);
  overall good. Against round 2's VoxCPM2 (11 of 21, 1 wrong, seed-dependent): IndexTTS is level
  on the count and steadier per line, and it alone got "sighed" on every seed. IndexTTS missed
  "muttered" and "contemptuously" on every seed; VoxCPM2 missed "muttered" on every seed but got
  "contemptuously" 2 of 3. — *measured by ear*.

### 10.7 Judging emotion in a take automatically

All *agent, 2026-10-11*, not re-checked — a research agent reading our fork (`55b150f4`),
upstream main (`96269554`) and the web.

- **Nothing in audio.cpp is a dedicated speech-emotion model**; no emotion2vec port in its history.
- **SenseVoice-Small (`sense_asr`) is in our base** and tags each transcription with one of HAPPY,
  SAD, ANGRY, NEUTRAL, FEARFUL, DISGUSTED, SURPRISED, plus events (Laughter, Cry, Breath, Cough …).
  Called as JSON `POST /v1/audio/transcriptions/details` with `options: {keep_tags: true,
  audio_chunk_mode: "none"}` (the multipart form drops `options`, `app/server/runtime.cpp:2697-2756`;
  under `auto` each chunk gets its own tags). It returns the tag only — a greedy argmax, no score
  (`src/community_models/sense_asr/session.cpp:139-166, 201-213`); the logits exist
  (`session.cpp:629`) but aren't returned. FunASR Model License v1.1, commercial use Yes
  (`docs/model_licenses.md:108`); 254 MB Q8, `min_vram_gb` 4. Not in JustVoice's catalog.
- **Upstream main only:** CED (`ced`, Apache-2.0, 22–343 MB) and AST (`ast_audioset`, BSD-3, 346 MB,
  first 10.24 s only) score the 527 AudioSet classes through `POST /v1/tasks/run` — speech cues
  among them: Shout, Yell, Screaming, Whispering, Laughter, Giggle, Chuckle, "Crying, sobbing",
  Whimper, Sigh, Groan, Gasp (independent sigmoids). Audio Flamingo 3 (NVIDIA non-commercial,
  5.5 GB Q4) and LFM2.5-Audio (conditional, under USD 10M revenue) answer questions in text;
  SAMSONE (in our base, licence unstated) likewise; FireRedAudio's `understand` needs 10 GB.
- **Outside audio.cpp:** emotion2vec+ large/base (angry, disgusted, fearful, happy, neutral,
  other, sad, surprised, unknown; licence sources conflict; no official C++/ONNX port — one GGUF
  for the Vokra runtime); SenseVoice through `sherpa-onnx-node` (tag strings, no score);
  audeering's arousal/valence/dominance model is CC-BY-NC-SA (research only).
- **How the papers score emotion:** CosyVoice 3 — `emotion2vec_plus_large` classification
  accuracy on happy/sad/angry, text-related vs text-unrelated lines (CosyVoice3-0.5B
  0.92/0.70/0.72 related, 0.64/0.42/0.58 unrelated; arxiv 2505.17589). IndexTTS2 — "ES", a
  similarity of emotion2vec representations, plus human EMOS (ES 0.887 vs CosyVoice2 0.802;
  arxiv 2506.21619). EmergentTTS-Eval — Gemini 2.5 Pro judging pairwise (arxiv 2505.23009).
  Qwen3-TTS and VoxCPM2 report only InstructTTSEval; Chatterbox none found.
- **Known weaknesses:** classifiers call neutral speech neutral ~0.99 of the time, so averages
  flatter a model (arxiv 2507.12015); accuracy falls when the words don't match the emotion
  (CosyVoice 3); embedding similarity rewards mimicry and is skewed by speaker and wording
  (arxiv 2604.26347); audio LLMs judge mostly by the words (arxiv 2510.25054). Directions like
  "muttering" or "scornful" have no class in any of these label sets.

### 10.8 Direction per model — the authors' way against ours

*agent, 2026-10-11* (a research agent; web quotes it re-fetched marked ✓), with the items marked
*code* or *web* re-checked by the session the same day.

- **VoxCPM2** — the authors put the description in ASCII parentheses at the start of the text
  (`(slightly faster, cheerful tone)This is…`); instructions in Chinese or English; `cfg_value`
  "typical range 1.0–3.0", default 2.0 (*web*, usage guide). In controllable cloning results "can
  vary between runs — you may try to generate 1~3 times" (README). Hi-Fi mode (clip + transcript)
  ignores it — §10.6. We send clip + transcript + prefix on every directed line of a voice that
  has a transcript (*code*, `engines/audiocpp/slot.js:937-954`), and our row says "Written
  direction reaches a cloned voice too" (*code*, `engines/capability_details.js:377`) — untrue
  for such a voice. Demo clips to reproduce: openbmb.github.io/voxcpm2-demopage/ "Controllable
  Voice Cloning" (`audio/style_control/prompt1–3.wav`, download). No published number for style
  on a clone; BreezeBlue's vendor-run Voice Direction leaderboard scores it 2.49 of 5.
- **Chatterbox Multilingual** — no text direction; the authors' tips: defaults exaggeration 0.5 /
  cfg 0.5; for expressive speech cfg ~0.3 and exaggeration ~0.7 or higher, which also speeds it up
  (github.com/resemble-ai/chatterbox README). A user reports exaggeration has "no noticeable
  effect" on the multilingual v1/v2 models (issue #355, unanswered). **We drop a line's direction
  and emotion for it** — the request sends only the knobs (*code*, `slot.js:894-916`; nothing in
  `persona_render.js`, `render_core.js` or `api/generate_api.js` maps emotion onto exaggeration).
  audio.cpp runs multilingual T3 **v2** unless the session option `chatterbox.multilingual_t3` is
  `v3` (*code*, `../audio.cpp/src/models/chatterbox/session.cpp:320-330`); we never set it.
  English lines run the English model.
- **Chatterbox Turbo** — officially nine sound tags: [clear throat] [sigh] [shush] [cough] [groan]
  [sniff] [gasp] [chuckle] [laugh] (the official Space's `EVENT_TAGS`); the other ten tokens —
  [angry] [fear] [happy] [sarcastic] [surprised] [crying] [whispering] [narration] [dramatic]
  [advertisement] — are documented nowhere, and a user reports they "have no audible effect" while
  the nine work (resemble-ai/chatterbox issue #557, unanswered). Our value map sends five emotions
  onto those undocumented tokens (`capability_details.js:237`); round 1 heard them plain. Our
  2026-10-04 tag check proved each tag arrives, not that it is heard.
- **Fish Audio S2 Pro** (not wired) — free-form `[tag]` cues, best at a sentence's start
  (`[sad][whispering] I miss you so much.`, docs.fish.audio); "15,000+" tags; whether they hold on
  a cloned voice is not documented. audio.cpp passes the text verbatim, as the official
  `inference.py` (`prompt_builder.cpp:75-104`); its sampling defaults are 0.8 / 0.8 against the
  official CLI's 1.0 / 0.9. EmergentTTS Emotions win rate 86.61 (arXiv 2603.08823). Q8 6.32 GB;
  commercial use No. Our tag filter strips any `[…]` a model doesn't list (`inline_tags.js:64-75`).
- **Breeze TTS 2** (BreezeBlue; not wired) — direction on a cloned voice is its headline: clip +
  exact transcript + `--instruction`, "match the instruction language to the target text", the
  README recommends `--cfg-scale 4`. audio.cpp matches the official template but defaults
  `guidance_scale` to 1.0 (*code*, `include/engine/models/breeze_tts/generator.h:23`), and at
  exactly 1.0 skips CFG (*code*, `src/models/breeze_tts/generator.cpp:1060`) — so out of the box
  the instruction is barely enforced; it also adds "Speak clearly and naturally." when none is
  given. Vendor leaderboard 4.25 of 5 (700 cloned-voice tasks, Gemini-judged). Q8 5.08 GB;
  commercial use No.
- **Higgs Audio TTS 3** (not wired) — `<|category:value|>` tags at a sentence's start: 21 emotions
  (anger, sadness, disgust, bitterness …), styles (singing, shouting, whispering), sound effects
  (sigh, crying), prosody; "only the tags below are recognized — anything else … gets read
  literally"; the authors' cookbook combines them with a reference clip. audio.cpp passes them
  through (`tokenizer_text.cpp:62-89`). Q8 5.10 GB; commercial use No.
- **FireRedTTS3 — confirmed: no direction on a cloned voice.** Instruct reads `instruction` and
  then overwrites it with `reference_text` into a fixed "Convert text to speech." prompt
  (`../audio.cpp/src/models/fireredtts3/session.cpp:130-146`, `tokenizer_text.cpp:235-245`), as
  upstream's `chatml.py` does; the authors document only speed/pitch/volume edits. audio.cpp's
  spec over-claims `clone: style_control`. Its README limits cloning to "academic research".
- **Qwen3-TTS** — free prose in Chinese or English (README examples: `instruct="Very happy."`,
  `"Speak in an incredulous tone, but with a hint of panic beginning to creep into your voice."`);
  audio.cpp wraps it exactly as the official code (`<|im_start|>user\n{instruct}<|im_end|>`).
  The model table gives **0.6B CustomVoice no instruction control**, and the official code drops
  the instruction for it (`qwen3_tts_model.py:799-800`, agent-read); audio.cpp has no such check,
  and our `qwen3-cv` row offers direction on both sizes (`capability_details.js:285-296`) — slice
  0 used the 1.7B. We join persona, instruction, emotion and direction with ". "
  (`delivery_merge.js` `composeInstruct`, `persona_render.js:286`), so an emotion arrives as a
  bare word ("sad. with a long, weary sigh, disappointed"), "neutral" included. Published:
  InstructTTSEval-EN 1.7B CustomVoice 77.3 / 77.1 / 63.7 (APS / DSD / RP); no per-emotion table.
- **CosyVoice3** — the released model documents a **fixed list of 26 instructions**
  (`cosyvoice/utils/common.py` `instruct_list`, *web*, checked): 17 Chinese dialects, two Chinese
  speeds, "Please say a sentence as loudly as possible.", "Please say a sentence in a very soft
  voice.", two playful ones, and the only emotions — 请非常开心地说一句话。(very happy),
  请非常伤心地说一句话。(very sad), 请非常生气地说一句话。(very angry). The paper's 100+ styles
  were for its own models. audio.cpp builds "You are a helpful assistant. " + instruction +
  "<|endofprompt|>" as the official code. Round 3 sent free English prose outside the list
  ("Speak with a long, weary sigh, disappointed.") — 17 of 21 came back plain. Its published
  emotion accuracy measures emotion **from an emotional reference clip**, not from instructions.
  The demo site (funaudiollm.github.io/cosyvoice3/) answered 404 on 2026-10-11.
- **IndexTTS 2 / 2.5** — three ways: an emotion reference clip with `emo_alpha`, an
  `emo_vector` of eight [happy, angry, sad, afraid, disgusted, melancholic, surprised, calm],
  or `emo_text`. **The authors' own web UI hides text mode as experimental**
  (`EMO_CHOICES_OFFICIAL = EMO_CHOICES_ALL[:-1]  # skip experimental features`, `webui.py`, *web*,
  checked) and defaults the emotion weight to **0.65** (README: "around 0.6 (or lower) is
  recommended"); we sent text mode at 1.0. Their text examples are feelings or emotional lines
  ("I feel really down", 极度悲伤), not manner phrases. No category exists for volume or manner
  ("muttering") or contempt (disgusted is nearest) — the two lines IndexTTS 2.5 missed on every
  seed. audio.cpp matches the official `infer()`; an emotion clip goes through `/v1/tasks/run`.
  Published evidence is for a reference clip or vector (IndexTTS2 ES 0.887; 2.5 EN emotion
  accuracy 0.673); the text path is not evaluated for 2.5. Demos with downloadable clips:
  index-tts.github.io/index-tts2.github.io/ (§2.3 "I feel really down"; 2.5 §5 Disgusted at
  0.5 / 0.8 / 1.0).
- **KittenTTS 2** (`kitten_tts2`) arrived in upstream **v0.9.1** (2026-10-07), not in our v0.9.0
  base: experimental, speaks 48 presets and clones; "Expression tags reach the model verbatim and
  enable its emotion prefix"; a `preset` of `stable` or `expressive`. Stellon Labs Community
  License — commercial use Conditional (registration, revenue/funding limits, attribution). The
  tag syntax is not in audio.cpp's doc. — *code, 2026-10-11* · `git show
  v0.9.1:docs/community_models/kitten_tts2.md:192-203`, `v0.9.1:model_specs/kitten_tts2.json`,
  `v0.9.1:docs/model_licenses.md`.
- **F5-TTS** (`f5_tts`, in our base, community): clone only, `reference_text` required, no
  emotion option. "F5-TTS-Emotional-CFG" was not found by that name; the nearest is AffectF5
  (huggingface.co/ScreamingTony/AffectF5), a LoRA adapter on F5-TTS v1 Base — Neutral, Happy,
  Sad, Angry, Surprise and an arousal value, CC BY-NC 4.0; audio.cpp's F5 spec takes no
  adapter. **Orpheus is not in audio.cpp** (base or upstream main; a roadmap candidate only,
  2026-10-01 scan) — running it would mean porting it. — *code + web, 2026-10-11*.

### 10.9 The field: models for emotion on a cloned voice (sweep of 2026-10-11)

*agent, 2026-10-11* — a broad web sweep (five researchers under one agent; its re-fetched quotes
marked ✓), not re-checked by the session unless a line says so. The session's web-search cap ran
out mid-sweep; unchecked then: ParaStyleTTS, InstructAudio, EmoCtrl, MPE-TTS, UniStyle, StableVC,
StreamVoice, FreeVC, EmoConv-Diff, PromptEVC, VoiceCraft-X, CapSpeech-Eval, S2S-Arena, Voxtral's
emotion control, EmoSteer's code (a follow-up sweep is running).

- **No neutral leaderboard scores per-emotion acting on a cloned voice.** HF TTS Arena V2 rates
  built-in voices (open leaders Chatterbox 1481, Kokoro 1478, Maya1 1411; JSON at
  `tts-agi-tts-arena-v2.hf.space/api/leaderboard`); Artificial Analysis's provider-voice arena
  (open: Breeze 2 1222, Fish S2 Pro 1116, Step-Audio-EditX 1096, Voxtral 1086) and its 8-clone
  "Controlled Voice" arena (Breeze 2 1017, OpenAudio S1 Mini 1006, Fish S2 Pro 1005, Voxtral 1002,
  Higgs V3 960, Chatterbox 933) rate overall preference
  ([artificialanalysis.ai](https://artificialanalysis.ai/text-to-speech/leaderboard));
  InstructTTSEval scores voice design and built-in voices, not clones.
- **Cloning costs acting.** In the dots.tts paper's EmergentTTS Emotions run: Qwen3 on a clone
  39.8 against its built-in Ryan 60.5; VoxCPM2 clone 42.3; F5 26.8 (arXiv 2606.07080). Boson's own
  run on a shared clip, no tags (✓ Higgs v3 card): OmniVoice 61.07, MOSS-TTS v1.5 60.54, Higgs 3
  53.75, Fish S2 Pro 53.04, Qwen3-1.7B 45.54, IndexTTS-2 39.29.
- **SceneTTS-Bench** (✓ arXiv 2609.26255, ACM MM 2026; academic, makes none of the models) — speaker
  consistency across a character's turns (CAM++) and under-acting of high-tension lines: Qwen3-TTS
  0.96 / 85.5%, CosyVoice3 0.90 / 81.6%, IndexTTS2 0.74 / 81.1%, Fish-S2 0.71 / 84.5%. Every system
  under-acts more than 80% of high-tension lines; the variant and emotion mode each ran are not
  stated.
- **BreezeBlue's Voice Direction board** (vendor; 700 cloned-voice tasks, 150 on emotion, Gemini
  3.1 Pro judge, [breezeblue.ai](https://breezeblue.ai/benchmarks/tts-voice-direction)): Breeze
  4.25, MiMo-v2.5 3.76, StepAudio 2.5 3.48, Qwen-Audio 3.0 3.33, VoxCPM2 2.49. Breeze TTS 2's vendor
  suggests cfg 2–4 (HF discussion #15); its PyTorch build ran out of memory on a 2060 Super
  (dsect-net/quantum #37); an open report of timbre drifting between segments, 2026-10-10
  (breezeblue-ai/breeze-tts #25).
- **Higgs Audio v3's licence** is research / non-commercial with a **Creator Use Grant**:
  monetized audiobooks are allowed with credit, but not "embedding or integrating … in a
  product, application, or service" (✓ its LICENSE on Hugging Face) — a user could sell books made
  with it; JustVoice could not ship it built in.
- **Fish S2 Pro's** EmergentTTS 86.61 used several reference clips with the best reported,
  Gemini-inserted tags and an unreleased text frontend (fish-speech #1253); a user found its tags
  "very subtle to essentially inaudible" on emotion-neutral text across temperatures 0.6–1.5 (✓
  fish-speech #1280, closed unanswered).
- **AffectF5** (CC BY-NC 4.0, a LoRA on F5 v1, Python): on 24 cloned speakers, emotion recall
  73.5% against IndexTTS2 62.3% and F5 30.8%; speaker similarity 0.619 / 0.580 / 0.744 (✓ its repo;
  authors' numbers, 1★, unchecked by anyone else).
- **Ming-omni-tts** (Ant, MIT, PyTorch, 0.5B and 16.8B-A3B): clone + emotion instruction in one
  call; CV3-Eval emotion accuracy on emotional / neutral text, 0.5B 0.700 / 0.343 against
  CosyVoice3-0.5B 0.663 / 0.400 (✓ its README) — below CosyVoice3 on neutral text by its own table.
- **Zonos v0.1** (Apache, 1.6B, PyTorch): an 8-slot emotion vector + speaker embedding; no
  accuracy published; the authors say emotion follows the text's sentiment; dormant since 2025-03.
- **Can't hold a cloned person:** Maya1 (20 tags, no cloning; "does not establish consistent
  speaker identity"); Orpheus (tags only on its fine-tuned voices; cloning broken per its own
  checklist and issues #99, #134; community GGUFs exist); Voxtral 4B (the open checkpoint has no
  codec encoder, so no cloning; CC-BY-NC); OmniVoice (`instruct` designs only; CC-BY-NC); Kimi-Audio,
  GLM-4-Voice, MiMo-Audio (clone + instruct undocumented). Qwen3's promised VoiceEditing (clone +
  instruct) is still unreleased (QwenLM/Qwen3-TTS #14).
- **Clone only, no direction:** Dia/Dia2, CSM-1B (EmergentTTS Emotions 7.32), Kyutai TTS 1.6B (no
  encoder released), MegaTTS3 (encoder withheld), Llasa, OuteTTS, Spark-TTS (control disables the
  clone), ZONOS2 (8B MoE; Q4 GGUF 4.9 GB via zonos2.cpp), GLM-TTS, Echo-TTS, Audio8, Kova TTS 1.
- **Out on size or weights:** MOSS-TTSD v1.0 (q4 9.5 GB; audio.cpp's own doc: "identity drifts
  across turns"), MOSS-TTS v1.5 8B, VibeVoice 7B (its TTS code pulled 2025-09), KugelAudio (19 GB),
  DramaBox (~24 GB), Higgs v2 (24 GB). `index_echo` is speech translation, not TTS.
- **EmoTra-TTS** (EMNLP 2026, arXiv 2608.23791) — *web, checked by the session 2026-10-11*: a
  method plus training code on CosyVoice2-0.5B (two fine-tuning stages, LLM and flow decoder,
  +0.43% parameters) that moves emotion **within one line** along valence/arousal/dominance from a
  start to an end value. The repo (github.com/Liu-Tianchi/EmoTra-TTS) is Apache-2.0, **code only, no
  trained weights**; you train it on EmoVoice-DB. "A separate model is trained per voice, and
  zero-shot generalization to arbitrary unseen speakers is not yet demonstrated" (paper,
  Limitations); no reference-audio input at inference. README: "The core method of EmoTra-TTS has
  been submitted for patent protection." (The paper's ethics statement said non-commercial
  research; the repo's licence file says Apache-2.0.)
- **Render, then edit** is not viable today: doteBench (✓ arXiv 2608.02673, by the dots team),
  emotion accuracy on its neutral set — no edit 20.43%, AuK 21.63, Step-Audio-EditX 23.08,
  Ming-UniAudio 25.72, MiMo 23.08, FireRedTTS3-Instruct 20.43, dots.tts.edit 33.17. AuK needs a
  research-only Qwen2.5-Omni encoder; its Q8 packages total ~6.5 GB though audio.cpp's catalog
  lists 20 GB.
- **Act, then convert:** emotion kept after conversion on ESD ranges 37% (HierSpeech++) to ~77%
  (ConsistencyVC) (arXiv 2506.04013); OpenVoice: "in rare cases the emotion will be slightly
  neutralized" [authors]; whisper, shout and sigh surviving conversion are measured nowhere.
- **audio.cpp's catalog memory minimums are coarse** (`webui/configs/models_catalog.json`:
  chatterbox 12, omnivoice 10, breeze/fish/cosyvoice3 8, higgs 6, voxcpm2 6 GB) — Chatterbox and
  CosyVoice3 run on this 8 GB card.
- **Follow-up of the unsearched names** (*agent, 2026-10-11*; its web search capped after 15
  queries, the rest from primary pages and the GitHub API): **no released weights** — InstructAudio,
  EmoCtrl-TTS, MPE-TTS (emotion accuracy 46–48%), UniStyle, StableVC, StreamVoice, EmoConv-Diff,
  PromptEVC, EmoSteer-TTS ("upon acceptance"; v3 2025-10-25, no repo); **no cloning** —
  ParaStyleTTS (MIT, prompt only), CapSpeech (all CC BY-NC 4.0), Voxtral TTS (upstream's own spec:
  "the released checkpoint does not contain the encoder needed for reference-audio cloning";
  CC BY-NC, card asks for 16 GB); **non-commercial** — VoiceCraft-X (cloning and editing, no
  emotion control), EmoVoice (weights CC-BY-NC); FreeVC (MIT, 2023) converts timbre only.
  **New candidates:** Marco-Voice (Alibaba AIDC, Apache-2.0, on CosyVoice — emotion set apart from
  the cloned speaker, seven emotions and a continuous vector; the authors note "a trade-off
  between timbre similarity and emotion control"; size not stated,
  github.com/AIDC-AI/Marco-Voice); Step-Audio-EditX as an edit pass on any engine's take (§8).
  Vevo2 (in our base) takes a speaker reference and prompt editing; whether it carries emotion is
  unchecked.
- **The sweep's ranked shortlist for a consistent clone with reliable per-line emotion on 8 GB:**
  IndexTTS 2.5 the authors' way (vector at ~0.6, or an acted take as its emotion clip); best-of-N
  with an automatic judge on IndexTTS 2.5 and VoxCPM2 clip-only; Breeze TTS 2 (cfg 1–4); Higgs v3
  (tagged vs untagged); act-then-reference / act-then-convert; AffectF5 (sidecar); Fish S2 Pro with
  stacked tags; OmniVoice or MOSS-TTS-Local untagged.

### 10.10 Techniques, pipelines and production (sweep of 2026-10-11)

*agent, 2026-10-11* — as §10.9; ✓ = re-fetched by the agent. Unsearched when the cap ran out:
Reddit, Hacker News, the latest conference sweeps, breath handling, dual-narration norms (follow-up
running).

- **Best-of-N with automatic selection works** for errors and expressiveness: Llasa (✓ arXiv
  2502.04128) — verifiers of speaker similarity, Whisper WER and emotion2vec raised (1B model) WER
  12.13→5.24, similarity 0.638→0.750, emotion similarity 0.768→0.937; independently (✓ arXiv
  2607.08256) a 12% relative WER cut over F5 at N=10, with a warning that a verifier and an
  evaluator from the same ASR family inflate the gain. No published gain from picking on an
  emotion classifier was found. ElevenLabs Studio's export QA checks "volume distortions", "voice
  similarity", "mispronunciations", "missing or additional words" and regenerates "up to twice"
  (✓ its docs).
- **Emotion banks:** IndexTTS2/2.5 take a voice clip and an emotion clip separately (✓ README;
  `emo_alpha` 0.9 in their clip example); a community guide finds the emotion clip "stronger, more
  consistent" than emotion text, advises clips "from the same speaker as the timbre reference",
  and warns an emotional timbre clip leaks into the voice. F5-TTS's own app has a "Multi-Speech"
  tab with a clip per speech type ({Regular} {Sad} {Angry} {Whisper}…) (✓ `infer_gradio.py`).
- **The voice clip's delivery carries into every line** (✓ Audiobook-CC, arXiv 2509.17516): the
  target line itself as the clip gave similarity 0.87 but style S-MOS 3.45; another clip from the
  chapter 0.69–0.79 and 3.82–3.86 — a frozen character clip should be calm. Neighbouring sentences
  as context raised S-MOS 3.82→3.93; chapter-level M-MOS 4.25 against CosyVoice2 3.88 and MOSS-TTSD
  3.72.
- **Context in long form:** Higgs Audio renders each chunk with the previous generated audio and
  the reference in the prompt (✓ its examples); MoonCast — one long pass beat stitching on coherence
  (4.13 vs 3.80) but lost speaker similarity (0.77 vs 0.86) (arXiv 2503.14345).
- **Intensity:** EmoKnob (speaker-embedding arithmetic, EMNLP 2024) and EmoSteer-TTS (activation
  steering; code promised) both degrade quality at high strength and would need fork changes;
  IndexTTS's `emo_alpha` is the knob we have.
- **Papers:** MultiActor-Audiobook (GPT-4o instruction per sentence) rated below ElevenLabs on
  every measure (MOS-E 2.9 vs 4.2, MOS-Q 2.4 vs 4.6), and removing its instructions *raised*
  quality 2.4→2.8 — direction can cost quality (arXiv 2505.13082). Dopamine Audiobook splits lines
  by emotion and picks an engine per line (3.685→2.929 without the split); its GPT-4o judge reached
  r=0.601 with humans (arXiv 2504.11002). Deep Dubbing (✓ arXiv 2509.15845): a fixed template per
  character and "emotion | scene | text" per line raised MOS-E 3.67→4.15. LibriQuote (✓ Deezer,
  arXiv 2509.04072): 5.3K hours of book quotes with pseudo-labelled speech verbs and adverbs
  ("whispered softly"), released — a ready key for our direction step.
- **Open projects worth copying** (GitHub, 2026-10-11): Pandrator (MIT; audio.cpp is "the default
  for new workspaces", an MCP server and a Claude Code skill ✓; a character dictionary with
  aliases, review status and locks; LLM pronunciation proposals inactive until approved; text shown
  kept apart from text spoken); tts-audiobook-tool (MIT; read-back verification that keeps the most
  accurate take, EBU R128 loudness, a pause table per boundary ✓, a read-along player with word
  timings in the M4B); Alexandria (MIT; a second LLM review pass; 500 ms at a speaker change, 250 ms
  within one speaker ✓; notes "Instruct directions are ignored for cloned voices" ✓); TTS-Story
  (voice candidates per speaker; an ACX preset); epub2tts (Whisper-tiny fuzzy match → regenerate up
  to twice); abogen (spaCy part-of-speech heteronym choice); Storyteller (EPUB 3 Media Overlays);
  audiobook-creator (an Orpheus loop detector; Qwen3-30B-A3B found best for attribution).
- **Commercial workflows:** ElevenLabs Character Casting (✓ 2026-07-30) detects characters,
  proposes a voice each, previews on the character's own dialogue, pre-fills a pronunciation
  dictionary with unusual names, sets break lengths once; Studio's breaks default 1 s, max 3 s,
  "Lock paragraph", no M4B export. Google Play: "Detect characters" English only and can't be
  undone. KDP Virtual Voice: Short/Medium/Long pauses, respelling "Apply to all instances".
- **Pauses** (no distributor publishes rules): tts-audiobook-tool "Normal" ✓ — phrase 0.5 s,
  sentence 0.9, paragraph 1.2, space break 2.0, section break 2.5 ("Shorter" 0.3/0.6/0.9/1.5/2.0);
  Alexandria 500 ms at a speaker change, 250 within one speaker. JustVoice today: 600 ms between
  lines, 250 within a paragraph, 2,000 at a scene break (`server/src/models.js:301-308`, *code*) —
  nothing specific to a speaker change, after a chapter title, or for head/tail room tone.
- **Room tone and files:** ACX 1–5 s head and tail (§10.3); Pozotron: "2.5-3.5 is the most common
  length for end room tone". ACX: one chapter per file with its header, under 120 min, credits
  matching the metadata, "You have been listening to…" and "The End", retail sample ≤ 5 min.
  Apple: 22.05 kHz/16-bit or better, chapter titles as printed (255-byte limit); Google: MP3 ≥128
  kbps mono. ffmpeg writes Nero plus QuickTime chapters; `-movflags disable_chpl` writes QuickTime
  only, since Nero "can cause failures" with some taggers.
- **Follow-up** (*agent, 2026-10-11*; Reddit refused direct fetches, so its posts come from search
  snippets only):
  - **What makers and listeners say:** HN's Kokoro/audiblez thread (420 points) — fiction sounds
    flat, symbols misread ("C hash"), ~5 glitches in an 8-hour book, and a suggestion to annotate
    speakers and emotion with an LLM first (news.ycombinator.com/item?id=42708773); Reddit — names
    mispronounced, or pronounced differently between chapters, and weak character
    differentiation; some listeners filter AI-narrated titles out (a "Devirtualizer" extension
    hides Audible Virtual Voice books); Reedsy: 10–20 hours of fixing per ElevenLabs book.
    **KeenLore**, a near-twin (local, full cast, Gemma 4 for prose, Qwen3-TTS VoiceDesign, an 8 GB
    T1000), self-reports 97.2% quote attribution (485/499, one novel); video only, no repo.
  - **Interspeech 2026:** MagpieTTS-LF (long form by carrying state across chunks and reading
    earlier text), AuDirector (character profiles + per-line emotion + an audit that regenerates
    bad audio), CAST "Knowing What to Stress" (text models pick the stressed word, TTS often fails
    to say it; benchmark released), "The False Resonance" (emotion2vec cosine disagrees with
    humans), "Audiobook Narration Appeal" (tone, pace and loudness predict engagement by genre),
    NVV-SuperBench (nonverbal control doesn't follow overall quality). Also Qwen-Audio-3.0-TTS
    (inline tags, 3-minute one-pass generation; weights and licence not stated). ICASSP 2026:
    nothing found.
  - **Breaths:** 600 ms inhalations improved listeners' recall of synthetic speech, 300 ms didn't
    (Elmers et al., Interspeech 2021); breaths, clicks and hesitations make synthetic speech sound
    less certain (2023); narration practice keeps breaths and only reduces distracting ones
    (anecdotally 10–12 dB), room tone never dead silence; Amazon Polly has automatic breaths; ACX
    names only "excessive mouth noise".
  - **Dual and duet narration** (ACX's blog): dual = narrators swap by chapter or point of view;
    duet = each narrator voices their own characters throughout, "often alternating during
    dialogue". How "he said" tags are handled in full cast and a narrator-vs-character loudness
    norm: not found in any production source.
- **The sweep's ranked list:** take check with best-of-N; an emotion bank per character as
  IndexTTS's emotion clip; pauses and room tone as settings; structured direction (a stable
  character profile + "emotion | scene | manner" per line, split a line where its emotion
  changes); a pronunciation pre-pass; voice candidates per character with a calm frozen clip; a
  character dictionary with aliases and locks; act-then-convert (weak evidence); neighbouring
  context; delivery polish (QuickTime-only chapters, credits, a sample, a digital-voice disclosure,
  read-along timings through `qwen3_forced_aligner`).

### 10.11 Testing takes automatically: tools and protocol (sweep of 2026-10-11)

*agent, 2026-10-11* — as §10.9; the items the agent re-checked at source: EmoVoice's ρ table,
TTSDS2, ParaSpeechCLAP, SES-Judge, Empathic-Insight, DS-WED, Audiobox, UTMOSv2, the ACX page,
Pozotron, Orion QC, RW-Voice-EQ, SwanBench, ViSQOL, Hume, Gemini prices.

- **Scorers agree with people on model averages, not on single takes:** EmoVoice (arXiv
  2504.12867, Table 10) — emotion2vec similarity ρ 0.94 per model but 0.40 per sentence;
  Gemini-2.0-flash 0.94 / 0.20; GPT-4o-audio 0.77 / 0.26. Automation can rank models and reject
  bad takes; a person still chooses between good ones.
- **Quality (MOS) predictors barely separate modern TTS:** TTSDS2 (20 open systems, arXiv
  2506.19441) — UTMOSv2 0.39, UTMOS 0.51, Audiobox up to 0.60, SQUIM ~0.68, NISQA ~0; on 11 current
  zero-shot models (arXiv 2603.24430, Chinese) UTMOSv2 0.118, DNSMOS 0.091, speaker similarity 0.68.
- **Picking on a scorer can game it:** Llasa's emotion-guided search reached emotion2vec
  similarity 0.974, above real speech's 0.94, with worse WER and no human check.
- **Emotion and style scorers:** emotion2vec+ (licence sources conflict: FunASR MODEL_LICENSE
  v1.1 vs an MIT badge with no LICENSE file); **LAION Empathic-Insight-Voice** (CC-BY-4.0; 40
  continuous emotion intensities plus valence, arousal, monotone-vs-expressive; Whisper-Small
  encoder, CPU, 30 s cap; ~5,000 h synthetic acting + ~5,000 h real speech; expert agreement ρ 0.418,
  level with Gemini 2.5 Pro 0.417; its loaded backbone's licence unstated); **ParaSpeechCLAP**
  (MIT code and weights, training data CC-BY-NC-SA; scores audio against a free-text style —
  23 situational tags such as angry, whispered, saddened; ships `best_of_n.py`; best-of-10 by
  human raters: tag recall 69.2→74.3%, CMOS 3.61→3.70) — covers directions with no emotion class;
  SES-Judge (emotion similarity to a reference, ρ 0.530 vs emotion2vec cosine 0.306; weights not
  released); a commercial-OK arousal/valence/dominance model trained on real speech — not found.
- **Vocal events:** BEATs (MIT), Whisper-AT (BSD, transcript + 527 AudioSet classes), PANNs
  (CC-BY-4.0), YAMNet (Apache); NonverbalTTS scores the Jaccard distance between requested and
  detected events.
- **Speaker similarity** agrees with listeners moderately (ECAPA ~0.77 LCC, WavLM ρ 0.55 per
  utterance) and **drops on emotional speech** (WavLM cosine 0.88–0.91 read vs 0.54–0.85 emotional,
  ClonEval arXiv 2504.20581) — score within (character, emotion), never against a fixed threshold.
  CAM++ / ERes2NetV2 (3D-Speaker, Apache-2.0, ONNX); ECAPA2 is non-commercial.
- **Read-back:** Open ASR Leaderboard (2026-10-09) English WER — Qwen3-ASR-1.7B 5.40, Canary-Qwen
  5.94, Parakeet-TDT v3 6.18 (6,132× real time), Whisper large-v3 7.16. Normalise both texts with
  Whisper's normaliser and align (jiwer): deletions = skipped words, insertions and repeats =
  runaways. Forced alignment: NeMo Forced Aligner (Apache), WhisperX (BSD-2), MFA (MIT);
  ctc-forced-aligner's default model is non-commercial, whisper-timestamped AGPL. Names:
  wav2vec2-xlsr-53-espeak-cv-ft (Apache) outputs eSpeak phonemes for a per-name check (untested).
  The industry's shape: Penguin Random House's Orion QC compares an ASR transcript with the
  manuscript for missing, repeated and misread text and silences over 3 s — days to minutes ✓.
- **Audio-LLM judges:** EmergentTTS-Eval (Apache) — pairwise against a fixed baseline, Gemini 2.5
  Pro, rank ρ 0.905 with humans, ~$50 per system; on speaking-style instructions Gemini-2.5-Pro
  r 0.640 vs human-human 0.596, GPT-4o-audio 0.355 (arXiv 2506.05984); order flips 10–13% of
  verdicts (AudioJudge); judges follow the words when words and voice disagree; Hume's RW-Voice-EQ:
  expression r 0.47, 0.25 with the text cue withheld, identity tracked "especially poorly".
  SpeechJudge-GRM 77.2% pairwise agreement (CC-BY-NC). No local judge is published as reliable.
  Gemini prices: 2.5 Pro $1.25/$10, 3.1 Pro preview $2/$12, 3.8 Flash $0.75/$3.75 per M tokens;
  audio 32 tokens/s.
- **Toolkits:** VERSA (ESPnet; 90+ metrics incl. UTMOS, Audiobox, WER, speaker similarity,
  emo2vec, A/V/D; licence file Apache-2.0, badge MIT) — the standard harness; TTSDS2 (scores sets
  of clips); SwanBench-Speech (long-form, code promised).
- **Listening:** webMUSHRA (Fraunhofer licence, AB/MUSHRA, CSV) is the standard page; Label
  Studio (Apache) has pairwise audio; BeaqleJS is GPL-3.0; ASAP (MIT) picks the next pair by
  information gain; for one listener, forced-choice AB beats MOS; bootstrap by listener and line.
- **ACX/ffmpeg checks:** noise floor = the RMS of the quietest 0.5 s block
  (`asetnsamples=n=22050,astats=metadata=1:reset=1`), not astats' `Noise_floor` (a minimum peak)
  or `RMS_trough` (read −38.5 against a true −74.8); room tone via `silencedetect=n=-60dB:d=0.5`;
  `adeclick` needs tuning (4 "clicks" on a clean sine).
- **The sweep's recommended kit:** per take — a signal gate (ffmpeg clipping/silence, seconds per
  character vs the voice's median for runaways), read-back (Parakeet, Qwen3-ASR second), same
  character (CAM++ z-score), emotion and direction (emotion2vec+, Empathic-Insight, ParaSpeechCLAP,
  a vocal-event check), quality outliers (UTMOSv2, Audiobox PQ/CE); send to a person near-misses,
  scorer disagreements, close top-two takes and 15–25% at random; audit the scorer's pick against a
  random seed on ~20 lines by ear (stop picking by scorer below ~60% agreement). Model comparison:
  happy/sad/angry + neutral, 20 lines each (10 emotion-matching words, 10 neutral, plus 5
  contradicting), 3 seeds, paired bootstrap over lines, blind AB on a random seed chosen by ASAP —
  about 1–1.5 h of listening for 4 models. The z-score combiner is NOT STANDARD (the standard is
  VERSA's scores read separately).
- **NeMo already ships a take-scoring recipe** (Apache-2.0; *agent, 2026-10-11*):
  `examples/tts/magpietts_inference.py --run_evaluation` →
  `nemo/collections/tts/modules/magpietts_inference/evaluate_generated_audio.py` computes CER/WER
  (NeMo ASR or Whisper), speaker similarity (TitaNet or WavLM-base-plus-sv), UTMOSv2 (pinned 1.2.1),
  FCD, and with `with_prosody_metrics` **emotion similarity and top-emotion match between a
  reference clip and the take** (ESIM/EMS, through LAION Empathic-Insight-Voice since 2026-09-03 —
  12 emotions incl. impatience, disappointment, contemplation, emotional numbness) plus pitch,
  intensity and speech-rate distance — the standard to follow for an act-then-reference check.
- **More judges and scorers** (*agent, 2026-10-11*): S2S-Arena (ACL 2026) found audio-LLM judges
  agree with humans only 30.2% (GPT-4o-realtime) and 25.6% (Qwen2-Audio) — "not ready"; SpeechJudge's
  99K human pairs (CC-BY-NC, gated) label naturalness and intelligibility, not emotion. DNSMOS Pro
  (MIT) gives a MOS mean and variance. Vox-Profile (emotion, A/V/D, age, accent, voice quality) is
  RAIL "No commercial use", 3–15 s clips. 3D-Speaker has no emotion model; NeMo none beyond the
  LAION wrapper.
- **CPU cost per minute of audio:** CAM++ ~0.8 s (RTF 0.013, arXiv 2303.00332); Parakeet-TDT v3
  ~4.7 s through audio.cpp on this machine's CPU (12.7× real time,
  `docs/plans/2026-10-02-cpu-placement.md` §6.2); emotion2vec+, UTMOSv2 (5 frames × 5 folds by
  default) and ParaSpeechCLAP — not found.
- **Runaway heuristic:** none published as a threshold. F5-TTS estimates a take's length from the
  voice's own clip — `duration = ref_len + ref_len / ref_text_bytes × gen_text_bytes / speed`
  (`src/f5_tts/infer/utils_infer.py:503-505`); ours is flat — 0.5 s a character and 30 s,
  the settings `speech_runtime.runaway_s_per_char` and `runaway_min_s` since 2026-10-13 (*code*,
  `manager._noteRunaway`, `runtime.runawaySPerChar`/`runawayMinS`; one function since
  2026-10-16, `runtime.runawayLimitS`, which the take check reads too). A per-voice bound would be
  tighter.
- **The take check as built (slice 6, 2026-10-16)** — *code + tests*, `server/src/take_check.js`,
  `server/tests/take_check.test.js`:
  - **No JavaScript port of the standard pieces exists** (npm search 2026-10-16): no Whisper
    normaliser, and the WER packages are abandoned (`word-error-rate` 0.0.7, 2019;
    `stt-evaluation` 1.4.0, 2021). So the normaliser is a line-for-line port of Whisper's
    `whisper/normalizers/basic.py` (upstream commit 26a7cac, 2025-01-04, MIT) —
    `server/src/whisper_normalizer.js`; on eight sample lines (curly and straight apostrophes,
    em dashes, brackets, parentheses, fractions, Roman numerals, full-width letters) its output is
    the upstream Python's, character for character. Whisper's *English* normaliser (numbers,
    spellings, contractions) is not ported.
  - **The port proved against the original (2026-10-19)** — *measured*: openai-whisper 20250625
    (the take-check kit's venv; its `basic.py` is upstream main's, byte for byte) and the port,
    each in Whisper's three settings (default, `remove_diacritics`, `split_letters`), over every
    line in the dev database (562) and every transcript the take check stored (273): 2,505 of
    2,505 the same. Over every Unicode code point (1,112,064, surrogates out), each written
    `A<c>b <c>`: the same except 1,020 (default), 1,030 (diacritics) and 1,057 (split) — every
    one a character Unicode 15.0 (Python 3.12's `unicodedata`) hasn't assigned and Node's ICU
    (Unicode 17.0) has, plus U+1171E AHOM CONSONANT SIGN MEDIAL RA, which Unicode 16.0 moved from
    Mn (dropped) to Mc (a space). The port follows the Unicode version of the Node it runs on;
    neither side is wrong. Scripts: the session's scratchpad (`norm_proof.py`, `norm_proof.js`,
    `norm_all.py`), not kept.
  - **The word diff is jsdiff** (`diff` on npm, 9.0.0 of 2026-04-13, BSD-3-Clause, ~146 M
    downloads a week, maintained — https://github.com/kpdecker/jsdiff): `diffArrays` over the
    normalised words gives the fewest words added and removed (Myers). In a run of changes the
    removed and added words pair off as words heard wrong (counted missed), the rest of the added
    ones are extra — jiwer's substitutions, deletions and insertions, from a diff that has no
    substitutions of its own. The repo's own `difflib.js` (Python's SequenceMatcher, used by
    caption alignment) was the other candidate; the plan named a word-diff package, and
    SequenceMatcher matches the longest block first rather than the fewest edits.
  - **The rule:** fail on missed words > `take_check.missed_share` × the line's words (0.2), extra
    words > `extra_share` × them (0.2), each at least `min_words` (2), or a take longer than
    `runtime.runawayLimitS(text)` — that one is not read back (the 655 s runaway of 2026-10-10
    would hold the recogniser for minutes). All three numbers are unmeasured starting points.
  - **Known blind spots:** a number in figures heard as words counts as missed (the English
    normaliser's job); Chinese and Japanese text has no spaces, so a clause is one word (Whisper's
    `split_letters` option exists in the port, unused); Whisper's rule drops words in parentheses
    from the line's text, so an aside the voice reads counts as extra words; a persona's effects
    chain is in the take the recogniser hears.
- **The kit built on this, and round 4:** `docs/plans/2026-10-16-test-kit-and-round-4.md` — VERSA
  for read-back, same speaker, quality and arousal/valence/dominance, emotion2vec+ for the emotion,
  pyloudnorm for loud and soft, each score read on its own; NeMo's recipe installs on Linux only.
- **Licence flags** (only if shipped in the app): non-commercial — NISQA weights, SpeechJudge-GRM,
  Vox-Profile, audeering, openSMILE, Audio Flamingo 3, ECAPA2, ctc-forced-aligner's default,
  AutoPCP; GPL/AGPL — Parselmouth, Allosaurus, BeaqleJS, whisper-timestamped.

### 10.12 The text side: attribution, normalization, pronunciation, import (sweep of 2026-10-11)

*agent, 2026-10-11* — as §10.9. Unsearched when the cap ran out: LLM IPA accuracy for names, LLM
heteronym accuracy, French/Russian attribution sets, a multilingual BookNLP, NeMo's language list,
Claude or GPT-4o on PDNC (follow-up running).

- **Ours today** (*code*): attribution 240/240 on two Alice chapters, 138 of them decided by the
  rule; **no text normalization** of our own (`server/src` has no number/ordinal/abbreviation
  expansion — Kokoro's own `normalize_numbers` is in the fork,
  `src/models/kokoro_tts/g2p_multilingual.cpp:237`); **EPUB import is text only** — `epub:type`
  ignored, so footnotes, notes, front and back matter come in as text, italics dropped
  (`imports/adapters/book_prose.js:34,301,319`); no MOBI or PDF; lexicons match exact spellings, so
  heteronyms can't be told apart.
- **PDNC** (github.com/Priya22/project-dialogism-novel-corpus): 35,978 quotes over 22 novels (later
  28), each with speaker, addressees, type (explicit / anaphoric / implicit) and a
  `character_info.csv` with aliases and gender; no licence stated. Llama-3 8B with the whole
  chapter, the alias list and chain of thought: 90.6% (PDNC1) / 88.5% (PDNC2), BookNLP+ 78.5 / 79.2;
  without the alias list it invented names; feeding back its previous answers +0.9 points (arXiv
  2406.11380, NAACL 2025). **ModernBookNLP** (ModernBERT-large joint scoring, arXiv 2608.02359,
  2026-08): 94.5% overall — explicit 99.3, anaphoric 95.5, implicit 89.3 — 0.43 s per novel on an
  A100 (Llama-3-8B 400–2,800 s); a gold character list assumed; licence not shown. BookNLP: MIT,
  English, ~2–4 min per book on CPU. LitBank: quotes with speakers, CC BY 4.0. Chinese: SIG
  86.15%, JY-QuotePlus; German: DROC. Group lines and nested quotes: no paper evaluates them.
- **Direction from text:** no per-utterance emotion dataset of novel dialogue found (nearest:
  MELD, EmotionLines, DailyDialog); StoryTTS (Mandarin, CC-BY-NC) labels rhetorical device, sentence
  pattern, scene (role-play / aside / inner monologue), imitated character and free emotion words —
  zero-shot labelling poor, few-shot with explanations used; labels raised MOS 3.88→4.09.
  "Voicing Personas": closed attributes turned into one sentence beat an open description
  slightly. No paper measures over-marking (ours: 4–5%).
- **Casting:** CroSS (EMNLP 2024): LLM character profiles promising but hallucinate on complex
  plots; ParaSpeechCLAP could rank library voices against a description.
- **Text normalization:** LLMs make ~40% fewer errors than production rules (NVIDIA, arXiv
  2309.13426); PolyNorm (Apple, arXiv 2511.03080) — GPT-4o 4.17–7.88% WER vs rules 9.72–17.49% over
  8 languages, a released benchmark (27 categories × 20 per language). NeMo-text-processing
  (Apache, Pynini; pip unsupported on Windows), WeTextProcessing (zh/en/ja, C++ runtime).
- **Pronunciation:** misaki (Kokoro's G2P, inline IPA, espeak fallback), espeak-ng (GPL-3.0+),
  OpenPhonemizer (archived 2026-03-15), DeepPhonemizer (MIT; en/de/fr/es), CharsiuG2P (MIT, 100
  languages, PER 0.089–0.107). WikipediaHomographData (Apache, 162 homographs × ~100 sentences) is a
  ready heteronym test set.
- **Book import:** EPUB 3 structural semantics (W3C Note 2026-05-28) marks frontmatter,
  backmatter, footnote, noteref, endnotes, pagebreak, epigraph, dedication, copyright-page and more;
  calibre's `ebook-convert` reads MOBI/PDF with chapter XPath and heuristics; Docling (MIT) recovers
  PDF reading order; Marker's weights are restricted commercially above $5M; Chapter Captor finds
  chapter headers at F1 0.77.
- **Book-to-script tools** (Alexandria, audiobook-creator, VoxNovel, ebook2audiobook, epub2tts,
  Dopamine): none publishes text-side accuracy — our answer key is more rigorous than any.
- **Follow-up** (*agent, 2026-10-11*; web search capped after ~25 queries; Reddit only through
  search snippets):
  - **LLM pronunciations:** Japanese G2P (Koriyama, Interspeech 2026, 3,000 sentences, kana CER) —
    Claude Opus 4.6 0.52%, Gemini 3.1 Pro 0.53%, GPT-5.2 1.05% against OpenJTalk 1.03% and
    MeCab+UniDic 1.54%, but **local models far worse** (Gemma3-27B 5.75%, Qwen3.5-27B 6.27%,
    Gemma3-4B 34.8%); a "parse mode" (the LLM segments, rules convert) beat direct reading; proper
    nouns called "a major source of errors" but not scored (arXiv 2606.22009). English
    pseudo-words: LLMs match human agreement ~80%, failing by over-regularizing; GPT-5.4 not
    significantly better than Llama3 (Waterloo thesis, 2026). PhonologyBench (2024): GPT-4 51.9%,
    Claude-3-Sonnet 52.7% exact-word G2P vs a G2P library 62.4%. No measurement specific to names
    found.
  - **Heteronyms:** "LLM picks the sense, a dictionary gives the sound" — GPT-4 with retrieval
    95.7% vs SoundChoice 92.2% on Librig2p (arXiv 2411.07563); Amazon's contextual-embedding
    classifiers 0.991 with ~100 sentences per word; the best of 17 LLM-based TTS models only 82.02%
    on Chinese polyphones (PolyBench, Interspeech 2026) — the TTS model won't resolve them itself.
  - **Other languages:** Japanese attribution set from *Romance of the Three Kingdoms*, LLMs ~90%
    (WNU 2025); French, Spanish, Russian fiction sets not found; no multilingual BookNLP released
    (an NEH-funded effort, 2020; the repo is still English-only). NeMo text normalization has
    folders for ar, de, en, es, fr, hi, hu, hy, it, ja, ko, pt, ru, rw, sv, vi, zh.
  - **Frontier models on PDNC:** no published Claude, GPT-4o/5 or Gemini figure (ChatGPT-3.5 ~71%
    only); Llama-3 70B made 3 errors in 1,442 quotes on a novel outside PDNC — with the gold
    alias list, 4,096-token chunks with 1,024 overlap, chain of thought, JSON and earlier answers
    carried forward.
- **The sweep's ranked list:** test against PDNC and LitBank by quote type; a normalization step
  (patterns find spans, the LLM rewrites only those, spoken text stored beside the original); an
  import that reads EPUB semantics; one cast for the whole book with aliases and gender before
  Analyze; previous answers shown to the next piece; LLM-proposed pronunciations for scanned
  names; heteronyms by sense; a scene field and intensity in direction; ModernBookNLP as a second
  opinion; cited character profiles for casting.

### 10.13 Every speech engine's licence, read at its source (2026-10-11)

One question per engine: can a person sell an audiobook they made with it, on their own machine?
Three agents read each model card, licence file and linked GitHub repo (curl and the HF API, quotes
verbatim); the load-bearing claims below were re-read by hand (✓). The answers are written into
each family's `server/src/engines/audiocpp/curated/<family>.js` `LICENCE` (TASKS "Every speech
engine's licence in plain words"). audio.cpp's table (`docs/model_licenses.md`) reads a licence's
title; ten of 32 answers differ from it (eight until "Separate licence" was added the same day).
— *agent + web, 2026-10-11*

- **Differ from audio.cpp's table:**
  - **Higgs Audio 3** — table "No"; ours **Conditional**. Section II-A's Creator Use Grant lets a
    "Digital Creator" monetize audiobooks, podcasts and videos "on channels You own or control",
    no revenue cap, crediting "Boson AI's Higgs Audio" visibly; a separate written licence is
    needed for (i) "making the Higgs Materials available to others … end-user application" and
    (iii) "embedding or integrating the Higgs Materials in a product, application, or service made
    available to third parties". The licensee is "the individual or entity exercising rights",
    bound "by accessing, using…"; "integrating" is not defined. Quantized versions are "Derivative
    Works" distributable only for research or non-commercial use. (✓ LICENSE, last updated
    2026-07-08.)
  - **IndexTTS 2 / 2.5** — table "Conditional"; ours **Unclear**. The caps: the English §2.2 says
    "RMB 1 billion", the Chinese §2.2 says "1亿人民币" (RMB 100 million), and "the Chinese-language
    version shall prevail" (✓ both files). The runtime loads a semantic codec
    (`../audio.cpp/src/models/index_tts2/assets.cpp:72-77`) that upstream fetches from
    `amphion/MaskGCT`, licensed `cc-by-nc-4.0` (✓ HF API); bilibili's §4.1(b) leaves third-party
    weights to the user. §3.4(c): no improving other AI with the model or its Derivative Works,
    which §1.5 says include outputs. No registration below the caps.
  - **FireRedTTS3, FireRedAudio** — table "Yes"; ours **Unclear**. Apache-2.0, but both READMEs:
    "this capability is intended **solely for academic research purposes**" of zero-shot cloning
    (✓), the only task JustVoice offered them for until 2026-10-15; FireRedTTS3 issue #12 and HF
    discussion #7 were closed by their asker on 2026-10-12 UTC with no reply. Since the adoption
    plan's slice 2 FireRedAudio's recogniser is offered too (`firered_audio_asr`); recognition is
    outside that sentence (plain Apache-2.0), so the recogniser reads **Yes** from the family
    file's `RECOGNISER_LICENCE` (`engineFacts` takes it for an `stt` engine; 2026-10-15).
  - **AuK** — table "Yes"; ours **Separate licence** (was: **No** — until "Separate licence" was
    added, 2026-10-11, TASKS "A fifth commercial-use word"). Tencent's weights are MIT, but AuK
    needs Qwen2.5-Omni-3B as its encoder (audio.cpp packages `qwen2.5-omni-3b-*.gguf`, ✓
    `../audio.cpp/docs/community_models/auk.md:17-31`), whose licence is `qwen-research` (✓ HF
    API): "FOR NON-COMMERCIAL PURPOSES ONLY" and "If you are commercially using the Materials,
    you shall request a license from us".
  - **Fish Audio S2, Breeze TTS 2** — table "No"; ours **Separate licence**: each licence grants no
    commercial rights and names the separate written licence its maker offers — Fish (2026-03-07):
    "Any use of the Fish Audio Materials or Derivative Works for a Commercial Purpose requires a
    separate written license agreement from Fish Audio", where Commercial Purpose includes any use
    "in connection with a product or service for which You charge a fee or generate revenue";
    Breeze (v1.1, 2026-09-01): "Any Commercial Purpose involving the Model Materials, a Derivative
    Model, or an Output requires a separate written commercial license from BreezeBlue", and "this
    Agreement does not include a creator, content monetization, small-business,
    revenue-threshold, or other implied commercial-use exception"; audio made on BreezeBlue's paid
    hosted service may be sold.
  - **ZipVoice** — table "Unclear" ("the model card states no license"); ours **No**. A License
    section was added to the card on 2026-10-10: "The pre-trained model is licensed under the
    CC-BY-NC due to constraints from its training data (Emilia)" (✓); a maintainer confirmed it on
    GitHub issue #190. The GGUF JustVoice offers (davidxifeng) still claims Apache-2.0.
  - **MOSS-TTSD** — not in the table; ours **Yes**: the GGUF is made from MOSS-TTSD v1.0,
    Apache-2.0 on HF and GitHub.
  - **VieNeu-TTS v3 Turbo** — not in the table; ours **Yes**: Apache-2.0, and its card's FAQ says
    audio "may be used in commercial and monetized content" (✓). JustVoice downloads upstream's
    own GGUF (`pnnbao-ump`); the third-party GGUF's card says CC-BY-NC-4.0.
- **No, as the table says** (no commercial licence offered on their pages): Echo TTS (its
  author: "audio outputs are CC-BY-NC-SA-4.0 due to the
  dependency on the Fish Speech S1-DAC autoencoder") · OmniVoice (CC-BY-NC since 2026-07-03; its
  audio tokenizer is under the Boson Higgs Audio 2 Community License) · OuteTTS (CC-BY-NC-SA-4.0
  on top of Llama 3.2).
- **Conditional, as the table says:** DramaBox (LTX-2 Community License, 2026-01-05: any purpose
  under USD 10M yearly revenue; content must be disclosed as machine-generated; not in a product
  competing with Lightricks'; Gemma terms on the text encoder; an Acceptable Use Policy it names
  but doesn't link).
- **Yes, as the table says:** Kokoro, KittenTTS mini 0.8 (KittenTTS 2 is under a different
  licence), Qwen3-TTS, Qwen3-ASR, CosyVoice3 (its "academic purposes only" disclaimer covers the
  page's demo examples), Confucius4-TTS, dots.tts (Edit too, by the project's Apache-2.0),
  GLM-TTS (card MIT, code Apache-2.0), MioTTS, the three MOSS-TTS, Audio8, Irodori (its author on
  issue #32: "feel free to use it, including for commercial purposes"), Chatterbox (every output
  watermarked by Resemble's Perth — **wrong for JustVoice**: Resemble's own package adds it,
  audio.cpp doesn't; no PerTh code in its `src/`, and `curated/chatterbox.js` says so —
  corrected 2026-10-15), VoxCPM2 ("free for commercial use"), VoxCPM1 (Apache-2.0 and
  "free for commercial use", though its card's Risks section says "released for research and
  development purposes only" — read as a caution, ✓), Pocket TTS (CC-BY-4.0 behind Kyutai's gate,
  which forbids cloning without "explicit and lawful consent" and passing output off as genuine
  recordings; cosette and jean are non-commercial and already left out).
- **The four that v0.9.1 brought** (read at their source 2026-10-13, curl of each file; ✓ by
  hand): **Kitten TTS 2** — **Conditional**, as the table says: the Stellon Labs Community
  License (last updated 2024-07-05; the GGUF repo `dignome/kitten_tts2` carries the same file,
  byte for byte) grants commercial use, but "If You are using or distributing the Stellon Labs
  Materials for a Commercial Purpose, You must register with Stellon Labs by contacting us",
  and every licence ends once You or Your Affiliates make "more than USD $1,000,000 in annual
  revenue" or have "received more than USD $1,000,000 in total cumulative funding"; outputs are
  yours ("You own any outputs"); its decoder (Resemble's Chatterbox Turbo S3) and speaker
  encoder (pyannote) are MIT. **KugelAudio-0-Open** — **Yes**: "This model is released under
  the MIT License", audiobooks listed under its appropriate uses; trained on YODAS2 (CC-BY-3.0
  on HF); built on Microsoft's VibeVoice; no cloning from a clip in this release, only its
  pre-encoded voices. **LFM2.5-Audio** — **Conditional**, as the table says: the LFM Open
  License v1.0 grants Commercial Use only to a You "not exceeding the Threshold", "annual revenue
  of 10 million United States dollars ($10,000,000) or more"; its audio encoder (NVIDIA
  canary-180m-flash) and Kyutai Mimi weights are CC-BY-4.0. **Sopro V2 Turbo** (new to the list
  because v0.9.1 points its package at a GGUF that exists) — **Yes**: Apache-2.0 on its card;
  trained on Emilia YODAS (the dataset's HF metadata says CC-BY-4.0; its card is gated, not
  read), LibriTTS-R and FalAR; its maker: "do not impersonate people", no watermark.
- **Worth knowing, not in the answers:** many cards ask for consent before cloning and for
  AI-generated audio to be marked; MioTTS and MioCodec list Emilia (CC-BY-NC) among their training
  data while licensing Apache-2.0 — the reason OmniVoice and ZipVoice give for going
  non-commercial; Audio8's `tokenizer.json` is byte-identical to Fish S2 Pro's (Fish's model type
  is `fish_qwen3_omni`, so the file may be Qwen3's own tokenizer — not checked);
  Confucius4-TTS's training used a MaskGCT semantic codec, which inference does not load.

- Habibi-TTS (F5-TTS's Arabic models): Unified, SAU and UAE are CC-BY-NC-SA-4.0 ("restricted by
  SADA and Mixat"); ALG, EGY, IRQ, MAR and MSA are Apache-2.0; F5-TTS's base is CC-BY-NC-4.0 —
  so the app says Conditional. VoiceTut-TTS's card says Apache-2.0; it is listed under
  OmniVoice's engine, whose word is No. — *HF cards, 2026-10-15*.

- **The 34 families the adoption plan's slice 2 offers** (11 speaking, 23 recognising; read at
  their source 2026-10-15, curl of each card, licence file and the HF API, GitHub where the card
  points; ✓ by hand). Until then they showed audio.cpp's table word; each now has a curated
  `LICENCE`. **Differ from the table:**
  - **Maya1** — table "Yes"; ours **Conditional**. The card says Apache-2.0, but its first
    versions (2025-10-30 to 11-01, rev `3b3d6bb0`) gave `base_model: meta-llama/Llama-3.2-3B`
    and "we pretrained a 3B-parameter Llama backbone"; the line went on 2025-11-02 (`c881ccf1`),
    and `config.json` is Llama 3.2 3B's shape with Llama 3's token ids. Llama 3.2's licence: a
    licence from Meta above "700 million monthly active users"; use must "adhere to the
    Acceptable Use Policy". SNAC decoder MIT.
  - **sanoTTS** — table "Yes"; ours **Unclear**. The card: "the project as a whole is GPLv3";
    its GGUF README: "Weights are distilled from Apache-2.0 (Kokoro) and MIT (piper) teachers".
    Piper's own voice cards disagree: hfc_female, tr dfki, hi pratham CC-BY-NC-SA-4.0, ru irina
    "Unknown", most "Finetuned from U.S. English lessac voice". heart/heart-nano (Kokoro) and
    kristin (LibriVox, "public domain", trained from scratch) are clear.
  - **Supertonic 3** — table "Yes"; ours **Conditional**. OpenRAIL-M Attachment A(e): no content
    put out "without expressly and intelligibly disclaiming that the information and/or content
    is machine generated"; (g) no impersonating others "without their consent".
  - **VibeVoice** — table "Yes"; ours **Unclear**. MIT, but the card: "The VibeVoice model is
    limited to research purpose use" and "We do not recommend using VibeVoice in commercial or
    real-world applications"; GitHub, 2025-09-05: "we have removed the VibeVoice-TTS code from
    this repository". Microsoft's 7B is gone (401); JustVoice's comes from `vibevoice/VibeVoice-7B`,
    "duplicated from" a community re-upload. audio.cpp adds no watermark or spoken disclaimer.
  - **CrisperWhisper 2.0, Hviske v5.3** — table "No"; ours **Separate licence**: nyra health's
    licence covers weights "and any Outputs", Non-Commercial only, and "Licensor expressly offers
    such commercial licenses" (licensing@nyra-labs.com); Hviske v5.3 (CC-BY-NC-4.0): "Commercial
    licensing: contact mads@syv.ai".
  - Maya1, sanoTTS, Supertonic and VibeVoice were close calls; each takes the cautious word.
- **Same word, other facts:** Confucius4-R2T2 Conditional, but its cap is the Chinese text's
  "1亿人民币" (RMB 100 million), not the English "RMB 1 billion", and "the Chinese-language
  version shall prevail" — as IndexTTS's; Parakeet-TDT Yes, but audio.cpp's catalog row for the
  family is Phonon-2's (the last of the table's three `parakeet_tdt` rows) while JustVoice
  downloads NVIDIA's parakeet-tdt-0.6b-v3 ("ready for commercial/non-commercial use") — its
  curated `LICENCE` links NVIDIA's card; NeuTTS Conditional (USD 5M; its card's Perth watermark
  is not applied by audio.cpp — no Perth code in `src/`, its bench sets `tts.watermarker =
  None`); Niagara Conditional (USD 1M with affiliates, then "thereafter limited to
  non-commercial research"); Piper Unclear (the Lessac licence excludes "any commercial purpose,
  including the … sale or licencing of voice synthesis … products"); Voxtral TTS No ("the
  license that the model inherits"); Hviske v6 No (no commercial route named).
- **Yes, as the table says:** Inflect v2, MagpieTTS ("Models are commercially usable"),
  MOSS-VoiceGenerator, Soprano, Canary, Citrinet, Cohere Transcribe (click-through gate), GigaAM,
  Granite Speech 5.0, Higgs Audio v3 STT, Index-Echo (Index-Translate's Apache-2.0), Kroko
  (CC-BY-SA, stated in prose; LICENSE empty), Moonshine Streaming, MOSS-Transcribe-Diarize,
  Nemotron 3.5 (OpenMDW-1.1: "without restriction"), OWSM, OWSM-CTC, SenseVoice (FunASR licence:
  credit source and authors, keep the name), VibeVoice ASR and ASR Streaming, Voxtral Realtime.
- **Worth knowing:** MagpieTTS trained partly on Emilia (CC-BY-NC); Inflect's voice is synthetic
  from an undisclosed source; Soprano's 1,000 hours are unnamed; Hviske v5.3's GGUF is
  `mirek190/audio.cpp`'s, whose card says Apache-2.0; SenseVoice's own GGUF repo says
  apache-2.0. — *agent + web, 2026-10-15*

### 10.14 The download test — every speech model through the app (2026-10-11)

The engine list's slice 2 acceptance (TASKS "Build the engine list", answer 7): through the
running dev app's own routes (`npm run dev`, our audio.cpp checkout, RTX 2070 SUPER 8 GB), each
model's default download is fetched, loaded, and speaks one line in a copy of the frozen Hatter
(VoxCPM2 "Test · Hatter (slice 0)", its clip and transcript); the TTS slot is then freed, every
take is read back by Qwen3-ASR 1.7B (`/v1/transcribe`), and what the run downloaded is deleted
(a model already on disk is kept). Match = the longest common subsequence of words (English) or
characters (Japanese, Chinese) as a share of the line. It measures that the words came out
intelligible to the recogniser, not that the voice matched the clip. A licence that gates
downloads was accepted for the test only and cleared after (the user's word: option A). The
harness is a scratch script, not in the repo. — *measured, 2026-10-11*

| Model (q8 unless named) | Download | Loads on | Speaks | Read back |
|---|---|---|---|---|
| MOSS-TTS Nano | 184 MB | CUDA, 3 s | 2 s | 100 % |
| VoxCPM1 | 809 MB | CUDA, 4 s | 3 s | 100 % |
| Irodori-TTS (Japanese) | 1.3 GB | CUDA, 6 s | 2 s | 88 % (帽子屋 heard as ボーシャ) |
| Audio8 TTS | 1.4 GB | CUDA, 6 s | 4 s | 100 % |
| CosyVoice3 (on disk already) | — | CUDA, 10 s | 2 s | 93 % ("Hatter" heard as "header") |
| dots.tts SOAR (Chinese — the harness picked zh for a "multilingual" list) | 2.8 GB | CUDA, 8 s | 7 s | 100 % |
| GLM-TTS | 4.9 GB | CUDA, 5 s | 5 s | 100 % |
| MioTTS 1.7B | 2.1 GB | **failed**: "model path does not exist: …\Temp\audiocpp-gguf\MioCodec-25Hz-44.1kHz-v2" | — | — |
| MioTTS 1.7B, with its codec (after the fix) | 2.4 GB | CUDA, 9 s | 2 s | 100 % |
| Higgs Audio v3 TTS 4B | 4.9 GB | CUDA, 8 s | 3 s | 100 % |
| IndexTTS2 | 3.5 GB | CUDA, 13 s | 7 s | 100 % |
| IndexTTS2.5 | 3.3 GB | CUDA, 12 s | 4 s | 100 % |
| Breeze TTS 2 | 4.8 GB | CUDA, 11 s | 7 s | 100 % |
| ZipVoice (distill, original precision) | 527 MB | CUDA, 3 s | 2 s | 100 % |
| Echo TTS | 2.9 GB | CUDA, 3 s | 10 s | 100 % |
| Fish Audio S2 Pro | 6.0 GB | CUDA, 12 s | 6 s | 100 % |
| FireRedTTS3 Instruct (Chinese — the harness read its language *names* as no English) | 4.0 GB | CUDA, 6 s | 5 s | 65 % (帽匠 heard as 毛娟, 时钟 as 徐娟) |
| FireRedTTS3 Instruct, English | 4.0 GB | CUDA, 6 s | 4 s | 100 % |
| OuteTTS 1.0 1B (random seed) | 2.9 GB | CUDA, 8 s | **failed**: "OuteTTS generated no complete DAC code pairs" | — |
| OuteTTS 1.0 1B, seed 42, again | 2.9 GB | **refused**: "it needs ~6703 MB (+1024 MB safety margin) but only 7334 MB free of 8192 MB" — the first load's measured peak | — | — |
| OuteTTS 1.0 1B, seed 42, on the CPU | 2.9 GB | CPU, 5 s | **failed** after 2 min: the same "no complete DAC code pairs" | — |
| VieNeu-TTS v3 Turbo | 179 MB | CUDA, 5 s | 2 s | **0 %** — a 14.8 s take for a line the other models speak in 4–5 s, heard as Chinese |
| MOSS-TTS Local (2026-10-11) | 7.0 GB | CUDA, 29 s | **stopped**: the run and the app were stopped for low system memory | — |
| MOSS-TTS Local, again (2026-10-12) | on disk | CUDA, 30 s | 66 s (a 3.9 s take) | 100 % |
| Confucius4 TTS (original precision) | 7.6 GB | CUDA, 12 s | 5 s | 100 % |
| OmniVoice (Auto) | 1.3 GB | CPU, 3 s — "audio.cpp says it needs about 10 GB, more than this card's 8 GB"; RAM 17.2 → 15.9 GB free | **failed**: "OmniVoice native voice clone currently requires reference_text when reference audio is provided" | — |
| OmniVoice (Auto), sent the clip's words (2026-10-12) | 1.3 GB | CPU, 4 s — the same reason | 80 s (a 4.6 s take) | 100 % |
| Higgs Audio v3 TTS 4B, sent the clip's words (2026-10-12) | 4.7 GB | CUDA, 8 s | 3 s (a 4.3 s take) | 100 % |
| AuK base f32 (Auto) | 5.7 GB | **failed**: "GGUF for family 'auk' does not embed an audio.cpp model spec: …auk-base-f32.gguf. Published GGUF packages must embed a model spec; regenerate the GGUF or pass --model-spec-override." | — | — |
| MOSS-TTS v1.5 q8 · MOSS-TTSD q8 · FireRedAudio q8 · DramaBox q8 | 12.3 · 12.1 · 13.0 · 17.6 GB | **not loaded**, by the user's choice after the low-memory stop: more than the 8 GB card, and on the CPU 12–18 GB of weights against about 17 GB of free RAM — three of the four might have fit; untested | — | — |

Takes that read back ran 3.6–5.6 s for the line (read from each WAV's header; models write 16–48 kHz, mono
or stereo). Durations first recorded here from a 24 kHz mono reading were wrong and are
corrected above.

- **OuteTTS** clones from a clip plus its exact words, with a forced aligner inside the standalone
  GGUF; "For CUDA voice cloning, quantized weights … are expanded to F32 in VRAM to avoid
  generation divergence", and its cloning defaults — temperature 0.4, seed 42 for a quantized model
  — "were separately verified" (`../audio.cpp/docs/community_models/outetts.md:47-111`). JustVoice
  sends a random seed when none is set. The GGUF JustVoice fetches is a third party's
  (`mirek190/audio.cpp`, `Llama-OuteTTS-1.0-1B_Q8.gguf`, 3.0 GB, pinned at revision
  `94bbade1`), the one the doc names for direct download.
  The cause, found with audio.cpp's own command-line tool (2026-10-12, question 2, "Run the
  OuteTTS command-line check?" — the user: "your rec on all go"): **OuteTTS's generation is fragile with the Hatter's voice — not
  the file, and not JustVoice's request.** The same file (sha256 `b0529271…`, as pinned), the
  Hatter clip and its transcript, the Hatter line, `--task tts` as JustVoice loads it:
  - the v0.9.0-jv.4 release's `audiocpp_cli` (`--task clon` and `--task tts`, no seed) and
    the app's own jv-dev build (`audiocpp_cli` built into `build/jv-dev`; it needs
    `--model-spec-override model_specs/outetts.json`, not being a deployment build) speak it —
    read back "Vatter checked his watch twice, and poured the tea, and laughed at luck." (4.5 s);
  - on CUDA, by seed: 42 speaks; 1, 2, 3, 7, 100, 2026, 4099, 12345, 987654321 and 1801439850
    all fail with "no complete DAC code pairs" and the same first tokens
    (`71,1683,13,133322,133325,27,91,17947,53623,91,1822,91`); with no seed, audio.cpp uses
    42 for a quantized clone (`session.cpp:198-201`), which is why the tool spoke and JustVoice
    — a random seed per take, `slot.js` `toSpeechRequest` — did not;
  - seed 42 on the CPU fails too, as it did in the app;
  - seed 42 on three other lines: two speak, one ("Alice was beginning to get very tired of
    sitting by her sister on the bank.") fails;
  - audio.cpp's own sample clip (`assets/resources/b.wav`, its transcript from
    `docs/reports/outetts_validation.md`) on the Hatter line: seeds 1, 2, 3, 7 and 42 all speak;
  - the Hatter clip says its transcript (read back by the app's Qwen3-ASR: "Ah, that accounts
    for it. He won't stand beating. …"), so the words given are right.
  The load warning — "embeds a legacy model spec … Regenerate the GGUF" — is harmless: upstream
  still ships the same file as OuteTTS's default (`model_specs/outetts.json` on upstream main,
  2026-10-12). No upstream issue reports the error. Left off the list (TASKS "The download
  test's last findings").
- **The clip's words reach only a model whose spec lists `reference_text`.**
  `generatedSpeechRequest` sends them when `specOpts.has("reference_text")` (`slot.js:1014`),
  so a family whose spec lists no request options at all never gets them. A listing family
  refuses an option it doesn't list (dots.tts, FireRedTTS3 — §10.6); one with no listing reads
  whatever options its own code looks up (`runtime::find_option(request.options, …)`). Six
  generated families list none (2026-10-12): Higgs, IndexTTS2, MioTTS, MOSS-TTS Local,
  MOSS-TTS Nano, OmniVoice. Of these, OmniVoice requires the words
  (`src/models/omnivoice/prompt_builder.cpp:774`), and Higgs reads them — its doc: "transcript
  through `--reference-text` when known" (`docs/models/higgs_audio_tts.md:30`,
  `src/models/higgs_audio_tts/session.cpp:253,327`). MOSS-TTS Nano stores them
  (`moss_tts_nano/session.cpp:429`) but builds its clone prompt from the clip's codes alone
  (`prompt_builder.cpp` `build`), so they change nothing there. IndexTTS2, MioTTS and MOSS-TTS
  Local don't read them (no `reference_text` in their source folders). audio.cpp takes the words
  as a top-level `reference_text` for every model (`app/server/runtime.cpp:2145`). Since
  2026-10-12 a spec that lists no options gets them too (TASKS "The download test's last
  findings").
- **AuK is several files, and JustVoice fetches one.** audio.cpp loads AuK from a folder —
  "Pass the directory to `--model`; choose components with the session options below. The
  defaults are Qwen BF16, AuK base F32, and VAE F32" — and "The native model manager exposes
  each generator, Qwen, and VAE component as a separate download"
  (`../audio.cpp/docs/community_models/auk.md`). JustVoice downloads the base package only
  (5.7 GB) and passes its one GGUF as the model, which audio.cpp refuses. The parts: base f32
  5.71 / f16 2.86 / q8 1.54 GB, Qwen2.5-Omni-3B bf16 6.95 / q8 3.97 GB, VAE f32 0.60 GB — the
  defaults 13.3 GB, the smallest set 6.1 GB. Cloning from a clip without a voice description
  also needs more than the words: "Without `instruct`, `--text` must contain the complete
  upstream instruction, not just the words to speak." Catalog status: experimental.
- **System memory before a load** (2026-10-12). Until then the speech manager checked only the
  card's memory; nothing checked system RAM, and Auto sends a model whose estimate is more than the
  card to the CPU — MOSS-TTS v1.5 (est. 18 GB, 12.3 GB of weights) and DramaBox (est. 16 GB,
  17.6 GB) would load there on a machine with less RAM free. What was built the same day (TASKS
  "The download test's last findings" 4(a) and 4(b), "The two-day review's fixes"):
  - before any load, `manager._admitSystemMemory` checks the larger of the model's files (on the
    CPU) and the memory it held at its last loads here (`_ramPriceMb`, the `"ram_peak"` rows
    with `ram_model_mb`), plus the safety margin, against the memory free — crediting the
    occupant it replaces, and the AI models' memory when the load may push them off the card (the
    kit's `modelServersRamMb()`: the router's process tree less the router), then checking again
    without that credit right before the slot starts. Before the credit, the check ran ahead of
    the card's admission and refused loads it would have made room for;
  - the readings are the slot's own process, through the kit's per-process probe
    (`hardware.processTreeRssMb` — `tasklist`'s working set on Windows, `/proc` on Linux,
    `ps` on macOS; the process tree through PowerShell's `Get-CimInstance` where `wmic` is gone,
    as on this machine), once the load is done and again after each line in the card re-check's
    background pass, raise-only. Nothing else running counts. A working set includes the model
    file's mapped pages the system could drop, so it errs high.
  Measured: Kokoro 82M q8 on the CPU 662 MB once loaded and 951 MB after one line (its files are
  0.2 GB; the runtime's own process counts in); VoxCPM2 q8 on CUDA 3,237 MB (its card peak
  2,935 MB). With gemma 4 26B back on the card (9.3 GB free), VoxCPM2 loaded again: the card's
  admission pushed gemma off and the load went through. Earlier, whole-machine differences across
  a load (replaced by the per-process readings): MOSS-TTS Local (7.0 GB) took about 5.7 GB to load
  on CUDA and about 5 GB more while it spoke; Confucius4 (7.6 GB) showed none; OmniVoice (1.3 GB)
  on the CPU 1.3 GB.
- **Which memory number** (2026-10-12, the check before option C — TASKS "The two-day review's
  fixes"). audio.cpp copies each tensor out of the file mapping into its own buffers
  (`src/framework/assets/tensor_source.cpp`, `ggml_backend_tensor_set`); the mapping
  (`src/framework/io/binary.cpp`: `MapViewOfFile` / `mmap`, read-only) is released after
  loading by Kokoro, MOSS, OmniVoice and IndexTTS2 (`release_storage()`) and kept by VoxCPM2 and
  Higgs. The runtime is one long-lived server per placement and kind (`slot.ensureServer`: card
  or CPU × speech or recognition), loading and unloading models inside it. Read through the app
  (working set / private bytes, Windows `PrivatePageCount`):
  | Server | Working set | Private |
  |---|---|---|
  | card, nothing loaded | 470 MB | 826–1,056 MB |
  | card, VoxCPM2 q8 loaded / after a line | 3,316 / 3,313 MB | 9,409 / 9,618 MB |
  | card, Kokoro q8 loaded / after a line | 513 / 524 MB | 4,855 / 5,269 MB |
  | CPU, nothing loaded | 188 MB | 413 MB |
  | CPU, Kokoro q8 loaded / after a line | 655 / 947 MB | 4,337 / 4,623 MB |
  Private bytes run four to nine times the working set: audio.cpp commits large pools up front
  (its session options size them, e.g. OuteTTS's `llama_weight_context_mb` 4096,
  `dac_graph_arena_mb` 1536) and touches little of them. So refusing on private memory (option C)
  would refuse far more wrongly than the working set; not built. Private bytes are what counts
  against Windows' commit limit (RAM + page file) — the point where an allocation fails outright
  rather than pages — a separate risk no check reads today.
- **llama.cpp and the AI model's door** (2026-10-12). At the kit's pinned build (b11239),
  `src/llama-model-loader.cpp` allocates a CPU tensor directly inside the file mapping when mmap
  is on (`ggml_backend_tensor_alloc(buf_mmap, cur, mapping->addr() + offs)`, lines ~1641-1658) —
  used in place, file-backed — and copies card tensors. But the kit's own presets
  (`data/ai-runtime/models.ini`) load gemma 4 26B A4B with `load-mode = none` (no mapping: the
  weights read into the process's own memory; the seeded MoE preset sets `no_mmap`,
  `llm/seed.js:199`) and gemma 4 12B with `load-mode = mmap+mlock` (mapped and locked). Neither
  leaves droppable pages, so the premise of the kit's RAM ruling — "weights are mmap'd →
  evictable → a summed ledger OVER-counts … hence §8.18: DISPLAY-ONLY in v1, enforcement only on
  evidence (mlock/no_mmap-keyed)" (`docs/plans/2026-08-09-fit-redesign.md` §13.12) — doesn't hold
  for the models the kit loads by default; §8.18 itself names mlock/no_mmap as the evidence that
  allows enforcing. (Whether Windows keeps the 12B's mlock is unverified: the kit strips an inert
  mlock there, `process.js:299`.)
- **The 26B's RAM against its claim** (2026-10-12, the measurement before checking the AI
  model's door). The kit's RAM claim for an AI model is its Min-RAM floor, `minRamMb` = the
  whole file + the 4,096 MB headroom (`llm/identity.js` `computedRowNumbers`: "dense and MoE
  both end up holding the file"). gemma 4 26B A4B, warmed at boot through the app, launched
  `--load-mode none --n-gpu-layers 31 --n-cpu-moe 21 --ctx-size 32768`, KV q8_0, the MTP draft:
  | | MB |
  |---|---|
  | claim (`minRamMb`) | 17,685 |
  | working set, settled = its peak working set | 9,838 |
  | private bytes | 16,836 |
  The claim is about 7.8 GB above what the process holds in RAM: the non-expert weights and 9 of
  the 30 layers' experts live on the card, and the claim charges the whole file. Private bytes
  sit near the claim, but private bytes ran four to nine times the working set for the speech
  runtime too ("Which memory number"), so they aren't the measure. A check on this claim would
  refuse the 26B on a machine with 10–17 GB free, where it fits.
  **The computed CPU-held share tracks the placement** (same day, the check before building the
  door). The kit stores the 26B's exact split (`model_catalog`: experts 12,251 MB, other layer
  weights 927 MB, output 396 MB; the input side 396 MB, "always on the CPU" — `runner/gguf.js`).
  Two placements, each loaded through the app's `/v1/llm-runner/load`, settled:
  | `--n-cpu-moe` | experts on the CPU (computed) | working set | above the experts |
  |---|---|---|---|
  | 21 (the tuned default) | 8,576 MB | 9,836 MB | 1,260 MB |
  | 25 (an override) | 10,209 MB | 11,471 MB | 1,262 MB |
  Four more layers' experts added 1,635 MB against 1,633 computed. Above the experts sits a
  constant ~1.26 GB: the input side (396 MB) and ~865 MB of buffers. So the input side + the
  CPU layers' experts + the 1,024 MB safety margin (9,996 MB at 21) covers the measured 9,836.
  "Beside a speech model" is not a placement the kit makes: with VoxCPM2 q8 on the card the
  26B's load evicted it (`arbiter make_room: evict LRU tts:voxcpm2 (tts, 2937 MB)`) and kept
  its tuned flags. A sleeping 26B (after `--sleep-idle-seconds 900`) holds 371 MB of RAM; the
  next request wakes it through `_admitWake`, not the load path.
- **What Shared Usage shows** (2026-10-12, before building the spill check). WDDM's per-process
  `\GPU Process Memory(pid_*)\Shared Usage`, through the app:
  | Process | Dedicated | Shared |
  |---|---|---|
  | speech server, Kokoro q8 on the card | 567 MB | 78 MB |
  | speech server, VoxCPM2 q8 on the card | 2,937 MB | 78 MB |
  | speech server, after VoxCPM2 was evicted | 103 MB | 78 MB |
  | llama-server, the 26B asleep | 111 MB | 78 MB |
  | llama-server, the 26B loaded (`--n-cpu-moe 21`) | 6,865 MB | 9,316 MB |
  The speech server sits at 78 MB whatever fits on the card, so a spill shows as growth across
  a load. llama.cpp's 9.3 GB is not a spill: it holds its CPU-side weights in pinned host memory
  (about the CPU-held share above), which WDDM counts as shared — so Shared Usage is a spill
  signal for audio.cpp, not for llama.cpp.
- **Forcing a spill and a refusal through the app** (2026-10-13, the live check of the CPU
  retry and the RAM door). With `spill_mb` at 0, VoxCPM2 under Auto loaded on the card: the
  speech server's Shared Usage was 78 MB before and after, so no growth and no retry. A second
  llama-server (the 12B, `-ngl 36`) holding 6,490 of the card's 8,192 MB *before* the load:
  Auto still said "nothing else is on the graphics card" (`placementFor` weighs only the AI
  model and the price) and the card's admission refused at once — "not enough memory to load
  voxcpm2: it needs ~2937 MB (+1024 MB safety margin) but only 1703 MB free … Resident:
  gemma-4-26b-a4b-qat (6834 MB · asleep)" — no CPU retry (a refused booking isn't a failed
  load), and the message names the sleeping AI model, not the program that held the card.
  The same server started 0.5 s *after* the load began lost the race: VoxCPM2 took 2,935 MB
  dedicated at 78 MB shared, and llama.cpp b11239 fitted itself to what was left (2,953 MB
  dedicated, 486 MB shared). So a real spill or a failed card load can't be forced from
  outside on this machine without a tool that grabs the card mid-load; those two paths stay
  unit-tested only. The RAM door, forced: the 26B stopped, a script holding 11,776 MB left
  7,166 MB free, and the load ended in the runner's error "not enough memory to load
  gemma-4-26b-a4b-qat: it took about 9.6 GB of this machine's memory when it last loaded here
  (+1024 MB safety margin) but only 6.9 GB of this machine's 31.9 GB is free. Close other
  programs, or pick a smaller model." — the approved words, by the measured reading; with the
  script stopped it loaded. — *measured through the app, 2026-10-13*.
- **OmniVoice fits the card** (2026-10-12): pinned to the GPU it loaded in 6 s, spoke the line in
  3 s and read back 100 %; the card's memory in use went 700 → 1,928 MB (about 1.2 GB) and its
  server's RAM 526 MB. On the CPU (Auto, by audio.cpp's 10 GB estimate) the same line took 80 s
  (0.06× real time). The card peak wasn't saved: the per-process card probe returned nothing at
  the load, and the device-wide difference was booked but by design never persisted — so Auto
  never learned it fits. Since 2026-10-12 a calibrated load saves that difference as its price
  when the probe misses (`manager.js` load, the row labelled "the whole card's difference") — but
  a generated model never calibrates (`slot._warm`), so OmniVoice's own load still saves nothing:
  not fixed for OmniVoice (corrected 2026-10-13, the narrowings review M1; calibrating generated
  families is in the adoption plan).
- **A CUDA load on Windows may not fail when the card runs out** (checked 2026-10-12, for "try
  the card first, fall back to the CPU if the load fails"). NVIDIA's support text, as quoted on
  Guru3D: driver 536.40 added a way for applications "to use shared memory when GPU memory was
  exhausted … applications which previously crashed when running out of GPU memory [can]
  continue to run, albeit at lower speeds"; 546.01 added the switch to turn it off (NVIDIA
  Control Panel → Manage 3D Settings → "CUDA - Sysmem Fallback Policy" → "Prefer No Sysmem
  Fallback"). Third-party guides say it is on by default; no NVIDIA page found states the
  default. So on Windows a model too big for the card can load and run slowly out of system
  memory rather than fail — a failed load is not a reliable signal there. The per-process
  counter `\GPU Process Memory(pid_*)\Shared Usage` would show the spill.
  Sources: https://forums.guru3d.com/goto/post?id=6180414 ·
  https://docs.cognex.com/deep-learning_400/web/EN/deep-learning/Content/Topics/optimization/gpu-disable-shared.htm ·
  https://llmconfigurator.com/en/guides/troubleshooting/windows-shared-gpu-memory-slow
- **audio.cpp's estimate is one per model, shared by its precisions** (`min_vram_gb` on the
  catalog entry). For eight downloads it is below the files themselves (GB of files / estimate):
  DramaBox q8 17.6 / 16, FireRedAudio q8 13.0 / 10 and original 23.3 / 10, FireRedTTS3 Instruct
  and Base original 11.4 and 11.5 / 8, Fish S2 bf16 9.5 / 8, Higgs bf16 7.9 / 6, MOSS-TTS Local
  bf16 12.4 / 8. MOSS-TTSD (12.1 GB) has none. Since 2026-10-12 a generated model needs the
  larger of the two (`generated.needOf`).
- **FireRedTTS3** lists its languages by name ("Chinese", "English", … and 23 Chinese dialects
  as `ZH_<province>`), not codes; JustVoice counts them as 47 languages.
- **System memory, not the card's, stopped the 2026-10-11 run.** Measured on the rerun: MOSS-TTS
  Local on CUDA took 17.6 → 11.9 GB of free RAM to load and fell to 6.9 GB while speaking —
  about 11 GB of system RAM for a model held on the card. The AI model (gemma 4 26B A4B) warms
  at boot: at this restart llama-server held 16.8 GB of private bytes and free RAM was 7.9 GB
  before any speech model loaded. Whether it was resident when the run was stopped isn't known
  (the load before it had found the card empty). From the rerun on, the test unloads the AI model
  before each load (the kit's `POST /v1/llm-runner/stop`), frees the speech slot after each
  model, and skips a load with under 4 GB of RAM free.
- **MioTTS** needs MioCodec for acoustic decoding through `miotts.codec_model_path`
  (`../audio.cpp/docs/models/miotts.md:3-13`; the default is a sibling folder,
  `src/models/miotts/session.cpp:84-87`); its spec doesn't list it. Fixed by downloading the
  `miocodec_q8_0` package with it (TASKS "The download test's first findings").
- **VieNeu** reads SEA-G2P phonemes, not text, and needs a 192-d speaker embedding from a CAM++
  encoder audio.cpp hasn't ported — "Without it the embedding is all zeros and the voice will not
  match" (`../audio.cpp/docs/community_models/vieneu_v3_turbo.md`). Left off the list.
- The first load unloaded the AI model ("it has no usable speed on the CPU, so the AI model makes
  room"); later loads found the card empty. Downloads ran at about 8 MB/s.

### 10.15 Slice 2's acceptance — the new models through the app (2026-10-15)

The adoption plan's slice 2 (`docs/plans/2026-10-13-adopt-everything-audiocpp.md` §5), on our
fork at upstream v0.9.2: 39 speech engines and 25 recognisers built from audio.cpp's
descriptions, 180 downloads between them; 108 built-in voices (8 of them *Model default*); 25
engines copy a voice from a clip; 6 design a voice (Breeze TTS 2, FireRedTTS3 Instruct,
FireRedAudio, Irodori v4.1, Irodori v3 VoiceDesign, MOSS-VoiceGenerator); 25 say *Can't be
directed yet*. Method as §10.14 (the running dev app's own routes, RTX 2070 SUPER 8 GB; read
back by Qwen3-ASR 1.7B; a recogniser's own transcript of the Hatter clip against its text).
Only models new since §10.14 were run — the user's ruling of 2026-10-15: "we only need to test
new engines and models when audio cpp changes no need to rerun full test". — *measured,
2026-10-15*

| Model | Download | Loads on | Speaks / transcribes | Read back |
|---|---|---|---|---|
| Supertonic 3 (built-in) | 433 MB | CUDA 10 s · 611 MB | 0.3 s | 100 % |
| NeuTTS (built-in) | 2.9 GB | CUDA 44 s · 2611 MB | 6.7 s | 93 % |
| MagpieTTS 357M (built-in) | 1.5 GB | CUDA 19 s | 1.8 s | 100 % |
| LFM2.5-Audio 1.5B (built-in) | 1.7 GB | CUDA 12 s | 1.4 s | 100 % |
| LFM2.5-Audio JP (Model default, ja) | 1.7 GB | CUDA 12 s | 1.5 s | 82 % |
| Piper · Inflect v2 · sanoTTS · Soprano (Model default) | 59 MB · 68 MB · 1 MB · 117 MB | CUDA 8–12 s | 0.1–0.6 s | 100 % each |
| Kitten TTS 2 (built-in) | 3.1 GB | CPU 14 s (finding 6) | 8.6 s | 100 % |
| Maya1 (Model default) | 6.4 GB | CPU 33 s (finding 6) | 72.8 s | 100 % |
| Voxtral 4B TTS (built-in) | 4.5 GB | CUDA 17 s · 5007 MB | 1.6 s | 100 % |
| KugelAudio q4k (built-in) | 5.5 GB | CPU — the run's full AI stop had cleared the kit's memory ledger | 28 s | 100 % |
| Breeze TTS 2 (design / clone) | 4.8 GB | CUDA · 3829 MB | 7.1 s / 6.6 s | 100 % / 100 % |
| FireRedTTS3 Instruct (design / clone) | 4.0 GB | CUDA · 4811 MB | 5.6 s / 3.6 s | 100 % / 100 % |
| FireRedTTS3 Base (clone) | 4.0 GB | CUDA 12 s | 4.7 s | 100 % |
| Irodori v3 VoiceDesign (design, ja) | 1.2 GB | CUDA 22 s | 1.4 s | 100 % |
| Irodori v4.1 (design / clone, ja) | 1.3 GB | CUDA | 1.3 s / 1.5 s | 100 % / 86 % (帽子屋 heard as ボスヤ) |
| Irodori v3 500M (clone, ja) | 1.0 GB | CUDA 11 s | 1.5 s | 77 % |
| MOSS-VoiceGenerator bf16 (design) | 5.7 GB | CUDA 23 s · 7703 MB | 3.9 s | 100 % |
| dots.tts MeanFlow (clone) | 2.8 GB | CUDA 11 s | 6.5 s | 100 % |
| Sopro (clone) | 302 MB | CUDA 11 s | 0.8 s | 100 % |
| ZipVoice (clone, a Chinese line with English words) | 527 MB | CPU — loaded while the card was still freeing the model before | 11.3 s | 74 % ("Apple Store", "iPhone" spoken in English, heard back in Latin letters; 三点 heard as 送你) |
| OmniVoice (clone, en), after fix 3 | 1.3 GB | CUDA 10 s | 2.8 s | 100 % |
| VoiceTut-TTS (clone, ar) | 1.3 GB | CUDA 10 s | first **failed**: "unsupported OmniVoice language 'ar'"; 2.9 s after fix 3 | 80 % |
| dots.tts SOAR (clone, en), after fix 3 | 2.8 GB | CUDA 11 s | 5.6 s | 100 % |
| F5 Habibi ×8 (clone, ar) | 1.3 GB each | CUDA 4–8 s | first: 4 of 8 **failed**, "bad allocation" (finding 4); 9.9–10.6 s each in a fresh process | 60–90 % (all drop the last word وضحك) |
| VieNeu-TTS v3 Turbo | 179 MB | **failed**: "requires a voice: --voice-ref, reference_codes_file, or speaker_embedding_file…" | — | — |
| VibeVoice 1.5B / 7B | 3.1 GB | **failed**: "VibeVoice prompt has no valid Speaker N: lines" | — | — |
| Qwen3-ASR 0.6B | 2.2 GB | CUDA 9 s · 2483 MB | 0.8 s | 100 % |
| Canary · Citrinet · Parakeet · Nemotron · Cohere · Confucius4-R2T2 · Higgs STT · LFM2.5-Audio ASR | 38 MB – 3.9 GB | CUDA | 0.1–0.9 s | 100 % |
| Granite5 · Kroko · Moonshine tiny/small/medium · Niagara 19M/38M · Hviske | — | CUDA | 0.3–0.7 s | 89–100 % |
| VibeVoice-ASR Streaming 1.5B | 3.2 GB | CUDA · 3113 MB | 1.0 s | 96 % (its text starts "Speaker 0:") |
| Voxtral Realtime | 4.9 GB | CUDA · 5401 MB | 2.1 s | 96 % |
| Index-Echo 2B | 4.9 GB | CUDA · 5875 MB | 3.0 s | 100 % (its text comes back as timed captions with a translation — finding 3) |
| CrisperWhisper · OWSM base/small · OWSM-CTC · MOSS-Transcribe-Diarize · Hviske v6 | 316 MB – 3.9 GB | CUDA | first **failed**: "requires SOXR"; 0.4–1.3 s after fix 2 | 93–100 % |
| OWSM medium | 3.7 GB | CUDA · 5509 MB | failed on SOXR; not re-run after fix 2 (the family of base and small) | — |
| LFM2.5-Audio JP ASR | 1.7 GB | CUDA 9 s | the English clip refused, "transcribes ja, not en"; 0.4 s on a Japanese take | 95 % |
| GigaAM ×6 | 421 MB – 1.1 GB | CUDA 9 s | the English clip came back in Cyrillic (0–29 %); 0.1–0.3 s on a Russian take | 100 % each |
| SenseVoice-Small | 242 MB | **failed**: "Silero VAD model path does not exist: assets\framework\models\silero_vad" | — | — |

Captions: with Citrinet loaded, `POST /v1/align` loaded Qwen3-ASR and returned 28 timed words in
13.3 s. Not run: FireRedAudio, MOSS-TTS v1.5, MOSS-TTSD and DramaBox (12–18 GB each, as in
§10.14) and VibeVoice-ASR (9.9 GB). Every licence accepted for the run was cleared after
(`terms_accepted_at: ""`), every download and test voice deleted.

- **The fork didn't build with MSVC** (fixed, fork `a1e139ff`): MSVC refuses a string literal
  over 16,380 characters (C2026), and CMake embedded each model spec as one literal;
  `qwen3_tts.json` reached 17,427 bytes. Each spec is now literals of at most 16,000 bytes.
- **A recogniser hears 16 kHz mono** (fixed, JV `cde4120`): audio.cpp's own page converts a
  recogniser's audio to 16 kHz before sending it (`webui/…/+page.svelte:1341`), and OWSM,
  OWSM-CTC, CrisperWhisper, MOSS-Transcribe-Diarize and Hviske v6 refuse any other rate without
  `libsoxr`, which the release doesn't ship.
- **A line's language goes in a form the family's list names, or not at all** (fixed, JV
  `cde4120`, `listedLanguage`): OmniVoice lists Arabic only as `arb`, `arz` …, never `ar`, and
  refused `ar`. Sending none is audio.cpp's page default ("auto"). OmniVoice ("600+ languages")
  and dots.tts ("multilingual") now get no language even for English; both read back 100 % in
  English.
- **Finding 1 — VieNeu and VibeVoice download but can't load.** VieNeu at v0.9.2 refuses to load
  with no voice (on 2026-10-11 it loaded and babbled, §10.14). VibeVoice takes a script of
  "Speaker N:" lines and a voice sample per speaker; audio.cpp's page has the user type that
  script.
- **Finding 2 — SenseVoice can't load**: the release has no
  `assets/framework/models/silero_vad`; only the checkout does. Seven recognisers default their
  VAD to that path relative to the working folder (qwen3_asr, sense_asr, parakeet_tdt,
  moonshine_asr, lfm2_audio, granite5asr, vibevoice_asr — `sense_asr/session.cpp:279-282`,
  `silero_vad/assets.cpp:33-43`), and `runtime.js` starts the server in its own folder.
  Fixed in our fork (`095cae20`): every build copies `silero_vad_16k.safetensors` and upstream's
  MIT `LICENSE` (snakers4/silero-vad at `1e261b0`) beside the executables
  (`cmake/bundled_assets.cmake`), so `build/jv-dev/bin` and every release bin bundle carry it
  (the Colab bundle copies it in its own step); the pinned jv.5 doesn't until the next release.
  On the dev build SenseVoice-Small loaded on CUDA in 7 s and transcribed the Hatter clip in
  0.3 s, 96 % — its text carries `<period>` and `<io>` tokens (finding 3's kind). — *code +
  measured, 2026-10-15*
- **Finding 3 — some recognisers put their own markup in the text**: Index-Echo is a Chinese
  speech *translator* and returns timed captions, each a source line and its translation;
  MOSS-Transcribe-Diarize returns `[0.06][S01] …[7.96]`; VibeVoice-ASR starts "Speaker 0:".
- **Finding 4 — F5-TTS leaks** (audio.cpp): after one line the speech process holds about
  17.5 GB of committed memory, and unloading the model doesn't free it. Four F5 models in one
  process reached 67 GB against the machine's 40 GB commit limit ("bad allocation"); each was
  clean in a fresh process. CosyVoice3 (about 835 MB after each of 3 unloads) and Kokoro (about
  1035 MB) don't leak.
  - **The cause, in the code** (our fork at v0.9.2): every context F5 builds on CUDA is
    `no_alloc` but was sized as if it held the data — the batched-CFG DiT graph
    min(max(1.5 GiB, N·8 MiB), 12 GiB), the plain one up to 6 GiB, Vocos 256 MiB, each weight
    store 2 GiB — and `ggml_init` mallocs the whole size regardless (`ggml.c:1677` →
    `_aligned_malloc`, `:339`), which on Windows is committed memory whether or not a page is
    touched (on Linux it never becomes resident — why upstream's PR #924 saw ~0 on CUDA);
    `load_model_once` loaded the whole DiT a second time, in F32, that no graph reads; evicted
    CFG graphs leaked their context, arena and staged constants, and the Vocos graph cache had
    no bound; every cache lives as long as the process, so unloading frees nothing.
  - **Fixed in our fork** (pushed 2026-10-15): upstream's open PR #924 (`a339730b`,
    `088bba5c`, `59686dd0`: the CPU frame budget capped at 960, the CFG pool at 9 MiB a frame,
    evicted CFG graphs freed, the Vocos cache bounded at 2 and freed), then ours: CUDA graph
    contexts sized for their headers, ~105 MB a DiT graph (`b937f2ec`); the DiT loaded once, its
    store sized for 512 headers (`56e7a352`); a graph's staged constants freed with it
    (`79ca123e`).
  - **Measured on the dev build `79ca123e`**: one speech process, the Hatter clone, seed 42,
    Arabic lines; committed = private bytes.

    | Step | Committed | Working set | Card used |
    |---|---|---|---|
    | before (no speech process) | — | — | 249 MiB |
    | Habibi Unified loaded | 396 MB | 164 MB | 257 MiB |
    | line 1, 19 chars (1.8 s take) | 2,405 MB | 474 MB | 1,886 MiB |
    | line 2, 52 chars (4.1 s) | 2,898 MB | 484 MB | 2,266 MiB |
    | line 3, 96 chars (7.3 s) | 3,440 MB | 486 MB | 2,636 MiB |
    | line 4, 180 chars (14.6 s) | 4,214 MB | 490 MB | 3,331 MiB |
    | line 5, 330 chars (27.1 s) | 5,459 MB | 483 MB | 4,568 MiB |
    | Habibi EGY loaded / its 52-char line | 5,208 / 6,121 MB | 484 / 593 MB | 4,579 / 5,216 MiB |
    | Habibi MSA loaded / its 52-char line | 5,920 / 7,239 MB | 593 / 693 MB | 5,220 / 6,478 MiB |
    | after unload | 7,239 MB | 693 MB | 6,476 MiB |

    Before the fix: 17,860 MB committed after one 52-char line, in a fresh process, at every
    Habibi model. Committed memory now rises with the card's, step by step. It still grows with
    each model loaded into one process — EGY +662 MB committed and +648 MiB on the card, MSA
    +1,118 MB and +1,262 MiB (each keeps its ~1.3 GB of weights; the bounded graph caches swap).
  - **Unloading F5 stops its speech process** (decided 2026-10-15, TASKS `4d54ee1f`):
    `curated/f5_tts.js` `UNLOAD_STOPS_PROCESS`, read in `slot.js` `terminate`, which then stops
    the slot's process instead of asking audio.cpp to unload; each kind has its own process, so
    nothing else goes with it. Measured 2026-10-16 through the app (fork `8c9a6322`): Habibi
    EGY's process went 396 → 4,762 MB committed over three lines and the card 368 → 4,005 MiB;
    after Unload the process was gone and the card read 361 MiB. The recognition process
    (Qwen3-ASR, loaded beside it) kept its pid and transcribed after; Kokoro still unloads in
    place (its process kept, 7,095 → 794 MB committed); and the downloads delete at once.
    (was: unloading freed nothing — 7.2 GB committed and 6.2 GB of the card stayed with the
    process, which the booking read as free, and Delete answered 409 "still in use" until the
    process ended — until 2026-10-16.)
  - **The memory fix didn't change the takes**: Unified's 52-char line is bit-identical to the
    old build's; so are EGY and MSA each first in a fresh process, MSA after EGY, and EGY after
    Unified's 52-char line. Read back by Qwen3-ASR 1.7B: lines 1–5 at 75 / 60 / 100 / 92 / 91 %.
  - **A take no longer depends on what the process ran before** (fork `8c9a6322`). The
    batched-CFG graph's GRN eps is [2, 1, 1], one per CFG half, but `grn()` gave it one value
    (`dit_modules.cpp`), so the unconditional half's eps was never written: zero in fresh
    memory, anything once freed graphs' memory was reused. Found by filling every non-weight
    tensor of a new CUDA graph with NaN and computing it node by node: those four leaves, one per
    text ConvNeXt block, were the only unwritten tensors in the CFG and Vocos graphs, and with
    the fix none is; `ctx_store_f32` now refuses a value count that doesn't fill its shape.
    Measured 2026-10-16 through the app, seed 42: Unified's 52-char line byte-identical first in
    a fresh process, after the 180- and 330-char lines, after the 96- and 19-char lines, and in
    a new process; EGY's the same first and after the 330- and 180-char lines. Takes moved
    slightly from before (the unconditional half's eps was 0, now 1e-6: correlation 0.989 with
    the old take; Qwen3-ASR hears the same words). (was: after Unified's long lines, EGY's same
    line came out different — correlation 0.35 with the fresh take — and MSA read back 70 %
    against 80 % fresh — until 2026-10-16.) The three Habibi checkpoints' Vocos weights are
    byte-identical (83 tensors, 54.3 MB), so the Vocos cache's key `(T, device)`, which leaves
    out the model, is harmless for them. — *code + measured, 2026-10-15/16*
- **Finding 5 — a single-language checkpoint in a many-language family**: LFM2.5-Audio JP ASR
  refuses English, which its family lists; GigaAM (Russian) transcribes English in Cyrillic.
- **Finding 6 — two loads went to the CPU beside little other use**: Kitten TTS 2 (3.1 GB, other
  programs 0.6 GB) and Maya1 (6.4 GB, 0.8 GB) on the 8 GB card, under Auto's check of the
  card's real free memory (2026-10-15). The cause: an unmeasured model is weighed at audio.cpp's
  estimate or its files, whichever is more (Kitten TTS 2: 7 GB against 3.1 GB of files), and only an
  estimate above the card was tried on the card at its files — Kitten TTS 2's 7 GB plus the 1 GB
  margin is the whole card, so any other use sent it to the CPU. Fixed: an estimate that doesn't fit
  beside other programs, for a model whose files do, is tried on the card first at its files, as
  the too-big rule does (`placementFor`).
- **Finding 7 — MOSS-TTS v1.5's spec asks for a language name** ("does not understand codes like
  'en'"); JustVoice sends `en`.
- **Loads beside the run's own steps**: a load straight after an unload, while the card was still
  freeing memory, went to the CPU (ZipVoice); the kit's `POST /v1/llm-runner/stop` clears its
  whole memory ledger (KugelAudio then went to the CPU); `POST /v1/engines/unload {}` unloads
  only the speech slot. Fixed: an unload answers once the card's reading has dropped by most of
  what the model held (up to 6 s, `_waitForDrain`), and so does a load that unloads the model before
  it; the kit's full stop releases only the AI models' bookings (`releaseKind("llm")`), not the
  speech slots; `{}` unloads a recogniser loaded alone.
- **The GPU disturbance of 18:17:26–18:18:30** (another app's run): no load or line of the test
  ran in it, no card failure was recorded and the prices around it are normal. The F5 prices
  from the leaking process (3.1–7.2 GB) are stored under the old build key (`4d2f1a2b + local
  changes`); the app reads prices only for its current build, so they are inert.

### 10.16 Slice 3's runtime check — a load option and a number box reach the runtime (2026-10-15)

The adoption plan's slice 3 acceptance ("one model's load option and one number-box setting reach
the runtime"), through the running dev app's own routes (`npm run dev`, our fork at `79ca123e`
built in `build/jv-dev`, RTX 2070 SUPER 8 GB), the Hatter clip (`Test · Hatter`, 8 s) as the
voice, seed 42, takes read back by Qwen3-ASR 1.7B. No licence needed accepting; the test persona
was deleted and the load option set back after. — *measured through the app, 2026-10-15*

- **Chatterbox Multilingual's Checkpoint (`chatterbox.multilingual_t3`).** Set to v3 on
  `chatterbox-multilingual-v2-q8` (`PUT …/runtime-options`), the model loaded in 8 s, and the
  runtime's own list (`GET /v1/models?include_session_options=true`) showed
  `"session_options":{"chatterbox.multilingual_t3":"v3"}`. Same clip, same seed, v3 then v2:

  | Line | v3 | v2 |
  |---|---|---|
  | German, "Der Hutmacher sah zweimal auf seine Uhr, goss den Tee ein und lachte über sein Glück." | 5.28 s, read back word for word ("goß") | 5.68 s, word for word |
  | English, the same line | 4.36 s | 4.36 s — **byte-identical** to v3 |

  So the option reaches the model, and an English line uses Chatterbox's English T3 whichever
  checkpoint is set (§1.2). The v3 loads saved their own price rows (`load_options=
  chatterbox.multilingual_t3=v3`, card peak 2,395 MB after its lines); the default set's rows
  stayed flagless (2,397 MB): the two checkpoints cost the same here.
- **CosyVoice3's Max tokens (a number box from −1, no top; folded under Advanced).** A test
  persona with `max_tokens: 25` saved (201). Heard with only that set, audio.cpp refused the line:
  "CosyVoice3 AR token length bounds are invalid" — its minimum, when `min_tokens` is unset, is
  twice the text's tokens (`src/models/cosyvoice3/ar.cpp:420-427`: min `text_tokens × 2`, max
  `text_tokens × 20`, refused when min > max), above 25 for this line. With `min_tokens` 0 as well
  (also a number box), the take was **1.00 s** (25 speech tokens) and read back "The hatter
  checked his." — against 4.52 s and the whole line at the defaults. So a Max tokens below twice
  the text's tokens needs Min tokens lowered too; the app sends both as set and audio.cpp names the
  problem.
- **What the screens show at 1280** (the app's own server, `dist/spa` built): Speech engines →
  Chatterbox Multilingual 8-bit: *Checkpoint* v2 on the row, *Load options (7)* folded below it; the
  knob grid's 60 px number box cut "240,000" (Decoder condition samples), so the fold's number
  boxes are 96 px since. The persona page's Sampling on CosyVoice3: min_tokens, top_k,
  num_inference_steps in view (audio.cpp's control list), *Advanced (1)* holding Max tokens;
  nothing past its cell or the window. Render's line panel couldn't be shown: every persona cast
  in the user's one project is on Kokoro, which has no sampling settings there. The smoke gate
  passed (12 views, no JS errors).

### 10.17 Slice 2's findings at the source — scripts, transcripts, a request's language, a checkpoint's languages (2026-10-15)

Read in our fork at `79ca123e` (upstream v0.9.2 + F5 commits) for TASKS "Slice 2's acceptance
findings" 1, 3, 5, 7; built in JV `abd3d1b4`; through the app below ("Through the app"). — *read at
the source, 2026-10-15*

- **VibeVoice's text is a script; its clip is speaker 1.** `src/models/vibevoice/tokenizer_text.cpp:48-83`
  keeps only lines matching `^Speaker\s+(\d+)\s*:\s*(.*)$` (case-blind), drops the rest silently,
  refuses none left ("VibeVoice prompt has no valid Speaker N: lines" — its warm-up in §10.15), and
  shifts ids down by one when the lowest is above 0. `session.cpp:325-344`: a request `voice_ref` is
  speaker prompt 0; `voice_samples` with `voice_ref` is refused; `:315` refuses a style condition,
  which only a top-level `speed` sets (`app/server/server_protocol.cpp:220-241`). Its spec names no
  `speaker_reference` (capabilities `tts: [multi_speaker, long_form]`), yet audio.cpp's own page
  asks it for a voice (`webui/native/src/routes/+page.svelte:507-510`, with its speaker files).
  audio.cpp's own example puts two speakers on one line (`docs/tts.md:871`), which the parser reads
  as speaker 1 saying all of it.
- **MOSS-TTSD's text is speaker-tagged** — "`[S1]` is the first speaker" (`docs/models/moss_ttsd.md:20-21`)
  — and so is `reference_text` (`:53`), which it prepends to the dialogue (`session.cpp:364-375`);
  the prompt keeps the text as given (`prompt.cpp:61-62`). A top-level `reference_text` reaches its
  options (`server_protocol.cpp:202-203`).
- **A speech request's top-level `language` reaches only the request's text**
  (`server_protocol.cpp:72-75`); a transcription's goes into the options too when the spec lists it
  (`:1281-1300`). Where each generated speech family whose spec lists `language` reads it:
  | Family | Session reads | Effect of a top-level language |
  |---|---|---|
  | MOSS-TTS v1.5, MOSS-TTSD, MOSS-VoiceGenerator | options only (`moss_tts_v15/session.cpp:333-337`, `moss_ttsd/session.cpp:381-384`, `moss_voicegen/session.cpp:271-275`), as a full name | lost |
  | IndexTTS2 | options only (`index_tts2/request.cpp:90-92`; 2.5's tokenizer `session.cpp:361-366`) | lost: IndexTTS2.5 picks Chinese for Han text, else English (`tokenizer_text.cpp:815-818`); v2 reads none (`:776-784`) |
  | ZipVoice | options only (`zipvoice/session.cpp:316`) | lost, harmless: it is eSpeak's language for the English words in a line, default `en-us` (`emilia_tokenizer.cpp:259-276`) — the line's `zh` would phonemize them as Chinese |
  | Irodori-TTS | options only (`irodori_tts/session.cpp:132-136`), only checks `ja` | lost, harmless |
  | Audio8, Confucius4 TTS, MagpieTTS, VoxCPM1, LFM2.5-Audio | the text first, then the options | reaches it |
  | dots.tts, FireRedTTS3, FireRedAudio, OmniVoice, Sopro | the options first, then the text | reaches it |
  So since `abd3d1b4` MOSS's three get it in `options.language` by name and IndexTTS2 by code
  (their files' `LANGUAGE_IN_OPTIONS`). audio.cpp's own page sends MOSS's language top-level too
  (`+page.svelte:2099`, `mossLanguage`), so there it never reaches MOSS either — an upstream bug,
  recorded only (the fork rule: no routine posts).
- **Two recognisers mark up their text; their turns hold the words.** `/v1/audio/transcriptions/details`
  returns `text`, `segments` and `speaker_turns` [{start_sample, end_sample, speaker_id,
  confidence, text}] (`app/server/runtime.cpp:1546-1563`). MOSS-Transcribe-Diarize's `text` is the
  raw `[0.06][S01] …[7.96]`; each parsed segment's words go to `segments[].text` and
  `speaker_turns[].text` (`src/models/moss_transcribe_diarize/session.cpp:123-141`).
  VibeVoice-ASR Streaming's `text` keeps "Speaker N:"; `speaker_turns[].text` has each turn's words
  without its label, no spans (`vibevoice_asr/session.cpp:1247-1254`, `postprocess.cpp:158-182`).
  VibeVoice-ASR (offline) already returns its segments' words joined by a space
  (`postprocess.cpp:121-153`). Index-Echo "translates Chinese speech into English, Spanish, or
  Japanese text … as timestamped subtitle cues" (`docs/models/index_echo.md:3-5`).
- **A checkpoint's languages, where fewer than its family's** (audio.cpp's model docs): LFM2.5-Audio
  1.5B `en`, its JP model `ja`, "each checkpoint transcribes, speaks and chats in its own language"
  (`lfm2_audio.md:17`); GigaAM v3 Russian, Multilingual five (`gigaam_asr.md:13`); "Each Kroko
  package recognizes one language" (`kroko_asr.md:25`), the one offered English; IndexTTS2 Chinese
  and English (`index_tts2.md:9`), 2.5 adds Japanese, Spanish, Arabic (`:127`); sanoTTS one language
  per package (`sanotts.md:28-47`); Habibi-TTS Arabic, "multi-dialect" Unified and per-dialect
  checkpoints (`f5_tts.md:5-7,63-64,112`) — its HF card and GitHub README (read 2026-10-15) name the
  dialects by code only (ALG, EGY, IRQ, MAR, MSA, SAU, UAE), and the README says a checkpoint is
  "best use[d with] matched dialectal content with ID", while JustVoice leaves the `dialect`
  setting at audio.cpp's `UNK`; VoiceTut-TTS Egyptian Arabic and Arabic-English code-switching,
  trained as `arz` (`omnivoice.md:160-166`) — OmniVoice takes `arz` or a name, never `ar` or
  `ar-EG` (`src/models/omnivoice/language_map.inc:39-46`, `prompt_builder.cpp:255-276`);
  QwenCleo-ASR Egyptian Arabic (`qwen3_asr.md:47-50`), not offered until slice 4. Upstream's catalog
  carries no per-entry languages (`webui/configs/models_catalog.json`), so these live in each
  family's `LANGUAGES`; Intl names the tags (`ar-EG` "Arabic (Egypt)", `ar-001` "Modern Standard
  Arabic", `pt-BR` "Brazilian Portuguese").
- **VieNeu** needs sea-g2p, a Rust C library, for plain text (`vieneu_v3_turbo.md:56-81`); its
  packages install one preset voice pair (`minh_quan_pro` codes and embedding) the app doesn't use.

**Through the app** (2026-10-16, the findings plan's GPU acceptance): `npm run dev` on JV
`5bcd223f` + fork `79ca123e` (`build/jv-dev`), RTX 2070 SUPER 8 GB, the AI model stopped before each
load; the Hatter clip and its words; takes read back by Qwen3-ASR 1.7B; seed 42. Every download
the run made was deleted (no 409), the five licences accepted for it cleared, the four test voices
deleted, the app closed by its ports, the card back at 216 MB. — *measured through the app,
2026-10-16*

| Check | Result |
|---|---|
| Lists (no card) | 44 speech engines (38 from audio.cpp's files) and 25 recognisers (24); no VieNeu, no Index-Echo; VibeVoice `CLONING`, no voice of its own; every row's languages as §10.17 (LFM2.5-Audio en / JP ja, GigaAM v3 ru, Kroko en, IndexTTS2 zh·en, Habibi `ar` / `ar-EG` / `ar-001`, VoiceTut `ar-EG`·en, sanoTTS one per download); LFM2.5-Audio JP's own voice Japanese |
| VibeVoice 1.5B q8 (3.0 GB), a Hatter clone | loaded on CUDA in 8 s; the line a 4.93 s take, read back 100 %; two paragraphs (8.13 s) 100 %; priced after its lines (3,723 MB) |
| MOSS-Transcribe-Diarize q8 (1.05 GB) | the clip: 96 %, no timestamps or `[S01]` |
| VibeVoice-ASR Streaming 1.5B q8 (3.1 GB) | 96 %, no "Speaker 0:" |
| Kroko (0.16 GB) | `en` 96 %; `de` refused by audio.cpp, "Kroko ASR package language is en, but the request selected de" (a recogniser's request keeps the family's form) |
| LFM2.5-Audio JP ASR (1.7 GB) | a Japanese take 95 %; `en` refused by audio.cpp, "this LFM2-Audio checkpoint transcribes ja, not en" |
| sanoTTS (5 MB German + its 1 MB default) | its English download loaded, a German line loaded `sanotts-german` itself; read back 88 % ("Hutmacher" heard "Hubmacher", "Glück" "Lächeln") |
| VoiceTut-TTS q8 (1.3 GB), an Arabic line | no language sent (OmniVoice takes no `ar-EG`), a 4.37 s take, 80 % — as §10.15 |
| MOSS-VoiceGenerator bf16 (5.7 GB), designed | on the card it spilled 308 MB into system memory, so Auto retried on the CPU (§10.15 had it on the card at 7.7 GB with less else on it); English 100 %, Chinese 100 % (`options.language` English / Chinese) |
| IndexTTS2.5 q8 (3.3 GB), a Hatter clone | Spanish 100 %, Japanese 82 % (帽子屋 heard ボーシャ) |

IndexTTS2.5, the same clip, seed and lines sent straight to the runtime both ways: the language in
`options` — Spanish 100 % (6.83 s), Japanese 82 % (4.99 s); at the top level, as before
`abd3d1b4` — Spanish 75 % ("Al sombrero … as::erio", 7.63 s), Japanese 59 % ("帽子をは直径を…雲に消だ",
5.50 s). So the option is what makes its tokenizer read the line's language.

- **A recogniser's refusal reached dictation as JSON** — "engine transcribe failed: {"detail":
  "this LFM2-Audio checkpoint transcribes ja, not en"}" (the manager passed the slot's body as it
  was; a synth's error already took its `detail`). Fixed: transcribe and align say the engine's own
  words.
- **SenseVoice-Small's `<period>`, `<io>`** (asked by the coordinator). Its `text` read "That accounts
  for it<period> He won't stand beating<io Now, if you only kept on good terms with him<io> …"
  (96 %). They aren't special tokens: its vocabulary (`sv.vocab`, 25,055 pieces) has none —
  only `<unk>`, `<s>`, `</s>` and its `<|…|>` tags, which the decoder drops
  (`src/community_models/sense_asr/session.cpp:139-221`, `keep_tags` keeps them). The model spells
  them out of ordinary pieces (`<` 9702, `>` 9704, `io` 1696, `▁period` 767), and they shift with
  the input: the same clip resampled by ffmpeg gave "<.d>>", "<io", "himio>"; without ITN
  (`enable_itn: false`) "<d>", "<", "<io>". Its response holds only `text` and `language` — no
  segments, turns or words (`session.cpp:589`) — so no field has the words without them, and
  audio.cpp's own page shows `text` as it is (`+page.svelte`, `nextText = result.text`). Not
  fixed here: it is the model's (or the port's) output.

### 10.18 The direction step as built — the one-click plan's slice 2 (2026-10-16)

The plan's step 6 (`docs/plans/2026-10-11-one-click-audiobook.md` §2, §3, §5), built on a branch;
the module is `server/src/extraction/direction.js`, the step `directScene` in
`server/src/api/extraction_api.js`. Not yet run on a model: the GPU was busy, so the acceptance
(Alice VII cue lines caught ≥ 88 %, no-cue marks ≤ 5 %, on gemma) waits for
`npm run eval:direction`.

- **The kit turns thinking off whenever an action's JSON mode is on** — `_effectiveThink` returns
  `think && !jsonMode` (its comment: "B3 guardrail: a reasoning block corrupts strict JSON"). That
  is why §10.5's `think: true` changed nothing: the run was in JSON mode. So the Frontier recipe's
  row runs with JSON mode off, its preset's thinking on, and its reply is read wherever its JSON
  sits. — *code, 2026-10-16* · `../just-core/packages/core/src/llm/prompts.js:511-514`.
- **The kit's Claude adapter drops `response_format`** — it passes only `top_p`, `top_k`,
  `metadata` and `stop` — so neither JSON mode nor an action's `json_schema` reaches Claude as
  structured outputs (`output_config.format`, the plan's §8 standard for JSON answers on Claude).
  — *code, 2026-10-16* · `../just-core/packages/core/src/llm/anthropic.js:187-188`.
- **§10.5's hand prompt was not kept**, so the seeded Local prompt is new: the rules of the
  cue (a manner verb, an adverb or phrase, narration showing the speaker's state, a thought; not
  the words alone or an exclamation mark), the nine emotions or "", a few words from the cue,
  answered as `{"lines": [{"id": "D4", "emotion": …, "direction": …}]}` for marked lines only.
  §10.5's numbers are the baseline it has to meet. — *record*.
- **What it sends.** Local: the chapter's paragraphs, each spoken line as `[D# · Name] "…"`.
  Frontier: the same, plus who is who (name, other names, who they are) and every chapter before
  it, each its title then its text. Alice VII's chapters before are the EPUB's seven scenes — front
  matter included — 70,413 characters; VIII's eight, 83,021. — *code + measured, no model,
  2026-10-16* (the eval against a stand-in for its route).
- **Which recipe runs** is `presetRecipe` of the Frontier card's preset (`direction.frontier`),
  as attribution's Auto judges its Direct card; both cards are seeded on `p_extract_reasoned`, so a
  fresh install runs Local. — *code, 2026-10-16* · `extraction/direction.js` `directionRecipe`.
- **The carry** is §10.5's rule exactly: within a paragraph, a speaker's unanswered lines take the
  nearest answer of theirs before them, then after; only the model's own answers carry, and a line
  with no speaker neither gives nor takes. — *code, 2026-10-16* · `direction.js` `carry`.
- **What it writes.** On a written-direction model the words to `blocks.direction` and the emotion
  to `line_models[model].emotion` where `emotionChoices` names it; on a tag model the emotion
  through its `value_map` (Turbo: fearful → `fear`; sad, shouted and contemptuous have none); on
  sliders, or a speaker with no voice, nothing — merged with `line_takes.mergeOverride`, all of a
  chapter in one transaction. Each written line records `metadata.direction_by` = {model, recipe,
  direction, emotion: {model: value}, carried_from?}; a line whose direction or emotions differ
  from that record (or, with none, are set at all) is the user's and is skipped. The chapter
  records `metadata.direction` = {directed_at, model, recipe}. — *code, 2026-10-16* ·
  `api/extraction_api.js` `_persistDirection`, `direction.js` `shapeFor`, `modelOwns`.
- **The answer key lines up with the app's cut**: Alice VII 150 spoken lines, 73 with a cue, 24 of
  them naming one of the nine emotions; VIII 90, 50, 26. — *measured, no model, 2026-10-16* ·
  `npm run eval:direction` against a stand-in.
### 10.19 Slice 4 — names across chapters, and lines with no single speaker (2026-10-16)

The one-click plan's slice 4 (`docs/plans/2026-10-11-one-click-audiobook.md` §10 item 4, answers
6 and 7). Built on branch `oneclick-s4`; nothing here ran on a model — every fact is code, or a
test with the model stubbed. The gemma acceptance is owed: `npm run eval:speakers` (below).

- **Why Discover's page shows the Queen twice.** Its merge (`studioStatus.foundSpeakers`, and the
  server's `names.isVariant`) joins a name to another only when its words are a run inside the
  other's — *Sedge* / *Old Sedge*. *the Queen* and *Queen of Hearts* share no such run ("the" is
  not in the longer name), so they stay two rows. The run's merge sets one leading article aside
  first (`names.bare`: the, a, an, and the common French, German, Spanish and Italian articles) —
  *queen* is a run of *queen of hearts*. — *code, 2026-10-16* · `extraction/names.js`.
- **On gemma's Alice names (§10.4) the local recipe has one group to ask about:** *Queen of
  Hearts*, *THE KING AND QUEEN OF HEARTS*, *the Queen*, *the King* — the heading shares words with
  both royals and pulls the King in, so the call must split the group, not just confirm it (its
  answer says which names are one person; a name it leaves out stays alone). Every other name
  stands alone — no call is needed for them. — *code, run 2026-10-16* (`merge_names.test.js` on
  `tests/alice_fixtures.js`, the names as §10.4 lists them, the key's counts).
- **The 0-line rule uses Discover's count, not the text's.** With the group split as a model
  should, the merge leaves out Time, Elsie, Lacie, Tillie, the heading, the Duchess and the
  executioner, and keeps the Knave: Discover counted 1 line for him and VII–VIII give him none, so
  he becomes a speaker with 0 lines after Analyze. A person a scan gave no number for is kept. —
  *code, run 2026-10-16* (`one_click_alice.test.js`).
- **The merged names don't break the "said X" rule on Alice.** Discover's spellings ("Hatter",
  "the King", "the Cheshire Cat", the Queen with *the Queen* as Also called) promoted as they come,
  then Analyze with the model answering the key: 235 of 235 keyed single-speaker lines right, the
  rule and propagation deciding theirs with no wrong one. — *code, run 2026-10-16*
  (`one_click_alice.test.js`, the model stubbed — so this checks the cast and the rule, not gemma).
- **Alice VII–VIII has five lines with no single speaker** — VII D2 ("No room! No room!" — *the
  three* crowd the corner, the key gives it to the Hatter and the March Hare), D94–D95 (*they both
  cried*), D121 (the Hatter and the March Hare went "Sh! sh!"), VIII D39 (*the soldiers*, not in
  the cast). The key names each group since 2026-10-16 (`groups`; [] for the soldiers). Gemma's
  Analyze left exactly these five blank (§10.4: 240/240, "the five group lines answered
  unknown"), and the step asks only about lines left blank (`_secondLookAsks`), so on gemma it is
  five calls for the two chapters. — *record + code, 2026-10-16*.
- **The feature-name mismatch (answer 6).** The renderer labelled Discover's AI task
  `speaker_identification` (`src/services/chapterRun.js`), a name the server never had; its feature
  is `speaker_discovery` (`feature_catalog.js`), and the AI tasks panel prints a task's feature as it
  is (the kit's `AiStatusPanel.vue`, `task.feature`). Now the server's name. The Find new speakers
  **action** keeps its key, `speaker_attribution.identify`: it is the template row, not the feature
  ("the action key stays for its callers", `seed_feature_prompts.js`), and renaming it would leave an
  edited row behind in every database (no migrations). — *code, 2026-10-16*.
- **Owed — the gemma acceptance:** `npm run eval:speakers -- --server <url>` imports Alice VII–VIII
  as a new book, runs Discover, the merge, ＋ Add, Analyze and the group lines through the server's
  routes, scores them against the key (one person per keyed speaker, no one left out who speaks,
  every keyed line, each group line to its group and flagged), then deletes the book (`--keep`
  keeps it). Run once the graphics card is free; the frontier side when there is an API key (plan
  §7). — *record, 2026-10-16*.
### 10.20 Slice 3 — voices for the cast and the narrator, built (2026-10-16)

The one-click plan's slice 3 (§10 item 3; Q1–Q3), built under "your rec do it all stop stoping and
finish it all go!" (TASKS "The test kit and round 4, then the one-click slices"). All *code,
2026-10-16*; nothing measured on the graphics card yet (it was busy with round 4).

- **Three steps, each a function and a route** — `book_voices/index.js` `describeVoices` :165,
  `makeVoices` :288, `matchRest` :387; `POST /v1/projects/:id/book-voices/describe | design |
  match` (`api/book_voices_api.js:104, 111, 118`). Describe writes nothing; design writes voices
  (`ref.wav`), personas and casts; match writes casts. The one-click run (slice 5) holds step 1's
  descriptions between the steps — nothing stores them in the book.
- **Who:** every speaker but the narrator with at least `book_voices.min_lines` (3) lines in the
  whole book (`speakerLineCounts`), most lines first, and the narrator (the role). Left out: a
  speaker with a persona (`cast`) and one whose name is exactly one persona's (`persona_named`,
  cast by step 3 as `ensureSpeaker` casts a new speaker) — `bookTargets` :134.
- **The recipes** are three rows of the feature `book_voices` (`book_voices/prompts.js`; card
  "Voices from the book", group Voices, preset `p_extract` each, `json_mode` on, in
  `PREFER_LOCAL_FEATURES`). Auto reads the **Whole cast** row's preset (`presetRecipe`), as
  attribution's Auto reads Direct's; the describe route can force one. Local: one call per
  speaker with the paragraphs their lines are in, theirs marked ⟦ ⟧, earliest first, up to
  `speaker_words` (2000) words (`text.speakerPassages`), and one for the narrator with the opening's
  `narrator_words` (2000) (`bookOpening`). Frontier: one call, the whole book, each spoken line
  after `[Name]` (`bookManuscript`), answers keyed by speaker id (a name key is read too). The two
  word budgets are unmeasured defaults.
- **The prompts** ask for §10.5's shape (one or two sentences: gender, age, pitch, pace, manner)
  plus a gender field, **in English** (Qwen3-TTS VoiceDesign's note: "Describe the voice in plain
  English", `engines/capability_details.js:413`) and **at rest** (the plan's §13: the clip's
  delivery carries into every line). Their example voices are invented, not Alice's, so the Alice
  acceptance isn't primed with the Hatter's description.
- **The audition** speaks one of the speaker's own lines, marks off (`text.auditionLine`): of
  at least half `audition_words` (25), the nearest 25 among lines without "!", else among all; the
  narrator's a narration line; none that long → the book language's stock line
  (`persona_render.stockLine`). Slice 0's Hatter spoke his own line too — "Ah! that accounts for
  it. He won't stand beating. Now, if you only kept on good terms with him, he'd do almost anything
  you liked with the clock." (his VoxCPM2 copies' `transcript`, the dev data folder, read
  2026-10-16). "No !" as calm is a text rule; whether it picks calm takes is for the ear.
- **Design → freeze → persona:** `previewVoice` on `design_model` (`qwen3-vd`) with the
  description as the instruct, then `savePreview` at once with `model: clone_model` (`voxcpm2`) —
  the take becomes a VoxCPM2 voice's `ref.wav` with the audition as `transcript` and the
  description as `design_prompt`, its gender from the answer; then `createPersona`
  (`api/personas_api.js:194`), named after the speaker, language the book's, note
  "<description>\n\nWritten from the book by <model>." (`personaNote`); then the speaker cast only
  while uncast. A name two older personas share is refused before any render; a voice whose
  persona fails is deleted. The step refuses a clone model that doesn't clone or take direction
  (words or tags — `voice_model.directedBy`; Kokoro and Qwen3-TTS Base refused, tested) and a
  design or clone model that doesn't speak the book's language.
- **Batched by kind** inside the steps: step 1 makes only language-model calls, step 2 renders
  only on the design model (the save renders nothing), so a book swaps models once between them.
- **The rest (step 3)** are matched by Smart-assign over the personas whose voice speaks the
  book's language and that **play no one in this book yet** — chosen in this slice so a minor
  speaker isn't given a main speaker's new persona; Cast's own ✨ pool is the ticked models
  instead. Genders come from `listVoices` (a stored or built-in voice's own); Cast's renderer rule
  also reads a first name and your preset overrides, which the server has no copy of.
- **A consequence of naming personas after speakers** (Cast's ＋ New persona rule): a second book's
  "Narrator" speaker is cast by name with the first book's "Narrator" persona when it is made
  (`ensureSpeaker`), so the voices step leaves it alone and its voice isn't drawn from the second
  book's genre. Not decided.
- Tests: `server/tests/book_voices.test.js` (15, the model and the speech engine faked).
### 10.21 Slice 5 — the run and its screen, built (2026-10-16)

The one-click plan's slice 5 (§10 item 5; Q8), built under "your rec do it all stop stoping and
finish it all go!" on branch `oneclick-s5`. Every fact is *code, 2026-10-16* unless it says
otherwise; nothing ran on the graphics card — the acceptance (Alice VII, one press to an M4B, the
time and the tokens written down, a restart resumed) ran with every model faked
(`server/tests/book_run.test.js`), so it proves the run, not the models.

- **The run is a persistent job in render jobs' shape** — `server/src/book_run.js`
  (`createRun`, `startRun` on the kit's `background()`, `cancelRun`, `resumeRun`, `finished`,
  `sweepStaleRuns` from `app.js`'s boot beside render jobs'), its row in `book_runs`
  (`models_schema.js`): project, scope (`project` only), status (queued · running · paused ·
  cancelled · failed · completed), the step and chapter it is on, `steps_json` (per step: status,
  done/total/kept, model, recipe, tokens in and out, calls, seconds, the chapters it did, and the
  refusals it recorded) and `options_json` (redo, the price accepted, the estimate shown). Not in
  `SYNC_TABLES`, so it stays on the device; what it writes syncs as before, stamped by
  `flushSync()` after each chapter and step (a background task has no request whose answer
  stamps it, `app.js:286`).
- **Routes** — `GET /v1/projects/:id/book_run` (the plan and the latest run, with its review once
  completed), `POST /v1/book_runs` (`accept_price`, `redo`), `GET /v1/book_runs/:id`
  (`?review=true`), `POST …/cancel`, `POST …/resume` (`api/book_runs_api.js`), as
  `/v1/render_jobs` is laid out.
- **Each step is the function its route calls** — Discover `discoverChapter`, merge
  `mergeFoundNames`, add `promoteSpeakers` one person at a time (a name the book gained since is
  skipped) then `addNarrator` (moved out of `POST /v1/projects/:id/narrator` for it), Analyze
  `analyzeChapter` (moved out of `POST /v1/scenes/:id/analyze`, the chapter's text read with
  `_sceneText`), `giveGroupLines`, `describeVoices` → `makeVoices` → `matchRest`, `directScene`,
  one render job over every line whose state is `ready` (`createJob` · `startJob` ·
  `finished`), `checkTakes` over every chapter, and the M4B export job (`startM4bExport`, moved
  out of its route; the run waits on the job's task). Analyze's 409 on a chapter with takes, and
  any step's 409, is recorded against that chapter and the run goes on; 501/502 and anything
  else stop it ("failed", its reason kept). No speech recognition (the check's 400) skips the
  check with its reason; no ffmpeg (503) stops the run at the export.
- **Idempotent, per step:** a chapter the run did is passed over on resume; one done before is
  kept unless `redo` names the step — Discover: a saved scan; Analyze: analyzed or every line
  with a speaker from the import (`directScene`'s own rule); Direction: `metadata.direction`;
  lines with no single speaker: only analyzed chapters are asked. Merge and add, the voices steps
  and match have nothing to skip — each adds only what is missing. **Consequence:** a speaker you
  removed comes back on a re-run while the scans still name them, as Discover's own page shows
  them again; Ignore keeps a name out (`mergeFoundNames` reads the ignore list). The render takes
  `ready` lines only — a stale line keeps its take unless `redo: ["render"]`.
- **Batched by kind, in the plan's order:** language model (Discover … describe) → speech (design)
  → language model (match, direction) → speech (render) → recognition (check; its one re-render
  on speech) → ffmpeg. Match must follow design: it casts every speaker still without a persona.
- **A restart:** the boot sweep pauses the run; Resume re-enters at the step it was on. Its render
  job, paused by its own sweep, is resumed by the run (`resumeJob`); the export job lived in
  memory and is started again; the descriptions are kept in the run's row, so a restart between
  describe and design loses none (RESEARCH §10.20: nothing in the book stores them); a model call
  in flight is lost and that chapter is asked again. Measured with the model faked: the run
  stopped inside the descriptions, the server restarted on the same data folder, the run read
  "paused" at `describe`, and Resume finished it with no Discover or Analyze call repeated
  (`a_restart_pauses_the_run_and_resume_finishes_it`).
- **The model each step will use** is the kit's own resolution, as `GET /v1/ai/resolved-route`
  reports it (the action's preset over the feature's route; `resolveFeaturePresetWithSource`,
  `resolveRoute`), the action by the step's recipe (merge, Analyze's route, describe, direction).
  A step is **cloud** when its provider's `local` is false — the flag `presetRecipe` reads.
- **The price (Q8):** before a run that has any cloud step, `estimateRun` counts each AI step's
  prompt rows and the text it reads at `book_run.chars_per_token` (4 — OpenAI's rule of thumb for
  English, "about 4 characters a token", help.openai.com "What are tokens and how to count them";
  CJK nearer 1), answers at `extraction.answer_tokens_per_line` (65) a spoken line for Analyze and
  Direction and once a call for the rest, leaves out chapters it would keep (and the voices steps
  once every speaker has a persona — a re-run), and prices it with
  the kit's `priceFor` / `costFor` (`@delebash/core/llm/pricing`). The lines with no single
  speaker aren't counted (unknown before Analyze). The start refuses (409) until `accept_price`;
  Resume never asks. *Arithmetic, unmeasured* — on Alice VII–VIII: 30,144 tokens in, 31,525 out
  on the local recipes; 33,404 in, 31,525 out on the frontier ones (Direction reading the chapters
  before it), about $0.76 at Opus 5.5's $4/$20.
- **The kit's pricing table has no 5.x row** (`DEFAULT_PRICING`: claude-opus-4-8, sonnet-4-6 …;
  matched by exact id or prefix), so `claude-opus-5-5` and `gpt-6.1-sol` read as *price unknown*
  until a row is added in AI Settings → Pricing — the run still shows their tokens and still
  asks. — *code* · `../just-core/packages/core/src/llm/pricing.js:9`.
- **What the run writes down (§5):** per step the model of its last call, the recipe, tokens in
  and out summed over its calls, calls, and seconds (the steps' own time — a pause between them
  doesn't count); totals and a cost from `costFor`. On the faked Alice VII run each AI step
  recorded its model and tokens; the render's and check's counts are lines (273, 274 reads with
  the one re-render). Measured (faked models): the whole run on VII in about 33 s.
- **Alice's counts the screen's mock uses** — imported VII–VIII: 176 lines (105 + 71), none with
  a speaker, narration waiting for a narrator; after the run 454 (273 + 181), 150 + 90 spoken;
  speakers Narrator 214, Alice 92, Hatter 55, the Queen 22, Dormouse 21, March Hare 16, the King
  9, Five 7, the White Rabbit 7, Two 5, Seven 3, the Cheshire Cat 3, the Knave 0; Script's To
  check after it 9 in VII (the four group lines and a run of five) and 1 in VIII. — *measured,
  models faked, 2026-10-16* (a scratch copy of `book_run.test.js` on both chapters).
- **The screen** — the card *Make the audiobook* on an audiobook's Overview, across both columns
  (`components/BookRunCard.vue`, fed by `StudioBookRun.vue`; drawn first as the in-app mock
  `#/mock/one-click`, its states `?state=new|price|blocked|running|paused|stopped|failed|done`,
  `?route=frontier`). Each AI step's model is the kit's `LuFeatureChip` (it opens AI Settings →
  Routing by feature on the step's action). The run is mirrored into the AI tasks panel as a kit
  task polled every second, as Render follows a render job (`services/bookRun.js`,
  `followBookRun`; its Cancel stops the run). Below 600 px each step's model goes under its name.
- **Not done here:** the run doesn't stop Script's renderer-side chapter run from analyzing the
  same chapter meanwhile; a factory reset doesn't stop a live run; `redo` has no button; a
  chapter-scoped run (`scope` is `project` only); the M4B isn't kept past its first save or a
  restart (export jobs live in memory, decided 2026-10-07).

---

### 10.22 Round 4 — nine engine setups the authors' way, scored by the test kit (2026-10-16)

The plan `docs/plans/2026-10-16-test-kit-and-round-4.md` §3. Through the app (`npm run round4:render`,
the dev build bcc5dfbb = v0.9.2-jv.6), the Hatter's VoxCPM2 clip (slice 0's, with its words)
copied to each model; Alice VII–VIII's 50 cue lines that name an emotion (shouted 18, sad 11,
whispered 7, angry 6, fearful 5, contemptuous 2, happy 1), each told (the app's emotion plus its
word — "shouting", "sad", "whispering", "frightened" … — reaching each model its own way) and not
told, seeds 7, 8, 9: 300 takes an arm, 2,700 in all, none failed. Scored by `tools/take-check`
(Whisper turbo read-back, WavLM speaker similarity to the clip, UTMOSv2 on seed 7, emotion2vec+ large,
emo_vad, BS.1770 loudness); `npm run round4:report -- data/round4/score-a/out data/round4/score-b/out`.

| Arm (how told) | Emotion gain, told − not [95% CI] | Heard as asked: told · not | Shouted / whispered Δ LUFS | WER told | Speaker sim told · not | UTMOSv2 told | s a take |
|---|---|---|---|---|---|---|---|
| Higgs Audio v3 TTS (tags) | +0.24 [0.12, 0.41] | 0.33 · 0.11 | +2.4 / −3.0 | 0.020 | 0.82 · 0.92 | 3.12 | 1.1 |
| BreezeTTS 2 (instruction, guidance 4) | +0.20 [0.10, 0.34] | 0.28 · 0.07 | +4.7 / −7.8 | 0.045 | 0.84 · 0.91 | 2.81 | 10.9 CPU · 4.3 card |
| IndexTTS 2.5 (emotion in words) | +0.10 [−0.04, 0.24] | 0.27 · 0.16 | +4.5 / +0.3 | 0.029 | 0.87 · 0.93 | 2.93 | 2.0 |
| CosyVoice3 (its fixed sentences) | +0.06 [0.02, 0.15] | 0.11 · 0.04 | +3.1 / −3.9 | 0.041 | 0.90 · 0.93 | 3.27 | 1.5 |
| VoxCPM2 (clip alone + "(…)") | +0.06 [0.01, 0.15] | 0.19 · 0.15 | +4.2 / +0.7 | 0.019 | 0.85 · 0.92 | 2.62 | 2.3 |
| Chatterbox Turbo (its tags) | +0.02 [−0.02, 0.11] | 0.09 · 0.05 | 0.0 / −2.7 | 0.045 | 0.92 · 0.92 | 3.23 | 1.2 |
| Chatterbox Multilingual (exaggeration 0.7, guidance 0.3) | +0.01 [−0.03, 0.06] | 0.07 · 0.05 | +1.1 / +1.2 | 0.049 | 0.92 · 0.93 | 3.25 | 1.8 |
| IndexTTS 2.5 (the authors' emotion vector, weight 0.65) | 0.00 [−0.04, 0.08] | 0.17 · 0.16 | 0.0 / 0.0 | 0.017 | 0.93 · 0.93 | 3.39 | 2.0 |
| Fish Audio S2 Pro (tags) | 0.00 [−0.03, 0.03] | 0.12 · 0.11 | +2.1 / −4.9 | 0.012 | 0.91 · 0.92 | 3.30 | 2.2 |

- **Emotion gain** is emotion2vec+'s probability of the asked emotion (contemptuous read as
  disgusted), told minus not told, per line then averaged — the kit's paired bootstrap. Angry
  carries most of it (Higgs +0.69, Breeze +0.49, VoxCPM2 +0.27, CosyVoice3 +0.23); sad moves
  little anywhere (Higgs +0.17, Breeze +0.07); fearful only on Breeze (+0.32, interval touching
  0) and IndexTTS words (+0.19). Scorers agree with people on model averages, weakly on one take
  (§10.11): this ranks, the ear decides.
- **IndexTTS 2.5's documented way — a one-hot emotion vector at weight 0.65 — moved nothing the
  scorer hears** (+0.00), against +0.10 for the emotion in words; a vector take differs from the
  plain one (not byte-identical), but not toward the asked emotion. Shouted and whispered have no
  category of its own, so those takes are the plain ones. The words way stays (its curated note's
  "back to the words until a test says otherwise", E9). — *measured*.
- **Acting costs likeness to the clip**: every arm that moves the emotion loses speaker similarity
  when told (Higgs 0.92 → 0.82), the ones that barely act keep it (Turbo, Multilingual 0.92 → 0.92);
  §10.11 notes WavLM similarity drops on emotional speech, so part of this is the measure.
- **BreezeTTS 2 on an 8 GB card**: measured 7.3 GB at its peak (guidance 4 runs two passes), so
  Auto sent it to the CPU (0.2× real time, 10.9 s a take) — with the 1 GB margin, even pinned to
  GPU, it was refused. With speech's own 512 MB margin and a GPU pin honoured (decided 2026-10-16,
  §2.3) it loads on the card: 4.3 s a take. Its 300 takes here were made on the CPU (the same model;
  the speed is the card's number). Licence: commercial use No.
- **Licences for the leaders**: Higgs, Breeze and Fish — commercial use No; IndexTTS — Unclear;
  VoxCPM2 and CosyVoice3 — Apache-2.0 (§10.13).
- **By ear**: the four the scores ranked highest that can carry the run — Higgs, Breeze, IndexTTS
  2.5 in words, and VoxCPM2 (the plan's pick, Apache) — on 13 of the lines (two per emotion; six
  of rounds 1–3's seven Hatter lines), blind, one seed per line; the clip and each voice's untold
  takes for "same person". Page: claude.ai/artifact/5ar9XVsVy3mPWBf2vH2tch (collection `round4`; the
  letters behind each take are in its data, revealed by its Show totals). — *measured, 2026-10-16*
  · `data/round4/` (gitignored).
- **The user's ears** (51 answers, then three changed on a second listen): plays like the book —
  BreezeTTS 2 13/13, IndexTTS 2.5 8/13, Higgs 6/12 (one unanswered), VoxCPM2 5/13; none "wrong
  feeling"; the same-person and overall questions unanswered. The user's notes: the others do
  change a line, less — "louder but not like a shout", "a little sad", "a little contempt", "loud
  doesn't always mean anger"; three choices were too few ("something more than plain like book or
  wrong") — next time no change · a little · clearly · like the book, and a best-of-the-four pick.
  Loudness agreed with the ear on Breeze (shouted +5.5 / +7.6 dB, whispered −9.1 / −3.1 dB); on
  single takes emotion2vec often didn't (§10.11). — *measured, 2026-10-16*.

### 10.23 The one-click slices on gemma — slice 1's and slice 2's acceptance (2026-10-16)

The headless server on the dev build (bcc5dfbb), the user's data folder, gemma 4 26B-A4B QAT on the
8 GB card; one run each.

- **Slice 1 (the recipe):** every book ran Direct, as before — a local model's recipe is Local, so
  Auto still judges gemma by its 26B. `npm run eval:attribution`: Alice VII–VIII 239/240 (the miss
  the group line "Sh! sh!", given to the Hatter at 0.70 where the 2026-10-10 run said "unknown";
  gemma gave it the Hatter before too, §10.4's no-propagate run), The Ninth Facet 133/136 (D9–D11,
  the systematic miss of every run since 2026-09-28), The Salt-Iron Road 131/132 (the known
  "Quartermaster."), The Speckled Band 246/247. Accepted: scores as before. — *measured*.
- **Slice 2 (direction), `npm run eval:direction`:** Alice VII — the model's own 44/73 cue lines
  (60 %), emotions matching 14/24, no-cue lines marked 2/77; with the carry **66/73 (90 %)**,
  emotions 18/24 (75 %), **no-cue lines marked 5/77 (6.5 %)**; 30 s, 4,802 tokens in, 1,071 out,
  one call. Against the bar (≥ 88 %, ≤ 5 %, §10.5's 64/73 and 4/77): the catch passes, the no-cue
  marks miss by one line. Alice VIII: own 39/50, with the carry 50/50, but no-cue marks 7/40
  (18 %) — the carry reached 4 lines with no cue. Both chapters: 116/123 caught (94 %), 37/50
  emotions (74 %), 12/117 no-cue marks (10 %). The carry is where the over-marking comes from.
  — *measured*.
- **Stopped by the machine:** the session's memory guard stopped the speakers eval (slice 4)
  mid-run and the server's shell at 18:3x — 4 GB of 32 GB free, the AI model's llama-server
  holding 17.6 GB of the computer's memory (gemma's resident weights; the runner measured 14.2
  GB held). The eval's temporary book was deleted by hand; gemma unloaded (21 GB free after).
  — *measured, 2026-10-16*.

### 10.24 The one-click slices on gemma — slice 5's run, slice 4's group lines, slice 2's carry (2026-10-16)

The headless server on the dev build (bcc5dfbb), the user's data folder, gemma 4 26B-A4B QAT on the
8 GB card, after §10.23 (gemma unloaded and reloaded between the checks).

- **Slice 5, Alice VII from one press to an M4B** (run 604207ee, the book "Alice VII (one-click
  test)", chapter VII alone, the narrator added first): 16 min 21 s (980.7 s), 27,943 tokens in
  and 6,782 out, price 0 (every step local), nothing failed. Per step — Discover 26.6 s (1 call,
  3,671 in / 303 out); the merge no call (4 names, none inside another); ＋ Add 4; Analyze 105 s
  (1 call, 4,578 / 4,780); the lines with no single speaker 18.1 s (3 calls, 9,949 / 192); Describe
  14.2 s (4 calls, 4,943 / 234); Design 27.4 s, 4 voices (Qwen3-TTS VoiceDesign → VoxCPM2); Match
  none left; Direction 48.6 s (1 call, 4,802 / 1,273); Render 273 lines in 568.6 s, 902.4 s of
  audio (0.63× real time), none failed; Check 273 takes read back by Qwen3-ASR 1.7B in 149.6 s, 4
  rendered again, 2 flagged; Export 22.6 s. The M4B: 13.9 MB, AAC 44.1 kHz mono, 15 min 3.7 s, one
  chapter mark (kept as `data/one-click/Alice VII (one-click test).m4b`). The estimate shown
  before the start was 14,569 in / 19,760 out — input about half the real figure (each line with
  no single speaker is its own call with about 3,300 tokens of text around it), output about three
  times the real figure. — *measured*.
- **A restart resumed:** a second run redoing the check (64d396ee) was stopped by killing the
  server's process tree at check 48/273; on the restart the boot sweep had paused it there;
  Resume finished it — 273/273, 2 rendered again, the same 2 flagged. — *measured*.
- **The take check's flags (slice 6's thresholds — missed share 0.2, extra share 0.2, two words
  at least):** on 273 takes, 4 failed the first reading (1.5 %), 2 passed after their one new
  take; the 2 flagged are the shortest — the narrator's *added the Hatter,* (3 words, heard "I did
  the harder.") and *"Sh! sh!"* (2 words, heard "Okay."). Nothing longer was flagged, so the
  numbers stay. **The user's ears agree with both flags** (2026-10-16): *added the Hatter* is
  said, "but the accent made it harder to understand" — the narrator voice designed from the book;
  *"Sh! sh!"* "did not come out correct, you can't tell that it said sh at all" — the model can't
  voice the shush. So short lines keep their read-back. — *measured*.
- **Slice 4's group lines: Analyze names one of a group often.** In the run above gemma gave
  *"Sh! sh!"* to the Hatter — not blank — so the step (asking blank lines only) neither asked nor
  marked it; in §10.23's run Analyze named four of the five. Fixed the same day: a line Analyze
  named is asked too when the narration right beside it in its paragraph (its first 6 words after
  the line, its last 6 before) has *they*, *both*, *together*, *everyone*, *everybody*, *chorus*,
  *unison*, or two of the cast joined by *and* (`group_lines.severalSpeak`); the answer marks it
  when it names several (Analyze's speaker kept when one of them), and leaves it as it was when
  it names one (`group_asked` on the line, so it isn't asked again). Not *all* (*but all he said
  was* comes before one speaker's line). On the run's chapter VII the test picks exactly the four
  group lines Analyze named or might name — D2, D94, D95, D121 — and no other line; with *all* and
  the whole narration read it had picked 4 more. `npm run eval:speakers` after the change:
  every keyed line right on both chapters (235/235), every keyed speaker once with no one added who speaks no line (Discover counted the Knave 0 this time), and all five lines with no single speaker given to the key's group (4 to the Hatter, the soldiers' to the narrator) and marked; no line one person says was marked. Chapter VII asked 4 lines (all named by Analyze), VIII 1 (left blank) — 5 calls, 17,795 tokens in. Accepted. — *measured*.
- **Slice 2's carry, tightened.** §10.23's over-marks came from the carry crossing more than the
  speaker's tag: *said the Dormouse indignantly. However, he consented to go on.* (D126); *…; and,
  turning to Alice, she went on,* (VIII D19); *And then, turning to the rose-tree, she went on,*
  (VIII D32); *the Rabbit began. Alice gave a little scream of laughter.* (VIII D53, back); and a
  thought's direction to *“…,” she added aloud* (D16). The carry now crosses only nothing, an aside
  in brackets, or the giver's own tag — one sentence, the tag opening the narration going forward
  (or a few words with a verb the tag list lacks: *the Hatter grumbled:*), closing it going back —
  and a line with a tag of its own right after it takes nothing forward (`direction.carriesAcross`,
  `narrationAround`). On one gemma run's answers (`eval:direction --out`), old rule against new:
  chapter VII 68/73 caught both, no-cue marks 5/77 → 4/77 (the 4 the model's own); chapter VIII
  50/50 → 49/50 (lost D82, *said the King very decidedly, and he called the Queen, …*), no-cue
  8/40 → 6/40 (5 the model's own, D78 carried from the model's own D77). Both chapters: 117/123
  caught (95 %), the carry's own no-cue marks 4 → 1 of 117. Against the bar on Alice VII (≥ 88 %,
  ≤ 5 %, §10.5's 64/73 and 4/77): 68/73 (93 %) and 4/77 — the bar's own 4/77. What still over-marks
  is the model's own: 9/117 (8 %) — *after thinking a minute or two*, *without considering at all
  this time*, the King's and the Queen's angry lines with no word for it. — *measured*.

### 10.25 Is round 4's weak acting the models, or our setup? (2026-10-16)

*agent, 2026-10-16* — a research agent, every source opened by it (GitHub issues through `gh`,
Hugging Face discussions through its API, pages fetched); Reddit unreachable to the tools. Asked
after round 4 (§10.22) by the user: "maybe we have something configured wrong". The verdict:
**the weak acting is the models' for Chatterbox (both), Fish S2 Pro, CosyVoice3 and Qwen3** —
users of the official PyTorch code (and Fish's own cloud) report the same; **VoxCPM2 and IndexTTS
were told less well than their authors document**; no report found of audio.cpp, or any ggml port,
losing expressiveness. The clip was the same for every model: the Hatter's Qwen3 VoiceDesign
audition, kept as his VoxCPM2 clone's reference (slice 0, §10.6) — a calm one.

- **VoxCPM2** — we sent one word, `(shouting)`, at cfg 2.0, one seed on the page. A user on
  controllable cloning: "`(assertive, crystal clear, sharp diction, faster pace)` — best result …
  All of the above had a clear and audible effect"; a maintainer: "We originally wanted the Basic
  Cloning to perform as well as the Hi-Fi Cloning, but it didn't meet our expectations"
  (OpenBMB/VoxCPM #210). An emotion in `()` on a clone moves the voice, "甚至能男变女" (even male to
  female), "可控克隆这样上不了生产" (#317, open). The usage guide: cfg 2.0–3.0 "Stronger adherence
  …more risk of noise"; the card: "generating 1–3 times is recommended", its clone example
  `(slightly faster, cheerful tone)`; the tech report (arXiv 2606.06928) trained on "free-form
  natural-language descriptions at varying granularities", cfg [1.5, 3.0], no score for
  controllable cloning.
- **Chatterbox** — exaggeration sets intensity only; nothing picks the emotion, which comes from
  the words. The README's expressive tip starts at 0.7 ("~0.7 or higher"). An English line runs the
  original English model in audio.cpp (`src/models/chatterbox/session.cpp:164-169`), where #355's
  "no noticeable effect" (multilingual) doesn't apply. EmergentTTS-Eval Emotions win rate, built-in
  voices: Chatterbox 28.03 %, Higgs Audio V2 69.28 %, ElevenLabs multilingual v2 35.35 %
  (github.com/boson-ai/EmergentTTS-Eval-public). **Turbo**: exaggeration removed — "the resulting
  naturalness was not as good … I would recommend using the original model if CFG/exaggeration is
  preferred"; the supported tags are the nine sounds, no emotions (a Resemble AI member, HF
  chatterbox-turbo #22, #21); the emotion tokens work on ONNX "sometimes … artefacts" (#492) and
  not on mlx-audio (#557).
- **CosyVoice3** — "in text-unrelated tasks, emotion accuracy drops significantly, particularly for
  'sad' and 'angry'"; "TTS systems primarily infer the emotional tone of output audio from text
  sentiment" (arXiv 2505.17589 §5.2.3; 0.5B on unrelated text: happy 0.64, sad 0.42, angry 0.58 —
  from emotional reference clips). Users: "instruct情感不明显" (the instructed emotion isn't
  noticeable), "情感与tts 文本强绑定 … 使用 instruct 时，会降低说话人相似性" (#1057, relayed from the
  team); a collaborator: instruct2 still clones, "只是韵律会更加偏向于instruct文本" (#1143). Our phrases
  are the official `instruct_list`'s. An independent test of natural-language emotion on clones:
  CosyVoice3 31.6 %, IndexTTS2 28.4 % (arXiv 2609.11523; its own method, "Joint-RL", 77.1 % — the
  51.8 % in that table is the TED-TTS baseline's; was: "51.8 % for their own method" — until
  2026-10-16, §10.26).
- **IndexTTS 2.5** — users find it weaker than 2.0: "2.5 …音色相似度,情感色彩上没有 index tts 2.0 好"
  (#759, seven agreeing), "情绪控制和音色还原上开了2.0的倒车" (#781), a one-listener blind A/B 2.0
  winning 5 of 6 (#801); no maintainer reply. The official `infer_v2_5.py` (followed by audio.cpp,
  `src/models/index_tts2/session.cpp:561-625`): the emotion is Σwᵢ·(emotion) + (1−Σw)·(the clip's own),
  text mode first turned into the same vector — so our one-hot vector at 0.65 kept 35 % of the calm
  clip, and our words arm ran at audio.cpp's default 1.0 against the README's "around 0.6 (or
  lower)"; the README's vector example is `[0, 0, 0.8, …]` at 1.0, its emotion texts sentences, not
  labels. 2.0's own trade-off: "有感情就没音色，有音色就没感情", ~0.6 the balance (#321). LibriQuote
  (arXiv 2509.04072, audiobook quotes): IndexTTS2 ContextMOS 3.33 (3.45 with the context's emotion)
  against ~2.94 for SparkTTS/F5/MaskGCT and 3.55 for human readers. audio.cpp's author shows 2.0's
  emotion vector and text at parity (index-tts #722); none for 2.5.
- **Fish S2 Pro** — "emotion tags are useless with cloned voice … only works 1 out of 10 times",
  "voice is flat", "most tags are simply ignored" (HF s2-pro #17); fish-speech #1280 confirmed twice
  more (May, July 2026); on Fish's own cloud "The speaker's voice never changes" (#1162).
- **Higgs Audio v3** — on a clone `<|emotion:anger|>` moved pitch ~7.6 semitones with ~21 % timbre
  drift, "Several emotion tags make it sound like a DIFFERENT speaker"; "character shift" in ~80 %;
  "They often tend to shout instead of subtle but evident emotions" (HF higgs-tts-3-4b #20) — our
  0.92 → 0.82 likeness. Tags at a sentence's start, stackable; `<|prosody:expressive_high|>`
  exists, unsent by us (PROMPTING.md).
- **BreezeTTS 2** — the vendor: instructions take "both short and long phrases … simply type
  'whispering' … (cfg value=2-4 usually helps)" (HF Breeze-TTS-2 #15); README "Match the instruction
  language to the target text"; audio.cpp against the official runtime: "everything matches", fp32
  activations worse ("mispronunciations and occasional runaway repetition") — it needs bf16
  (audio.cpp #380). Round 4's Breeze takes ran on the CPU (§10.22); whether that path keeps bf16
  isn't documented, and its told WER (0.045) was among the highest — unconnected so far.
- **Qwen3-TTS** — "our base model does not currently support instruct. In the future, we will
  release a 25Hz voice editing model" (QwenLM/Qwen3-TTS #25); still asked for in August 2026 (#34);
  only the six 12Hz models on Hugging Face; PR #281 (open) adds `instruct` to cloning, warning the
  base model "was not trained for instruct-guided voice cloning". No supported way to direct a clone.
- **What a fairer round would change** (for the two the authors say more about): VoxCPM2 told a
  described delivery (the book's own cue words — "sighed the Hatter", "in a hoarse, feeble voice" —
  rather than one label), cfg ~2.5–3.0, best of 2–3 takes; IndexTTS 2.0 beside 2.5, the words arm at
  ~0.6, emotion text as the book's sentence. Not found: an independent per-emotion test of Breeze or
  Higgs on a clone; a one-word vs phrase comparison for VoxCPM2; any PyTorch-vs-audio.cpp emotion
  comparison for VoxCPM2, Higgs, Fish or CosyVoice3; a new clone-emotion evaluation since
  2026-10-11 (JoyAI-Voice 2.0, arXiv 2610.08834, has none).

### 10.26 Other ways to get emotion on a copied voice — the field again (2026-10-16)

*agent, 2026-10-16* — a research agent (sources opened by it: pages, `gh` / HF API, the local
audio.cpp tree; quotes through WebFetch's summariser marked (summ.)); asked by the user: "is
there any other tts methods new or just different that might be better or available or up and
coming research?". Reddit unreachable.

- **New since 2026-10-11: Fish Audio Drama 3** (huggingface.co/fishaudio/drama-3, report arXiv
  2610.18010): a 35B MoE (3B active), multi-speaker, cloning, direction as point tags `[sighs]`,
  scoped tags `<whisper>…</whisper>`, style prefixes, director's notes and relative re-takes
  ("[softer and warmer versus previous]") (summ.). Licence **Fish Audio Community License v1.0**:
  commercial use "only while Your Annual Revenue is less than USD 500,000", audiobooks for a
  client allowed below it, "Built with Fish Audio" attribution. In audio.cpp **upstream main only**
  (`fish_drama3`, merged 2026-10-15, after v0.9.2 — not in our fork or any release), with CPU
  expert offload; "physical 16 GB and 24 GB cards have not been tested"; "Some emotion and
  nonverbal prompts produce prolonged reactions, omit dialogue or reach the generation cap".
  GGUFs: Q2 experts 15.9 GiB – Q4 22.9 GiB; a community pruned 3-bit 9.7 GiB ("should fit in 12
  GB of VRAM", Japanese and English). Emotion evidence is the vendor's only (Step-Audio-Edit
  benchmark 55.5 → 58.2 over 3 edits); Artificial Analysis Controlled-Voice arena: Drama 3 Preview
  1059, Breeze 2 1018, Eleven v4 1159 (overall preference, not emotion). Open issues: runaway on
  French clones (#1356), speaker 1 in speaker 0's voice (#1358).
- **Papers since 2026-10-07, no code or weights:** EDICT (arXiv 2610.11437 — Qwen3 VoiceDesign
  given the clip in context, 83.6 % emotion accuracy at 0.915 identity, Gemini-judged), SteerSpeech
  (2610.10415, activation steering on frozen Qwen3-TTS), E3-System (2610.12993, retrieves an
  emotional prompt clip for a described emotion), Prime-EVC, Emo-BPO, SRSP, LoopTTS (an audio-LLM
  judge writes re-take instructions). Also new, non-commercial: SteerTTS (23–48M, 51 tags incl.
  whisper, CC BY-NC), VoTSpeech (design only).
- **arXiv 2609.11523** — CosyVoice2's speech LM fine-tuned, then GRPO with emotion, duration,
  content and speaker rewards, on 56.6 h made with IndexTTS2: emotion accuracy 77.1 % against
  CosyVoice3 31.6 %, IndexTTS2 28.4 %. No code, no weights.
- **Marco-Voice** — weights released (now ATH-MaaS/Marco-Voice), **Apache-2.0** with a NOTICE
  naming CosyVoice; CosyVoice **1**-class (llm.pt 1.24 GB); seven emotions (neutral, happy, angry,
  sad, surprise, playful, fearful — no whisper, no shout); English from ESD; the authors' own
  numbers only (English emotion 0.77 vs CosyVoice1 0.67, speaker similarity 80.1 → 74.3); "There
  is a trade-off between timbre similarity and emotion control". Not in audio.cpp (no CosyVoice1
  family).
- **Voice conversion in audio.cpp** (local `model_specs/`, `docs/model_licenses.md`):
  `chatterbox` VC (MIT), `tone_color_vc` (OpenVoice V2, MIT), `meanvc2` (Apache-2.0, ~18M),
  `miocodec` (MIT), `rvc` (needs a trained voice), `seed_vc` (GPL-3.0; its GitHub repo now 404;
  style conversion "Not exposed in the current C++ route"), `vevo2` (CC-BY-NC-ND-4.0, a
  style-preserving route). Whether whisper or shouting survives any VC: still measured nowhere.
- **Qwen3-TTS** — no release since 2026-03-17; the 25Hz request (#294) closed by the stale bot on
  2026-10-14, not a maintainer. **An emotion direction added to the clone's speaker vector**
  (arXiv 2606.05367, Qwen3-TTS-12Hz-1.7B, directions averaged from ESD emotional minus neutral
  x-vectors): emotion2vec cosine angry 0.539 → 0.925, happy 0.425 → 0.687, sad 0.540 → 0.761, at
  WavLM similarity 0.945 → 0.907 / 0.951 → 0.902 / 0.948 → 0.926; no listening test; code 1★, no
  licence file. A pure-C Qwen3 engine (MIT) ships it by ear for 0.6B; the same developer calls it
  a dead end on 1.7B ("Too little state to carry emotion", summ.) — conflicting. In audio.cpp it
  needs a fork change (the embedding: `src/models/qwen3_tts/prompt_tts_voice_clone.cpp:34`,
  `talker.cpp:645`); ESD has no whisper or shout. **ESD's terms (checked by the session,
  2026-10-16): "This database can only be used for research purpose"**, with a licence form to
  send in (github.com/HLTSingapore/Emotional-Speech-Data) — directions taken from it can't ship
  in a product people sell with. **CREMA-D** (github.com/CheyneyComputerScience/CREMA-D): the
  database under the Open Database License, its clips under the Database Contents License — open
  data licences that allow commercial use (ODbL asks attribution and shares derived databases
  alike); anger, disgust, fear, happy, neutral and sad at four intensities; no whisper or shout.
- **Step-Audio-EditX** — unchanged since 2026-04-09; weights carry no licence ("The code … is
  licensed under the Apache 2.0 License"); 3B, "16GB GPU memory shoule be safer", AWQ 4-bit ~8–10
  GB; not in audio.cpp; independent emotion results near chance (20.9 % on ESD, arXiv 2603.09120;
  doteBench 23.08 %).
- **Closed services, for reference:** ElevenLabs v3 — "Tags land more readily when the delivery
  is already in the voice's training data", and professional clones "are not fully optimized for
  Eleven v3 … we recommend trying Eleven v4"; Hume's acting `description` is Octave 1 only; OpenAI
  custom voices are for eligible customers, with no `instructions` shown for them; MiniMax's
  `emotion` includes whisper on speech-2.6 models, its use on cloned voices undocumented.
- **The agent's ranked shortlist for us:** Qwen3 with the x-vector direction (commercial-OK
  weights, a small fork change, untested by ear on 1.7B); Qwen3 VoiceDesign / CustomVoice given
  the clip in context (EDICT; a fork change); IndexTTS with an acted emotion clip (no code change —
  in round 5); Fish Drama 3 (commercial below USD 500k; not in our pin; 8 GB untested);
  act-then-convert with the MIT/Apache converters (emotion survival unmeasured); Marco-Voice (low:
  CosyVoice1-era, no whisper or shout, would need a port).

### 10.27 Building emotion ourselves: EDICT's method, the design models, a person as the bar (2026-10-16)

*web, checked by the session 2026-10-16* — the user: "can you figure out how [EDICT] works or any of
the research and build something yourself, can we build it with my 8gb card?", then "if the tts
cant do the emotion directly maybe we do the emotion in a different method" and "what things can
work togetther to get us the voice we want".

- **EDICT** (arXiv 2610.11437, demo danny-nus.github.io/EDICT-demopage/, its authors named in the paper — was: anonymous, until 2026-10-17, §10.32; no code or
  weights, none promised). Two stages. **Stage I** edits a reference voice's timbre with a
  *trained* editor (Qwen3-TTS-12Hz-1.7B-Base fine-tuned in full, then preference-trained) into an
  edited codec reference — the part our DSP character-voice plan (§8) covers another way.
  **Stage II** needs no training: a frozen backbone (Qwen3-TTS VoiceDesign; CosyVoice 2 as a
  second) gets the shared reference "through in-context learning" with each segment's
  natural-language instruction; at each instruction change "The old KV cache is discarded" and a
  fresh prefill holds "the new instruction, shared edited reference, new text" plus the "first S
  and most recent K generated codec positions" of the speech so far, (S, K) = (4, 5) — about 0.3 s
  and 0.4 s at 12 Hz. The prompt layout itself is not given. IntraTTS-Bench (997 requests, Chinese
  and English; Gemini-judged accuracy, WavLM similarity between segments, SIM-I), Qwen3-TTS-VD:
  Concat. (each segment synthesised on its own with its instruction and the original reference,
  joined) EmoAcc 92.66 % at SIM-I **0.658**; Joint (one pass) 66.37 % at 0.922; TED-TTS 74.02 % at
  0.911; **EDICT Stage II 83.60 % at 0.915**, WER 5.1 %. 19 listeners: Stage II beat TED-TTS on
  following instructions and on transitions. So the reference alone doesn't hold the voice when the
  instruction changes (0.658); the carried context does (0.915) — the cure for §1.3's finding that
  a voice made from words is not stable across pieces.
- **The voice-design models in our build** (§10.15): Qwen3-TTS VoiceDesign (the run's
  `design_model`, Apache-2.0 — its makers report it "beats MiniMax-Voice-Design on InstructTTSEval
  and leads other open models by a wide margin", self-reported), MOSS-VoiceGenerator (commercial
  use Yes, §10.13; made for natural, less studio-clean voices, arXiv 2603.28086; bf16 5.7 GB,
  spilled once on this card, §10.17), VoxCPM2 (designs from a parenthesised description,
  Apache-2.0), BreezeTTS 2 (commercial use No), FireRedTTS3 Instruct and FireRedAudio (cloning "for
  academic research"), Irodori v3 VoiceDesign and v4.1. No head-to-head comparison of them found;
  none made by ear here.
- **A person as the bar:** LibriVox's dramatic reading of *Alice's Adventures in Wonderland*
  (librivox.org/4511; narrator David Goldfarb, Alice by Miss Avarice, about 40 readers, one per
  character), the Internet Archive copy (aliceinwonderland_1102_librivox) marked Public Domain Mark
  1.0; chapters VII (14:31) and VIII (13:27) at 64 kbps in `data/round5/human/`.
- **The emotions each way can cover** (the reasoning behind round 6b, TASKS): an emotion direction
  from CREMA-D covers anger, disgust (contempt's nearest), fear, happy, sad — not whisper or shout;
  DSP can make a real whisper (voicing removed) and can push an angry take toward a shout (pitch,
  brightness, compression); priming with an emotional lead-in works on a model that takes its
  feeling from the words (CosyVoice3's paper: "TTS systems primarily infer the emotional tone of
  output audio from text sentiment"). Whether VoiceDesign whispers and shouts on a held voice is
  unmeasured.

### 10.28 Qwen3 CustomVoice speaking our voice — what the "graft" really is (2026-10-16)

*agent, 2026-10-16* — a research agent reading source: the MIT C engine
github.com/gabriele-mastrapasqua/qwen3-tts (commit ef339be5), the official QwenLM/Qwen3-TTS Python
(022e286b) and our fork (`../audio.cpp`, `jv` at bcc5dfbb); GGUF headers read locally. For round
6b's step 3 (TASKS "Round 6b").

- **The C engine's default "graft" holds no reference audio frames.** Frames are saved only with a
  transcript (`main.c:2155`, `:2738`); its own doc: "our voices are NOT 'ICL' voices … store **0
  ref_codes** … what `--icl-only` actually keeps … is the **8 KB x-vector** (+ the TPAD/WOVR
  overrides)" (`docs/icl-graft-portability.md:51-56`). A `.qvoice` holds the ECAPA x-vector (2048
  floats on 1.7B), optional transcript and frames, and Base's tts_pad/bos/eos and text_projection
  plus Base's codec rows 0..2047, which replace CustomVoice's on load (`main.c:2334-2346`). Made on
  Base only — CustomVoice has no ECAPA (`main.c:2141-2142`).
- **The prompt** (`qwen_tts.c:1070-1486`, the official layout): the instruct first (`<|im_start|>user
  …<|im_end|>`), the role, the codec prefix with **the x-vector in the speaker slot** where
  CustomVoice puts a preset's row — rescaled to preset row 3061's norm (not official) — then, with
  frames, reference text + target text + eos, then the reference frames' 16-codebook embeddings.
- **Their results:** with the x-vector graft, instruct works at about half a preset's strength —
  "a naturally calm cloned voice gives *irritated/passive-aggressive* anger and a *veiled* sadness
  … (instruct response is ~half a preset's)" — and "gender / age / dialect barely move"
  (`docs/archive/expressivity.md`). **With real reference frames on CustomVoice, "Emotion barely
  moves … the ref_codes are a very strong prosody anchor … and they damp the instruct"**
  (`icl-graft-portability.md:177-181`); frames also carry the recording's room. The author's
  current emotion method on clones is a fine-tune pack plus a steering vector plus the instruct:
  "Neither alone is enough on a clone" (`emotions-on-cloned-voices.md:71`); "Instruct is
  Chinese-tuned and weak on EU" (archive); README "beta" is that recipe. Instruct wording: vivid
  English or Chinese prose; slot templates fail; too strong "can destabilise (noise)"; temperature
  ~0.9 (low flattens); aggressive sampling "can break EOS → runaway". 0.6B ignores instruct.
- **Official Python:** the model-level `generate()` already combines instruct with a voice-clone
  prompt (`modeling_qwen3_tts.py:2076-2106`, `:2170-2197`); only the wrappers block it
  (`qwen3_tts_model.py:401-407`, `:548-554`, `:788-800`); CustomVoice has `speaker_encoder = None`
  (`:1822-1825`). Qwen: "our base model does not currently support instruct" (#25); clone +
  instruct promised as Qwen3-TTS-25Hz-1.7B-VoiceEditing (#14) — not released.
- **Our fork:** Base's clone prompt `prompt_tts_voice_clone.cpp:32-61`, the x-vector into the
  speaker slot `talker.cpp:645`, no instruct on that branch (CustomVoice/VoiceDesign add it at
  `talker.cpp:576-584`); routing `session.cpp:648-675` (Base: voice_ref, reference_text,
  x_vector_only_mode) and `:691-710` (CustomVoice: speaker, instruct); encoders built for Base only
  (`:368-381`). Measured from the GGUFs: CustomVoice 1.7B Q8 **contains the speech-tokenizer
  encoder** (225 tensors, ~117 MB) but **none of the 76 `speaker_encoder.*` (ECAPA)** tensors (~24 MB
  in Base Q8); CustomVoice's 9 speaker rows have norm 13.9–15.6 where Base's are ~0.022; codec rows
  0..2047 cosine 0.998 (min 0.994), text_projection 0.999, talker layers 0.997–0.999 — close to Base,
  not identical.
- **The smallest fork change** (the agent's plan, not built): in the clone branch prepend the
  instruct rows (`talker.cpp` ~:639); in `session.cpp` let a CustomVoice request with `voice_ref`
  fill the clone input, keep its instruct, the speaker optional; build CustomVoice's speech encoder
  from its own file and the ECAPA from the Base GGUF named by a new session option (e.g.
  `qwen3_tts.speaker_encoder_model`, Base on disk, not loaded; encoders run on the CPU — host RAM,
  not VRAM); A/B both x-vector-only and reference-frame modes; a unit test that the CustomVoice
  clone prefill equals Base's with the instruct rows prepended. JustVoice: `curated/qwen3_tts.js`
  CustomVoice rows `clone: false` (`:94-110`), `slot.js:969-982` ("the CustomVoice model cannot
  clone"), `capability_details.js`.

- **Checked again 2026-10-16** (an agent reading the fork and the C engine for round 6b's plan,
  `docs/plans/2026-10-16-customvoice-our-voice.md`): the smallest fork change above **misses the
  Base weight overlay** — the C engine's default graft also copies Base's text_projection, codec
  rows 0–2047 and the tts_pad/bos/eos rows into CustomVoice (WOVR + TPAD, `main.c:2290-2380`);
  without it "coherent ✅, **different timbre (mel 0.49)**" (`docs/icl-graft-portability.md:95-99`).
  The x-vector rescale fires only when the target row's norm is > 0.1 — on CustomVoice, never on
  Base (`qwen_tts.c:1319-1336`). "Neither alone is enough on a clone" is
  `blog/emotions-on-cloned-voices.md:70`, an unpublished draft (`published: false`). §10.26's "a
  dead end on 1.7B" is inaccurate: the blog (`:52`) says "the 4 KB speaker vector" (0.6B's size;
  1.7B's is 8 KB) and never names 1.7B. The fork's GGUF reader memory-maps the file
  (`read_binary_blob` → `MapViewOfFile`); the runtime's memory estimate counts every session
  option path's file size, its guard off unless `min_free_memory_mb > 0` (JustVoice sets none);
  JustVoice's `SESSION_FILES` is family-wide (`generated.js:552-584`); `build/jv-dev` has tests
  off, `build/jv-tests` is a CPU Ninja folder with them on. — *agent, read in code*.

### 10.29 Round 5 — each engine told the authors' way, a person as the bar, scored (2026-10-16)

TASKS "Round 5". Through the app (`npm run round4:render`, the dev build bcc5dfbb; IndexTTS's clip
arms through the speech runtime's `/v1/tasks/run`), the Hatter's clip copied to each model, round
4's 50 cue lines told and not told, seeds 7, 8, 9: 300 takes an arm, 1,800 in all, none failed.
Told = the line's direction words as gemma's direction step found them (`data/round5-direction.json`;
the key's cue where it found none). Scored by `tools/take-check` as round 4 (Whisper turbo,
UTMOSv2 on seed 7); `npm run round4:report -- data/round5/score/out`. A person: LibriVox's dramatic
reading of Alice (librivox.org/4511, Public Domain Mark 1.0), the page's 13 lines found in chapters
VII–VIII by Whisper turbo (every line an exact word match) and cut; scored against themselves.

| Arm (how told) | Emotion gain [95% CI] | Heard as asked: told · not | Shouted / whispered Δ LUFS | WER told · share > 0.25 | Speaker sim told · not | UTMOSv2 | s a take |
|---|---|---|---|---|---|---|---|
| IndexTTS 2.0, acted clip (Breeze acting in Alice's voice, 0.9) | +0.14 [0.04, 0.30] | 0.21 · 0.08 | +11.6 / −2.4 | 0.037 · 0.04 | 0.77 · 0.93 | 2.47 | 2.0 |
| BreezeTTS 2 (direction words, on the card) | +0.13 [0.05, 0.23] | 0.23 · 0.11 | +5.8 / −8.0 | 0.023 · 0.03 | 0.85 · 0.91 | 2.88 | 4.5 |
| IndexTTS 2.0, words at 0.6 | +0.11 [0.04, 0.22] | 0.19 · 0.08 | +5.3 / +0.8 | 0.016 · 0.01 | 0.89 · 0.93 | 2.93 | 2.2 |
| IndexTTS 2.5, words at 0.6 | +0.10 [0.03, 0.25] | 0.27 · 0.16 | +3.4 / +1.3 | 0.021 · 0.01 | 0.90 · 0.93 | 3.11 | 2.0 |
| IndexTTS 2.5, acted clip | +0.06 [0.01, 0.12] | 0.24 · 0.16 | +6.7 / −1.6 | 0.226 · 0.25 | 0.73 · 0.93 | 2.39 | 1.9 |
| VoxCPM2 (direction words, cfg 2.7) | +0.04 [0.01, 0.08] | 0.15 · 0.11 | +4.7 / +3.5 | 0.015 · 0.01 | 0.87 · 0.92 | 2.78 | 1.8 |

- **By emotion** (gain): angry — IndexTTS 2.0 clip +0.49, words +0.35, 2.5 words +0.26, VoxCPM2
  +0.15, Breeze +0.14; sad — only Breeze moves (+0.18); fearful — IndexTTS 2.5 words +0.18, 2.0 clip
  +0.16; contemptuous — nobody. Against round 4 (§10.22): VoxCPM2 told the line's words at cfg 2.7
  is no better (+0.04 vs +0.06), and **a whispered line came out louder** (+3.5 dB); Breeze on the
  card is lower than round 4's CPU run (+0.13 vs +0.20, same loudness gaps) — gemma's direction
  words in place of the app's one-word emotion. — *measured*.
- **IndexTTS's acted clip** carries loudness (2.0: shouted +11.6 dB, the biggest of any arm) but
  costs the likeness (0.93 → 0.77) — the community guide's warning that an emotional clip leaks
  into the voice (§10.10). **On 2.5 a quarter of the clip takes don't read back** (WER > 0.25 on
  25 %): broken takes. — *measured*.
- **The scorer against a person:** emotion2vec+ hears the person's anger (7-32 at 1.00, 7-3 at 0.96)
  and nothing else — the sad, fearful, contemptuous and happy lines all at 0.00 (top class happy,
  neutral or angry). The person's loudness: shouted −19.6 and −22.1 LUFS; whispered −30.1 (8-67)
  and −18.5 (8-48, read aloud). So emotion2vec ranks angry takes, and loudness shouted and
  whispered ones; for sad, fearful and contemptuous the ear decides (§10.11). — *measured*.
- **Narration** (10 Alice VII passages, seed 7, no direction; the Alice voice on VoxCPM2 and its
  Breeze copy): WER 0.017 and 0.023, UTMOSv2 2.70 and 3.05, 7.1 and 14.3 s a passage. — *measured*.
- **The page** (the user's four steps and a best-of pick; the person hidden among the takes):
  on each line the person, Breeze, VoxCPM2's pick and a VoxCPM2 take the scorers passed over, and
  IndexTTS's better words arm and better clip arm (by emotion gain: 2.0 both), each the scorers' pick
  of its three seeds — the take within 0.2 WER of the best that has the most of the asked emotion
  (emotion2vec+, or loudness for shouted and whispered; Llasa's verifiers, §10.10); the two
  narrators on the ten passages. claude.ai/artifact/JksCTD7KkySRK6tQneVqMf (collection `round5`).
  · `data/round5/` (gitignored).
- **The user's ears** (2026-10-17; the page's buttons named for each line's feeling — the full
  feeling · weaker · plain · something else, TASKS "The listening pages"; 116 answers, two takes
  unrated, the whole-book questions unanswered):

  | Take | Full feeling | Weaker | Plain | Something else | Picked best |
  |---|---|---|---|---|---|
  | BreezeTTS 2 | 9 | 2 | 2 | 0 | 9 |
  | IndexTTS 2.0, acted clip | 4 | 2 | 1 | 6 | 2 |
  | VoxCPM2, the scorers' pick | 2 | 5 | 3 | 3 | 1 |
  | IndexTTS 2.0, words | 1 | 2 | 7 | 2 | 1 |
  | VoxCPM2, a take the scorers passed over | 1 | 5 | 5 | 2 | 0 |
  | The person (LibriVox) | 0 | 4 | 2 | 6 | 0 |

  - **Breeze is what the ear wants:** the full feeling on both shouted, both contemptuous, both
    whispered, one angry, one sad and the happy line; weaker on both fearful. — *measured by ear*.
  - **VoxCPM2 whispers in a whispered voice at speaking volume:** "the volume was loud but in a
    whispered voice" (8-67, 8-48; the same note on IndexTTS's clip take of 8-48). — *by ear*.
  - **The scorers' pick barely beats a passed-over take:** on the 8 lines where both VoxCPM2 takes
    got a feeling, the pick was higher on 2, the same on 5, lower on 1; on 5 more, one of the two
    was something else. — *by ear*.
  - **IndexTTS's acted clip** is wrong as often as right: 6 something else, noted "wrong" on both
    sad lines and "wrong emotion" on 8-27. — *by ear*.
  - **The person is no bar:** never the full feeling; notes "bad" (8-57, 8-67, 8-48) and "wrong"
    (7-3). Two of the person's cuts carry a narration word: Whisper hears "shouting off with his
    head" (8-57) and "whispered she is under sentence of execution" (8-48) — the cut follows
    Whisper's segment times, which run loose (`data/round5/human/lines/found.json`). — *measured*.
  - **Narration:** VoxCPM2 (the Alice voice itself) read better on 9 of 10 passages, the same on 1;
    Breeze's copy on none. The Alice voice is a child's ("a young girl around seven to nine years
    old"), not a narrator's, so the narrator's engine was judged on a child's voice (§10.31,
    2026-10-19). A whole book: VoxCPM2 "yes", Breeze's copy "with fixes" (the user in
    chat, 2026-10-17 — the page's two answers never saved: their key "r5whole-Narrator 1" has a
    space, which the page's store refuses; fixed in the page's version 3). — *by ear*.
  - **The narrator shares the characters' model today:** `makeVoices` keeps every designed voice on
    `book_voices.clone_model`, the narrator included (`book_voices/index.js:188, 320, 359`); no
    narrator setting exists. Keeping the narrator on VoxCPM2 while the characters move to Breeze
    needs one: `docs/plans/2026-10-17-narrator-and-character-engines.md`. — *read in code*.

### 10.30 Round 6b step 3 — Qwen3 CustomVoice 1.7B speaking our voice, standard pieces only (2026-10-17)

TASKS "Round 6b", step 3; plan `docs/plans/2026-10-16-customvoice-our-voice.md`.

**What was tested.** Our fork's `qwen3_tts.base_model_path` (jv 8461cdce):
- Base's ECAPA x-vector of the Hatter's clip goes in CustomVoice's speaker slot (arm
  `customvoice-ours`).
- Or the same, plus the clip's frames from CustomVoice's own tokenizer and the clip's words (arm
  `customvoice-ours-icl`).
- Either way, the line's direction words as instruct, its rows first.
- **Not** the MIT C engine's x-vector rescale (P5) or its Base weight overlay (P6). Those two wait
  for the user's word.

**How it ran.** Through the app's dev runtime: the model is loaded through the app, registered
again with the option, and each take sent to `/v1/tasks/run`.
- Takes: all 50 cue lines, told and plain, seeds 7, 8, 9 — 300 takes an arm, none failed.
- Told words: round 5's (`data/round5-direction.json`).
- Scored as round 5 (§10.29); round 5's rows are on the same 50 lines.

| Arm | Emotion gain [95% CI] | Heard as asked: told · not | Shouted / whispered Δ LUFS | WER told · share > 0.25 | Speaker sim told · not | UTMOSv2 | s a take |
|---|---|---|---|---|---|---|---|
| CustomVoice, x-vector | +0.01 [−0.03, 0.08] | 0.17 · 0.16 | +0.6 / −2.7 | 0.039 · 0.03 | 0.87 · 0.89 | 3.18 | 0.8 |
| CustomVoice, x-vector + clip (ICL) | −0.01 [−0.05, 0.01] | 0.07 · 0.07 | +1.0 / −0.5 | 0.031 · 0.01 | 0.91 · 0.91 | 3.35 | 0.8 |
| *round 5:* VoxCPM2 (best sellable) | +0.04 [0.01, 0.08] | 0.15 · 0.11 | +4.7 / +3.5 | 0.015 · 0.01 | 0.87 · 0.92 | 2.78 | 1.8 |

- **It does not act, in this form.** — *measured*.
  - The emotion gain's interval crosses 0 on both arms; by emotion every row is within ±0.04.
  - Shouted lines are louder by only 0.6 and 1.0 dB (VoxCPM2: +4.7).
  - The one sign of direction is the x-vector arm's whispered lines, 2.7 dB quieter. VoxCPM2's
    came out louder.
  - The ICL arm acts least, as the C engine's author warns: reference frames damp the instruct
    (§10.28).
- **The direction reaches the model.** — *measured*.
  - None of the 300 told takes is byte-identical to its plain twin of the same seed.
  - The path is code-verified: the request's `instruct` → `custom_voice.instruct` → the
    voice-clone prompt builder → instruct rows first. The fork's unit test proves the rows.
  - Told takes run about as long as plain ones: median length ratio 1.03 and 1.00, none over 2.6×.
- **It keeps the voice and sounds the best of any arm so far.** — *measured*.
  - ICL: speaker similarity 0.91 told and plain; UTMOSv2 3.35. Round 5's best was IndexTTS 2.5 at
    3.11 (§10.29).
  - x-vector: 0.89 plain, just under the plan's 0.90 bar.
  - Both read back (97 % and 99 % of takes at WER ≤ 0.25).
  - The fastest arm measured: 0.8 s a take on the card.
- **Against the plan's bars (§4):** 1 passes on both arms. 2 passes on ICL; the x-vector arm
  misses by 0.01 plain. 3 fails on both. The bars send this form to EDICT, unless P5 and P6 change
  it. The card's peak memory with the option was not recorded.
- **The page:** on each of round 5's 13 lines, the person, VoxCPM2's round-5 pick and each
  CustomVoice arm's pick, by round 5's rule. https://claude.ai/artifact/UJjuQupm5aHTzuEhAmNRpZ
  (collection `round6b`). Data: `data/round6b/standard/` (gitignored).
- **The user's ears** (2026-10-17, the same buttons as round 5's page; 72 answers, a best take
  picked on 12 of 13 lines):

  | Take | Full feeling | Weaker | Plain | Something else | Picked best |
  |---|---|---|---|---|---|
  | VoxCPM2, round 5's pick | 3 | 6 | 2 | 2 | 7 |
  | CustomVoice, fingerprint | 5 | 1 | 7 | 0 | 4 |
  | CustomVoice, clip and words (ICL) | 0 | 2 | 10 | 1 | 0 |
  | The person (LibriVox) | 0 | 4 | 3 | 6 | 1 |

  - **The fingerprint arm acts where the scorer said it doesn't:** the full feeling on both shouted
    lines, angry 7-32 and both contemptuous lines; plain on both sad, both whispered, the happy line
    and one fearful (weaker on the other); never something else. The emotion gain (+0.01) and the
    shouted loudness (+0.6 dB, a mean over all three seeds) missed it; each page take is the
    loudest of its three seeds. — *by ear*.
  - **The ICL arm acts on nothing:** the clip's frames damp the direction, as the C engine's author
    found (§10.28). — *by ear*.
  - **Fingerprint against VoxCPM2, line by line:** the fingerprint higher on 2 (7-95, 7-57), VoxCPM2
    on 3 (7-3, 7-31, 8-27), the same on 6; VoxCPM2's two whispers something else. Best picks:
    VoxCPM2 7, the fingerprint 4. The plan's bar 4 ("prefer its picks … on more lines than not") is
    not met. — *by ear*.
  - **One listener's answer moves by a step with the takes around it:** the same VoxCPM2 takes
    (seeds checked) got the same answer on both pages on 8 of 13 lines, one step apart on 5 (Breeze
    sat beside them on round 5's page); the person's got the same on 11 of 12. — *by ear*.
  - **The person's notes:** "says the word wispered" (8-48 — the narration word in the cut); "says
    intructions" on 8-44 and 8-27, where Whisper hears only the line — unexplained. — *by ear*.

### 10.31 Round 6b steps 2 and 4 — a lead-in before the line; whispers in a mastered chapter (2026-10-17)

TASKS "Round 6b", the go after the ears ("think on it again your rec go"). Through the app's dev
runtime (`npm run dev`, fork 8461cdce).

- **Priming, rendered:** three engines we can sell, each told the line and also given a lead-in in
  the line's feeling, said first in the same take: VoxCPM2 (the line's words, cfg 2.7), CosyVoice3
  (its own instruction sentence, as round 4) and CustomVoice 1.7B with the Hatter's fingerprint (the
  line's words).
  - The lead-ins, written for the test: sad "Oh dear. It's no use, it's all gone wrong.", fearful
    "Oh no. Oh dear, I'm so frightened.", happy "Ha! I knew it, I knew it all along!".
  - The lines are the five VoxCPM2 left plain or weaker by ear: 7-70 and 7-31 sad, 8-27 and 8-44
    fearful, 7-117 happy. Seeds 7–9 make 45 takes.
  - The cut is made 60 ms before the line's first word, as the app's aligner times it (`/v1/align`,
    Qwen3-ForcedAligner), with a 10 ms fade-in: `npm run round4:render -- --prime`.
  - **Every cut take reads back as its line alone:** WER ≤ 0.25 on all 45 (median 0). Likeness to
    the clip is 0.89 for VoxCPM2, 0.92 for CosyVoice3 and 0.91 for CustomVoice. — *measured*.
  - Median render, lead-in included: VoxCPM2 4.3 s, CosyVoice3 2.1 s, CustomVoice 3.1 s a take.
    — *measured*.
- **Whispers in a mastered chapter:** VoxCPM2's whispered takes from round 5's page (8-48, 8-67,
  seed 8) are placed between their chapter neighbours, read in round 5's narrator voice. They are
  turned down with the line's own gain (dsp `shape`), joined with the app's pauses
  (`render_core.concatLines`, 600 / 250 ms) and mastered with the app's ACX preset
  (`mastering.masterToWav`): `server/scripts/round6b_whisper.js`. The whisper is measured against
  its neighbours with the app's analyzer (RMS, as its ACX check reads it):

  | Whisper turned down | 8-48: before → after mastering | 8-67: before → after |
  |---|---|---|
  | 0 dB | +2.0 → −1.9 dB | −1.5 → −2.6 dB |
  | −6 dB | −3.9 → −3.7 dB | −7.5 → −6.7 dB |
  | −12 dB | −9.7 → −7.7 dB | −13.5 → −11.6 dB |

  - **The chapter's mastering narrows a whisper's gap by about 2 dB.** `dynaudnorm=g=15` runs over
    the whole chapter before `loudnorm` (`mastering.js:130-134`). It pulls an untouched whisper down
    and lifts a turned-down one. — *measured*.
  - As made, VoxCPM2's whisper on 8-48 is 2 dB **louder** than the narration around it. — *measured*.
- **The page:** https://claude.ai/artifact/F5nXrvZyPbTiiMgrk9sXaw (collection `round6b2`).
  - Part 1: each of the five lines, with the three engines with and without the lead-in, seed 7.
  - Part 2: both whispered stretches at the three levels.
  - Data: `data/round6b/primed/`, `data/round6b/whisper/` (gitignored).
- **"Round 5's narrator voice" is Alice's** (`round6b_whisper.js:28`, voice
  `voice_57b65ae89e7c419988809f0bba684851`, the one-click run's designed voice for Alice: "Female,
  a young girl around seven to nine years old, with a clear, bright, and articulate pitch …"). The
  test book has no narrator voice of its own, and round 5's narration sample read the passages in
  this voice too (§10.29). So both heard a child's voice as the narrator. The user, 2026-10-19:
  "is it supposed to be a high pitched kids voice?". — *read in code and the voice's manifest*.
- **The user's ears** (2026-10-19; collection `round6b2`). The full feeling · weaker · plain ·
  something else · picked best, over the five lines:
  - **Priming:** without the lead-in, no engine got the full feeling on any line. With it, the full
    feeling came on 3 takes.
    - CustomVoice and its fingerprint: 0 · 1 · 3 · 1 · 0 without; 2 · 1 · 2 · 0 · 2 with — full and
      picked best on 8-44 (fearful) and 7-117 (happy). Round 6 had nobody full on 7-117.
    - VoxCPM2: 0 · 3 · 2 · 0 · 2 without; 1 · 1 · 3 · 0 · 0 with (full on 8-44).
    - CosyVoice3: 0 · 2 · 3 · 0 · 0 without; 0 · 3 · 2 · 0 · 1 with.
    - The sad lines stayed weaker or plain either way. 7-70's words were "pointing with his tea
      spoon". The page showed "The engines were told —" on every line: the page builder read the
      words from a take that had none. The engines got them.
  - **Whispers:** 8-48 was "something else" at 0, −6 and −12 dB, each with the note "loud but in
    whispered voice not as loud a narrator but volume still high". On 8-67, 0 and −6 dB were
    "something else" (the same note), and −12 dB was the full feeling and picked best. After
    mastering, the gap at −12 dB is −11.6 dB on 8-67 and −7.7 dB on 8-48. So a whisper must sit
    about 12 dB under the narration after mastering, not 8. All of it was heard against a child's
    narration (above). — *the user's ears, 2026-10-19*.

### 10.32 Sad, fearful and happy on CustomVoice's fingerprint — three ways compared (2026-10-17)

*agent, 2026-10-17* — a research agent, read-only: papers and repos opened, our fork read at
8461cdce, GGUF headers read locally. For the plan `docs/plans/2026-10-17-sad-fearful-happy.md`.

- **An emotion direction on the x-vector** (arXiv 2606.05367): tested only on 1.7B **Base**, ICL mode
  with the x-vector swapped in and not renormalised (its repo `src/xvec.py:50-53`; the x-vector's
  norm 16.4, the directions' 1.2–2.0). Judged only by emotion2vec cosine (angry 0.539 → 0.925, happy
  0.425 → 0.687, sad 0.540 → 0.761; WavLM likeness −0.02 to −0.05). No fear, no listening test (§6,
  future work). The repo has no licence (`license: null`). Nobody has tried a direction on
  CustomVoice. — *read*.
- **The MIT C engine's "steering vector" is something else:** it is added to the residual stream at
  talker layers 21–25 (`blog/emotions-on-cloned-voices.md:65`, `qwen_tts_talker.c:803-806`), not to
  the x-vector. — *read in code*.
- **No x-vector leaves our fork today:** the runtime has an `ArtifactKind::SpeakerEmbedding`
  (`include/engine/framework/runtime/session.h:134`), but `qwen3_tts` never emits it. — *read in
  code*.
- **CREMA-D** is 16 kHz (the ECAPA resamples linearly, `speaker_encoder.cpp:94-105`). Its intensity
  levels exist on one sentence only ("It's eleven o'clock"), and per-clip crowd votes
  (`summaryTable.csv`) let clips heard as another feeling be dropped. ODbL §3.1 allows commercial
  use. Shipped averaged vectors are most likely a Produced Work (attribution, §4.3); published
  per-clip vectors may be a Derivative Database (share-alike, §4.4, §4.6). The agent's reading, not
  legal advice. — *read*.
- **EDICT** (arXiv 2610.11437, Table 3, Qwen3-TTS-VD, size not given): its per-segment row
  ("Concat.", each segment from the reference alone, our per-line case) has accuracy 92.66 at
  **SIM-I 0.658**. Judged by Gemini 3.1 Pro; the 19 listeners appear only in Fig. 4, with no
  per-emotion split. Its Tables 14–15 show more kept context weakening the instruction. The
  VoiceDesign 1.7B Q8 GGUF holds the speech-tokenizer encoder (225 tensors, 117 MB) and no ECAPA
  — *measured*. Its prompt branch has no speaker slot (`talker.cpp:572-627`). — *read*.
- **Instruct guidance:** BreezeTTS 2's untold prompt is its clone prompt minus the instruction
  (official `breeze_infer/templates.py:54-55, 95-104`; our fork `breeze_tts/tokenizer_text.cpp:117-126`,
  `generator.cpp:1077-1085, 1160-1164`). Breeze guides its depth decoder too (`:968-972`).
  - Guidance on autoregressive logits is established: Koel/Magpie, Chatterbox, Dia and Breeze; our
    fork has it in Chatterbox (`t3_component.cpp:611-615`), Breeze and Magpie (`runtime.cpp:1210`).
  - **No Qwen3 port has it:** not official, not upstream audio.cpp, not the C engine, mlx-audio or
    vLLM-Omni.
  - CCG-CFG (arXiv 2510.13293, emotion guidance on CosyVoice2): "up to a 12% absolute improvement
    in emotion-recognition accuracy". Sanchez et al. (arXiv 2306.17806): "High CFG (γ≥1.5) leads to
    a deterioration" in text models.
  - The talker steps one sequence with its own cache (`talker.cpp:1175-1235`; sampling `:1925-1938`).
    A second cache costs 2 × 28 × 8 × 128 × 4 bytes = 224 KB a position. — *read in code*.
  - Not known: whether Breeze's acting comes from guidance or from its training. Breeze has never
    been heard here at γ 1.
- **The agent's ranking:** guidance first; the direction as the next arm (its vectors extracted
  meanwhile); EDICT last. — *agent's view*.
- **Built (2026-10-19, the user's word on the NOT STANDARD pieces):** guidance in our fork, jv
  8d726fa9 (`guidance_scale`; the untold pass has its own prefill graph and step cache, its logits
  mixed before the repetition penalty; the code predictor follows the told pass); the clip's
  x-vector out, jv 1de98891 (`return_speaker_embedding`, a SpeakerEmbedding artifact, 2048 float32
  on the 1.7B). The fork's CustomVoice clone test: γ 1 renders today's take sample for sample, γ
  2.5 a different one, a plain request is unchanged at any γ. — *tested*.
- **CREMA-D's directions (2026-10-19)** — *measured*, `round4_render.js --crema data/crema-d`:
  - **The clips:** 3,099 of 7,442 kept, those whose voice-only crowd vote (`summaryTable.csv`
    VoiceVote) is the feeling asked for — neutral 1,040, angry 770, fearful 407, disgusted 343,
    happy 330, sad 209 (91 actors). Fetched from the repo's LFS (248 MB).
  - **The fingerprints:** Base 1.7B's speaker encoder through CustomVoice 1.7B (as the fingerprint
    arm runs), each beside a thrown-away two-frame take: 3,100 in about 750 s on the card. Mean
    length 16.6; the Hatter's 17.1.
  - **The directions** (an actor's feeling mean minus their own neutral mean, averaged over actors;
    the pooled means agree, cos 0.94–1.00): angry 2.62 long (72–91 actors), happy 1.28, sad 1.17,
    fearful 1.13, disgusted 0.79 — 5–16 % of a fingerprint's length.
  - **They hold on actors they weren't made from:** made from half the actors, the other half's
    feeling clips sit above their neutral clips along it by angry 1.69, fearful 1.52, happy 1.49,
    disgusted 0.73 and sad 0.69 standard deviations.
  - **They are mostly one axis — how roused the voice is:** angry·happy cos 0.91, fearful·happy
    0.81, angry·fearful 0.70; sad points the other way (angry·sad −0.63, happy·sad −0.54). So a
    direction moves arousal more than the feeling: "happy" would also push toward angry. Sad is
    the weakest and least separable, and it is one of the three this step is for.
  - Not known yet: what CustomVoice does with a moved fingerprint (D4 — the input path doesn't
    exist yet), and whether arousal alone is what the ears hear as sad, fearful or happy.
- **The guided takes on the card (2026-10-19)** — *measured*, `data/round6b/guided`, all 50 cue
  lines, told and plain, seeds 7–9, at γ 1, 2.5 and 4 (900 takes, none failed): a plain take is
  the same file in all three arms for 147 of 150; the three that differ are the longest line's
  (8-13, about 17 s), the same in the 2.5 and 4 arms and different from γ 1's. The likely reason:
  the told step cache had grown to a different size by then (guided told takes run longer), and
  on the card a long take follows the cache's size — not checked further. Median told length
  1.76 s at γ 1, 1.92 at 2.5, 2.08 at 4 (plain 1.68); median seconds a take 0.8, 1.0, 1.0.
  - **Scored** (test kit, as round 5; γ 1 · 2.5 · 4): feeling gain +0.01 · +0.01 · +0.03 [−0.02,
    0.10]; by feeling, sad +0.00 · +0.01 · +0.04 [0.00, 0.15], fearful +0.02 · +0.03 · +0.05,
    happy −0.02 · −0.01 · −0.02, angry +0.04 · +0.03 · +0.04; whispered −2.7 · −3.5 · −4.7 dB,
    shouted +0.6 · +0.8 · +0.6 dB; read-back WER 0.039 · 0.034 · 0.066 (over 0.25: 7 · 8 · 11 of
    300); like the clip, told 0.87 · 0.87 · 0.86; UTMOSv2 3.16 · 3.13 · 3.04. γ 1 on today's build
    scores as round 6b's on the old one (UTMOSv2 3.18, the rest the same). So by the scorer,
    guidance moves sad, fearful and the whisper a little, costs a little at 4, and does nothing
    for happy or the shout. emotion2vec gave CustomVoice's acting nothing in round 6b where the
    ears heard five lines act, so the ears decide (the round 6 page, version 2). **By ear it fails
    the bar:** 1 of the 5 sad, fearful and happy lines at γ 2.5 and at 4 (§10.33, the user's ears,
    2026-10-19).

### 10.33 Round 6 — Fish Audio Drama 3 in our fork and in the app (2026-10-18)

TASKS "Round 6". Our fork's `jv` merged audio.cpp's upstream main of 2026-10-18 (9106c13a).

- **How Drama 3 is directed, by its makers** (fish.audio/blog/fish-audio-drama-3, 2026-10-13):
  a free-text note in square brackets before the words — "[choked up, crying quietly] I left his
  jacket by the door.", "[through gritted teeth, keeping his voice down] I asked you to do one
  thing tonight." — in any language; point cues mid-line ("[shaky breath]", "[small laugh]",
  "[whispering]"); paired tags around words ("<emphasis>do not open that door.</emphasis>",
  "<whisper>…</whisper>"). Relative re-takes ("softer and warmer versus previous") are invite-only.
  Its Hugging Face card documents only the point tags ("[sighs] Fine. If we miss it, it's on you.
  [laughs] …") and `previous_takes` editing; its benchmark sampled at temperature 1.0, top_p 0.9,
  top_k 30. Third-party guides (morphic.com, eesel.ai) list seven paired tags — whisper, emphasis,
  soft, fast, slow, stress, forceful — not confirmed on docs.fish.audio. — *read*.
- **In the app** (the catalog regenerated at `jv`, locally): engine `fish_drama3`, one model,
  `fish_drama3-q4k`, 22,302 MB (the Q4 experts / Q8 backbone package, `Jmica/Drama-3-GGUF`);
  Auto puts it on the CPU ("its files are about 22 GB, more than this card's 8 GB"). Load options
  include `fish_drama3.disk_experts` (false), `expert_cache_size` (32), `cpu_expert_layers` (4),
  `pin_experts`, `context_length` (2048). Licence: Fish Audio Community License v1.0, our word
  **Conditional**, accepted once before its download. audio.cpp marks the family experimental. —
  *read from the running app*.
- **Our CustomVoice change survives the merge:** the fork's `qwen3_tts_customvoice_clone_test`
  passes on the real 1.7B CustomVoice and Base files (CPU build, `build/jv-tests`). — *measured*.
- **Its licence, our reading** (`curated/fish_drama3.js`, the licence at
  huggingface.co/fishaudio/drama-3/blob/main/LICENSE, "Fish Audio Community License Agreement,
  Version 1.0 — Last Updated: October 13, 2026"): §III(a) commercial use "only while Your Annual
  Revenue is less than USD 500,000", revenue being "the total gross revenue of You and Your
  Affiliates, in aggregate, from all sources"; §III(b) at or above it, notify business@fish.audio
  within 30 days, and "any use for a Commercial Purpose requires a separate written license
  agreement"; §III(c) "no license is granted … to offer a Hosted Service"; §IV(a) "You shall
  prominently display "Built with Fish Audio" on a related website, user interface, blogpost";
  §IV(c)(iii) you own the outputs. Our word **Conditional**, as audio.cpp's. The model card's
  metadata names it "fish-audio-research-license", which the file's own title doesn't match. —
  *read, 2026-10-18*.
- **Kitten TTS 2 at `jv`:** upstream #947 moved it to a `v2` folder with BF16, Q8 and Q4 GGUFs and
  added `kitten_tts2` to the web UI's expose-all families (`catalog.ts`); our port
  (`scripts/audiocpp-catalog.js`) follows, so a catalog made at `jv` offers all three, as
  audio.cpp's UI does. — *code, 2026-10-18*.
- **Round 6's takes** (`data/round6`, arm `drama3-r6` in `server/scripts/round4_render.js`): round
  5's 50 lines, told and plain, seeds 7–9, 300 takes. Told = one free-text note before the words,
  "[<the line's direction words, else the emotion word>] line", sent straight to the speech
  runtime (`/v1/tasks/run`), because the app strips a bracket a model's notes don't list
  (`render_core.performableText`) — a first run through the app gave told takes byte-identical to
  plain (kept in `data/round6-stripped`, not used). Load options `disk_experts=true`,
  `cpu_expert_layers=0`: about 7.2 GB on the 8 GB card, the runtime's working set 17.4 GB (10.2 GB
  private), the app's measured price 16 GB + 1 GB margin; a median 6.9 s a take (the first two
  after a load 32 s, the experts coming off the disk). All 150 told takes differ from their plain
  twin. — *measured, 2026-10-18*.
- **Scored** (take-check, whisper turbo, `data/round6/score/out`), against round 5's table (§10.29)
  and round 6b's (§10.30): emotion gain told − plain **+0.10 [0.05, 0.18]** (BreezeTTS 2 +0.13
  [0.05, 0.23], VoxCPM2 +0.04, CustomVoice with the fingerprint +0.01); heard as asked 0.20 · 0.09;
  shouted **+3.6 dB**, whispered **−3.7 dB** (Breeze +5.8 / −8.0; VoxCPM2 +4.7 / +3.5); read-back
  WER 0.026, 7 of 300 takes over 0.25 (4 told); like the clip 0.88 · 0.90 (Breeze 0.85 · 0.91);
  UTMOSv2 3.09 (Breeze 2.88, VoxCPM2 2.78, CustomVoice 3.18). By emotion: angry +0.20, sad +0.10,
  fearful +0.03, happy −0.02, contemptuous 0.00 (emotion2vec hears anger best, §10.29). So on the
  scorer Drama 3 acts about as Breeze does, with a better-sounding take and the voice kept closer,
  weaker shout and whisper, slower; it can be sold with under its revenue cap and attribution,
  Breeze not without a separate licence. The ears decide: page
  https://claude.ai/artifact/6VanH77XsNMb8UaKq1V2F2 (collection `round6`). — *measured, 2026-10-18*.
- **Fish S2 Pro again, on the merge's Fish codec fixes (#936, #937)** (`data/round6-fish`, arm
  `fish-r6`: round 5's lines told the line's direction words through the app, as round 5's arms):
  gain +0.02 [0.00, 0.05] (round 4's tags, §10.22: 0.00); shouted +2.6 dB, whispered −4.3 dB; WER
  0.017; like the clip 0.90 · 0.92; UTMOSv2 3.37, the best of any engine here (round 4: 3.30);
  2.1 s a take. The fixes help how it sounds, not how it acts. — *measured, 2026-10-18*.
- **Through the app it gets no direction yet:** the catalog at `jv` offers it, but its notes
  (`curated/fish_drama3.js`) have no `DIRECTION`, so `performableText` drops the note. The app's
  `prefix` direction (`generated.applyDirection`) would send the emotion's tag and then the words
  as two brackets ("[angry][looking angrily] …"), which round 6 didn't test: what was tested is one
  note, the words else the emotion word. Wiring it waits for the ears and for a release with
  Drama 3 (a jv.7, its own decision). — *code, 2026-10-18*.
- **Drama 3 with no top-k cap** (`data/round6k`, arm `drama3-r6k`, request option `top_k` 4097 —
  upstream audio.cpp's default since #978, 2026-10-18, "matching Fish's Space … top_k=30 left takes
  stuck in silence" on long chunked text; nothing else changed): gain +0.09 [0.04, 0.18] (top-k 30:
  +0.10); heard as asked 0.17 · 0.11; shouted +2.3 dB (+3.6), whispered −3.9 dB (−3.7); like the
  clip 0.88 · 0.89; UTMOSv2 2.97 (3.09); 5.9 s a take (6.9). Read back: 10 of 300 over 0.25 (7),
  three of them babbling far past the line (WER 14.5, 10.0, 6.25 — 8-54 plain, 7-95 told, 7-85
  told, all seed 7), told mean WER 0.136 (0.026). On our short single lines the cap is the better
  setting; the stall it guards against is long text cut into chunks. So the round 6 page (version
  2) keeps the top-k 30 takes, and the app's Drama 3 options, when it is wired (jv.7), need this
  weighed: our lines are short, but a narrator's paragraph is chunked. — *measured, 2026-10-19*.
- **Upstream since our merge** (to f82b88a9, 2026-10-18, 16 commits, not merged): Drama 3's
  `top_k` default 4097 and `text_chunk_size` 128 (#978), Drama 3 base/small packages (#976, #959:
  per-layer expert counts, a speech-only head), Fish DAC chunked reference encoding to cut the
  card's peak (#960); also Qwen3's speech decoder (7 files). Taking them is jv.7's merge, and the
  rule "an audio.cpp update tests only the engines and models it adds" applies. — *read, 2026-10-19*.
- **The user's ears on the round 6 page, version 2** (2026-10-19; collection `round6`: 78 answers,
  a best pick on 12 lines, 4 notes; tallied by the session's `tally_r6.js`). Seed 7, the 13 lines,
  six takes behind letters. The full feeling · weaker · plain · something else · picked best:
  - BreezeTTS 2: 8 · 2 · 2 · 1 · 5 (round 5's ears: 9 of 13 full, §10.29).
  - Fish Audio Drama 3 (top-k 30): 5 · 1 · 6 · 1 · 5.
  - VoxCPM2: 3 · 4 · 5 · 1 · 1.
  - CustomVoice with the Hatter's fingerprint, guidance 1 · 2.5 · 4: full 1 · 2 · 1, weaker
    5 · 3 · 3, plain 6 · 7 · 6, something else 1 · 1 · 3, best 1 · 0 · 0.
  - **By the line's kind.** Loud lines (shouted, angry, scornful; 6): Breeze full on 5, Drama 3 on
    3 and picked best on 3, VoxCPM2 on 2. Quiet lines (sad, fearful, happy; 5): Breeze 2 full and 2
    weaker, picked best on 3; Drama 3 1 full (7-31, sad) and 4 plain; VoxCPM2 1; CustomVoice 0–1.
    Whispered (2): Drama 3 and Breeze full on one each. The note "loud but whispered style" on four
    whisper takes (Drama 3, Breeze, VoxCPM2, guidance 4), round 5's finding again (§10.29).
  - **7-70 (sad) is plain in all six takes.** Its told words were "pointing with his tea spoon",
    the direction step's pick of an action, not the book's "shook his head mournfully".
  - **Guidance fails its bar** (the plan's: the full feeling on 3 of the 5 sad, fearful and happy
    lines at some γ, nothing worse elsewhere). 0 of the 5 at γ 1, 1 at 2.5 (8-44), 1 at 4 (8-44,
    with 7-31 "something else"). γ 4 was "something else" on three takes (7-3, as at every γ;
    7-31; 8-48) and lost 7-95's shout, which γ 1 and 2.5 had.
  - **What every engine was given:** the book's cue words, most of them one word ("sighed",
    "timidly", "triumphantly", "indignantly"). Drama 3's makers direct with a description of the
    delivery ("[choked up, crying quietly]"); that was not tested.
  - **For the user's three questions:** the best overall and the best we can't sell with is
    BreezeTTS 2. The best we can sell with is Drama 3, under the Fish Audio Community License
    (under USD 500,000 a year, "Built with Fish Audio" shown). It is strong on loud lines and plain
    on 4 of the 5 quiet ones. Of the Apache models, VoxCPM2 is best at 3 of 13. — *the user's ears,
    2026-10-19*.

### 10.34 Round 7 — a delivery note in place of the cue words; the narrator's own voice (2026-10-19)

TASKS "Round 7". Through `npm run dev` (fork jv 1de98891).

- **The notes come from the app's direction step** (`eval:direction --system <file>`, the Local
  recipe on gemma-4-26b-a4b-qat, chapters VII–VIII), changing only the prompt's `direction` rule.
  - Asked for "how the voice sounds saying it, the way a director writes a note for a voice
    actor", with Fish's two examples, gemma copied the book's cue on most lines ("sighed",
    "pointing with his tea spoon", "tossing his head contemptuously"). Only 4 of the 13 page lines
    changed.
  - Adding "Turn the text's cue into the sound of the voice; never copy the cue" and three
    made-up examples from outside the book ("he snapped" → "short and sharp, out of patience")
    changed all 13: e.g. 7-70 "mournful, dejected", 7-31 "sighing, disappointed", 7-117
    "triumphant, gloating", 8-27 "timid and pleading". Two still name a movement ("dismissive,
    tossing his head").
  - The cost: lines the book gives no cue were marked 96 of 117 (82 %); the first trial prompt
    marked 21 %, and the live prompt was accepted at ≤ 5 % (slice 2, `eval_direction.js`'s
    header). The "Most lines get nothing" rule is overridden, so the prompt isn't fit for the app
    as written. — *measured*.
- **Rendered** (seed 7, the 13 lines, told and plain): Drama 3 (`drama3-r6`, the note as its
  bracket), BreezeTTS 2 and VoxCPM2, into `data/round7/notes`.
  - Drama 3's and Breeze's plain takes match round 6's and round 5's sample for sample, so the
    words are the only change.
  - VoxCPM2's don't: upstream #950 ("size the step graphs by the request", merged 2026-10-18)
    changes its takes. So its cue-word takes were made again on today's build
    (`data/round7/cue`), and their plain takes match.
  - Median seconds a take: Drama 3 8.2, Breeze 5.2, VoxCPM2 2.2. — *measured*.
- **Scored** on the 13 lines, cue words → note: emotion gain Breeze +0.07 → +0.15, Drama 3 +0.08 →
  +0.00, VoxCPM2 −0.03 → +0.00. UTMOSv2: Breeze 3.24 → 3.26, Drama 3 3.31 → 3.25, VoxCPM2 3.07 →
  3.00. Read-back and likeness are unchanged. emotion2vec misjudged these before (§10.29), so the
  ears decide. — *measured*.
- **The narrator's own voice, made the app's way.** The test book's narrator is cast to the
  library's "Narrator" persona (Kokoro am_echo), so the describe step skips it. So a test copy of
  chapter VII was imported ("Alice VII (narrator test)"), with its narrator "Narrator (test)".
  - `book-voices/describe` (Local, gemma, the chapter's opening): "Female, middle-aged, bright and
    clear pitch with a crisp, storytelling quality. She reads at a rhythmic, engaging pace with a
    whimsical yet poised manner."
  - `book-voices/design`: Qwen3 VoiceDesign (`design_model`), its audition kept as the clip on
    VoxCPM2 (`narrator_model`). Voice `voice_05015321d46549e7b9f1f2cdc925978d`, 42 s.
  - The narration sample: round 5's 10 passages (the same text), `server/scripts/narration_sample.js`.
    VoxCPM2 read-back 0.019, UTMOSv2 3.57, 6.3 s a passage. Breeze's copy read-back 0.016,
    UTMOSv2 4.05, 15.6 s. With Alice's child voice on round 5: 2.70 and 3.05. — *measured*.
- **The whispers against that narrator** (`round6b_whisper.js --narrator … --gains=-12,-18`).
  The whisper against its neighbours after mastering:
  - 8-48: −9.0 dB at −12, −15.1 dB at −18 (against the child narrator, −7.7 at −12).
  - 8-67: −12.4 dB at −12, −18.2 dB at −18 (−11.6 at −12).
  - The adult narration is louder against the same whisper. — *measured*.
- **Drama 3 directed in the app:** `curated/fish_drama3.js` `DIRECTION` — one note in square
  brackets, the line's words else its emotion's word, then a space (`one_note`), as round 6 heard
  it. It runs under `npm run dev` (the local engine list), and the installed app gets it with jv.7.
  — *code + unit test*.
- **The page:** https://claude.ai/artifact/ASSsCBtrwrZihqNYvKW8TH (collection `round7`). Part 1:
  6 takes a line (each engine with the cue words and with the note). Part 2: the narration, A/B.
  Part 3: the whispers at −12 and −18 dB.
- **The user's ears on the round 7 page** (2026-10-20; collection `round7`, 114 answers; tallied
  by the session's `tally_r7.js`). The full feeling · weaker · plain · something else · picked
  best, on 13 lines:
  - BreezeTTS 2 with the note: 7 · 4 · 0 · 1 · 6; with the cue words: 6 · 4 · 2 · 0 · 4 (one take
    of each left unrated, with a note).
  - Drama 3 with the cue words: 5 · 1 · 6 · 1 · 3 (round 6: 5 · 1 · 6 · 1 · 5); with the note:
    0 · 6 · 5 · 2 · 0.
  - VoxCPM2 with the cue words: 0 · 8 · 4 · 1 · 0; with the note: 0 · 7 · 5 · 1 · 0.
  - **By the line's kind.** Quiet lines (sad, fearful, happy; 5): Breeze with the note full on 3
    and picked best on 4; with the cue words full on 1, best on none. Loud lines (6): Breeze full
    on 4 either way, best 3 with the cue words, 2 with the note; Drama 3's cue words full on 3.
    Whispered (2): Drama 3's cue words (8-48) and Breeze's cue words (8-67) full and picked best.
  - "Loud but whispered style" on 7 whisper takes, each engine and both ways — the engines whisper
    at full voice (§10.29, §10.33).
  - So the note helps Breeze — most on the quiet lines, the gap the rounds have chased — and
    takes Drama 3's feeling away. VoxCPM2 is weaker either way. The scorer's emotion gain ranked
    them the same way (Breeze up, Drama 3 down).
  - **Narration:** BreezeTTS 2's copy picked on all 10 passages. "Would you listen to a whole
    book read this way?" Breeze's copy: yes; VoxCPM2: "with fixes".
  - **Whispers in the mastered chapter:** both lines heard as the full feeling at −12 and at −18
    dB; −18 dB picked best on both (the gap after mastering −15.1 and −18.2 dB). — *the user's
    ears, 2026-10-20*.
  - **Mastering narrows a whisper's gap by about 3 dB** (the same files, `data/round7/whisper/
    results.json`): before mastering the gaps were −12.1 / −18.1 dB (8-48) and −15.9 / −21.8 dB
    (8-67); after, −9.0 / −15.1 and −12.4 / −18.2. So "−15 dB" heard after mastering is about
    −18 dB in the chapter as joined. — *measured*.
- **Attacked before acting (2026-10-21, TASKS "Round 7's answers acted on"):** the narration test
  shuffled A and B once, not per passage — Breeze was A on all 10; the same Breeze cue-word files
  heard in rounds 6 and 7 were rated differently on 3 of 13 lines (the ears' own noise); one fixed
  cut gave the two whispers different gaps. Hence round 8's paired design below, the narration test
  with Drama 3 and a long stretch, and whispers set by a gap.

### 10.35 Round 8 — the delivery note against the cue words, paired (set 2026-10-21, before rendering)

TASKS "Round 7's answers acted on", 3. Through `npm run dev`.

- **Lines:** chapters IX and X of Alice (no round has used them). `server/scripts/round8_lines.js`
  runs the app's own steps through its Lab routes, writing nothing: discover-speakers, analyze-text,
  then direction-text twice on the same input — the live prompt (the cue words the app writes
  today) and round 7's note prompt (`data/round8/note_system.txt`, "Turn the text's cue into the
  sound of the voice; never copy the cue" with three made-up examples). 30 lines the live prompt
  directed whose two answers differ in words, spread over its emotions.
- **Takes:** BreezeTTS 2 in round 5–7's voice (the Hatter's, `breeze-r5`), the line's emotion the
  same both ways, only the words differ; seeds 7 and 8 (`round4_render.js --lines-file
  --told-only`). 120 takes.
- **The page:** each pair is one line, one seed, the cue words and the note in shuffled order (A
  and B drawn per pair): "Which says the line more the way the book means it?" — A · B · no
  difference. 60 pairs, and 6 of them again later with A and B swapped (the ears' own noise).
- **The rule, set before listening:** the note wins clearly only when, over the 60 pairs, it is
  picked more than the cue words with a one-sided sign test p < 0.05 (ties counted for neither —
  e.g. 32 of 50 decided pairs), **and** at least 4 of the 6 repeated pairs get the same answer
  both times. Then the note prompt goes to the app (the live direction prompt changed; its
  over-marking of lines with no cue, 82 % in round 7, fixed first). Otherwise the cue words stay
  and nothing is built.
- **What ran (2026-10-21):** discover found 6 people in IX and 7 in X; the live prompt directed 51 of
  135 spoken lines in IX and 49 of 116 in X; the note prompt marked 133 of 135 and 66 of 116. 86
  lines had both, in different words; 30 kept — neutral 5, happy 5, angry 5, fearful 5, shouted 5,
  sad 4, whispered 1. Many notes reword the cue (“angrily” → “angry”, “with a sigh” → “sighing”),
  some differ (“in a low, weak voice” → “low, weak, trembling”), two say only “neutral”. 120
  BreezeTTS 2 takes, every one told the words its list holds (checked): median 7.1 s (cue words),
  6.9 s (note). — *measured*.

### 10.36 The narrator again: BreezeTTS 2 against Drama 3, with a long stretch (2026-10-21)

TASKS "Round 7's answers acted on", 1 (and 2: Drama 3 heard before VoxCPM2 is fixed). Through
`npm run dev`.

- **Takes:** round 7's narrator voice (`Narrator (test)`, designed by the app's own describe and
  design steps) copied to BreezeTTS 2 (round 7's copy) and to Drama 3 (`fish_drama3-q4k`, disk
  experts, both pinned to the card for the run), seed 7, no direction:
  `narration_sample.js --engines breeze_tts:breeze_tts-q8,fish_drama3:fish_drama3-q4k --opening
  300` into `data/round8/narration`. The 10 passages are round 5's and 7's; the opening is chapter
  VII's first 13 paragraphs whole (311 words, quotes and all), each rendered on its own and joined
  with the app's pause between lines. (A first try took the narration lines alone: “said the
  March Hare. said Alice angrily. …” — fragments, not a stretch of the book; kept beside it as
  `opening-lines.wav` for Breeze.)
- **The page:** round 8's part 2 — A and B drawn per passage (round 7 drew them once), "the better
  reading" A · B · no difference, and for the opening "Would you listen to a whole book read the way
  narrator A reads this?" per narrator.
- **What ran (2026-10-21):** render time per passage, on the card — BreezeTTS 2 10–28 s (median
  15.4 s), Drama 3 18–95 s (median 29.3 s), the same text. The opening (311 words): BreezeTTS 2
  115.7 s of audio in 132 s, Drama 3 119.7 s in 256 s. Drama 3's disk experts map ~17 GB of RAM
  while loaded: with JustVoice's chat model also up, free memory went under 4 GB twice and Claude
  Code stopped the session's background jobs. Load one model at a time. — *measured*.

### 10.37 Round 9 — dots.tts told a feeling through its Edit model (set 2026-10-24, before rendering)

TASKS "dots.tts through the scorer on round 4's lines". Through `npm run dev`.

- **Takes:** round 4's 50 cue lines of Alice VII–VIII and its voice (the Hatter's clip, copied to
  DotTTS SOAR q8, `dots_tts-dotsttssoar-q8`), seeds 7, 8, 9. **Not told:** SOAR's take through the
  app (`/v1/generate`, uncached). **Told:** that same take (same line, same seed) remade by DotTTS
  Edit q8 (`dots-tts-edit-q8_0.gguf` from audio.cpp's catalog entry `dots_tts_edit_q8_0`, sha256
  checked) with `template_name=edit`, `source_audio` the untold take, and the text
  `<emo desc="a … tone">line</emo>` — the word round 4 told every engine ("shouting", "sad",
  "frightened" …) in the authors' form (doteBench's `<emo desc="a happy and excited tone">`, arXiv
  2608.02673 Fig. 1); `use_xvector` left on its default (`auto`: off for a pure `emo` edit). The
  app has no Edit model (a speech editor, not a voice — `generated.js` keeps it off the speech
  list), so the told takes go to the speech runtime the app runs, Edit registered there under the
  app's SOAR id (`round4_render.js --arms dots-edit`).
- **Scored** by the test kit as round 4 (`take-check score --device cuda --quality-seeds 7
  --whisper-model turbo`), beside round 4's table (§10.22).
- **The rule, set before rendering:** dots.tts goes to the user's ears only if (a) its emotion gain,
  told − not, is above VoxCPM2's +0.06 with its 95 % interval above 0, and (b) the edited takes keep
  the voice and the words — speaker similarity told 0.80 or more (round 4's lowest among the arms
  that acted: Higgs 0.82) and WER told 0.05 or less (round 4's worst arm: 0.049). Otherwise it stops
  at the scores.
- **What ran (2026-10-24):** 300 takes, none failed; on the card a median 2.4 s a take and 2.5 s
  more for the edit (`data/round9`, scores `data/round9/score/out`). Emotion gain **+0.09 [0.02,
  0.24]**; heard as asked 0.23 told · 0.12 not; shouted +4.0 dB [3.0, 5.0], whispered −0.4 dB
  [−1.4, 0.3]; WER told 0.017; speaker similarity 0.82 told · 0.91 not; UTMOSv2 2.89. **It passes the
  rule** — but all of the gain is anger (+0.42 [0.22, 0.73] on 6 lines); sad, fearful, happy and
  contemptuous moved by nothing (−0.03 to 0.00), and a whispered line comes out no quieter. Against
  round 4 (§10.22): above VoxCPM2 (+0.06) and IndexTTS in words (+0.10 is within its interval),
  under Breeze (+0.20) and Higgs (+0.24). — *measured*.
- **The page:** https://claude.ai/artifact/CazRBhwcSGgHRHZjqx3PQE (collection `round9`; builder
  scratchpad `r9_page.js`, template from round 6's version 2 plus round 8's "Anything off" row):
  round 5's 13 lines, seed 7, four takes — dots.tts told, its own take before the edit, BreezeTTS 2
  and VoxCPM2 from round 4, told the same word.

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

**Pronunciation** — [`2026-09-30-project-lexicon.md`](../plans/2026-09-30-project-lexicon.md) ·
[`2026-10-09-finishing-the-open-work.md`](../plans/2026-10-09-finishing-the-open-work.md) §3 (Lexicons'
▶, Try a word and Affects; the same plan carries New project, Effects, Engines and the updater).

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
