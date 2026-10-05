<!-- SPDX-License-Identifier: MIT -->
# Analyze's second look — the build plan (2026-10-05)

**Decision:** TASKS "Analyze takes a second look at lines it leaves with no speaker, and offers to
add who it finds" (verbatim — "your rec go with the add them offer"). The test it rests on:
[`2026-10-05-second-look-test.md`](2026-10-05-second-look-test.md) (30/30, 0 wrong). This plan
fills the parts the decision didn't name — where the mark and the offer show, their words, the
prompt's home, the settings — **for the user's go before code**.

## 1. What it is (the design, my rec)

1. **When.** After the main model call of an Analyze or Re-analyze, for every *spoken* line it
   left with no speaker (`unknown`, incl. `floored`) — and only those — one more call per line.
   It reads the last 800 words of the previous chapter, the 1,500 words either side of the line
   in its chapter (the line marked ⟦…⟧), and the first 1,500 words of the next chapter. Nothing
   runs on a chapter with no blank line.
2. **A line it names** is saved with that speaker, **marked to check**: *Decided by* reads
   **AI, from the chapters around it**; the Check column asks **Found in a nearby chapter — is
   it Odeline Marran?**; it sits under **To check** until you set a speaker or **✓ Looks right**.
   It counts under *AI decided*.
3. **A line it can't place, but whose speaker it names** (someone not in the cast) stays with no
   speaker, and the chapter page's *N lines have no speaker* banner adds **Old Sedge isn't in the
   cast — ＋ Add Old Sedge** (one button per name; the same add as Discover's ＋ Add, with
   Discover's dedupe). After adding, the grid row says *Old Sedge added since* and offers
   **Re-analyze**, as today.
4. **Its own prompt card:** AI Settings → Routing by feature → **Speaker attribution · second
   look** — its own feature, so its Lab column works (an action under `speaker_attribution` would
   be run by the attribution Lab adapter as the main call's prompt) and it can be routed to
   another model. Preset **Structured extraction** (`p_extract`, temperature 0.2, no thinking —
   as tested). Seeded on the next start (seeds insert missing keys on every start).
5. **Settings** (`settings.extraction`, `PATCH /v1/settings`): `second_look` on/off (default on),
   `second_look_words` 1,500 (either side of the line), `second_look_before` 800,
   `second_look_after` 1,500. The on/off is also on the Speaker attribution **Auto** pane; the word
   counts have no UI, like `split_lead_in_paragraphs`.
6. **Done when:** the attribution eval through the real Analyze (now with neighbours) keeps The
   Ninth Facet 136/136 with D39 = Odeline, Salt-Iron and Speckled Band no worse; Bigger Inside's
   last line comes back as Odeline, marked; with Sedge out of the cast, his lines stay blank and
   the banner offers to add him.

## 2. Blast radius (greps run 2026-10-05)

| Change | Readers / producers (grep) | Already on the path |
|---|---|---|
| New source `second_look` | `PIPELINE_SOURCES` `extraction_api.py:188` (used :255, :451, :938) · `flags.py:42 DECIDED` (:94, :151, :207 → `spoken_block`, used by `line_takes.py:274`, `tags.py:74`, `extraction_api.py:272,934`) · *AI decided* count `extraction_api.py:1005` · `scriptReview.js:382,389,404,407,410,436` · `attribution.js:34-42` (legend), `:80` · `database/models.py:270-278` (the source list comment) · `eval_attribution.py:280`, `labs/extraction/run.py:151` | `corrected` is never overwritten (`_persist_attribution` :442-461); ✓ Looks right sets `corrected` |
| New mark kind `nearby` | `models.py:1675` `ScriptFlag.check` Literal · `extraction_api.py:1096-1099` mapping · `flags.py flag_groups` (97-161) · `scriptReview.js` `checkQuestion` (418-427), `TIP` (347-358), `decidedBy` (365-398) · `StudioScriptChapter.vue:646` (chip), `:711-722` (Check column) | marks are computed at read time from `Line` (no stored flags) |
| `metadata.not_in_cast` (the name) | `_persist_attribution` `with_audit` (406-440 — must set AND pop it, or a stale name survives a re-analyze) · `ScriptLine.metadata` (`models.py:1662`, already sent whole) | — |
| The banner's ＋ Add | `StudioScriptChapter.vue:631-641` (the no-speaker banner) · `POST /v1/projects/{id}/speakers/promote` (`extraction_api.py:1503-1530`, `ensure_speaker(..., unique=True)`) — Discover's ＋ Add (`StudioDiscover.vue:235,565,592`) | `added_since` (`_chapter_script`) already offers Re-analyze once the name is in the cast |
| `AnalyzeRequest` + `prev_text` / `next_text` | `analyze_scene_endpoint` (:528-535), the stream endpoint (:606-613 — read neighbours BEFORE the worker thread, which has no session, :661), `analyze_text_endpoint` (:771-790, `AnalyzeTextRequest` :715) · neighbours by `Scene.position` (`database/models.py:242`), text = `metadata.source_text` or blocks joined (:954, :990) | — |
| The post-pass in `analyze_scene` | `pipeline.py` between :750 (the `llm` row) and :752 (`return rows`); `run_feature` directly (no stream); `AttributionRow` (41-71) → `AttributionRowResponse` (`extraction_api.py:56-66`, built with `**row.__dict__`) | the floor (726-739) and resolve (696-701) unchanged |
| New feature `speaker_second_look` | `feature_catalog.py:21` FEATURE_CATALOG + `:19` PREFER_LOCAL_FEATURES · `seed_feature_prompts.py:123` (a row, `json_mode: True`) · `seed_presets.py:185` (→ `p_extract`) · `DEFAULT_TEST_SAMPLES` (:230) · the Lab adapter by feature (`main.js:76`, kit `labAdapters.js:45`) | seeds insert missing keys on every start (kit `seed.py:1290`) |
| Settings fields | `models.py:384 ExtractionSettings` · `/v1/extraction/config` (`extraction_api.py:848-890`) · `AttributionAutoPanel.vue` (23, 35-39) | `PATCH` deep-merges |

## 3. Built and checked (2026-10-05, "go")

Built as §1: `extraction/second_look.py` (prompt, window, the pass), `pipeline.analyze_scene` step 6,
`AnalyzeRequest` `before_text`/`after_text`/`second_look`/`second_look_skip`, `AttributionRow.not_in_cast`;
`extraction_api` (`_neighbour_texts`, `_set_by_you`, `with_audit`'s `not_in_cast`, the *AI decided*
count, `PIPELINE_SOURCES`, the analyze-text fields, the config's `second_look`); `flags.py` (`DECIDED`,
the `nearby` mark — FIRST on its line, so it is the question Script asks); `ExtractionSettings` ×4;
the `speaker_second_look` feature, prompt row (`json_mode`), preset (`p_extract`) and Lab sample;
`scriptReview.js`, `attribution.js`, `StudioScriptChapter.vue` (the banner's offer),
`AttributionAutoPanel.vue` (the on/off); `eval_attribution.py` sends the neighbours
(`--no-second-look` to compare), both tallies count `second_look`. Docs studio (*The second look*),
ai-features, whats-new.

**A fix found live:** the first build wrote the cast with the main call's `format_characters`,
which leaves out each speaker's description — and "Answers to Ode." is the only link from Odeline
Marran to the "Ode" the next chapter names. The eval still found her once (a guess from the
name); the live Re-analyze didn't. The tested prompt (30/30) had the descriptions, so the second
look now writes its own cast list with them (`cast_lines`, `who="…"`); the main call's list is
unchanged.

Checks: ruff, Biome, build; pytest `test_second_look.py` (14) + the neighbouring files (analyze
persist, alignment, restore, extraction config, stream, feature prompts, llm seeds — the count to
13 —, script api, script flags, split/merge, chapter text); vitest `scriptReview.test.js` (29).
Eval through the real Analyze (the app on 17494): The Ninth Facet **136/136**, second look 1/1;
Bigger Inside ×3 after the fix **40/40 each, second look 3/3**; Salt-Iron 131/132 (the known
"Quartermaster." miss, main pass); Speckled Band 245/247 (D95/D96, the 2026-09-29 runs' same
two). Live, through Script's pages: Re-analyze Bigger Inside → the candle line **Odeline Marran**,
*AI, from the chapters around it*, *Found in a nearby chapter — is it Odeline Marran?*, no speaker
0; a throwaway chapter with a ferryman → the banner offered *the ferryman isn't in the cast — ＋
Add the ferryman*, ＋ Add put him in the cast, the offer went, the grid row said *the ferryman
added since* (speaker and chapter removed after). Cost seen: Bigger Inside 120 s against ~48 s
with its 6 blank lines (the key's cast, no Sedge); 84 s on your book (1 blank).
