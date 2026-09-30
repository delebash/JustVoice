<!-- SPDX-License-Identifier: MIT -->
# Speakers and personas become two things

**Decided 2026-09-29** — "option a, go ahead and plan and code it". The decision
text is in `docs/dev/TASKS.md` ("Speakers and personas become two things"); this
doc is how it gets built. Read both before coding any part.

**Status: BUILT and pushed, 2026-09-29.** JV `fd593f8` (all three slices) · `0fba24f`
(walkthrough fix: Cast's selected card kept resetting typed text) · `28f1822` (persona
names unique across the library and never blank — the follow-on ruling, TASKS "Persona
names are unique across the library"). The full server suite ran after (865, then 880
passed). What was built, verified and left out is in the TASKS entry's BUILT block.

## 1. What it is

Three words, one job each:

| Word | What it is | Lives |
|---|---|---|
| **Persona** | A finished spoken voice — a voice and its engine, plus speed, pitch, gain, spoken direction, effects and lexicon, and a short **note on how it sounds**. | The library. Reused anywhere. |
| **Speaker** | A person in one book — a name, the other names the text uses (*Also called*), and **who they are** (the sheet the AI reads). | One book. |
| **Cast** | Each speaker's persona. One persona can play many speakers; change it once and all of them change. | The speaker's `persona_id`. |

The mock's Cast is already this and needs no redraw: speakers on the left,
personas on the right, *"Select a speaker, then click a persona to assign it."*
The mock's Personas page is the library of finished voices: *Built on · Engine ·
Can be directed · Shaped · Used by (speaker · book)*.

**Why the app looked different.** Until now one `Persona` row was both halves: the
person Discover found *and* the sound. A line pointed straight at it, so Discover
had to create a persona per person — with no voice — and Cast had to offer a voice
list to finish it. That merge is gone.

**What follows from it, stated so nobody has to re-derive it:**

- **Discover finds speakers.** Add creates a speaker in this book. A name that
  **exactly** matches a persona in your library arrives already cast with it (the
  decision's refinement); Cast shows it so it can be changed.
- **Script gives lines to speakers.** Attribution reads the speakers' names,
  *Also called* names and *who they are* — the fields that were on the persona.
- **The narrator is a speaker** with the narrator role, cast like anyone. Still no
  automatic narrator (the earlier ruling stands): a book's own "Narrator" character
  becomes it; **+ Add Narrator** makes a speaker called Narrator.
- **Names are unique within a book — for speakers.** Personas have no name rule.
  An import keeps the book's characters as they are.
- **Render** follows line → speaker → persona → voice. It stops on a line with no
  speaker, a speaker with no persona, and a persona with no voice.
- **Generate** has no book: Compose and Rewrite read the persona's **note**.
  Script's *Rewrite in character* reads the **speaker's** *who they are*.
- **Deleting a book deletes its speakers** — a speaker cannot outlive its book, so
  leftovers cannot pile up. Deleting a persona un-casts every speaker it played.
- **Generations, lexicons, channels, MCP bindings and training jobs stay on the
  persona.** A persona-scoped lexicon applies to every speaker that persona plays.
- **Discover's library match becomes an exact persona name, in code.** The model is
  no longer sent "people from your other work" to link nicknames — the library now
  holds voices, not people. That paragraph of the Discover prompt goes, measured
  before and after with `npm run eval:discover` (see §5, question 3).
- **Smart-assign** matches speakers to personas. Its template is unchanged: in this
  model a persona *is* the voice, so personas fill its voice list and speakers its
  character list. It keeps applying straight away (the mock's *"listen before you
  accept"* and Fable's "suggest instead" are a later addition, not this go).

## 2. The data

| Table | Change |
|---|---|
| `speakers` **new** | `id · project_id` (→ projects, CASCADE) `· name · aliases` (JSON) `· description` (who they are) `· persona_id` (→ personas, SET NULL) `· role_label` ("narrator") `· imported_from · imported_id` (re-import merge) `· created_at · updated_at` |
| `blocks` | `persona_id` → **`speaker_id`** (→ speakers, SET NULL) |
| `speaker_corrections` | `persona_id` → **`speaker_id`** |
| `project_personas` | **dropped** — the cast is `speakers.persona_id` |
| `personas` | `personality` → **`note`**; `aliases` dropped (moves to the speaker) |
| `generations · lexicons · persona_channels · mcp_bindings · training_jobs` | unchanged — they belong to the voice |

**The data reset** ("Your data gets reset"). Measured on the live DB, read-only:
`projects 1 · scenes 4 · blocks 289 · personas 11 · project_personas 11`, and zero
rows in `takes, generations, lexicons, lexicon_entries, speaker_corrections,
training_jobs, persona_channels, mcp_bindings`. The reset deletes the one book and
the 11 personas (all voiceless) and recreates the changed tables; **every other
table — settings, AI prompts, model/runner setup, prefs, presets — is kept.** The DB
file is copied first. The book comes back with **Load demo** (The Ninth Facet is
the demo); its chapters need Discover and Analyze again.

## 3. Blast radius (pasted greps, 2026-09-29)

**Server — `grep -rc persona_id justvoice --include=*.py`:**

```
justvoice/api/projects_api.py:61      justvoice/api/extraction_api.py:52
justvoice/api/personas_api.py:21      justvoice/database/models.py:10
justvoice/models.py:8                 justvoice/api/channels_api.py:7
justvoice/api/generate_api.py:6       justvoice/storage/lexicons.py:5
justvoice/api/_persona_helpers.py:5   justvoice/render_jobs.py:4
justvoice/export_voicelines.py:4      justvoice/database/migrations.py:4
justvoice/api/project_export_api.py:4 justvoice/api/mcp_bindings_api.py:4
justvoice/mcp/resolve.py:3            justvoice/extraction/pipeline.py:3
justvoice/api/render_chapter_api.py:3 justvoice/api/bulk_delete_api.py:3
justvoice/mcp/tools.py:2              justvoice/extraction/names.py:2
justvoice/api/takes_api.py:2          justvoice/extraction/prompts.py:1
justvoice/extraction/__init__.py:1    justvoice/engines/moss_tts/manifest.py:1
justvoice/api/lexicons_api.py:1       justvoice/api/cache_api.py:1
```

Of these, the **block/cast/correction** users change (projects, extraction,
personas, models ×2, helpers, render_jobs, export_voicelines, project_export,
pipeline, render_chapter, takes, names, prompts); the **generation, lexicon,
channel, MCP-binding, training** users (channels_api, generate_api,
storage/lexicons, lexicons_api, mcp_bindings_api, mcp/resolve, bulk_delete, cache)
keep `persona_id` because those rows belong to the voice.

**`grep -rc ProjectPersona`:** `projects_api 31 · extraction_api 17 ·
_persona_helpers 9 · personas_api 7 · database/__init__ 2 · project_export_api 2 ·
database/models 1 · database/migrate_profiles 1` — every one goes.

**`grep -rc SpeakerCorrection`:** `extraction_api 21 · projects_api 1 ·
database/models 2 · database/__init__ 2` — `persona_id` → `speaker_id`.

**Block → persona lookups** (`grep -n "Persona.id == block.persona_id"`): render_jobs
:315, export_voicelines :83 :178, takes_api :299, and render_chapter_api :154 via
the store — all go through one new helper, line → speaker → persona.

**`personality` readers** (`grep -rn "\.personality\b\|personality="`):
extraction_api :174 :1248 (attribution + Discover's known cast → the speaker's
sheet), personas_api :250 :284 :307 :334 (Compose / Rewrite → the note),
smart_assign_api :75 (character description → the speaker's sheet), projects_api
:755 :848 :1357 (narrator + imports → the speaker's sheet), project_export_api :123,
mcp/tools :176, storage/personas :68 :148 :215 :268, migrate_profiles :94.

**Renderer** (`grep -rlE "persona_id|/cast|personaId|persona" src`, counts
`persona_id / cast / persona`):

```
src/views/StudioView.vue  12/101/185     src/views/PersonasView.vue  1/9/161
src/views/scriptReview.js 22/13/27       src/views/studioStatus.js   6/22/26
src/components/StudioScriptChapter.vue 10/15/21
src/components/StudioDiscover.vue       1/45/22
src/components/lab/AttributionResult.vue 7/12/20
src/services/labTestData.js 2/12/27      src/views/ChapterView.vue   6/18/24
src/views/GenerateView.vue 1/1/44        src/views/HomeView.vue      1/8/11
src/views/LexiconsView.vue 9/0/21        src/views/SettingsView.vue  7/3/28
src/services/attribution.js 3/3/4        src/services/projects.js    0/3/8
src/components/StudioScript.vue 0/7/4    src/views/RenderPresetsView.vue 0/1/17
+ the two test files (scriptReview.test.js, studioStatus.test.js)
```

LexiconsView and RenderPresetsView keep persona scope (voice-level).

**Tests** (`grep -rlE "persona_id|/cast|ProjectPersona|/v1/personas|SpeakerCorrection|personality" tests`):
project_narrator 29 · script_api 26 · discover_speakers 25 · persona_rewrite 22 ·
corrections 14 · voice_instruct 12 · unique_names_in_a_book 11 · cast_names 11 ·
analyze_persist 11 · projects 6 · import_materialize 6 · narrator_on_import 5 ·
bulk_delete_filters 5 · export_audiobook 4 · render_chapter_scene_mode 3 ·
reimport_update 3 · attribution_restore 2 · render_truth · render_cache_stats ·
mcp_server · extraction_stream · app_boot (1 each).

**Other repos:** `grep -rnE "/v1/personas|/cast\b|persona_id" justwrite-app/src
justwrite-app/server` finds only JustWrite's own endpoints; the kit has none. JustWrite
hands over `book.json` characters — that format is unchanged; JustVoice reads them
into speakers instead of personas.

**Live AI prompts** (`feature_prompts`, read-only): `speaker_attribution.identify`
uses `{{library}}` (goes — §1); `smart_assign` uses `{{characters}}/{{voices}}`
(unchanged); `compose` / `persona_rewrite` use `{{personality}}` (variable name
kept, value becomes the note / the speaker's sheet). Any template change is PUT to
the live row only after checking it equals the old code text.

## 4. Slices (one go; the app is only whole at the end)

1. **Server.** Models + the reset; the speaker store and endpoints (list · add ·
   rename / aliases / sheet / persona · delete · narrator); imports (JustWrite, CSV,
   podcast, SRT, re-import); extraction (cast resolution, persist, Script page,
   flags, corrections, Discover record + Add + exact persona match); render,
   takes, voice-line export, project export; personas API (note, usage by speaker);
   Smart-assign; Compose / Rewrite; MCP; tests.
2. **Renderer.** Cast as the mock; Script, Chapters, Discover, Overview, Home, the
   Lab, Personas (a library of voices: note, *Used by*), Generate, Settings.
3. **Prompts, docs, reset, gates.** Discover prompt measured then trimmed; user docs
   (personas, studio, generate, import-and-export, projects, lines, whats-new) and
   code-map; the reset on the live DB; restart; targeted tests; the renderer gate;
   a live check with Load demo.

## 5. Open — the user's word needed

1. ~~Where the exact-name cast applies~~ — **DECIDED: every new speaker** (Discover's
   Add, a book import, + Add Narrator, Cast's ＋ Add).
   **Also DECIDED: "speakers" everywhere** — never "characters", on any screen or doc,
   for every project kind (no "NPCs", no "Hosts"). Every "character" on screen and in
   the docs is swept to "speaker" in this change (`copy.js`'s per-kind cast words
   included).
2. ~~Removing a speaker~~ — **DECIDED: ask first.** Discover's "Already in the cast"
   ✕ and Clear all, and Cast's ✕, delete the speaker from the book and its lines go
   back to No speaker; one confirmation names who goes and how many lines each has
   ("Remove Nettle? 22 lines will have no speaker.").
3. ~~Discover's library~~ — **DECIDED: exact persona name, in code** (§1). The model
   is no longer sent the library; that prompt paragraph goes, measured before/after.
4. ~~Today's uncommitted work~~ — **DECIDED: committed first, no push.**
5. **Discover's "In the cast" rows** (decided "you rec go"): the action cell reads
   *already in the cast* with **Remove from cast** (asks first, as item 2); the row
   then turns New and stays. In-the-cast rows can be ticked too, and the bulk bar
   gains **Remove N selected** beside ＋ Add / Ignore. The bottom "Already in the
   cast" card stays.
6. **The selected speaker's card on Cast** (decided "ok add also called there"):
   **Name** (editable — renames happen here) · **Also called** (comma-separated) ·
   **Who they are** · **Edit their persona →**. The grid cards show "also called …"
   under the name. The mock's Cast gets the Also called field too.

Nothing is open. Build per §4.

## 6. The Discover prompt, measured (item 3)

`npm run eval:discover -- --server http://127.0.0.1:17494 --runs 2` on The
Ninth Facet, 2026-09-29:

| Condition | Recall | Wrong |
|---|---|---|
| Live prompt, library sent | 28/28 | 0 |
| New prompt (library paragraph removed), no library | 26/28 | 4 |
| Live prompt, no library | 26/28 | 4 |

The last two rows are identical, so removing the paragraph costs nothing by
itself. The drop from the first row comes from no longer sending the library:
its descriptions named people the book mentions (Haldane Threll ×2, Gudgeon ×4
were missed without them). "In your library" is now an exact persona name
matched in code, as decided. The live row was checked equal to the old code
text before the new one was PUT.
