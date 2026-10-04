<!-- SPDX-License-Identifier: MIT -->
# The audio.cpp switch, audited — 2026-10-04

An adversarial review of every decision in the switch to audio.cpp
(`2026-10-01-audiocpp-switch.md`, `2026-10-02-cpu-placement.md`, `2026-10-02-our-audiocpp-copy.md`,
the gap docs), of the code it landed in, and of why Qwen3 needs so much memory. **Read this before
fixing anything in `engines/audiocpp/`, `engines/manager.py` or the fork** — the measurements and
the source reading here should not be redone.

Nothing was fixed by this audit. Every fix in §11 needs its own go, with its blast-radius table.

How each claim was checked is marked: **[me]** read or tested by the auditor in this session ·
**[agent+data]** found by a review agent and checked against outside data (PyPI, GitHub, git) ·
**[agent]** found by a review agent reading code, not re-checked · **[inferred]** reasoned, not
measured. JustVoice paths are relative to the repo; audio.cpp paths are in `../audio.cpp` (branch
`jv`).

## 1. What the user said (verbatim, typos kept)

1. "rethink the qwen3 design with wrds i am sure we can get it to run fine on this card, verify
   what opus did and think of a solution"
2. "how can voice design being only 1.7b params not work fine on this card" · "the file tensor is
   only 3.83 gig something is wrong"
3. "i want you to do a review of all the deciisons opus has mad on the swtich to audio cpp do a deep
   audit and recommend anything you would change including what you just found, think on it
   adversiarlly nad review the code"
4. "something to test and think about the 7.8gb peak, what caused it?  to mean the individual
   speaking lines are not that long so why do we need to keep so much in memory, is it performance,
   can we do better memory managment or cache, something to look into for all speech engines"
5. "i dont know what all config options we have … same for any of our engines we should expose all
   options possible so we can tweak for maximum perfomance memory and accuracy and even change
   dynamically as needed,   you can do any testing you need to help diagnose the problem and find a
   good fix"
6. "i theink the audo cpp has line splitting option in its gui, are we already using or exposing
   all those options as needed?"
7. "i thought all audio was being hnadled direcly by audio cpp, so we are still passing from our
   javascript gui to our server to audio cpp?"
8. "can we design it better? think of this as part or your audit process"

## 2. Bottom line

- **Qwen3 VoiceDesign runs on the 8 GB card.** The 7.8 GB peak is not the model: memory during
  generation grows with the length of the line, and our server sends up to 800 characters whole.
  Split at 200 characters, a 752-character VoiceDesign line peaks at 3,976 MB instead of 7,122 MB,
  at the same speed (§3).
- **A clone's reference clip is re-processed with every line.** A 15.5 s clip with its words puts a
  14-character line at 5,407 MB. Splitting does not help; a shorter clip or sound-only cloning does.
- **The switch works, and its request mapping is mostly right**, but three parts are weak by design:
  memory bookkeeping (§5 B), hand-copied options (§5 D, §7) and process restarts (§5 C). One finding
  blocks every other machine: Kokoro and Kitten load a system eSpeak NG, never the one the app
  downloads (§5 A1).

## 3. Memory — measured

### 3.1 How

On the app's own runtime (`npm run dev`, our audio.cpp checkout's CUDA build, RTX 2070 SUPER 8 GB,
Windows 11), talking to its GPU process directly with **no model loaded through the app's manager**
— so nothing was written to the measurement store (checked: no rows after the tests). The AI model
was unloaded throughout. Card-wide `nvidia-smi memory.used` sampled every 100 ms; the process's own
dedicated memory read at each step (the kit's `process_tree_device_mem_mb`). Every model started
from an empty process (`unload_all_models`), spoke four lines in order, then the short one again.
Same seed. The clone clip was 15.5 s of Kokoro speech with its transcript.

Lines: **short** 14 characters · **medium** 138 · **long** 383 · **xlong** 752 (the host's
`max_chunk_chars` is 800, `models.py:113`).

### 3.2 Peak above idle, MB (process memory after the line in brackets)

| Model (8-bit) | short | medium | long | xlong | short again |
|---|---|---|---|---|---|
| Kokoro (190 MB file) | 609 (609) | 1,693 (1,693) | 2,721 (1,787) | 2,735 (2,167) | 2,169 (613) |
| Qwen3 CustomVoice 1.7B (2.7 GB file) | 2,528 (2,619) | 3,366 (3,469) | 5,284 (3,879) | 6,872 (4,817) | 4,562 (3,089) |
| Qwen3 VoiceDesign 1.7B | 2,356 (2,445) | 3,312 (3,413) | 5,988 (5,275) | **7,122** (6,249) | 6,144 (2,843) |
| Qwen3 Base 1.7B, clone, clip + words | 5,407 (5,523) | 7,135 (6,059) | 7,143 (4,109) | 7,121 (3,750) | 5,249 (4,210) |
| Chatterbox Multilingual | 1,758 (1,859) | 2,462 (2,325) | 2,898 (2,049) | 3,480 (2,205) | 2,104 (1,861) |
| Chatterbox Turbo | 1,812 (1,915) | 2,170 (2,063) | 2,812 (1,993) | 2,856 (2,035) | 1,932 (1,915) |
| VoxCPM2 | 4,160 (2,939) | 4,608 (2,939) | 6,418 (2,939) | 6,438 (2,939) | 4,000 (2,939) |

Audio made / time taken for the xlong line: Kokoro 45.0 s / 3.6 s · Qwen3 CV 56.0 / 28.6 · VD 44.8 /
27.1 · Base 43.1 / 25.5 · Chatterbox 44.0 / 22.5 · Turbo 43.0 / 15.0 · VoxCPM2 36.5 / 23.4.
After `unload_all_models` the process read 103–105 MB every time.

### 3.3 With the runtime's own splitting (`options.text_chunk_size`), and sound-only cloning

| Run | medium | long | xlong |
|---|---|---|---|
| VoiceDesign, split at 200 | 3,278 | 3,348 | **3,976** (48.4 s of audio in 23.9 s) |
| VoiceDesign, split at 120 | — | — | 3,100 (48.2 s in 25.8 s) |
| Base clone, sound only (`x_vector_only_mode`) | 3,243 | 4,983 | — (short: 2,219) |
| Base clone, clip + words, split at 200 | 6,084 | — | 7,300 |
| VoxCPM2, split at 200 | — | 4,624 | 5,230 |
| Kokoro, split at 120 | — | 1,248 | 1,235 |

### 3.4 What it shows

1. Peak memory grows with line length on every engine. Chatterbox and Turbo stay lowest because
   audio.cpp already splits them at 128 characters internally.
2. Splitting costs no speed (VoiceDesign xlong: 27.1 s whole, 23.9 s split at 200).
3. For a clone made from a clip and its words, the clip dominates: it is in the prompt and decoded
   again with every line (and every piece), so splitting does nothing. Sound-only removes it.
4. Unloading frees the memory. A process never went above ~105 MB after an unload.
5. Memory held after a line follows that line's length until the next line resizes it (VoiceDesign
   held 6,249 MB after the xlong line, 2,843 MB after the next short one). VoxCPM2 releases to
   2,939 MB after every line.
6. Near 7.6–7.7 GB the card was full (8,192 MB with ~450 MB held by Windows); Windows may spill to
   shared memory there instead of failing — not measured.

### 3.5 Cause, read from the audio.cpp source  [agent, code; sizes inferred]

- **Codec decoder (the audio decoder).** Sized by the line's frames, up to 325 (300 + 25 of left
  context, `src/models/qwen3_tts/tokenizer_speech_decoder.cpp:47-48`, loop 1199-1257). On CUDA its
  convolutions build an "im2col" copy in the weight's type, 32-bit (`external/ggml/src/ggml.c:4880`,
  `include/engine/models/qwen3_tts/session.h:74`); the last stage with a 7-tap kernel is about
  5.2 MB per frame. When the length changes, the new graph is built **before** the old is freed
  (`tokenizer_speech_decoder.cpp:1229-1237`) — two buffers for a moment. `qwen3_asr` avoids exactly
  this (`src/models/qwen3_asr/thinker.cpp` ~788-792).
- **Talker prefill.** Built for the exact prompt length with `ggml_backend_alloc_ctx_tensors`
  (`talker.cpp:963`), which gives every intermediate tensor of all 28 layers its own memory, no
  reuse (`external/ggml/src/ggml-alloc.c:1180-1196`). Rebuilt for nearly every line; kept between
  requests. A clone's prompt includes the reference frames (`talker.cpp:582-621`).
- **Clones decode the reference together with the new audio**, then trim it
  (`session.cpp:494-498`, `tokenizer_speech_decoder.cpp:1267-1301`).
- **KV cache** is 32-bit, starts at 128 frames and doubles up to the request's `max_tokens`
  (`talker.cpp:57, 1741-1750`); never shrinks unless `mem_saver`. Nothing is pre-sized for
  `max_new_tokens` (8192 in the model's `generation_config.json`).
- **Two CUDA backends per Qwen3 session** (talker's own at `talker.cpp:836`, the session's), each
  with a pool that only grows until the backend is freed (`ggml-cuda.cu:484-590`).
- **Upstream sees the same**: `docs/reports/gguf_q8_performance.md` reports 6,397 MiB peak for
  Qwen3 8-bit in a long session and 8,138 MiB long-form.
- **Other families**: Chatterbox T3 uses the same no-reuse allocation (`t3_runtime.h:824, 1145`)
  but `max_new_tokens` 384 and 128-character pieces; its `mem_saver` is broader than Qwen3's.
  VoxCPM2 builds its step graphs up front with a 32-bit KV for `max_length` 8192
  (`generator.cpp:1212-1218`). `qwen3_asr` allocates per request and drops old graphs first.

### 3.6 Ways to cut the peak

**No C++ change** (request or config):

| Lever | Where | Measured / expected |
|---|---|---|
| Split long lines — per model, in our host (it crossfades) or `options.text_chunk_size` (the runtime hard-joins) | `render_core.py:747-770`; `chunking.cpp:579-590` | VoiceDesign xlong 7,122 → 3,976 (200) → 3,100 (120) **[me]** |
| Short reference clips (5–8 s) or sound-only for Qwen3 Base | `slot.py:520-533` | sound-only short line 5,407 → 2,219 **[me]** |
| `qwen3_tts.mem_saver` session option | `session.cpp:120-125` | drops the KV between lines; not tested |
| `qwen3_tts.perf_mode=flash_attention` (8-bit only) | `session.cpp:127-138` | −10–25 % of prefill **[inferred]**; not tested |
| `qwen3_tts.conv_weight_type=f16` | `session.cpp:277-280` | halves the im2col **[inferred]**; needs a listening check |
| Per-request `max_tokens` | `session.cpp:34-39` | bounds a runaway line |

**In our fork**:

| Change | Where | Expected |
|---|---|---|
| Free the old decoder graph before building the new one | `tokenizer_speech_decoder.cpp:1225-1238` | removes the transient duplicate, up to ~2.4 GB off the peak; trivial |
| Prefill through `ggml_gallocr` (or free it after each prefill) | `talker.cpp:919-975, 1867-1883` | most of 0.8–2.7 GB; the same change saved 5 GiB on another model (`docs/reports/higgs_cuda_prefill_memory.md`) |
| Decoder chunk size as a session option | `tokenizer_speech_decoder.cpp:47` | decoder memory ∝ chunk |
| Don't decode the reference with every line (cache it) | `session.cpp:494-498` | removes the clone penalty |
| Avoid im2col on CUDA (per-tap path, or `ggml_conv_2d_direct`) | `conv_modules.cpp:196-259, 545-558` | ~1.5 GB off the decoder |
| `mem_saver` also releases the decoder and prefill graphs | `session.cpp:193-223` | resident between lines ~2.5 GB |
| Log each graph's buffer size | — | measurement |

### 3.7 Earlier evidence that agrees

- Switch record §8 A: Qwen3 CustomVoice "VRAM peak 7.8 GB, ends 4.0 GB … swings 3–5 GB line to
  line"; R10 moved Qwen3 1.7B to the 12 GB tier on that number instead of asking why.
- The measurement store (`model_measurements`, this machine): `tts:qwen3:qwen3-cv-1.7b-q8` 15
  loads, 105–5,434 MB, median 3,115; `qwen3-cv-0.6b-q8` 12 loads, 105–6,249 MB;
  `kokoro-82m-q8` 567 → 2,635 MB within 20 seconds of speaking. The highs are real peaks of long
  lines; the 105 MB lows are a process with nothing loaded yet (§5 B3).

### 3.8 Limits of the measurement

One card, CUDA only (no Vulkan, CPU, Metal). 100 ms sampling can miss a very short spike (the
transient double buffer). Speech recognition, Pocket and Kitten were not measured. The three
session options were not tested — they need a runtime config change. Nobody listened to the split
joins.

## 4. Corrections to what was said earlier in the session

- **"VoiceDesign is 24 MB short of fitting"** — the arithmetic was right (6,249 + 1,024 margin
  against 7,249 free); the premise was wrong: 6,249 MB was not VoiceDesign's reading (§5 B1).
- **"It refuses before downloading, so nothing was downloaded"** — false. The download runs before
  the memory check (`manager.py:1437-1439`, check at 1459-1465); the 2.7 GB VoiceDesign file was
  fetched on the first attempt. Each refused attempt had also already unloaded the AI model
  (log 12:37:29: "evict LRU gemma … — loading qwen3", refusal 0.9 s later).
- **"Run it on the CPU"** — not needed.
- **The auditor's own first answer** — "the 6,249 MB reading is unreliable; price by the median
  (~3.1 GB)" — withdrawn. The reading was a real peak of a long line; pricing by the median would
  admit Qwen3 beside something else and run out mid-line.

## 5. Findings

### A — blocks other machines

**A1. Kokoro and Kitten never use the eSpeak NG the app downloads. [me + agent]**
`slot.py:124-128` passes `espeak_library_path` / `espeak_data_path` as session options with no
family prefix. Kitten reads only `kitten_tts.espeak_library_path` (`kitten_tts/session.cpp:73-75`);
Kokoro reads no session option at all, only the environment variables `AUDIOCPP_ESPEAK_LIBRARY` /
`AUDIOCPP_ESPEAK_DATA` (`kokoro_tts/g2p_multilingual.cpp:92-103`), which `runtime._child_env` never
sets. Unprefixed keys are ignored, not rejected (`spec_backed_model.h:53`). On this machine both
runtime processes loaded `C:\Program Files\eSpeak NG\libespeak-ng.dll` — a system install (checked
by listing the processes' modules). On a machine without it the loader falls to
`"espeak-ng.dll","libespeak-ng.dll"` by name (`espeak_phonemizer.cpp:78-93`) and nothing ships
beside the exe. `server/tests/test_audiocpp_switch.py:140-143` asserts the unprefixed key.

**A2. Linux x86_64 cannot finish installing the runtime. [agent+data]**
`espeak.py:42` picks the tag `manylinux_2_17_x86_64` and `:67` looks for a file ending
`-{tag}.whl`; PyPI's file is `…-manylinux_2_17_x86_64.manylinux2014_x86_64.whl`. The binary
installs first (`manager.py:378`), then eSpeak raises (`:385-387`).

### B — memory and placement

**B1. The memory check prices a model by another model's worst reading. [me]**
`manager.py:901-927` takes the maximum of every "load" row of every variant of the engine. Qwen3
VoiceDesign (never measured) was priced at 6,249 MB, a reading taken on CustomVoice 0.6B. Every
Qwen3 load on this machine is priced at 6,249 + 1,024, so it passes only when under ~920 MB of the
card is in use. Auto placement uses a different lookup, the newest row of the exact variant
(`:640-653`) — 105 MB for three Qwen3 variants. The two disagree, so Auto unloads the AI model
("never measured") and the check then refuses.

**B2. A refusal does not leave the world as it was. [me]**
Order in `load`: placement → download the variant (`:1437-1439`) → unload the AI model
(`:1456-1458`) → memory check (`:1459-1465`). `_unload_ai_model` also returns without waiting for
the memory to drain, so the check can read "only 4,101 MB free" a moment later (the turbo-tag-check
"first Turbo load refused" finding). **[agent]**

**B3. Three families never load on Load. [agent; me for the 105 MB rows]**
The config is `lazy_load` (`runtime.py:320`); `_warm` (`slot.py:277-306`) has no branch for
Chatterbox Multilingual, Qwen3 Base or VoiceDesign, so Load books and records only the bare
process — the 105 MB rows. VoiceDesign needs no clip, so it could warm. The gap-9 fix did this for
VoxCPM2 only.

**B4. Load reports success when the warm-up failed. [agent]**
`slot.py:272-273` sets loaded before `_warm`; `:305-306` swallows any `AudioCppError` at info
level. Out of memory or a bad file becomes a successful Load; the failure shows on the first line.

**B5. Switching size within a loaded engine skips the memory check. [agent]**
`manager.py:1459-1460` skips admission when the same engine holds the slot; since the gap-9 fix a
variant switch is a full new load (`:1488-1502`). CustomVoice 0.6B → 1.7B beside the AI model loads
into a full card.

**B6. 16-bit rows can throw the AI model off the card. [agent]**
`release.py:107` drops `cpu_realtime` from every 16-bit row, so Kokoro, Pocket and speech
recognition at 16-bit have no CPU speed and `placement_for` returns "the AI model makes room"
(`manager.py:716-719`) — a 212 MB Kokoro load unloads a 6.8 GB model.

**B7. One slow CPU reading locks a model off the CPU for good. [agent]**
A speed is recorded only while the model runs on the CPU (`manager.py:746`), newest wins
(`:631-634`); under 2× it is never placed there again, so never re-measured. Speech recognition
measured 2.06× live.

**B8. Each kind's "share" of the shared process is arithmetic, not measurement. [me]**
`_own_share_mb` (`manager.py:877-899`) is the process total less the other kind's *booking* — a
high-water mark that may be stale. Rows recorded this way range 105–6,249 MB for one model, and are
stored as "measured" evidence (`:1583`, `:1115`). The switch record's R7 put the cost at "~300 MB
on whichever loaded first".

**B9. On Macs and integrated graphics the placement reason is wrong. [agent]**
`_ai_model_on_card` is False whenever memory isn't discrete (`manager.py:663-664`): always "nothing
else is on the graphics card", never the CPU.

### C — the runtime's life

**C1. After a restart, the other kind's model is gone but stays booked. [agent; mechanism read by me]**
`ensure()` restarts with no callback (`runtime.py:325-327`). The slot is dead by pid
(`slot.py:227`) but `_loaded[kind]` is never popped — `loaded_for` only hides it
(`manager.py:540-543`) — and bookings are released only at `:1348, 1500, 1550, 1609, 1657`. The
reload then counts its own stale booking and excludes it from eviction
(`make_room(exclude="stt:asr")`, `:992`). This is the "speech recognition stays booked" finding;
`status()` shows no Unload for a dead slot, so only an app restart clears it.

**C2. Any change to what is downloaded restarts the shared process. [agent; me for the config]**
The signature holds every installed model (`runtime.py:318-323`, `slot.py:137-147`). The first load
of any new model downloads it and restarts the process, killing the other kind's model and any line
in flight (`stop()` ignores the other kind's activity lock). Seen live: the config lacked
VoiceDesign until the next load restarted the process.

**C3. Load, Unload, Cancel and Uninstall run on the event loop. [me for Load; agent for the rest]**
`engines_models_api.py:66-79` `async def load_engine` calls `mgr.load(...)` directly — the
download, the spawn and the warm-up. Progress polls, Cancel and `/v1/shutdown` queue behind it.
Cancel is processed after the load returns and then leaves the booking with no slot
(`manager.py:1277-1285` never releases it).

**C4. Shutdown can deadlock against a load. [agent]**
`load` holds `self._lock` across `spawn` → `installed_entries()` → `get_manager()` →
`_manager_lock` (`slot.py:140`, `manager.py:1819`); `shutdown_manager` holds `_manager_lock` and
needs `self._lock` (`:1831-1834`).

**C5. A crash mid-line surfaces a raw error and cleans nothing. [agent]**
`slot.post` catches only `AudioCppError` (`slot.py:258`); httpx transport errors pass through.
No watchdog; the booking stays (C1); no crash-loop guard.

**C6. Off Windows the runtime can outlive the app. [agent]**
The Job Object is Windows-only (kit `process.py:855-856`). Clean shutdown waits for a line (up to
900 s) and the unloads; Tauri kills the server after 15 s (`lib.rs:58-59, 242-256`); the sweep runs
only at the next start.

**C7. Locks are held across long calls; two paths terminate without the activity lock. [agent]**
`manager.py:1477-1519` (terminate 120 s + spawn 60 s under both locks); `uninstall` (`:1338-1343`)
and `request_cancel_load` (`:1274-1285`) can unload under a line in flight.

**C8. Smaller. [agent]** `_wait_healthy` timing out leaves a live process recorded as running
(`runtime.py:325-326`); `srv._run` is read without the lock; `_raise_for` raises AttributeError on
an `{"error": "text"}` body (`:416-419`); two servers on one data dir share the config and log
file names (`:329-333`).

### D — requests and options that are silently wrong

**D1. An empty seed is not random on four families. [me for Kokoro; agent for the rest]**
Kokoro, live: no seed twice gave identical audio; a seeded line then an unseeded one repeated the
seeded audio; seed 0 is a literal seed. The session picks one seed and replaces it only when a
seed arrives (`kokoro_tts/session.cpp:112, 566-573`); `slot.py:284-285` warms with seed 1. Same
pattern in Kitten (`session.cpp:98, 225-232`); Turbo falls to a fixed seed when 0 or missing
(`t3_turbo_component.cpp:141`); VoxCPM2 defaults to 1234 (`voxcpm2/types.h:24`). The app says
"Empty = a new one each time" and "0 = random" (`capability_details.py:50-51`). Qwen3, Chatterbox
and Pocket are random per request.

**D2. Kitten's "does not repeat with a seed" is not what the code does. [agent]**
`kitten_tts/decoder.cpp:1029` re-seeds every decode. Worth re-measuring; Kitten may be able to
offer a seed.

**D3. Chatterbox's repetition penalty shows 2.0 and 1.2 is used. [me]**
`capability_details.py:173, 203` `default=2.0`; `chatterbox/tts.h:23` `1.2f`; Generate omits a knob
left at its shown default (`GenerateView.vue:473-483`).

**D4. Generate's temperature 0 breaks three families. [agent]**
Slider minimum 0 (`GenerateView.vue:938`). Qwen3 throws "temperature must be positive"
(`qwen3_tts/session.cpp:67-68`); Chatterbox divides by it (`t3_component.cpp:621-623`); Turbo
treats 0 as 1.0 (`t3_turbo_component.cpp:243`). The slider's default 0.7 is never sent, so the
engine's own (0.9 / 0.8) is used while the screen says 0.7.

**D5. audio.cpp re-splits our pieces with hard joins. [agent]**
Internal budgets: Chatterbox and Turbo 128 characters, Kokoro 240, Kitten 400, VoxCPM2 2,048,
Qwen3 8,192; pieces are concatenated with no crossfade (`framework/runtime/session.cpp:195-206`).
Our host sends up to 800 with a crossfade that then never applies inside. A multi-word Turbo tag
(`[clear throat]`) or a Kokoro inline `[two words](/…/)` can be cut at a boundary.

**D6. Qwen3 tags a missing or unsupported language as English, not Auto. [agent]**
`slot.py:506`; audio.cpp defaults empty to "Auto" (`session.cpp:569`), which also picks a
CustomVoice speaker's dialect (`talker.cpp:445-446`).

**D7. Recognition and alignment languages. [agent]** `slot.py:359-361` sends raw codes for the 20
recognition languages outside `QWEN_LANGUAGE` (the prompt wants names); `:377-379` sends "English"
to the aligner for anything else, so Cantonese is aligned as spaced words.

**D8. Errors lose their kind. [agent]** audio.cpp answers 400 / 503 `insufficient_memory` / 503
`server_busy` / 500 (`runtime.cpp:1271-1292`); `runtime.py:417-420` keeps only the message and
`slot.py:258-259` makes every one a 500. The runtime's own memory guard is off
(`min_free_memory_mb=0`); a CUDA allocation failure mid-line aborts the process.

**D9. Dead or wrong smaller mappings. [agent]** Kokoro `options.phonemes` can never reach the model
(`slot.py:499-500`; the server stringifies arrays) — dead today. Qwen3 `top_p` 0 means "off"
(`talker.cpp:1243`) while the slider allows it. `AudioCppSlot.post` ignores its `timeout`
(`slot.py:244`); transcription is fixed at 600 s (`runtime.py:427`), so a recording over ~20
minutes on the CPU times out.

### E — gates, releases, installs

**E1. Three features are never checked against the installed build. [agent]**
`has_feature` is called only for `voice_pack`, `turbo_clone` (`slot.py:318, 325`) and `inline_ipa`
(`render_core.py:343`). `japanese`, `chatterbox_he_ru_zh` and `voxcpm2_transcript` are offered from
the pin alone. Today a v0.9.0 install is offered "clip and its transcript" for VoxCPM2 and ignores
the transcript silently.

**E2. The placeholder tags do not hold the code they name. [me, git]**
`fc55e1e6` (he/ru/zh), `6a2bb4c5` (Japanese), `6d1825eb` (libmecab/jieba staging) and `faf1ee03`
(macOS fix) are not ancestors of `v0.9.0-jv.3`; `3865d245` (Turbo cloning) is. Known — one release
with a new tag is pending — but `release.py:33-41` must be retargeted with it, and `PREVIOUS_TAGS`
(`:28`) extended by hand or every install reads "not installed".

**E3. The persona page's Blend maker is not gated. [agent; a regression from 2026-10-04]**
The old Voices tab was blocked when no model could blend; `PersonaBlendMaker.vue` checks nothing
and `voice_model.can("kokoro","blend")` is always true (`voice_model.py:198`). On a build pinned to
jv.1 a blend saves and then every preview and render gets 409 "need the speech runtime update"
(`slot.py:318-320`) while no update is offered (`speech_runtime_api.py:111`).

**E4. Turbo voices made under `npm run dev` change model in a packaged app. [agent]**
There Turbo is not one of Chatterbox's families, so `model_for_stored` falls back to Multilingual
(`voice_model.py:248-253`); tags are stripped with no message.

**E5. The "install the runtime first" dialog can never show. [agent]**
`voice_preview_api.py:714, 746` test `m.isolation == "venv"`; it is always "audiocpp"
(`manager.py:185`).

**E6. The runtime download has no checksum and cannot resume. [agent]**
`release.py:66-71` rows are URLs on a mutable tag; kit `binary.py:554-556` only launch-verifies;
staging is wiped at the start and end (`:533-534, 576-579`). Install never passes `force`, so a
build with a quarantined DLL cannot be repaired from the app. Model files are checked by size only
(`speech_cache.py:61-76, 167-173`) and two fetches of one variant race.

**E7. Smaller. [agent]** CPU builds are not the portable ones (`release.py:88, 90`; audio.cpp issue
#352, old CPUs). The dev build silently stays CPU-only when the CUDA toolkit was missing at its
first configure (`audiocpp-dev.js:116-120, 172`). Auto looks for exactly one build
(`runtime.py:174-181`), no fallback. The memory ledger ignores the configured GPU index. A loaded
model can be deleted on Linux/macOS (`models_api.py:145-166`).

### F — leaks, hardcoded values, leftovers, stale docs

- **Temp files**: every clone preview leaves its clip in the temp folder
  (`voice_preview_api.py:287-294`; the persona page's new preview uses the same function); an
  oversize capture upload leaks up to 200 MB (`captures_api.py:150-157`); blend packs pile up
  (`slot.py:96-101`); the runtime logs are never rotated (`runtime.py:336`). **[agent]**
- **Hardcoded, arguably settings**: GPU process threads 4 (`runtime.py:315`) **[me]**; health wait
  60 s; request timeouts 900 / 600 / 600 / 120 s (`:422-448`); probe TTL 2 s (`manager.py:77`);
  eviction drain wait 4 s (`:999`); Voice engine setup's 7 GB / 11 GB tiers
  (`QuickSetup.vue:50-89`). `cpu_min_realtime` and, on a CPU build, `cpu_threads` have no screen
  (`SpeechEnginesTab.vue:792`). **[agent]**
- **Leftovers**: "install + load 'whisper'" errors (`manager.py:1735-1736, 1757-1758`); a dead
  `chat()` (`:1709-1722`); `NOT_ENGINES` names that don't exist (`:69-70`); torch / DirectML / MLX
  probes that make Settings show "directml" on AMD and Intel Windows (`system_info.py:85-111`,
  `SettingsView.vue:464`); "training" in a user-visible description (`asr/manifest.py:24-25`);
  `capabilities.js:84-88` and its test use the dead id `chatterbox-turbo-v1`. **[agent]**
- **Stale docs**: engines.md:66 says the CUDA build is a 461 MB download — the cudart archive adds
  607 MB **[agent+data]**; engines.md:22-23 (every engine repeats with a seed), :102 (every model
  8-bit), :258-271 (the Auto order), :348-350, :444-445, :496, :62/:502 (Linux); voices.md:18, :51,
  :52, :198-199; gpu.md:12 and quick-setup.md:90 (DirectML); `capability_details.py:212` and
  `QuickSetup.vue:70` ("19 languages"); `kokoro/manifest.py:24-27` ("49 … eight languages");
  code-map.md:740, :766-774. **[agent]**

## 6. Design — what should change

The shape (screens → our server → audio.cpp) is right: the server owns personas, lexicons,
splitting, the cache, effects and projects, and audio.cpp has no sign-in, so the screens should not
call it. What is weak is how the middle layer treats the runtime.

1. **Bound the work, then price it.** A split size per model (a setting with a per-model default),
   applied by our host so its crossfade is the only join — never larger than the runtime's own
   internal budget (D5). Then a model's peak is predictable, and a load is priced from that
   model's own measured load size and measured full-piece peak — never another model's (B1).
2. **Let the runtime report its own memory.** A small fork change: per-model memory in
   `/v1/models` (or a stats endpoint) and each graph's buffer size in the log. That replaces the
   share arithmetic (B8) and the 105 MB rows (B3).
3. **One options table whose truth is the runtime.** A fork endpoint that lists each model's
   request and session options with their defaults and ranges; the app's knobs and its request
   mapping are generated from it, and everything is exposed (advanced ones folded). Hand-copied
   options are how A1, D3 and D9 happened, and most families ignore an unknown name silently.
4. **A process that doesn't restart under you.** List every catalog model in the config up front
   (to check: audio.cpp must accept an entry whose file isn't there yet) so a download changes
   nothing; give restarts one owner that drops dead slots and their bookings (C1, C2); take the
   long calls off the event loop (C3).
5. **Say what happened.** Keep the runtime's error kind end to end (D8); a Load is a success only
   when the model is in memory (B3, B4); a refusal changes nothing (B2).

## 7. Options the runtime reads that the app doesn't expose  [agent]

| Engine | Not exposed | Where it is read |
|---|---|---|
| Qwen3 | `max_tokens`, `do_sample`, `subtalker_temperature / top_k / top_p / dosample`; session `mem_saver`, `perf_mode`, `conv_weight_type`, `voice_prompt_cache_slots` | `qwen3_tts/session.cpp:34-60, 120-160, 271-292` |
| Chatterbox | `min_p` (default 0.05 — the capability note says there is none), `max_tokens` (384); session `mem_saver` | `chatterbox/session.cpp:47-66`, `tts.cpp:209-255` |
| Pocket | `temperature` (0.7), `noise_clamp`, `eos_threshold`, `frames_after_eos`, `max_tokens` | `pocket_tts/session.cpp:139-175` |
| VoxCPM2 | `min_tokens`, `max_tokens`, `retry_badcase*`; session `mem_saver`, `audiovae_latent_capacity` | `voxcpm2/session.cpp:285-298` |
| Kokoro, Kitten | `text_chunk_mode`, `text_chunk_size` | request contract |
| Every model | `text_chunk_size` / `chunk_size` | `framework/text/chunking.cpp:579-590` |
| The server | `max_loaded_models` (we pass 0), `idle_unload_ms`, `min_free_memory_mb`, `busy_timeout_ms` (300 s default) | `app/server/config.h:86-105` |

The model's own defaults (Qwen3 `generation_config.json`): `do_sample` true, temperature 0.9,
top_k 50, top_p 1.0, repetition_penalty 1.05, the same four for the sub-talker, `max_new_tokens`
8192 (~11 minutes of audio at 12.5 frames a second). `config.json` is the model's structure (28
talker layers, 16 codebooks), not tuning.

## 8. The switch's decisions, checked  [agent]

Built as written and clean: the two processes (GPU + CPU) and their settings; per-model
Auto/GPU/CPU; Pocket's terms gate and one-model-per-language refusal; Kitten without a seed; the
fork, its tags and "the older build keeps working"; `npm run dev` on the checkout; the replaced
build's deletion; CustomVoice 0.6B; host-side speed; the 16-bit rows; the variant-switch reload;
VoxCPM2's warm-up and brackets; Turbo/Nano behind their gate and their 19 tags; inline IPA.

Built, with a problem: Auto's order (B2, B5, B6, B7, B9); "a model never measured counts as not
fitting" (B6); Voice engine setup reads static text, not the same numbers (`QuickSetup.vue:50-89`);
blends "so no one is offered a blend that cannot play" (E3); more languages (E1); R7's shares (B8);
R10's 12 GB tier for Qwen3 (§3 — the peak is line length).

## 9. Checked clean

Every endpoint and body shape the app sends exists and is parsed as sent; `seed` reaches every
family; Qwen3 `instructions` → `instruction`; all `KOKORO_LANGUAGE` codes; `voice_pack`; the inline
IPA markup; all 23 Chatterbox languages on the `jv` branch; unload frees a model's backend (and
measured: back to ~105 MB). Loopback-only; ephemeral port; Windows Job Object; atomic,
launch-verified install; eSpeak and UniDic pinned by SHA; model files pinned to a commit, resumable,
`files.json` written last; the leftovers sweep cannot kill another JustVoice's runtime; a frozen app
ignores the dev-build variable; every release asset name exists in the published jv.1.

## 10. Not verified, not tested

- A1 on a machine without eSpeak NG installed (the failure itself); A2 on Linux.
- C4's deadlock and D4's Chatterbox output (code only).
- `mem_saver`, flash attention and 16-bit decoder weights on Qwen3 (need a config change).
- Whether audio.cpp accepts a config entry whose file is missing (§6 item 4).
- How the splits sound, and whether VoiceDesign's voice holds across pieces.
- Vulkan, CPU and Metal builds; speech recognition, Pocket and Kitten memory.

## 11. Proposed fix order (each needs its own go, with its blast-radius table)

1. Per-model split size + the memory-check rewrite (§6 item 1; B1, B2, B5) — makes Qwen3 usable
   on an 8 GB card.
2. The eSpeak option name (A1), and the Linux wheel name (A2).
3. Stale bookings and restarts (C1, C2), Load off the event loop (C3).
4. Load means loaded (B3, B4); seeds (D1); the repetition-penalty default and temperature 0
   (D3, D4); the Blend gate (E3).
5. The fork: free the old decoder graph first, prefill reuse, memory reporting, the options
   endpoint (§3.6, §6 items 2–3) — with the pending release.
6. The rest of §5, group F included.

## 12. What the tests did to the app

Restarted the GPU runtime once (a Chatterbox load, then an unload); unloaded Kokoro and loaded it
again at the end. No setting, repo file or measurement row was changed. The harness is a scratch
script (`memtest.py`), not in the repo.

## 13. The fixes — decided, and built step by step

**Decided 2026-10-04** after a second review (Opus) of this audit: the user said "your rec for
the audit fixes" and "go". The approved text — the design changes and the five-step order — is
in TASKS, "audio.cpp switch audit", verbatim. §11 above was this audit's proposal; the decided
order replaces it:

1. eSpeak first. 2. The runtime's life — dynamic registration (`POST /v1/models/load`), one
process per kind, Load off the server's main loop. 3. Bound the work, then price it honestly —
per-model split size, the calibrated peak, refusal before any change. 4. Fork memory fixes —
free the old decoder buffer first, trim the clip's context, the prefill memory. 5. Everything
else in §5.

The second review's corrections to this record live as facts in `docs/dev/RESEARCH.md` §1–2:
the 7.6 GB readings are the card's ceiling (floors, not peaks) and depend on the line before;
audio.cpp's own splitter cuts at a sentence end first, then a clause, then a space; audio.cpp
can register a model with no restart; a kept Qwen3 design renders as a clone and decodes its
whole clip with every line; an empty runtime process holds ~105 MB, not ~300.

### 13.1 Step 1 — eSpeak NG reaches both phonemizers (A1), and Linux finds its wheel (A2)

**What changed.** `runtime._child_env` sets `AUDIOCPP_ESPEAK_LIBRARY` / `AUDIOCPP_ESPEAK_DATA`
for every runtime process (Kokoro reads only these) and drops inherited values; the three
`AUDIOCPP_*` variables are now part of a process's signature, so installing or removing eSpeak
NG or the Japanese dictionary starts it again with them. `slot._entries_for` gives KittenTTS its
prefixed options (`kitten_tts.espeak_library_path` / `…_data_path`) and Kokoro none — Kokoro
refuses a session option it doesn't know. `espeak.wheel_matches` matches any one platform tag
of a wheel's name.

**Blast radius** (greps run 2026-10-04, before the change):

```
$ grep -rn "espeak_library_path\|espeak_data_path\|AUDIOCPP_ESPEAK" server src scripts docs (not plans)
server/justvoice/engines/audiocpp/espeak.py:6     docstring — rewritten
server/justvoice/engines/audiocpp/slot.py:127-128 the unprefixed options — replaced
server/tests/test_audiocpp_switch.py:140,143      a config-row test using the dead key — moved to Kitten's real key
docs/dev/RESEARCH.md:133-135                      the fact — rewritten with "(was: …)"
$ grep -rn "ESPEAK_FAMILIES\|espeak\.paths\|espeak\.install\|_wheel_tag\|_child_env" server
espeak.py:36,64 (_wheel_tag) · runtime.py:56,173,339 · slot.py:124-125,150 · manager.py:356,385
tests/test_japanese_dictionary.py:79,82 (_child_env, AUDIOCPP_UNIDIC_DIR)
```

| What changed | Callers / producers | Effect |
|---|---|---|
| `_child_env` gains two variables | `runtime.py:339` (the one spawn); `test_japanese_dictionary.py:79,82` | the dictionary test still passes — it checks only its own key |
| the signature gains `env` | `AudioCppServer.ensure` only | one restart of each process on the first start after this change; afterwards only when eSpeak NG or the dictionary is installed or removed (manager.py:414-425 already stopped the runtime for the dictionary) |
| `ESPEAK_FAMILIES` → `ESPEAK_SESSION_FAMILIES` | `slot.py:124` only (no other reader) | Kokoro's config rows lose two options it never read |
| `install` matches with `wheel_matches` | `manager.py:356,385` (install, update) | every platform's file now matches exactly its own tag (test over PyPI's 6 names) |

**Checked.** Tests: `test_kokoro_finds_our_espeak_through_the_runtimes_environment`,
`test_kitten_gets_its_own_prefixed_espeak_options_and_kokoro_gets_none`,
`test_every_platform_finds_its_espeak_wheel` (PyPI's six 0.2.4 file names, read 2026-10-04).
Live, on the restarted app (`npm run dev`): Kokoro loaded (CPU process) with
`engines\audiocpp\espeak-ng-0.2.4\espeak-ng.dll` among its modules — before, the system copy in
`C:\Program Files\eSpeak NG\` — and its line, "The harbour-master counted the lanterns twice,
then laughed.", read back word for word; KittenTTS (downloaded for this, 302 MB) loaded in the
GPU process with the same DLL and spoke the line (6.1 s). Not checked: a machine with no system
eSpeak NG at all; Linux.

**Seen while checking — C1 live.** Loading KittenTTS (a first download) restarted the GPU
process, which killed the resident speech recognition; its booking stayed, and the next
transcription was refused: "not enough memory to load asr … Resident: stt:asr (2861 MB),
tts:kitten (497 MB)". Step 2 removes the restart.

### 13.2 Step 2 — the runtime's life: register models live, one process per kind, Load off the loop

**The design.**

- **Register models live, in our fork, without the WebUI's powers.** audio.cpp registers and
  loads a model at run time through `POST /v1/models/load` — but only under `ui_management`,
  which also opens its installer, a settable models root, model-package deletion, uploads and
  directory browsing on the loopback port (no sign-in, no CORS headers: any local program, or a
  web page that finds the random port with a simple cross-site POST, could use them). The fork
  gains `model_management`: a config key that opens `/v1/models/load` and `/v1/models/unload`
  and nothing else (`app/server/config.h`, `config.cpp`, `runtime.cpp`; `/health` reports it;
  `tests/unittests/test_server_config.cpp` `test_model_management_alone`). A process started
  with it has an empty model list; a Load registers its model, the aligner registers on the
  first caption request (it loads lazily today too). Nothing downloaded or deleted changes a
  process's signature any more, so nothing restarts it. Gated as a build feature
  (`release.FEATURES["model_management"]`, first in the next release): `npm run dev` has it now;
  a build without it keeps today's model-list config.
- **One process per kind.** Speech and speech recognition each get their own process per
  placement (up to four: `audiocpp-server[-cpu][-stt]`). A process's measured memory is then
  its one model's, so `_own_share_mb` (R7's computed share) goes; a crash or restart in one
  kind never takes the other's model. Cost: ~105 MB of graphics memory for the second process
  when both kinds sit on the card (measured empty process, §3.2).
- **A dead slot is dropped with its booking.** `loaded_for` finds a slot whose process is gone
  (`AudioCppSlot.is_dead`: it had loaded, and its process is not the one running), drops it and
  releases its booking — the stale `stt:asr (2861 MB)` of §13.1 can't stand. Cancel releases the
  booking too, and a load cancelled while its model came in unloads it before booking anything.
- **Load off the event loop.** Every engine endpoint that never awaits and calls the manager (or
  deletes files) becomes a plain `def`, which FastAPI runs on its thread pool: load, cancel-load,
  unload, uninstall, install (engines_models_api); terms, list, capabilities, VRAM strip,
  current (engines_api); clear speech cache, delete model (models_api). Cancel and the progress
  polls now answer during a load.

**Blast radius** (greps run 2026-10-04, before the change):

```
$ grep -rn "get_server(" justvoice tests
speech_runtime_api.py:98-99 · slot.py:174,219 · manager.py:423 · tests/test_cpu_placement.py:403-407
$ grep -rn "ensure_server(" justvoice tests
slot.py:224,271 · tests/test_cpu_placement.py:421,434
$ grep -rn "shutdown_server(" justvoice tests      (system_api.py:40 is an unrelated endpoint name)
speech_runtime_api.py:191,195 · manager.py:411,1839
$ grep -rn "installed_entries(\|has_model(" justvoice tests
slot.py:176,179 (installed_entries) · slot.py:272 (has_model)
$ grep -rn "_own_share_mb" justvoice tests
manager.py:1088,1579 · tests/test_audiocpp_switch.py:238-243
$ grep -rn "\._run\b" justvoice (outside runtime.py)
speech_runtime_api.py:100 · slot.py:225-231,275
$ grep -rn "loaded_for(" justvoice
captures_api.py:55 · engines_api.py:354 · speech_runtime_api.py:185 · manager.py:408,546,1415,1455,1713,1732,1754
$ grep -rn "request_cancel_load" justvoice
engines_models_api.py:112
async def with no await that call the manager / delete files:
engines_models_api.py:42,67,100,129,157 · engines_api.py:131,161,208,316,402 · models_api.py:116,146
```

| What changed | Callers / producers | Effect |
|---|---|---|
| `get_server(placement, kind="tts")`, servers keyed by both | speech_runtime_api `_info` (98-100), slot `_srv`/`ensure_server`, manager 423, test_cpu_placement 403-407 | default kind keeps every tts caller; `_info` reports the speech process, else recognition's, and counts both |
| `ensure_server(placement, kind)`; managed config | slot `spawn`/`_load`; test_cpu_placement 421-434 | managed: empty model list, signature without models; else the kind's own models only |
| `shutdown_server(placement=None, kind=None)` | speech_runtime_api 191,195; manager 411,1839 | stops every kind of that placement, as before |
| `installed_entries(kind)` | slot `ensure_server` only | a kind's process lists only its models (the fallback path) |
| `has_model` → on-disk check in the slot | slot `_load` only | the "not downloaded" refusal reads the speech cache in both modes |
| `_own_share_mb` deleted | manager 1088,1579; its test | the whole process's measurement is the kind's own |
| `loaded_for` drops a dead slot + booking | the 11 call sites above | every caller already treats None as "not loaded"; a dead slot now also loses its booking and its card state |
| `request_cancel_load` releases the booking | engines_models_api 112 | no booking without a slot |
| ten handlers `async def` → `def` | FastAPI only | same answers, run on the thread pool |

**Checked.** C++: `server_config_test` passed in a CPU test build with the extended tests on
(`../audio.cpp/build/jv-tests`, including the new `test_model_management_alone`). Python:
`tests/test_runtime_life.py` (a managed process starts with no models and a download never
restarts it; an older build lists its kind's models; a Load registers its model and the aligner
registers on first use; a model not on disk is refused; a dead slot goes with its booking, a
loading one stays; Cancel frees the booking; the memory strip never shows a dead model's booking
— proven to fail without its fix; the twelve handlers are plain `def`), and the placement tests
updated for per-kind processes. Live, on the restarted app (`npm run dev`, the fork rebuilt):

- Kokoro and speech recognition loaded into `audiocpp-server-cpu` and `audiocpp-server-cpu-stt`,
  each started with `"model_management": true` and no listed models.
- A first download — `pocket-de-q8`, 246 MB — loaded with both processes keeping their ids
  (15648, 1704); recognition transcribed the Kitten line again without reloading. Before (§13.1,
  14:36) KittenTTS's first download restarted the GPU process (13372 → 25412) and killed
  recognition.
- A Cancel 3 s into a VoiceDesign load: the engine list answered in 8 ms and the Cancel in 3 ms
  during the load, the load ended "cancelled by user" after 5 s, nothing was booked, the card
  back to 574 MB.
- VoiceDesign loaded (booked `tts:qwen3`, 1,913 MB measured — its own process); killing that
  process dropped the slot ("the tts model qwen3 is no longer loaded — its runtime process
  stopped") and its booking. The memory strip still showed the booking for one poll — it read
  the bookings before the slots; fixed and tested.

**Seen while checking — B1/B2 live again.** The first VoiceDesign attempt, with Gemma resident
(7,345 MB on the card), unloaded Gemma and was then refused at 0.3 s: "needs ~6249 MB (+1024 MB
safety margin) but only 1300 MB free" — the engine-wide maximum, and the eviction not yet
drained. Step 3 fixes both. Gemma reloads itself the next time a feature asks for it.

**Not checked:** a packaged app on the pinned jv.1 (no `model_management` — it keeps the listed
config, now per kind); Linux and macOS; two loads of the two kinds at the same moment.

### 13.3 Step 3 — bound the work, then price it honestly

**Decided** 2026-10-04: "your rec on all go no need for go on each step complete all fixes",
with the three recs as shown (TASKS, verbatim): step 3 as designed; split sizes Qwen3 CustomVoice
and Base 200, VoxCPM2 200, Kokoro 240, the rest unchanged; description voices wait for a
listening test.

**The design.**

- **A split size per model.** A variant row may carry `split_chars` (a catalog fact: the piece
  length that bounds its working memory); the user overrides it per model in
  `engines.engine_overrides[id].split_chars[variant]` (PATCH /v1/settings). A line goes to the
  model in pieces of at most `min(generation.max_chunk_chars, split)` — the host's
  sentence-first splitter and its crossfade, so for Qwen3, VoxCPM2 and Kokoro audio.cpp's own
  hard-joined splitting never runs (pieces stay under its budgets). Defaults: every Qwen3
  CustomVoice and Base row 200, VoxCPM2 200, Kokoro 240; VoiceDesign, Chatterbox, Turbo, Nano,
  Pocket, Kitten none. `render_core.line_split_chars` is the one helper (chapter render and
  Generate).
- **A description voice** (designed, no clip — `voice_design_instruct`) keeps
  `max_chunk_chars` until its own split is decided by ear, and when no seed is set gets a fixed
  one derived from its id (`description_seed`), the same for every piece — its voice is drawn
  from the description on every request, so a random seed per piece or per line drew a
  different voice. Generate gave every piece `seed + i`; a description voice now keeps one.
- **One price, the exact model's own.** `_price_mb(kind, engine, variant, device)` = the largest
  `"peak"` reading of exactly this variant on this machine and device at its current split
  (the kit's measurement store, flag `split_chars`; keep 5 per fingerprint). Placement ("fits
  beside the AI model") and the memory check both ask it. `_prior_measured_mb` (the engine-wide
  maximum, B1) and `_prior_gpu_mb` go. The old `"load"` rows (shared-process shares) are never
  read again.
- **The calibrated peak.** A load with no price for the card warms up with a full-length piece
  (`slot.CALIBRATION_TEXT` cut at a sentence end to `min(split, the family's own budget)`;
  speech recognition gets 30 s of silence) and the measured process memory after it is recorded
  as the price. A family that needs a clip to speak (Chatterbox Multilingual, Qwen3 Base) can't
  calibrate at load; its first real lines record peaks (the high-water bump), and those price it
  from then on. A known price books early and stays the floor of the booking; a higher reading
  after any line raises it and is recorded.
- **Refuse before changing anything.** Order in `load`: placement → the memory check (priced
  loads; it credits what the same-kind occupant gives back when it is replaced, so loading a
  speech model never evicts the AI model in place of the speech model it replaces, and a
  variant switch is checked too, B5) → download the files → unload the AI model (Auto's third
  step, unpriced loads only) and wait for its memory to drain → start and load. A refusal
  leaves no download and no eviction behind (B2).

**Blast radius** (greps run 2026-10-04, before the change):

```
$ grep -rn "_prior_measured_mb" justvoice tests
manager.py:896,1461 · tests/test_engine_local_load.py:66 · tests/test_engine_vram_wiring.py:115,211,242,389,403,420,435,458,614,689,691
$ grep -rn "_prior_gpu_mb" justvoice tests
manager.py:659,731 · tests/test_cpu_placement.py:108,129
$ grep -rn "_record_speech_load" justvoice tests
manager.py:1038,1111,1598 · tests/test_engine_local_load.py:68 · tests/test_engine_vram_wiring.py:117,183,260,318
$ grep -rn "placement_for(" justvoice tests
api/models_api.py:48,107 · manager.py:1420 · tests/test_cpu_placement.py:85-150
$ grep -rn "_admit_memory(\|_unload_ai_model(\|_ensure_variant_local(" justvoice tests
manager.py:924,1463 · manager.py:740,1458 · tests/test_cpu_placement.py:248 · manager.py:1208,1438 · tests/test_engine_local_load.py:103,105,135
$ grep -rn "max_chunk_chars\|split_text_into_chunks(" justvoice
api/generate_api.py:77-80,264,327,337,393,432,449 · render_core.py:776-780 · models.py:113 · api/voice_preview_api.py:894 (audition pieces — unchanged)
$ grep -rn "class EngineOverrides\|\.placements" justvoice
models.py:238 · api/models_api.py:85,102,104 · manager.py:616,632
$ grep -rn "_warm" justvoice tests
slot.py:307,311 · tests/test_turbo_cloning.py:95
```

| What changed | Callers / producers | Effect |
|---|---|---|
| `_price_mb` replaces `_prior_measured_mb` and `_prior_gpu_mb` | manager `load`, `placement_for`; models_api 48,107 (through `placement_for`); the tests above | an exact-variant, per-device, per-split price; tests' fakes renamed |
| `_record_speech_load` writes `"peak"` rows with the split flag | manager `load` and the high-water bump | the price's only producer; old `"load"` rows stay unread |
| `load` reordered, admission credits the same-kind occupant, variant switches checked | every load caller (manager §7 table of the switch record) | a refused load downloads and evicts nothing |
| `line_split_chars`, `description_seed` | render_core `render_line`, generate_api `_synth_managed` | Qwen3/VoxCPM2/Kokoro lines go in shorter pieces; description voices keep one seed |
| `EngineOverrides.split_chars` | settings only (PATCH /v1/settings) | a new optional field; no reset needed |
| slot `_warm(calibrate)`; `/load` answers `calibrated` | slot `_load`; test_turbo_cloning 95 | a first load on the card takes one full-length line longer |

**Checked.** Tests: the price (`test_the_price_is_this_models_own_peak_at_its_piece_length`),
the load order (a refused load downloads and unloads nothing; an unpriced load fetches first
and unloads the AI model after; a variant switch is checked against what it adds; a known
price is the booking's floor and a higher reading is recorded; the occupant credit; the drain
wait), calibration (a full-length warm-up per family, capped at audio.cpp's own budget;
VoiceDesign warms from words; clip-only families can't; recognition gets 30 s; a failed warm-up
fails the load), the split size (the user's, then the catalog's, under the cap) and the render
(pieces of the model's length; a description voice keeps one seed and the full length, and
the cache probe agrees). Server suite 1052 passed, ruff clean. Live, Gemma 4 26B on the card:

- Qwen3 CustomVoice 1.7B, never measured: Auto unloaded Gemma, the load calibrated at 200
  characters and recorded 4,057 MB (CUDA) in 17 s.
- A 752-character line with Ryan: 56.3 s of audio in 28.7 s; the card peaked at 6,152 MB, about
  5.1 GB above idle — above the 4,057 MB price: the transient second decoder buffer the
  post-line reading cannot see. Step 4 frees the old buffer first.
- Unloaded and loaded again: priced, no calibration, 8 s, booked at its price.
- Gemma loaded again, then CustomVoice: placement "no usable speed on the CPU, so the AI model
  makes room"; the memory check evicted Gemma itself and the load took 10.6 s, booked 4,057 MB.

### 13.4 Step 4 — the fork's memory fixes

**What changed** (our audio.cpp, branch `jv`):

- `8cdf1219` — the Qwen3 speech decoder frees its old graph before it builds the replacement
  (`tokenizer_speech_decoder.cpp`; qwen3_asr's thinker already did); the talker's prefill
  allocates through `ggml_gallocr`, reusing intermediate storage after each tensor's last
  consumer, with the inputs, logits, last hidden state and every layer's K/V — and what they
  are views of — marked to survive (`talker.cpp`; the Higgs prefill change,
  `docs/reports/higgs_cuda_prefill_memory.md`).
- `8523b720` — a clone decodes only its reference's last 25 frames (`kLeftContextCodes`) with
  the new audio, not the whole clip — the left context the chunked decode already gives every
  chunk after the first.
- JustVoice: a price belongs to the runtime build that measured it (flag `runtime` on
  `"peak"` rows, `manager._runtime_build`), so a new build recalibrates — a price only rises
  within a build, and these fixes made every old Qwen3 price gigabytes too high.

**Blast radius.** C++: `Qwen3SpeechTokenizerDecoderRuntime::decode` / `decode_and_trim_reference`
(callers: the Qwen3 session's decode step only) and `TalkerPrefillGraph` (built in the talker's
prefill only) — no API, no option, no other family touched. JustVoice:
`_price_mb` / `_record_speech_load` (the callers in §13.3's table); the test of the price.

**Checked** — RTX 2070 SUPER 8 GB, CUDA 12.4, Q8_0 1.7B models, seed 42, the same request
sequence before and after each build (`scratchpad ab_qwen3.py`; the sequence itself is
reproducible run to run, hash for hash):

| Render (peak above the loaded model) | before | 8cdf1219 | 8523b720 | audio |
|---|---|---|---|---|
| CustomVoice, 1st / 2nd | 3,208 / 4,358 MB | 2,525 / 2,525 | 2,538 / 2,538 | byte-identical throughout |
| VoiceDesign, 1st / 2nd | 3,286 / 4,886 MB | 2,486 / 2,562 | 2,471 / 2,548 | byte-identical throughout |
| Base clone (15.5 s clip), 1st / 2nd | 4,364 / 4,868 MB | 2,661 / 2,661 | 1,670 / 1,670 | identical at 8cdf1219; the trim moves it 2.69 dB (log-spectral; two takes of one line: 19.13 dB), same length, read back word for word |

The same speed throughout (8.3–10.1 s per line). CustomVoice's 752-character line in 200-character
pieces, the host's way: 3,433 MB above idle (step 3, before these fixes: ~5,100), 48.9 s of audio
in 23.9 s. Its session options, measured on that line:

| `qwen3_tts.*` | peak above idle | time | audio vs plain |
|---|---|---|---|
| (none) | 3,433 MB | 23.9 s | — |
| `mem_saver=true` | 3,443 MB | 22.5 s | identical (0.00 dB) |
| `perf_mode=flash_attention` | 3,239 MB | 21.7 s | a different take (20.16 dB) |
| `conv_weight_type=f16` | 2,941 MB | 22.4 s | 2.04 dB — close |

None becomes a default without the user's ear (`conv_weight_type=f16` is the candidate); they
become per-model options in step 5. **Listening files** (scratchpad `listening/`, README inside):
VoiceDesign and a VoxCPM2 description whole vs in 200-character pieces (step 3, rec 3), the clone
whole-clip vs trimmed decode, CustomVoice's decoder 32 vs 16-bit.

**Not checked:** Vulkan, CPU and Metal builds of these changes; the packaged app gets them only
with the next release (its tag still needs the user's word).
