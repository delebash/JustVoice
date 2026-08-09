# The Script tab restore — saved analysis, non-destructive Apply, real manual fixes

**Date:** 2026-08-08. **Baseline:** commit `5ee7d3a`, working tree clean.
**Status:** every decision below is TAKEN by the user, question by question, this
session. **The GO for the build is NOT given** — this document is the record so
the work can start cold without re-deriving anything.

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
