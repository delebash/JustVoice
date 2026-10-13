# Review — the audio.cpp switch, our fork, the seven hand-wired engines (2026-10-01 → 2026-10-07)

Read-only review. JV at f0600bb + working tree; fork `jv` at f7d83ffb (the v0.9.1 merge, 2026-10-13, local, 61 ahead of origin). The clone-only filter is already recorded and is not repeated here.

## 1. Findings

**F1 — Runtime options: "exposing every option" became "only what I measured"; the approved fork specs were swapped for an app catalog**
- (a) TASKS "audio.cpp switch audit: Qwen3's memory is line length…" (DECIDED 2026-10-04); audit §13.5 5h.
- (b) Approved: "| A fork endpoint listing options | Write option specs for our 7 families in the fork, in the format Kokoro's spec already uses |" (TASKS:4952-4953) and the batch "5h exposing every option" (TASKS:4990).
- (c) TASKS:5013-5014 "5h's rec changed from fork specs to a verified catalog in the app". `server/src/engines/audiocpp/runtime_options.js:7` "Only options whose effect was measured are offered"; `:15` "`mem_saver` changed nothing there, so it is not offered"; `OFFERED` (`:29-56`) holds two Qwen3 session options and nothing else. Audit §13.5 "Not done" (lines 900-909) drops the max-token knobs, Pocket's options, Qwen3 `mem_saver`, and every Chatterbox and VoxCPM2 session option ("unmeasured").
- (d) The approved design was replaced without asking. A rule nobody approved ("only options whose effect was measured") was added in its place. Left out:
  - **Session options:** every one on Kokoro, Kitten, Pocket, Chatterbox (incl. `multilingual_t3`), Turbo, VoxCPM2 and ASR.
  - **Request options:** Qwen3 `do_sample`, `subtalker_do_sample`, `max_tokens`; Chatterbox `max_tokens`, `num_inference_steps`, `do_sample`, `greedy`, `stop_on_eos`; Turbo `max_new_tokens`; VoxCPM2 `min_tokens`, `max_tokens`, `retry_badcase`, `chunk_strategy`, `text_chunk_mode`; Pocket's 13; Kitten `text_chunk_mode`; the ASR options.
  - **Stale record:** RESEARCH.md:207-209 still says "the Qwen3, Chatterbox, VoxCPM2 and Pocket specs list none". After today's v0.9.1 merge (local only) they list them: request/session counts are qwen3_tts 17/15, chatterbox 16/8, voxcpm2 14/15, pocket_tts 13/20, qwen3_asr 7/9.
- (e) Sure. TASKS lines, runtime_options.js and audit §13.5 read; spec option counts counted at 795c45fb and at HEAD.
- (f) Generate the seven engines' knobs and session options from the fork's specs, as `generated.settingsOf` already does. Fill the gaps in the fork's specs. Advanced options stay folded.

**F2 — What our fork adds is not declared in the fork's own specs, so the app hard-codes it**
- (a) Same audit decision (the 7-family fork specs). Also TASKS 2026-10-13 NOT: "a hand-wired engine where audio.cpp's spec, plus our additions made in the standard way, can say it."
- (b) As F1(b).
- (c)
  - `../audio.cpp/model_specs/kokoro_tts.json:17-61`: its request options have no `voice_pack` (fork 86767dad) and no inline-pronunciation markup (42db68d9).
  - `chatterbox.json:15`: "languages" still lists the 19. Fork fc55e1e6 and 6a2bb4c5 added he/ru/zh/ja.
  - `chatterbox_turbo.json`: tasks are `["tts"]` and no request options are declared, though `src/community_models/chatterbox_turbo/session.cpp:22-40` reads temperature, top_p, repetition_penalty, top_k and max_new_tokens. Its packages are audio-cpp's non-cloning repack only; there is no Nano and none of `delebash/chatterbox-{turbo,nano}-GGUF`.
  - The Kokoro join constants are constexpr, not an option (F14).
  - The app compensates by hand: `release.js:45-55` FEATURES, `chatterbox/manifest.js:64-68` (language list grown in code), `turboRow` (`:46-59`).
- (d) The fork's real capabilities are invisible to anything that reads specs, `generated.js` included. Every addition needs app code.
- (e) Sure. Specs and fork diffs read.
- (f) Declare each addition in the fork's spec: options, languages, the clone task and packages, Nano.

**F3 — Chatterbox Multilingual v3, planned at the cut, is not offered**
- (a) Switch plan §3.2 table (the "run the pre-cut checks, go your rec do the design and coding go" go).
- (b) "| chatterbox | Multilingual v2 · v3 (one file, a session option) | Turbo, Nano, he/ja/ru/zh |" (`docs/plans/2026-10-01-audiocpp-switch.md:120`).
- (c) `chatterbox/manifest.js:86-99`: the only row is `chatterbox-multilingual-v2-q8`. `runtime_options.js:29` offers nothing for chatterbox. RESEARCH.md:2286-2287: "audio.cpp runs multilingual T3 **v2** unless the session option `chatterbox.multilingual_t3` is `v3` … we never set it."
- (d) An approved item is half done. The v3 T3, already inside the downloaded GGUF, can't be chosen.
- (e) Sure. Grep shows `multilingual_t3`/v3 appears only in `catalog.json`.
- (f) Offer v3 as a row or as a model-row option (`chatterbox.multilingual_t3`).

**F4 — Turbo and Nano are clone-only; audio.cpp's built-in voice is left out**
- (a) "Chatterbox Turbo and Nano clone again…" (gap 1).
- (b) Switch plan §5.1: "Chatterbox Turbo cloning (and Nano with it)". The words "clone-only" are only in the implementer's plan ("This brings them back as they were … clone-only", gap-1 §1). The earlier 10-02 "Chatterbox Turbo — out: audio.cpp's Turbo has one English voice and no cloning" was about a Turbo that could not clone.
- (c)
  - `slot.js:566-569`: "The app offers Turbo's cloned voices only, but its built-in voice needs no clip" (it warms up on that voice).
  - `slot.js:929-931` refuses with "speaks only cloned voices".
  - `chatterbox/manifest.js:53` sets `preset_voices: 0`.
  - The spec says `"tts": ["speaker_reference","built_in_voices"]`.
- (d) A working preset voice on Turbo and on Nano is hidden.
- (e) Unsure whether the user meant to exclude it. The code is read.
- (f) Offer the built-in voice as a preset on Turbo and Nano.

**F5 — The rest of the hand-wired families' packages and tasks appear nowhere**
- (a) None. The user never saw this (the hand-wired split is 2026-10-11; it hides what the 10-01 manifests never had).
- (b) None.
- (c) `generated.js:31-35` `HAND_WIRED_FAMILIES` and `:170` skip every family a manifest uses. `:9-10` says "they hold measured fixes a spec doesn't carry", which is the implementer's justification. Never offered as a result:
  - Chatterbox's **vc** task (spec tasks `tts, clone, vc`; catalog entry `chatterbox-vc`);
  - **QwenCleo-ASR** q8/f16;
  - **Qwen3-ASR 0.6B** q8/f16 (left out by the user's word 2026-10-02: "keep Qwen3-ASR 1.7B as the only recogniser");
  - the `orig` precision of Qwen3 Base 1.7B and of VoxCPM2;
  - audio.cpp's own Turbo package (built-in voice);
  - streaming modes (Pocket, VoxCPM2, ASR).
- (d) Only what the hand-written manifests list exists. Voice conversion and a second recogniser family are missing.
- (e) Sure. Spec, catalog and generated.js read.
- (f) Put the seven engines on the spec path. Our measured fixes go in their curated files, so every package and task shows.

**F6 — Pocket TTS still leaves out 6 of its 26 presets on licence grounds**
- (a) "Offer the best models audio.cpp has, licence-labelled, not licence-limited (decided 2026-10-11)". It supersedes the 10-02 approval ("its 20 commercially usable presets").
- (b) "lets not limit ourselves anymore we just make sure the user is informed" (TASKS:806-807). NOT: the commercial-use rule "as reasons to leave a model out — now a label and a terms gate instead" (TASKS:812-814).
- (c) `pocket/manifest.js:20-28` "Left out: cosette (Expresso) and jean (EARS), both non-commercial; giovanni, lola, juergen and rafael, whose recordings state no licence". PRESETS `:74-95` holds 20. `docs/engines.md:214-220` explains it the same way.
- (d) Six of Kyutai's voices are missing. They should be offered with a "No" or "Unclear" label.
- (e) Sure.
- (f) Offer all 26, each with its licence label (`docs/model_licenses.md` pattern).

**F7 — Pocket presets are tagged English only, so a language filter hides them**
- (a) None. The user never saw this (CPU placement build, 10-02).
- (b) None.
- (c) `pocket/manifest.js:100-102`: `STATIC_VOICES … language: "en"` ("Listed once, as English"). `src/pages/VoicesPage.vue:225` filters with `test: (v, x) => baseLang(v.language) === x`. The same pattern shows on Qwen3 CustomVoice's 9 speakers, one native language each (`qwen3/manifest.js:155-165`, pre-switch), though the model speaks all 10.
- (d) With the language filter on German, Italian, Portuguese or Spanish, no Pocket preset shows, although each language's model speaks all of them.
- (e) Sure for the code and the Voices page filter. The persona page's filter was not traced.
- (f) Give each preset every language its models speak.

**F8 — Kitten's seed: the approved re-check is not on record, and the seed is still hidden**
- (a) Audit decision, step 5 batch 5a.
- (b) "5a requests: seeds, defaults, clamps, language names, Kitten's seed" (TASKS:4984-4985). Audit D2: "`kitten_tts/decoder.cpp:1029` re-seeds every decode. Worth re-measuring; Kitten may be able to offer a seed." The 10-02 D3 approval rested on the earlier measurement.
- (c) `capability_details.js:128-141`: "no seed control is offered", `knobs: [speedKnob()]`. The §13.5 5a record has no Kitten re-measurement. The spec lists `seed`.
- (d) A spec option is hidden because of a measurement the audit doubted.
- (e) Unsure. No record of the re-measure was found anywhere; the code is unchanged.
- (f) Re-measure on the pinned build. Offer the seed if the audio repeats.

**F9 — The hand-wired knob table is narrower than audio.cpp's own controls**
- (a) Switch §3.4 and audit 5a/5h.
- (b) None of these numbers is in the approved words. 5a named "clamps" only.
- (c) `capability_details.js:5`: "Hand-authored interim data". Compared with audio.cpp's own controls (`webui/configs/model_params.json`, the specs):

  | Knob | App | audio.cpp |
  |---|---|---|
  | Chatterbox Exaggeration (`:100`) | min 0.25 | 0–2 |
  | VoxCPM2 CFG (`:348`) | 1.0–5.0 | 0–5 |
  | VoxCPM2 steps (`:349`) | 4–30 | ≥1 |
  | Qwen3 top k (`:66`) | 1–100 | ≥0, no cap |
  | Repetition penalty | max 4.0 | — |
  | Seed (`:52`) | max 2,000,000,000 | spec max 4,294,967,295 |
  | Every temperature / top-p (`:32`, `slot.js:75`) | floor 0.05 (`MIN_SAMPLING = 0.05`) | — |

- (d) Ranges and floors are the implementer's.
- (e) Sure. Numbers read on both sides.
- (f) Take min, max and default from the spec or `model_params.json`. Keep only the floors audio.cpp itself needs, each recorded.

**F10 — What the spec and GGUF carry is copied by hand into the hand-wired engines**
- (a) TASKS 2026-10-13 NOT (as F2).
- (b) "a hand-wired engine where audio.cpp's spec, plus our additions made in the standard way, can say it."
- (c)
  - `kokoro/voices.js:11-66`: 54 voices. The app already reads the GGUF's `voices.json` for blends (`blending.js`, gap-2 plan §5).
  - `kitten/manifest.js:39-48`: 8 voices (spec `ui.builtin_voices`).
  - `slot.js:758` `FAMILY_BUDGET = { chatterbox: 128, chatterbox_turbo: 128, kokoro_tts: 240, kitten_tts: 400 }`, which are the specs' `text_chunk_size` defaults.
  - Language lists: `chatterbox/manifest.js:64`, `voxcpm2/manifest.js:48-51`, `asr/manifest.js:30-34`, `qwen3 LANGS`.
- (d) Re-done by hand. Each copy drifts when audio.cpp changes: the v0.9.1 specs already differ.
- (e) Sure.
- (f) Read them from `catalog.json` and the specs. Keep only gender and other app-only facts in curated files.

**F11 — Kokoro sends US English for any language it doesn't know**
- (a) Switch plan §3.4.
- (b) "language | voice prefix code (`en-us` …)".
- (c) `slot.js:815`: `req.language = get(KOKORO_LANGUAGE, key) ?? get(KOKORO_LANGUAGE, key.split("-")[0]) ?? "en-us";`. The spec says "defaults to the selected voice prefix". The fork's `frontend.cpp:97-100` refuses "Kokoro voice/language mismatch". The audit fixed the same pattern for Qwen3 (D6 → Auto), not for Kokoro.
- (d) A line tagged, say, German is read with English phonemes on an English voice, silently. On a Spanish, French, Hindi or other voice it fails with audio.cpp's mismatch error instead of being spoken in the voice's language.
- (e) Sure for the code. The effect is inferred from the fork's frontend.
- (f) Fall back to the voice's own language, or refuse by name. Ask which.

**F12 — One unknown IPA symbol stops the whole Kokoro line**
- (a) Gap 3.
- (b) Switch §5.3: "Single-word IPA from lexicons — fork: a text+IPA splice". The refusal is only in the implementer's plan (gap-3 §3.1 "a wrong one refused naming the word").
- (c) Fork `src/models/kokoro_tts/frontend.cpp:148-162` (`require_kokoro_symbols`, "…which is not one of Kokoro's phoneme symbols"). `kokoro/ipa.js:12-13`.
- (d) One lexicon entry with a symbol the mapping misses (e.g. ʍ) refuses every line with that word on Kokoro. It does not fall back to the G2P or the respelling.
- (e) Unsure whether refusing is wanted. The code is read.
- (f) Ask: refuse, or fall back for that word with a warning.

**F13 — The Turbo/Nano converter was deleted, not moved as approved**
- (a) The 2026-10-08 no-Python decision (Electron conversion item).
- (b) "anything we added to the fork that runs Python moves to C++ or JS" (TASKS:3559).
- (c) Fork a1b68c33 "Our Python goes…" deleted `tools/community_models/chatterbox_turbo/convert_chatterbox_turbo.py` (310 lines). There is no port, and no decision records the deletion.
- (d) The cloning Turbo and Nano GGUFs can no longer be re-made: not for a new Resemble revision, not at another precision. Since 2026-10-11 tools may be Python again (CLAUDE.md).
- (e) Sure. The commit and TASKS were read.
- (f) Restore it as a tool, or port it. The user decides which.

**F14 — Hardcoded values the family rule says belong in settings; some numbers were never shown**
- (a) Family rules: "No hardcoded values a user might want to change". Also the join decisions (2026-10-07), the silence guard (2026-10-11) and audit 5a/5f.
- (b) The join's "260 ms" and "−60 dB over 10 ms windows" were shown and approved (TASKS:1258-1261, 1360-1362). The silence guard was approved as "any stretch of pure digital silence". The other numbers below were never shown.
- (c)
  - Fork `src/models/kokoro_tts/session.cpp:44-46`: constexpr 0.26 s / −60 dBFS / 10 ms, applied to every caller, with no request option.
  - Server `audio/chunked.js:36,38`: constants.
  - `slot.js:128`: `VOICE_PACKS_KEPT: 200, REFERENCES_KEPT: 200, SILENCE_RUN_S: 0.01, SILENCE_FILL_LSB: 2`. The guard fills only runs of 10 ms or more, against "any stretch".
  - `slot.js:75`: `MIN_SAMPLING = 0.05`.
  - `slot.js:693`: the transcription timeout of 3× the recording's length.
  - `slot.js:760`: `CALIBRATION_AUDIO_S = 30.0`.
- (d) None of these can be changed without a code change. 200, 0.05, 3× and 10 ms are the implementer's own.
- (e) Sure.
- (f) Seed them as settings. Make the fork's join a declared Kokoro request option.

**F15 — Linux NVIDIA machines get Vulkan; the release's Linux CUDA build is skipped**
- (a) Switch plan §3.1.
- (b) "CUDA 13.3 for Blackwell, Vulkan, CPU; Linux and macOS archives the same way."
- (c) `release.js:108-110`: "Linux has no general CUDA archive — NVIDIA boxes run the Vulkan build". `binaries()` `:122-123` lists Vulkan and CPU only. The fork's `release.yml:312` publishes `bin-ubuntu-x64-cuda12.8-colab` (sm 75–90).
- (d) A faster backend may be left out on Linux.
- (e) Unsure. The colab bundle stages only `audiocpp_server` (no `audiocpp_dsp`, `jieba/` or libmecab), so it is not a drop-in.
- (f) Check whether a full Linux CUDA bundle is wanted. If so, build it in our release workflow.

**F16 — The switch's R1–R15 were decided after a go given before they existed**
- (a) Switch plan §4 "Made under 'your rec'".
- (b) "run the pre-cut checks, go your rec do the design and coding go" came before the recs were written. No later TASKS entry shows R1–R15 to the user.
- (c) Narrowings among them:
  - R3 "8-bit models by default";
  - R11 "the `url` override went with the tarball engines";
  - R13 "The Speech engines tab lists managed engines only";
  - R10's tiers (later replaced by the user's 10-04 word).
- (d) Implementer calls recorded as decided.
- (e) Unsure whether the blanket go covers them.
- (f) List R3, R11 and R13 for the user's word.

## 2. Per hand-wired engine: audio.cpp vs the app

Spec = `../audio.cpp/model_specs/<family>.json` at jv HEAD (v0.9.1 merged); UI = `webui/configs/model_params.json`. **GAP** marks what the app leaves out.

**Kokoro (`kokoro_tts`)**

| | audio.cpp | App | |
|---|---|---|---|
| Voices | 54 (spec + GGUF `voices.json`) | 54, hand-copied | copy (F10) |
| Languages | 9 | 9 | — |
| Precisions | q8_0, bf16 | both | — |
| Tasks | tts (built-in voices, long_form) | tts + blends + inline IPA (fork) | fork additions undeclared (F2) |
| Request | language, seed, speed (≥0.01), phonemes, text_chunk_size 240, return_timestamps | speed 0.5–3.0, seed, language (fallback en-us, F11) | **GAP** return_timestamps, phonemes, text_chunk_size (host splits at 240, approved) |
| Session | weight_type, conv_weight_type, weight_context_mb, 3 predictor arenas, graph_capacity_mode, max_input_tokens, pre_tail_tokens | none | **GAP** |

**KittenTTS (`kitten_tts`)**

| | audio.cpp | App | |
|---|---|---|---|
| Voices | 8, default Leo | 8, hand-copied | copy |
| Languages | en | en-US | — |
| Precisions | orig only | orig | — |
| Request | speed, seed, text_chunk_mode, text_chunk_size 400 | speed | **GAP** seed (F8), chunk options |
| Session | weight_type, conv_weight_type, graph_capacity_mode, max_input_tokens, pre_tail_tokens, eSpeak paths | eSpeak paths only | **GAP** |

KittenTTS 2 (`kitten_tts2`, upstream v0.9.1) is a separate family, not hand-wired.

**Pocket TTS (`pocket_tts`)**

| | audio.cpp | App | |
|---|---|---|---|
| Voices | 26 embeddings | 20, all tagged en | **GAP** 6 (F6); language tags (F7) |
| Languages | en de it pt es | all 5, one model each | — |
| Precisions | q8_0, bf16 per language; native safetensors | q8, bf16 | native |
| Tasks / modes | tts, clone; offline, streaming | tts + clone (terms gate, approved) | **GAP** streaming |
| Request | frames_after_eos, max_steps, max_tokens, temperature, seed, noise_clamp, eos_threshold, noise_file, voice_embedding_path, voice_clone_text (stored, unused), truncate_clone_audio, text_chunk_size, export_voice_state_path | seed | **GAP** the rest |
| Session | voice_state_cache_slots + 19 weight/graph options | none | **GAP** |

**Qwen3-TTS (`qwen3_tts`)**

| | audio.cpp | App | |
|---|---|---|---|
| Voices | CustomVoice's 9 speakers | 9, one native language each | language tags (F7) |
| Languages | 10 | 10 + Auto | — |
| Precisions | Base 1.7B q8/bf16/orig, Base 0.6B q8/bf16, CV 1.7B q8/bf16, VD 1.7B q8/bf16 | all GGUF ones + our CV 0.6B q8/bf16 | **GAP** Base 1.7B orig |
| Tasks | tts, clone, design | all three (per checkpoint) | — |
| Request | language, max_tokens, do_sample, temperature, top_k, top_p, repetition_penalty, subtalker_do_sample + 3 subtalker, seed, reference_text, x_vector_only_mode, instruction, speaker, text_chunk_size | temperature, top_k ≤100, top_p, repetition ≤4, 3 subtalker, seed, reference_text, x_vector_only_mode, instruct, speaker | **GAP** max_tokens, do_sample, subtalker_do_sample; floors (F9) |
| Session | mem_saver, perf_mode, voice_prompt_cache_slots, 5 weight types, 4 arenas, 3 contexts | perf_mode, conv_weight_type | **GAP** the rest (F1) |

**Chatterbox Multilingual (`chatterbox`)**

| | audio.cpp | App | |
|---|---|---|---|
| Voices | clone | clone | — |
| Languages | spec 19 (fork code 23) | 23 | spec stale (F2) |
| Precisions | q8_0, f16, native | q8, f16 | — |
| Tasks | tts, clone, **vc** | clone | **GAP** vc (F5) |
| Request | exaggeration (0–2), guidance_scale, temperature, repetition_penalty, min_p, top_p, s3gen_cfg_rate, max_tokens, do_sample, greedy, stop_on_eos, num_inference_steps, seed, source_audio, target_voice, text_chunk_size | first seven (exaggeration ≥0.25) + seed | **GAP** max_tokens, do_sample, greedy, stop_on_eos, num_inference_steps |
| Session | weight_type, t3_weight_type, **multilingual_t3 v2/v3**, conditionals_cache_slots, mem_saver, condition sample counts, t3_speech_cond_prompt_len | none | **GAP** v3 (F3) and the rest |

**Chatterbox Turbo / Nano (`chatterbox_turbo`)**

| | audio.cpp | App | |
|---|---|---|---|
| Voices | built-in + clone (fork) | clone only | **GAP** built-in (F4) |
| Languages | en | en | — |
| Packages | spec: audio-cpp repack q8/f16 (no clone); ours Turbo and Nano q8/f16 (undeclared) | our 4 | **GAP** audio.cpp's own package |
| Request (read by session.cpp, undeclared) | temperature, top_p, repetition_penalty, top_k, max_new_tokens, seed, text_chunk_size | first four + seed | **GAP** max_new_tokens |
| Session | conditionals_cache_slots | none | **GAP** |
| Tags | 19 tokens | 19 (all passed the 10-04 check) | — |

**VoxCPM2 (`voxcpm2`)**

| | audio.cpp | App | |
|---|---|---|---|
| Voices | clone, design | both | — |
| Languages | 30 + "zh dialects" | 30 | **GAP** zh dialects |
| Precisions | q8_0, bf16, orig, native | q8, bf16 | **GAP** orig |
| Tasks / modes | tts, clone, design; offline, streaming | offline | **GAP** streaming |
| Request | min_tokens, max_tokens, num_inference_steps, guidance_scale (0–5), retry_badcase, retry_badcase_max_times, retry_badcase_ratio_threshold, seed, cfm_noise_file, stream_left_context, prompt_text, chunk_strategy, text_chunk_size, text_chunk_mode | guidance 1–5, steps 4–30, retry tries 1–10, ratio 2–12, seed, reference_text | **GAP** min/max_tokens, retry_badcase, chunk_strategy, text_chunk_mode |
| Session | 15 (weight types, prompt_cache_slots, mem_saver, contexts) | none | **GAP** |

The app also rewrites a line's own brackets as dashes (app-side, gap 9).

**Speech recognition (`qwen3_asr` + `qwen3_forced_aligner`)**

| | audio.cpp | App | |
|---|---|---|---|
| Models | Qwen3-ASR 1.7B q8/f16, 0.6B q8/f16, QwenCleo q8/f16, native | 1.7B q8/f16 + aligner q8/f16 | **GAP** QwenCleo; 0.6B (out by the user's 10-02 word) |
| Languages | 30 + zh dialects | 30 | — |
| Modes | offline, streaming | offline | **GAP** streaming |
| Request | language, max_tokens, return_timestamps, audio_chunk_mode, audio_chunk_duration_sec, clamp_timestamps_to_audio, preserve_punctuation | language | **GAP** the rest |
| Session | forced_aligner_path, vad_path, weight types, arenas | aligner registered as its own model | — |

## 3. Decisions checked with no finding

- **The switch itself:** one cut; Whisper dropped for Qwen3-ASR; no watermark; training removed (Q2); 16 kHz aligner input kept (`slot.js:713-724`).
- **Our copy:**
  - the tag scheme, the update offer (`PREVIOUS_TAGS`), and jv.1's two fixes;
  - the "—" fix and its refusal text (`slot.js:869`);
  - x-vector-only stored on a voice;
  - the old build deleted after an update;
  - the jv.4 tag name, and libmecab from fugashi;
  - gap 7's jieba and dictionary row as answered.
- **Gap 2:** blends via `voice_pack`; the voice id is the first preset of the blend's language. Its only issue is F2.
- **Gap 3:** the splice follows the host's own rule. Its only issues are F12 and F2.
- **Gap 1:**
  - the HF repos (Q1);
  - the rows and capability rows "as before the switch" (0.8 / 1.2 / 0.95 / 1000);
  - the >5 s clip (upstream's own assert);
  - all 19 tags kept (tag check).
- **Gap 4:** CV 0.6B published and wired; the default stays 1.7B.
- **`npm run dev` on the checkout:** D1–D5 match `dev_build.js` and `scripts/audiocpp-dev.js`.
- **Kokoro join:**
  - 260 ms and −60 dBFS over 10 ms are both in the user's approved words;
  - fork a2601edf matches the server's rule;
  - only the family-rule point remains (F14).
- **Qwen3 "last 25 frames"** (fork 8523b720):
  - approved as "trim the clip's context";
  - heard as "no difference";
  - 25 is upstream's `kLeftContextCodes`.
- **Split sizes:** Kokoro 240 and Qwen3 / VoxCPM2 200, with description voices whole, as approved and listened.
- **16-bit Qwen3 decoder weights as the default:** approved with "your rec on all and all previous go code".
