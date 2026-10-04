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

## 1. The entity model — Voice · Persona · Speaker · Cast

**Re-decided 2026-09-29** ("option a, go ahead and plan and code it" —
`docs/dev/TASKS.md`, *Speakers and personas become two things*; build plan
`docs/plans/2026-09-29-speakers-and-personas.md`). Until then one `Persona` row
was both the person in a book and their sound, and the cast was a join table.
That merge is gone:

| | What it is | Where |
|---|---|---|
| **Voice** | **The instrument.** A preset, clone, blend, import or designed voice. No person attached. | JSON manifests on disk — `storage/voices.py`, written by `atomic_write_json` |
| **Persona** | **A finished spoken voice** — a voice and its engine, plus speed, pitch, gain, spoken direction, effects, lexicon, and a short note on how it sounds. Library-level: plays any number of speakers, in any book and project kind. | `personas` table, `database/models.py:83` |
| **Speaker** | **A person in one book** — a name, the other names the text uses (*Also called*), and *Who they are*. Discover finds them, Script gives lines to them. Deleted with its book (`ondelete=CASCADE`). | `speakers` table, `database/models.py:198` |
| **Cast** | **Not a table.** Each speaker's persona — `speakers.persona_id` (`ondelete=SET NULL`, `database/models.py:218`). One persona can play many speakers. | the Studio step `components/StudioCast.vue` |

A line points at a speaker (`blocks.speaker_id`, `database/models.py:259`), and
the speaker at its persona. **Generations, lexicons, channels and MCP bindings
stay on the persona** — they belong to the voice.

**What lives on a Persona** (`database/models.py:83-129`) — the full list, because
"what is tuned on a persona" keeps getting asked:

| Field | What it does |
|---|---|
| `name`, `language`, `avatar_path` | identity. `name` is unique across the library (case and extra spaces aside) and never blank — `personas_api._persona_name` |
| `voice_id` | the instrument. **Not** an FK — voices are JSON manifests, the column carries the id verbatim |
| `voice_instruct` | the spoken-delivery instruction. **The only persona text that reaches the synth.** Composed into `delivery.instruct` by `persona_render.plan_line` and consumed by **Qwen3 CustomVoice**, VoiceDesign (after a designed voice's description) and **VoxCPM2** (clones too) — Qwen3 Base has no instruction input, and Kokoro, Kitten, Pocket and Chatterbox take none (§3b) |
| `note` | a short note on how it sounds (replaced `personality`, the character sheet, 2026-09-29). Read by Generate's Compose / Rewrite (`personas_api._require_persona_with_note` refuses without one) and by Smart-assign as the persona's `tone`. **Never reaches the synth** |
| `default_delivery` | JSON `PersonaDelivery` (2026-10-03) — speed, pitch, gain_db, pause_before/after for every model, and `models[<capability row id>]` = `{knobs, seed, emotion, register_tag}` kept per model. Validated against each model (`persona_render.check_delivery`) |
| `effects_chain` | JSON array of `{type, params}` |
| `lexicon_id` | FK → `lexicons`, `ondelete=SET NULL` — read on the lines of every speaker the persona plays, after the book's lexicon (`render_core.line_lexicons`) |
| `imported_from` / `imported_id` | provenance: `manual` · `voice_profile` (the Profile→Persona one-shot, deleted 2026-10-03). No import makes a persona any more |

**One resolver** (`persona_render.plan_line`, 2026-10-03): persona + line →
voice, model, text, language, delivery (shared values + that model's own,
direction composed most specific last), seed, effects, lexicons. Called by the
chapter render (`_resolve_scene_to_lines`), the single-block door
(`export_voicelines._render_block_production` — Lines ↻, takes, render jobs,
the game export), `POST /v1/personas/preview` (the editor, Cast ▶) and Generate
with a persona (and so MCP speak). The persona's `engine_override` left the
same day — nothing read it; the model comes from the voice (`voice_model.py`).

**What lives on a Speaker** (`database/models.py:198-228`): `project_id` ·
`name` · `aliases` (JSON — *Also called*) · `description` (*Who they are*, read by
the AI, never heard) · `persona_id` (the cast) · `role_label` (`"narrator"` or
null) · `imported_from` / `imported_id` (a re-import merges on them). API shape
`models.Speaker` also carries `persona_name` and `lines` (the speaker's line
count, `_speaker_helpers.speaker_line_counts`).

**The speaker API** — `api/speakers_api.py`, helpers in `api/_speaker_helpers.py`
(which replaced `_persona_helpers.py`):

| Route | What it does |
|---|---|
| `GET /v1/projects/{id}/speakers` | the book's speakers, most lines first |
| `POST /v1/projects/{id}/speakers` | add one (Cast's ＋ Add); 409 on a name the book has |
| `PATCH /v1/speakers/{id}` | name · aliases · description · `persona_id` (null = un-cast); a rename into a clash is 409 |
| `DELETE /v1/speakers/{id}` | remove from the book; its lines and remembered fixes lose the speaker; returns `{"deleted": true, "lines": n}` |
| `POST /v1/projects/{id}/speakers/uncast` | Clear cast — every speaker loses its persona, the speakers stay |
| `PUT /v1/projects/{id}/narrator` `{speaker_id}` | move the narrator role (one per book) and the `source == "narration"` lines of the old narrator (or of nobody) with it (`move_narration`) |
| `POST /v1/projects/{id}/narrator` | + Add Narrator: idempotent; a speaker called Narrator takes the role, else a new one is made, then unowned narration moves to it |
| `POST /v1/speakers/{id}/rewrite` | Script's *Rewrite in character* from the speaker's Who they are (`{{personality}}` in the `persona_rewrite` template); 400 when it is empty |
| `POST /v1/projects/{id}/speakers/promote` | Discover's ＋ Add (in `extraction_api.py`); `{name, description, aliases}` per candidate; a batch with a name the book has is refused whole (409) |

**Every new speaker is cast by exact name** (2026-09-29, "Every new speaker"):
`ensure_speaker` (`_speaker_helpers.py:90`) gives a new speaker the persona
`persona_named` finds — exactly one persona whose name matches (casefold, spaces
collapsed); two of that name match none. Used by Discover's promote, Cast's
＋ Add, + Add Narrator and every import (`projects_api._materialize_standard`,
which creates speakers only — never personas).

**Names are unique within a book — for speakers** (2026-09-29):
`same_name` + `refuse_same_name` (409, `_speaker_helpers.py:70`), checked on add,
rename and promote. Imports don't check — the book's people arrive as they are.
**Persona names are unique across the library** (2026-09-29):
`personas_api._persona_name` trims the name, refuses a blank one (400) and a name
another persona has (409), case and extra spaces aside — on create and rename.
`persona_named` still returns None for two older personas that share a name.

**The narrator** is the speaker whose `role_label` is `"narrator"` — the role
only, since 2026-09-30 (a speaker merely named "Narrator" used to count on the
server but not in Studio) — `_speaker_helpers.narrator_speaker_id`,
`StudioView.narratorSpeaker`. Any speaker can hold it — Studio Cast's per-card
"Narrator" checkbox calls the PUT above. **Nothing makes a narrator on its own**:
create makes none, and an import only gives the role to a book speaker called
Narrator (`adopt_book_narrator`, `_speaker_helpers.py:203`).

**Deleting** a persona un-casts every speaker it played (`SET NULL`); their lines
keep their speaker. Deleting a speaker leaves its lines with no speaker.
Deleting a book deletes its speakers.

### The consequences that matter for UI

- **Cast is a book-level edit.** Clicking a persona on Cast PATCHes
  `speakers.persona_id` (`StudioCast.vue` `assign()`); it never writes the
  persona. The persona's voice and settings are edited on its own page —
  Cast's *Edit their persona →* opens it (`/personas/<id>`), and it
  **follows the persona into every book that uses it**. The Personas page shows
  that reach as **Used by** (speaker — book) and a *Used by* panel with each
  speaker's line count.
- **One persona can play many speakers** ("Two speakers can share one persona —
  change it once and both change"), and **one voice can back many personas**,
  with different delivery on each (`CONCEPTS.md` §2's *"Old Crow voices Tom
  Harlan in Stillwater and Guard Captain Hale in Emberfall"*).
- **Personas are library-level for persistence** — book 2 casts book 1's
  personas and they sound identical; the same persona can speak in an audiobook
  and a game.
- `PersonasView.vue`: the list — cross-project filters (All / Used / Unused / By
  project), a **Used by** column, ticks + *Delete N selected*. A row opens the
  persona's page.
- `PersonaEditorView.vue` (2026-10-03, the redesign's P4): cards Persona (name,
  note) · Voice (kind radios filter the list; Can be directed / Model / Gender
  filters; ▶ Raw; Speaks) · Hear it (`POST /v1/personas/preview` with the unsaved
  draft; stock line; the model's tags via `SlashTagMenu`) · How it speaks (pace,
  pitch, gain, pauses; standing delivery + emotion, or Turbo's emotion + register
  tags, by `directed_by`; effects; lexicon) · Sampling (the model's own knobs,
  seed, Compare settings…) · Save; right column summary · This model · Used by.
  Model-specific values are stored per model under `default_delivery.models`.

### The direction of assignment — do not get this backwards

> **A persona is assigned a voice. A speaker is assigned a persona.**
> **The persona is the ONE place an output voice is defined** (user ruling,
> 2026-08-16, and again 2026-09-29: *"a persona is the actual spoken voice
> adjusted with pitch speed and other settings"*).

Verified end to end:

- `Persona.voice_id` — the voice lives on the persona.
- `speakers.persona_id` — the only link from a book to a voice. Render follows
  **line → speaker → persona → voice** (`_speaker_helpers.persona_for_block`,
  `:137`; `render_chapter_api` preloads the book's speakers, `:129`).

**There is no cast-level voice override in the code.** `grep` for
`voice_override` across `server/` and `src/` returns nothing; `Block` has
`speaker_id` only and `Speaker` has `persona_id` only. So there is nothing to
delete — the rule holds in the data.

**Nothing breaks the "one place" rule any more:** `Persona.engine_override`
(a second lever beside `voice_id` that nothing read) and `RenderPreset.voice_id`
(a misnamed foreign key onto personas that could block deleting one) both left
on 2026-10-03.

### Where a voice is MADE — every door produces a `Voice`, never a persona

Verified across both API modules. **All five creation doors return a `Voice`,
and none of them takes or touches a persona:**

| Door | Endpoint | Returns |
|---|---|---|
| Clone from audio | `POST /v1/voices/clone` (`voices_api.py:132`) | `Voice` |
| Design from prose | `POST /v1/voices/design` (`voices_api.py:161`) | `Voice` |
| Import `.justvoice.zip` | `POST /v1/voices/import` (`voices_api.py:183`) | `Voice` |
| Blend | `POST /v1/voices/blend` (`voices_api.py`) | `Voice` — needs ≥ 2 `source_voice_ids` |

**A `VoiceRecord` carries no tuning at all** (`models.py:446`): `id · engine ·
source · name · language · gender · design_prompt · transcript · sample_count ·
blend_recipe · embedding · created_at · updated_at`. No speed, no pitch, no gain, no effects, no instruct — and the
`Voice` DTO returns even less. **So there is exactly ONE place tuning lives
today: the persona.** Any claim that the app has two competing tuning surfaces
is about a proposal, not about the code. (Whether a voice-level correction
*should* exist is argued in `2026-08-15-voice-workflow-redesign.md` §8.22 —
short version: it has to, because a clone's artifact is a conditioning input,
so a loudness correction can only be applied at render.)

So the app already answers *"where do you build a voice"*: **in the voice
library.** The persona then **selects** one — `PersonasView`'s "How they sound"
section is a `UiSelect` over existing voices. Studio · Cast's right-hand panel
lists **personas**, never voices (the voice list there died 2026-09-29). Nothing
in the persona path creates an artifact.

Voice training (`POST /v1/train`, a LoRA fine-tune that minted a `lora`
voice) was removed on 2026-10-02 — its PyTorch environments went with the
speech-runtime switch, and the runtime cannot render a trained voice.

### Vocabulary (ruled 2026-08-16, verified against the code)

> A **persona** is a finished voice. A **speaker** is a person in one book
> (`speakers`). The **cast** is each speaker's persona. A line's speaker is
> `blocks.speaker_id`. **Never "character"** on a screen or in a doc — for any
> project kind, no "NPCs", no "Hosts" (re-ruled 2026-09-29, *"speakers
> everythwere"*).

The word survives only where it names an outside format or a prompt variable:
the import standard schema (`characters`, `character_id`, `StandardCharacter`),
the CSV `character` column, JustWrite's `book.json`, the Smart-assign request's
`characters` list, the analyze-text / discover-speakers request fields
(`characters`, `known_characters`), and the words the prompts themselves say
to the model ("Known characters:", "Characters in this scene:"). The prompt
PLACEHOLDERS are `{{speakers}}`, `{{known_speakers}}` and Smart-assign's
`{{personas}}` (2026-09-29), which the Lab shows as its *Speakers* / *Known
speakers* / *Personas* boxes — renamed without changing one byte the model
reads (`test_renamed_placeholders_keep_every_word_the_model_reads`).
Attribution words are real and distinct: `discover-speakers`,
`SpeakerCandidate`, `speaker_attribution`.

---

## 2. The data model — every table

`server/justvoice/database/models.py`. SQLite via SQLAlchemy is the primary
store; the only on-disk JSON is voice manifests (`storage/atomic.py`).

**Content spine:** `Project → Scene → Block`, generalised across kinds
(`CONCEPTS.md` §1) — audiobook: book/chapter/paragraph · game: title/quest/line ·
podcast: show/episode/segment.

| Table | Key columns | Notes |
|---|---|---|
| `projects` | `project_type` · `default_lexicon_id` · `mastering_preset` · provenance | `project_type` is the per-kind switch. `default_lexicon_id` is Overview's **Pronunciation lexicon** — read on every line of the book (§5, "Which lexicons a line is read with") |
| `scenes` | `project_id` · `position` · `title` | a chapter / quest / episode |
| `blocks` | `scene_id` · `position` · `text` · **`speaker_id`** · `direction` · `extraction_confidence` · `source` | the atomic unit of render + take versioning. `speaker_id` → speakers, `SET NULL` |
| `speakers` | `project_id` · `name` · `aliases` · `description` · `persona_id` · `role_label` · `imported_from` / `imported_id` | the people in one book; `persona_id` is the cast (`SET NULL`). See §1 |
| `personas` | see §1 | |
| `lexicons` / `lexicon_entries` | `scope` = global \| project \| persona; `notation` default `phonetic` | |
| `generations` | `block_id` · `persona_id` · `text` · `engine` · `seed` · `instruct` · `audio_path` · `status` · `ok_status` · `is_favorited` · `source` · `effects_chain` · `cache_key` | one synth result |
| `takes` | `block_id` · `generation_id` · `source_take_id` · `is_default` · `label` | take versioning with lineage |
| `generation_versions` | `generation_id` · `source_version_id` · `audio_path` · `effects_chain` · `is_default` | effect re-renders of one generation |
| `render_jobs` / `render_job_blocks` | `scope` · `scope_ids_json` · counts · per-block `attempts` / `last_error` | resumable batch render |
| `stories` / `story_items` | `track` · `start_time_ms` · `trim_start_ms/end_ms` · `volume` | the podcast timeline |
| `channels` / `persona_channels` | `device_ids_json`; M2M to persona | per-persona output routing |
| `captures` | `audio_path` · `transcript` · `raw_transcript` · `refinement_flags_json` · `pinned` | dictation |
| `effect_presets` | `chain_json` · `is_builtin` · `sort_order` | named effect chains |
| `webhooks` | `events_json` · `secret_hash` · `log_tail_json` | |
| `speaker_corrections` | `project_id` · `text_snippet` · `speaker_id` → speakers, `SET NULL` (`persona_id` until 2026-09-29, `character_id` until 2026-08-22) | fed back into attribution as `corrections` |
| `mcp_bindings` | `client_id` · `persona_id` · `default_engine` | dictation clients |
| `prefs` / `settings` | key/value; `settings` is a single row of JSON | renderer UI prefs + all operator knobs |

---

## 3. Engines — the capability matrix

Read from each `server/justvoice/engines/<id>/manifest.py`. Since the
2026-10-01 switch (`docs/plans/2026-10-01-audiocpp-switch.md`) an engine is a
**catalog**: its manifest names the model files and how the audio.cpp runtime
loads them; there is no per-engine program. **Cloning is not Chatterbox-only.**

### 3a. What each MODEL is — every shipped variant

Every variant is one pinned file (two for speech recognition) in
`audio-cpp/audio.cpp-gguf` at the commit in `engines/audiocpp/release.py`
(`MODEL_REPO` / `MODEL_REVISION`) — except `qwen3-cv-0.6b-q8`, our own conversion,
pinned in `engines/qwen3/manifest.py` (`CV_06_REPO` / `CV_06_REVISION`, passed through
`model_source(repo=, revision=)`; gap 4, `docs/plans/2026-10-02-gap-4-customvoice-0.6b.md`).
**Every 8-bit row has a 16-bit sibling** (gap 9) built by `release.sixteen_bit(row, path,
size, dtype=…)`: id `-q8` → `-bf16` (`-f16` for Chatterbox and speech recognition, which
audio.cpp ships as f16), name "(…, 16-bit)", no `cpu_realtime` of its own, same capability
row by the suffix walk; the 8-bit rows stay `DEFAULT_VARIANT_ID`. KittenTTS has none (its one
file is unquantized). The table below lists the 8-bit rows.
Sizes are the summed real bytes. **The
variant is the unit, never the engine** — every trap below is a case of the
engine-level flag disagreeing with the variant that loads.

| Engine | Variant | audio.cpp family · task | Clones | Presets | Designs | Langs | Download |
|---|---|---|---|---|---|---|---|
| **kokoro** | `kokoro-82m-q8` | `kokoro_tts` · tts | ✗ | **49** | ✗ | 8 | 190 MB |
| **qwen3** | `qwen3-cv-1.7b-q8` / `qwen3-cv-0.6b-q8` | `qwen3_tts` · tts | ✗ | **9** | ✗ | 10 | 2.82 / 1.71 GB |
| | `qwen3-base-1.7b-q8` / `qwen3-base-0.6b-q8` | `qwen3_tts` · tts (`clone: True`) | **✓** | 0 | ✗ | 10 | 2.70 / 1.99 GB |
| | `qwen3-vd-1.7b-q8` | `qwen3_tts` · vdes | ✗ | 0 | **✓** | 10 | 2.82 GB |
| **chatterbox** | `chatterbox-multilingual-v2-q8` | `chatterbox` · clon | **✓** | 0 | ✗ | **19** | 2.09 GB |
| **asr** (STT) | `qwen3-asr-1.7b-q8` + companion `::aligner` (`qwen3_forced_aligner` · align) | `qwen3_asr` · asr | — | — | — | 30 | 3.60 GB |
| **voxcpm2** | `voxcpm2-q8` | `voxcpm2` · tts (its only task in v0.9.0) | **✓** | 0 | **✓** | 30 | 2.96 GB |

Kokoro's five Japanese voices are filtered out of `STATIC_VOICES` (the
runtime's Kokoro needs MeCab/UniDic for Japanese). The variant ids are new at
the switch; engine ids and voice ids are unchanged.

### 3b. What each engine DOES with a delivery — the honest ✓ grid

✓ = `engines/audiocpp/slot.py: to_speech_request` sends it. Blank = accepted,
merged, stored and dropped. `test_engine_knob_wiring.py` drives every declared
knob through the mapping and fails if one doesn't come out the other side.

| Field | kokoro | kitten | pocket | chatterbox | qwen3-CV | qwen3-Base | qwen3-VD |
|---|---|---|---|---|---|---|---|
| `speed` | **✓** `speed` | **✓** `speed` | | | | | |
| `instruct` (prose) | | | | | **✓** `options.instruct` | | **✓** `instructions` (the description) |
| `emotion` | | | | | **✓ prose** | | **✓ prose** |
| `temperature` | | | | ✓ `options.temperature` | ✓ | ✓ | ✓ |
| `engine.*` knobs | | | | `exaggeration`, `cfg_weight`→`guidance_scale`, `repetition_penalty`, `top_p` | `talker_top_k`/`_top_p`→`top_k`/`top_p`, `repetition_penalty` | same | same |
| `seed` | ✓ | sent, does not repeat (not offered) | ✓ | ✓ | ✓ | ✓ | ✓ |
| voice | `voice` (the id) | `voice` = `AUDIOCPP_VOICE[id]` (Bella…) | `voice` = `AUDIOCPP_VOICE[id]` (alba…) | | `options.speaker` | | |
| reference clip | | | ✓ `voice_ref` on the `tts` task (its `clon` task refuses); gated on TERMS | **required** `voice_ref` | **refuses** | **required** `voice_ref` | |
| clip transcript | | | | | | ✓ `reference_text` (not with `xvector_only`) | |
| language | voice's code (`KOKORO_LANGUAGE`) | English only | none — the model IS the language; another refuses by name | code | **name** (`QWEN_LANGUAGE`; `en` is rejected) | name | name |
| `voice_vector` (blend) | **refuses** (422, named gap) | | | | | | |

**voxcpm2** (gap 9, not a column above — its mapping is unlike the others): a clip →
`voice_ref` (+ `reference_text`, which v0.9.0's server turns into the `reference_text`
option but never pairs with prompt audio, so VoxCPM2 ignores it — a change for our copy of
audio.cpp); `instruct` — a designed voice's description, a persona's spoken delivery, a line's
direction — rides a `(…)` prefix on `input` (audio.cpp splits it off, the model is steered by
it); a line's OWN parentheses become ` — ` dashes, because VoxCPM2 speaks nothing inside
brackets; `cfg_value` → `options.guidance_scale`, `inference_timesteps` →
`options.num_inference_steps`, `seed`. Neither a clip nor a description → refused by name.
48 kHz output — `concat_lines` brings a chapter's lines to its highest rate (`_conform_pcm`).

Everything NOT in that grid — `gain_db`, `pitch`, the effects chain, lexicons,
`pause_before`/`pause_after` — is host-side and works on **all** of them, and so
does `speed` on the engines the grid leaves blank (the server stretches). See
§5's delivery matrix for where each is applied. Same seed + text + settings →
the same audio on Kokoro, Qwen3 and Chatterbox (measured 2026-10-01) and Pocket
TTS (2026-10-02); not on KittenTTS.

Three facts this grid exists to keep visible:

- **`speed` reaches two models; the server paces the rest.** Kokoro and
  KittenTTS take it (capability row `speed_native=True`); for every other
  engine `render_core.apply_line_delivery` time-stretches the finished line
  (`audio/dsp.time_stretch`, Signalsmith, pitch kept; 0.5–2.0×). Gap 8 of the
  switch plan, built 2026-10-02 — `docs/plans/2026-10-02-gap-8-speed.md`.
- **Prose direction reaches the two checkpoints that cannot clone.** Qwen3 Base
  has no instruction input. "Direct in words" and "use this speaker's cloned
  voice" are a choice today; a LoRA on Base was the way to have both, and
  voice training was removed on 2026-10-02.
- **Wrong-family requests refuse by name** instead of rendering something else
  — a clip on CustomVoice, no clip on Base or Chatterbox, no description on
  VoiceDesign (`AudioCppError`, surfaced as the load/synth error).

### 3c. Inline tags — none on the runtime

No capability row declares `inline_tags` and no manifest claims
`paralinguistic_tags` (pinned by `test_designed_voice_parity.py`), so
`render_core.performable_text` strips every bracket tag before any engine sees
it. Chatterbox Turbo's 19 tags and its emotion `value_map` return with Turbo
cloning (switch plan §5); the compilation path (`render_core._apply_emotion_tag`)
stays, tested against Turbo's set written out in `test_emotion_wiring.py`.

**Traps:**

1. **`qwen3` declares `voice_cloning: True` at engine level as the union across
   its variants.** The **per-variant flag is the truth** — CustomVoice does not
   clone, Base is clone-only, VoiceDesign designs. **Any UI that offers
   cloning must branch on the variant, not the engine.**
2. **`lookup()` walks `-` suffixes** — `chatterbox-multilingual-v2-q8` reaches
   `chatterbox-multilingual`, `qwen3-base-1.7b-q8` reaches `qwen3-base`. A
   variant whose id can't reach a row fails
   `test_every_manifest_variant_resolves_to_a_row`.

### 3d. Which engines run on which OS — and where that is enforced

Every manifest declares `SUPPORTED_OSES` explicitly (`test_os_gate.py` fails
if one leans on the default), and since the switch all four declare all three
OSes: the runtime ships a build for each (`release.binaries()`). The gate is
still **`install_engine()`** (`manager.py`) — the first thing it does, before
any install work, raising `InstallError` naming the host OS and the declared
list. `EngineInfo.supported_on_this_os` carries the verdict to the client
(computed server-side — the renderer may be a browser on another machine);
`SpeechEnginesTab.vue:osBlocked()` reads it.

### 3e. The speech runtime — install, process, slots, state

**One audio.cpp server runs every model** (`server/justvoice/engines/audiocpp/`;
it has no `manifest.py`, so discovery skips it). `EngineManifest.isolation`
answers `"audiocpp"` for every engine; `uses_audiocpp` is true when every
variant row carries an `audiocpp` block.

| Piece | Where | What it does |
|---|---|---|
| pinned release | `release.py` | `TAG` (`v0.9.0`), the `BinaryAsset` rows per platform/GPU (Windows cuda12 + cudart 12.4, cuda13 + cudart 13.3, vulkan, cpu; Linux vulkan, cpu; macOS metal), `MODEL_REPO`/`MODEL_REVISION`, `model_source()` |
| install | `runtime.install()` → kit `llm_runner.runner.binary.acquire_runtime` | staged download → launch-verify (`--no-ui --max-loaded-models 0 --version`) → atomic swap into `<engines_runtime_root>/audiocpp/<tag>/<gpu>/`; `installed_exe()` is cached, `forget_installed()` drops it |
| eSpeak NG | `espeak.py` | fetches the `espeakng-loader` 0.2.4 wheel for this platform from PyPI, checks its pinned sha256, unpacks the library + `espeak-ng-data` into `<root>/audiocpp/espeak-ng-0.2.4/`; its paths ride Kokoro's `session_options` |
| backend choice | `runtime.configured_backend()/configured_gpu()` ← `settings.engines.speech_runtime` | `auto` = `select_runtime_asset` (the kit's GPU preference; cuda12 vs cuda13 by compute capability via `concrete_gpu`); a pinned backend that isn't installed reads as not installed |
| the processes | `AudioCppServer.ensure()`, one per placement (`runtime.get_server("gpu" \| "cpu")`) | writes `<data_dir>/engines-runtime-config/audiocpp-server.json` — or `audiocpp-server-cpu.json` for the CPU process, the same build with `backend: cpu` at `speech_runtime.cpu_threads` (0 = physical cores) — (`lazy_load: true`, `max_loaded_models: 0`, every on-disk variant + its companions as `<id>::<role>`), restarts when that signature changes, spawns through the kit's `spawn_child` (Windows kill-on-close Job Object + virus-scanner retry) with `JUSTVOICE_SERVER_PID` set, `--no-ui`, log `<data_dir>/logs/audiocpp-server[-cpu].log`. A CPU-build runtime has only the CPU one (`slot.effective_placement`) |
| a slot | `slot.AudioCppSlot(manifest, placement)` (`manager._new_slot`) | answers the manager's old engine-process calls against its placement's process: `/load` (model on disk? then warm it — audio.cpp is lazy), `/synth` (refuses a Pocket TTS reference clip with 403 `terms_required` until the manifest TERMS are accepted), `/transcribe`, `/align`, `terminate` = `unload_models` |
| the API | `api/speech_runtime_api.py` | `GET /v1/speech-runtime` (release, build, backend setting, builds for this OS, GPUs, running/pid); `PUT` saves backend/gpu, unloads the speech slots, stops the server |

**Install = the runtime, once.** `install_engine()` (any engine) →
`_install_audiocpp_runtime()`: runtime, then eSpeak NG. Models are separate:
`installer.spawn_prefetch` → `speech_cache.fetch_hf_variant` (pinned files,
plain layout), and a cold `manager.load` fetches a missing variant first
(`_ensure_variant_local`). `manager.uninstall()` deletes the engine's
speech-cache folder and raises `InstallError` (409 at the API) if a file
survives — Windows won't delete a file the runtime holds open.

**Source and state are different roots.** `ENGINES_DIR` is the catalog source
(read-only when frozen); `engines_runtime_root()` is mutable state —
`ENGINES_DIR` unfrozen (so the runtime lands inside `engines/audiocpp/`,
gitignored), `<data_dir>/engines-runtime` frozen.

**Placement — the graphics card or the CPU, per model** (2026-10-02,
`docs/plans/2026-10-02-cpu-placement.md` §8). `manager.placement_for(m, kind,
variant)` → (`"gpu"` | `"cpu"`, the reason the row says, unload-the-AI-model?):
a CPU-build runtime → cpu; the user's `engine_overrides[id].placements[variant]`
→ that; else Auto — gpu when no un-slept, unpinned `llm` reservation is on the
card (`_ai_model_on_card`) or the variant's newest measured `load` footprint
fits `_free_card_mb`; else cpu when `cpu_speed` (newest `source="speed"`,
`backend="cpu"` row on this machine, else the manifest variant's `cpu_realtime`
reference) ≥ `speech_runtime.cpu_min_realtime`; else gpu, and when the size was
never measured `_unload_ai_model` runs `make_room(total, protected tts/stt)`
first (the kit's eviction event → the app's toast). `load()` resolves it before
anything moves, reloads a loaded model whose place changed, and records the
reason (`placement_reason_for`); `synth`/`transcribe` on a CPU slot record the
first real-time factor after each load (`_record_cpu_speed`, kit column
`realtime_x`). The device is then `cpu` for a CPU placement, else
`_resolve_device` = `backend_of(installed_exe())`; `_books_memory` books VRAM for
anything but `cpu`.

**Memory: each kind books its own share.** Speech and speech-recognition models
live in ONE process, so the per-PID-tree probe sees both; the second kind's
booking is the measurement less what the other kind in that pid already booked
(`manager._own_share_mb`), so the first model is never counted twice.

**Alignment quirk.** audio.cpp v0.9.0's `/v1/audio/alignments` converts sample
positions to seconds with the INPUT rate after resampling to 16 kHz, so a
24 kHz render came back at 2/3 of its real word times; `slot.as_16k_mono`
sends 16 kHz mono so the seconds are right (measured 2026-10-01).

**The runtime never outlives its server.** On Windows the kill-on-close Job
Object ends it with the server however the server dies (pinned with real
processes in `test_engine_lifetime.py`). `engines/leftovers.py` finds this
install's runtime processes (argv[0] under the runtime folder) whose server is
gone — `JUSTVOICE_SERVER_PID` from the environment, else the parent — measures
them with the kit's ONE whole-machine `gpu_processes` query, and stops them;
`serve.py` runs it once before uvicorn starts, and `GET`/`POST
/v1/engines/leftovers[/stop]` serve the boot splash's **Stop them and retry**
(`LeftoverEnginesHelp.vue` in the kit `BootModelLoad`'s `#failed` slot).
`POST /v1/shutdown` (loopback only, `api/system_api.py`) runs
`shutdown_manager()` — unload every slot, stop the runtime — then sets the
uvicorn `Server.should_exit` that `serve.py` parks on `app.state`; the Tauri
shell's `stop_child()` calls it on every close/stop/restart and hard-kills only
when it doesn't answer. It carries no token, so `app.py` passes
`loopback_open_paths=("/v1/shutdown",)` to the kit's `BearerAuthMiddleware`.

**Dev tools:** `server/scripts/harvest_revisions.py` prints the current commit
sha for every HF source, for pinning. (`npm run check:engines`, the venv drift
checker, went with the venvs.)

---

## 4. Attribution — how "who speaks this line" is decided

`server/justvoice/extraction/pipeline.py`, `analyze_scene`, five stages:

1. **Segment** — `split_into_paragraphs` → `segment_paragraphs`, each tagged
   `dialogue` or `narration`, in one of four speech-mark styles
   (`segmentation.SPEECH_MARKS`: double · single · guillemets · german,
   2026-09-30). The project's `metadata.speech_marks` picks one; Auto (or
   unset) is `detect_marks` — the style whose mark opens the most paragraphs'
   first speech — resolved per chapter by `extraction_api._analysis_input`,
   and passed to Discover's line counts and Script's flags too. Single mode
   opens only at a word's start (never on an elision) and closes only where no
   letter follows. A mark that opens and never closes is speech to the
   paragraph's end — how a speech over several paragraphs is written.
   **An analyzed chapter edited since** (no `source_text` — a text edit, add,
   delete, split or merge dropped it) is not segmented at all:
   `_lines_to_keep` → `segmentation.segments_from_lines` hands the pipeline its
   lines as they stand (`analyze_scene(segments=…)`), neighbours of one
   `paragraph_idx` read as one paragraph so anchors still work, and
   `_persist_attribution(line_ids=…)` writes one row per line in place and
   stores no text (lines changed mid-run → 409, nothing saved). Joining the
   lines back up (the old path) made every line its own paragraph and lost
   every anchor.
2. **Deterministic anchors, before any LLM** — `find_anchors(segments,
   characters)` catches *"said Mara"* and propagates. Skipped if `propagate` off.
   Each `Anchor` carries the book's matched `words` ("said Mara"); a propagated
   one carries its tag's.
3. **Route pick** — `pick_route` resolves Auto by model size; each route carries
   a **confidence floor**.
4. **The LLM call — dialogue only.** Narration is never sent. Feature action
   `speaker_attribution.{route}`, variables `characters`, `corrections`,
   `paragraphs`. Streams, so long chapters show live tok/s.
5. **Assemble:**

| Case | Result |
|---|---|
| narration | `narrator`, confidence **1.0**, source `narration` — model never asked |
| dialogue **with** an anchor | **anchor wins**, confidence 1.0, source `tag` or `propagated`. The LLM's pick is kept as `llm_speaker`, the book's words as `anchor_words` |
| dialogue, no anchor, above floor | the LLM's pick, source `llm` |
| dialogue, no anchor, **below floor** | demoted to `unknown`, source `floored`, `floored_from` records what it wanted |
| LLM returned fewer rows than lines | padded with `unknown` @ 0.4 |

**Five sources: `narration · tag · propagated · llm · floored`.** A line can be
unattributed for two different reasons — unsure, or never answered.

**What a run writes** (`extraction_api._persist_attribution`): the scene's
metadata gets `source_text`, `analyzed_at` and `analyzed_cast` (the speaker ids
it could choose from — "added since" compares against it); each block's metadata
gets `paragraph_idx`, `anchor_words`, `llm_speaker` (only where the book won and
the model differed — `flags.model_disagreed`), `floored_from`, and on an
in-place re-analyze that changes a line's speaker, `prev_speaker_id` (the key's
presence is the "changed" mark; the block PATCH drops it when the line becomes
`corrected`).

**Script's flags — `extraction/flags.py`** (Slice 3, 2026-09-29): `flag_groups`
is a pure function over a chapter's lines — **run** (one speaker, three or more
turns with no reply; a paragraph that leaves its quote open carries on into the
next, so a long speech is one turn), **only** (a speaker's only line),
**disagree** (`llm_speaker` set). (`not_in_cast` died 2026-09-29: a line's
speaker is always one of the book's.) Marks go only on lines whose source
Analyze wrote.
`server/scripts/eval_attribution.py` imports the same function (via
`lines_from_rows`) and prints caught / missed / false alarms with every run.
`GET /v1/projects/{id}/script` (the grid's rows) and `GET /v1/scenes/{id}/script`
(one chapter's lines, groups and speakers) compute them in
`extraction_api._chapter_script`, on the one "analyzed" rule:
`analyzed_at`, or — older data — a pipeline source on any line.

**Split and merge — Script's "✎ Edit…" and "⇲ Merge"** (2026-09-30,
`projects_api.split_block` / `merge_blocks`): `POST /v1/blocks/{id}/split
{at, text?}` cuts a line at a character offset — the first keeps the id, takes
and `source_ref`, the second is new with the same speaker; `POST
/v1/scenes/{id}/blocks/merge {ids}` joins lines that sit next to each other onto
the first and deletes the rest (their takes cascade). Both renumber the
scene's positions and drop `source_text`. `ScriptLine.takes` (chapter page
only) lets Merge say how many takes it deletes before it asks.

**Leave out dialogue tags — `extraction/tags.py`** (2026-09-30): `is_tag_only`
(who + an `anchors.DIALOGUE_VERBS` verb + an optional adverb, nothing else) and
`left_out` / `left_out_blocks` (a tag-only narration line beside a spoken line
of the same `paragraph_idx`). With the project's `metadata.leave_out_tags`,
`render_chapter_api._resolve_scene_to_lines` skips those blocks — so chapter
audio, the M4B export, captions and the render-readiness check all agree — and
`_chapter_script` sets `ScriptLine.left_out` for Script's "Left out" tag.

**Undo's server half:** the block PATCH takes `no_fix` (no correction row),
returns the `fix_id` a speaker change saved, and treats an explicit `null` for
`speaker_id` / `source` / `extraction_confidence` as "clear it";
`DELETE /v1/projects/{id}/corrections/{fix_id}` removes one fix.

**Two separate endpoints, often confused:**

- `POST /v1/scenes/{id}/analyze` — gives lines to the book's **speakers**.
- `POST /v1/scenes/{id}/discover-speakers` — finds names in the prose that are
  **not** speakers of the book. `POST /v1/projects/{id}/speakers/promote` turns
  candidates into speakers (cast with the persona of exactly their name, if the
  library has one).

**Discover is its own Studio step** (2026-09-27): `components/StudioDiscover.vue`
queues its ticked chapters on the project's chapter run
(`services/chapterRun.js`, shared with Script's Analyze since 2026-09-29), which
calls discover-speakers once per chapter — in a worker thread on the server, so
a scan no longer stalls every other request — and promote once per added name.
**Every model call in `extraction_api` runs off the event loop** (2026-09-29):
the Analyze stream in its own `Thread`, and `asyncio.to_thread` in the scene
discover, the non-streaming scene analyze, the Lab's `analyze-text` and its
`discover-speakers`. The pipeline is blocking; `async def` around it stalled
every other request, `/v1/health` included, for the length of the call.
Analyze no longer runs it afterwards. **Each scan is saved on its
chapter** — `scene.metadata.discover = {scanned_at, candidates, named_cast}`,
written by the discover endpoint and replaced only by that chapter's next scan
(2026-09-29: nothing prunes it — Add and Ignore change a row's status, not the
record). `candidates` are the model's names that aren't speakers (ignored ones
kept); `named_cast` the speakers the text names (`speaker_id` + name), found
without the model by `names.cast_named_in`. The component holds no results:
`studioStatus.foundSpeakers` merges the scenes' records against the current
speakers, the persona library and the ignore list into one list with a status
(cast · library · new · ignored — **library** = exactly one persona has that
name, worked out in code; a removed speaker's row turns new); Studio keeps it in
a `KeepAlive` so a scan survives a step switch. Rows In the cast have *Remove
from cast* and tick into *Remove N selected* — both `DELETE /v1/speakers/{id}`
after a confirmation naming each one's lines.

**Names are matched in one place — `extraction/names.py`** (2026-09-27): full
name / alias / first-or-last name (3+ letters), ambiguity refused, prefixes
never. The discover endpoint uses it to drop a proposal that names one of the
book's speakers. **The model is no longer sent the library** (2026-09-29):
`identify.identify_speakers` takes no `library`, and the `{{library}}` lines and
their system-prompt paragraph are gone — measured first with
`npm run eval:discover` (old prompt with library 28/28 found, 0 wrong; without,
26/28 and 4 wrong; the new prompt without = the old prompt without, so the
paragraph cost nothing — the drop is the missing descriptions of people not in
the cast). A speaker's aliases (*Also called*) reach Analyze through
`_resolve_cast` (anchors.py and the attribution prompt read them). The
ignore list is `Project.discover_ignored`, its own column because project PATCH
replaces `metadata_json` wholesale. **Prompt test:** `npm run eval:discover`
(`server/scripts/eval_discover.py`, scenario in
`samples/the-ninth-facet/discover-eval.json`) scores the live prompt — or a
`--system` candidate — against the real model, writing nothing.

**Long chapters are read in pieces — `extraction/pieces.py`** (2026-09-28, plan
`docs/plans/2026-09-28-chapter-splitting.md`). `pipeline._attribute_in_pieces`
measures the prompt with the kit's `measure_action` (llama.cpp's own tokenizer
and `--ctx-size`; None off the local runner), plans whole-paragraph pieces with a
lead-in when chapter + answer reserve does not fit, keeps each piece's answers
for the `[D#]` lines it owns, then runs the unchanged `align_picks`. Backstops:
a provider refusal as too big, or `finish_reason == "length"` (the kit's
`StreamDelta` carries it since the same day), halves the piece. An id-less piece
reply is placed by order or retried once. `identify.identify_speakers` splits the
same way (no lead-in) and merges candidates by name. Knobs:
`settings.extraction.split_lead_in_paragraphs` / `answer_tokens_per_line`.
**Test:** `npm run eval:attribution -- --whole --max-context N` forces splitting
on the answer-keyed samples.

**The answer-keyed samples** (`samples/<name>/attribution-truth.json`, read by
`server/scripts/eval_attribution.py`): `the-ninth-facet` and `the-salt-iron-road`
are JustWrite's own sample books; `the-speckled-band` (2026-09-29) is published
prose — Conan Doyle's story, public domain, from Project Gutenberg — loaded as a
plain-text import through the `book_prose` adapter. A key may name its book file
and adapter (`"book"`, `"adapter"`) and, for a book that ships no characters,
carry the cast with its aliases. It is the only sample with a first-person
narrator who also speaks and with speeches that run over several paragraphs.

**The prompt is thin.** `_resolve_cast` (`extraction_api.py:153-172`) returns
the book's speakers with role/gender/pronouns hardcoded to `None`, their
*Also called* as `aliases` and *Who they are* as `description`;
`format_characters` (`extraction/prompts.py:98-113`) sends `id`, `name` and
`aliases` only — *Who they are* does not reach Analyze (one line of it is
Discover's known list). Test this before blaming a model for poor attribution.

---

## 5. Render — the path and the cascade

- **Single line:** `POST /v1/blocks/{block_id}/render` (`takes_api.py`) and
  `POST /v1/generate`.
- **Chapter:** `POST /v1/render_chapter` (`render_chapter_api.py`).
- **Who voices a line:** line → speaker → persona → voice, everywhere —
  `_speaker_helpers.persona_for_block` for `render_jobs`, `takes_api` and
  `export_voicelines`; `render_chapter_api` resolves the same chain from the
  book's preloaded speakers.
- **Batch job:** `POST /v1/render_jobs`, with cancel/resume and per-block retry.
- **Core:** `render_core.py` — `render_line`, `probe_line_cached`,
  `line_lexicons`, `_apply_lexicons`, `_resolve_engine_for_voice`,
  `resolve_audio_prompt_for_stored`, `voice_synth_fields`,
  `voice_design_instruct(_for_id)`, `qwen_family_for_voice`,
  `qwen_family_conflicts`, `_tags_supported`, `pcm_to_wav`,
  `concat_lines(silence_ms=250)`.

**Which lexicons a line is read with** (2026-09-30,
`docs/plans/2026-09-30-project-lexicon.md`) — `render_core.line_lexicons(book,
persona)` is the one rule: the book's (`projects.default_lexicon_id`), then the
lexicon of the persona that speaks the line. Three doors call it and nothing
else decides: `render_chapter_api._resolve_scene_to_lines` (each `ChapterLine`
carries its own `lexicons`; chapter audio, cache-stats, M4B, ACX QC and captions
all read them through `_lexicons_for`), `export_voicelines._render_block_production`
(Lines ↻, render jobs, the voice-line export) and `pronunciation_api` (the name
scan, per line). `_apply_lexicons` lets the **first entry that acts on a word**
win, so the book's beats the persona's whether each is a respelling or IPA.
Direct-mode `/v1/render_chapter` still takes `lexicons` on the request; they
follow each line's own. `/v1/generate` applies the `lexicons` its request names
(Generate sends the picked persona's) through the same `_apply_lexicons`
(`generate_api._read_through_lexicons`, both synth paths) — never a book's.
`POST /v1/lexicons` makes a new book-scoped lexicon the book's own when the
book has none (`lexicons_api._choose_for_book_with_none`), as an import does.

**The cache key holds what the lexicons changed, not which were attached**: the
respelt text, and `delivery.ipa_map` cut down to the words the line contains
(`_ipa_words`, the whole-word rule the removed `engines/kokoro/ipa.py` splice used —
pinned with literal expectations in `test_project_lexicon.py`, since no engine on the
speech runtime takes IPA, so `ipa_map` is empty today). So choosing
a lexicon or editing an entry re-renders only the lines with that word.
`CacheKeyBuilder.with_lexicons` is gone. Lines rendered with a lexicon attached
before 2026-09-30 re-render once; lines rendered with none keep their key.

**How each voice SOURCE reaches an engine** — `voice_synth_fields` is the one
place that knows, and it carries synth **inputs** only (clip, vector);
prose for the instruct slot composes at the API layer instead:

| source | contributes |
|---|---|
| cloned · imported | `audio_prompt_path` + `ref_text` |
| blended | `voice_vector` |
| designed, clip frozen | `audio_prompt_path` + `ref_text` — it is a clone now |
| designed, no clip | nothing here; its `design_prompt` composes FIRST into `delivery.instruct` via `voice_design_instruct` |
| preset | nothing |

**Clip wins** (2026-08-22): a designed voice saved with its preview frozen to
`ref.wav` renders as a clone and its description is provenance only; one
without a clip renders dynamically off the description. Both halves live in
`render_core` so the rule has a single home —
`docs/plans/2026-08-22-voice-modes-truth-and-parity.md` §9.2 has why it is a
sibling of `voice_synth_fields` rather than part of it.

**Qwen3 keeps one checkpoint resident**, so `qwen_family_conflicts` runs a
preflight before a chapter render and refuses a cast that mixes families
(preset→CustomVoice, clip/adapter→Base, clip-less designed→VoiceDesign),
naming each voice and what it needs. Not an auto-swap — that is a later
opt-in item.

**The delivery cascade** (`render_chapter_api.py:168-170`): the **persona's**
chain, then the **preset's** on top — `resolve_chain(persona_effects,
preset_effects)`.

### What actually reaches the engine — the delivery matrix

`render_core.render_line` passes the whole `delivery` dict to the manager, and the
slot maps it onto audio.cpp's request (`engines/audiocpp/slot.py:
to_speech_request`, per family — §3b). **The host-applied fields work on every
engine; everything else is engine-specific.** Speed, gain and pitch are applied
to the finished line by one function, `render_core.apply_line_delivery`, which
`/v1/generate` calls too (`generate_api._finish_line`) — until 2026-10-02
Generate applied none of the three.

| Field | Applied by | Works on |
|---|---|---|
| `speed` | **engine** where the model paces itself (capability `speed_native`: Kokoro, KittenTTS; registry `EngineMeta.supports_speed`: the OpenAI-compatible provider) — else **host**, `time_stretch` on the finished line, clamped [0.5, 2.0]. A stretched line's cache key carries `speed_by: server` (`_key_delivery`) so entries cached while speed was ignored re-render | **every engine** (2026-10-02) |
| `gain_db` | **host** — `apply_gain_db`, clamped to [−24, +12], after speed | **every engine** |
| `pitch` | **host** — `pitch_shift` effect, clamped ±12 st, after gain. **Wired 2026-08-17**; before that it was read by nobody | **every engine** |
| effects chain | **host** — `apply_effects_chain`, after speed, gain and pitch | **every engine** |
| lexicons | **host** — `_apply_lexicons` substitutes text before synth; an IPA entry would ride `delivery.ipa_map` to an engine that takes phonemes, and none does on the runtime (`phoneme_override: False` everywhere), so its respelling is used | respellings: **every engine** |
| `instruct` | engine | **qwen3 CustomVoice** (`options.instruct`) and **VoiceDesign** (`instructions`, the description). Composed by `delivery_merge.compose_instruct` from persona `voice_instruct` → `emotion` → `Block.direction`, most specific last, a lone hint verbatim. Both render paths use that one function since 2026-08-17; before it, `/v1/generate` composed nothing |
| ~~`style_prompt`~~ | — | **Deleted 2026-08-17.** A second prose field against `instruct`'s "this line", concatenated into it by the adapter one line before the model saw them. Qwen has one slot; the standing-vs-this-line axis is persona-vs-line, which already exists |
| `temperature` | engine | **chatterbox**, **qwen3** (`options.temperature`) |
| `engine.*` subdict | engine | chatterbox · qwen3 (§3b's mapping). **Fixed 2026-08-17** — `nest_engine_keys()` in `delivery_merge.py` moves flat capability keys into `engine` before the merge, so the UI's flat save now arrives nested |
| `seed` | host | `delivery.seed` wins over `req.seed` — a deliberate override |
| `emotion` | **host, two ways** | **The only cross-engine direction control.** An enum compiles where prose cannot: composed into `instruct` for prose engines (Qwen3 CustomVoice / VoiceDesign), and compiled into a token by `render_core._apply_emotion_tag` for engines whose capability row declares an `inline_tags` set with `category="emotion"` and a `value_map` — that was Chatterbox Turbo, which is not on the runtime yet, so **no row declares one today**. Variant-precise via `manager.current_variant_id`. Applied after the lexicon and mirrored in `probe_line_cached`, or the cache probe lies. Had **no writer in `src/` at all** until 2026-08-17 |
| `pause_before` / `pause_after` | **host** | **Wired 2026-08-17** — `concat_lines` uses them per join. Blank = the project gap; a value replaces it; both sides of a join add. `0` is a deliberate butt-join |

**Design consequence, and it is a big one:** tuning does **not** move cleanly with
a persona across a change of voice or engine. The **host-side half — speed, gain, pitch,
effects, lexicon, pauses — always survives** (speed since 2026-10-02: a model that
paces itself takes it, the server stretches for the rest). The **engine half —
instruct, temperature — survives only if the new engine happens to honour it.**

`emotion` is meant to be the exception and is why it is an enum rather than
prose: it compiles into instruct prose for one family and into a token for an
engine with an emotion vocabulary, so it is the one piece of a *performance*
that can cross the boundary — once such an engine is back on the runtime.

Any persona editor must therefore show, per field, whether the persona's current
voice's engine honours it. The machinery exists —
`GET /v1/engines/{id}/capabilities` and `capability_details.py`.

### The per-engine knob matrix — declaration ↔ the runtime

`capability_details.py` is the config that drives every slider in the app.
Since the 2026-10-01 switch every knob it declares must reach audio.cpp through
`slot.to_speech_request` — **pinned by `server/tests/test_engine_knob_wiring.py`,
which sets each declared knob and fails unless the value comes out in the
request** (`test_every_declared_knob_reaches_the_runtime`).

| Capability row | Knobs | audio.cpp request |
|---|---|---|
| `kokoro` | speed · seed | `speed` · `seed` |
| `chatterbox` / `chatterbox-multilingual` | temperature · exaggeration · cfg_weight · repetition_penalty · top_p · seed | `options.temperature` · `options.exaggeration` · `options.guidance_scale` · `options.repetition_penalty` · `options.top_p` · `seed` (exaggeration and guidance verified to take effect per request, no reload) |
| `qwen3` / `qwen3-cv` / `qwen3-base` / `qwen3-vd` | talker_temperature · talker_top_k · talker_top_p · repetition_penalty · seed | `options.temperature` · `options.top_k` · `options.top_p` · `options.repetition_penalty` · `seed` |

Min-p (Chatterbox) left at the switch — the runtime takes no such option. The
rows for Chatterbox Turbo / Nano, LuxTTS, MOSS-TTSD, TADA and the macOS MLX
Qwen3 builds went with those engines.

The 2026-08-17 audit below was made against the Python adapters the switch
removed; it stays as the record of what the declarations got wrong then.

### The inline-tag surface

**No engine on the speech runtime declares tags** (§3c); what follows is the
surface Chatterbox Turbo had, and the shape it returns in. Separate from knobs,
and the same failure mode. `chatterbox-turbo` declared
**4** tags; the checkpoint's `added_tokens.json` holds **19** at reserved ids
50257–50275, so fifteen were unreachable. Declared in full 2026-08-17, split
into three categories because they are not one kind of thing:

| Category | Tags | Why it is its own set |
|---|---|---|
| `emotion` | angry · fear · happy · sarcastic · surprised · crying · whispering | the state the whole line is in — carries the `value_map` that makes `Delivery.emotion` cross-engine |
| `register` | narration · dramatic · advertisement | how the passage is read, not what the speaker feels |
| `paralinguistic` | cough · laugh · chuckle · sigh · gasp · groan · sniff · clear throat · shush | a sound at a *moment*, so the author places it |

Only `category="emotion"` sets carry `value_map`, and a test enforces both that
and that every mapped tag is one the set declares. Turbo has no token for
`shouted` or `contemptuous`; `sad` is deliberately unmapped because `[crying]`
is a behaviour, not a state. Upstream documents three tags by name and says
"and more" — the rest are declared from token ids and **unrendered here**.

**Fixed 2026-09-29:** `render_core.performable_text` drops every `[tag]` the
RENDERING variant doesn't list (`_capability_row`, the same variant-precise probe
the emotion path uses), so a hand-typed `[laugh]` no longer reaches Multilingual,
and an unknown `[warm]` no longer reaches anything. `inline_tags.strip(text,
keep=…)` does the dropping (multi-word tags like `[clear throat]` included);
`render_line`, `probe_line_cached` and both Generate paths call it.

**Qwen3 was the same bug and is fixed** (2026-08-22). It declared
`paralinguistic_tags: True` on the strength of `inline_tags.py`'s docstring,
which promised a tag→instruct translation for Qwen3 that was **never
written** — only `strip` is imported anywhere. Upstream Qwen3-TTS has no tag
vocabulary at all (its README's one "paralinguistic" mention is about the
12 Hz codec preserving them through reconstruction), so the flag meant
`render_core` skipped stripping and `[laugh]` went into the model's text to be
read aloud. Now `False` in both `qwen3/manifest.py` and the adapter's
`EngineMeta`, and Qwen3 strips like Kokoro. Direction reaches Qwen as prose in
`instruct`; that is its whole surface. A real tag→prose translation for
CustomVoice/VoiceDesign remains un-built and un-promised.

**What the 2026-08-17 audit corrected** (against the pre-switch adapters), all previously user-visible lies:

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
- **`silence_duration` (moss)** — declared, never read. Removed. Its four real
  knobs were read but undeclared, so no UI could reach them.
- **`steps` / `noise_temperature` / `faithfulness` (tada)** — three sliders on
  an adapter that reads no delivery field at all. Removed rather than left
  decorative; TADA was not installed at the time, so its upstream surface could
  not be introspected. Re-add each only with the adapter change that passes it.
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
(`render_chapter_api.py:247-270`), all three in one *"This chapter isn't ready
to render."* message:

- *"N line(s) have no speaker: line 3 ("…") … Open Studio · Script and set one on
  each, or send them all to the narrator."*
- *"Nobody plays X yet — give them a persona in Studio · Cast."*
- *"The persona X has no voice — pick one on the Personas page."*

**Mastering targets are exactly four** — `mastering.py:38`:
`acx · inaudio · podcast · youtube`. There is no "game asset" target.

**The synth scheduler** (`synth_scheduler.py`, shipped `3a5a23d`) is one worker
plus one pending pool, draining **engine-major**, with interactive singles
jumping the queue at line boundaries — the mechanism that prevents a model swap
per line. Seven callers. **Nothing in `src/` references it and no endpoint
exposes queue depth or the current engine.**

---

## 6. The surfaces — 17 routes, 24 views

`src/router/index.js`. Real routes:

`/home · /projects · /chapter · /lines · /studio · /stories · /generate ·
/captures · /voices · /personas · /personas/:id · /lexicons · /effects · /ai ·
/importreview · /labs · /settings` (+ `/` → `/home`, `/overview` → `/home`,
`/engines` → `/ai?tab=speech-engines`, unknown → `/home`).

**Redirect-only paths** that set `sessionStorage` then land on a parent:
`/cache`, `/channels`, `/webhooks` → `/settings`; `/compare`,
`/renderlab`, `/audio` → `/labs`; `/speakerlab` → `/ai?tab=features&action=speaker_attribution.guided`
(the Speaker Lab died in the 2026-08-06 parity batch).

| View | Lines | What it is |
|---|---|---|
| `StudioView` | ~1440 (2026-09-29) | The production steps' container. Cast moved out to `components/StudioCast.vue` with the speakers/personas split (it was 3132 lines with the old Cast and its voice library inside). See below. |
| `SettingsView` | 2099 | Workspace focus · connection · headless access · tokens · data location · disk · server bind · cache · limits · local model paths · generation pipeline (incl. the default voice language) · testing/danger zone |
| `ChapterView` | 1481 | The chapter **list** (columns **Chapter · Words · Est. audio · Script · Render**, filter chips, add/move/rename/delete, *Open in Studio ➜*) **and** the per-chapter block editor with takes (`＋ Generate first take`, set-default, regenerate, delete take) |
| `VoicesView` | 1302 | The voice library. Columns **Name · Gender · Type · Engine · Lang · Samples · Gens · Effects · Channel · Cast as**. Actions: Guess unknown genders · Import .justvoice.zip · Clone new voice · Blend with… Plus the **voice inspector** behind a row interaction |
| `GenerateView` | 1282 | One-off synth: voice, text, seed + randomize, **delivery overlay**, insert tag, Rewrite, Compose, lexicon view, and a **history** of takes/favorites/retry |
| `ProjectsView` | 950 | Project list (**Project · Kind · Structure · Last opened**) + detail expansion with scenes (**# · Title · Blocks · Duration · Status**), `＋ Add personas`, *Open in Studio ➜* |
| `PersonasView` | ~360 | The persona library list — see §1 |
| `PersonaEditorView` | ~970 | One persona's page, `/personas/:id` (`new` = blank; `meta.nav` keeps the rail on Personas) — see §1 |
| `LexiconsView` | 632 | Pronunciation dictionaries |
| `HomeView` | 561 | Empty hero *"What are you making?"* · Continue/Resume card · live tasks · engine status **with VRAM** + Unload/Switch · recent generations with inline replay |
| `CapturesView` | 409 | Dictation captures, refined vs raw transcript, pin, retranscribe |
| `CompareView` | 358 | A/B two takes → metric deltas + verdict (inside Labs) |
| `CacheView` | 310 | Total on disk · by scope · recent entries · clear |
| `RenderLabView` | 296 | Settings sweep (inside Labs) |
| `LinesView` | 292 | Game voicelines grid — **Line ID · Speaker · Text · Take**, Re-import CSV, Export VO zip |
| `AudioToolsView` | 261 | Analyze a WAV · apply a mastering target (inside Labs) |
| `ImportReviewView` | 236 | Post-import check — **Chapter · Lines · Words · Est. audio** |
| `WebhooksView` | 232 | Subscriptions |
| `EffectsView` | 222 | Effect-chain presets |
| `AudioChannelsView` | 172 | Output channels |
| `AiView` | 97 | The AI console (kit) — tabs incl. `features`, `speech-engines` |
| `LabsView` | 79 | Container for `compare · renderlab · audio` |
| `StoriesView` | 43 | The timeline — thin |

### StudioView's steps

Order is canon in `src/views/studioSteps.js`, **pinned by a test**:

```
every kind : overview (unnumbered — the project's own page)
prose      : discover → script → cast → render → export
game       : lines → cast → render → export
```

Studio is the project's home (ruled 2026-09-27). Every door that opens a
project goes through `services/openProject.js` → `openProjectInStudio`, which
sets the `jv.studio.tab` hand-off to `overview`; StudioView also lands on
Overview whenever its selected project changes, and follows the app-wide
active project so the title-bar switcher works while Studio is on screen.

| Step | Where | What it is |
|---|---|---|
| **Overview** | `components/StudioOverview.vue` | Where-it-stands rows (`views/studioStatus.js`, pure + tested — counts from blocks, cast, the render cache and Script's grid rows; Script's two tags open the grid on "To check"), Continue, settings (title, author → M4B artist, description, kind, mastering target), re-import, .justvoice.zip, delete |
| **Discover** | `components/StudioDiscover.vue` | Chapter grid (Found column) + Scan + Speakers found (status per person, chips All · New · In the cast · Ignored; Add / Ignore / Undo; In-the-cast rows *already in the cast* + Remove from cast; ticks → ＋ Add / Ignore / Remove N selected); Ignored and Already-in-the-cast each have a ✕ per name and Clear all (the cast's keeps the Narrator); every removal asks first |
| **Cast** | `components/StudioCast.vue` | Speakers left (narrator card, cards with *also called*, Narrator tick, ✕ asks first; a game project gets a table), the selected speaker's Name / Also called / Who they are / *Edit their persona →*; personas right (search, engine filter, direction tag, ▶ plays its voice, ✎), click to assign; ＋ Add · ✕ Clear cast · ✨ Smart-assign |
| **Script** | `components/StudioScript.vue` (the chapter grid) · `components/StudioScriptChapter.vue` (one chapter) | The grid reads `GET /v1/projects/{id}/script` (Studio owns the fetch; Overview reads the same rows) and queues Analyze on `services/chapterRun.js` — one run of chapters per project, one kit task per chapter, module state so it survives leaving Studio. The chapter page reads `GET /v1/scenes/{id}/script` and re-reads after every change; its selection, keys, set / swap / confirm and undo stack are `views/scriptReview.js` (pure, unit-tested). Rewrite-in-character is still StudioView's modal, opened by the page's right-click (`@rewrite`) until Slice 4 moves it to Render |
| **Lines** (game) | `views/LinesView.vue` embedded with `:project-id` | the line grid, its own project picker hidden |

| Step | Subtitle in the tab strip | What it does |
|---|---|---|
| **Script** | *"Who speaks each line"* | The chapter grid (**Lines · Analyzed · Book says · AI decided · Flagged · No speaker**), then a chapter's table **Speaker · Decided by · Text · Confidence · Check**. Right-click a line's text → Rewrite preview |
| **Cast** | *"Give each speaker a persona"* | Speaker cards + a **Personas** panel (*"Select a speaker, then click a persona to assign it."*). Actions: `＋ Add` (a speaker by name) · `✕ Clear cast` (*"Unassign personas from all N speakers. The speakers stay — only the persona links go."*) · `✨ Smart-assign` (applies at once). Game kind shows a table instead: **Speaker · Role · Persona** |
| **Render** | *"Batch render + mastering"* | Table **# · Cached · Check**. Select unrendered / Select all · Render · Cancel · Retry · Play · **Run ACX QC** |
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
   `moss_tts/engine.py:114`) while `VoiceParamsModal.vue` (deleted 2026-10-03, an orphan) saved the capability
   schema's keys **flat**, and nothing bridged the two — so exaggeration,
   cfg_weight, repetition_penalty, min_p, t_shift and the rest had never done
   anything at render. `nest_engine_keys()` in `delivery_merge.py` now
   normalises each tier before the merge, which also repairs deliveries
   already stored flat in `personas.default_delivery`. `render_chapter_api`'s
   `Delivery.model_fields` filter keeps them, because `engine` is itself a
   declared field.
3. ~~**Kokoro speaks English whatever the voice claims.**~~ **FIXED 2026-10-01**
   with the switch: the old `kokoro/engine.py` set the language once at load and
   phonemized every preset as English; `slot.to_speech_request` now sends each
   line the voice's own language (`KOKORO_LANGUAGE`, from `kokoro/voices.py`).
   The Japanese presets left the catalog (the runtime has no MeCab/UniDic).
4. **Four of the Voices table's columns are wired to nothing.** `GET /v1/voices`
   returns id · engine · source · name · language · gender · sample_url
   (`models.py:464-471`). **Effects**, **Channel**, **Samples** (`sample_count`
   is dropped by `_stored_to_dto`, `voices_api.py:32-40`) and **Gens**
   (`generation_count` — no such field anywhere) render "—", "Default" and "0"
   forever.
5. ~~**`RenderPreset` has two dead fields and a live lock.**~~ **GONE
   2026-10-03** with render presets ("presets die").
6. **The synth scheduler has no UI** — see §5.
7. **The analyze prompt gets id, name and aliases only** — see §4.
8. **ChapterView offers "Generate first take" on speaker-less blocks** and prints
   raw block UUIDs (`b0e22b69`) at the user — the render path refuses a block
   with no speaker, so the button cannot work.
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
13. ~~**`tada/engine.py` reads no delivery field at all.**~~ Gone with TADA
    (2026-10-01); its three fake sliders had already been removed on
    2026-08-17.
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

- **Audiobook producers** — long-form narration, casting many speakers,
  pronunciation discipline, ACX mastering, the JustWrite workflow. Import EPUB /
  DOCX / `.jw.json`; export chapter WAVs → M4B at ACX −20 LUFS.
- **Game developers** — Unreal, 50–500 dialogue lines. **No Script step** — the
  CSV names speakers. Line-first grid, stable line IDs, per-line WAV + JSON sidecar,
  VO zip export.
- **Podcasters** — multi-track Stories timeline, paralinguistic tags, effects
  chain; −16 LUFS stereo.
- **Dictation** — global hotkey, system audio capture, MCP server. **Not
  project-shaped** — captures, not scenes.
- **Accessibility** — real-time TTS, screen-reader integration. Future.

**Speaker creation depends on what the source file knows**: `.jw.json` and game
CSV and podcast markdown all create speakers **at import**; a bare EPUB/DOCX
creates them **later**, via Studio · Discover. No import creates a persona.
Speakers dedup by `imported_from + imported_id` — re-import updates in place.
(`CONCEPTS.md` §3 predates the split and says "personas".)

**Casting has two paths today** (`CONCEPTS.md` §4 planned three): Smart-assign
(one button matches every speaker to a persona and applies it) · select a
speaker card or table row, then click a persona. The planned per-row dropdown
with *"▶ test line"* auditioning on the speaker's own line is not built.
