<!-- SPDX-License-Identifier: MIT -->
# A page shows only its own AI tasks, and the step's name leads (2026-10-05)

**The decision is TASKS "A page shows only its own AI tasks, and the step's name leads"
(verbatim, "your rec on all go", then "your rec go" on the two bars).** This doc is the build
under that go and its blast radius.

## 1. What changes

The user: *"you should not show an incorrect task running on a screen"*. Two places broke that:

- **Discover and Script showed one banner for the whole chapter run.** The two steps share one
  queue per book — one model, one chapter at a time, and that stays — but the banner, its
  strip, the row tags and the counts showed whichever step was running, on both pages.
- **`App.vue:635` showed every task with no page of its own at the top of every page** — a
  chapter render on Voices, Smart-assign on Generate.

After:

- **Discover shows only scans, Script only Analyze** — banner, strip, row tags, ticks, counts.
  The banner is the batch (*🔍 Discover · scanning 4 chapters · 1 of 4 done · 0:42 · about 2 min
  left*, the bar, Cancel); the strip under it is the chapter being read now (*Discover · scan ·
  The Keystone*, the prompt reading, the tokens, Retry) and carries no "2 of 4". A step queued
  behind the other is one line, no bar: *🔍 Discover · 2 chapters — waiting for Script to
  finish*.
- **A chapter can be in the queue once per step**, so it can be ticked on Discover while Script
  analyzes it.
- **Each step counts its own chapters** — done of total, time and time left are that step's.
- **The app-wide strip goes.** Each task shows on the page that started it (§3). The header's
  ✨ AI button (running count, the panel) and the AI Tasks page show everything.
- **The step's name leads** outside the page's own button: banners, task labels (*Script ·
  analyze · The Keystone*, *Discover · scan · The Keystone*), the waiting line, and the run's
  no-model warning. **✨ Analyze** and **Scan** stay on their own pages.

Two things follow from "a page shows only its own" and are named here so they can be undone:
**Cancel** on a step's banner or strip stops that step's chapters only (it stopped the whole
queue); a waiting step's line keeps its **Cancel**. Deleting a chapter stays blocked while
either step is reading it (a safety guard, not a display).

## 2. Facts the build stands on (checked 2026-10-05)

- JustWrite has no app-wide strip: 22 surfaces each mount `AiTaskStrip` for their own task
  (`grep -rln AiTaskStrip src` → 22; no `visibleTasks.filter` stack). docgen: one surface, no
  stack. Dropping JustVoice's makes the family one shape.
- The kit's task panel lists every task whatever `inline` says (`aiTasks.js` start(): "the
  panel ignores the flag — it is the registry of everything"); `inline` only told a global stack
  to skip a task. With the stack gone nothing in JustVoice reads it.
- Engine installs, downloads and loads never used the AI task store: `useDownloadTask.js`
  imports no task store; they report on their own rows (`docs/engines.md`). Nothing changes
  for them.
- Render's grid already shows each chapter's `render-scene` task in its own row
  (`StudioRender.vue:54-66, 301-318`), so a chapter render showed twice on Render.

## 3. Where each task shows

| Task (`feature`) | Started on | Shows on |
|---|---|---|
| `speaker_identification` | Discover | Discover's banner + strip |
| `speaker_attribution` | Script's grid, a chapter's page | Script's banner + strip; the chapter page's strip (its chapter) |
| `render-scene` | Render's grid, a chapter's page | the grid's row (as today); the chapter page (its chapter) |
| `render-lines` | Render's chapter page | that chapter page |
| `acx-qc` | Render's grid | Render's grid |
| `smart_assign` | Cast | Cast (`meta.projectId` added) |
| `show-notes` | Export | Export (`meta.projectId` added) |
| `compose` · `persona-rewrite` · `generate` | Generate | Generate |
| `chapter` (Re-render changed) | Lines | Lines (`meta.projectId` added) |
| `voice-gender` | Voices | Voices |

One component lists a page's tasks: `PageTaskStrips.vue` (features + meta → the kit's
`AiTaskStrip` for each), over `services/pageTasks.js`; `runStripTask` uses the same filter.

## 4. Blast radius (greps run 2026-10-05)

| Change | Callers / producers (pasted grep) | Already on the path |
|---|---|---|
| `inRun(projectId, sceneId, kind)` — per step; no kind = either | `StudioDiscover.vue:100,172` · `StudioScript.vue:83,118,300,359,377,379,423,428,429,444` · `StudioScriptChapter.vue:169` · `chapterRun.js:110` (the queue's dedup) | `StudioScript.vue:444` Delete stays blocked for either step |
| `runKind` deleted | `StudioDiscover.vue:101` · `StudioScript.vue:378` | — |
| per-step counts (`stepRun`) replace `run.total/finished/startedAt` | `StudioRunBanner.vue:46,47,49,57,59` (the only reader) | `StudioView.vue:194` reads `current.kind` only — unchanged |
| `cancelRun(projectId, kind)` | `StudioRunBanner.vue:64` (only caller) | the drain's catch: a cancel cleared the whole queue — now that step's |
| `runStripTask(tasks, projectId, kind, sceneId)` | `StudioRunBanner.vue:28` · `StudioScriptChapter.vue:172` · `chapterRun.test.js:15,19,25,26,27` | kit lists oldest first; a finished task lingers (RESEARCH §5) |
| task labels + stats; the no-model warning | `chapterRun.js:32,159,160,174,175,190,192` | the kit panel shows the label |
| the app-wide strip goes | `App.vue:19` (import), `App.vue:635` | tasks started: `ExportPanel.vue:122` · `StudioCast.vue:418` · `StudioRender.vue:188` · `chapterRun.js:158,173` · `renderRun.js:56,82` · `GenerateView.vue:405,438,514` · `LinesView.vue:154` · `VoicesView.vue:80` |
| tasks read by feature | `StudioRender.vue:55` (`render-scene` rows) · `chapterRun.js:61,71` | — |
| user docs | `generate.md` "In-flight status strip" · `ai-features.md:339` · `studio.md` Discover step 2, Script's "Analyzing chapters" · `lines.md:22` | — |
