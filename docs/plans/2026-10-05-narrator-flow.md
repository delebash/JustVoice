<!-- SPDX-License-Identifier: MIT -->
# A book with narration gets a narrator — the flow, and Discover's and Script's run display (2026-10-05)

**The decision is TASKS "A book with narration gets a narrator: Discover proposes it, Script
asks for it" (verbatim, "your rec on all go").** This doc is the build under that go and its
blast radius.

## 1. What changes

The user: *"if there is narration then we need a narrator, that is not an option"*. A narrator
is a speaker (the narrator role), never made automatically (2026-09-29), so the flow has to
offer it where the user is:

- **Discover** proposes it. When the book has no narrator and has narration, the first row of
  Speakers found is **Narrator** — *reads everything outside quote marks · ≈ N lines* — New,
  pre-ticked, with ＋ Add. Adding it is Cast's **Add Narrator** (`POST /v1/projects/{id}/narrator`):
  a speaker called Narrator, cast with the library's Narrator persona when there is exactly one,
  and the narration with no speaker moves to it. No Ignore — narration needs a narrator.
- **Script** asks for it. ✨ Analyze (the grid's and a chapter's Re-analyze) on a book with no
  narrator stops first: *This book has no narrator — its narration needs one.* **＋ Add Narrator
  and analyze** · **Choose on Cast**.
- **Script counts** stop calling narration an error while there is no narrator: those lines
  are `waits_for_narrator` (server), counted as `narration_waiting`, and left out of No speaker
  and To check; one banner — *This book has no narrator — N lines of narration are waiting for
  one* — with **＋ Add Narrator**, on the grid and on a chapter's page.
- **Overview**: Script's row carries **no narrator** until there is one (it opens Cast).
- **Run display**: one run banner (`StudioRunBanner.vue`, from Script's) on Script's grid and on
  Discover — the run's kind, the chapter, done of total, time, Cancel — and under it the strip
  for the chapter running now (the last finished one only when nothing runs). A row says
  **scanning…** or **analyzing…** for what is really happening to it.

Narration is a line that is read and not spoken (`spoken_block` false), not a marker — the
rule Script already uses for `spoken`.

## 2. Blast radius (greps run 2026-10-05)

| Change | Callers / producers (pasted grep) | Already on the path |
|---|---|---|
| `no_speaker` / `to_check` leave out narration with no narrator; `narration_waiting`, `waits_for_narrator` added | producer `extraction_api.py:957,999,1002` (`_chapter_script`, both endpoints); readers `StudioScript.vue:104,409,428-429` · `StudioScriptChapter.vue:256,427,713` · `HomeView.vue:197-199,403-404` · `studioStatus.js:219-220,236,274` | `noSpeakerIds` feeds "Assign N → Narrator" (`StudioScriptChapter.vue:256-258`) — keeps every no-speaker line |
| `hasNoSpeaker` / `toCheck` skip `waits_for_narrator` | `StudioScriptChapter.vue:112,130,396,665-666` · `scriptReview.test.js` (filterCounts :36-38, nextToCheck :58-81, checkQuestion :208-218) | Next to check wraps (decided 2026-09-29) |
| Rows say scanning vs analyzing | `inRun(` — `StudioDiscover.vue:89,139` · `StudioScript.vue:98,133,297,357,375-376,420,425-426,441` · `StudioScriptChapter.vue:166`; `chapterRunFor(` — `StudioDiscover.vue:136` · `StudioScript.vue:65` · `StudioView.vue:194` | one run per project, shared (chapterRun.js) |
| One run banner + strips follow the running chapter | `AiTaskStrip v-if` — `StudioDiscover.vue:396` · `StudioScript.vue:327` · `StudioScriptChapter.vue:580` (its own chapter) | inline tasks are skipped by App's global strip (`App.vue` AiTaskStrip filter) |
| Add Narrator from Discover and Script | `projects.js:89` `addNarrator` (Cast's card) → `speakers_api.ensure_narrator` (idempotent; moves narration) | `setNarrator` (`projects.js:86`) — Cast's tick |
| Discover's narrator row | `foundSpeakers(` — `StudioDiscover.vue:107` only | Discover's ＋ Add selected promotes names (`/speakers/promote`) |
| Overview's "no narrator" tag | `projectState(` — `StudioView.vue:190`; `stepStatus(` — `StudioOverview.vue:186` | Script's tags open Script on To check |
