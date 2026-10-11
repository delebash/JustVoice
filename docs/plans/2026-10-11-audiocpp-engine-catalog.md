<!-- SPDX-License-Identifier: MIT -->
# Every audio.cpp model in JustVoice — the engine list from audio.cpp's own specs (plan, 2026-10-11)

Decided: TASKS "Build the engine list from audio.cpp's own model specs, plus a small curated
file" (the user, 2026-10-11: *"go ahead and complete the engine stuff so we have access to all
engines and all models and features of audio cpp … the goal is to be able to produce the best
consistant results"*) and "Offer the best models audio.cpp has, licence-labelled, not
licence-limited". Facts: RESEARCH §1 (the runtime), §1.5 (audio.cpp's own web UI), §10.6
(rounds 1–3).

## 1 · What it is

**What you see.** AI Settings → Speech engines lists every speech model audio.cpp has — 46
speech families at our base (v0.9.0), 49 at upstream's v0.9.1, 50 on its main — not the 8 we
wired by hand.
Each row says, before anything is downloaded:

- what it does: speaks preset voices · copies a voice from a clip · makes a voice from words ·
  takes direction (and how: written instruction, emotion words, tags);
- its languages, its download size, and the graphics memory it needs ("needs about 8 GB"),
  marked against this computer's card;
- its licence and audio.cpp's verdict on commercial use — **Yes · Conditional · No ·
  Unclear** — with the licence's own notes and link;
- audio.cpp's status for it: supported · community · experimental;
- **Tested by JustVoice** (with what we found, e.g. "acted 12 of 21 tries in a blind test") or
  **Not tested by JustVoice yet**;
- **Best for** — our notes, including per emotion once measured ("angry: every time").

You can filter and sort by each. A model whose commercial use isn't "Yes" asks you to accept its
licence once, before its first download — the way Pocket TTS asks for Kyutai's terms today.

**What you can do with it.** A downloaded model works everywhere a model is chosen today: the
Clone and Design pickers, a persona's model, Render's Model column and a line's "This line
only". Its settings come from its spec — numbers as sliders, choices as dropdowns, on/off as a
switch — on the persona page and in Render, like today's knobs.

**What stays ours.** A spec can't say how a line's emotion should reach the model — that is the
one thing we write per family, as data (which option carries it, in what words). A model
without it is offered but marked **can't be directed yet**. Everything we learn by testing —
tested, best for, per-emotion results, traps — lives in the same small file.

**Updating audio.cpp.** Our fork follows upstream; a new release brings its specs; one script
rebuilds the list; new models appear marked *Not tested by JustVoice yet*. No code per model.

## 2 · Where each fact comes from

| Fact | Source (audio.cpp, at the pinned tag) | Ships in the release? |
|---|---|---|
| family, name, description, status, tasks, languages, capabilities, typed options, packages (files, precision, default), download repo | `model_specs/<family>.json` — 101 specs (79 with `options`) | yes (`model_specs/` beside the server) |
| each model entry: task to register (`tts` / `clon` / `vdes` / `asr`…), `min_vram_gb` (113 of 144), a usage hint (70) | `webui/configs/models_catalog.json` | no (built into the server) |
| control labels, slider vs number, ranges, help text — fills in families whose spec lists no options (Qwen3, VoxCPM2, Chatterbox) | `webui/configs/model_params.json` (71 keys) | no |
| licence, commercial use (Yes/Conditional/No/Unclear), notes, link, checked date | `docs/model_licenses.md` | no |
| each file's size and hash at our pinned model revision | Hugging Face's tree listing of `audio-cpp/audio.cpp-gguf` at `MODEL_REVISION` | — |
| how direction reaches it; tested/best-for/per-emotion notes; friendly labels; hidden options; traps | **ours** — one small file per family | — |

So the list is **generated once per pin, and committed**: `scripts/audiocpp-catalog.js` reads
the pinned fork tag's four files and the Hugging Face listing and writes
`server/src/engines/audiocpp/catalog.json`. Why not read the specs at run time: the list must
show before the runtime is installed, three of the four files aren't in the release, sizes need
Hugging Face, and a committed file shows in review exactly what an update brings.

## 3 · Engines, models and capabilities

- **One engine per audio.cpp family**, id = the family (`cosyvoice3`, `index_tts2`,
  `fish_audio` …). The seven hand-wired engines keep their ids and manifests: `kokoro`,
  `kitten`, `pocket`, `qwen3`, `chatterbox` (+ Turbo), `voxcpm2`, `asr` — they hold measured
  fixes (split sizes, presets, 16-bit rows, warm-ups). The generated list skips the families
  they cover (`kokoro_tts kitten_tts pocket_tts qwen3_tts chatterbox chatterbox_turbo voxcpm2
  qwen3_asr`).
- **A model (variant) per catalog entry** — its package × task (Breeze: design and clone), plus
  the spec's 16-bit package as a "16-bit" row where one exists (the existing `sixteenBit`
  pattern). Entries with no download (`download_id` absent, 9 of 144) and non-GGUF packages
  (e.g. IndexTTS's MLX safetensors) are left out.
- **Capabilities from the spec:** `built_in_voices` → preset voices; `clone: speaker_reference`
  → copies a voice; `design: voice_design` → makes one from words; `reference_text` option →
  takes the clip's words; `style_control` / `emotion_control` → *can be directed* only once our
  file says how.
- **Generated engines plug into the existing manifest interface** (`EngineManifest`:
  ID, NAME, DESCRIPTION, LICENSE, KINDS, CAPABILITIES, VARIANTS, TERMS …) and capability rows
  (`EngineCapabilityDetail`), so the pickers that already read capability rows
  (`src/services/capabilities.js` `capableRows`) offer them with no screen change.
- Speech recognition families become `stt` engines the same way (transcription choices for
  dictation and read-back).

## 4 · Requests: one generic mapping, plus a family's own where it needs one

- **Generic** (`toSpeechRequest`'s new last branch): text; the seed (random when none, RESEARCH
  §1.2); `voice_ref` for a cloned voice; `reference_text` when the spec takes it and the voice
  has a transcript; `language` when the spec has a language option, in the form its enum lists;
  `options` = the persona's and the line's settings, **checked against the spec** (type, range,
  enum — anything else dropped, because most families ignore unknown options silently, RESEARCH
  §1.2).
- **Direction, as data** in the family's file — one of: an option carrying the words
  (`instruction` + `template_name: instruct` for CosyVoice3; `emotion_text` +
  `use_emotion_text` for IndexTTS), a text prefix (`(…)` for VoxCPM2), inline tags with a value
  map (Turbo), or none. One function applies it. The wording each takes is being checked against
  the authors' own docs and demos now (TASKS "Check our direction against each model's own
  claims"); its findings land in these files.
- The hand-wired families keep their branches. Round 3's CosyVoice3 and IndexTTS branches
  (test branch 1b5bff4) become data in their files.
- **Loading:** a generated model warms on its first line (as Chatterbox Multilingual does), so
  its memory is measured then; before that the catalog's `min_vram_gb` is shown, never booked.

## 5 · Settings from the spec

- Today's knob shape is numbers only (`KnobSpec`, `server/src/models.js:1062`). It gains a
  `type` — number · choice · switch · text — with `choices` for a choice.
- Shown: the spec's request options minus the ones the app sets itself (text, voice, clip,
  language, seed, the direction option, streaming and chunking); labels and ranges from
  `model_params.json` where it has them, else the spec's description; our file can hide or
  rename one. Session options (read at load) go on the model's row, as Qwen3's do today
  (`engines/audiocpp/runtime_options.js`).
- `DeliveryKnobs.vue` renders the new types with the kit's controls; a line's and a persona's
  saved settings keep each value's type (today `line_takes.js` `lineModels` makes every one a
  float).

## 6 · Licence label and the terms gate

- The label is audio.cpp's own words and column: **Commercial use: Yes · Conditional · No ·
  Unclear**, the licence name linked, its notes, the date audio.cpp checked it. It replaces
  `SpeechEnginesTab.vue`'s permissive-list guess (`PERMISSIVE_LICENSES`, line 534).
- A model that isn't "Yes" gets `TERMS` gating **downloads** (Pocket's gate today covers
  cloning: `TERMS.gates`, `slot.js:586`; the accept route `engines_api.js:265`; the dialog
  `engineTerms.js`). Accepting once per engine is recorded as today.

## 7 · Tested, best for, and per emotion

- Our file per family holds `tested` (date + where the record is, e.g. RESEARCH §10.6), `best_for`
  lines, and `emotions` — per JustVoice emotion (`EMOTION_VALUES`, `models.js:1245`: neutral,
  happy, sad, angry, fearful, whispered, shouted, sarcastic, contemptuous) one of *every time ·
  sometimes · not* with the run that measured it.
- The list shows them; nothing routes on them yet. **Routing lines by emotion** (your example:
  angry → one model, sad → another) is a later slice, after the "one person across engines?"
  test and the emotion table (TASKS "Check our direction…"). It needs one thing the app doesn't
  have: **a line can't switch model today** — it speaks on its persona's voice's model
  (`render_core.js:244` `_lineModel` → `voice_model.js`), and `line_models` holds per-model
  settings only (`line_takes.js:163`). Routing needs a per-line "speak on": the same clip on
  another model, as a copy of the voice (`POST /v1/voices/:id/copy`, how rounds 1–3 made theirs).

## 8 · Keeping audio.cpp current

Our fork is v0.9.0 + 22 commits. Upstream released **v0.9.1** on 2026-10-07 (60 commits, 11 new
specs; the speech ones KittenTTS 2, KugelAudio, LFM2-Audio; the rest recognition, audio
understanding and tools — IndexEcho, Audio Flamingo, OWSM, CrisperWhisper …) and main is 35
commits further (10 more specs, Voxtral 4B TTS the speech one). Updating = our 22 commits on
top of v0.9.1, our tests, a **jv.6 release** (your word — a release), the pin, a newer
`MODEL_REVISION` holding the new files, the script re-run.

## 9 · Beyond speech — the rest of audio.cpp

audio.cpp also does voice conversion (7 specs), audio cleanup and enhancement (14), source
separation (4), speech editing (5), sound effects (4), music (8), diarization, alignment, voice
activity. Each needs a place in the app — that is screen design, so each gets its own plan and a
mock (question 4). The engine list shows them under their own headings once they're wired.

## 10 · Standards — each piece

| Piece | Follows | Link |
|---|---|---|
| The data | audio.cpp's own spec format — "the target source of truth for model metadata, package layout, downloads, UI hints … runtime capabilities" | `../audio.cpp/docs/maintainers/model_specs.md` |
| Commercial-use words | audio.cpp's licence table, as-is | `../audio.cpp/docs/model_licenses.md` |
| Reading the licence table | `marked`'s lexer — already a dependency; it reads the table's 103 family rows (checked 2026-10-11) | [marked.js.org — The Lexer](https://marked.js.org/using_pro#lexer) |
| File sizes and hashes | the kit's Hugging Face tree listing (`_tree`), existing code | `../just-llm-runner/server/src/runner/models.js:136` |
| Generated engines | the manifest interface and discovery, existing code | `server/src/engines/manager.js:139, 153, 257` |
| Capability rows and pickers | `EngineCapabilityDetail` + `capableRows`, existing code | `server/src/models.js:1092`, `src/services/capabilities.js:22` |
| Requests | audio.cpp's `/v1/audio/speech` and its options, as each spec types them; the existing mapping | `../audio.cpp/docs/maintainers/model_specs.md` ("options"), `server/src/engines/audiocpp/slot.js:787` |
| Typed settings | the kit's `Ui*` controls (family rule) | `../just-llm-runner/ui/src/index.js` |
| Licence gate | Pocket's `TERMS`, existing code | `server/src/api/engines_api.js:95-281`, `src/services/engineTerms.js` |
| The script | the repo's `scripts/*.js` pattern | `scripts/audiocpp-dev.js` |
| Screen changes | a mock in the app first; `docs/dev/design-law.md` | CLAUDE.md, the mock rule |

**NOT STANDARD:** none found. The one judgement call — generating and committing
`catalog.json` rather than reading specs at run time — follows audio.cpp's files as they are;
§2 says why.

## 11 · Blast radius (greps, 2026-10-11)

```
## the registry — generated engines join here
server/src/engines/manager.js:139:export const MANIFEST_MODULES = new Map([
server/src/engines/manager.js:257:export function discoverEngines() {
server/src/engines/manager.js:271:    const mod = MANIFEST_MODULES.get(name);
server/src/engines/manager.js:1346:    this._manifests = self.discoverEngines();
## capability rows — generated rows join CAPABILITY_DETAILS's lookup
server/src/api/engines_api.js:19:import { CAPABILITY_DETAILS, lookup as lookupCapability } from "../engines/capability_details.js";
server/src/api/engines_api.js:334:    for (const [key, detail] of Object.entries(CAPABILITY_DETAILS)) {
server/src/persona_render.js:70:  const row = capabilityDetails.lookup(model);
server/src/render_core.js:256:  const row = capabilityDetails.lookup(model);
server/src/render_core.js:363:    const cap = capabilityDetails.lookup(model);
server/src/render_core.js:379:    const cap = capabilityDetails.lookup(model || engineId);
server/src/voice_model.js:84:export const _capability = (modelOrVariant) => capabilityDetails.lookup(modelOrVariant);
## request mapping — one caller
server/src/engines/audiocpp/slot.js:595:    const req = self.toSpeechRequest(this._row, body);
## knob shape — gains `type`
server/src/models.js:1062:export const KnobSpec = T.Object({
server/src/models.js:1103:  knobs: opt(T.Array(KnobSpec), []),
server/src/persona_render.js:98: * {key: KnobSpec}.
server/src/line_takes.js:163-185 (lineModels — coerces every line knob to a float; a choice,
  switch or text setting must keep its own type)
  renderer: src/components/DeliveryKnobs.vue, StudioRenderChapter.vue, PersonaEditorPage.vue,
  SettingsPage.vue, TtsProviderForm.vue, lab/AttributionConfigExtra.vue, the mock pages
## licence display — replaced by the label
src/components/SpeechEnginesTab.vue:534:const PERMISSIVE_LICENSES = new Set([...]);
src/components/SpeechEnginesTab.vue:946:  <span v-if="v.weights_license" class="ev-lic" ...
server/src/api/engines_api.js:85:    weights_license: manifest.weightsLicense,
server/src/engines/model_catalog.js:47:  weights_license: ...
server/src/models.js:960, 1151:  weights_license: opt(T.String(), ""),
## terms — `gates` gains "download"
server/src/api/engines_api.js:91, 97, 101, 272, 276
server/src/engines/audiocpp/slot.js:384-389, 585-586
server/src/engines/manager.js:296-308
src/services/engineTerms.js
## engine ids written into code — unchanged (they name the hand-wired engines), listed so a
## generated engine is never assumed to behave like one of them
src/components/QuickSetup.vue:70,76 · PersonaDesignMaker.vue:48,127 · PersonaCloneMaker.vue:159
  (preference orders over capability rows — new models appear after these)
src/components/PersonaBlendMaker.vue:55,170 · server/src/engines/blending.js:44-133 (Kokoro only)
server/src/voice_model.js:194,238,239,253,271 · src/services/voiceGender.js:63
src/pages/SettingsPage.vue:182,261 · src/stores/ui.js:26 · server/src/models.js:471 (Kokoro default)
server/src/api/engines_api.js:121 (VoxCPM2 transcript) · server/src/api/external_api.js:45,52
## tests that read the registry, rows or mapping (each re-run; counts that assume 7 engines fixed)
server/tests/{audiocpp_switch,audit_step5,cpu_placement,designed_voice_parity,emotion_wiring,
  engine_deprecation,engine_knob_wiring,engine_local_load,engine_manifests,japanese_dictionary,
  kokoro_blends,kokoro_ipa,os_gate,qwen3_reference_silence,runtime_life,runtime_update,
  split_and_calibration,turbo_cloning,variant_wiring,voice_model}.test.js
## the user doc
docs/engines.md — "The catalog" (131), "What each engine can be tuned with" (323), "Not available
  yet" (427), "Picking an engine…" (449, 471)
```

Data overwritten: none — `catalog.json` is new; settings (`engine_overrides`) gain keys only.

## 12 · Slices — each with how it's accepted

1. **The catalog script and `catalog.json`** — at the current pin (v0.9.0-jv.5). Accepted: a
   unit test that every generated family has a name, a task, a default model whose files exist
   in the Hugging Face listing, and a licence row; the file's recorded tag equals
   `release.js`'s pin.
2. **Generated engines, the generic request, direction as data** — CosyVoice3 and IndexTTS from
   round 3 as the first two family files. Accepted through the app (its own routes, the dev data
   folder): every generated speech family that fits 8 GB downloads, loads and speaks one line
   that reads back; the rest load on the CPU or are recorded as too big. Disk: the Q8 files add
   up to tens of GB — the run reports the total before it starts.
3. **Typed settings** — `KnobSpec.type`, `DeliveryKnobs.vue`. Accepted: unit tests on the
   option filter; one generated family's choice and switch reach the request.
4. **Speech engines: the label, filters, sort, tested / best for, memory fit, the download
   gate** — a mock in the app first, your look, then the real tab. Accepted: the gate, and the
   screenshot comparison the mock rule asks for.
5. **The user doc** — `docs/engines.md`'s catalog sections rewritten for a list we don't
   hand-write; how to read the label; "Not tested by JustVoice yet".
6. **audio.cpp v0.9.1** — our commits on top, tests, jv.6 (on your word), the pin, the script
   re-run: the 11 new families appear.

Later, each its own plan: per-emotion routing (after the emotion table), voice conversion and
cleanup, sound effects and music.

## 13 · Questions

1. The commercial-use words: audio.cpp's own — **Commercial use: Yes · Conditional · No ·
   Unclear**?
   Lean: yes — the table's maintainers keep them current, and they say exactly what you asked
   for ("easy for the user to know what it can be used for").
2. The terms gate: before the first **download** of any model that isn't "Yes"?
   Lean: yes, once per engine; Pocket keeps its cloning gate too.
3. Update to upstream v0.9.1 now (slice 6), and publish jv.6?
   Lean: yes, after slices 1–2 prove the list, so the update arrives as data. Main's newer
   models (Voxtral) at the next upstream release.
4. Beyond speech (§9): voice conversion and clip cleanup next, each with a mock; sound effects
   and music after?
   Lean: yes — conversion first, since "act, then convert" is one of the routes to consistent
   emotion.
5. Slice 2's test downloads: every speech family that fits 8 GB?
   Lean: yes, but in batches, deleting each batch's files after its line reads back, so the
   disk never holds more than ~20 GB of them at once.
