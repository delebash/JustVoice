### R1. A pasted chapter's paragraphs never get the shorter pause; studio.md says they do
- **Verdict:** CONFIRMED
- **Severity:** VISIBLE (audible: the ~1.5 s quote · tag · quote gap stays in every chapter made with ＋ Add text)
- **Evidence:**
  - `server/src/line_takes.js:108-113` `paragraphJoins` joins only when both lines carry the same non-empty `source_ref`. It is the only producer of `paragraph_next` (`line_takes.js:446,469`; `api/render_chapter_api.js:191,196,211`).
  - `src/components/StudioScript.vue:329` ＋ Add text posts `{ position: i, text }`; `api/projects_api.js:978-990` stores no metadata.
  - Analyze: `api/extraction_api.js:488` gives each new line its paragraph's inherited meta (`{}` for a pasted chapter) and `:425` writes `paragraph_idx` on every line. Nothing in the join reads `paragraph_idx`. A Re-analyze keeps it (`extraction_api.js:319`).
  - `docs/studio.md:1003-1004`: "A line knows its paragraph when it came from a JustWrite book or from Analyze". This is false for a pasted chapter that has been analyzed.
  - Approved (TASKS:1390-1396): "2. Pause within a paragraph (Settings → Generation), default 250 ms, built together with 1." WHY (TASKS:1398-1399): "a paragraph Analyze cut into three lines (quote · tag · quote) joined at ~1.5 s each."
- **Refutation tried:**
  - Code: no fallback exists; `grep paragraphJoins|paragraph_next` finds only the source_ref rule.
  - Approval: nothing in TASKS, the plans or git limits the pause to lines with a `source_ref`. b1841d7 says "(same source_ref)" in a commit body, which is not the user's word. The 10-06 leftovers table (`docs/plans/2026-10-06-leftovers-batch.md:22`) shows `source_ref` as the mechanism for the scene break, not for paragraphs.
  - Effect: real. The live check ran only on Brass Rank, a JustWrite import that has `source_ref` on every block.
- **Surviving claim:** Lines Analyze cuts from one paragraph of a chapter made with ＋ Add text, or of new paragraphs from ✎ Edit text, join at the full between-line pause. The approved fix targeted exactly that case, and the docs claim otherwise.
- **FIX:**
  1. Recommended: in `paragraphJoins`, use `source_ref` when both lines have one; otherwise use Analyze's `paragraph_idx` when both have one. Correct `studio.md:1003-1005`.
  2. Attack:
     - Reuse: `paragraph_idx` already exists and is already read the same way by `_paragraphOf` (`extraction_api.js:544-552`). No new data or schema.
     - New rules the user hasn't seen: a line made by Split keeps `paragraph_idx`, because `projects_api.js:1096` deletes only `source_ref`. With the fallback it would join its sibling at 250 ms. The docs now say a split-off line "joins with the pause between lines", and the user never ruled on that. **Open question: should a split line join its paragraph at the paragraph pause?**
     - Blast radius (pasted greps):
       `server/src/line_takes.js:446:  const joins = paragraphJoins(heard.map(([, b]) => b));`
       `server/src/line_takes.js:469:      paragraph_next: joins.has(block.id) && !ends.has(block.id),`
       `server/src/api/render_chapter_api.js:191:  const joins = lineTakes.paragraphJoins(played);`
       `server/src/api/render_chapter_api.js:211:    if (line.paragraph_next) return gen.pause_within_paragraph_ms;` (Render, M4B, ACX, chapter zip, captions)
       `src/components/StudioRenderChapter.vue:105/461/899` (reads `paragraph_next`; no change)
       `server/tests/pause_heard.test.js`
       `docs/studio.md:1003`
     - No re-render is needed: the pause is applied at the join, not stored in the take (`render_chapter_api.js:202-205`).
     - Simpler alternative: write `source_ref` at Analyze time for lines without one, e.g. a synthetic `para:<idx>`. That is worse: it pollutes the import's stable id, which re-import merges on and voice-line export names files from (`projects_api.js:641-663`, `export_voicelines.js:45`).
  3. Surviving fix: add the `paragraph_idx` fallback in `paragraphJoins` (source_ref first), with tests, and correct the doc line. Ask the split-line question before shipping.

### R2. Export's render phase has no count, Cancel can't stop it, and its label is wrong for stale lines
- **Verdict:** CONFIRMED
- **Severity:** VISIBLE
- **Evidence:**
  - `server/src/api/export_jobs_api.js:64-69` `_warm` runs before any count. `job.total` stays 0, so `src/services/exportRun.js:32` shows "preparing" with the step "Rendering the lines that have no take yet".
  - `job.cancel` is read only in `_chapterStep` (`:59`) and after assembly (`:86`). `warmLines` is called with no `signal`, although it takes one (`synth_scheduler.js:322`, and `SetHandle.waitAsync` withdraws pending items, `:71-92`).
  - The client throws AbortError at once (`exportRun.js:35-37`). The hint says "Cancel stops after the chapter it is on" (`exportRun.js:17,19`), and so does `docs/import-and-export.md:394`.
  - The old M4B door and the ACX check both pass `signal: clientGone(c)` to the same warm (`projects_api.js:1352-1353,1450-1452`). The job path dropped it.
  - `export_audiobook.js:124-148` `collectProjectLineKwargs` returns every line's kwargs. The assembly then plays each line's ★ take where it has one (`render_chapter_api.js:293-303`). So a stale line with a take is rendered fresh in the warm (a cache miss on its new key) and that audio is never used.
  - Approved (TASKS:1317-1328): "an accurate progress bar"; "An honest progress bar needs the server to report as it goes: chapter 3 of 4 mastered, then encoding."
- **Refutation tried:**
  - Code: no other path counts or cancels the warm. `renderSceneLinesAsync` (`render_chapter_api.js:273-285`) already filters played lines out of its warm; the export does not.
  - Approval: the warm phase, its label and its no-cancel behaviour appear nowhere in TASKS, the plans or git. The warm itself predates this work (the 2026-08-08 plan §7b), so only its progress, cancel and label are at issue.
  - Effect: real. On a book with no takes, the warm is most of the export's run time.
- **Surviving claim:** During the export's render phase the bar shows no count, and Cancel reports "cancelled" while the server renders every queued line of the book. The phase also renders stale lines whose new audio the export never uses.
- **FIX:**
  1. Recommended:
     - (a) Give each export job an `AbortController`. The cancel route aborts it, `_warm` passes `signal`, and the abort is caught as `_Cancelled`.
     - (b) Filter out lines that play a take before warming, by reusing `_takesFor` the way `renderSceneLinesAsync` does.
     - (c) Make the warm countable.
  2. Attack:
     - Reuse: (a) is the Web-standard `AbortController`/`AbortSignal`, already accepted by `warmLines`/`warmSpecs` and already used by the sibling doors. (b) copies the existing pattern at `render_chapter_api.js:274-285`, and it keeps `collectProjectLineKwargs`'s own invariant (`export_audiobook.js:117-122`: "EXACTLY what the assembly loop will pass").
     - (c) needs new code. `warmSpecs` doesn't return its handle, and the scheduler's per-set count is private (`synth_scheduler.js:106,136`).
     - New wording for (c), e.g. "Rendering line 12 of 340". **Open question: the words and whether the warm counts in the same bar as the chapters.**
     - Blast radius (pasted greps):
       `server/src/api/export_jobs_api.js:68:  await synthScheduler.warmLines(st, await exportAudiobook.collectProjectLineKwargs(st, projectId), { owner: … });`
       `server/src/api/projects_api.js:1351:    await synthScheduler.warmLines(st, await exportAudiobook.collectProjectLineKwargs(st, projectId, { skipUnrenderable: true }), {` (ACX; changes too if (b) goes into `collectProjectLineKwargs`)
       `server/src/api/projects_api.js:1450:    await synthScheduler.warmLines(st, await exportAudiobook.collectProjectLineKwargs(st, projectId), {` (old M4B door)
       `server/src/synth_scheduler.js:312/322` (only if (c) changes warmSpecs)
       `src/services/exportRun.js:32,17,19`
       `docs/import-and-export.md:394`
     - Simpler alternative to (c): warm each chapter inside the chapter loop. The existing "Chapter i of n" count and the existing between-chapters cancel then cover rendering, with no new words. Trade-off: it gives up whole-book model grouping (the 2026-08-08 plan §7b P2-3), so a multi-model cast swaps models per chapter (10–17 s per Qwen3 load). That is the user's call.
  3. Surviving fix: build (a) and (b) now; they add no new words or numbers. For (c), put both options to the user: count the warm with new words, or warm per chapter and accept the swaps.

### R3. The chapter page follows only renders started in this window
- **Verdict:** CONFIRMED
- **Severity:** VISIBLE
- **Evidence:**
  - `src/components/StudioRenderChapter.vue:315-326`: `liveRun` searches `aiTasks.visibleTasks`, the kit's window-local task store (`just-llm-runner/ui/src/stores/aiTasks.js:82`), which has no server sync.
  - `StudioRender.vue:64-71` (`taskFor`/`isRunning`) works the same way.
  - Nothing re-attaches after a reload (`renderRun.js` has no restore). `/v1/active_tasks` lists generations only (`active_tasks_api.js:42-60`).
  - Render jobs are persisted server-side (the `render_jobs` table, `models_schema.js:492`), but no endpoint lists a scene's running job.
  - The code comment narrows the scope to "here or the chapter list" (`:315`), and so does `docs/studio.md:1049` ("from its page or from the chapter list").
  - Approved (TASKS:1470-1471): "A. The chapter page follows any render of its chapter, wherever it was started." Repeated in TASKS:1430-1431: "wait while any run of that chapter goes, wherever it started."
  - Family rule (`family-rules.md`): "The desktop window, the browser tab of a headless server, the phone and other apps calling the API must all see the same data."
- **Refutation tried:**
  - Code: no server read of live jobs exists anywhere in `src/`.
  - Approval: no later word narrows "wherever". The user's complaint arose from the chapter list, which is the only case the build verified.
  - Effect: real for a reload mid-run, a second window or browser tab, and JustWrite or MCP starting render jobs. In those cases there is no lit row, no "queued" and no strip, and ⚡ / ↻ stay enabled on top of the running job.
- **Surviving claim:** "Wherever it was started" was built as "in this window, since it loaded". A run from another window, an earlier page load, JustWrite or MCP is invisible to the chapter page and the chapter list.
- **FIX:**
  1. Recommended: the server reports a scene's running render job, for example as a field on `GET /v1/scenes/:id/render_lines`, which the page already loads. The client adopts it into a kit task through the existing `followJob`/`withAiTask` (`renderRun.js:32-46`).
  2. Attack:
     - Reuse: the job table, `jobStatus` and `followJob` already exist. The new parts are one query (job blocks joined to blocks by `scene_id`) and an adopt step.
     - It does not cover the mastering half of a chapter ▶ Render: `POST /v1/render_chapter` is a plain request, not a job (`render_chapter_api.js:466-512`). Another window would see the lines but not "mastering".
     - New behaviour the user hasn't seen. **Open questions: should an adopted run show Cancel, which would cancel a run another window or JustWrite started? And does "wherever" mean other windows and apps at all?**
     - Blast radius (pasted greps):
       `server/src/api/render_lines_api.js:100:  app.get("/v1/scenes/:scene_id/render_lines", async (c) =>`
       `server/src/models.js` (the line-page response shape)
       `src/components/StudioRenderChapter.vue:319:const liveRun = computed(() => aiTasks.visibleTasks.find(…`
       `src/components/StudioRender.vue:64:  return tasks.visibleTasks.find((t) => t.feature === "render-scene" && …`
       `src/services/renderRun.js:32:export async function followJob(api, job, { signal, onProgress } = {}) {`
     - Alternative: extend `/v1/active_tasks`, the existing page-refresh recovery door (`active_tasks_api.js:2-7`), with running render jobs. It is the more standard home in this app for "re-attach after reload", but nothing in `src/` polls it for Render today (`src/services/projects.js:195` only).
  3. Surviving fix: ask the user first whether "wherever" includes other windows and apps. If yes, report the scene's running job from the server, adopt it with `followJob`, and settle the Cancel question.

### R4. Deleting a book stops only its render jobs
- **Verdict:** PARTLY
- **Severity:** VISIBLE (edge case: the queue stays busy for a deleted book)
- **Evidence:**
  - `server/src/render_jobs.js:341-357` `_rendering` throws `LineGone` only for render-job lines. `DELETE /v1/projects/:id` (`projects_api.js:895-903`) cancels nothing.
  - An export job keeps warming the deleted book's lines because it has no signal (`export_jobs_api.js:68`), then fails with "project has no scenes to export".
  - The ACX check, the old M4B door and the voice-line export stop only if their own client disconnects (`clientGone`, `projects_api.js:1353,1452,1473`).
  - The chapter-render warm (`render_chapter_api.js:497-499`) has `clientGone` too, and after the job phase it has nearly nothing left to render.
  - Approved (TASKS:1166-1168): "1. Deleting a book doesn't stop its renders. Its lines keep rendering and each one then fails to save … Lean: cancel a book's renders when it's deleted, and check whether deleting a chapter does the same."
- **Refutation tried:**
  - Code: confirmed. Export jobs keep no project id and no cancel hook.
  - Approval: the problem shown was render jobs ("each one then fails to save"), and that is fixed. Whether exports and checks count as "a book's renders" is open to reading. The app itself calls an export's warm rendering ("waiting — the M4B export is rendering 12 lines first", TASKS:1194).
  - Effect: it needs a delete while an export or check of that book runs. Nothing is written to the database (renders land only in the render cache), so there is no data loss. The queue is held and other renders wait behind it.
- **Surviving claim:** Deleting a book while its export job runs leaves its unrendered lines rendering until the warm ends. The ACX check and the voice-line export do the same while their window stays open.
- **FIX:**
  1. Recommended: store `projectId` on each export job. `DELETE /v1/projects/:id` aborts that book's export jobs through the `AbortController` from R2's fix.
  2. Attack:
     - Reuse: the standard `AbortSignal` from R2's fix. The ACX and voice-line doors are request-scoped, so stopping them on delete would need a new per-project abort registry (new code).
     - New behaviour: **open question: does "a book's renders" include exports and the ACX check?**
     - Blast radius (pasted greps):
       `server/src/api/projects_api.js:895:  app.delete("/v1/projects/:project_id", (c) => {`
       `server/src/api/export_jobs_api.js:143:function _start(projectId, filename, mediaType, build) {`
       `server/src/api/export_jobs_api.js:187:  app.post("/v1/export_jobs/:job_id/cancel", (c) => {`
     - Simpler alternative: tell the user the fix covers render jobs only, and leave it.
  3. Surviving fix: ask the scope question. If exports count, abort a deleted book's export jobs, which is a few lines on top of R2(a). Leave the request-scoped ACX and voice-line doors unless the user wants a registry.

### R5. The join thresholds are fixed in code
- **Verdict:** PARTLY
- **Severity:** INTERNAL (nothing a user sees changes today)
- **Evidence:**
  - `server/src/render_core.js:827-828`: `TRIM_BELOW_DBFS = -70.0`, `TRIM_KEEP_MS = 50`. `server/src/audio/chunked.js:36-40`: `PIECE_JOIN_PAUSE_MS = 260`, `PIECE_JOIN_SILENCE_DBFS = -60.0`, `WINDOW_MS = 10`. `chunked.js:24`: "JustVoice's measured decision (2026-10-07…)".
  - −70 / 50 approved word for word (TASKS:1393-1394). 260 approved (TASKS:1360-1361: "cut the quiet on both sides down to 260 ms").
  - **−60 dB / 10 ms were shown and adopted:** TASKS:1258-1261, item 5: "Our audio.cpp copy uses −70 dB on single samples; the server uses −60 dB over 10 ms windows … Lean: match it the next time …". The user answered "do 1-5 go", recorded as "'do' on 5 = match it now (audio.cpp takes the server's rule)". RESEARCH §3 (`RESEARCH.md:753-754`) records −60/10 as how the 260 ms was measured, so "measured decision" is accurate.
  - Family rule (`family-rules.md`, added 2026-10-09 in df3d425, after this build): "Thresholds, limits, names and presets live in the database (seeded, editable in Settings), not in code."
- **Refutation tried:**
  - Approval: the claim that two of the numbers "were never the user's numbers" is refuted. The user saw −60/10 and chose it as the one rule, and the comment is defensible.
  - Code: confirmed that all five are constants.
  - Effect: none today. It matters only if the user wants to tune them.
- **Surviving claim:** Five join values the user approved are code constants. The family rule written two days later says a threshold a user might want to change belongs in Settings, and the user hasn't been asked whether these qualify.
- **FIX:**
  1. Recommended: ask whether any of the five become Settings → Generation rows. If so, seed them in the existing `generation` group, beside `pause_within_paragraph_ms`.
  2. Attack:
     - Reuse: SettingsStore and the existing `generation` rows. `dsp_client.js:269-271` and `render_core.js:872-873` already pass the values per call.
     - **Hidden trap:** the render cache key `_inputsKey(engineId, voice, effectiveText, language, seed, delivery, native, effects)` (`render_core.js:692`) does not include the piece-join values. Making `PIECE_JOIN_*` a setting would let cached lines keep the old join, and takes would not go stale. The setting would have to enter the key, which re-renders every line when it changes. The trim values are applied at the join, so they are safe.
     - New labels: **open questions: each row's name and range, and whether the −70 dBFS / 10 ms technical values belong in Settings at all.**
     - Blast radius (pasted greps):
       `server/src/audio/dsp_client.js:269:    pause_ms: chunked.PIECE_JOIN_PAUSE_MS,`
       `server/src/audio/dsp_client.js:270:    silence_dbfs: pyFloatValue(chunked.PIECE_JOIN_SILENCE_DBFS),`
       `server/src/audio/dsp_client.js:271:    window_ms: chunked.WINDOW_MS,`
       `server/src/render_core.js:872:        trimBelowDbfs: TRIM_BELOW_DBFS,`
       `server/src/render_core.js:873:        trimKeepMs: TRIM_KEEP_MS,`
       `../audio.cpp/dsp/src/line.h:37:    int pause_ms = 260;            // PIECE_JOIN_PAUSE_MS`
       `docs/settings-reference.md:19`
     - Simpler alternative: leave the values as constants and have the user rule that they are not user-tunable.
  3. Surviving fix: ask. If the user wants rows, add them to `generation` and include the piece-join values in the cache key. Leave the comment, which is accurate.

### R6. Names for queue work, and "about N s left", that the user never saw
- **Verdict:** CONFIRMED
- **Severity:** VISIBLE (wording only; nothing narrowed)
- **Evidence:**
  - The owner labels: `generate_api.js:334` "Generate"; `projects_api.js:1352` "the ACX check"; `:1451` "the M4B export"; `:1472` "the voice-line export"; `export_jobs_api.js:67` "the M4B export" / "the chapter WAVs export"; `takes_api.js:309` "a line's take"; `personas_api.js:417` "a persona preview"; `voice_preview_api.js:449` "a voice preview"; `render_chapter_api.js:258` "a chapter render"; `synth_scheduler.js:100` "other work".
  - That last one is a fallback: every submit passes an owner, so it is currently unreachable.
  - A multi-chapter job is named by the book's name (`render_jobs.js:336-337`).
  - `renderRun.js:77` shows "about N s left".
  - Approved (TASKS:1191-1199): examples only, "waiting — 2 · Bigger Inside is ahead…" and "waiting — the M4B export is rendering 12 lines first"; Q2 "every kind of work named (chapter renders, exports, previews) — yes". The figure: "about 1 min left" (TASKS:1478).
- **Refutation tried:**
  - Approval: the user approved naming every kind of work, but never saw these strings. BUILT (TASKS:1206-1208) lists the categories, not the words.
  - Effect: the labels show in the strip, e.g. "waiting — Generate is rendering 3 lines first" when JustWrite or MCP drives Generate.
- **Surviving claim:** Nine queue-work labels, the book-name label for cross-chapter jobs, and "about N s left" are the implementer's wording, never shown to the user.
- **FIX:**
  1. Recommended: show the user the list once, with each label's file:line. No code.
  2. Attack:
     - Reuse: nothing to build.
     - New wording: every label is an **open question**, as is "about N s left" against rounding up to "about 1 min left".
     - Blast radius if any label changes: the nine owner sites above, plus `src/services/renderRun.js:89-98` (`waitingText`) and `renderRun.test.js`.
     - Simpler alternative: none.
  3. Surviving fix: show the list and apply the user's wording.

### R7. Export file names: spaces become underscores, non-Latin letters are lost, and the zip gets "_chapters"
- **Verdict:** CONFIRMED
- **Severity:** VISIBLE
- **Evidence:**
  - `server/src/api/export_jobs_api.js:56` `_safe` replaces every run of characters outside `[A-Za-z0-9._ -]` with "_". `:175` and `:182` then `.replaceAll(" ", "_")` and add `.m4b` or `_chapters.zip`.
  - Results: "The Ninth Facet" → "The_Ninth_Facet.m4b"; "The Wizard's Tale" → "The_Wizard_s_Tale.m4b"; "Café" → "Caf_.m4b"; a Cyrillic or CJK title → a name made only of underscores.
  - The Save dialog's suggested name is `job.filename` (`ExportPanel.vue:96-98,113-114` → kit `saveBlob` → `boot/jv.js:170-173` `suggestedName`).
  - The underscores date from the first Python build (f184daa: `re.sub(r"[^A-Za-z0-9._-]+", "_", name)`).
  - Approved (TASKS:1326-1328): "a Save dialog with folder and file name (the book's title filled in)".
- **Refutation tried:**
  - Approval: "Saved The_Ninth_Facet.m4b" appears only in BUILT (TASKS:1335-1336), which is a report, not the user's word. The "_chapters" suffix appears in no approval.
  - Code: a dialog has no need for ASCII-only names. The OS dialog forbids only `<>:"/\|?*`.
  - Effect: real on every export, and worst for non-English titles. The same `_safe` also mangles chapter names inside the zip (`:105`), though "NN Title.wav" itself was the implementer's wording too (TASKS:1300-1302).
- **Surviving claim:** The Save dialog suggests a mangled title rather than the book's title, and the "_chapters" suffix is invented.
- **FIX:**
  1. Recommended: suggest the title as written, removing only the characters Windows forbids. Send the `content-disposition` header RFC 6266/5987-encoded (`filename*=UTF-8''…`).
  2. Attack:
     - Reuse: JustWrite already has this exact rule, `safeTitle` (`justwrite-app/src/services/bookTransfer.js:40-43`: strip `[<>:"/\\|?*]`, trim, drop trailing dots, fallback "book"). The family rule says to move it into the kit rather than copy it.
     - For the header: the `content-disposition` npm package (jshttp) is the standard. The raw `filename="${job.filename}"` at `:205` would break on quotes and on non-Latin1 characters.
     - New wording: **open question: the zip's name ("<title>.zip"? "<title> chapters.zip"?) and the chapter file names inside it.**
     - Blast radius (pasted greps):
       `server/src/api/export_jobs_api.js:56:export const _safe = (name, fallback) => …`
       `server/src/api/export_jobs_api.js:105:    const title = _safe(scene.title, …);`
       `server/src/api/export_jobs_api.js:175` and `:182` (the two start routes)
       `server/src/api/export_jobs_api.js:205:      "content-disposition": \`attachment; filename="${job.filename}"\`,`
       `src/components/ExportPanel.vue:96-98,113-114`
       `docs/import-and-export.md` (it names `01 Brass Rank.wav`)
     - Simpler alternative: only drop `.replaceAll(" ", "_")`. That still mangles non-Latin titles, so it is not enough.
  3. Surviving fix: move JustWrite's `safeTitle` rule into the kit and use it for the suggested name, encode the header the standard way, and ask about the zip's name.

### R8. ⬇ Chapter WAVs (zip) refuses everything when ffmpeg is missing
- **Verdict:** CONFIRMED
- **Severity:** VISIBLE (only without ffmpeg, which is not bundled: TASKS:1450 NOT "a bundled ffmpeg")
- **Evidence:**
  - `server/src/api/export_jobs_api.js:181` `_needFfmpeg("mastered chapters")` returns 503 before the job starts.
  - Only `masters/` needs ffmpeg. `renderSceneToWav(..., { master: false })` passes target null (`render_chapter_api.js:372-381`).
  - With `master: true` and no ffmpeg, `_masterScenePcm` silently returns raw audio with "ffmpeg-missing" (`render_chapter_api.js:345-347`). The refusal therefore prevents falsely labelled masters.
  - The app's own precedent elsewhere is to degrade and say so: Render returns raw audio with `x-master-fallback`, and QC reports raw (`render_chapter_api.js:338-347,366`).
  - The docs mention only the M4B's 503 (`docs/import-and-export.md:424,522`).
  - Approved (TASKS:1294-1302): "fix all go" on the finding; nothing on ffmpeg.
- **Refutation tried:**
  - Approval: none found. The refusal came in with c3ed6be's Python and was never shown to the user.
  - Effect: a user without ffmpeg can't get even the plain chapter WAVs. They can't make an M4B either, but that refusal is documented.
- **Surviving claim:** Without ffmpeg, the chapter zip refuses the plain `chapters/` WAVs too. The refusal is unasked, undocumented, and unlike Render's degrade-and-say.
- **FIX:**
  1. Recommended: ask. Option (a): without ffmpeg, the zip holds `chapters/` only and the strip or toast says masters need ffmpeg, leaving out `masters/` rather than filling it with raw audio. Option (b): keep the refusal and document it beside the M4B's.
  2. Attack:
     - Reuse: (a) follows the app's existing degrade pattern (`render_chapter_api.js:345-347`) and `haveFfmpeg()`; (b) needs no code.
     - New wording either way. **Open question: the note's words, or the doc line.**
     - Blast radius (pasted greps):
       `server/src/api/export_jobs_api.js:181:    _needFfmpeg("mastered chapters");`
       `server/src/api/export_jobs_api.js:108:    zf.writestr(\`masters/${name}\`, await renderChapterApi.renderSceneToWav(st, scene.id, { master: true }));`
       `src/services/exportRun.js:18-19` (the chapters kind's label "chapter WAVs + masters")
       `docs/import-and-export.md:400-403,522`
     - Simpler alternative: (b).
  3. Surviving fix: put (a) and (b) to the user. Under (a), masters must be left out rather than filled with raw audio.

### R9. On the chapter list, one chapter's render greys out every other chapter's ▶ Render
- **Verdict:** REFUTED (as an unasked addition)
- **Severity:** VISIBLE
- **Evidence:**
  - `src/components/StudioRender.vue:314` `:disabled="anyRunning && !isRunning(row.id)"` is real.
  - The rule predates Slice 4: `c1f7f45^:src/views/StudioView.vue:1103` `:disabled="renderBusyScene !== null && renderBusyScene !== s.id"`.
  - Slice 4 D5 (TASKS:4386-4388) approved "a chapter grid, today's table moved onto the kit's table … Keep Lines, Rendered, ▶ Render and the ACX check per chapter". The behaviour moved with the table.
  - The 10-07 ruling names only the chapter page (TASKS:1169-1170): "On Render's chapter page, a run on one chapter greys out other chapters' buttons … Lean: grey out only the buttons of the chapter that is rendering."
  - The list's design is serial: `renderQueue` holds one `waiting`/`stopped`/`stoppedQueue` state (`StudioRender.vue:124-148`), so allowing a second chapter to start would need more than a template change.
- **Refutation tried:**
  - Code: the rule is real.
  - Approval: it is old behaviour carried by D5, not something added in the 10-04→10-07 work. No decision extends the chapter-page ruling to the list.
  - Effect: real, but it is the behaviour the list has always had.
- **Surviving claim:** none as a finding. Whether the list should follow the chapter page's rule is a fair question for the user, not a defect.

### B1. "Rewrite as" and "Cast" buttons show only a speaker's first word
- **Verdict:** CONFIRMED
- **Severity:** VISIBLE
- **Evidence:** `src/components/StudioRenderChapter.vue:139` `const firstName = (l) => speakerName(l).split(" ")[0];`, used at `:742` (`` `Cast ${firstName(row)}` ``) and `:843` (`` `✏️ Rewrite as ${firstName(row.line)}` ``); mock `src/components/mock/MockRenderChapter.vue:501`, `:597` (`.name.split(' ')[0]`). Introduced in `c1f7f45` (2026-10-05, Slice 4). Approved words (TASKS:2257): "It would read ✏️ Rewrite as Narrator, or the narrator's name if they're a character."
- **Refutation tried:** code — no other path; `firstName` has no other reader, and `speakerName` (`:138`) already gives the full name. Approval — the only "Rewrite as <name>" anywhere the user saw is the audit's "the button already says ✏️ Rewrite as Nettle" (`docs/plans/2026-10-06-one-word-one-meaning-audit.md:41`), a one-word name, so it doesn't settle multi-word names; nothing approves a first-word cut, and "Cast <name>" has no approval at all (the Slice 4 mock was built under "code it all", never shown). Effect — real, with the bundled samples' names: The Speckled Band's first-person narrator, who also speaks, is the speaker "Dr. Watson" in its answer key (`server/samples/the-speckled-band/attribution-truth.json:2`, `:15`) — any cast member can be the narrator (TASKS:5173) — → "✏️ Rewrite as Dr."; "Captain Roan Ferrough" → "Cast Captain"; "Brother Kest" → "Cast Brother"; "Cheshire Cat" → "Rewrite as Cheshire". The Dr. Watson case breaks the approved example word for word.
- **Surviving claim:** Render's ✏️ Rewrite and Cast buttons cut a multi-word speaker name to its first word ("Rewrite as Dr."), against the approved "the narrator's name".
- **FIX:**
  1. Recommended: use the existing `speakerName(l)` in both labels and delete `firstName`; the mock's two labels use `speakerOf(id).name` whole.
  2. Attack: reuse — yes, `speakerName` already exists (`:138`) and the mock already has `speakerOf(...).name`; no new helper. New wording — none (the approved "the narrator's name"); open question only if the user wants a short form for very long names, e.g. "Captain Roan Ferrough" (the speaker's *Also called* list exists but choosing from it would be a new rule — don't). Blast radius (grep `firstName`, `split(' ')[0]` in `src`):
     `src/components/StudioRenderChapter.vue:139: const firstName = (l) => speakerName(l).split(" ")[0];`
     `src/components/StudioRenderChapter.vue:742: ... :label="\`Cast ${firstName(row)}\`"`
     `src/components/StudioRenderChapter.vue:843: :label="row.line.speaker_id ? \`✏️ Rewrite as ${firstName(row.line)}\` : '✏️ Rewrite as the speaker'"`
     `src/components/mock/MockRenderChapter.vue:501: :label="\`Cast ${speakerOf(row.speaker_id).name.split(' ')[0]}\`" @click="goCast" />`
     `src/components/mock/MockRenderChapter.vue:597: :label="row.line.speaker_id ? \`✏️ Rewrite as ${speakerOf(row.line.speaker_id).name.split(' ')[0]}\` : '✏️ Rewrite as the speaker'"`
     No test pins these labels (grep of tests/scripts: none). `docs/studio.md:1117`, `:1232` say "Rewrite as *name*" — already right. Simpler alternative — none simpler; it is a deletion.
  3. Surviving fix: full `speakerName` in both buttons in the app and the mock; `firstName` deleted. No question needed.

### B2. A line set to the persona's own value is saved as "no change"
- **Verdict:** PARTLY
- **Severity:** VISIBLE (rare)
- **Evidence:** `StudioRenderChapter.vue:472` (`setNum`: `if (value !== null && value === Number(personaDefault(l, key))) value = null;`), `:506` (`setWord`), `:525` (`setKnob`); mock `MockRenderChapter.vue:237`, `:276`, `:288`. The rule's only written homes: plan text `docs/plans/2026-10-06-batch-pick-and-findings.md:66-67` ("a value equal to the persona's is saved as none, so 'untouched' stays true") and `:112`, and the BUILT line TASKS:2328-2329. Approved words: TASKS:2216-2217 "It shows the persona's value until you change it. The change is for this line only. It has a ↺ to go back to the persona's value"; TASKS:2315 "A line you haven't touched shows the persona's numbers"; TASKS:2318-2319 Reset "greyed out while the line has no changes".
- **Refutation tried:** code — true as stated; the server (`server/src/line_takes.js:215` `mergeOverride`) stores any value, so the client is the only dropper. Approval — not in the user's words; "until you change it" can be read as "choosing the value already shown is not a change", which is what the code does, but that reading was never put to the user. Effect — partly theoretical: committing the value already shown is indistinguishable from touching a control without changing it (the slider's `change` on release, the pause box on blur — `src/components/DeliveryKnobs.vue:59-63` commits whatever is shown), so the "deliberate pin" the finding describes can only be expressed by dragging away and back or retyping; and the drift only shows if the persona's value changes later. Also missed by the finding: the app's own Emotion and Register ↺ depend on this rule — they "reset" by sending the persona's value (`StudioRenderChapter.vue:803`, `:815`: `setWord(row.line, 'emotion', personaMs(row.line).emotion || '')`).
- **Surviving claim:** the "equal to the persona's = no change" rule (Render's numbers, emotion, register, model settings) is the implementer's, never shown to the user; its only effect is that such a line follows a later persona change.
- **FIX:**
  1. Recommended: no code now — show the user the rule as built and ask whether a line should be able to hold the persona's current value as its own.
  2. Attack: the finding's fix ("save an explicit value whenever a control is moved") would (a) pin a value on a mere click or focus-and-leave, lighting the override dot and un-greying Reset on a line the user didn't change — against TASKS:2315 and :2318-2319; (b) break Emotion's and Register's ↺, which would then pin the persona's value instead of clearing (`:803`, `:815` would have to send `null`, as the mock already does at `MockRenderChapter.vue:557`, `:569`). A real pin needs a distinguishable gesture — a new control (open question: what it is called and where it sits) — i.e. new UI the user hasn't seen. Blast radius (grep `setNum|setWord|setKnob`):
     `src/components/StudioRenderChapter.vue:777: @commit="(key, v) => setNum(row.line, key, v)" @reset="(key) => setNum(row.line, key, null)" />`
     `src/components/StudioRenderChapter.vue:803: ... @click="setWord(row.line, 'emotion', personaMs(row.line).emotion || '')" />`
     `src/components/StudioRenderChapter.vue:808: @update:model-value="(v) => setWord(row.line, 'emotion', v)" />`
     `src/components/StudioRenderChapter.vue:815: ... @click="setWord(row.line, 'register_tag', personaMs(row.line).register_tag || '')" />`
     `src/components/StudioRenderChapter.vue:820: @update:model-value="(v) => setWord(row.line, 'register_tag', v)" />`
     `src/components/StudioRenderChapter.vue:834: @commit="(key, v) => setKnob(row.line, key, v)" @reset="(key) => setKnob(row.line, key, null)" />`
     `src/components/mock/MockRenderChapter.vue:531`, `:557`, `:562`, `:569`, `:574`, `:588` (the same six in the mock)
     Readers of the stored override: `overrideSet` `:451` (the row dot `:694`, Reset's state `:479`). Simpler alternative — keep the rule and record it in the user's words once answered.
  3. Surviving fix: ask the one question ("a value you set equal to the persona's is stored as no change, so the line follows the persona later — keep, or add a way to hold it?"); if "keep", record the answer in TASKS; if "hold it", a new control is designed and shown first, and Emotion/Register ↺ switch to sending `null`.

### B3. 🎧 Run ACX QC is disabled while any chapter renders
- **Verdict:** CONFIRMED
- **Severity:** VISIBLE
- **Evidence:** `src/components/StudioRender.vue:272` `:disabled="qcBusy || anyRunning"` (`anyRunning` `:71`, this window's `render-scene` tasks); mock `src/components/mock/MockRenderGrid.vue:185` the same. Before Slice 4 it was `:disabled="qcBusy"` only (`git show c1f7f45^:src/views/StudioView.vue` lines 1041-1042); `git log -S"qcBusy || anyRunning"` → `c1f7f45` (2026-10-05, Slice 4) and `8b1184d` (2026-10-07, the mock). Approved (TASKS:4387-4388, D5): "Keep Lines, Rendered, ▶ Render and the ACX check per chapter" — no condition.
- **Refutation tried:** code — the condition is there; the button's title is a static description, so nothing says why it's grey. Approval — no TASKS line, plan or commit body mentions the QC button waiting for a render (grep "acx" × run/grey/disab/wait/during in TASKS: nothing); the Slice 4 mock that carried it was built under "code it all" and never reviewed before the build. The 2026-10-07 "a chapter's run greys only its own buttons" rec (TASKS:1167-1168) points the other way. Effect — real: one chapter rendering blocks the whole-book check. There is a reason the implementer could have had (the check renders every chapter's untaken lines itself, unsaved — `docs/studio.md:1349-1350` — so during a render it would re-render the rendering chapter's lines and measure a half-made chapter), but it was never shown.
- **Surviving claim:** the whole-book ACX check is greyed during any chapter render, a condition added in Slice 4 that D5 didn't name, with no reason shown.
- **FIX:**
  1. Recommended: ask, with the trade-off: back to `qcBusy` only (pre-Slice-4 behaviour), or keep the wait and say why on hover.
  2. Attack: "back to `qcBusy`" reuses the old behaviour, but a check started mid-render renders that chapter's untaken lines a second time (unsaved) through the same scheduler and measures a chapter that is half old, half new — a real cost the user should hear before choosing. "Keep and explain" adds wording (open question: the hover text). Either way the asymmetry stays open: a render can still start while the check runs (`:314` doesn't look at `qcBusy`) — open question whether that should wait too. Blast radius (grep `anyRunning|qcBusy`):
     `src/components/StudioRender.vue:71: const anyRunning = computed(() => ordered.value.some((s) => isRunning(s.id)));`
     `src/components/StudioRender.vue:272: <UiButton ... :loading="qcBusy" :disabled="qcBusy || anyRunning" label="🎧 Run ACX QC"`
     `src/components/StudioRender.vue:314: :loading="isRunning(row.id)" :disabled="anyRunning && !isRunning(row.id)"` (R9's line)
     `src/components/StudioRender.vue:346`, `:349` (Render N chapters / Render all — approved to wait)
     `src/components/mock/MockRenderGrid.vue:185` (the mock's copy); `docs/studio.md:1349` (The ACX check — silent on the wait). Simpler alternative — none; it's a one-condition change either way.
  3. Surviving fix: one question to the user (wait or not; if wait, the hover words); then change `:272` and the mock's `:185` together and, if it waits, say so in `docs/studio.md` §The ACX check.

### B4. The Render mock lacks the speaker picker, and two comments describe reversed behaviour
- **Verdict:** CONFIRMED
- **Severity:** INTERNAL (the mock is dev-only; comments are code)
- **Evidence:** App picker `StudioRenderChapter.vue:753-758` (`UiSelect :options="speakerChoices"`, `changeSpeaker`); mock line panel read-only `MockRenderChapter.vue:510-519` (name text, "Change in Cast ➜", "Nobody — give it a speaker in Script ➜"). Stale comments: `StudioRenderChapter.vue:12` "shows who speaks it (read-only — Cast decides, D2)"; `MockRenderChapter.vue:9-11` "(read-only — Cast decides, D2), the numbers override behind its closed hatch (D3)". Approved (TASKS:2885, item 3 of 2026-10-05): "Render's line panel gets the same speaker picker as Script, saving through the same request"; the hatch reversed (TASKS:2322 "NOT: the closed hatch (Slice 4's D3, 2026-10-04 — reversed here)"). Mock rule: CLAUDE.md ("Before calling a screen done, screenshot the mock and the app at the same width and list every difference"); TASKS:1128-1129 item 5 "so the mock stays a true picture of the page".
- **Refutation tried:** code — the mock has no picker and its line-panel code has no speaker setter; the comments are as quoted. Approval — the picker's plan (`docs/plans/2026-10-05-cast-render-persona.md:12-17`) names only `StudioRenderChapter.vue` and `studio.md`; nothing exempts the mock (the frozen-mock rule covers the old HTML mock in `docs/plans/mock/`, not `src/components/mock/`). Effect — no user sees the mock or the comments; the cost is the next session designing from a wrong picture.
- **Surviving claim:** the in-app Render mock is missing the approved speaker picker, and both header comments still describe the read-only speaker (D2) and, in the mock, the closed hatch (D3).
- **FIX:**
  1. Recommended: copy the app's Speaker field (`UiSelect`, the same options rule) into the mock's line panel, writing to the mock's data, and reword both header comments to what the page does now.
  2. Attack: reuse — the app's own markup and `scriptReview.speakerOptions` (what the app's `speakerChoices` is built from, per `docs/plans/2026-10-05-cast-render-persona.md:13`) — no new component. New wording — none (the app's). Blast radius: `src/components/mock/MockRenderChapter.vue:9-11`, `:510-519`; its data `src/services/mock/renderMock.js` (a speaker setter, and the line turning stale as the app's does); `src/components/StudioRenderChapter.vue:12`. Simpler alternative — fix only the comments and leave the mock short — rejected by the mock rule above.
  3. Surviving fix: the picker in the mock (app markup, mock data, the line goes stale) + both comments corrected; screenshot mock vs app at the same width and list differences, per CLAUDE.md.

### B5. Labels on the chapter page that the user never saw (copy only)
- **Verdict:** PARTLY
- **Severity:** VISIBLE (wording only)
- **Evidence:** "as persona X always speaks" (`StudioRenderChapter.vue:712`) was on the list the user approved: `docs/plans/2026-10-06-one-word-one-meaning-audit.md:140` "| StudioRenderChapter.vue:604, :680 | `as June always speaks` | A2 | `as persona June always speaks` |" (TASKS:2034 "your rec go, on the list as shown"); the old wording itself came from the walked HTML mock (`docs/plans/mock/_s4.html:46` placeholder "as June always speaks"). Compare's "take N · 0:05" (`:919`) follows the walked design mock's take names and lengths (`docs/plans/mock/workbench-mock.html:2311-2316` "★ Live · take 3" … "0:02", "take 2" … "0:02"; the redesign mock "is the design", TASKS:5670) and the approved B6 Compare words "A — ★ In use" / "★ Use take B" (TASKS:2081). Not shown anywhere: "Its words" (`:850`; its hint paraphrases the approved "the line goes stale and its old take is kept … Split and merge would stay on Script", TASKS:2271-2273), "new seed" and "earlier words" (`:869`) — the walked mock showed "seed 4471" (`workbench-mock.html:1784`, `:2318`, `_s4.html:90`), not "new seed"; "earlier words" appears only in code (BUILT TASKS:2286 names "Its words").
- **Refutation tried:** code — all five strings are there. Approval — two of the five are covered (above); three are not; "code it all" (TASKS:4373) authorised building the Slice 4 mock unseen, not its words. Effect — real but cosmetic.
- **Surviving claim:** three labels on Render's line panel — "Its words", "new seed", "earlier words" — were never shown to the user.
- **FIX:**
  1. Recommended: show those three once, with where each appears; change nothing until answered.
  2. Attack: no code, no new rule. Open questions (not settled): the field label for ✎ Edit words; whether a take's tag says "new seed" or the seed number as the walked mock did ("seed 4471"); the words for a take made from earlier text. Blast radius (grep): `src/components/StudioRenderChapter.vue:850: <UiField label="Its words" …`, `:869: … "new seed" … earlier words …`; `src/components/mock/MockRenderChapter.vue:604: <UiField label="Its words" …` (the mock's takes use `t.label`, `:622`, fed from `src/services/mock/renderMock.js:80,128-129`); `docs/studio.md:1194` ("↻ New take reads the line again with a **new seed**" — the button's description, unaffected). Simpler alternative — none.
  3. Surviving fix: one question with the three labels; apply the answers to the app and the mock together.

### S1. The second look drops a named answer below the route's confidence floor, then says it "found no one"
- **Verdict:** CONFIRMED
- **Severity:** VISIBLE
- **Evidence:**
  - `server/src/extraction/second_look.js:295`: `if (!["unknown", "narrator", null, undefined, ""].includes(who) && !(useFloor && conf < floor)) {`. A below-floor answer falls through and returns `"none"` (`:310`).
  - Button path: `server/src/api/extraction_api.js:1154` `const floor = pipeline.pickRoute(null, settings).floor;` and `:1183-1184` `floor, useFloor: true`. `"none"` makes `_saveSecondLook` write `meta.second_look_asked = true` (`:578`).
  - Analyze path: `server/src/extraction/pipeline.js:771-772` `floor, useFloor: request.use_floor` (default true, `:102`). `second_look.js:211` sets `second_look_asked` on `"none"`.
  - `pipeline.js:285` `ROUTE_FLOORS = { guided: 0.7, direct: 0.5 }`. With the user's 26 B model, Auto picks direct (14 B rule, `:386-390`), so the floor is 0.5 in practice. 0.7 applies only to a model under 14 B.
  - The Check column then shows `src/services/scriptReview.js:420-421` "Second look found no one — set a speaker, or ＋ Add who's missing and look again." The model's guess is not kept: `floored_from` is never set on this path. The main pass does keep it, as "The AI thought X, but wasn't sure." (`:413`).
  - The floor dates from the first build (`git show e4b32a9:server/justvoice/extraction/second_look.py` line 190, `use_floor and conf < floor`).
- **Refutation tried:**
  - **Code:** no other path keeps the dropped name. The `"below the floor"` test (`server/tests/second_look.test.js:97`) checks only speaker, source and `not_in_cast`, never `second_look_asked`.
  - **Approval:** I read TASKS 2469-2516 (the 10-05 design: "A line it names gets that speaker, marked to check"), 1812-1849 (the button: "Save each answer as it comes, marked to check"), 1747-1782 and 1850-1873, the build plan §1 (no floor; it says only that `floored` lines are among those asked) and the test plan. None of them mentions a floor on the second look's own answers. The only mention is the test record at `2026-10-05-second-look-test.md:72`, "the build's 0.5 floor applied", which is a BUILT record the user never answered. "floor 0.5/0.7 read-only" (TASKS 4432, M6) is the main pass's floor, shown on Script; it is not the second look's.
  - **Effect:** reachable on any run. It is rare at temperature 0 on the 26 B model, because a named answer under 0.5 contradicts the prompt's "only when the text makes it clear". When it happens, the sentence the user sees is false.
- **Surviving claim:** The second look silently applies the main pass's route floor (0.5 on the user's model, 0.7 under 14 B) to its own answers. It then labels a below-floor named answer "Second look found no one". No approved text names this floor.
- **FIX:**
  1. **Recommended:** ask the user whether the second look has a floor.
     - If it has none: pass `useFloor: false` at both call sites. The approved safety was the prompt plus "marked to check".
     - If it keeps one: keep the dropped guess as `floored_from`, so the line does not read "found no one".
  2. **Attack:**
     - **Reuse:** the "keep it" branch uses existing machinery: `floored_from` and the main pass's "The AI thought X, but wasn't sure." (`scriptReview.js:413`). Nothing new is invented.
     - **Open questions** (new wording or numbers the user hasn't seen, not settled here):
       - Floor or no floor.
       - If a floor: the main pass's route numbers, or its own number. Under the family rule, its own number would be a seeded setting.
       - If a floor: which sentence wins on a line that is both asked and floored. "Second look found no one…" and "The AI thought X, but wasn't sure." would collide, so a new composition is needed.
     - **Blast radius:**
       - `server/src/extraction/second_look.js:295: if (!["unknown", "narrator", null, undefined, ""].includes(who) && !(useFloor && conf < floor)) {`
       - `server/src/extraction/second_look.js:211: if (got === "none") rows[i].second_look_asked = true;`
       - `server/src/extraction/pipeline.js:772: useFloor: request.use_floor,`
       - `server/src/api/extraction_api.js:1154: const floor = pipeline.pickRoute(null, settings).floor;`
       - `server/src/api/extraction_api.js:1184: useFloor: true,`
       - `server/src/api/extraction_api.js:578: meta.second_look_asked = true;`
       - `server/src/api/extraction_api.js:439: if (row.second_look_asked) m.second_look_asked = true;`
       - `src/services/scriptReview.js:420: if (line.metadata?.second_look_asked) {`
       - `server/tests/second_look.test.js:97: ["below the floor", { speaker: "ode", confidence: 0.3 }],`
       - `src/services/scriptReview.test.js:233: expect(checkQuestion(line("x", null, { source: "floored", metadata: { second_look_asked: true } }), GROUPS, nameOf))`
     - **Simpler alternative:** drop the floor (two arguments and one test flip, no wording). The risk is a low-confidence wrong name, which still lands under "To check" in amber.
     - **Side flaw:** the button's `pickRoute(null, settings)` ignores a route forced on Script's dropdown and the second-look feature's own model. The floor can therefore differ from the Analyze run it follows.
  3. **Surviving fix:** put one question to the user: "Should the second look drop answers below a confidence floor (today 0.5 on your model)?"
     - On "no": set `useFloor: false` at `pipeline.js:772` and `extraction_api.js:1184`, and flip the test.
     - On "yes": write `floored_from` on the below-floor row, and show the user the sentence the line will then read before building.

### S2. The second look cuts each speaker's "who they are" at 200 characters
- **Verdict:** CONFIRMED
- **Severity:** VISIBLE
- **Evidence:**
  - `server/src/extraction/second_look.js:80`: `` if (who) bits.push(`who="${cpSlice(who, 0, 200)}"`); ``. It came from the first build (`e4b32a9`, Python line 79, `who[:200]`).
  - TASKS 2511-2512 BUILT says only "the cast list now carries 'who they are'". Build plan §3 ("A fix found live") gives no length.
  - TASKS 1238 "first 200 characters" is the BUILT note of the 10-07 main-Analyze test. That 200 belongs to a different prompt, and the decision there was "left as it is".
  - Descriptions are user-editable free text: `src/components/StudioCast.vue:305-306` PATCHes `description`. JustWrite imports oneLiner + " · Also known as: …" (`server/src/imports/adapters/justwrite.js:164-170`).
- **Refutation tried:**
  - **Code:** no other path sends the full description to the second look. The main call sends none at all; that was decided 10-07.
  - **Approval:** no 200 appears anywhere the user answered. The tested prompt (30/30) sent the whole description ("the cast (id: name, also called, description)", test plan Method).
  - **Effect:** the bundled books never hit it. Their longest description is 104 characters (Wren, The Salt-Iron Road; measured from `book.json`), and "Answers to Ode." sits at about 65. It is reachable when a user writes a longer description in Cast, with the clue past character 200.
- **Surviving claim:** An unshown 200-character cap trims each speaker's description in the second look's cast list, so a clue past 200 never reaches the model. It is rare, and only on user-written descriptions.
- **FIX:**
  1. **Recommended:** send the description whole (drop `cpSlice(…, 0, 200)`).
  2. **Attack:**
     - **Reuse:** no new code; this is a deletion.
     - **Open questions:** none if the cap goes. If the user wants a cap, it is a number they must choose, and under the family rule it lives in `ExtractionSettings` beside `second_look_words`, not in code.
     - **Cost:** a long description is repeated in every per-line call. For example, 10 speakers × 1,000 characters is about 2.5 k tokens on a roughly 5.7 k-token prompt. That is within context but slower.
     - **Blast radius:**
       - `server/src/extraction/second_look.js:80: if (who) bits.push(`who="${cpSlice(who, 0, 200)}"`);`
       - `server/src/extraction/pipeline.js:765: castText: castLines(promptCast),`
       - `server/src/api/extraction_api.js:1152: const castText = sl.castLines(promptCast);`
       - `server/tests/second_look.test.js:129: const text = sl.castLines([{ id: "odeline_marran", … description: "Has been living the same hour.\n\nAnswers to Ode." }]);` (short, unaffected)
     - **Simpler alternative:** none simpler than the deletion.
  3. **Surviving fix:** drop the cap. If the user then asks for a limit, add it as a seeded `ExtractionSettings` field with the user's number.

### S3. A not-in-the-book name reaches the banner only if it is 60 characters or shorter
- **Verdict:** CONFIRMED
- **Severity:** VISIBLE
- **Evidence:**
  - `server/src/extraction/second_look.js:306`: `if (name && Array.from(name).length <= 60 && …)`. It came from the first build (`e4b32a9` Python line 199, `len(name) <= 60`).
  - It is the only producer of `not_in_cast`. The banner reads it at `src/components/StudioScriptChapter.vue:136-143` and `:674-678`.
- **Refutation tried:**
  - **Code:** no other path names a longer name. When the cap rejects a name, the line is still marked asked and reads "Second look found no one…".
  - **Approval:** the 10-05 design (TASKS 2493-2497) has no cap: "A line it can't place, but whose speaker it names (someone not in the cast) stays without a speaker. The chapter page's banner adds Old Sedge isn't in the cast". Nor do the build plan §1.3, the 10-06 reworks (TASKS 1679, 1712) or the test plan.
  - **Effect:** mostly theoretical. The prompt asks for "a name", and the observed answers are short ("Old Sedge", "the driver of the trap"). It only bites on a long descriptive name.
- **Surviving claim:** An unshown 60-character cap drops a longer not-in-the-book name, so the banner's "scan … on Discover" link never shows for it. The effect is rare.
- **FIX:**
  1. **Recommended:** drop the `<= 60` test.
  2. **Attack:**
     - **Reuse:** a deletion only.
     - **Open questions:** none if dropped. If a guard against the model writing a sentence into the field is wanted, its length is a number the user must choose (and a setting under the family rule).
     - **Banner:** a long string makes a longer banner line. The `.studio-script-ch__offer` rows already wrap.
     - **Blast radius:**
       - `server/src/extraction/second_look.js:306: if (name && Array.from(name).length <= 60 && !["unknown", "narrator", "none"].includes(name.toLowerCase()) && !castNames(name)) {`
       - `server/src/api/extraction_api.js:436: if (row.not_in_cast) m.not_in_cast = row.not_in_cast;`
       - `server/src/api/extraction_api.js:579: if (row.not_in_cast) meta.not_in_cast = row.not_in_cast;`
       - `src/components/StudioScriptChapter.vue:140: const name = ln.metadata?.not_in_cast;`
       - `src/components/StudioScriptChapter.vue:674: <div v-for="name in notInCast" :key="name" class="studio-script-ch__offer">`
     - **Simpler alternative:** none.
  3. **Surviving fix:** drop the cap. Ask only if the user wants a guard, and then as a setting.

### S4. 🔎 Second look marks the lines it fills as "changed by the last Analyze"
- **Verdict:** CONFIRMED
- **Severity:** VISIBLE
- **Evidence:**
  - `server/src/api/extraction_api.js:574-576`: when a line is named and has no earlier `prev_speaker_id`, the code sets `meta.prev_speaker_id = null`.
  - `:747` turns that key into `changed: true`. The row then shows the `src/components/StudioScriptChapter.vue:723` tag "changed · was no speaker", whose title is "The last Analyze gave this line a different speaker".
  - It raises the chip at `:687-689` (title "Lines whose speaker the last Analyze changed") and the header count at `:182` ("N lines changed speaker").
  - Analyze's own marking only happens on a re-analyze: `extraction_api.js:456-457`, `reanalyzed = PIPELINE_SOURCES.has(block.source)`. After a first Analyze, a line Analyze's own second look fills gets no mark, but the same line filled by the button does.
- **Refutation tried:**
  - **Code:** the mark is real. The tooltip is false for a button-filled line, because no Analyze ran.
  - **Approval:** TASKS 1825-1826 says only "saves each answer to that line alone, without rewriting the chapter. So other lines aren't marked 'changed'". That is silent on the asked line.
    - "the same as the second look inside Analyze" (1820) is about "marked to check". It fails as cover anyway: after a first Analyze, the inside look writes no "changed" mark.
    - The mark appears only in BUILT (1832-1833) and in `docs/studio.md:659-660` ("A line it names shows under Changed, like a line a re-analyze changed"). Neither is the user's word.
  - **Effect:** every line the button names shows it.
- **Surviving claim:** A line 🔎 Second look fills is tagged "changed · was no speaker" and counted under Changed, both of which say "the last Analyze" changed it. The user was never asked about this mark, and after a first Analyze it differs from what Analyze's own second look does.
- **FIX:**
  1. **Recommended:** ask the user to choose:
     - (a) The button writes no new "changed" mark. Delete the `else meta.prev_speaker_id = null` branch and keep the "drop when equal" branch. The line keeps its approved signals: "marked to check" and "AI, from the chapters around it".
     - (b) Keep the mark, and reword the tag title and chip title.
  2. **Attack:**
     - **Option (a):** a deletion in `_saveSecondLook`, with no new wording. `docs/studio.md:659-660` must change in step, because the docs describe the mark.
     - **Option (b):** needs new wording in two titles and the header. The open question is the wording itself, for example whether "Analyze" becomes "Analyze or Second look". That is not settled here.
     - **Blast radius:**
       - `server/src/api/extraction_api.js:576: } else meta.prev_speaker_id = null;`
       - `server/src/api/extraction_api.js:747: changed: Object.hasOwn(bm, "prev_speaker_id"),`
       - `server/src/api/projects_api.js:1039: if (isDict(meta) && Object.hasOwn(meta, "prev_speaker_id")) {`
       - `src/components/StudioScriptChapter.vue:182: if (c.changed) bits.push(`${c.changed} line${c.changed === 1 ? "" : "s"} changed speaker`);`
       - `src/components/StudioScriptChapter.vue:687: <UiChip v-if="counts.changed" :selected="filter === 'changed'"`
       - `src/components/StudioScriptChapter.vue:723: <UiTag intent="accent2" title="The last Analyze gave this line a different speaker">changed · was …`
       - `src/services/scriptReview.js:59: if (filter === "changed") return !!line.changed;`
     - **Simpler alternative:** (a) is the simpler one.
  3. **Surviving fix:** show the user (a) and (b). Lean (a): it removes a mark that was never asked for and needs no new words. Update `docs/studio.md:659-660` with it.

### S5. Words point to "＋ Add", which a later decision moved off Script
- **Verdict:** REFUTED
- **Severity:** INTERNAL
- **Evidence:**
  - **The approved words:** `src/services/scriptReview.js:421` "Second look found no one — set a speaker, or ＋ Add who's missing and look again." is the user's approved text, verbatim (TASKS 1756-1757, commit 0b37e0a, 2026-10-06 12:22).
  - **The later decision:** ten minutes after those words, "Only Discover adds speakers" was approved (52dd095, 12:32; TASKS 1722-1723). Its lean defines the flow these words describe: "The flow becomes: Discover → Script → (if a name is missing) Discover's ＋ Add → back to Script's 🔎 Second look."
  - **No sentence names Script:** none of the cited sentences says the ＋ Add is on Script. Discover's ＋ Add exists, and the same page carries "🔍 A speaker is missing" → Discover (`StudioScriptChapter.vue:634-636`). The banner's link also opens Discover.
  - **The tooltip:** `src/services/chapterRun.js:51-54` "…a name that isn't in the cast is offered for you to add" is the user's verbatim tooltip, approved 2026-10-06 ~11:00 (TASKS 1897-1901). That is after A1 ("the cast" → "the book's speakers", decided 02:42 the same day, d2d8e9e), so it is not superseded by A1. The banner still offers the add via Discover.
  - **The docs:** `docs/studio.md:645-648` already says "After you ＋ Add someone who was missing — on Discover…".
- **Refutation tried:**
  - **Code:** no text sends the user to a control that doesn't exist.
  - **Approval:** the words are the user's own, and the later decision's flow matches them.
  - **Effect:** at most, the Check sentence doesn't say "on Discover". The way to Discover is a button on the same page.
- **Surviving claim:** none. At most, the user could choose to add "on Discover" to their own sentence. That would be a wording change for the user to make, not a defect.

### S6. Before Analyze, a speaker you set is not kept as yours. The page says it is, and Analyze overwrites it.
- **Verdict:** CONFIRMED
- **Severity:** DATA
- **Evidence:**
  - **The code:** `src/components/StudioScriptChapter.vue:240-252`. On `!chapter.value.analyzed`, `send` strips `source` from every change, so a speaker set by the picker, by tick-and-set, by swap or by "Assign N → Narrator" is saved without `corrected`.
  - **Render does the same:** `src/components/StudioRenderChapter.vue:152-159` (the picker) and `src/components/StudioRender.vue:177-181` (the render blocker's Assign).
  - **Analyze overwrites it:** Analyze keeps only `corrected` (`server/src/api/extraction_api.js:449`), so the first Analyze overwrites the line, and an "unknown" answer blanks it. A first Analyze puts no "changed" mark on a `manual` line (`:456-457`), so the overwrite is silent.
  - **Added by the merge pass (re-read):** on a never-analyzed chapter `_linesToKeep` returns null (`extraction_api.js:274-279`: no `analyzed_at`, no pipeline source — `corrected` isn't one), so Analyze takes the `lineIds === null` path (`:396-399`). It writes in place only when its cut equals the current lines exactly (`inPlace`, `:398`); otherwise — the usual case for a pasted chapter, where a paragraph with a quote and a tag is cut into several lines — it deletes every block (`:470-484`) and inserts new ones with the model's speakers (`:487-494`). `_inherited` carries each paragraph's metadata and direction, never its speaker or source (`:336-352`). So on that path even a line saved as `corrected` would be lost.
  - **What the page says:**
    - Beside the button: `StudioScriptChapter.vue:624` "Lines you set are kept."
    - The legend: `:812` "a line you set is yours, and Analyze leaves it alone".
    - The docs: `docs/studio.md:356`.
  - **A false label before Analyze:** such a line reads "Decided by: From the import", with the tip "The speaker came with the import. Nothing has analyzed this line." (`src/services/scriptReview.js:404-405`, `:363`). That is false for a pasted chapter.
  - **Where the rule came from:** the 2026-08-09 Script-tab restore (`3a5a23d`), whose decision 2 derived "analyzed" from `Block.source` being non-null. "Analyzed" is now `analyzed_at` or a pipeline source (`extraction_api.js:690`), and `corrected` isn't one, so that reason is gone. The rule was carried into Script in `86eb21d` (09-29) with the comment "the same rule the render blocker's 'Assign all' has always kept".
- **Refutation tried:**
  - **Code:** no other path preserves the choice.
  - **Approval:** TASKS 2589-2618 (10-05) says only "Let any chapter with lines open before Analyze. Its lines show with no speaker. You fix the words with ✎ Edit…, Split and Merge, then click ✨ Analyze". It says nothing about speakers. The chapter-text-edit plan, the Slice 3 decisions (4422ff) and the script-tab-restore's nine decisions don't state this rule either.
  - **Effect:** reachable since the 10-05 decision opened pasted chapters before Analyze. Every row has a speaker picker.
- **Surviving claim:** On a chapter not yet analyzed, a speaker you set is saved as not yours. The first Analyze silently overwrites or blanks it, while the page says "Lines you set are kept" and labels the line "From the import". The rule is an 08-09 code choice whose original reason no longer holds.
- **FIX:**
  1. **Recommended:** ask the user to choose:
     - (a) A speaker you set is yours before Analyze too. Delete the unanalyzed branch, so `corrected` is always sent, in the three places.
     - (b) Keep the behaviour, and make the page say so on a chapter not yet analyzed.
  2. **Attack:**
     - **Option (a):** reuses the existing `corrected` path, with no new code or wording — **but it does not work on its own** (merge pass): `corrected` only protects a line on the in-place path; on a first Analyze that re-cuts (the usual case) every line is deleted and re-made, so the speaker is lost anyway and `:624`, `:812` and the docs stay false. Making (a) real needs the re-cut path to carry a set speaker into the new lines cut from its paragraph — a new rule (which of a paragraph's new lines gets it, when the paragraph holds a quote and a tag?), i.e. new behaviour the user hasn't seen (open question). The comment's concern also stands: "Assign N → Narrator" and the render blocker's Assign on a never-analyzed chapter would freeze every blank spoken line as the narrator, leaving Analyze nothing to decide.
     - **Open question for (a):** do the bulk narrator assigns keep the old behaviour while per-line choices become yours? That split is a rule the user hasn't seen.
     - **Option (b):** needs new wording on the hint, the legend and the "Decided by" label for the unanalyzed state. The open question is that wording itself.
     - **Blast radius:**
       - `src/components/StudioScriptChapter.vue:246: if (chapter.value && !chapter.value.analyzed) {`. Its callers are `:283` setOne, `:287` looksRight, `:293` setTicked, `:299` swapTicked, `:303` (confirm ticked), `:308` allToNarrator and `:338` (words).
       - `src/components/StudioRenderChapter.vue:154: const analyzed = !!props.scenes.find((sc) => sc.id === props.sceneId)?.metadata?.analyzed_at;`
       - `src/components/StudioRenderChapter.vue:159: body: JSON.stringify(analyzed ? { speaker_id: speakerId, source: "corrected" } : { speaker_id: speakerId }),`
       - `src/components/StudioRender.vue:179: body: JSON.stringify(g.analyzed`
       - Readers of `corrected`:
         - `server/src/api/extraction_api.js:449: if (block.source === "corrected") {`
         - `server/src/api/extraction_api.js:308: return lineIds.flatMap((lid, i) => (src.get(lid) === "corrected" ? [i] : []));`
         - `server/src/api/extraction_api.js:540` (second-look asks)
         - `server/src/api/extraction_api.js:564` (`_saveSecondLook`)
         - `server/src/api/extraction_api.js:791` (`by_you` count)
         - `src/services/scriptReview.js:44` (`secondLookCandidate`)
         - `src/services/scriptReview.js:403` ("You")
     - **Side effect of (a):** a fully hand-set pasted chapter turns `from_import` true (`extraction_api.js:692`).
     - **Simpler alternative:** (a) for per-line choices only. It is one deleted branch in two files, with Assign-all left as is. That still needs the user's word on the split.
  3. **Surviving fix:** put the question to the user: "A speaker you set before Analyze: kept as yours (Analyze leaves it), or replaced by Analyze?" — saying plainly that "kept" is not a one-line change.
     - If kept: a design for carrying a set speaker through the first Analyze's re-cut, shown before building, plus deleting the branch at `StudioScriptChapter.vue:246-252` and `StudioRenderChapter.vue:154-159`; ask separately about the two bulk narrator assigns.
     - If replaced (the cheaper, truthful option): bring the user the wording for `:624`, `:812`, `docs/studio.md:356` and the "From the import" label on a never-analyzed chapter before changing any of them.
     - Unverified neighbour seen on the way: the same re-cut path may undo a Split or Merge made before the first Analyze (the approved flow is "fix the words with ✎ Edit…, Split and Merge, then click ✨ Analyze", TASKS:2589ff) — not checked; worth its own look.

### S7. Script's Review button stays greyed until Analyze, though the row opens the chapter
- **Verdict:** PARTLY
- **Severity:** VISIBLE
- **Evidence:**
  - **The code:** `src/components/StudioScript.vue:476-478` has `:disabled="(!row.analyzed && !row.from_import) || …"`, title "Analyze it first". The row click opens the chapter before Analyze (`:346-349`).
  - **This state was in the approved Slice 3 mock:**
    - The HTML mock already had `<button class="btn s" disabled title="Analyze it first">Review</button>` as unchanged context in `64eec67` (09-29). The in-app mock keeps it at `src/components/mock/MockScriptGrid.vue:207-208`.
    - Slice 3's mock was approved: TASKS 4442-4443 "4 → the go covers this record, the mock", and 4492 "i approve", then "go".
  - **What the 10-05 decision said:** TASKS 2611-2612 "Let any chapter with lines open before Analyze". Its WHY (2614-2615) names only "the grid's row click".
  - **Where the greyed Review was kept:** only in the implementer's plan, `docs/plans/2026-10-05-chapter-text-edit.md:34` "(Review — still disabled before Analyze: 'Analyze it first')". The user never answered on that.
- **Refutation tried:**
  - **Code:** true as stated.
  - **Approval:** the finding missed that the greyed Review was the approved Slice 3 mock's state. The 10-05 words don't say whether Review follows the row.
  - **Effect:** low. The row click does the same thing, and Review's job ("first line to check") has nothing to find before Analyze.
- **Surviving claim:** The 10-05 "open before Analyze" decision left Review greyed, as the earlier approved mock had it. Whether Review should open a never-analyzed chapter too was never asked.
- **FIX:**
  1. **Recommended:** ask "Should Review open a chapter that hasn't been analyzed, as clicking its row does?" If yes, drop `(!row.analyzed && !row.from_import)` and the "Analyze it first" title.
  2. **Attack:**
     - **Reuse:** it reuses `openRow`, which already allows it. There is no new wording: the title falls through to `''`.
     - **The mock rule:** the mock must change in the same change.
     - **Open question:** none beyond yes or no. Hiding Review before Analyze instead would be a new rule, so it is not proposed.
     - **Blast radius:**
       - `src/components/StudioScript.vue:476: :disabled="(!row.analyzed && !row.from_import) || inRun(project.id, row.scene_id, 'analyze') === 'current'"`
       - `src/components/StudioScript.vue:478: : (!row.analyzed && !row.from_import) ? 'Analyze it first'`
       - `src/components/mock/MockScriptGrid.vue:208: :title="row.script.analyzed ? '' : 'Analyze it first'" @click="review" />`
       - `docs/studio.md:321: there. **Review** opens it at the first line to check.`
     - **Simpler alternative:** leave it as the approved mock had it.
  3. **Surviving fix:** ask the yes or no question. On yes, change `StudioScript.vue:476-478` and `MockScriptGrid.vue:207-208` together. Nothing else changes.

### S8. ✎ Edit text is greyed while that chapter's Analyze runs, with no reason shown
- **Verdict:** CONFIRMED (low). The finding's title says "while the chapter is analyzed"; the code greys it only while an Analyze or 🔎 Second look is **running** on that chapter. The body has this right.
- **Severity:** VISIBLE
- **Evidence:**
  - Code: `src/components/StudioScript.vue:484-486`: `:disabled="!row.lines || inRun(project.id, row.scene_id, 'analyze') === 'current'"`. It has no `title`, and it was added this way in `b80200d` (2026-10-05).
  - The `!row.lines` half is fine: a chapter with no lines gets "＋ Add text" instead (`:466-467`).
  - The Review button beside it already gives a reason for the same condition: `'Wait for it to finish'` (`:477`).
  - Approval: TASKS:2597, "2. Edit text at any time, keeping every unchanged line". "At any time" was the choice over the NOT line "Edit text only until the chapter is analyzed" (TASKS:2609). Nothing shown to the user mentions a block while a run is going.
  - Plan `2026-10-05-chapter-text-edit.md` §2 lists only the row click's `inRun current` block. It says nothing about Edit text.
  - `docs/studio.md:335-336` says "to fix a mistake at any time — before or after Analyze" and does not mention the run block.
- **Refutation tried:**
  - Code: it does grey out, with no tooltip. `UiMenuItem` passes a `title` through to its root div, and `.ev-menu-item[data-disabled]` (`src/css/app.scss:1930`) has no `pointer-events:none`, so a tooltip would work.
  - Approval: two analogous blocks were approved, both for other controls:
    - the Second look "isn't offered while that chapter is being analyzed" (TASKS:1822);
    - "Delete stays blocked while either step reads the chapter" (TASKS:3014-3015).
    
    Neither covers Edit text.
  - Effect: the effect is real but brief, lasting only while that one chapter runs. The guard itself is protective:
    - on an analyzed chapter, a mid-run edit makes the run's save fail with "lines changed while it was being analyzed, so nothing was saved" (`server/src/api/extraction_api.js:402-403`);
    - on a never-analyzed chapter, the run rebuilds the lines from the text it read at the start (the `lineIds === null` path, `:396-399` and `:470ff`), so a mid-run edit would be overwritten.
- **Surviving claim:** Edit text is disabled during that chapter's own Analyze or Second look run, with no reason shown, and the user never saw this block. The docs say "at any time".
- **FIX:**
  1. Recommended: keep the guard, because removing it risks losing the edit or the run. Add the reason as the item's `title` when it is disabled by a run, reusing the row's own wording "Wait for it to finish". Add "(not while it is being analyzed)" to `docs/studio.md:335-336`.
  2. Attack:
     - Reuse: the condition and its wording already exist on the Review button (`StudioScript.vue:477`); a `title` is the app's usual way to give a disabled control's reason; no kit change is needed.
     - New wording: "Wait for it to finish" is the app's own, but the user never saw it here. The docs clause is new. Open question: is that reason text right for a menu item?
     - Blast radius:
       - `src/components/StudioScript.vue:485: :disabled="!row.lines || inRun(project.id, row.scene_id, 'analyze') === 'current'"`
       - `src/components/StudioScript.vue:477: :title="inRun(project.id, row.scene_id, 'analyze') === 'current' ? 'Wait for it to finish'`
       - `docs/studio.md:335: - **✎ Edit text** opens the chapter's text in the same box, one paragraph per`
       - Neighbour with the same gap (not in this finding): `src/components/StudioScript.vue:492: <UiMenuItem class="ev-menu-item danger" :disabled="inRun(project.id, row.scene_id) === 'current'"` (Delete, no reason).
     - Simpler alternative: leave the code and add only the docs sentence. That is weaker, because the screen still gives no reason.
  3. Surviving fix: show the user the block and its reason. On their word, add the `title` to the Edit text item, reusing "Wait for it to finish", and add the docs clause. The guard stays.

### S9. The Re-analyze chip's tooltip names only added speakers
- **Verdict:** CONFIRMED
- **Severity:** VISIBLE
- **Evidence:**
  - Code: `src/components/StudioScript.vue:104`: `{ id: "stale", label: "Re-analyze", tip: "A speaker was added since, and the text names them" }`. The chip's state is set by `if (c.added_since?.length || c.edited_since) out.add("stale")` (`:95`).
  - `b80200d` (2026-10-05) widened `:95` from `added_since` alone to include `edited_since`. It left the tip unchanged.
  - The tip came from the Slice 3 HTML mock: "A persona joined the cast since, and the text names them" (`docs/plans/mock/_new_chapters.html:29`). That was renamed later.
  - The user docs already describe both meanings: "**Re-analyze** (someone was added since, or lines changed since)" (`docs/studio.md:287-288`).
  - The in-app mock has the same stale tip (`src/components/mock/MockScriptGrid.vue:25`).
- **Refutation tried:**
  - Code: the chip counts both conditions, and the tip names one.
  - Approval: TASKS:2598-2600 approved that "the row offers Re-analyze for them, as it already does for lines added since the last Analyze". BUILT (TASKS:2612) says "the Re-analyze chip counts the chapter too". Nothing approved the tip's half meaning; the tip was simply left behind.
  - Effect: when a chapter is under the Re-analyze chip only because of ✎ Edit text, the hover gives the wrong reason. This is copy only.
- **Surviving claim:** the Re-analyze chip also counts chapters with lines changed since (`edited_since`), but its tooltip still says only "A speaker was added since…". The docs already say both.
- **FIX:**
  1. Recommended: make the tip say both reasons, taking its words from `docs/studio.md:288`. Make the same change in `MockScriptGrid.vue:25` so the mock matches.
  2. Attack:
     - Reuse: the docs already carry the wording, so nothing new is invented.
     - New wording: the exact tip text, e.g. "A speaker was added since, or lines changed since". The docs say "someone", while the 2026-10-06 one-meaning-per-word ruling uses "speaker". Open question: the user picks the words.
     - Blast radius:
       - `src/components/StudioScript.vue:104: { id: "stale", label: "Re-analyze", tip: "A speaker was added since, and the text names them" },`
       - `src/components/mock/MockScriptGrid.vue:25: { id: "stale", label: "Re-analyze", tip: "A speaker was added since, and the text names them" },`
       - `docs/studio.md:287: (flagged lines, or lines with no speaker), **Not analyzed yet**, **Re-analyze**`
     - Simpler alternative: drop the tip entirely. That is worse: the other chips have tips, and "Re-analyze" alone doesn't say why.
  3. Surviving fix: one tip naming both reasons, in wording the user approves, applied to the app and the mock together.

### S10. Discover's Narrator row has no Ignore
- **Verdict:** REFUTED
- **Severity:** VISIBLE
- **Evidence:**
  - The user's own words: "if there is narration then we need a narrator, that is not an option" (TASKS:3057-3058).
  - The row as shown: "Narrator is the first row in 'Speakers found' … status New, with ＋ Add" (TASKS:3060-3061). An ordinary row shows ＋ Add **and** Ignore (`src/components/StudioDiscover.vue:578-586`), so the text the user approved named only ＋ Add for this row.
  - A way out was also shown and approved: "Told in the first person? Tick that speaker as Narrator on Cast instead." (TASKS:3063-3064).
  - Code: once a narrator exists, the row goes away (`StudioDiscover.vue:129`: `if (hasNarrator(props.cast) || !narration.value) return null;`).
  - The plan doc states "No Ignore — narration needs a narrator" (`2026-10-05-narrator-flow.md` §1). On its own that is not approval, but it agrees with the user's words.
- **Refutation tried:**
  - Code: there is no Ignore (`:584`, `:296-297`), as the finding says.
  - Approval: covered by the user's "that is not an option" and by the shown row's "with ＋ Add" only.
  - Effect: a first-person book has the approved Cast route, which removes the row.
- **Surviving claim:** none.

### S11. The narrator question looks only at the chapters being analyzed, not the book
- **Verdict:** PARTLY
- **Severity:** VISIBLE (low; nothing is lost)
- **Evidence:**
  - Approved words: "✨ Analyze on a book with no narrator stops first: 'This book has no narrator — its narration needs one.'" (TASKS:3064-3065), under the user's "if there is narration then we need a narrator" (TASKS:3057-3058). The plan, as built, says: "✨ Analyze (the grid's and a chapter's Re-analyze) on a book with no narrator stops first" (`2026-10-05-narrator-flow.md` §1).
  - Code, the grid: `src/components/StudioScript.vue:155`: `if (!narratorChecked && !hasNarrator(props.cast) && narrationOf(list) > 0)`, where `list` is the chapters being analyzed.
  - Code, the chapter page: `src/components/StudioScriptChapter.vue:207`: `c.lines - c.spoken > 0`, for this chapter only.
  - Before Analyze, a pasted paragraph that opens with a speech mark counts as speech (`server/src/extraction/flags.js:205-209`, `spokenBlock`: not decided → `opensSpeech(text)`). So "“Hello,” said Tom." counts 0 narration, yet Analyze will cut "said Tom." out as narration.
  - Discover's Narrator row counts narration across the whole book (`StudioDiscover.vue:127`, all `narrationByScene`), so the two disagree.
  - The docs say it stops on any book with no narrator (`docs/studio.md:433-435`).
- **Refutation tried:**
  - Code: as the finding says.
  - Approval: the condition "only when there is narration" follows the user's "if there is narration", so that part is covered. Scoping it to the chapters being analyzed appears nowhere in what was shown.
  - Effect: it is reachable on a narrator-less book in two cases: analyzing a chapter whose paragraphs all open with a quote, or one with no pure-narration paragraph. Analyze then runs without asking. Its tags become narration that waits for a narrator, and the after-the-fact banner "N lines of narration are waiting for one" with ＋ Add Narrator catches it. No data is lost.
- **Surviving claim:** the stop-first question checks only the chapters being analyzed, and counts their narration before Analyze cuts out the tags. An Analyze on a narrator-less book can therefore run without asking, unlike the approved "on a book with no narrator stops first", the docs, and Discover's book-wide count.
- **FIX:**
  1. Recommended: check the whole book's chapters on both pages with the existing helper, `narrationOf(props.chapters)`. Both components already receive `chapters`: `StudioScriptChapter.vue:52` has `chapters: { type: Array … }`.
  2. Attack:
     - Reuse: `narrationOf` (`src/services/narrator.js:15`) and the props already exist, and it matches how Discover counts. No new code beyond the two conditions.
     - It still misses one case: a book whose every paragraph opens with a quote mark, which is rare. The literal reading of the approved words, asking on every Analyze of a narrator-less book, has no miss, but it would also ask on a book with no narration at all, against the user's "if there is narration".
     - New rules: which of the three scopes applies is an open question: (a) every Analyze on a narrator-less book, as worded; (b) when the book has narration, which matches Discover; (c) as built.
     - Blast radius:
       - `src/components/StudioScript.vue:155: if (!narratorChecked && !hasNarrator(props.cast) && narrationOf(list) > 0) {`
       - `src/components/StudioScriptChapter.vue:207: if (!narratorChecked && !narratorId.value && c && c.lines - c.spoken > 0) {`
       - `src/services/narrator.js:15: export function narrationOf(chapters) {`
       - `src/services/chapterRun.test.js:108: expect(narrationOf([{ lines: 78, spoken: 35 }, { lines: 0 }, { lines: 5, spoken: 6 }])).toBe(43);`
       - `docs/studio.md:434: page) on a book with no narrator stops first: *This book has no narrator —`
     - Simpler alternative: change nothing and correct the docs to say "when the chapters you analyze have narration". The approved words point the other way, so this needs the user's word too.
  3. Surviving fix: ask the user (a), (b) or (c). Lean (b): `narrationOf(props.chapters)` on both pages, because it matches Discover and reuses the helper. Then align `docs/studio.md:433-435`.

### S12. The Check tag says "To check" for every kind of check, and the grid's Flagged count is red
- **Verdict:** PARTLY. The tag part survives; the grid part is refuted.
- **Severity:** VISIBLE (copy)
- **Evidence:**
  - Shown and approved (TASKS:1608-1620): "The cell would open with a tag, like the 'changed · was no speaker' tag in Decided by. For example ⚠ No speaker or Check: nearby chapter … red for 'no speaker' and amber for 'worth a look'".
  - Code: `src/components/StudioScriptChapter.vue:753`: `{{ hasNoSpeaker(row) ? "⚠ No speaker" : "To check" }}`. The words "To check" appear only in BUILT (TASKS:1623-1624: "in the filter chips' own words").
  - There are four kinds of check (`src/services/scriptReview.js:430-438`: `run`, `only`, `disagree`, `nearby`). Only "Check: nearby chapter" was ever shown.
  - `accent2` is amber (`just-llm-runner/ui/src/quasar/theme.css:42`, `--warn-bg/--warn-ink`), so the colour matches what was approved.
  - Grid part: `src/components/StudioScript.vue:455` (`intent="danger"`). It comes from the approved Slice 3 design: "M1 loud marks go to Flagged + No speaker" (TASKS:4427). The mock's Flagged cells are `<span class="tag e">` (danger) (`docs/plans/mock/_new_chapters.html:48`), and "The build plan §8.24 and its table of proposals → APPROVED as written" (TASKS:4590). The later amber rulings were about the chapter page's Check cell only ("Only the question's text would change colour", TASKS:2369-2373; "Check column", TASKS:1607).
- **Refutation tried:**
  - Code: confirmed for the tag.
  - Approval: the shown example named the kind ("Check: nearby chapter"), and the tag it was modelled on carries specifics ("changed · was no speaker"). The single generic word was never shown. The grid's red is the approved mock's.
  - Effect: the tag doesn't tell the four kinds apart. The muted sentence below it does (`checkQuestion`), so this is copy, not hidden information.
  - A side note outside this finding: the in-app mock shows Flagged in amber (`src/components/mock/MockScriptGrid.vue:194`, `intent="accent2"`). The mock and the app disagree; the approved HTML mock is red.
- **Surviving claim:** every marked line's tag reads the generic "To check". The approved example named the check's kind ("Check: nearby chapter"), and the user never saw the generic word.
- **FIX:**
  1. Recommended: show the user the four kinds with a short tag for each, then build the one they pick. The alternative is to keep "To check" with the user's explicit word.
  2. Attack:
     - Reuse: the same `UiTag`/`accent2` and the existing `g.check` kinds (`scriptReview.js:430`). No new style.
     - New wording: three tags were never shown, for `run`, `only` and `disagree`. Even "Check: nearby chapter" was shown only as an example. Each is an open question for the user.
     - Blast radius:
       - `src/components/StudioScriptChapter.vue:753: <UiTag :intent="hasNoSpeaker(row) ? 'danger' : 'accent2'">{{ hasNoSpeaker(row) ? "⚠ No speaker" : "To check" }}</UiTag>`
       - `src/services/scriptReview.js:410: export function checkQuestion(line, groups, nameOf, chapterWord = "chapter") {` (where the kinds are read)
       - `docs/studio.md:360: | **Check** | a tag — red **⚠ No speaker** where the line can't render, amber **To check** where it is only worth a look (since 2026-10-06) — then the question to ask, or why the line can't render |`
       - `docs/studio.md:474: amber **To check** tag (a line with no speaker says so there too, under a red`
     - Simpler alternative: ask once whether "To check" is acceptable, which needs no code. The mock/app mismatch on Flagged's colour (`MockScriptGrid.vue:194`) should be fixed to red in the mock either way.
  3. Surviving fix: put the choice to the user: either "To check" stays, or one short tag per kind in wording they approve. Separately, set the mock's Flagged to `danger` to match the approved design.

### S13. The Changed chip is hidden at zero
- **Verdict:** REFUTED
- **Severity:** VISIBLE
- **Evidence:**
  - The approved Slice 3 plan's table of proposals: "'Changed' | On a re-analyze that keeps the lines, a line whose speaker changes records who it was. **The chip shows only when there are any**, and the mark clears when you set or confirm the line" (`docs/plans/2026-08-15-voice-workflow-redesign.md:2006`). That table is "approved with the plan 2026-09-29" (`:1991`).
  - TASKS:4590: "The build plan §8.24 and its table of proposals → APPROVED as written." The user's words for it were "do all 3 and commint" + "go" (TASKS:4579-4580).
  - Code: `src/components/StudioScriptChapter.vue:687`: `v-if="counts.changed"`, which does exactly that.
- **Refutation tried:**
  - Code: it does hide at zero.
  - Approval: the exact rule is in a table the user approved as written.
  - Effect: as designed.
- **Surviving claim:** none.

### S14. "Leave out dialogue tags" only recognises English tags, and the Overview hint doesn't say so
- **Verdict:** PARTLY. The user docs already say it is English only; the Overview hint doesn't, and the user was never told when approving.
- **Severity:** VISIBLE
- **Evidence:**
  - Code: `server/src/extraction/tags.js:13-14` says "The verbs are the anchors' (anchors.DIALOGUE_VERBS), so English tags only." Further down:
    - `:26-33`: English pronouns, `[A-Z]` names and the `_HOW` adverbs;
    - `server/src/extraction/anchors.js:17-25`: the English verb list.
  - What was shown (plan `2026-09-30-script-leftovers.md` §1 B4, `:59-64`): English examples only. The blast-radius row says "`anchors.py:23: DIALOGUE_VERBS = [` | reused for tag detection" (`:113`). Nothing says the switch is English only.
  - The user docs disclose it: "the speaking verbs it knows are English." (`docs/studio.md:1285-1286`).
  - The Overview hint does not: "The narrator skips lines like “said Marius,” that only say who spoke." (`src/components/StudioOverview.vue:291-292`).
- **Refutation tried:**
  - Code: confirmed, English only.
  - Approval: the shown plan said only that the verb list is "reused". The language limit was never stated to the user. The same go approved Speech marks with «Guillemets» and „German“ (TASKS:5084), so non-English books are in scope.
  - Effect: on a French or German book, the switch does nothing, with no error and no audio lost. The narrator just keeps reading the tags. The docs say why; the screen does not.
- **Surviving claim:** the user approved the switch without being told it only knows English tags. On a non-English book it silently does nothing, and only the docs, not the switch's hint, say so.
- **FIX:**
  1. Recommended: show the user the limit and ask: (a) say "English tags only" in the hint; (b) the same, shown only when the project's language isn't English; or (c) add other languages' verb lists.
  2. Attack:
     - Reuse: (a) reuses the docs' fact and needs no code beyond the hint string. (b) needs the project's language (Overview has it, `docs/studio.md:67`) plus a new rule. (c) adds per-language word lists with no standard library to lean on; that is ours to build and maintain.
     - New wording or rules: the hint's English-only words, (b)'s condition, and (c)'s list of languages are all open questions.
     - Blast radius:
       - `src/components/StudioOverview.vue:291: <UiField label="Leave out dialogue tags" layout="block"`
       - `src/components/StudioOverview.vue:292: hint="The narrator skips lines like “said Marius,” that only say who spoke.">`
       - `docs/studio.md:87: - **Leave out dialogue tags** — off by default. When it's on, the narrator skips`
       - For (c), the callers of the matcher:
         - `server/src/api/extraction_api.js:680: const tagsLeftOut = truthy(dget(pm, "leave_out_tags")) ? leftOutBlocks(blocks) : new Set();`
         - `server/src/api/render_chapter_api.js:95: const tagsLeftOut = leaveOutTags ? leftOutBlocks(blocks) : new Set();`
         - `server/src/line_takes.js:420: const leftOut = leaveOut ? leftOutBlocks(blocks) : new Set();`
       - `DIALOGUE_VERBS` also drives the "said Marius" anchors (`anchors.js:71`), so widening it changes Analyze too.
     - Simpler alternative: (a) alone.
  3. Surviving fix: ask the user. Lean (a), a hint that says English tags only. It reuses the fact the docs already state and touches one string. (c) is a separate decision, because it also changes Analyze's anchors.

### Tally
- **CONFIRMED (16):** R1, R2, R3, R6, R7, R8, B1, B3, B4, S1, S2, S3, S4, S6, S8, S9
- **PARTLY (8):** R4, R5, B2, B5, S7, S11, S12, S14
- **REFUTED (4):** R9 (the rule predates Slice 4 and moved with D5's table), S5 (the user's own words; the later flow matches them), S10 (the user: "that is not an option"; the row was shown with ＋ Add only), S13 (the approved Slice 3 table: "The chip shows only when there are any")
- **DATA severity:** S6 only. A speaker set before the first Analyze is lost, and on the usual re-cut path even `corrected` wouldn't keep it, so its "keep it" fix needs a design.
- **Fixes that carry a trap the finding missed:**
  - B2: Emotion's and Register's ↺ depend on the equal-value rule.
  - R5: the piece-join values are not in the render cache key.
  - R1: a split line keeps `paragraph_idx`.
  - R2/R4: one `AbortController` serves both.
  - S6: `corrected` doesn't survive a re-cut.
