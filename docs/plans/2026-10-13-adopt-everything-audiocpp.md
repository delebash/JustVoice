<!-- SPDX-License-Identifier: MIT -->
# Adopt everything audio.cpp has — the plan (2026-10-13)

Decided: TASKS "Adopt everything audio.cpp has in engines; what we add, in a standard way" — the
user: "the whole point was to adopt everything audio cpp has to offer use everthythiny by default
and only add anything custom that we need and make it standard"; "go and i want evertyhing done
right we adopt all that audio cpp has in engines anything we need to add we do so in a stnadard
way". The narrowings review (`docs/plans/2026-10-13-narrowings-review/`) found what the app leaves
out today; its group C is this plan's list. **Nothing here is built until the user's word on this
plan.** Facts: RESEARCH §1 (the runtime), §1.4 (our fork, v0.9.1), §10.13–10.14.

## 1 · What it is

**What you see.** AI Settings → Speech engines lists every model audio.cpp runs that turns text into
speech or speech into text — not only the ones that copy a voice from a clip. For each model:

- **Its built-in voices** are voices in the app, listed and filtered like Kokoro's are today, and
  any persona can use one.
- **Copying a voice from a clip** and **making a voice from words** work wherever the model can do
  them: the Clone and Design pickers offer every model that can.
- **Every setting it has**, from audio.cpp's own description of it: numbers, choices and switches
  as controls (a number with no range is a number box, as in audio.cpp's own UI), each starting at
  audio.cpp's own default; the ones only an expert needs folded under Advanced.
- **Its load options** (read when the model loads) on the model's row, as Qwen3's two are today.
- **Every download audio.cpp's own UI offers** for it (each precision), never fewer.
- **Speech recognition models** are transcription engines: dictation, the words of a clip you clone
  from, read-back.
- What JustVoice adds — tested by us, best for, how a line's direction reaches it, its licence in
  plain words — as today.

**The seven engines wired by hand today** (Kokoro, Kitten, Pocket TTS, Qwen3-TTS, Chatterbox with
Turbo and Nano, VoxCPM2, Qwen3-ASR) become the same kind of engine: built from audio.cpp's
description of them. Everything they do today stays — your voices, personas, saved settings and
memory measurements keep working with no reset (§4).

**Still left out**, by earlier decisions: models audio.cpp marks `wip` or `unsupported` (2026-10-11,
answer 3); AuK and OuteTTS, which don't speak as listed (2026-10-12). Voice conversion, cleanup,
sound effects and music each get their own plan and mock (2026-10-11, answer 9 — conversion first).

## 2 · Where each fact comes from, and the standard each piece follows

| Piece | Follows | Where |
|---|---|---|
| A model's tasks, voices, settings, load options, packages | audio.cpp's model spec format — "the target source of truth for model metadata, package layout, downloads, UI hints … runtime capabilities" | `../audio.cpp/docs/maintainers/model_specs.md`; `model_specs/<family>.json` |
| Which packages a model offers | audio.cpp's own web UI rule, `installChoices` (expose-all families, special stems) — ported whole; nothing we offer today is removed | `../audio.cpp/webui/native/src/lib/catalog.ts` |
| Labels, ranges, number vs slider | audio.cpp's `model_params.json` where it has them, else the spec | `../audio.cpp/webui/configs/model_params.json` |
| What our fork adds to a model (Kokoro's voice packs and inline pronunciations, Chatterbox's he/ru/zh/ja, Turbo/Nano cloning packages and options, VoxCPM2's transcript) | the same spec format, **in our fork's own spec files** — so the spec says what our build does | `../audio.cpp/model_specs/*.json` on `jv` |
| A model with no catalog entry (F5-TTS, VoiceTut, dots.tts Edit, QwenCleo) | an entry in our fork's copy of audio.cpp's catalog | `../audio.cpp/webui/configs/models_catalog.json` |
| What JustVoice knows about a model (direction, tested, best for, licence words, warm-up line, clip limits, consent gates, voice genders and display names, old ids, old setting names) | data in the family's curated file — the existing pattern | `server/src/engines/audiocpp/curated/<family>.js` |
| Code a model truly needs (Kokoro's blend packs and the IPA splice, the aligner's 16 kHz input, the Qwen3 silence guard until its cause is fixed in our copy) | kept, in the family's request branch | `server/src/engines/audiocpp/slot.js` |

No NOT STANDARD piece is new here: the catalog script and the curated files exist (approved
2026-10-11).

## 3 · What changes, by finding

| Finding | The change |
|---|---|
| E0 | Every family that speaks is offered (`generatedModels` stops skipping families that don't clone). |
| (presets) | A family's built-in voices come from its spec (`ui.builtin_voices`, or the voice option's choices) and are listed as voices, as the hand-wired presets are (`STATIC_VOICES`). |
| E5, (design) | Voice-design catalog entries (`vdes`) are offered to the Design picker; the request carries the description the way the spec's design option takes it. |
| E1 | Speech-recognition families become `stt` engines. Captions keep Qwen3-ASR + its aligner, the only aligner audio.cpp has (question 2). |
| E2, F9 | Settings from the spec (and `model_params.json`): every request option but the ones the app sets itself (text, the clip and its words, language, seed, the family's direction option, file paths, streaming and chunking); a number with no range as a number box; ranges as audio.cpp gives them. (No default where audio.cpp gives none — E12 — is built, 2026-10-13.) |
| E3 | MOSS-TTSD's, MOSS-TTS v1.5's and OmniVoice's `instruct`/`instruction` become their direction option (their curated files) — otherwise shown as a setting. |
| E4, M5, F1 | Load options from the spec's `options.session`, folded, at audio.cpp's defaults; Qwen3's decoder stays 16-bit by default (approved 2026-10-04). A change reloads the model (as today); the memory price is kept per load options (question 3). |
| E6, E14, F5 | Packages by audio.cpp's `installChoices`, adding MOSS-TTSD Q4_K and BF16, CosyVoice3 F32, Irodori Anime, Breeze Q4_0, the original-precision Qwen3-TTS Base and VoxCPM2, Qwen3-ASR 0.6B (question 4) and QwenCleo; audio.cpp's own Turbo package beside ours; nothing removed. |
| E7 | F5-TTS and the others with no catalog entry get entries in our fork's catalog (vocoder as a companion file). |
| E8 | A model with no direction file says *Can't be directed yet* on its row and in the persona page; the persona page offers only the emotions a family's direction file maps. |
| M1 | A generated model that can speak without a clip (a built-in voice or a design) warms up on its first load with a full-length line, so its memory is measured (as the hand-wired ones do). Clone-only models: question 5. |
| F2 | Our fork's additions written into our fork's specs (table §2). |
| F3 | Chatterbox Multilingual v3 — the spec's `chatterbox.multilingual_t3` load option (at v0.9.1) on the model's row; v3's languages as audio.cpp lists them. |
| F4 | Turbo's and Nano's built-in voice listed as a voice (question 6). |
| F10 | Voices, languages and chunk sizes read from the specs and the GGUFs; the curated file keeps only genders, display names and our ids. |
| C13 | The voice makers' per-model notes move into the curated files (`BEST_FOR`-style), so a newly offered model gets its note there or none. |
| P36 | "Picking an engine…" rows come from the curated files' notes for every engine that has one (the approved rows keep their words). |
| K2 | VieNeu listed, marked as not copying a voice from a clip yet (decided 2026-10-13, the narrowings review K2); whether it speaks from text alone is checked in slice 2. |

## 4 · What must not break (the checks found these)

- **Ids.** Voices, personas, settings, prices and saved renders use today's engine ids (`kokoro`,
  `kitten`, `pocket`, `qwen3`, `chatterbox`, `voxcpm2`, `asr`) and model ids
  (`chatterbox-multilingual-v2-q8`, `qwen3-cv-1.7b-q8` …). Each hand-wired family's curated file maps
  its family and packages to those ids, and the generated rows use them. The render cache key
  doesn't change, so no take goes stale.
- **Saved settings.** Personas and lines store some settings under the app's names (`cfg_value`,
  `inference_timesteps`, `cfg_weight`, `talker_temperature`), not the spec's (`guidance_scale`,
  `num_inference_steps` …). The curated file keeps that map, so saved values keep working.
- **Measured memory.** Prices are kept per runtime build and split size today; a load option that
  changes memory gets its own price (question 3).
- **What each engine does today.** Every hand-wired behaviour that stays (§2's last row, the
  curated data) has a test today; those tests keep passing.

## 5 · Order — each slice accepted before the next

1. **The catalog script** ports `installChoices` and reads every task, voice, session option and
   setting; our fork's spec additions (F2) and catalog entries (E7). Accepted: a test that every
   package audio.cpp's UI offers at the pin is in `catalog.json`, and that every hand-wired engine's
   facts (voices, languages, packages) come out as today.
2. **Every speaking family offered** — built-in voices, design, clone, `stt` engines; *Can't be
   directed yet*; the warm-up (M1). Accepted through the app, as the download test was: every model
   that fits 8 GB loads and speaks a line that reads back, in a built-in voice where it has one; the
   new recognisers transcribe the same clip.
3. **Settings and load options from the spec** (E2, E4, F9, F3). Accepted: unit tests on the
   option mapping; one model's load option and one number-box setting reach the runtime.
4. **The seven hand-wired engines on the same path** (F4, F10, ids and setting names kept).
   Accepted: the hand-wired tests pass unchanged; a persona made before speaks the same take with
   the same seed; the user's data opens with nothing missing.
5. **The user docs** (`docs/engines.md` rewritten for a list we don't hand-write) and the mock.

Slice 6 of the engine list (our fork on v0.9.1, the jv.6 release, the pin) lands first: this plan
builds on v0.9.1's specs.

## 6 · Blast radius (greps, 2026-10-13)

```
# the engine list and its readers
server/src/engines/audiocpp/generated.js · server/src/engines/capability_details.js · server/src/engines/manager.js
# the seven manifests
server/src/engines/{asr,chatterbox,kitten,kokoro,pocket,qwen3,voxcpm2}/manifest.js
# capability rows
server/src/api/engines_api.js · server/src/engines/blending.js · server/src/line_takes.js · server/src/persona_render.js · server/src/render_core.js · server/src/voice_model.js
# hand-wired engine ids written into code (37 files)
server/src/api/{captures_api,capture_readiness_api,engines_api,external_api}.js · server/src/engines/audiocpp/{runtime,slot}.js · server/src/engines/blending.js · server/src/models.js · server/src/voice_model.js
src/components/{PersonaBlendMaker,PersonaCloneMaker,PersonaDesignMaker,QuickSetup,TtsProviderForm}.vue · src/components/mock/{MockBlendMaker,MockCloneMaker,MockDesignMaker}.vue
src/pages/{SettingsPage,VoicesPage}.vue · src/services/voiceGender.js · src/stores/ui.js · src/services/mock/{personaMock,speechEnginesMock}.js
# preset voices
server/src/engines/{kitten,kokoro,pocket,qwen3}/manifest.js STATIC_VOICES · server/src/engines/kokoro/voices.js
# the catalog
scripts/audiocpp-catalog.js · server/src/engines/audiocpp/catalog.json · server/src/engines/audiocpp/curated/*.js
# knobs and load options
server/src/engines/audiocpp/runtime_options.js · server/src/models.js (KnobSpec) · src/components/DeliveryKnobs.vue · src/pages/PersonaEditorPage.vue · src/components/StudioRenderChapter.vue
# tests that read the registry, rows or mapping
server/tests/{audiocpp_generated,audiocpp_catalog,variant_wiring,engine_knob_wiring,engine_manifests,audit_step5,emotion_wiring,line_model_settings,persona_render,turbo_cloning,audiocpp_switch}.test.js · src/services/{capabilities,facets,newPersonas,personaFacts,voiceGender}.test.js
```

## 7 · Questions (a lean under each)

1. **This plan as written** — the five slices in that order, after slice 6? Lean: yes.
2. **Captions with a recogniser other than Qwen3-ASR** — word timings need an aligner, and audio.cpp
   has only Qwen3's. Keep captions on Qwen3-ASR + its aligner whatever recogniser dictation uses?
   Lean: yes.
3. **Load options and the memory price** — a load option like Qwen3's 16-bit decoder changes what a
   model holds. Keep a price per load-option set (measured the first time each is used)? Lean: yes.
4. **Qwen3-ASR 0.6B** — left out by your word 2026-10-02 ("keep Qwen3-ASR 1.7B as the only
   recogniser"). Offer it now that everything is offered? Lean: yes, 1.7B stays the default.
5. **Clone-only models' memory before their first line** — they can't warm up without a clip. Save
   the whole-card difference after their first line as their price (today's fallback, at the line
   instead of the load)? Lean: yes.
6. **Turbo's and Nano's built-in voice** — the spec gives it no name or gender. List it as "Turbo
   (built-in)" and "Nano (built-in)", gender Not known? Lean: yes — the names are for your word.
7. **Streaming** (Pocket, VoxCPM2, recognition) — the app renders whole lines and the dictation
   path is its own. Leave streaming out of the app's choices? Lean: yes, until a screen needs it.
