# JustVoice — what the app actually is

<!-- SPDX-License-Identifier: MIT -->

**Read this before designing, redesigning, or answering "how does X work".**

This is the app as the code has it, read directly on **2026-08-16**. It exists
because the same questions kept being re-derived from memory across compacts —
*what is a persona, what is cast, which engines clone, what does Cast edit* —
and answered wrongly each time, when the answers were sitting in the code and in
`CONCEPTS.md`.

**Rules for this file:**

1. Every claim here came from reading a file, and cites it. If you cannot cite
   it, do not add it.
2. **Nothing here is a design proposal.** Proposals live in
   `docs/plans/2026-08-15-voice-workflow-redesign.md`. This file is what exists.
3. If the code changes, change this in the same commit.
4. Related docs: `CONCEPTS.md` — the *design intent*, largely 2026-06-11, still
   accurate on the entity model (§2 below cross-checks it).
   `design-decisions.md` §3 — the JustWrite boundary.

---

## 1. The entity model — Voice · Persona · Cast

**This is the question that keeps getting re-litigated. It was decided
2026-06-11 (`CONCEPTS.md` §2) and the code still matches.**

> **There are only TWO entities. There is no "cast member" object, and none
> exists in storage.**

| | What it is | Where |
|---|---|---|
| **Voice** | **The instrument.** A preset, clone, blend, trained LoRA, import or designed voice. No character attached. | JSON manifests on disk — `storage/voices.py`, written by `atomic_write_json` |
| **Persona** | **The character.** A library object bundling everything that makes a character sound like themselves. Crosses projects and project kinds. | `personas` table, `database/models.py:83` |
| **Cast** | **Not a third thing.** The Studio surface listing the personas speaking *in this project*. | `project_personas` — a join table: `project_id · persona_id · role_label`. **Three columns, nothing else.** `database/models.py:199` |

**What lives on a Persona** (`database/models.py:83-135`) — the full list, because
"what is tuned on a persona" keeps getting asked:

| Field | What it does |
|---|---|
| `name`, `language`, `avatar_path` | identity |
| `voice_id` | the instrument. **Not** an FK — voices are JSON manifests, the column carries the id verbatim |
| `voice_instruct` | the spoken-delivery instruction. **The only text that reaches the synth.** Consumed as `delivery.instruct` by engines whose manifest declares an instruct field (Qwen3 CustomVoice, LuxTTS); the rest ignore it |
| `personality` | the character sheet. Drives Compose / Rewrite / smart-assign / the game-export sidecar. **Never reaches the synth.** Max 2000 chars at the API layer |
| `default_delivery` | JSON `Delivery` — speed, pitch, gain, etc. |
| `effects_chain` | JSON array of `{type, params}` |
| `engine_override` | force an engine regardless of the voice's default |
| `lexicon_id` | FK → `lexicons`, `ondelete=SET NULL` |
| `imported_from` / `imported_id` | provenance: `justwrite` · `manual` · `unreal` · `voice_profile`. **Re-import updates in place, never duplicates** |
| `is_builtin` | the auto-created Narrator. DELETE is refused; rename and voice reassignment still work |

`voice_instruct` and `personality` are **two fields, not three** — the
2026-08-15 split (Slice A, `f54c4ea`). One field feeding both the synth and the
LLM prompts was the bug.

### The consequences that matter for UI

- **A cast row IS a persona.** Editing voice or delivery on the Cast surface
  edits the persona, and therefore **follows it into every other project**.
  `CONCEPTS.md` §2 says the UI must make that visible (*"backed by persona ➜"*)
  so cross-project edits never surprise anyone. **That affordance does not exist
  in the app or the mock.**
- **One voice can back many personas**, with different delivery on each — *"Old
  Crow voices Tom Harlan in Stillwater and Guard Captain Hale in Emberfall"*
  (`CONCEPTS.md` §2). **This is how a shared way of speaking is expressed.** Two
  characters do not share a persona; they share a *voice*, and each persona
  tunes it differently.
- **Personas are library-level for persistence** — book 2 reuses book 1's cast
  and it sounds identical; the same persona can speak in an audiobook and a game.
- `PersonasView.vue` already implements this: cross-project filters
  (All / Used / Unused / By project), a **Used in** column, a cross-project usage
  panel, and an editor split into **"How they sound"** (voice · engine override ·
  lexicon override · spoken delivery) and **"How they're written"** (the
  character sheet, labelled *"it never changes the audio"*).

### The direction of assignment — do not get this backwards

> **A persona is assigned a voice. A cast is assigned a persona.**
> **The persona is the ONE place an output voice is defined** (user ruling,
> 2026-08-16).

Verified end to end:

- `Persona.voice_id` — the voice lives on the persona.
- `POST /v1/projects/{id}/cast` accepts **`persona_id` + `role_label`, nothing
  else** (`projects_api.py:599`). `ProjectPersona` has three columns.
- `assignVoice(personaId, voiceId)` in `StudioView.vue:1467` **PUTs the persona**
  with a new `voice_id`. It is a persona edit, wearing a project-scoped screen.

**There is no cast-level voice override in the code.** `grep` for
`voice_override` across `server/` and `src/` returns nothing, and no per-project
or per-block voice column exists (`Block` has `persona_id` only). So there is
nothing to delete — the rule already holds in the data.

**What breaks the "one place" rule is presentation, plus two real leftovers:**

1. **Studio · Cast is titled "Map people to voices"** and looks project-local
   while writing a library object. `CONCEPTS.md` §2 already required a *"backed
   by persona ➜"* affordance so the cross-project effect is visible. It does not
   exist.
2. **`RenderPreset.voice_id` is a column named `voice_id` that is a foreign key
   to `personas.id`** (`database/models.py:524`). It is read by nothing at
   render, and it is `ondelete="RESTRICT"`, so a dead misnamed field can block
   deleting a persona. This is a literal second place a "voice" appears to be
   set, and it is the naming collision behind much of the confusion.
3. **`Persona.engine_override`** is a second lever on what comes out, sitting
   beside `voice_id`.

### Where a voice is MADE — every door produces a `Voice`, never a persona

Verified across both API modules. **All five creation doors return a `Voice`,
and none of them takes or touches a persona:**

| Door | Endpoint | Returns |
|---|---|---|
| Clone from audio | `POST /v1/voices/clone` (`voices_api.py:132`) | `Voice` |
| Design from prose | `POST /v1/voices/design` (`voices_api.py:161`) | `Voice` |
| Import `.justvoice.zip` | `POST /v1/voices/import` (`voices_api.py:183`) | `Voice` |
| Blend | `POST /v1/voices/blend` (`phase5_api.py:101`) | `Voice` — needs ≥ 2 `source_voice_ids` |
| Train a LoRA | `POST /v1/train` (`phase5_api.py`) | a job; on completion `training_callback` **mints a `VoiceRecord`** with `source="trained"` and `adapter_path`, and returns `final_voice_id` (`phase5_api.py:295-330`) |

**A `VoiceRecord` carries no tuning at all** (`models.py:446`): `id · engine ·
source · name · language · gender · design_prompt · transcript · sample_count ·
blend_recipe · embedding · adapter_path · training_job_id · created_at ·
updated_at`. No speed, no pitch, no gain, no effects, no instruct — and the
`Voice` DTO returns even less. **So there is exactly ONE place tuning lives
today: the persona.** Any claim that the app has two competing tuning surfaces
is about a proposal, not about the code. (Whether a voice-level correction
*should* exist is argued in `2026-08-15-voice-workflow-redesign.md` §8.22 —
short version: it has to, because a clone's artifact is a conditioning input,
so a loudness correction can only be applied at render.)

So the app already answers *"where do you build a voice"*: **in the voice
library.** The persona then **selects** one — `PersonasView`'s "How they sound"
section is a `UiSelect` over existing voices, and Studio · Cast's library panel
is a picker. Nothing in the persona path creates an artifact.

One inconsistency worth knowing: `TrainingJob.persona_id` exists in the
SQLAlchemy model (`database/models.py:642`, CASCADE) while the live training
path keys off `voice_name` / `final_voice_id` in the JSON store
(`storage/training_jobs.py`). The produced artifact is a **Voice** either way.

### Vocabulary (ruled 2026-08-16, verified against the code)

> A **persona** is the entity. The **cast** is the personas in this project. A
> line's **speaker** is which persona says it. **Never "character"** — the word
> appears nowhere in the schema or the API.

Attribution words are real and distinct: `discover-speakers`,
`SpeakerCandidate`, `speaker_attribution`.

---

## 2. The data model — every table

`server/justvoice/database/models.py`. SQLite via SQLAlchemy is the primary
store; the only on-disk JSON is voice manifests and training-job records
(`storage/atomic.py`).

**Content spine:** `Project → Scene → Block`, generalised across kinds
(`CONCEPTS.md` §1) — audiobook: book/chapter/paragraph · game: title/quest/line ·
podcast: show/episode/segment.

| Table | Key columns | Notes |
|---|---|---|
| `projects` | `project_type` · `default_lexicon_id` · `mastering_preset` · provenance | `project_type` is the per-kind switch |
| `scenes` | `project_id` · `position` · `title` | a chapter / quest / episode |
| `blocks` | `scene_id` · `position` · `text` · **`persona_id`** · `direction` · `extraction_confidence` · `source` | the atomic unit of render + take versioning. `persona_id` is `SET NULL` |
| `project_personas` | `project_id` · `persona_id` · `role_label` | the cast. Nothing else |
| `personas` | see §1 | |
| `lexicons` / `lexicon_entries` | `scope` = global \| project \| persona; `notation` default `phonetic` | |
| `generations` | `block_id` · `persona_id` · `text` · `engine` · `seed` · `instruct` · `audio_path` · `status` · `ok_status` · `is_favorited` · `source` · `preset_id` · `effects_chain` · `cache_key` | one synth result |
| `takes` | `block_id` · `generation_id` · `source_take_id` · `is_default` · `label` | take versioning with lineage |
| `generation_versions` | `generation_id` · `source_version_id` · `audio_path` · `effects_chain` · `is_default` | effect re-renders of one generation |
| `render_jobs` / `render_job_blocks` | `scope` · `scope_ids_json` · counts · per-block `attempts` / `last_error` | resumable batch render |
| `stories` / `story_items` | `track` · `start_time_ms` · `trim_start_ms/end_ms` · `volume` | the podcast timeline |
| `channels` / `persona_channels` | `device_ids_json`; M2M to persona | per-persona output routing |
| `captures` | `audio_path` · `transcript` · `raw_transcript` · `refinement_flags_json` · `pinned` | dictation |
| `effect_presets` | `chain_json` · `is_builtin` · `sort_order` | named effect chains |
| `render_presets` | `voice_id` (**FK → personas, `ondelete=RESTRICT`**) · `delivery_json` · `effects_chain` · `master` · `lexicons_json` · `seed` · `cache_scope` | see §7 |
| `webhooks` | `events_json` · `secret_hash` · `log_tail_json` | |
| `speaker_corrections` | `project_id` · `text_snippet` · `character_id` → personas | fed back into attribution as `corrections` |
| `training_jobs` | `persona_id` · `engine` · `status` · sample counts · `loss_history_json` · `adapter_path` | LoRA training |
| `mcp_bindings` | `client_id` · `persona_id` · `default_engine` | dictation clients |
| `prefs` / `settings` | key/value; `settings` is a single row of JSON | renderer UI prefs + all operator knobs |

---

## 3. Engines — the capability matrix

Read from each `server/justvoice/engines/<id>/manifest.py`. **Cloning is not
Chatterbox-only.**

| Engine | Variants | Clones | Designs | Languages |
|---|---|---|---|---|
| **kokoro** | `kokoro-multi-lang-v1_0`, `kokoro-en-v0_19` | ✗ | ✗ | 9 declared |
| **chatterbox** | `chatterbox-multilingual-v2`, `chatterbox-turbo-v1` | **✓** | ✗ | 20+ |
| **qwen3** | `qwen3-cv-1.7b`, `qwen3-cv-0.6b` | ✗ | ✗ | `_QWEN_LANGS` |
| | `qwen3-base-1.7b`, `qwen3-base-0.6b` | **✓** | ✗ | |
| **luxtts** | `luxtts-base` | **✓** | ✗ | en |
| **moss_tts** | `moss-ttsd-v0` | **✓** | ✗ | en, zh |
| **tada** | `tada-3b` | **✓** | ✗ | 10 |
| **dia** | `dia2-1b`, `dia2-2b` | **✓** | ✗ | en |
| **whisper** | — | ✗ (ASR) | — | multilingual |

**Two traps:**

1. **`qwen3` declares `voice_cloning: True` at engine level as the union across
   its variants** (`qwen3/manifest.py:34-37`). The **per-variant flag is the
   truth** — CustomVoice does not clone, Base is clone-only. The file records a
   past bug where the engine-level flag made the catalog's Cloning filter
   believe CustomVoice cloned. **Any UI that offers cloning must branch on the
   variant, not the engine.**
2. **`voice_design` is `False` in every manifest today.** The whole design path
   is built and gated pending one download — `qwen3/manifest.py:38-42` says it
   *"flips back with the VoiceDesign variant."* So the door offers **Install**,
   not a dead ✗.

Chatterbox is **clone-only** — no preset voices, the host catalog stays empty
for it (`chatterbox/manifest.py:168`). Kokoro's list is **static, 54 presets,
unconditional** (`kokoro/manifest.py:66`) and `voices_api.py:51-62` never checks
which variant is installed.

---

## 4. Attribution — how "who speaks this line" is decided

`server/justvoice/extraction/pipeline.py`, `analyze_scene`, five stages:

1. **Segment** — `split_into_paragraphs` → `segment_paragraphs`, each tagged
   `dialogue` or `narration`.
2. **Deterministic anchors, before any LLM** — `find_anchors(segments,
   characters)` catches *"said Mara"* and propagates. Skipped if `propagate` off.
3. **Route pick** — `pick_route` resolves Auto by model size; each route carries
   a **confidence floor**.
4. **The LLM call — dialogue only.** Narration is never sent. Feature action
   `speaker_attribution.{route}`, variables `characters`, `corrections`,
   `paragraphs`. Streams, so long chapters show live tok/s.
5. **Assemble:**

| Case | Result |
|---|---|
| narration | `narrator`, confidence **1.0**, source `narration` — model never asked |
| dialogue **with** an anchor | **anchor wins**, confidence 1.0, source `tag` or `propagated`. The LLM's pick is kept as `llm_speaker` |
| dialogue, no anchor, above floor | the LLM's pick, source `llm` |
| dialogue, no anchor, **below floor** | demoted to `unknown`, source `floored`, `floored_from` records what it wanted |
| LLM returned fewer rows than lines | padded with `unknown` @ 0.4 |

**Five sources: `narration · tag · propagated · llm · floored`.** A line can be
unattributed for two different reasons — unsure, or never answered.

**Two separate endpoints, often confused:**

- `POST /v1/scenes/{id}/analyze` — attributes lines to personas **already in the
  cast**.
- `POST /v1/scenes/{id}/discover-speakers` — finds names in the prose that are
  **not** in the cast. `POST /v1/projects/{id}/personas/promote` turns candidates
  into personas and links them to the project.

**Discover lives inside the Script step today** — `studioSteps.js` says so
explicitly: *"The Script step is what CREATES the cast."*

**The prompt is starved.** `_resolve_cast` (`extraction_api.py:145-167`)
hardcodes role/gender/pronouns to `None` and aliases to `[]`;
`format_characters` (`extraction/prompts.py:82-97`) reads those empty fields. The
model receives **a bare list of `id` and `name`**. Test this before blaming a
model for poor attribution.

---

## 5. Render — the path and the cascade

- **Single line:** `POST /v1/blocks/{block_id}/render` (`takes_api.py`) and
  `POST /v1/generate`.
- **Chapter:** `POST /v1/render_chapter` (`render_chapter_api.py`).
- **Batch job:** `POST /v1/render_jobs`, with cancel/resume and per-block retry.
- **Core:** `render_core.py` — `render_line`, `probe_line_cached`,
  `_apply_lexicons`, `_resolve_engine_for_voice`,
  `resolve_audio_prompt_for_stored`, `_tags_supported`, `pcm_to_wav`,
  `concat_lines(silence_ms=250)`.

**The delivery cascade** (`render_chapter_api.py:168-170`): the **persona's**
chain, then the **preset's** on top — `resolve_chain(persona_effects,
preset_effects)`.

### What actually reaches the engine — the delivery matrix

`render_core.render_line` passes the whole `delivery` dict into
`engine.synthesize()`; each engine picks what it understands. **Three fields are
applied by the host and therefore work on every engine. Everything else is
engine-specific, and three fields are read by nothing at all.**

| Field | Applied by | Works on |
|---|---|---|
| `gain_db` | **host** — post-render `apply_gain_db`, clamped to [−24, +12] (`render_core.py:343-346`) | **every engine** |
| `pitch` | **host** — post-render `pitch_shift` effect, clamped ±12 st. **Wired 2026-08-17**; before that it was read by nobody | **every engine** |
| effects chain | **host** — `apply_effects_chain`, after gain and pitch | **every engine** |
| lexicons | **host** — `_apply_lexicons` substitutes text before synth | **every engine** |
| `speed` | engine | **kokoro** (`engine.py:159`), **luxtts** (`:105`) |
| `instruct` | engine | **qwen3 only** (`:155`) |
| `style_prompt` | engine | **qwen3 only** (`:162`) |
| `temperature` | engine | **chatterbox** (`:175`), **qwen3** (`:179`) |
| `engine.*` subdict | engine | chatterbox · qwen3 · luxtts · moss_tts · dia. **Fixed 2026-08-17** — `nest_engine_keys()` in `delivery_merge.py` moves flat capability keys into `engine` before the merge, so the UI's flat save now arrives nested |
| `seed` | host | `delivery.seed` wins over `req.seed` — a deliberate override |
| `emotion` | **host** | **Wired 2026-08-17** — composed into `instruct` alongside the persona's and the line's direction. Reaches engines that consume instruct; ignored by the rest, like any instruct |
| `pause_before` / `pause_after` | **host** | **Wired 2026-08-17** — `concat_lines` uses them per join. Blank = the project gap; a value replaces it; both sides of a join add. `0` is a deliberate butt-join |
| — | — | **`tada/engine.py` reads no delivery field at all** |

**Design consequence, and it is a big one:** tuning does **not** move cleanly with
a character across a recast. The **host-side half — gain, effects, lexicon —
always survives**. The **engine half — speed, instruct, style_prompt,
temperature — survives only if the new engine happens to honour it.** Cast a
persona from Kokoro to Chatterbox and its `speed` silently stops doing anything.

Any persona editor must therefore show, per field, whether the currently cast
voice's engine honours it. The machinery exists —
`GET /v1/engines/{id}/capabilities` and `capability_details.py`.

### The per-engine knob matrix — declaration ↔ adapter

`capability_details.py` is the config that drives every slider in the app. It
was audited against each adapter's call site on **2026-08-17**, with the
installed packages introspected where available (chatterbox, zipvoice,
qwen_tts are all in `engines/.shared-venv`). **Pinned by
`server/tests/test_engine_knob_wiring.py`, which fails in both directions —
a declared knob no adapter reads, or an override no UI can reach.**

| Capability row | Knobs (after the audit) | Verified against |
|---|---|---|
| `kokoro` | speed | `KPipeline(lang_code, voice, speed, split_pattern)` |
| `chatterbox` | exaggeration · cfg_weight · temperature · repetition_penalty · min_p · seed | `ChatterboxTTS.generate(text, repetition_penalty=1.2, min_p=0.05, top_p=1.0, audio_prompt_path, exaggeration=0.5, cfg_weight=0.5, temperature=0.8)` |
| `chatterbox-multilingual` | + top_p | `ChatterboxMultilingualTTS.generate(…, repetition_penalty=2.0, min_p=0.05, top_p=1.0)` |
| `chatterbox-turbo` | temperature · repetition_penalty · top_p · top_k · seed | `ChatterboxTurboTTS.generate(…, repetition_penalty=1.2, min_p=0.0, top_p=0.95, exaggeration=0.0, cfg_weight=0.0, temperature=0.8, top_k=1000, norm_loudness=True)` |
| `qwen3` | talker_temperature · talker_top_k · talker_top_p · repetition_penalty · seed | `generate_custom_voice(..., **kwargs)` / `generate_voice_clone(..., **kwargs)` → HF `generate` |
| `luxtts` | speed · num_steps · guidance_scale · max_ref_length · t_shift · seed | `generate_speech(text, encode_dict, num_steps=4, guidance_scale=3.0, t_shift=0.5, speed=1.0)` + `encode_prompt(prompt_audio, duration=5, rms=0.001)` |
| `dia` | temperature · cfg_scale · audio_top_k · cfg_filter_k · text_temperature · text_top_k · initial_padding · seed | `dia2/generation.py::GenerationConfig` — **Dia2 since 2026-08-17**; no top_p in this model |
| `moss-tts` | temperature · top_p · top_k · repetition_penalty · max_new_tokens · seed | `moss_tts/engine.py:111-115` |
| `tada` | seed only | `generate_from_text_and_prompt(text, prompt, language)` — takes nothing else |

**What the audit corrected**, all previously user-visible lies:

- **`min_p` and `top_p` (chatterbox)** — declared from the start, never
  forwarded. Both are real parameters with the declared defaults; the adapter
  now passes them.
- **`num_inference_steps` (luxtts)** — the adapter reads `num_steps`, so the
  slider never matched and steps were permanently 4. Declared key renamed.
- **`max_ref_length` (luxtts)** — not dead, **misplaced**: it is
  `encode_prompt`'s `duration`, not a `generate_speech` argument. Now wired.
- **`volume` (luxtts)** — not a parameter of anything. Removed.
- **`t_shift` (luxtts)** — declared as semitone pitch over −6…+6 default 0.0.
  Upstream: *"shift t to smaller ones if t_shift < 1.0"*, domain (0, 1.0],
  default 0.5 — the flow-matching schedule, **not pitch**. Relabelled
  "Timestep shift"; `pitch_native_st_range` removed, since it rested on that
  claim. **No engine transposes natively.**
- **`cfg_scale` / `speed_factor` (dia)** — the row described nari-labs'
  standalone class while the adapter drives HuggingFace's, whose kwarg is
  `guidance_scale` and which has no `speed_factor`. Names and defaults now
  mirror the call site; `max_new_tokens` was passed but undeclared.
- **`silence_duration` (moss)** — declared, never read. Removed. Its four real
  knobs were read but undeclared, so no UI could reach them.
- **`steps` / `noise_temperature` / `faithfulness` (tada)** — three sliders on
  an adapter that reads no delivery field at all. Removed rather than left
  decorative; TADA is not in the shared venv so its upstream surface could not
  be introspected. Re-add each only with the adapter change that passes it.
- **`repetition_penalty` (qwen3)** — declared, not read. Now forwarded.
- **`top_k` / `top_p` (chatterbox turbo)** — hardcoded 1000 / 0.95 in the
  adapter and unreachable. Now declared.
- **Turbo's `repetition_penalty` default** said 2.0, which is Multilingual's;
  Turbo's is 1.2, matching what the adapter passes.
- **`lookup()`** used `split("-")[0]`, so `chatterbox-turbo-v1` resolved to the
  **base** row — serving exaggeration/cfg_weight/min_p that Turbo defaults off,
  and hiding Turbo's paralinguistic tags. It now walks `-` suffixes one at a
  time, the rule `GenerateView.vue:lookupCapability` already used.

**Cache impact:** nesting changes `canonical_json(delivery)`, which is the
render cache key. Lines rendered before the fix will re-render once.

**Render refuses and names** rather than silently dropping
(`render_chapter_api.py:174-190`):

- *"N line(s) have no speaker: line 3 ("…") … Open Studio · Script and set one on
  each, or send them all to the narrator."*
- *"No voice is cast for X — assign one in Studio · Cast."*

**Mastering targets are exactly four** — `mastering.py:38`:
`acx · inaudio · podcast · youtube`. There is no "game asset" target.

**The synth scheduler** (`synth_scheduler.py`, shipped `3a5a23d`) is one worker
plus one pending pool, draining **engine-major**, with interactive singles
jumping the queue at line boundaries — the mechanism that prevents a model swap
per line. Seven callers. **Nothing in `src/` references it and no endpoint
exposes queue depth or the current engine.**

---

## 6. The surfaces — 18 routes, 25 views

`src/router/index.js`. Real routes:

`/home · /projects · /chapter · /lines · /studio · /stories · /generate ·
/captures · /voices · /personas · /lexicons · /effects · /presets · /ai ·
/importreview · /labs · /settings` (+ `/` → `/home`, `/overview` → `/home`,
`/engines` → `/ai?tab=speech-engines`, unknown → `/home`).

**Redirect-only paths** that set `sessionStorage` then land on a parent:
`/cache`, `/channels`, `/webhooks` → `/settings`; `/compare`, `/train`,
`/renderlab`, `/audio` → `/labs`; `/speakerlab` → `/ai?tab=features&action=speaker_attribution.guided`
(the Speaker Lab died in the 2026-08-06 parity batch).

| View | Lines | What it is |
|---|---|---|
| `StudioView` | **3132** | The four production steps. See below. |
| `SettingsView` | 2099 | Workspace focus · connection · headless access · tokens · data location · disk · server bind · cache · limits · local model paths · generation pipeline · training · validation thresholds · testing/danger zone |
| `ChapterView` | 1481 | The chapter **list** (columns **Chapter · Words · Est. audio · Script · Render**, filter chips, add/move/rename/delete, *Open in Studio ➜*) **and** the per-chapter block editor with takes (`＋ Generate first take`, set-default, regenerate, delete take) |
| `VoicesView` | 1302 | The voice library. Columns **Name · Gender · Type · Engine · Lang · Samples · Gens · Effects · Channel · Cast as**. Actions: Guess unknown genders · Import .justvoice.zip · Clone new voice · Train LoRA · Blend with… Plus the **voice inspector** behind a row interaction |
| `GenerateView` | 1282 | One-off synth: voice, text, seed + randomize, **delivery overlay**, insert tag, Rewrite, Compose, lexicon view, and a **history** of takes/favorites/retry |
| `ProjectsView` | 950 | Project list (**Project · Kind · Structure · Last opened**) + detail expansion with scenes (**# · Title · Blocks · Duration · Status**), `＋ Add personas`, *Open in Studio ➜* |
| `PersonasView` | 695 | The persona library — see §1 |
| `LexiconsView` | 632 | Pronunciation dictionaries |
| `HomeView` | 561 | Empty hero *"What are you making?"* · Continue/Resume card · live tasks · engine status **with VRAM** + Unload/Switch · recent generations with inline replay |
| `TrainView` | 460 | Queue a fine-tune (inside Labs) |
| `CapturesView` | 409 | Dictation captures, refined vs raw transcript, pin, retranscribe |
| `CompareView` | 358 | A/B two takes → metric deltas + verdict (inside Labs) |
| `RenderPresetsView` | 325 | **Name · Persona · Master target · Delivery** |
| `CacheView` | 310 | Total on disk · by scope · recent entries · clear |
| `RenderLabView` | 296 | Settings sweep (inside Labs) |
| `LinesView` | 292 | Game voicelines grid — **Line ID · Character · Text · Take**, Re-import CSV, Export VO zip |
| `AudioToolsView` | 261 | Analyze a WAV · apply a mastering target (inside Labs) |
| `ImportReviewView` | 236 | Post-import check — **Chapter · Lines · Words · Est. audio** |
| `WebhooksView` | 232 | Subscriptions |
| `EffectsView` | 222 | Effect-chain presets |
| `AudioChannelsView` | 172 | Output channels |
| `AiView` | 97 | The AI console (kit) — tabs incl. `features`, `speech-engines` |
| `LabsView` | 79 | Container for `compare · train · renderlab · audio` |
| `StoriesView` | 43 | The timeline — thin |

### StudioView's four steps

Order is canon in `src/views/studioSteps.js`, **pinned by a test**:

```
prose : script → cast → render → export
game  : cast → render → export          (no Script step at all)
```

*"PROSE KINDS START AT SCRIPT (ruling 12, 2026-08-15). The Script step is what
CREATES the cast … Cast-first opened a cast holding only the auto-created
Narrator, sent you to Script to populate it, and back again — a loop presented as
a line."* Game projects keep cast-first because their lines arrive with speakers
attached. **`StudioView.vue:257` still comments the order as `1 · Cast → 2 ·
Script` — that comment is stale; `studioSteps.js` is the truth.**

| Step | Subtitle in the tab strip | What it does |
|---|---|---|
| **Script** | *"Who speaks each line"* | Table **Speaker · Kind · Decided by · Text · Confidence**. `＋ Create personas & add to cast` promotes discovered speakers. Right-click → per-block Rewrite preview |
| **Cast** | *"Map people to voices"* | Persona cards + a **Voice library** panel (*"Picking voice for X"* — select a card, click a voice). Narrator card: *"The voice of everything that isn't spoken"*. Actions: `＋ Add persona` (from the library) · `Clear cast` (*"unassign voices from all N cast members. The personas stay — only the voice links go"*) · `Smart-assign` · Audition · Open Speech engines. Game kind shows a table instead: **NPC · Role · Voice** |
| **Render** | *"Batch render + mastering"* | Table **# · Cached · Render preset · Check**. Select unrendered / Select all · Render · Cancel · Retry · Play · **Run ACX QC** · Suggest |
| **Export** | *"Package + ACX checklist"* | Packaging (described in-code as a mock export screen) |

### Pinia stores

`api · activeProject · projects · personas · voices · engines · generation ·
takes · lexicons · server · ui · uiContext · onboarding · importDraft`
(+ two kit task tests). All API calls go through the store layer, not direct
`fetch` from components.

---

## 7. Known-dead and disconnected code

Verified 2026-08-15/16. **None of it is fixed.** Also filed in `TASKS.md`.

1. ~~**`Block.direction` is stored, editable, and never rendered.**~~ **FIXED
   2026-08-17.** `database/models.py:238` calls it *"Emotion/style hint passed
   through to the engine's instruct field"* — it now is exactly that.
   `render_chapter_api` composes **persona `voice_instruct` → `delivery.emotion`
   → this line's `direction`** into `delivery.instruct`, most specific last, and
   **appends rather than replaces**: the persona says who they are, the line
   says how this one is delivered. An explicit preset/request instruct still
   wins the base slot, and a lone hint passes through verbatim so a
   hand-written instruct is never reformatted. This also completes the
   **import** path — every adapter's emotion/style column lands in
   `Block.direction` (`projects_api._materialize_standard`) and stopped there.
2. ~~**Engine-private knobs never reach an engine.**~~ **FIXED 2026-08-17.**
   Engines read their knobs from the `delivery.engine` subdict
   (`qwen3/engine.py:154`, `chatterbox/engine.py:185-206`,
   `moss_tts/engine.py:114`) while `VoiceParamsModal.vue` saved the capability
   schema's keys **flat**, and nothing bridged the two — so exaggeration,
   cfg_weight, repetition_penalty, min_p, t_shift and the rest had never done
   anything at render. `nest_engine_keys()` in `delivery_merge.py` now
   normalises each tier before the merge, which also repairs deliveries
   already stored flat in `personas.default_delivery` and
   `render_presets.delivery_json`. `render_chapter_api`'s
   `Delivery.model_fields` filter keeps them, because `engine` is itself a
   declared field.
3. **Kokoro speaks English whatever the voice claims.** `kokoro/engine.py:107`
   sets `lang = "en-us" if lexicon else ""` once at load; `synth()` never touches
   language. Sara and Nicola (Italian) and every ja/zh/es/fr/hi/pt preset are
   phonemized as English.
4. **Four of the Voices table's columns are wired to nothing.** `GET /v1/voices`
   returns id · engine · source · name · language · gender · sample_url
   (`models.py:464-471`). **Effects**, **Channel**, **Samples** (`sample_count`
   is dropped by `_stored_to_dto`, `voices_api.py:32-40`) and **Gens**
   (`generation_count` — no such field anywhere) render "—", "Default" and "0"
   forever.
5. **`RenderPreset` has two dead fields and a live lock.** `voice_id` and
   `lexicons_json` are read by nothing at render. **`voice_id` is
   `ondelete="RESTRICT"` against `personas`** — a dead field that can block
   deleting a persona for a reason no screen can explain.
6. **The synth scheduler has no UI** — see §5.
7. **The analyze prompt gets id + name only** — see §4.
8. **ChapterView offers "Generate first take" on speaker-less blocks** and prints
   raw block UUIDs (`b0e22b69`) at the user — the render path refuses a block
   with no persona, so the button cannot work.
9. **`StudioView.vue:257`'s step-order comment is stale** — see §6.
10. ~~**`Delivery.pitch` is dead.**~~ **FIXED 2026-08-17.** No engine read it
    and the host never applied it, so every pitch slider in the app did
    nothing — while `pitch_post_process=True` on 8 of 9 engines advertised
    that the server could do it. `render_core` now applies it as a
    `pitch_shift` effect after gain, clamped to ±12 st, which makes the flag
    true everywhere.
11. ~~**`Delivery.emotion` never reaches a render.**~~ **FIXED 2026-08-17** —
    folded into the instruct composition (finding 1). The import path's own
    `emotion`/`style` column, which `projects_api.py:797` turns into a
    `direction`, now reaches the engine through that same route.
12. ~~**`Delivery.pause_before` / `pause_after` never reach a render.**~~
    **FIXED 2026-08-17.** `concat_lines` now takes the gap for each join from
    the previous line's `pause_after` plus the next line's `pause_before`,
    falling back to the project gap only when neither is set — so blank means
    "as the project" and `0` means a deliberate butt-join. The producer side
    was broken too: every import adapter parses `pause_after_ms`
    (`standard_schema.StandardLine`), and `_materialize_standard` dropped it
    instead of persisting it. It now rides on the block's metadata, so no
    schema change was needed.
13. **`tada/engine.py` reads no delivery field at all.** Still true — but its
    three fake sliders were removed on 2026-08-17, so nothing lies about it
    now. Seed still applies.
14. **The variant capability `lookup()` used `split("-")[0]`** — **FIXED
    2026-08-17**; it now walks `-` suffixes, matching the frontend.

Findings 1, 11 and 12 remain in the same class: **controls that write a value
no render path reads.** Before adding any new knob, check it against the
delivery matrix in §5 — and note that
`server/tests/test_engine_knob_wiring.py` now fails the build if a declared
knob has no adapter reader, or an adapter override has no declaration.

---

## 8. The five audiences, and what actually differs

`CLAUDE.md` and `CONCEPTS.md` §1. One engine pool, one voice library, one persona
library, one lexicon set. What differs is the import/export pipeline and the
per-kind surface:

- **Audiobook producers** — long-form narration, multi-persona casting,
  pronunciation discipline, ACX mastering, the JustWrite workflow. Import EPUB /
  DOCX / `.jw.json`; export chapter WAVs → M4B at ACX −20 LUFS.
- **Game developers** — Unreal, 50–500 NPC lines. **No Script step** — the CSV
  names speakers. Line-first grid, stable line IDs, per-line WAV + JSON sidecar,
  VO zip export.
- **Podcasters** — multi-track Stories timeline, paralinguistic tags, effects
  chain; −16 LUFS stereo.
- **Dictation** — global hotkey, system audio capture, MCP server. **Not
  project-shaped** — captures, not scenes.
- **Accessibility** — real-time TTS, screen-reader integration. Future.

**Persona creation depends on what the source file knows** (`CONCEPTS.md` §3):
`.jw.json` and game CSV and podcast markdown all create personas **at import**;
a bare EPUB/DOCX creates them **later**, via Script's discover pass. Dedup is by
`imported_from + imported_id` — re-import updates in place.

**Voice assignment has three paths by scale** (`CONCEPTS.md` §4): smart-assign
(one button proposes a whole cast) · card + library click (~5–15 personas) ·
per-row dropdown (game/podcast table scale, with *"▶ test line"* auditioning on a
real line from that persona's script).
