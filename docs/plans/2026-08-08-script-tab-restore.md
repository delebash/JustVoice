# The Script tab restore — saved analysis, non-destructive Apply, real manual fixes

**Date:** 2026-08-08. **Baseline:** commit `5ee7d3a`, working tree clean.
**Status:** decided, then **BUILT** the same day (go given after `a8b2126`).
§§1–8 are the record as decided; **§10 is what actually shipped**, including
three things the build found that the decisions could not have known.

Every `file:line` here was verified by reading the file against `5ee7d3a`, not by
grep-and-infer. Absence claims say so explicitly.

---

## 1. Why this exists — the user's words

> "i thought we had a better design for fixing mistakes, the only thing i see is
> that a user can change the speaker but not narrator, i really thought we had a
> way for user to really fix any mistakes, what i source tag, propagated, floor,
> what do these mean how are they assigned"

> "the script used to save an anyalys now if i change chapters it does not, what
> other things did we loose when we transferred from jw? the heading is in studio
> like render 0/4 rendered the script used to show this and now doesn't"

Three complaints, all confirmed real: attribution cannot be corrected, the
analysis is not saved, and the Script step card shows no progress count.

---

## 2. How attribution actually works (so nobody re-derives it)

Four inputs, in this order. **The LLM is step 3 of 4 and never decides
narration-vs-dialogue.**

**Step 1 — segmentation. Pure regex, pre-LLM.** `segmentation.py`
- `split_into_paragraphs` (`:34`) splits on blank lines.
- `segment_paragraphs` (`:59-91`) splits each paragraph on **double** quote
  marks. Inside quotes → a `dialogue` segment with a chapter-wide `[D#]` id;
  outside → `narration` segments.
- **Single quotes are deliberately ignored** (`:8-10`, `:20-25`) to avoid
  apostrophe false positives. **A UK-punctuated manuscript (`'Where is he?'`)
  therefore segments to ZERO dialogue and reads entirely as narration.** This is
  the single largest attribution failure mode in the system and no amount of
  re-analyzing fixes it.
- There is an unclosed-curly-quote branch (`:22`) for dialogue running to line end.
- Deterministic: identical text always yields an identical split.

**Step 2 — anchors. Also pre-LLM, also regex.** `anchors.py`
- The name matcher is built from every cast character's **name + aliases**
  (`:49-64`), sorted longest-first.
- **Tag pass** (`:112-158`): a narration span containing both a character name
  and a dialogue verb within **18 characters** anchors the adjacent quote — but
  only when the neighbour is in the **same paragraph**.
- **Propagation pass** (`:160-187`): forward then backward sweep; unanchored
  dialogue inherits the nearest anchored speaker, **same paragraph only**.
- Anchors **beat the LLM** on tie-break (`pipeline.py:405-419`).

**Step 3 — the LLM.** `prompts.py`
- `format_paragraphs` (`:113-129`) sends the **whole paragraph**, narration
  included, with `[D#]` markers inline on the dialogue. The model reads narration
  as context; it only ever *answers* for `[D#]`. Rule 1 of `DIRECT_SYSTEM`
  (`:26`): *"Narration is never tagged — only the [D#] dialogue segments."*
- `GUIDED_SYSTEM` = `DIRECT_SYSTEM` + four worked examples (`:40-75`).
- `format_corrections` (`:100-110`) injects past corrections as worked examples.
- Preset `p_extract`, **temperature 0.2** (`seed_presets.py:29-30`, mapping at
  `:182-183`) — low variance, NOT deterministic.

**Step 4 — the confidence floor.** `pipeline.py`
- `ROUTE_FLOORS = {"guided": 0.7, "direct": 0.5}` (`:126`) — route data, not a
  user setting.
- **The floor only ever DEMOTES** (`:423-434`): below it, the speaker is replaced
  with `unknown` and the model's original pick is kept in `floored_from`.
  Nothing anywhere raises a confidence.

### The six `source` values (`pipeline.py:52`)

| value | who decided | confidence written | where |
|---|---|---|---|
| `narration` | segmenter | **1.0** | `:386-394` — LLM never answers for it |
| `tag` | regex | **1.0** | name+verb ≤18 chars, same paragraph |
| `propagated` | regex | **1.0** | sweep fill, same paragraph |
| `llm` | the model | the model's number | cleared the floor |
| `floored` | the floor | the model's number | speaker replaced with `unknown` |
| `manual` / `corrected` | the user | unchanged | see decision 8 |

**Anchors assert confidence 1.0** (`pipeline.py:414`) — a regex heuristic
claiming certainty. Worth knowing when reading the table.

---

## 3. Verified findings — what is broken

All read against `5ee7d3a`.

| # | Finding | Cite |
|---|---|---|
| F1 | The analysis is a ref, wiped on every chapter change, never rehydrated. Only two writes to `analyzeRows` exist in the whole file. | `StudioView.vue:955-959`, `:998` |
| F2 | The endpoint deliberately does not persist — **including the new streaming endpoint** added in `5ee7d3a`. | `extraction_api.py:1-12`; stream endpoint read in full, no `Block`/`db.add`/`commit` |
| F3 | Apply POSTs new blocks and never removes the old ones. Its own comment assumes an empty scene — but `sceneText` is built **from the existing blocks**, so the scene is never empty. **Apply duplicates the whole chapter.** | `:1091-1125` + `:941-953` |
| F4 | Apply writes `persona_id = null` for narrator AND unknown rows. | `:1099` |
| F5 | Null-persona blocks are **silently skipped at render**. A narration line or a floored line vanishes from the audiobook with no signal. | `render_chapter_api.py:99-109` |
| F6 | The speaker dropdown is gated to dialogue rows; narration renders as static text. | `:1830`, `:1836` |
| F7 | A row edit mutates the local ref only — nothing is sent to the server. | `:1085-1089` |
| F8 | **Correction memory is never written from Studio.** `record_correction` fires only on `PATCH /v1/blocks/{id}` when `persona_id` changes; **nothing in `src/` ever PATCHes `persona_id`** (exhaustive grep — the only two block PATCHes are `direction` and `text`, both in ChapterView). `create_block` records nothing. | `projects_api.py:468-476`, `:413-432` |
| F9 | The corrections loop is real on the server side — the rows DO reach the prompt. Only the writer is missing. | `extraction_api.py:94-114` → `prompts.py:100-110` |
| F10 | `kind` is computed, displayed, then **thrown away**. `Block` has no `kind` column; neither request schema has a `kind` field; Apply's body omits it. | `models.py:214-236`, `projects_api.py:185-204`, `StudioView.vue:1104-1111` |
| F11 | Nothing downstream consumes `kind` — **zero** references in `export_audiobook.py`, `export_voicelines.py`, `render_chapter_api.py`, `render_core.py`. In the renderer it appears 4× , all inside the Script table. | exhaustive grep |
| F12 | The Script step card's subtitle is the hardcoded string `"speaker analysis"`. Cast and Render get live counts; Script never did. | `:302-318` |
| F13 | `Take.block_id` is `ondelete="CASCADE"` — **deleting a block destroys its takes**: approved audio, labels, lineage. Generations survive orphaned (`SET NULL`). | `models.py:297`, `:251` |
| F14 | Source chip classes are defined **twice** as scoped one-offs and have already drifted; nothing canonical exists in `styles.css` (grep, absence). Studio has a `manual` variant; the Lab has none and writes `corrected`, which has no chip class at all. | `StudioView.vue:2586-2602`, `AttributionResult.vue:206-216`, `:126` |
| F15 | The Lab writes human route words ("with examples"/"rules only") per the copy law; Studio prints the raw route keys. Both print raw `source` keys, and neither has a legend. Design-law checklist #5 forbids internal jargon in user copy. | `AttributionResult.vue:68` vs `StudioView.vue:187`; `design-law.md:55` |
| F16 | The Narrator persona is created with every audiobook project and sits in the cast, but **nothing ever binds it to a block**. Import binds `persona_id` only when the source names a character; `book_prose` sets no `character_id` at all (grep, absence). | `projects_api.py:264-277`, `:687-718` |
| F17 | `DELETE /v1/blocks/{id}` exists and the renderer has a wrapper that **nothing calls**. | `projects_api.py:483`, `projects.js:66` |
| F18 | ChapterView's "Script" column is derived from block/persona counts, not from any record of analysis — "not analyzed" actually means "zero blocks". | `ChapterView.vue:605-611` |

### Docs that are wrong

- `docs/studio.md:20` — says a `floored_from` row means confidence was *"clamped
  **up** by your floor setting"*. **Backwards.** The floor only demotes.
  `docs/ai-features.md:161` states it correctly.
- `docs/studio.md:21` — *"Corrections teach the system: when you fix a row, that
  correction is remembered and fed back into future Analyze runs"*. **False for
  the Studio flow** (F8). True only in the Lab.

---

## 4. What was lost from JustWrite, and when

JW's Audio Studio was deleted in JW commit **`32a53b4`** ("JW audio removal (1/2):
delete the audio pipeline + Studio/Speaker Lab"). Read from `32a53b4^`:

- `stores/studio.js` — `scripts` persisted **per chapter** to disk; survived
  reload and chapter switching. Plus `lastScriptChapter`, `clearScript()`,
  `chaptersWithScripts`, `speakersByChapter`.
- `views/StudioView.vue:1074-1084` — **"Re-analyze"** as the permanent button;
  **"Batch analyze…"** modal with per-chapter checkboxes and "select all
  unscripted"; header meta *"Calls <provider> · N lines analyzed"*.
- Its row dropdown had **no dialogue gate** — every row was assignable.
- Empty state: *"No analysis yet — click Re-analyze to run speaker detection."*
- Render refused a chapter with no script: *"No script for X. Re-analyze first."*

**It was never carried over.** JV's Script tab was born without hydration at
`35489ea` (Phase 4 / Slice 2) — the `loadSceneText` + wipe watcher there is
byte-identical to today's. The Script step card was born with its static string at
`876d3dc`. Nothing was "dropped"; it was never built here.

**The `attributed/n` count the user remembers** does exist — in Chapters' workflow
strip, step 3 (`ChapterView.vue:688`), not in Studio.

---

## 5. The nine decisions — TAKEN

1. **Collision** — resolved. The concurrent session's streaming work landed as
   `5ee7d3a`; tree clean. No longer a constraint.
2. **Saving** — the analysis **auto-persists when Analyze finishes**. "This
   chapter is analyzed" is **derived from `Block.source` being non-null**. No
   schema change.
3. **Re-analyze** — **never re-cuts the text.** It re-runs anchors, corrections
   and the model against the existing blocks; block count never changes. It
   **skips rows the user has corrected** and only re-decides the rest.
4. **Narration rows** — bind to the **Narrator persona**, not null.
5. **Unknown rows** — the render **stops and lists them**, with a one-click
   "assign all unknown → Narrator" inside the blocker.
6. **Manual fixes** — build the **speaker dropdown on every row** and the
   **bulk unknown → Narrator**. **Skip** the kind toggle. **Defer** split, merge
   and reorder. The **Kind column is derived from `source`** — nothing new stored.
7. **Script ↔ Lab** — share a **canonical chip class + a helpers module + one
   small speaker cell**. Each surface keeps its own container.
8. **The source word** — **`corrected`** everywhere.
9. **Order** — the save bug, the duplication bug, the narrator bug first.

### Why decision 3 is free, and what re-analyze is actually for

Re-running on unchanged text produces an identical split, so skipping
re-segmentation costs nothing. What *does* change between runs:

- **The cast** → anchors are built from names + aliases (`anchors.py:49-64`), so
  promoting discovered speakers makes previously-`unknown` lines anchorable
  **with no LLM involved**.
- **Corrections** → the 12 most recent per project reach the prompt
  (`extraction_api.py:94-114` → `prompts.py:100-110`). This is the point of
  re-analyze: fix five rows, re-run, the model applies that reasoning elsewhere.
- **The model** → temperature 0.2, so minor drift even with identical inputs.

If neither cast nor corrections changed, re-analyze burns tokens for nothing.

---

## 6. The build, in order

**Phase 1 — the three bugs (decision 9).**

1. **Persist on Analyze.** When the run returns, write the rows onto the scene's
   blocks. Because of decision 3 this is a **PATCH pass over existing blocks**,
   not a create — `UpdateBlockRequest` already carries every field needed:
   `persona_id`, `extraction_confidence`, `source` (`projects_api.py:197-204`).
   - **First analyze of an imported chapter is the one case that re-segments**,
     because import creates one block per paragraph and the segmenter splits
     paragraphs into narration/dialogue spans. No takes exist yet, so a replace is
     safe there. Guard it: re-segment only when the scene has **zero takes**.
2. **Hydrate on entry.** Entering a chapter rebuilds the rows from its blocks
   (`persona_id`, `extraction_confidence`, `source`). Any block with a non-null
   `source` → the chapter is analyzed; show the table and **Re-analyze**. None →
   "not analyzed" empty state with **Analyze**. Deletes the F1 wipe.
3. **Kill the duplicating Apply** (F3). With 1 and 2 in place the separate Apply
   button has no job left — persistence happens at Analyze. Remove it rather than
   fix it.
4. **Bind the Narrator** (decision 4). Narration rows get the project's Narrator
   persona id. Fixes F16 for every newly-analyzed chapter.
5. **The Script step card count** (F12) — now computable: chapters with any
   `source`-bearing block, over total. Mirrors the Render card's shape.

**Phase 2 — the manual fixes (decision 6).**

6. **Drop the dialogue gate** (`StudioView.vue:1830`). Every row gets the
   dropdown. Wire the change to `PATCH /v1/blocks/{id}` with `persona_id` —
   **which makes `record_correction` fire and closes F8/F9 for free.**
7. **Bulk "all unknown → Narrator"** — the same PATCH across rows. Also the
   one-click inside decision 5's render blocker.
8. **Render blocks on unknowns** (decision 5) — replace the silent skip at
   `render_chapter_api.py:99-109` with a refusal that names the offending lines.

**Phase 3 — the shared vocabulary (decision 7).**

9. `.jv-source-chip` + its six variants promoted into `src/styles/styles.css`
   (design-law rule #2 — a scoped one-off is forbidden). Both surfaces adopt it;
   the two scoped copies die.
10. `src/services/attribution.js`, beside the existing `attributionLab.js` —
    `speakerLabel()`, `routeWords()`, `sourceMeaning()` (the legend both surfaces
    lack), `reassignOptions(cast)`. Also folds `loadSceneText`
    (`StudioView.vue:947-949`) and `chapterProse` (`labTestData.js:27-32`), which
    are the same function written twice.
11. One small `<AttributionSpeakerCell>` — label + chip + confidence + the
    disagreement marker. Inline elements only, so it drops into a `<td>` or a
    `<span>` unchanged.
12. **Studio adopts the Lab's human route words** (F15) and both get a legend, per
    design-law checklist #5.
13. **`corrected` replaces `manual`** (decision 8) in `AttributionResult.vue:126`,
    `setRowSpeaker`, and the `Block.source` comment at `models.py:234`.

**Docs, in the same change** (CLAUDE.md docs law):
- Fix `docs/studio.md:20` — the floor **demotes**, it never clamps up.
- Fix `docs/studio.md:21` — only true once step 6 lands; until then the sentence
  is false.
- Document the six `source` values as a user-facing legend. They are currently
  explained nowhere.
- Document that re-analyze does not re-cut the text and skips corrected rows.

---

## 7. Rejected — so it stays rejected

- **Mounting `AttributionResult` directly in Studio.** Its layout is tuned for a
  narrow Lab column (`.attr__who { width: 170px }`, 420px scroller) and its props
  are column machinery. Studio needs a full-width table with a header and
  eventually bulk-select. Design-law checklist #7: *"References… are for
  extracting PRINCIPLES. Copying a reference's layout inherits its flaws."*
- **A single shared row component.** `<tr>` and `<div>` rows are not
  interchangeable; the container differing is correct. Only the vocabulary must
  not differ.
- **Adding "load a real chapter" to the Lab.** It already does this —
  `LAB_TEST_ACTIONS` binds `ATTR_PICKERS`, whose chapters picker fills
  `paragraphs` from `chapterProse(sceneId)` (`labTestData.js:194-207`, `:27-32`),
  the same text Studio builds. Landed 2026-08-06 as Part 4 of the Lab plan.
- **A "change kind" toggle.** Nothing consumes `kind` (F11) and there is nowhere
  to store it (F10). Dropping the dialogue gate solves the same problem directly.
- **Storing `kind` to keep the Kind column alive.** Derive it from `source`
  instead — a `narration` row was narration, everything else was dialogue. Wrong
  only for a hand-corrected narration row, which is cosmetic.
- **Split / merge / reorder in the first pass.** All three change the block count,
  which is exactly the operation that destroys takes via F13's CASCADE. They need
  their own confirm-before-destroying design.
- **A wholesale block replace on re-analyze.** Same reason — F13.
- **A one-time DB migration.** Pre-release rule: seeds only, the user resets.

---

## 8. Known gaps this plan does NOT close

- **Single-quoted manuscripts segment to zero dialogue** (§2). Nothing in this
  plan fixes it. Manual split (deferred) would be the workaround; a segmenter
  option would be the real fix. Not scoped here.
- **Anchor-vs-LLM disagreement is computed, serialized and dropped.**
  `llm_speaker` / `llm_confidence` ride every anchor-won row and
  `pipeline.py:57-60` says they exist "so the Speaker Lab can render disagreement
  badges" — **zero references in `src/`** (exhaustive grep). Rendering them is the
  best "check this row" signal available and costs one predicate. Not decided.
- **ChapterView's Script column** (F18) becomes fixable once decision 2 lands, but
  changing it is not scoped here.

---

## 9. How to verify the build

The renderer gate, per CLAUDE.md:

```bash
justvoice-server serve --host 127.0.0.1 --port 8741   # background
npm run build:vite
node scripts/smoke.js
cd server && ruff check . && pytest
```

Manual checks the smoke cannot make:
1. Analyze a chapter, switch to another chapter, switch back — **the analysis is
   still there.**
2. Analyze twice — **the chapter does not double in length.**
3. Analyze a chapter, render it — **the narration is audible**, not silently
   dropped.
4. Correct a row, re-analyze — **the corrected row survives**, and similar lines
   improve.
5. A chapter with unknowns — **the render refuses and names them.**

---

## 10. What shipped

All three phases, plus docs. Every decision landed; three of them needed a
mechanism the decisions did not specify, and the build turned up three facts
that were not visible from reading alone.

### Where the work went

**Server.** `extraction_api.py` gained `_persist_attribution` — the whole of
decisions 2/3/4 in one place, called by both scene-scoped analyze routes (the
stream's worker opens its own Session; the request-scoped one belongs to the
dependency and is not thread-safe). `projects_api.py` gained
`_drop_scene_source_text` and `_ensure_narrator`. `render_chapter_api.py`'s
resolver gained `strict=`. `models.py`'s `Block.source` comment is now the
real six-value list.

**Renderer.** `StudioView.vue`: `hydrateRows` replaces the wipe watcher,
`applyAnalyzed` and its button are gone, `setRowSpeaker` PATCHes, plus the
bulk assign, the render blocker modal, the legend, and the live step-card
count. `services/attribution.js` is new. `AttributionResult.vue` and
`labTestData.js` adopt it. `.jv-source-chip` is canonical in `styles.css`;
both scoped copies are deleted.

**Tests.** `tests/test_analyze_persist.py` (6, new) and three strict-mode
cases in `tests/test_render_chapter_scene_mode.py`.

### Three mechanisms the decisions didn't specify

1. **Persistence is server-side, not a renderer PATCH loop.** §6 step 1 assumed
   the renderer would PATCH each block. A 300-segment chapter would be 300
   sequential requests from the browser — the shape of the Apply button being
   deleted. The endpoint that produced the rows writes them, in one
   transaction, and the renderer re-reads the blocks afterwards so the table
   and the database can't disagree.
2. **The analyzed prose is stored on the scene** (`Scene.metadata_json`'s
   `source_text` — an existing column, no schema change). Decision 3 says
   re-analyze must not re-cut the text, and that turns out to be a correctness
   requirement, not an optimization: **the segmenter is not round-trippable.**
   It returns the INSIDE of a quoted span, so blocks written from raw row text
   would lose the manuscript's quote marks — and re-segmenting quoteless text
   finds zero dialogue, collapsing the whole chapter to narration on the second
   run. Two guards: dialogue blocks are stored WITH their quote marks (the pair
   the source actually used), and the exact analyzed text is kept so a
   re-analyze reproduces the split. Editing or adding a block drops the stored
   copy, because it then describes a chapter that no longer exists.
3. **No `<AttributionSpeakerCell>`** (§6 step 11). It cannot exist: after
   decision 6 both surfaces render the same three things — a speaker dropdown,
   the source chip, a confidence readout — but Studio spreads them across three
   `<td>`s and the Lab packs them into one flex span. A component can't mount
   in three cells at once. The shared vocabulary ships as the canonical chip
   class + `services/attribution.js`; the chip's title carries the same legend
   text the Studio table shows in full.

### Three things the build found

- **Imported projects had no Narrator at all.** `create_project` made one;
  `_materialize_standard` never did — so every book that arrived from
  JustWrite (the primary workflow) had nothing for decision 4 to bind to.
  Both paths now call `_ensure_narrator`.
- **A speaker the model invents would fail the FK and kill the run.**
  `Block.persona_id` is a foreign key, and the model answers with ids from the
  cast it was given but nothing stops it inventing one. The persist step
  validates against the project's cast; an unrecognized name leaves the line
  unplaced, which is exactly what the unplaced banner and the render blocker
  are for. Caught by `test_extraction_stream.py`, which had been passing a
  fictional `"mara"`.
- **`floored_from` no longer displays.** It was per-run data that was never
  stored, and the table now always reads from blocks. The `floored` chip's
  tooltip says what happened instead. Restoring the "from X" audit line would
  need a column; not built.

### Two deliberate departures from the old UI

- **"unknown" left the speaker dropdown.** It was a value you could pick, and
  `UpdateBlockRequest` reads a null `persona_id` as "unchanged", so choosing it
  could never have saved. Unplaced is a state the pipeline leaves behind, not a
  choice; the way out is the dropdown or the bulk button.
- **The Kind column is derived** (`source == "narration"`), so a hand-corrected
  narration row now reads as dialogue. Cosmetic, and the alternative was
  storing a field nothing consumes — §7.

### Still open

§8's three gaps are unchanged and none are closed here: single-quoted
manuscripts still segment to zero dialogue, the anchor-vs-LLM disagreement
signal is still computed and dropped (both in `docs/dev/IDEAS.md`), and
ChapterView's Script column still counts blocks rather than reading
`Block.source` — now trivially fixable, still not scoped.

---

## 11. The blast-radius sweep — six defects the plan could not have found

The first build passed its gate and was still wrong in six places. Every one
was a **consequence of a change**, not a property of the old code, and the plan
never asked that question: it verified the diagnosis, never the fix's
dependents. The rule that came out of it is now in `~/.claude/rules.md` — a
change that alters behavior is not done until it lists, per change, every
caller of what changed, every producer of the data being deleted, and every
exception already living on that path, each as a pasted grep.

Run that way, the sweep is finite. It found:

| # | Found by asking | Defect |
|---|---|---|
| 1 | Which blocks are *legitimately* speaker-less? | **Podcast markers refused to render, forever.** Music/ad lines import speaker-less on purpose (`projects_api._materialize_standard`), and `ChapterView.vue:586` already excludes them *because not doing so once showed "unassigned speakers" forever*. The new refusal counted them. |
| 2 | Who calls the function I made strict? | **ACX QC and M4B export both hard-failed.** `project_qc` → `assemble_project` → `render_scene_to_wav`. One unplaced line in chapter 40 killed the report for chapters 1–39. |
| 3 | What else lives on a Block besides text? | **`metadata.source_ref` died in the re-cut** — re-import merges on it (`_reimport_update`'s `by_ref`), so the first analyze silently made a re-import duplicate the whole chapter. The exact failure this plan exists to end, re-entering through the import door. |
| 4 | (same question, asked exhaustively instead of once) | **`Block.direction` died too** — the performance note, seeded by import and hand-written in Chapters. Authored content, dropped without a word. |
| 5 | What happens when the run returns nothing? | **An empty result wiped the chapter.** No rows → the in-place test fails → the re-segment path deletes every block and writes none back. |
| 6 | Does the dedupe rule I'm relying on actually dedupe? | **Two Narrators.** `ensure_project_persona` dedupes on (imported_from, imported_id), NOT on name, and `docs/import-and-export.md:50` shows a book shipping its own `"Narrator"` character. |

Two more came from the same sweep and were fixed with them: the re-wrap
invented a closing quote for dialogue the segmenter had matched *unclosed*
(`segmentation.py:22`), putting punctuation in the manuscript the author never
wrote; and the `source_ref` carry-over compared a raw join against the
renderer's `proseFromBlocks`, which trims and drops empties — one blank block
would have silently skipped the carry-over for a whole chapter.

### Where the policy split, and why that is not a contradiction

The refusal is not uniform, deliberately:

- **M4B export refuses.** Shipping a book quietly missing lines is the failure
  the whole thing exists to prevent.
- **ACX QC reports.** It measures, it does not ship. A book spends most of its
  life half-cast; dying on the first unready chapter makes the tool useless for
  the middle of every job. Unready chapters come back `ok: false` with a `note`
  saying why — never as a pass.
- **The cache-stats probe stays lenient.** It answers "how much is cached" and
  runs on every Home/Studio visit.
- **Markers are exempt everywhere.** They are direction, not speech; they never
  produced audio and their absence is not a missing line.

The adopted Narrator is likewise not `is_builtin` — it came from the book, not
from us, so it stays deletable. `role_label` is what carries "this is the
narrator", and that is what every reader checks.

### Known and accepted, not fixed

- **`RenderJobBlock.block_id` is CASCADE**, so a re-cut drops a render job's
  per-block recovery rows. Job bookkeeping, not user work — takes are what the
  guard protects.
- **The render-job runner has its own resolver** and does not go through the
  refusal. It fails an unattributed block visibly rather than dropping it, so
  decision 5's guarantee holds by a different route.
- **An in-place re-analyze has no undo.** A bad run overwrites a good one
  except on corrected rows. That is the cost of auto-persist (decision 2).

> **§11's list is not the whole story.** Four more sweeps followed it and each
> found something. See §12 — and read that as the real lesson: one sweep is
> not a ritual you perform once and declare finished.

---

## 12. Sweeps 2–6 — what the first sweep still missed

§11 fixed the server. The passes after it took angles it never had, and each
one paid. The failures cluster, and the clusters are the lesson.

**Lifecycle — the class §11 could not see, because it only asked about
callers.**

- **Re-analyze could destroy a manuscript edit.** Studio is inside App.vue's
  `<KeepAlive>`, and `onActivated` only synced the tab and project. Edit a
  paragraph in Chapters, come back, hit Re-analyze — the view still held the
  pre-edit prose and wrote the old wording back. Both views now reload on
  re-entry when nothing else will.
- **Chapters listed blocks that no longer existed.** The mirror image: after
  Analyze re-cuts a chapter, the kept-alive block list still showed the old
  paragraphs, and editing one PATCHed a deleted id. Before this feature Studio
  never wrote blocks, so this could not happen — the change created it.
- **Cancel wrote anyway.** The stream's worker thread persisted the moment the
  pipeline returned, with nothing checking whether the client was still there.
  The toast said "Analyze cancelled" while the chapter was rewritten seconds
  later. The write now happens in the async layer, after
  `request.is_disconnected()`.
- **A fast chapter switch showed the wrong rows** — two awaits resolving in
  finish order, not selection order.

**One question answered three ways.** "Is this chapter attributed" had three
different implementations that disagreed on screen:

- Studio counted a chapter analyzed when a block carried a pipeline `source`.
  But **podcast imports arrive already cast** (`podcast_markdown` reads `HOST:`
  labels into `character_id`), so Studio called them *not analyzed* and offered
  an Analyze that discarded correct speaker names for model guesses.
- Studio's "unplaced" counter included markers and blank blocks that the render
  skips — so the banner promised a refusal that would never come, and *Assign
  all unplaced → Narrator* would have given a music cue a voice.
- ChapterView had the only correct exclusion, inline and unshared.

All four predicates now live in `services/attribution.js` (`isMarker`,
`isSpeakable`, `hasSpeakerInfo`, `isFullyAttributed`, `unplacedBlocks`) and
every surface reads them from there.

**The design law, violated in the act of enforcing it.** `.studio__legend` was
a scoped grid near-identical to `KeyboardCheatsheet`'s `.cheatsheet__list` —
same shape, different gap — which is F14, the defect this plan fixed for the
source chips, recreated in the same change. The legend's toggle was also a
borderless text-only button, which design-law rule 6 forbids by user decree.
Root cause: CLAUDE.md says read `docs/dev/design-law.md` before UI work, and I
did not. Now `.jv-deflist` and `.jv-table tr.jv-row--attention` are canonical,
both surfaces adopt them, and the toggle is a `UiButton` ghost.

**An approved decision quietly under-delivered.** §6 step 12 says Studio and
the Lab **both** get a legend. The Lab got tooltips and I counted that as
equivalent. It has the real legend now, from the same `SOURCE_LEGEND`.

**A comment that described a field it wasn't about.** `pipeline.py:52` listed
`"auto"` as a row source — `auto` belongs to `RoutePick.source`, a different
field — and omitted the two values persistence added. Corrected, pointing at
`models.py` as the full list.

### Still open, and deliberately not decided here

- **Custom projects can't finish.** They get the Script tab but no Narrator
  (`_NARRATOR_KINDS` is audiobook + podcast), so their narration is
  permanently unplaceable and the bulk button has nothing to target. The
  button now disables itself and says why instead of failing on click, but
  the real fix — give custom projects a Narrator, hide Script from them, or
  let the bulk action target any cast persona — reverses a recorded decision
  and is the user's call.
- **Projects imported before this change refuse to render** until re-analyzed.
  They used to "work" by silently dropping every narration line, so this is
  the defect surfacing, not a new one. Pre-release rule: the user resets.
- **The feature has never been driven against a live LLM in a session.** It is
  covered by tests and by reading; §9's manual checks remain unperformed.
- **The smoke's tab measurement is flaky.** One run reported LABS at 1206
  chars (Settings' value) where two immediate re-runs gave 628 — it can
  measure the previous page. Gate reliability, not a product defect.

### The last pass, which found no code at all

Reviewing the fixes above turned up one contradiction inside the same batch —
the N+1 taken out of `runAnalyze` had been put straight back into
`onActivated`, where it fires far more often — plus a guard missing on
`setRowSpeaker` that its bulk twin had, two unawaited loads racing in
ChapterView, and two comments that went stale the moment I wrote them. All
fixed.

Then a fifth pass found something that was not code:

- **Open work was living in this document instead of the tracker.** The
  TASKS.md item was deleted whole when the build closed — right for the
  finished build, wrong for what remained. The custom-project decision (yours)
  and the deferred split/merge/reorder existed only here, where the tracker is
  the thing that gets read. Both are now items in `docs/dev/TASKS.md`.
- **Four words for two conditions.** A line with nobody speaking it was
  "unplaced" in Studio and "has no speaker" in the server's refusal; a chapter
  in that state was "unassigned speakers" in Chapters and "not ready" in QC. I
  wrote three of the four while building the module whose entire purpose is
  one vocabulary. The app's existing words won: **"no speaker"** for a line,
  **"unassigned speakers"** for a chapter. Internal identifiers still read
  `unplaced*`; the copy law governs what users see, and renaming them was
  churn without a reader.

Five sweeps, and the classes ran: server blast radius → lifecycle → drift →
the project's own laws → process. The pattern worth keeping is that each pass
had to take an angle the previous one could not have taken; repeating an angle
found nothing every time it was tried.
