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
  is not done. The family guard (`../../../just-llm-runner/scripts/check-family.mjs`, check 15)
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
  their ids, and speech recognition transcribed again without reloading. On an older build it
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
- A failed warm-up is logged at info and the load still reports success. — *agent, 2026-10-04*
  · `slot.py:272-273, 305-306`; audit §5 B4.
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
  dies; elsewhere nothing ties them, and a clean shutdown slower than Tauri's 15 s leaves it
  running until the next start's sweep. — *record (R15) + agent, 2026-10-04* · switch R15;
  audit §5 C6.
- audio.cpp answers 400, 503 `insufficient_memory`, 503 `server_busy` or 500; we keep only the
  message and turn every one into a 500. Its own free-memory guard is off
  (`min_free_memory_mb` 0). — *agent, 2026-10-04* · audit §5 D8.

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
- **Defaults inside audio.cpp:** Qwen3 temperature 0.9, top-k 50, top-p 1.0, repetition 1.05,
  `max_new_tokens` 8192 (the model's own `generation_config.json`); Chatterbox temperature 0.8,
  repetition 1.2, min-p 0.05, top-p 1.0 (upstream `mtl_tts.py` on master says the same); Turbo
  0.8 / top-p 0.95 / top-k 1000 / 1.2; VoxCPM2 guidance 2.0, 10 steps. Our Chatterbox knob shows
  2.0 and 1.2 is used. — *code + web, 2026-10-04* · `../audio.cpp/include/engine/models/chatterbox/tts.h:22-25`,
  `capability_details.py:173, 203`; audit §5 D3, §7.
- Temperature 0: Qwen3 refuses it, Chatterbox divides by it, Turbo treats it as 1.0. Qwen3
  top-p 0 turns the filter off. — *agent, 2026-10-04* · audit §5 D4, D9.
- **audio.cpp splits a request's text itself:** budgets Chatterbox and Turbo 128 characters,
  Kokoro 240, Kitten 400, VoxCPM2 2,048, Qwen3 8,192; `options.text_chunk_size` overrides. It cuts
  at a sentence end, then a clause, then a space, and joins the pieces with no crossfade. Our
  host splits above `max_chunk_chars` (800) at sentence ends with a 50 ms crossfade. — *code,
  2026-10-04* · `../audio.cpp/src/framework/text/chunking.cpp:332-397`; `render_core.py:774-797`;
  audit §5 D5.
- Options the runtime reads that the app doesn't expose, per engine — audit §7. Only Kokoro's
  model spec lists its options (`model_specs/kokoro_tts.json`: request, session, load); the
  Qwen3, Chatterbox, VoxCPM2 and Pocket specs list none. — *code, 2026-10-04*.
- Qwen3: a missing or unsupported language is sent as "English"; audio.cpp's own default is
  "Auto". — *agent, 2026-10-04* · `slot.py:506`; audit §5 D6.
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
- Chatterbox Multilingual drops `[laugh]` rather than speaking it. — *measured, 2026-10-01* ·
  switch §8 live.
- v0.9.0's aligner gave seconds at the input rate (2/3 of real on 24 kHz); fixed in our build
  jv.1, and the slot still sends 16 kHz mono. — *measured, 2026-10-01* · switch §8 live;
  our-audiocpp-copy.

### 1.4 Builds, releases and installs

- Pinned build `v0.9.0-jv.1`; an install still on `v0.9.0` keeps working until updated.
  Features name the first build that has them: `voxcpm2_transcript` jv.1; `voice_pack`,
  `inline_ipa` jv.2; `turbo_clone`, `chatterbox_he_ru_zh`, `japanese` jv.3 (placeholders until
  the next release is cut). — *code, 2026-10-04* · `engines/audiocpp/release.py:23-41`.
- The tag `v0.9.0-jv.3` holds Turbo cloning (`3865d245`) but **not** Hebrew/Russian/Chinese
  (`fc55e1e6`), Japanese (`6a2bb4c5`), the libmecab/jieba staging (`6d1825eb`) or the macOS fix
  (`faf1ee03`). — *git, 2026-10-04* · audit §5 E2.
- Only `voice_pack`, `turbo_clone` and `inline_ipa` are checked against the INSTALLED build; the
  other three are offered from the pin alone. — *agent, 2026-10-04* · audit §5 E1.
- The Windows CUDA download is the build archive plus a 607 MB CUDA-runtime archive (engines.md
  says 461 MB). — *agent, GitHub API, 2026-10-04* · audit §5 F.
- eSpeak NG 0.2.4's wheels on PyPI: `macosx_10_12_x86_64`, `macosx_11_0_arm64`,
  `manylinux_2_17_x86_64.manylinux2014_x86_64` (two tags in one name), `manylinux_2_28_aarch64`,
  `win_amd64`, `win_arm64`. The install matches any one tag of a name. (was: an exact suffix
  match that missed the Linux x86_64 file, so the runtime install couldn't finish there — until
  2026-10-04.) — *web (PyPI JSON) + code, 2026-10-04* · `espeak.py` `wheel_matches`; audit §5 A2.
- Model files come from `audio-cpp/audio.cpp-gguf` pinned at commit `7bf52723…`, checked by
  size only. — *code, 2026-10-04* · `release.py:60-61`; audit §5 E6.
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
- 16-bit rows carry no CPU speed, so Auto never sends them to the CPU and the AI model makes
  room. — *agent, 2026-10-04* · `release.py:107`; audit §5 B6.
- The safety margin is 1,024 MB (the kit's setting; the manager falls back to the same). —
  *code, 2026-10-04* · `manager.py:800-803`.

---

## Records not yet distilled

Indexed by subject so they can be found; their facts move into a section above when work next
touches the subject. History in [`../plans/archive/`](../plans/archive/) is not listed.

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

**Docs** — [`2026-08-04-docs-coverage-worklist.md`](../plans/2026-08-04-docs-coverage-worklist.md).

**Research kept in this folder** —
[`2026-06-24-audiobook-nlp-competitor-research.md`](2026-06-24-audiobook-nlp-competitor-research.md) ·
[`external-import-formats.md`](external-import-formats.md) ·
[`ue-integration-design.md`](ue-integration-design.md) ·
[`journey-podcast.md`](journey-podcast.md).
