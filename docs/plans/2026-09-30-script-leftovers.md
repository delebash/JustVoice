<!-- SPDX-License-Identifier: MIT -->
# Slice 3's leftovers — edit, split and merge lines; speech marks; dialogue tags; the old Chapters page; one narrator rule

**Decided 2026-09-30** — the user: "finish slice 3 and related items", then "go" on the plan
below, presented the same day. The go covers everything in §1 except a push ("Pushing is a
separate word"). The tracker item is `docs/dev/TASKS.md` "Slice 3's leftovers". Read §1
before coding any part; §2 is what was built.

## 1. The plan as presented and approved (verbatim)

I have everything for the plan. What's left around Slice 3 is six design items (B1–B6), one measurement and one parked idea. The checks also turned up four defects. Nothing below is built yet; each part has my recommendation, and your go covers only what you name.

### Defects found (all verified)

1. **Editing a line makes the next Analyze worse.** Any edit, including today's right-click rewrite, throws away the chapter's stored text. Analyze then rebuilds the chapter with every line as its own paragraph. I ran the real functions on `“Come here,” said Marius, “now.”`:
   - Original paragraph: both lines attributed to Marius from "said Marius".
   - Rebuilt after an edit: none attributed that way, so every line goes to the AI.
2. **The old Chapters page has two broken buttons.**
   - "5 Export" throws a JavaScript error: `ChapterView.vue:697` calls `exportOpen` and `runExportQc`, and neither is defined on that page.
   - "Generate first take" and "Regenerate" render the line and then throw the audio away, so no take is ever saved (`ChapterView.vue:304-389`).
3. **Script's no-narrator banner reads "Assign N → nobody"** on a book with no narrator (`StudioScriptChapter.vue:115, 482`).
4. **Stale records:**
   - The tracker's OPEN line still lists Slice 3 (`TASKS.md:1175`).
   - The item "custom projects can never finish a chapter" (`TASKS.md:653`) is no longer true. Since the speakers split, a custom project can add a narrator on Cast.
   - `docs/chapter.md` describes a page that no longer exists.

### The plan, in build order

**A. Re-analyzing an edited chapter keeps its lines** (fixes defect 1; B1 and B2 need it)
- Once a chapter has been analyzed and then edited, Analyze works from the lines as they stand.
- Lines from the same paragraph are read together, so "said Marius" works again. Each line stays one line, and only the speakers are decided again.
- Chapters never edited behave as today: they are re-cut from their original text.

**B3. Speech in single quotes, «guillemets» and „German“ marks**
- Today only double quotes count as speech. A book written with single quotes comes out with no dialogue at all.
- New setting on Overview, **Speech marks**:
  - "Auto — from the text" (default)
  - "“Double”"
  - "‘Single’"
  - "«Guillemets»"
  - "„German“"
- Auto picks each chapter's main mark by counting. For example, The Speckled Band has 247 “ against 12 ‘, which are quotes inside the speech, so it gets Double.
- In single-quote mode an apostrophe between letters (don’t) never ends a speech.
- Known limit: a trailing apostrophe inside a speech (‘the boys’ bikes’) can still cut a line early. Split and Merge fix that by hand.
- Your three sample books must give exactly the same lines as now; their answer keys are already in the tests.
- Speech after a dash stays out of scope.

**B2 + B1. Edit, split and merge lines on Script's chapter page**
- These go in the ticked-lines bar, next to "Set the speaker" and "Swap". The rows themselves get no new buttons.
- **"✎ Edit…"** (exactly one line ticked): the line's text becomes an editor with three buttons, **Save**, **Split at the cursor** and **Cancel**.
  - Undo restores edited words.
  - A split gives two lines with the same speaker. The first half keeps the line's rendered takes; they become out of date and re-render. The second half is new.
- **"⇲ Merge"** (two or more ticked lines that sit next to each other): one line, texts joined with a space, taking the first line's speaker.
  - If the other lines have rendered takes, you are asked first: "Merge 3 lines? This deletes 2 rendered takes."
- Split and Merge have no Undo; they clear the Undo list, as Analyze does. A split is undone by merging, and a merge by splitting.
- Two new server endpoints do the split and the merge, renumbering the lines after them.
- The deferred tracker item "split / merge / reorder" (`TASKS.md:676`) closes, except reorder. Reorder isn't in this plan and needs its own word.

**B4. Leave out dialogue tags**
- New Overview switch, **"Leave out dialogue tags"**, off by default. Its hint: "The narrator skips lines like “said Marius,” that only say who spoke."
- A line is left out only when it is nothing but a tag ("said Marius," "she whispered." "Marius said quietly.") and sits next to a spoken line in the same paragraph.
- "said Marius, turning away" is still read.
- Chapter audio, M4B export and captions all use the same rule, so captions match the audio.
- Script marks those lines with a grey **"Left out"** tag, so you can see what won't be read.

**B5. The old Chapters page: fix it now, retire it with Slice 4**
- Remove the old "1 Import … 5 Export" strip (including the broken step) and put one **"Open in Studio ➜"** button in its place.
- Generate and Regenerate will save a real take, through the same path the Lines page uses. If that path can't render a book line, I stop and tell you.
- Rewrite `docs/chapter.md` to describe the page as it is.
- Record in the Slice 4 entry, as a proposal only, that this page goes away once Render has its line panel and chapter add/rename/reorder/delete moves into Studio.

**B6. Custom projects and the narrator**
- Close the stale tracker item.
- When a book has no narrator, the Script banner says "This book has no narrator — choose one on Cast ➜" instead of offering a dead button.
- **One narrator rule.** Today the server also treats any speaker *named* "Narrator" as the narrator, while Studio and Cast look only at the role. The fix:
  - The server looks only at the role.
  - Importing a custom project gives the role to a character named "Narrator", as audiobook and podcast imports already do.
  - Your data has one narrator, and it already holds the role (`('The Ninth Facet','audiobook','Narrator','narrator')`), so nothing changes there.

**Long-chapter measurement**
- Your longest chapter is 81 lines ("The Same Hour"). I'd do this:
  1. Import The Speckled Band as one chapter in a temporary project named "Measure — Speckled Band (delete me)", with the cast from its answer key.
  2. Analyze it in the real app, about 490 lines.
  3. Time how fast the chapter page opens and scrolls, the same way the 78-line chapter was measured (183–326 ms to open, 60 fps scrolling).
  4. Delete that project afterwards.
- If it's slow, I report the numbers and change nothing without your word.

**"Read by you"**: stays parked. You said to decide after using the new Script on a real book.

### What each change touches (pasted greps)

| Change | Hit | Effect |
|---|---|---|
| A | `src/services/chapterRun.js:102:  const stored = (row \|\| scene).metadata?.source_text;` | the page picks the text; the server takes over for edited chapters |
| A | `src/services/chapterRun.js:105:  return proseFromBlocks(...)` | the path that scrambles paragraphs |
| A | `src/services/labTestData.js:33:  const text = proseFromBlocks(...)` | Lab only, unchanged |
| A | `projects_api.py:425/454/498: _drop_scene_source_text(...)` | add, edit and delete mark a chapter edited |
| A | `extraction_api.py:320: meta["source_text"] = text` | written by Analyze, unchanged |
| A | `extraction_api.py:466` / `:541` / `:716`, `labs/extraction/run.py:109` (calls into `analyze_scene`) | the two chapter paths (466, 541) gain the kept lines; analyze-text (716) and the Lab stay text-based |
| A | `extraction_api.py:392-404` (409 "would have to re-cut it") | no longer reached for edited chapters |
| B3 | `segmentation.py:26: _DIALOGUE_PATTERN = re.compile(` | the change itself |
| B3 | `pipeline.py:611-612`, `identify.py:207, 219`, `extraction_api.py:251, 260`, `eval_attribution.py:51, 80, 86, 212` | use the segmenter; they get the chosen marks |
| B3 | `extraction_api.py:188: _QUOTE_PAIRS = (("“", "”"), ('"', '"'))` (used at `:206, :209, :316`) | learns the new pairs |
| B3 | `flags.py:75` `quote_left_open`, `flags.py:205` `spoken_block` | learn the new marks |
| B3 | `test_script_api.py:246 test_no_dialogue_found` (uses `'Wait,' she said.`) | pins "single quotes aren't speech"; changes to dash speech |
| B3/B4 | `projects_api.py:279: p.metadata_json = json.dumps(body.metadata)` · `StudioOverview.vue:113: patch({ metadata: { ...meta.value, author: v } })` | the only settings writer merges, so the new keys are safe; no database change, no reset |
| B1/B2 | block PATCH callers: `StudioScriptChapter.vue:196, 255` · `StudioView.vue:135, 591` · `ChapterView.vue:56, 416` | unchanged; one new text PATCH from Script |
| B1/B2 | `scriptReview.js:16: function snapshot(line)` (+ `:139, :155, :190`) | gains the text, for Undo |
| B1 | `models.py:339` Take.block_id CASCADE · `:403` RenderJobBlock CASCADE · `:293` Generation SET NULL | merge deletes the merged-away lines' takes (asked first) |
| B1 | `projects_api.py:1127: by_ref = {block_ref(b): b ...}` | game re-import only; Script isn't shown for games |
| B1 | `StudioScriptChapter.vue:248: const u = popUndo(undoStack.value);` | stack cleared after split or merge |
| B4 | `render_chapter_api.py:403, 442, 573` · `export_audiobook.py:145` · `projects_api.py:898` · `align_api.py:108` | every user of the one door that skips the lines |
| B4 | `anchors.py:23: DIALOGUE_VERBS = [` | reused for tag detection |
| B4 | `render_chapter_api.py:148-149` (empty-text skip) · `render_core.performable_text` | existing skips, untouched |
| B5 | `ChapterView.vue:697: ... exportOpen.value = true; runExportQc();` | removed with the strip |
| B5 | `takes_api.py:281: @router.post("/v1/blocks/{block_id}/render"...)` · `LinesView.vue:137` | the path Generate will use |
| B5 | links into the page: `StudioScript.vue:198, 235` · `StoriesView.vue:31` · `StudioOverview.vue:186` · `StudioDiscover.vue:411` | unchanged |
| B6 | `extraction_api.py:299, 923` · `speakers_api.py:204` (`narrator_speaker_id`) | role only |
| B6 | `_speaker_helpers.py:200: NARRATOR_KINDS = {"audiobook", "podcast"}` · `projects_api.py:577` | custom added |
| B6 | `StudioScriptChapter.vue:115: const nameOf = ... "nobody"` · `:482` | the banner fix |

### What the go would cover

- Build A, B3, B1/B2, B4, B5 and B6 with tests.
- User docs updated in the same change: `studio.md`, `chapter.md`, `whats-new.md`, troubleshooting.
- Tracker and doc fixes: the four stale records plus `redesign.md:2090`, which says all three test books are curly-quoted when only The Speckled Band is.
- The long-chapter measurement, including creating and deleting the temporary project in your real data.
- The checks: ruff, the server suite, unit tests, the gate on your real data folder, and a live pass in the app with one window.
- A commit at the end. Pushing is a separate word.

Say "go" for all of it, or name the parts.

### Changed 2026-09-30 — B5 is dropped; the old Chapters page goes in Slice 4

The user, mid-build: "is there any reason to keep the chapters page, it think all should go in
render per the mock, what do you think?" — answered below; then "go". **This replaces B5**:
no fixes to the page, no `chapter.md` rewrite, no strip swap in this build. The answer as
presented (verbatim):

I agree: once Slice 4 lands, there's no reason to keep the Chapters page. Here is where each of its features goes, checked against the mock's screens:

- **Render's line panel** covers most of it. The mock has takes ("3, nothing is overwritten", live, take 2, take 1), a per-line "Gen", "Compare two", "Pronunciation", "Rewrite in June's voice", per-line pace/pitch/gain/pause, and "How it's said". That replaces the page's takes browser, Generate/Regenerate, compare, direction and "Fix pronunciation".
- **Pasting text** goes to Script, not Render. The mock's chapter grid has "＋ Add text", which opens an "Add its text" box for a chapter with no lines yet.
- **Gap: adding, renaming, reordering and deleting chapters has no home in the mock.** "Rename" appears only for projects and personas. Today only the Chapters page can do these. I'd put them on Script's chapter grid, since that is Studio's list of chapters: a "＋ Add chapter" button, and Rename, Move and Delete on each row. That needs a mock update first.
- **The Words and Est. audio columns** aren't in the mock. I'd drop them.

This changes B5 in the current build, since there's little point fixing a page that's about to go. I'd drop B5:
- no fixes to the page;
- no `chapter.md` rewrite;
- no strip swap.

Instead, the Slice 4 entry would record that the page is deleted there, where each feature moves, and the chapter-management gap. The rest of the approved plan stays as it is.

Say go if you want B5 swapped for that record.

## 2. Built (2026-09-30)

| Part | Where |
|---|---|
| A — an edited chapter is read as its lines | `extraction_api._lines_to_keep` / `_analysis_input`; `segmentation.segments_from_lines` / `paragraphs_of` / `strip_marks`; `pipeline.analyze_scene(marks=, segments=)`; `_persist_attribution(line_ids=)` — in place, no text stored, lines changed mid-run → 409 |
| B3 — Speech marks | `segmentation.SPEECH_MARKS` / `_PATTERNS` / `detect_marks` / `resolve_marks` / `left_open` / `opens_speech` / `QUOTE_PAIRS`; `flags.quote_left_open(text, marks)`, `flag_groups(marks=)`, `spoken_block` → `opens_speech`; `_block_text(marks)`; Discover `identify_speakers(marks=)`; the eval; Overview's select (`StudioOverview.vue`, `metadata.speech_marks`) |
| B2 + B1 — edit, split, merge | `POST /v1/blocks/{id}/split`, `POST /v1/scenes/{id}/blocks/merge` (`projects_api.py`); `ScriptLine.takes`; `scriptReview.editText` / `mergeState`; `StudioScriptChapter.vue` "✎ Edit…" (Save · Split at the cursor · Cancel) and "⇲ Merge" |
| B4 — Leave out dialogue tags | `extraction/tags.py` (`is_tag_only`, `left_out`, `left_out_blocks`); `render_chapter_api._resolve_scene_to_lines`; `ScriptLine.left_out` + the grey "Left out" tag; Overview's switch (`metadata.leave_out_tags`) |
| B6 — one narrator rule | `_speaker_helpers.narrator_speaker_id` (role only), `NARRATOR_KINDS` + custom; the Script banner links to Cast |
| Records | TASKS: the stale OPEN line, "two project kinds can never finish a chapter" deleted, "split / merge / reorder" narrowed to reorder; IDEAS: the single-quote entry deleted; redesign doc §8.24's sample claim corrected; `studio.md`, `whats-new.md`, `troubleshooting.md`, `code-map.md` |

**Checks.** ruff clean · server suite **914 passed** (880 before) — new: `test_segmentation.py`
(the styles, apostrophes, Auto on all three samples, the lines helper), `test_analyze_persist.py`
(an edited chapter keeps its lines and its anchors; takes never refuse it; lines changed mid-run
save nothing; a never-edited chapter is still cut from its text), `test_split_merge.py`,
`test_render_chapter_scene_mode.py` (left out when on, read when off, never blocks),
`test_narrator_on_import.py` (custom import adopts; a name alone is not the narrator),
`test_script_api.py` (single quotes found; "no dialogue found" now on dash speech) · unit **115
passed** (`scriptReview.test.js`: edit + Undo, speaker Undo never sends words, merge rules and take
counts) · biome clean · the gate on the real data dir, twice, zero JS errors.
Every chapter of the three sample books (37) reads as double under Auto, and the double pattern is
the old one unchanged, so their lines are identical.

**Live pass** — the real app, one window (`npm run tauri dev`), headless Chrome on the app's own
server (17494) and your data dir. Temporary projects were deleted after each run and your active
project restored (checked: the library holds only The Ninth Facet, active = The Ninth Facet).
- The Speckled Band imported as one chapter, cast from its answer key, analyzed on your model:
  161–197 s, **361 lines** (not the ~490 estimated).
- **The long chapter:** 361 rows open in **102–105 ms** (three opens) and scroll at a median
  **16.7 ms** a frame, p95 16.8, worst 16.9 — 60 fps. Not slow; no virtualization.
- No narrator yet: the banner shows "This book has no narrator — choose one on Cast ➜" and no
  "→ nobody" button.
- Edit → Save changed the words on the server; ↶ Undo put them back.
- Split at the cursor: 361 → 362 lines, same speaker; ⇲ Merge of the two halves: 361 lines, the
  original words back.
- Re-analyze after those edits: in place, 361 → 361, same ids, "said X" anchors 31 → 31.
- Leave out dialogue tags on: 33 lines left out (*said he,* · *said Holmes cheerily.* · *said
  she.* …), and the page shows them "Left out".
- Overview, clicked: the switch saves `leave_out_tags`, the select saves `speech_marks: single`,
  and both keep the other keys (Author survived). 0 JS errors throughout.

**Found by the live pass, and fixed:**
- **Script kept showing old lines after a change elsewhere.** The chapter page is kept alive
  (2026-09-29, so ticks, filters, selection and scroll survive leaving Script), but that kept its
  data too: switching on Leave out dialogue tags in Overview showed no "Left out" tag until a
  different chapter was opened — and a narrator chosen on Cast or a speaker removed on Discover
  was just as stale. Now the page re-reads its lines when it comes back into view; the ticks,
  filters, selection and scroll stay.
- **Save left the line ticked**, unlike every other action in the ticked-lines bar (Set the
  speaker, Swap, Looks right all clear the ticks). Save clears them now.

**Not in the plan — my choices, for the user's word:**
- Auto counts each paragraph's **first** speech mark, not every mark: counting every mark let
  quotes inside a speech outvote the speech (a paragraph of Helen quoting her sister read as
  single-quoted). The plan's words were "by counting".
- No hint under Speech marks (the plan gave none).
- Wording the plan didn't give: the split and merge toasts ("Split into two lines. Undo was
  cleared — Merge puts them back together." / "Merged N lines into one. Undo was cleared — Split
  takes them apart again."); the buttons' tooltips and disabled reasons; the "Left out" tooltip
  and its "What the columns mean" entry; a bad split's message ("Put the cursor inside the words
  — both new lines need some."); a run whose lines changed mid-way ("This chapter's lines changed
  while it was being analyzed, so nothing was saved. Analyze it again."); Undo's "Nothing to undo
  since the last split or merge"; the grid's "no dialogue found" and "can't re-cut" explanations,
  rewritten because the old ones became untrue.
- A split's second half copies the first's metadata except the import's line id — so a line
  "changed by the last Analyze" shows that mark on both halves.

## 3. Decided 2026-09-30 — the choices not in the plan

The user asked "whats your rec on the needs your word and explain it more"; the answer below was
presented; then "your rec on all", then "go". Verbatim:

Here is each item, what it means, and what I'd do.

**1. How Auto picks a chapter's speech marks**
- The plan said Auto picks the main mark "by counting". I count only the **first** speech mark in each paragraph, not every mark.
- Why: speech often has quotes inside it. In The Speckled Band, Helen quotes her sister: *“‘Tell me, Helen,’ said she, ‘have you ever…’”*. That paragraph has one double mark and two singles.
  - Counting every mark, a chapter with a few paragraphs like that is called single-quoted. Every real speech is then misread.
  - My own test caught exactly this.
- A speech's own mark always comes before any quote inside it, so counting first marks can't be outvoted that way.
- The weak spot is narration with a quoted word before any speech (*the 'Iron Duke' arrived*). That paragraph counts toward single, but one paragraph doesn't outweigh the rest of the chapter.
- All 37 chapters of the three sample books read as double.
- **Rec: keep it.**

**2. No hint under Speech marks**
- Every other field on Overview has a line of explanation under it. The plan gave none for this one, so I left it blank.
- While writing this answer I found something the hint should say. **A change only affects chapters you haven't edited.** A chapter you've edited is read as its lines (item A), so the new marks don't cut it again.
- Example: a single-quoted book analyzed as double shows "no dialogue found". You fix a line, then switch to ‘Single’ and re-analyze. Nothing changes, and today nothing in the app tells you why.
- **Rec: add a hint:** *"How the book marks speech. Takes effect the next time a chapter is analyzed; a chapter whose lines you've edited keeps them."*
  - Also add the same caveat to the grid's "no dialogue found" advice. It currently says "change the setting and re-analyze", which doesn't work for an edited chapter.
  - Add an entry to IDEAS.md for a **"Cut again from the text"** action for that case. The action itself would need its own decision.

**3. Wording the plan didn't give**

| Where | What I wrote |
|---|---|
| Toast after a split | "Split into two lines. Undo was cleared — Merge puts them back together." |
| Toast after a merge | "Merged 2 lines into one. Undo was cleared — Split takes them apart again." |
| Merge confirm (the plan's words, split in two) | title "Merge 3 lines?", text "This deletes 2 rendered takes.", button "Merge" |
| ✎ Edit… hover | "Edit this line's words, or split it in two" |
| ✎ Edit… when greyed out | "Tick exactly one line to edit its words." |
| ⇲ Merge hover | "Join the ticked lines into one, with the first line's speaker" |
| ⇲ Merge when greyed out | "Only lines that sit next to each other can be merged." |
| Split at the cursor hover | "The words after the cursor become a new line, with the same speaker" |
| Split with the cursor at either end | "Put the cursor inside the words — both new lines need some." |
| A line changed during an Analyze | "This chapter's lines changed while it was being analyzed, so nothing was saved. Analyze it again." |
| Left out hover | "Only says who spoke — Overview → Leave out dialogue tags is on, so the audio skips it" |
| Undo with nothing to undo | "Nothing to undo since the last split or merge" (or "…the last Analyze", or "…you opened this chapter") |
| Note under the table | "Changing the speaker or the words of a rendered line makes it stale — it re-renders, and its old take is kept. Merging deletes the takes of the lines joined onto the first, and asks first." |

- **Rec: keep them all, with one change:** the "no dialogue found" advice from item 2.

**4. A split copies the line's marks to both halves**
- The new half takes everything the line carried except the import's line id. That includes:
  - the "changed · was June" mark from the last Analyze;
  - the book's words that named the speaker ("said Marius");
  - the AI's disagreeing pick, which drives the "The book says…, the AI says…" check.
- So after splitting a marked line, both halves show the mark, and the counts go up by one.
- The alternative is a new half with no marks. But then it shows no evidence at all, which is odd too. Both halves really did get their speaker from that one decision.
- The usual next step after a split is to set a speaker on one half. That makes the line yours and clears its marks anyway.
- **Rec: keep it.**

**5. The tracker says "uncommitted"**
- The line "BUILT: 2026-09-30, uncommitted at the time of writing" was true when written. It is now `e323997`.
- **Rec: fix it in the same commit as items 2 and 3**, rather than a commit of its own.

**6. Push**
- `e323997` is local only. **Rec: push after items 2 and 3 land**, so the pushed version doesn't carry the misleading advice.

If you agree, say go and I'll do items 2, 3 and 5 in one commit, then push when you say so.
