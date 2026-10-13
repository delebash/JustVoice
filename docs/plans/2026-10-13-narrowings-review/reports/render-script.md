# Review: Render, Export, Script and the narrator (decided 2026-10-04 → 2026-10-07)

I read the code only and ran nothing. The server is now Node: the TASKS entries cite `.py` files, and I checked the `.js` file of the same name. Three parts were reviewed:

- **Render progress, Export, joins and previews:** reviewed by me.
- **The Render chapter page and Slice 4 UI:** reviewed by one reviewer. I re-read B1 and B2.
- **Script, the second look and the narrator:** reviewed by another reviewer. I re-read S1, S3 and S4.

On "Verified": "read" means the reviewer read the cited line. "Re-read by me" means I checked it again myself.

## 1. Findings

### Render progress, Export, joins and previews

**R1. A pasted chapter's paragraphs never get the shorter pause, and the docs say they do**
- **TASKS:** "The pause between lines is the pause you hear; a paragraph's lines join closer".
- **Approved words:** "2. Pause within a paragraph (Settings → Generation), default 250 ms, built together with 1."
- **What the code does:**
  - `server/src/line_takes.js:108-113` (`paragraphJoins`) joins two lines closer only when both carry the same `source_ref`.
  - `＋ Add text` creates lines with no metadata: `src/components/StudioScript.vue:329` sends `{ position, text }`, and `server/src/api/projects_api.js:978-990` stores them as given.
  - Analyze passes on only the `source_ref` the line already had (`extraction_api.js:336`, `_inherited`). It also writes `paragraph_idx` on every line it cuts, but the paragraph pause never reads it.
  - `docs/studio.md:1003` claims: "A line knows its paragraph when it came from a JustWrite book or from Analyze".
- **What it narrows:** in every pasted chapter, a quote · tag · quote that Analyze cut from one paragraph still joins at the full pause between lines, which was the ~1.5 s gap the fix was meant to remove. Lines that are split off or typed in are also left out; the docs mention those, but the user was never asked.
- **Verified:** sure. I read all four places.
- **Fix:** when a line has no `source_ref`, use Analyze's `paragraph_idx`, and correct `studio.md:1003`.

**R2. Export's progress has no count while it renders, Cancel can't stop that phase, and the phase's label is wrong**
- **TASKS:** "Export shows its progress, and asks where to save".
- **Approved words:** "An honest progress bar needs the server to report as it goes: chapter 3 of 4 mastered, then encoding." The user had asked for "an accurate progress bar".
- **What the code does:**
  - **No count:** `server/src/api/export_jobs_api.js:64-69` (`_warm`) runs before any chapter count. During it `job.total` is 0, so the strip reads "preparing", and the step says "Rendering the lines that have no take yet".
  - **Cancel can't stop it:** `job.cancel` is checked only in `_chapterStep` (`:59`). `warmLines` gets no signal, yet the client throws AbortError at once (`src/services/exportRun.js:35-37`). The hint and `docs/import-and-export.md:394` both say "Cancel stops after the chapter it is on".
  - **The label is wrong:** `export_audiobook.js:124-148` (`collectProjectLineKwargs`) warms every line, including lines whose take is what ships. A stale line therefore renders new audio during the export, and that audio is never used.
- **What it narrows:** a book with unrendered or stale lines shows an empty bar for most of the export. Cancelling there reads "cancelled" while the server goes on rendering the whole book.
- **Verified:** sure on the code; the run time was not measured.
- **Fix:**
  - count the warm's lines;
  - pass the job's cancel into `warmLines`;
  - warm only the lines with no take in use (as `renderSceneLinesAsync` does).

**R3. The chapter page follows only renders started in this window**
- **TASKS:** "Render shows its progress: the page follows a run…"
- **Approved words:** "A. The chapter page follows any render of its chapter, wherever it was started."
- **What the code does:** `src/components/StudioRenderChapter.vue:319-320` finds the run (`liveRun`) only among this window's own kit tasks (`aiTasks.visibleTasks`). The server's render jobs are never asked; `/v1/active_tasks` lists generations only.
- **What it narrows:** a render isn't followed when it was started:
  - in the desktop window while you look in a browser tab of the server, or the other way round;
  - before the page was reloaded;
  - by JustWrite or MCP.

  In those cases the page shows no lit row, no "queued" and no strip. The family rule says every window sees the same data.
- **Verified:** unsure; it depends on what "wherever" meant. The comment narrows it to "here or the chapter list".
- **Fix:** ask the user. If they want any window, read the scene's live render job from the server.

**R4. Deleting a book stops only its render jobs**
- **TASKS:** "Render says when a line's model is loading; a deleted book's renders stop…"
- **Approved words:** "Lean: cancel a book's renders when it's deleted, and check whether deleting a chapter does the same."
- **What the code does:** only render-job lines are skipped (`server/src/render_jobs.js:347-358`, `LineGone`). `DELETE /v1/projects/:id` (`projects_api.js:895-902`) cancels nothing else. An M4B or chapter-WAV export, the ACX check, and the warm before a chapter render (`warmLines` sets) all keep rendering the deleted book's lines.
- **What it narrows:** after the delete, the queue can stay busy for minutes on a book that no longer exists.
- **Verified:** unsure that it matters (an edge case). The code is read.
- **Fix:** cancel the export jobs and scheduler sets owned by the book on delete, or tell the user it is limited to render jobs.

**R5. The join thresholds are fixed in code; two of them were never the user's numbers, yet a comment calls them a decision**
- **TASKS:** "Long lines lose the ~1 s gaps…"; "The pause between lines is the pause you hear…"; "Render and Export's leftovers" item 5.
- **Approved words:**
  - "Trim each take at the join: everything below −70 dBFS at both ends, keeping 50 ms".
  - "cut the quiet on both sides down to 260 ms".
  - The −60 dB / 10 ms rule was first shown to the user after it was built, as "the server uses −60 dB over 10 ms windows", and the user said to make audio.cpp match it.
- **What the code does:**
  - `server/src/render_core.js:827-828`: `TRIM_BELOW_DBFS = -70.0`, `TRIM_KEEP_MS = 50`.
  - `server/src/audio/chunked.js:36-40`: `PIECE_JOIN_PAUSE_MS = 260`, `PIECE_JOIN_SILENCE_DBFS = -60.0`, `WINDOW_MS = 10`.
  - `chunked.js:24` calls these "JustVoice's measured decision (2026-10-07)".
- **What it narrows:** the implementer chose −60 dBFS and 10 ms. None of the five values can be changed in Settings, although the family rule puts thresholds in the database. The pauses already are Settings rows.
- **Verified:** sure.
- **Fix:** ask whether these become Settings → Generation rows, and reword `chunked.js:24` to say what the user approved.

**R6. Names for work in the queue, and "s left", that the user never saw**
- **TASKS:** "Render says what a waiting render is waiting for"; "Render shows its progress".
- **Approved words:** "every piece of work sent to the queue says who it's for: a chapter render, an export or a preview". The only examples were "the M4B export" and "2 · Bigger Inside". The figure was "about 1 min left".
- **What the code does:**
  - The work names: "Generate", "the ACX check", "the voice-line export", "the chapter WAVs export", "a line's take", "a persona preview", "a voice preview", "a chapter render", and a fallback "other work". They are in `generate_api.js:334`, `projects_api.js:1352,1472`, `export_jobs_api.js:67`, `takes_api.js:309`, `personas_api.js:417`, `voice_preview_api.js:449`, `render_chapter_api.js:258`, `synth_scheduler.js:100`.
  - A job across several chapters is named by the book's name with kind "chapter" (`render_jobs.js:336-337`). It reads "waiting — The Ninth Facet is ahead: …".
  - `src/services/renderRun.js:77` shows "about N s left" when less than a minute is left.
- **What it invents:** labels only; nothing is narrowed. One awkward result: "waiting — Generate is rendering 3 lines first".
- **Verified:** sure.
- **Fix:** show the list to the user once.

**R7. Export file names: spaces become underscores, and the zip gets a "_chapters" suffix**
- **TASKS:** "Export shows its progress, and asks where to save".
- **Approved words:** "a Save dialog with folder and file name (the book's title filled in)".
- **What the code does:** `export_jobs_api.js:175,182`: `` `${_safe(name,"book").replaceAll(" ", "_")}.m4b` `` and `…_chapters.zip`.
- **What it invents:** the dialog suggests "The_Ninth_Facet.m4b", not the title as written.
- **Verified:** sure.
- **Fix:** keep the spaces, or ask.

**R8. ⬇ Chapter WAVs (zip) refuses everything when ffmpeg is missing**
- **TASKS:** "Chapter WAVs (zip) holds chapter WAVs and masters…"
- **Approved words:** none on ffmpeg.
- **What the code does:** `export_jobs_api.js:181`: `_needFfmpeg("mastered chapters")` → 503. Only `masters/` needs ffmpeg; `chapters/` doesn't.
- **What it narrows:** without ffmpeg the plain chapter WAVs can't be had either.
- **Verified:** unsure (low). Without the refusal, "masters" would silently be raw audio.
- **Fix:** ask whether to export `chapters/` alone, with a note, when ffmpeg is missing.

**R9. On the chapter list, one chapter's render greys out every other chapter's ▶ Render**
- **TASKS:** "…a chapter's run greys only its own buttons" (the decision was about the chapter page).
- **Approved words:** "On Render's chapter page, a run on one chapter greys out other chapters' buttons … Lean: grey out only the buttons of the chapter that is rendering."
- **What the code does:** `src/components/StudioRender.vue:314`: `:disabled="anyRunning && !isRunning(row.id)"`.
- **What it narrows:** the chapter list keeps the behaviour the user rejected on the chapter page. (▶ Render N chapters and ▶ Render all being disabled during a run is approved.)
- **Verified:** unsure; the decision named the chapter page only.
- **Fix:** ask whether the list should follow the same rule.

### The Render chapter page and Slice 4 UI

**B1. "Rewrite as" and "Cast" buttons show only a speaker's first word**
- **TASKS:** "Render: the line's direction as Style Instructions, Rewrite for the narrator, ✎ Edit words".
- **Approved words:** "It would read ✏️ Rewrite as Narrator, or the narrator's name if they're a character."
- **What the code does:**
  - `src/components/StudioRenderChapter.vue:139` defines `firstName = (l) => speakerName(l).split(" ")[0]`.
  - It is used at `:843` ("✏️ Rewrite as ${firstName(…)}") and `:742` ("Cast ${firstName(row)}").
  - The mock does the same: `MockRenderChapter.vue:597,501`.
- **What it narrows:** "Old Sedge" and "Old Tom" read "Rewrite as Old" and "Cast Old".
- **Verified:** sure, re-read by me.
- **Fix:** use the full `speakerName` in the app and in the mock.

**B2. A line set to the persona's own value is saved as "no change"**
- **TASKS:** "Render: 'This line only'…"; "Render: a line can change what its model takes…"
- **Approved words:** "A line you haven't touched shows the persona's numbers." · "It shows the persona's value until you change it. The change is for this line only." Neither says a chosen value equal to the persona's is dropped.
- **What the code does:** `StudioRenderChapter.vue:472`: `if (value !== null && value === Number(personaDefault(l, key))) value = null;`. It does the same in `setWord` (`:506`) and `setKnob` (`:525`), and the mock at `:237,276,288`.
- **What it narrows:** a line deliberately set to the persona's current pitch, pace, emotion or knob isn't pinned. If the persona changes later, the line changes with it, and the row has no override dot. The rule is only in plan §4 and in BUILT, never in what the user approved.
- **Verified:** sure on the code (re-read by me). Whether it matters to the user is unsure.
- **Fix:** ask the user, or save an explicit value whenever a control is moved.

**B3. 🎧 Run ACX QC is disabled while any chapter renders**
- **TASKS:** "Studio Slice 4" D5.
- **Approved words:** "Keep Lines, Rendered, ▶ Render and the ACX check per chapter". No condition was named.
- **What the code does:** `src/components/StudioRender.vue:272`: `:disabled="qcBusy || anyRunning"`; the mock has the same at `MockRenderGrid.vue:185`. Before Slice 4 (`c1f7f45^`) it was `:disabled="qcBusy"` only.
- **What it narrows:** the check can't run while any one chapter renders.
- **Verified:** sure, read.
- **Fix:** ask, or go back to `qcBusy`.

**B4. The Render mock lacks the speaker picker, and two comments describe reversed behaviour**
- **TASKS:** "Cast, Render, Generate and the persona's gender — five answers (2026-10-05)" item 3; the CLAUDE.md mock rule; small-leftovers item 5.
- **Approved words:** "Render's line panel gets the same speaker picker as Script, saving through the same request".
- **What the code does:**
  - The app has the picker (`StudioRenderChapter.vue:755-758`). The mock's line panel is read-only (`MockRenderChapter.vue:510-518`).
  - The header comments still say "read-only — Cast decides, D2" (`StudioRenderChapter.vue:12`, `MockRenderChapter.vue:10`) and "behind its closed hatch (D3)" (`MockRenderChapter.vue:10-11`). The hatch was reversed on 2026-10-06.
- **What it leaves out:** the mock is missing an approved control, and the comments are stale.
- **Verified:** sure, read.
- **Fix:** add the picker to the mock and correct both comments.

**B5. Labels on the chapter page that the user never saw (copy only, nothing hidden)**
- **TASKS:** Slice 4; "Render's grid: a Model column…"
- **Approved words:** none for these. The Can be directed cell's approved words were only "Written direction with the line's direction when it has one."
- **What the code does:**
  - `StudioRenderChapter.vue:712`: "as persona X always speaks".
  - `:850-851`: "Its words" and its hint.
  - `:869`: "new seed" and "earlier words".
  - `:919`: Compare's "take N · 0:05".
  - The mock has the same.
- **What it invents:** wording only.
- **Verified:** sure that the words are in the code. Unsure whether they count: they came from the Slice 4 mock, which was drawn under "code it all".
- **Fix:** show them to the user once.

### Script, the second look and the narrator

**S1. The second look throws away answers below Analyze's confidence floor**
- **TASKS:** "Analyze takes a second look…" design §2; "Script: a Second look button…"
- **Approved words:** "A line it names gets that speaker, marked to check" · "Save each answer as it comes, marked to check, the same as the second look inside Analyze."
- **What the code does:**
  - `server/src/extraction/second_look.js:295`: `!(useFloor && conf < floor)`.
  - The button's path uses the floor: `api/extraction_api.js:1154` takes it from `pickRoute(null, settings).floor`, and `:1183-1184` passes `useFloor: true`.
  - `pipeline.js:285` sets `ROUTE_FLOORS = { guided: 0.7, direct: 0.5 }`.
- **What it narrows:** a named answer below 0.7 (guided) or 0.5 (direct) is dropped. The line is then marked asked, and the Check column says "Second look found no one…" although the AI named someone. No approved text or doc mentions a floor, and the 10-06 test record names only a 0.5 floor.
- **Verified:** sure, re-read by me.
- **Fix:** ask whether the second look has a floor at all. If it does, show it and say the outcome truthfully.

**S2. The second look cuts each speaker's "who they are" at 200 characters**
- **TASKS:** "Analyze takes a second look…" (the cast list carries "who they are").
- **Approved words:** none — the user never saw this. The 200 shown on 10-07 was for the main Analyze test.
- **What the code does:** `second_look.js:80`: `` who="${cpSlice(who, 0, 200)}" ``. It dates from the 10-05 build.
- **What it narrows:** a clue past character 200 is silently lost. The fix depended on exactly such a clue ("Answers to Ode.").
- **Verified:** sure, read.
- **Fix:** send it whole, or ask for a limit and make it a setting.

**S3. A name not in the book is offered only if it is 60 characters or shorter**
- **TASKS:** same entry, design §3.
- **Approved words:** "A line it can't place, but whose speaker it names (someone not in the cast) stays without a speaker. The chapter page's banner adds Old Sedge isn't in the cast…"
- **What the code does:** `second_look.js:306`: `Array.from(name).length <= 60`.
- **What it narrows:** a longer descriptive name never reaches the banner.
- **Verified:** sure, re-read by me.
- **Fix:** drop the cap, or ask.

**S4. 🔎 Second look marks the lines it fills as "changed by the last Analyze"**
- **TASKS:** "Script: a Second look button asks again about just the blank lines".
- **Approved words:** "saves each answer to that line alone, without rewriting the chapter. So other lines aren't marked 'changed'."
- **What the code does:**
  - `extraction_api.js:574-576` sets `meta.prev_speaker_id = null`.
  - The tag's tooltip says "The last Analyze gave this line a different speaker" (`StudioScriptChapter.vue:723`).
  - The Changed chip says "Lines whose speaker the last Analyze changed" (`:688`).
- **What it invents:** a filled line shows "changed · was no speaker" and raises the Changed count. The tooltip is false: no Analyze ran.
- **Verified:** unsure. The code was re-read by me; the BUILT text mentions the mark, but the user was never asked.
- **Fix:** ask whether to drop the mark or give it second-look wording.

**S5. Words still point to Script's ＋ Add, which a later decision removed**
- **TASKS:** "Analyze leaves the second look to you…" and "Analyze's strip says…", superseded by "Only Discover adds speakers" and "One meaning per word" A1.
- **Approved words:** at the time, "…set a speaker, or ＋ Add who's missing and look again." and "a name that isn't in the cast is offered for you to add." Later: "Script stops adding … loses ＋ Add Sedge".
- **What the code does:** the old words remain in `src/services/scriptReview.js:421`, `StudioScriptChapter.vue:670`, `src/services/chapterRun.js:54` and `docs/studio.md:587-589,626`.
- **What it leaves out:** the user is sent to a button Script no longer has.
- **Verified:** unsure. The words were approved, but a later decision changed the facts under them.
- **Fix:** bring replacement wording ("scan this chapter on Discover to add them") to the user.

**S6. Before Analyze, a speaker you set is not kept as yours, and the code calls this "the same rule"**
- **TASKS:** "A chapter's text can be edited from its row, and a chapter opens before Analyze".
- **Approved words:** "Let any chapter with lines open before Analyze. Its lines show with no speaker. You fix the words with ✎ Edit…, Split and Merge, then click ✨ Analyze". Nothing about speakers.
- **What the code does:** `StudioScriptChapter.vue:242-252` drops `source: "corrected"` when the chapter isn't analyzed. Its comment says "the same rule the render blocker's 'Assign all' has always kept"; that is code from 2026-09-29, not a user decision.
- **What it narrows:** now that a chapter opens before Analyze, a speaker set there is overwritten by the first Analyze. The page (`:812`) and `docs/studio.md:356` say "a line you set is yours, and Analyze leaves it alone".
- **Verified:** unsure, read.
- **Fix:** ask whether to keep the behaviour and say so on the page, or to keep the speaker as yours.

**S7. Script's Review button stays greyed until Analyze**
- **TASKS:** same entry.
- **Approved words:** "Let any chapter with lines open before Analyze."
- **What the code does:** `src/components/StudioScript.vue:476-478`: `:disabled="(!row.analyzed && !row.from_import) || …"`, with the tooltip "Analyze it first".
- **What it narrows:** a row click opens the chapter (`:346-349`), but its Review button doesn't. Both reviewers flagged this.
- **Verified:** sure on the code; low impact.
- **Fix:** let Review open the chapter, or ask.

**S8. ✎ Edit text is greyed while the chapter is analyzed, with no reason given**
- **TASKS:** same entry.
- **Approved words:** "2. Edit text at any time, keeping every unchanged line."
- **What the code does:** `StudioScript.vue:485`: `:disabled="!row.lines || inRun(…) === 'current'"`, with no tooltip.
- **What it narrows:** the text can't be edited during a run, and nothing says why. This probably protects the run (an edit mid-run makes its save fail with a 409).
- **Verified:** unsure.
- **Fix:** tell the user, and add a "wait for Analyze to finish" tooltip.

**S9. The Re-analyze chip's tooltip names only added speakers**
- **TASKS:** same entry ("N changed since").
- **Approved words:** "Changed or new paragraphs become new lines with no speaker, and the row offers Re-analyze for them".
- **What the code does:** `StudioScript.vue:104`: "A speaker was added since, and the text names them". The chip also counts `edited_since` (`:95`).
- **What it leaves out:** the tooltip explains only half of what the chip counts.
- **Verified:** sure, read.
- **Fix:** "A speaker was added since, or lines changed since".

**S10. Discover's Narrator row has no Ignore**
- **TASKS:** "A book with narration gets a narrator".
- **Approved words:** "Narrator is the first row in 'Speakers found' … status New, with ＋ Add". The user said a narrator "is not an option", but no-Ignore was never shown to them.
- **What the code does:** `src/components/StudioDiscover.vue:584`: `v-if="!row.narrator"`; `:296-297` filters the narrator out of Ignore.
- **What it narrows:** the option is hidden.
- **Verified:** unsure; it fits the user's words.
- **Fix:** confirm with the user.

**S11. The narrator question is asked per chapter, not per book**
- **TASKS:** same entry.
- **Approved words:** "✨ Analyze on a book with no narrator stops first".
- **What the code does:** `src/services/narrator.js:16` (`narrationOf`) looks only at the ticked chapters (`StudioScript.vue:155`). The chapter page checks `c.lines - c.spoken > 0` (`StudioScriptChapter.vue:207`).
- **What it narrows:** analyzing a chapter with no narration doesn't ask, even when the book has narration elsewhere.
- **Verified:** unsure; low impact.
- **Fix:** ask, or check the whole book.

**S12. The Check tag says "To check" for every kind of mark, and the grid's Flagged count is red**
- **TASKS:** "Script's Check column leads with a tag".
- **Approved words:** "For example ⚠ No speaker or Check: nearby chapter … red for 'no speaker' and amber for 'worth a look'".
- **What the code does:** `StudioScriptChapter.vue:753` uses one generic "To check" tag. `StudioScript.vue:455` shows Flagged with `intent="danger"` (red).
- **What it narrows:** the tag doesn't name the kind of check. The grid shows "worth a look" counts in red.
- **Verified:** unsure. The approved text gave an example, and it was about the Check column.
- **Fix:** ask whether the tag should name the check, and whether Flagged should be amber.

**S13. The Changed chip is hidden at zero**
- **TASKS:** "Studio Slice 3" (2026-09-29).
- **Approved words:** "filters All, To check, No speaker, Changed".
- **What the code does:** `StudioScriptChapter.vue:687`: `v-if="counts.changed"`. The other chips show 0.
- **What it narrows:** the filter disappears when nothing has changed.
- **Verified:** unsure; low impact, and not checked against the mock.
- **Fix:** show "Changed 0", or confirm with the user.

**S14. "Leave out dialogue tags" works on English tags only**
- **TASKS:** "Slice 3's leftovers" B4.
- **Approved words:** "A line is left out only when it is nothing but a tag ('said Marius,' 'she whispered.' …)". No language scope was given.
- **What the code does:** `server/src/extraction/tags.js:13-14,30-31`: English verbs, and adverbs limited to "-ly / again / aloud / at last / at once".
- **What it narrows:** in a non-English book the switch silently does nothing, and Overview's hint doesn't say so.
- **Verified:** unsure.
- **Fix:** say so in the hint, or ask.

## 2. Decisions checked with no finding

### Render progress, Export, joins and previews

- **Render says what a waiting render is waiting for:**
  - The wording follows the approved pattern.
  - The waiting text shows only while none of the run's own lines is running (`synth_scheduler.ahead`).
  - The first thing ahead is named, and an export or other work is named without a model.
- **"and N more lines":** built as approved.
- **Loading words:**
  - "loading X — N s" shows in place of the line's name while the line's model loads (`voice_model.loadingNow` around both loads).
  - It shows on both strips.
  - Generate and previews were left out, as decided ("Render first").
- **A deleted line is skipped, not saved** (render jobs).
- **The chapter page's ⚡ Render N ready, ▶ Play chapter and ↻ Re-render all** wait for any run of their own chapter (`runBusy`), are kept per chapter (`runs[sceneId]`), and play only on the chapter that asked.
- **Render shows its progress:**
  - The server marks a line running.
  - The row is lit with `jv-row--flag`, and Status reads rendering… or queued.
  - The figures are audio, × real time and time left.
  - The strip's line-name button scrolls to the line; nothing scrolls on its own.
  - There is no new chip.
  - The chapter list uses the same strip.
  - Check reads failed or cancelled, and queued only while a chapter waits.
- **The small leftovers:**
  - "Checking the lines…", "Checking the chapters…" and "Checking the speakers…" show until the facts load.
  - "· N can't render" is on the Render card.
  - The mock's strips use the app's waiting and loading words.
- **Previews with Always auto-load on:** the first ask doesn't load. A needed load still says "Loading … this can take up to a minute." and "… loaded." (`voiceAudition.js`, `VoicesPage.vue:375-408`). Voices names the model.
- **Chapter WAVs (zip):** `chapters/NN Title.wav` and `masters/NN Title.wav` mastered to the book's target, run as a job with the same strip. The project package is unchanged, and `include_masters` is gone everywhere.
- **Export:**
  - It is a job with chapter-by-chapter steps and "Encoding the book".
  - The Save dialog is wired (`boot/jv.js:170`).
  - "Saved … to …" comes with Open folder, and "nothing was saved" shows on cancel.
- **Pauses:**
  - Takes are trimmed at the join at −70 dBFS, keeping 50 ms.
  - Pause within a paragraph is a Settings row, default 250 ms.
  - There is no pause rule for a change of speaker.
  - A line's own pause and the scene break win.
- **The server's piece join at 260 ms:** the audio.cpp copy takes the server's rule, and voice previews share one seam function.
- **Render all:** sits beside ▶ Render N chapters, is disabled while a run goes, and keeps the existing gate with its reason.
- **D1:** the page foot is a hint naming Settings, not the mock's pause controls.
- **Mastering failed:** the wording is word for word.

### The Render chapter page and Slice 4 UI

- **Slice 4:** D1–D7 and gaps G1–G10 as approved (D3 later reversed by "This line only").
- **Model column and Can be directed:** the Model column is there, Can be directed uses the shared `directionCell` words, and there is no Speaks column.
- **Render overrides:**
  - It shows/hides by model: Pace, Pitch, Gain and Pause after always; Style Instructions only on a words model; Emotion and Register by model; Sampling is the model's knobs minus speed and seed.
  - Each control has a ↺, and Reset to default is greyed when nothing is set.
  - The ranges are the persona page's.
- **Rewrite:** enabled on every line with a speaker, the narrator included (see B1 for the label).
- **✎ Edit words:** uses the same PATCH as Script.
- **One player:**
  - One hidden `<audio>` for the page; ▶ ⇄ ⏸, and ▶ after the end plays from the start.
  - The controls sit in the row you pressed.
  - Play chapter has the wide transport, and the chapter list's ▶ Play uses the same player.
  - Dismissing the row stops it.
- **Deleting the take in use:**
  - Both warnings are word for word.
  - The newest take left goes in use in the same transaction.
  - Other takes delete without asking.
- **Compare:** two columns.
- **Character voice controls doc §6:** nothing from it is built.

### Script, the second look and the narrator

- **Looks right buttons:** solid (primary).
- **The Check column:**
  - a red "⚠ No speaker" tag;
  - an amber tag on a marked line;
  - the sentence below it as a hint.
- **"Added since":** goes once the speaker has lines in the chapter.
- **The Second look button:**
  - It sits in the banner and is hidden during an Analyze run.
  - It asks only spoken, blank lines that you didn't set, and saves each answer as it comes.
  - The strip reads "N of M lines".
- **Temperature 0:** the second look uses `p_classify`.
- **Analyze's strip:** the tooltip is word for word, and a cancel during the second look saves the chapter as it stood.
- **The second look off by default:** the switch is off, and the candidate wording matches.
- **The second look's text:** 800 / 1,500 / 1,500 words, settings with no screen.
- **Chapter text edit:**
  - ⋯ → ✎ Edit text;
  - unchanged lines keep everything;
  - it asks before deleting takes;
  - the "N changed since" tag and Re-analyze;
  - a row click opens the chapter before Analyze.
- **Narrator flow:**
  - the question before Analyze, with no "analyze without";
  - the narration banner;
  - No speaker and To check leave narration out;
  - Overview's "no narrator" tag;
  - Discover's Narrator row: first, ticked, with its hint;
  - the library persona when there is exactly one.
- **Slice 3 and its leftovers:**
  - the marks;
  - floors 0.5 / 0.7 shown read-only;
  - the route words, the Confidence column and the filters;
  - Next to check wraps around;
  - the Speech marks hint and every wording as approved.
- **Analyze with descriptions:** the live prompt carries no description (`prompts.js:98-110`), so "left as it is" holds.
