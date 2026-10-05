<!-- SPDX-License-Identifier: MIT -->
# A chapter's text, edited from Script's grid — and a chapter that opens before Analyze (2026-10-05)

**The decision is TASKS "A chapter's text can be edited from its row, and a chapter opens before
Analyze" (verbatim — "2 and your rec on others go").** This doc is the build and its blast radius.

## 1. What it is

- **⋯ → ✎ Edit text** on a chapter's row opens the box ＋ Add text uses, holding the chapter's
  lines as one text, a paragraph each. **Save** matches the paragraphs to the lines in order
  (difflib, spacing ignored): a line whose words are unchanged keeps its id — so its speaker, its
  marks and its takes; a changed or new paragraph becomes a new line with no speaker
  (`source="manual"`, as ＋ Add text makes them); a line whose paragraph changed or went is
  deleted, its takes with it. A dry run first says how many lines with takes would go, and Script
  asks before saving when any would.
- On an analyzed chapter the new lines are counted **N changed since** (`ScriptChapter.edited_since`:
  speakable lines with source `manual`/none — an Analyze rewrites every line's source but
  `corrected`, so none are left after one), and the row offers **Re-analyze**; the Re-analyze chip
  counts the chapter too. Analyze then keeps the lines (`extraction_api._lines_to_keep`), reading
  a hand-added line as its own paragraph.
- **A chapter with lines opens before Analyze** — the grid's row click no longer requires an
  Analyze or an import's speakers (`StudioScript.vue:302` until today). The chapter page already
  handled a chapter never analyzed ("not analyzed yet", "✨ Analyze this chapter").

One correction to the text as shown: it said the row offers Re-analyze "as it already does for
lines added since the last Analyze". The existing *added since* is about **speakers** added to the
cast since (`ScriptChapter.added_since`, names), not lines — so the lines' count is new, built
beside it.

## 2. Blast radius (greps run 2026-10-05)

| Change | Callers / readers / producers | Already on the path |
|---|---|---|
| `openRow` drops the analyzed check | `StudioScript.vue:401` (row click), `:483` (Review — still disabled before Analyze: "Analyze it first") | `inRun(...) === "current"` still blocks a chapter being analyzed |
| `row-class` open for any row with lines | `StudioScript.vue` row-class (one use) | `.studio-script__row--open` = cursor only (`:546` before) |
| `GET`/`PUT /v1/scenes/{id}/text` (new) | `StudioScript.vue:284` (`editText`), `:293` (`saveText`); `server/tests/test_chapter_text.py` | `_drop_scene_source_text` (so the next Analyze reads the lines), `_renumber`, `sweep_orphan_takes` — the split/merge helpers |
| `ScriptChapter.edited_since` (new) | producer `extraction_api.py:1015`; readers `StudioScript.vue:98` (the Re-analyze chip), `:443` (the tag), `:474` (the button) | `added_since` beside it, unchanged |
| New lines are `source="manual"` | producers: `CreateBlockRequest` default (`projects_api.py:203`, ＋ Add text), the text edit (`:775`); readers: `spoken_block` (not `narration`, not decided → opens with a speech mark), `PIPELINE_SOURCES` (not one — a chapter is analyzed by `analyzed_at`) | a split copies its line's source, so a split new line stays counted |
| Lines that go take their takes | `Take.block_id` ON DELETE CASCADE, as merge relies on | the dry run's `takes_lost`; Script's confirm |

## 3. Checked

Ruff, Biome, build; `test_chapter_text.py` (8) with `test_split_merge.py` + `test_script_api.py`
(30). Live on the dev app, on throwaway chapters deleted after: a never-analyzed chapter opens on
a click; ✎ Edit text opens with the text, Save off until it changes; a changed paragraph → a new
line with no speaker, the others keep their ids; spacing only → nothing changes; on an analyzed
chapter an added paragraph → "1 changed since", Re-analyze on the row, the Re-analyze chip 1.
Not live: the takes confirm (no takes on a throwaway chapter — the dry run's count is tested).
