<!-- SPDX-License-Identifier: MIT -->
# Studio Slice 4 — Render owns direction, takes, Gen and Compare: the build plan (2026-10-04)

**The decisions are TASKS "Studio Slice 4" (D1–D7, verbatim, "your rec on all go code it all").**
This doc is the plan under that go: what Render becomes, the in-app mock that draws it, the
pieces of the build, the blast radius with its greps, and the gaps the decisions leave open —
which are asked, not filled (§5). Research: `2026-09-30-mock-vs-app-and-slice-4.md` §3. Facts
found while planning: `docs/dev/RESEARCH.md` §3.

## 1. What Render is

Render is where a line becomes audio, and where you say how it is spoken.

- **The line is the unit.** Each line has a state in §8.16's words:
  - **needs a speaker** · **needs a voice** · **ready** · **rendered** · **stale**.
  - A chapter shows the rollup of those states. Studio's Render card shows how many chapters are rendered.
- **A take is a kept render of one line.** Every render makes a new take. Nothing is overwritten.
  - The ★ take is what the chapter plays and what the export ships (D4).
  - A line with no take renders as today.
- **Stale** means something the ★ take was made from has changed since:
  - the words, the direction, or the line's own numbers;
  - the persona (voice, delivery, seed, effects);
  - a lexicon entry that changes how its words are spoken.
  
  A stale line keeps playing its ★ take until you render it again (D4).
- **How it's said** depends on what the persona's model takes:
  - On a model that takes written direction, it is the line's direction, in words.
  - On a tag model, it is the persona's own standing tags, read-only.
  - Nothing at all on the rest.
  - The numbers (pace, pitch, gain, pause after) sit behind a closed "⚙ Override the numbers for this line" hatch. Setting one puts a dot on the row (D3, §8.3).
- **Who speaks is not chosen here.** It is a read-only chip with "Change in Cast" (D2).
- **The shape (D5):**
  - Render is a chapter grid: Lines, Rendered, Check, ▶ Render, Open.
  - Opening a chapter shows that chapter's line page, the way Script does.
  - Cached and Render preset go.
- **Chapters are managed on Script's grid (D7):**
  - "＋ Add chapter" sits beside the filter chips.
  - Each row's ⋯ menu has Rename · Move up · Move down · Delete.
  - "＋ Add text" pastes a new chapter's text.
- **The old Chapters page is deleted.** Its takes, compare, direction and Fix pronunciation come here. Its paste and chapter verbs go to Script.
- **Rewrite in character moves here,** to the line panel. Script's right-click is deleted.
- **"📕 Pronunciation" opens the book's lexicon,** and makes one if the book has none.

## 2. The mock (built in the app, 2026-10-04)

Dev only, under `npm run dev`:

- `#/mock/render` is the chapter grid.
- `#/mock/render/c1`…`c4` is one chapter's lines.
- `#/mock/script` is Script's grid with D7.

The files are in `src/mock/`: `MockStudioView.vue` (the Studio frame), `MockRenderGrid.vue`, `MockRenderChapterView.vue`, `MockScriptGrid.vue`, `renderMock.js`, and `ninthFacetScript.json`. The data is The Ninth Facet's four chapters (`build_ninth_script.py`, from the sample's own text and attribution-truth), voiced by the persona mock's personas.

The persona mock gained one persona so the counts agree across both mocks: **Street kid** (Kokoro Lily) plays Nettle, 19 lines.

Screens checked at 1440 and 1100 px with no JS errors. The interactions run:

- Render a chapter, and see a render fail with the server's own refusal.
- The Render-stopped dialog for lines with no speaker.
- The ACX check.
- Open a line: direction, the numbers hatch, Pronunciation, Rewrite (accepting it makes the line stale), takes with ▶ ★ 🗑, New take, and Compare.
- On Script: ＋ Add chapter, ＋ Add text, and the ⋯ menu.

New classes in `styles.css`: `.jv-linepanel` (+ `__side`, `__field`, `__row`, `__nums`) and `.jv-takes` (+ `__head`, `__row`, `__len`, `__label`, `__foot`). Every other shape is an existing precedent:

- the chapter grid is Script's (`StudioScript.vue`);
- the page head and verbs are Script's chapter page;
- the ⋯ menu is Personas' `ev-kebab` / `ev-menu`;
- the dialogs are the kit's `AppModal`, `promptDialog` and `confirmDialog`.

## 3. The build

### 3a · Server

1. **A take holds its audio, its seed and what it was made from.**
   - `render_jobs.persist_block_take` writes the WAV to `generations_root` (as `mcp/tools.py:211-226` does) and stores:
     - `Generation.audio_path`;
     - `seed`;
     - `cache_key` (the line's inputs key);
     - `instruct` (the direction);
     - `language`;
     - the real duration — today it assumes 16 kHz.
   - It clears the block's other defaults, like `set_default` (`takes_api.py:67`). Today every new take is born `is_default=True` beside the old one.
2. **One inputs key.** The key `render_line` builds (`render_core.py:732-742`) and `probe_line_cached` repeats (`:600-610`) becomes one function, `line_inputs_key(...)`. The render, the probe and the take all use it.
   - **Stale** means the key of the line's inputs now ≠ the ★ take's stored key.
   - A take with no stored key, made before this slice, reads stale (G10).
3. **The line's numbers (D3).** These are stored in the block's metadata, beside the existing `pause_after_ms`: `speed`, `pitch`, `gain_db`. One helper, `apply_line_override(delivery, block)`, is used by both render paths (`render_chapter_api._resolve_scene_to_lines` and `export_voicelines._render_block_production`).
   - The line's value wins over the persona's for this line (G7).
   - `PATCH /v1/blocks/{id}` gains `line_override` and merges it into the metadata. Today a `metadata` PATCH replaces the whole JSON (`projects_api.py:488`).
4. **The chapter plays ★ takes (D4).**
   - `ChapterLine` carries its `block_id`.
   - `render_scene_to_wav` and scene-mode `/v1/render_chapter` read each line's ★ take from disk when it has one, and render the rest through the cache as today.
   - The pause between lines and the line's own pause still come from now (they join takes; they are not in them).
   - Captions (`align_api.scene_captions`) use the take's own words for a line that plays a take.
5. **Line states.** `GET /v1/scenes/{id}/render_lines` returns each line with:
   - its state;
   - its ★ take (id, length, audio url) and how many takes it has;
   - its direction, override, persona and model;
   - how the model is directed, and the persona's standing tags.

   `GET /v1/projects/{id}/render_state` returns the per-chapter rollup for the grid, Studio's step card and Overview. That replaces `/v1/render/cache-stats` in Studio (`StudioView.vue:637-657`). The game Lines grid's `/v1/projects/{id}/lines` uses the same state function (G9).
6. **Rendering lines.** "⚡ Render N ready", a chapter's ▶ Render and "↻ Re-render all" run through `POST /v1/render_jobs` with scope `blocks` (the existing per-block job: scheduler, resumable, one take per block). The chapter's ▶ Render then joins it (G2).
   - "↻ New take" on one line is `POST /v1/blocks/{id}/render` with the seed rule of G1. Today that door hits the render cache and returns identical audio.
7. **A take's audio goes with it.** Deleting a take deletes its generation and file. Blocks deleted by merge, re-cut, scene or project delete, or re-import take their takes by FK cascade; a sweep removes generations of `source="chapter_render"` whose take is gone, together with their files. It runs after those deletes and at boot.
8. **The book's lexicon on demand.** `POST /v1/projects/{id}/lexicon` returns the book's lexicon, making "<book> names" and setting it as the book's if it has none.

### 3b · Renderer

1. `components/StudioRender.vue` (the grid) and `components/StudioRenderChapter.vue` (the line page) are built from the mock and kept alive as Script's are. StudioView's Render section (`StudioView.vue:1028-1166`), its cache banner and its hand-rolled table go.
2. Rewrite moves to the line panel. These are deleted:
   - `StudioView.rewriteRow`, `runRewrite`, `acceptRewrite` and the modal (`:89-145`, `:1213-1260`);
   - `@rewrite` (`:1018`);
   - `@contextmenu` (`StudioScriptChapter.vue:658`).
3. Script's grid gains ＋ Add chapter, the ⋯ menu and the ＋ Add text paste dialog (the mock). `addText()` (`StudioScript.vue:177-198`) no longer goes to `#chapter`.
4. These are deleted:
   - `views/ChapterView.vue`;
   - the `/chapter` route (`router/index.js:20`);
   - the rail's Chapters item (`App.vue:43`, `:94-97` labels, `:145` help);
   - `stores/takes.js` (used only by ChapterView);
   - the links to `#chapter` (G5): `StudioDiscover.vue:411`, `StudioOverview.vue:246`, `StudioScript.vue:198`/`:235`, `StoriesView.vue:31`.
5. The Script chapter page's foot line ("…it re-renders, and its old take is kept") is rewritten to D4's words.

### 3c · Docs and records

- `docs/studio.md` §Render is rewritten: the grid, the line page, takes, stale, How it's said, the hatch, Compare, Rewrite and Pronunciation.
- `docs/studio.md` §Script gains the chapter verbs.
- `docs/chapter.md` and `docs/take-versioning.md` are deleted. Their living content folds into `studio.md`, and their help mappings move.
- `whats-new.md` gets an entry.
- The pages that point at the Chapters page are corrected: `getting-started`, `core-concepts`, `effects`, `generate` and `voices`.
- RESEARCH §3 holds this research's facts. TASKS records BUILT when the code is done.

## 4. Blast radius (greps run 2026-10-04)

| Change | Who calls / produces it (pasted grep) | What already lives on that path |
|---|---|---|
| `persist_block_take` writes audio, seed, key; clears old defaults | `api/takes_api.py:294,319` (POST /v1/blocks/{id}/render) · `render_jobs.py:392` (the job runner) | `Take(… is_default=True)` with no default cleared (`render_jobs.py:83`); duration assumes 16 kHz (`:79`); no `audio_path` → `/v1/generations/{id}/audio` answers "no audio on disk" (`takes_api.py:270`) |
| One inputs key | `render_core.py:732-742` (render_line) · `:600-610` (probe_line_cached) | description-voice seed applied before the key (`:598`, `:724`); key holds lexicon *effect*, not ids (2026-09-30) |
| `_resolve_scene_to_lines` carries block_id, takes played | `render_chapter_api.py:382` (cache stats) · `:421` (render_chapter) · `:534` (render_scene_to_wav) · `api/align_api.py:110` · `api/projects_api.py:1033` (QC) · `export_audiobook.py:145` · tests `test_render_chapter_scene_mode.py` (19 calls), `test_render_truth.py:213,226`, `test_project_lexicon.py:325,342,354`, `test_voice_instruct.py:78`, `test_pause_between_lines.py:31` | strict refusal names lines / uncast / voiceless (`:223-246`); markers skip; left-out dialogue tags |
| `render_scene_to_wav` plays takes | `api/align_api.py:115` (captions) · `api/projects_api.py:1027` (QC) · `export_audiobook.py:105` (M4B) · tests `test_export_audiobook.py:144,163,187`, `test_pause_between_lines.py:51`, `test_project_lexicon.py:377`, `test_render_truth.py:314,336,357,401` | mastering in the WAV domain; QC strict=False |
| `concat_lines` gets take PCM | `render_chapter_api.py:467,551` · tests `test_line_pause_and_direction.py` (8), `test_pause_between_lines.py:39`, `test_project_lexicon.py:362` | pause_before/after per line; mixed sample rates resampled (`test_line_pause_and_direction.py:140`) |
| Line override in metadata, line wins | `render_chapter_api.py:66-85,202-207` (`_block_pause_after`, persona wins today) · imports write `pause_after_ms`: `projects_api.py:754-761`, `adapters/csv_lines.py:94,111`, `srt.py:88-93`, `audacity_labels.py:87` | PATCH metadata replaces the whole JSON (`projects_api.py:488`) — carries `prev_speaker_id`, `marker`, … |
| `/v1/render/cache-stats` leaves Studio | `StudioView.vue:252,272,637-657,1059-1062` | Overview's rollup `cache:` (`:272` → `studioStatus.js`) |
| Takes deleted with their audio | `projects_api.py:324` (project) · `:403` (scene) · `:529` (block) · `:629` (merge) · `:1290` (sheet re-import) · `extraction_api.py:482` (re-cut) · `takes_api.py:95` (take) · `:187` (generation) · `bulk_delete_api.py:114` (cascades to takes) | `Generation.block_id` is `SET NULL` (`database/models.py:295`), so rows and files outlive their takes today |
| `Generation(` producers | `render_jobs.py:70` · `mcp/tools.py:211` | MCP writes to `generations_root` already |
| `Take(` producers | `render_jobs.py:83` only | — |
| Default take readers | `api/project_export_api.py:189` (project export) · `takes_api.py:57,67,93` | delete refuses the default take (`takes_api.py:93`) |
| ChapterView deleted | `router/index.js:20` · `App.vue:43,94-97,145` · `#chapter` in `StudioDiscover.vue:411`, `StudioOverview.vue:246`, `StudioScript.vue:198,235`, `StoriesView.vue:31` · `stores/takes.js` (ChapterView only) · `jv.lexicon.prefill` writer `ChapterView.vue:547` (reader `LexiconsView.vue:431`) · `goTimeline` → `#stories` `ChapterView.vue:387` | StoriesView is inert ("no API calls until /v1/stories exists", `StoriesView.vue:17`) |
| Rewrite moved | `StudioView.vue:89,1018` · `StudioScriptChapter.vue:658` | rewrite refuses narration and speaker-less lines (`StudioView.vue:92-98`) |
| Per-line render door | `export_voicelines._render_block_production` ← `takes_api.py:292,312` · `export_voicelines.py:63,207` (game export) · `render_jobs.py:291,359` · tests `test_export_voicelines.py:55`, `test_persona_render.py:306`, `test_project_lexicon.py:464-469`, `test_render_jobs.py` (5) | shares `persona_render.plan_line` with the chapter (2026-10-03) |

**Found while building (2026-10-04), added to the build:**

| Change | Who calls / produces it | What lives on that path |
|---|---|---|
| Home's Continue card reads chapters rendered | `HomeView.vue:183` read `/v1/render/cache-stats` → now `/v1/projects/{id}/render_state` | a chapter counts as rendered when every line has a take, stale or not |
| Export warns of stale lines (G3) | `ExportPanel.vue` — the ACX checklist card | a warning only; the M4B still ships every ★ take |
| The game per-line export ships ★ takes (D4) | `export_voicelines.export_voicelines` (the loop) and `collect_block_specs` (the warm set) | the manifest's `text` and `text_hash` are the take's words when a take ships |

## 5. Gaps — DECIDED 2026-10-04: "your rec go"

The questions and leans exactly as they were shown in chat, each lean approved:

1. **↻ New take and the seed.** The same seed gives the same audio, from the cache.
   Lean: a new take uses a new seed and keeps it. Changing the persona's seed marks the lines
   that used it stale. On a description voice the button warns that a new seed can change who
   speaks.
2. **Does rendering in Render save takes?**
   Lean: yes. "⚡ Render N ready", a chapter's ▶ Render and "↻ Re-render all" give every line a
   take. The export, ACX check and captions render a line with no take as today and save nothing.
3. **Exporting with stale lines.**
   Lean: Export's checklist warns "N lines are stale" but doesn't block.
4. **The podcast "Open Timeline ➜" button.** It only exists on the old Chapters page, and the
   Timeline page does nothing yet.
   Lean: it goes with the page; Timeline stays in the sidebar for podcasts.
5. **The sidebar's Chapters item and the five links to it.**
   Lean: remove the item; every link goes to Studio · Script.
6. **The old page's empty state** (Import a manuscript / ＋ Add chapter).
   Lean: it moves to Script's empty grid, as the mock shows.
7. **Imported pause vs the persona's pause.** Today the persona's pause wins. The per-line
   override is stored in that same field, and "for this line only" has to win.
   Lean: the line's value wins, imported ones included.
8. **The "lines waiting on an engine" line** from the old HTML mock.
   Lean: not in Slice 4.
9. **The game Lines grid's stale rule** (it only checks text).
   Lean: it uses the same line states, from the same server function.
10. **Takes made before this slice** have no record of what they were made from.
    Lean: they show as stale; your data reset clears them anyway.
