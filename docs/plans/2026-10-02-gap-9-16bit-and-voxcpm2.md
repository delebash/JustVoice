# Gap 9 — 16-bit model rows, the 8-bit vs 16-bit test, and VoxCPM2

## 1. What this is

Gap 9 of the audio.cpp switch ([switch plan §5](2026-10-01-audiocpp-switch.md)): "16-bit model
rows; new engines from the catalogue (VoxCPM2 first)", plus fixes 3 and 4 of the 2026-10-02
list (TASKS, "all 4 , fork repo, public, your rec on all go"): Pocket's dropped words in
Portuguese and Spanish rerun at 16-bit, and the long-passage 8-bit vs 16-bit comparison. Go:
"you have a go for all gaps". This doc is the research and the plan as presented.

Three things for the user:
- **A choice of precision per model.** Every model keeps its 8-bit file as the default and gains
  a 16-bit row beside it — more download and memory, for whoever wants the original precision.
- **An answer to "is 8-bit worse?"** — measured on a real chapter, not two lines.
- **VoxCPM2** — a new engine that clones and designs voices in one model, 30 languages.

## 2. Facts (2026-10-02)

16-bit files at our pinned commit of `audio-cpp/audio.cpp-gguf` (`7bf52723…`), from the HF tree:

| Model | 8-bit (shipped) | 16-bit |
|---|---|---|
| Kokoro 82M | 189.5 MB | bf16 212.0 MB |
| KittenTTS Mini 0.8 | — (ships unquantized, 302.2 MB) | — |
| Pocket TTS, English (each language its own file) | 127.9 MB | bf16 219.1 MB |
| Qwen3 CustomVoice 1.7B | 2,817 MB | bf16 4,179 MB |
| Qwen3 Base 1.7B | 2,695 MB | bf16 4,203 MB |
| Qwen3 Base 0.6B | 1,991 MB | bf16 2,516 MB |
| Qwen3 VoiceDesign 1.7B | 2,817 MB | bf16 4,179 MB |
| Qwen3 CustomVoice 0.6B (ours) | 1,710 MB | bf16 2,157 MB — converted, not yet published |
| Chatterbox Multilingual | 2,088 MB | f16 3,744 MB |
| Qwen3-ASR 1.7B | 2,473 MB | f16 4,088 MB |
| **VoxCPM2** | 2,955 MB | bf16 4,772 MB |

audio.cpp's test table rates every one of our families' Q8 as passing; Pocket's Q8 "with drift"
where its 16-bit has none (see the reply recorded 2026-10-02 and `gguf.md`). Our own 0.6B
CustomVoice A/B: directed renders clean q8 12/13, bf16 13/13 (gap 4 plan §5).

**VoxCPM2** ([engine scan](2026-10-01-tts-engine-scan.md) line 367, re-checked): OpenBMB, 2B,
Apache-2.0, upstream repo not gated. audio.cpp `voxcpm2` spec v0.9.0: status `supported`, tasks
`tts` · `clone` · `design`, modes offline + streaming, 31 language entries (30 + Chinese
dialects), capabilities clone (`speaker_reference`) and design (`voice_design`). The scan: 48 kHz
output, "timbre drifts in long single passes" (upstream issue #302). audio.cpp has no VoxCPM2
doc page at v0.9.0, so its request options are found by trial runs in the build.

## 3. The plan

**A. 16-bit rows.** One more variant per model, `…-bf16` / `…-f16`, beside the 8-bit row, same
repo and commit, same capability row (the suffix walk already reaches it). The 8-bit stays the
default everywhere. Our 0.6B CustomVoice bf16 goes up to our Hugging Face repo as a second file.
KittenTTS has nothing to add.

**B. The comparison (fixes 3 and 4).** One real chapter from the real data dir (a few minutes
of narration), rendered per engine at 8-bit and 16-bit with the same seeds; each render read
back by Qwen3-ASR and scored for words wrong, silences longer than 1.5 s, and length against
the other precision. Pocket TTS Portuguese and Spanish rerun at 16-bit on the lines that
dropped words. Results recorded here, per engine.

**C. VoxCPM2.** A new engine `voxcpm2`: manifest (q8 default + bf16 row), a capability row
(cloning with a clip and its transcript; designing a voice from words), the slot's request
mapping for its family, `NOTICE.md` credit, docs (engines catalog, tuning tables, whats-new),
tests (catalog, mapping, knob wiring), and a live run on the real data dir with memory and
speed measured. Not added to the Voice engine setup tiers until it is measured.

**D. Gates + live**, as for gaps 8 and 4.

## 4. Blast radius (greps 2026-10-02)

| Change | What it touches | Grep |
|---|---|---|
| New variant rows | the catalog every screen reads; test id sets; placement and memory rows keyed by variant | `test_variant_wiring.py:36 ids == {"qwen3-cv-1.7b-q8", …}` · `test_cpu_placement.py:86 placement_for(…, "kokoro-82m-q8")` · `test_audiocpp_switch.py:73 _row("kokoro", "kokoro-82m-q8")` |
| Defaults (unchanged) | each engine's `DEFAULT_VARIANT_ID` stays 8-bit | `kokoro/manifest.py:71 "kokoro-82m-q8"` · `qwen3/manifest.py:103 "qwen3-cv-1.7b-q8"` · `chatterbox/manifest.py:65` · `pocket/manifest.py:146` · `asr/manifest.py:70` |
| Repo assertions | the gap-4 widening covers our bf16 file too | `test_variant_wiring.py` "audio.cpp's own repo, or our conversion" · `test_audiocpp_switch.py:26` |
| New engine | engine lists in tests; the slot's family dispatch; Voice engine setup's tier lists | `test_audiocpp_switch.py:26 parametrize("engine", ["kokoro", "qwen3", "chatterbox", "asr"])` · `test_variant_wiring.py:94` · `test_emotion_wiring.py:134` · `slot.py:418/432/463/471/488 if family == "…"` · `QuickSetup.vue:64 ttsEngineIds: ["kokoro", "kitten", "pocket"]` |
| Licences | a new Apache-2.0 model credit | `NOTICE.md`, `LICENSES.md`, `LICENSES/Apache-2.0.txt` |

## 6. Build record (2026-10-02)

**A — 16-bit rows, built.** `release.sixteen_bit(row, path, size, dtype=, source=,
companions=)` derives a sibling from each 8-bit row: id `-q8` → `-bf16` (`-f16` for Chatterbox
and speech recognition — audio.cpp ships those as f16), name "(…, 16-bit)", description "…
16-bit weights — a larger download that needs more memory.", no `cpu_realtime`. Rows: Kokoro 1
(212 MB), Pocket 5 (bf16 GGUF + the same 20 preset embeddings, 350 MB each), Qwen3 5 (CV 1.7B,
CV 0.6B from our repo, Base 1.7B, Base 0.6B, VD 1.7B), Chatterbox 1 (f16, 3.74 GB), speech
recognition 1 (f16 recogniser + f16 aligner, 5.93 GB). Byte sizes from the pinned commit's tree.
Our 0.6B bf16 uploaded: our repo's revision is now `5c14bf487cbb232c08ca8644e569984d9f653a39`
(both files; `CV_06_REVISION` moved to it — the q8 bytes are unchanged and the cache checks
sizes, so nothing re-downloads). Model card updated (both files, the directed-render check).
Tests: the id sets, design list, Chatterbox set, ASR (each precision brings its own aligner)
updated; new `test_every_16_bit_row_is_its_8_bit_siblings_model_at_the_original_precision`
(13 rows). Docs: engines.md catalog (both sizes per model, the 16-bit paragraph), code-map §3a.

**A bug the comparison found first (fixed).** The first run of part B came back with Kokoro
q8 and bf16 at exactly 399.9 s each, Pocket English q8 and bf16 at 347.7 s, three Qwen3 runs at
505.9 s, and every Spanish line refused with "the loaded Pocket TTS Portuguese model speaks
Portuguese". `EngineManager.load` (manager.py, the "Already loaded" branch): when the same
engine held the slot, a request for ANOTHER variant downloaded it, relabelled
`_current_variants` and returned — the slot's own `/load` was never called, so the audio.cpp
slot kept serving the first row under the new name. User-visible: picking Qwen3 Base while
CustomVoice was loaded, Pocket Spanish after English, or any 16-bit row after its 8-bit row,
changed only the label. Fix: a different variant of the loaded engine is treated like a
placement move — the old slot terminates and the new variant loads through the whole path
(memory booking included). Test: `test_loading_another_variant_of_the_loaded_engine_loads_it`
(fails on the old code: one slot, never terminated). The first run's numbers are discarded.

**B — the comparison, measured (rerun on the fixed server, 2026-10-02).** "The Keystone" (The
Ninth Facet, the real data dir): its first 30 lines plus two single-pass passages just under the
800-character chunk size (621 and 777 chars), through `/v1/generate` (Chatterbox through
`/v1/voices/preview` with a Kokoro render of line 1 and its text as the clip — no library voice
exists), one seed per line; Pocket Portuguese and Spanish: 7 lines × 3 seeds. Every render read
back by Qwen3-ASR 1.7B (8-bit), scored for words wrong, silences > 1.5 s inside the line, length.
Harness: session scratchpad `precision_ab.py` (temporary).

| Engine | Words wrong 8 / 16-bit | Lines > 20 % wrong | Silences > 1.5 s | Audio |
|---|---|---|---|---|
| Kokoro | 0.056 / 0.056 | 2 / 2 | 0 / 0 | 399.9 / 400.4 s |
| Pocket English | 0.062 / 0.062 | 2 / 2 | 0 / 0 | 347.7 / 349.0 s |
| Qwen3 CustomVoice 1.7B | 0.099 / 0.109 | 6 / 5 | 2 / 0 | 504.4 / 517.1 s |
| Qwen3 CustomVoice 0.6B | 0.090 / 0.085 | 4 / 3 | 0 / 2 | 496.6 / 511.2 s |
| Chatterbox Multilingual | **0.108 / 0.072** | **5 / 2** | 0 / 0 | 383.3 / 373.0 s |
| Pocket Portuguese (21) | 0.164 / 0.179 | 6 / 7 | 0 / 0 | 71.4 / 70.4 s |
| Pocket Spanish (21) | 0.197 / 0.169 | 6 / 6 | 0 / 0 | 70.2 / 71.1 s |

Read: no consistent 8-bit penalty on Kokoro, Pocket English or Qwen3 (either size). Qwen3's long
silences (both in the long passages) and its babble (0.6B bf16 line 26: "Ah, ah! Tan found…",
10 s) happen at BOTH precisions — the model, not the quantization. **Fix 3:** Pocket Portuguese
and Spanish drop words as often at 16-bit — not the quantization. **Chatterbox is the one
gap:** 16-bit read back better (0.072 against 0.108; 2 lines against 5). The 8-bit's extra
misses are short fragments and names — "she said," → "We said."; "You have it," → "Have it"
(a dropped word); "Kell said, to Vasht" → "Kal said, To wash" — each correct at 16-bit. One
seed per line, 32 lines: a signal. Per decision 2 the defaults stay 8-bit and these numbers go
back to the user.

**C — VoxCPM2, built.** `engines/voxcpm2/` (manifest: `voxcpm2-q8` default + `voxcpm2-bf16`,
30 languages, clone + design, no presets; the approved description), a `voxcpm2` capability row
(clone, design, freeform direction; no transcript field; knobs CFG `cfg_value` 1–5 default 2,
Inference steps `inference_timesteps` 4–30 default 10 — upstream's README defaults — and seed),
the slot's `voxcpm2` mapping, the slot warm-up, NOTICE/LICENSES, docs. Found by trial (CLI on
the CPU, then the app on the GPU) and audio.cpp's source (`src/models/voxcpm2/session.cpp`,
`app/server/runtime.cpp` at v0.9.0):
- audio.cpp runs only the `tts` task ("VoxCPM2 only supports the Tts task"); `--instruct` is
  ignored (byte-identical output). A description is a parenthesised prefix on the text — the
  README's format; audio.cpp splits the leading tag off and the model is steered by it.
- **VoxCPM2 does not speak anything in parentheses**, mid-line too: "He left the room (quietly,
  without a word) and shut the door." came back as "…left the room, and shut the door.";
  "(Aside) He left…" lost "Aside". The mapping turns a line's own brackets into " — " dashes
  ("Aside, he left the room without a word." read back through the app).
- **The clip's transcript is not reachable through the server.** VoxCPM2 reads the transcript
  as the `prompt_text`/`reference_text` option but uses it only with prompt audio
  (`request.audio_input`); the v0.9.0 server sets prompt audio for transcription only and maps
  `voice_ref` to the reference audio. CLI: `--reference-text` → byte-identical to no
  transcript; `--audio clip --request-option prompt_text=…` → different output. A C++ change
  for our copy (map the clip to prompt audio when a transcript comes with it). The approved row
  text says "clones a voice from a short clip and its transcript" — asked.
- **The load measured nothing without a warm-up** ("memory in use 197 → 197 MB"): audio.cpp is
  lazy and `_warm` had no VoxCPM2 branch, so the ledger booked 0 MB and a later speech
  recognition load was refused ("Resident: nothing") while ~5 GB sat on the card. Warm-up added
  (a designed "Ready."); after it: 8-bit 197 → 3,132 MB, 16-bit → 5,086 MB booked 4,889 MB, and
  speech recognition evicts it as it should ("evict LRU tts:voxcpm2 (tts, 4889 MB) — loading asr").
- **Live through the app** (real data dir, RTX 2070 SUPER): 8-bit loaded in 13.9 s; clone 1.25×,
  directed clone 1.38×, design 1.44× real time; 16-bit 0.95×; 48 kHz mono; peak 6.85 GB on the
  card during the 16-bit renders. Qwen3-ASR read every render back word for word (description
  and direction not spoken). CPU: 0.2× real time, 15 GB peak footprint.
- **48 kHz in a 24 kHz chapter** — `concat_lines` appended a mismatched line raw (its docstring
  claimed it resampled). Fixed: `_conform_pcm` brings every line to the chapter's highest rate
  and channel count (scipy `resample_poly`); tests for rate and channels.

**D — gates.** ruff clean · server **927 passed** · vitest 122 · biome clean · vite build ·
smoke all views zero JS errors on the real data dir. Speech engines tab rendered with the new
rows (screenshot): Pocket's 16-bit rows, VoxCPM2 and VoxCPM2 (16-bit) with their chips, sizes
and placement lines, no horizontal overflow, no JS errors. (A first screenshot showed Pocket
"0 models" — the row's loading state before its `/models` answered, ~2.6 s under the page's
concurrent load; it rendered 10 after.)

## 5. Open — asked with recommendations

1. **Which models get a 16-bit row?** Rec: all of them in §2's table (KittenTTS has none).
2. **Defaults after the comparison?** Rec: they stay 8-bit unless the comparison shows a real gap
   on an engine; any change comes back to you with its numbers.
3. **VoxCPM2's row text.** Rec: name "VoxCPM2"; description "OpenBMB's 2B model, 30 languages:
   clones a voice from a short clip and its transcript, or designs one from a written
   description. Runs in the audio.cpp speech runtime." (48 kHz is added only if the live run
   shows it.)
