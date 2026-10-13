# Verdicts, findings 22–42 and the "Also seen" notes

Tally (21 numbered findings): CONFIRMED 6 (22, 23, 24, 31, 37, 42), plus the version note and Also-seen 2 · PARTLY 13 (25–30, 33–35, 38–41), plus Also-seen 1 · REFUTED 2 (32, 36). Nothing was edited and nothing was run beyond git, grep and reads. The approval evidence comes from both TASKS files, the plan files as they stood when the user answered (`git show`), and the session transcripts (`~/.claude/projects/E--Dev-Web-JustVioce/*.jsonl`).

---

**22. The Labs removal left leftovers in the docs, one error message and the legacy page.**
- **Verdict:** CONFIRMED.
- **Severity:** VISIBLE (the API doc and the ffmpeg error). The legacy page is INTERNAL: `server/src/app.js:462-468` serves it only from a source checkout.
- **Evidence:**
  - `docs/import-and-export.md:503-504` still lists `POST /v1/master` and `/v1/analyze`.
  - `docs/dev/code-map.md:957,962` still lists `/labs` and its redirects. `src/router/` has no labs route.
  - `server/src/mastering.js:156`: "…before /v1/master." This is reached by every chapter master, through `master()` at `render_chapter_api.js:529`.
  - `legacy-gui/index.html:863,2070` still calls `/v1/compare`.
  - Approved: "it goes everywhere" (TASKS:1062). Keeping the legacy panel is the implementer's own OPEN note (TASKS:1089). The user never ruled on it.
- **Surviving claim:** Two doc spots and one error message still point at routes that now return 404. The legacy panel was kept without the user's word.
- **FIX:**
  1. Delete the "Mastered audio direct from API" subsection (`import-and-export.md:500-505`). Delete `/labs` and the `/compare, /renderlab, /audio → /labs` line from `code-map.md` §6, and fix that section's stale `src/router/index.js` (now `routes.js`). Cut " before /v1/master" from `mastering.js:156`.
  2. Attack:
     - These are deletions, so no standard applies.
     - Open question: the shortened error text, "ffmpeg not on PATH. Install ffmpeg or set its bundled path." It is a pure cut, but it is still a wording change.
     - Open question: for `legacy-gui`, drop the Compare panel, leave the frozen page as it is, or delete `legacy-gui/` entirely.
     - Blast radius: no test asserts the message (grep of `server/tests` found nothing). The callers of `_runMaster` are `master` (`render_chapter_api.js:529`) and `masterToWav`. The rest is docs.
  3. Surviving fix: as in step 1. The error text and the legacy page go to the user.

---

**23. Labs was removed before the promised list was shown.**
- **Verdict:** CONFIRMED.
- **Severity:** INTERNAL. The outcome was approved; a step was skipped.
- **Evidence** (transcript `df7d49ac`, 2026-10-08):
  - 19:32:25Z, the promise: "I'd show you the full list of what's affected before removing anything."
  - 19:33:40Z, the user: "1 2 and 3 your rec". Nothing in it waives the list.
  - 19:36:54Z, the removal is applied.
  - 19:38:19Z, "here's the Labs blast radius as recorded", after the edit and before the commit. The decision and the removal are both in 4102112.
  - Also, the STATE at TASKS:1070 quotes "your rec on all go" as part of this decision. That reply (19:10:32Z) answered the voicebox and restructure questions, not Labs.
- **Surviving claim:** The affected list was shown after the removal, not before. The TASKS STATE also misattributes one quote.
- **FIX:**
  1. Show the BUILT list (TASKS:1071-1084) now, ask whether anything should come back, and correct the STATE's quote.
  2. Attack: no code and no new wording. The blast radius is `docs/dev/TASKS.md` only.
  3. Surviving fix: as in step 1.

---

**24. `quasarBaseLayer()` is a NOT STANDARD build step the user never saw, and the step the user did approve has grown.**
- **Verdict:** CONFIRMED, and wider than the review said.
- **Severity:** INTERNAL. Pixel parity was measured, so nothing visible changed.
- **Evidence:**
  - The user's word (kit TASKS:362-365) covered exactly "(b) A small build step of our own that removes that one rule … It's our own code, so it needs your word".
  - The layer arrived in kit e7d176a and JustVoice 5634ffb, at about 2026-10-09T05:52Z. Transcript `010ca198` has no user message between 05:17Z and the 08:58Z compaction.
  - The kit's plan `2026-10-09-kit-controls-on-quasar.md:49` says "decided in slice 2, under 'your recs'".
  - **Also:** `ui/src/quasar/postcss.js:72-90` now strips `!important` from every Quasar disabled-state rule (`DISABLED_STATE`). It also appends a new rule, `.disabled.cursor-pointer { cursor: not-allowed !important }`. Both go past "removes that one rule".
- **Surviving claim:** Two pieces of our own build code are NOT STANDARD and never had the user's word by name: the layer step, and the growth of the approved step.
- **FIX:**
  1. Bring both to the user by name as NOT STANDARD, with the trade-off.
  2. Attack:
     - CSS cascade layers are a web standard (MDN `@layer`, `@import … layer()`). But Quasar's app-vite injects its own stylesheet, so wrapping it in a layer needs one of: our ~15-line PostCSS step, a third-party PostCSS wrapper (I did not find a well-maintained one; UNVERIFIED), or no layer at all (slice 1's specificity fights).
     - Quasar documents theming only through Sass variables and override classes. I did not confirm a documented layer route; check the quasar MCP docs before asking.
     - No new numbers or wording.
     - Blast radius: kit `ui/src/quasar/postcss.js`; `postcss.config.js` in JustVoice, JustWrite, docgen and the kit template; the family guard's check for that entry (`scripts/check-family.js`); the kit theme's `:where()` rules, which rely on the layer.
  3. Surviving fix: ask by name, with the three options.

---

**25. The app id is off §Q, and it now disagrees with the id the shell sets at runtime.**
- **Verdict:** PARTLY.
- **Severity:** VISIBLE on Windows (taskbar grouping and notifications; inferred from the docs, not run).
- **Evidence:**
  - `quasar.config.js:145` and `src-capacitor/capacitor.config.js:7` use `dev.justvoice.app`.
  - JustWrite uses `com.justwrite.app`, docgen `com.just-ai-i18n-docgen.app`, the kit template `com.familytemplate.app`. The law is `app-structure.md:97,115,272,417`.
  - **Refutation found:** `docs/plans/archive/2026-06-20-cross-app-convergence.md:28-36` lists this id under "Justified differences (leave; do NOT 'fix') … Deferred-because-invasive … relocates the OS app-data dir". That reason is Tauri's. Under Electron the data folder is named by `appName` (`src-electron/electron-main.js:20`), not by the app id.
  - **New, beyond the review:** the kit shell calls `app.setAppUserModelId(\`com.${config.id}.app\`)` (`shell/main.js:141`), which gives `com.justvoice.app`. electron-builder uses `appId` as the NSIS shortcut's AppUserModelID (electron.build `appId`). So the installed shortcut and the running window carry different ids.
- **Surviving claim:** JustVoice's id disagrees with §Q and with the shell's runtime id. The only recorded exception is old and rests on a Tauri reason.
- **FIX:**
  1. Set the builder and Capacitor app ids to `com.justvoice.app` before the first Electron release.
  2. Attack:
     - Standard: electron-builder's `appId` (https://www.electron.build/configuration#appid).
     - The NSIS GUID derives from `appId`, so changing it after an Electron install leaves two uninstall entries. No Electron release of JustVoice exists yet (releases wait for the cross-platform one), so now is the cheap time.
     - Open question: `com.justvoice.app` (as §Q says), or keep `dev.justvoice.app` and pass it to the shell.
     - Blast radius: `quasar.config.js:145`; `src-capacitor/capacitor.config.js:7` (no android or ios project exists yet; grep found none); kit `server/src/shell/main.js:141`; TASKS:1035.
     - Alternative: pass an explicit AppUserModelID from `electron-main.js`. That keeps the off-law id and adds config.
  3. Surviving fix: one line in each config, with the user's word.

---

**The version loose end (unnumbered).** The server's version and the installer's version come from two files that nothing ties together.
- **Verdict:** CONFIRMED.
- **Severity:** INTERNAL. Both read 0.1.0 today.
- **Evidence:**
  - `server/src/version.js:5,10` reads `server/package.json`.
  - The packaged app's version is the root `package.json` (`dist/electron/UnPackaged/package.json` was written from it), and that is what electron-updater compares.
  - `release.yml` has no version step.
  - Approved WHY: "one version everywhere" (TASKS:916).
- **FIX:**
  1. Add a server test that asserts both versions are equal. On a release, bump both with `npm version <v> --workspaces --include-workspace-root` (npm-version docs).
  2. Attack:
     - Standard: npm's own command.
     - Open question: "a release bumps both with one command" is a release-process rule the user hasn't seen.
     - Blast radius: `package.json`, `server/package.json`, `server/src/version.js` (read by `/v1/health`, the sidebar and Settings → Updates), and `.github/workflows/release.yml`. `src-electron/package.json`'s "1.0.0" is the main process's dependency manifest, not the app version.
  3. Surviving fix: the equality test now; the bump command once the user rules on the release process.

---

**26. New project, Lexicons, Effects and Speech engines were built with no in-app mock.**
- **Verdict:** PARTLY.
- **Severity:** VISIBLE.
- **Evidence:**
  - `git log --all` on `src/pages/mock`, `src/components/mock`, `src/services/mock` and `src/router/mockRoutes.js` shows mocks only for Personas, the persona page, Studio, Render and the makers (e9c289c), plus Speech engines (cdb332f, 2026-10-11, made for the engine list's slice 4, after 217c444). There was never a mock for Lexicons, Effects or New project.
  - The builds 0761c86, d414330, 40acc92 and 217c444 (2026-10-10 01:35–02:19Z) cite only the frozen HTML mocks `_s1`/`_s10`/`_s11`/`_s13`.
  - Approved (TASKS:183-184): "each is drawn in the app first, then built; each phase needs its own go". CLAUDE.md says the same: "each is drawn fresh in the app when its work starts".
  - The implementer's own promise at 23:46:49Z: "I'll stop only where a choice is genuinely yours: wording, a look, or a NOT STANDARD piece."
  - **Refuted half:** the user's "do it all your rec go" (23:46:35Z) was the reply to the very text that set the per-phase go, so "no per-screen go" is arguable.
- **Surviving claim:** Four screens went to production without the in-app mock that the approved order and CLAUDE.md require.
- **FIX:**
  1. For each screen, screenshot the built screen beside its frozen HTML mock at the same width (CLAUDE.md's own check). List every difference and ask per screen: does it stand, or does it get an in-app mock for the changes?
  2. Attack:
     - This is the repo's own rule (CLAUDE.md; `docs/plans/2026-10-04-persona-voice-making.md` §2), not an industry standard.
     - Drawing a mock now of an already-built screen would just copy the screen. But choosing "compare instead of mock" is itself a process change, so it is an open question.
     - Any mock's copy reopens findings 29 and 35.
     - Blast radius: `src/pages/mock/`, `src/components/mock/`, `src/services/mock/`, `src/router/mockRoutes.js` (development only). If anything changes: `NewProjectModal.vue`, `LexiconsPage.vue`, `EffectsChainEditorModal.vue`, `SpeechEnginesTab.vue`.
  3. Surviving fix: the side-by-side difference list, then the user's choice per screen.

---

**27. New project fills the name, kind and language from the file.**
- **Verdict:** PARTLY.
- **Severity:** VISIBLE (minor).
- **Evidence:**
  - `NewProjectModal.vue:98-100,127-129`: the file fills the name unless you typed one, the kind unless you picked one, and the language only when it is empty.
  - The server makes the dialog's fields win over the file (`projects_api.js:1277-1288`, from 0761c86).
  - **Refuted part:** before 0761c86 an import made the project with the file's own title and kind, and the approved text said Create "would go through the same check Import does now". The prefill keeps that, and the field changes in plain view, so "silently" overstates it.
- **Surviving claim:** The precedence rule ("your own name or kind beats the file's; a suggested one does not") was never shown.
- **FIX:**
  1. Put the rule to the user in one line. No code until then.
  2. Attack:
     - No standard applies; the rule itself is the open question.
     - Blast radius if it changes: `NewProjectModal.vue` `read()`, the override block in `projects_api.js`, and `server/tests/import_book_prose.test.js` (its 38 new lines test the override).
  3. Surviving fix: ask.

---

**28. Projects' ⬇ Import now opens New project, and the old format picker is gone.**
- **Verdict:** PARTLY.
- **Severity:** VISIBLE (minor).
- **Evidence:**
  - `ProjectsPage.vue:181` and `:193-198`, and Script's import door at `:152-157`, all open New project. The "Or start from — a file" button is gone.
  - **Refuted part:** the user was shown "The Import dialog would stay only for re-importing into an existing project" (2026-10-10T00:13:49Z) and "Adding an optional 'Bring the words in' step saves that second trip" (01:25:38Z), then answered "your rec on all go". Rewiring the doors follows from that.
- **Surviving claim:** The format picker changed without being shown. The old dialog had an up-front "Source format" select over every importer, plus a "What is this format?" link (`0761c86^:ImportModal.vue:153-169`). The new one picks automatically and shows "Read it as" only when an extension fits more than one importer (`NewProjectModal.vue:236-238`).
- **FIX:**
  1. Tell the user about the picker change in one line, and ask whether the help link comes back.
  2. Attack:
     - The automatic pick is the same `pickAdapter` the old dialog used for dropped files, so no new code.
     - "Read it as" is covered under finding 29.
     - Blast radius: `NewProjectModal.vue`, `ImportModal.vue` (re-import keeps its select).
  3. Surviving fix: ask.

---

**29. New project's wording was chosen by the implementer.**
- **Verdict:** PARTLY.
- **Severity:** VISIBLE.
- **Evidence:**
  - **Refuted part:** "Bring the words in — optional" is covered. It is the mock's (`_s1`: "2 Bring the words in") and the shown text ("an optional 'Bring the words in' step").
  - The rest is the implementer's, all inline literals in `NewProjectModal.vue`:
    - the column "What comes in" (`:90`). The mock's columns are Source / What lands / Speakers?; the app has Source / Files / What comes in.
    - "Read it as" and its title (`:237`)
    - "Reading the file…" (`:239`)
    - "Start without a file" (`:241`)
    - "Pick the file to bring in" (`:244`)
    - "or drop it here. Create then opens its review, where you pick the chapters to import." (`:245`)
    - the toast at `:149` and the "Couldn't read …" toast
  - The NOT field (TASKS:221-222) and the 23:46:49Z promise both say wording is asked, not chosen.
- **Surviving claim:** About eight strings were never shown.
- **FIX:**
  1. List the strings, with the mock's words beside them, for the user's word.
  2. Attack:
     - Don't propose replacement wording as decided.
     - Blast radius: `NewProjectModal.vue`; `docs/projects.md` "Starting from a file", if it quotes them.
  3. Surviving fix: as in step 1.

---

**30. Lexicons' ▶ doesn't play the line "as it will be said".**
- **Verdict:** PARTLY.
- **Severity:** VISIBLE (low; depends on the data, not run).
- **Evidence:**
  - `voiceAudition.js:58-67` posts `/v1/personas/preview` with the persona's `lexicon_id` swapped to this lexicon (After) or to none (Before).
  - `personas_api.js:392` calls `planLine` without a book lexicon, so `persona_render.js:298` `lineLexicons(null, swapped)` applies this lexicon alone, or nothing.
  - A render applies the book's lexicon first, then the persona's (`render_core.js:450-465`).
  - **Refuted parts:**
    - The "approved" `/v1/generate` route was the plan's own draft (§3). It was never asked: the plan's questions had nothing on Lexicons.
    - The effects remark is wrong. A chapter render also runs the persona's effects chain (`persona_render.js:296`), so passing through it matches the render.
- **Surviving claim:** ▶ and Try a word play this lexicon alone, or none, instead of the book-plus-persona pair a render applies. The sound differs from the render only when the pair's other lexicon has an entry for the same word. The user was never told about the route change.
- **FIX:**
  1. Send the book with the preview. After = the pair with this lexicon in its slot; Before = the pair without it.
  2. Attack:
     - It reuses `render_core.lineLexicons`, the shared rule, so no new piece.
     - It needs an optional `project_id` on `PersonaPreviewRequest`, a change to the wire shape in `models.js`.
     - Open question: which book to use for a persona lexicon that is used in several books, or in none.
     - Blast radius: `server/src/models.js`, `personas_api.js:380-420`, `persona_render.planLine` (it already takes `bookLexicon`), `voiceAudition.auditionWithLexicon`, `LexiconsPage.vue` `hear()`. Other preview callers (`auditionPersona`, `holdDryTake`) are unaffected while the field stays optional.
     - Simpler alternative: keep the route and change the ▶ title. That is a wording change, so also an open question.
  3. Surviving fix: tell the user, and ask the which-book question first.

---

**31. A lexicon entry can't be heard until it is saved.**
- **Verdict:** CONFIRMED.
- **Severity:** VISIBLE.
- **Evidence:**
  - `LexiconsPage.vue:189-193` keeps the saved keys; `:709-710` disables ▶ until the entry is saved ("Save the lexicon to hear this entry").
  - The preview reads only saved entries (`voiceAudition.js:55-57`), so Try a word can't hear a draft spelling either.
  - Neither the mock `_s10` nor plan §3 says "save first".
  - Softened effect: staleness is computed from each line's key, so reverting an entry clears the stale mark.
- **FIX:**
  1. Ask whether unsaved entries should be hearable. On a yes, let the preview carry the draft's entries; the dialog already applies drafts on the client for its text preview (`LexiconsPage.vue:529`).
  2. Attack:
     - No standard applies. It needs a new request field (inline entries) and a change to `prepareLineText`, which takes lexicons by id today.
     - Blast radius: `models.js`, the `personas_api.js` preview, `render_core.prepareLineText`, `voiceAudition.js`, `LexiconsPage.vue`.
     - Simpler: keep save-to-hear and say so (wording, so an open question).
  3. Surviving fix: ask first; build only on a yes.

---

**32. Try a word offers only the personas the lexicon reaches.**
- **Verdict:** REFUTED.
- **Severity:** n/a.
- **Evidence:** `LexiconsPage.vue:195-198` follows the design. Mock `_s10` says "Try a word — as June · as Narrator … Hear before and after, in the voice that will say it", and plan §3 says the same. Falling back to every persona when none is in reach is a widening, not a narrowing. "All personas, in-reach first" can go to the user as an idea.

---

**33. Effects keeps a held take 10 minutes, at most 16 server-wide.**
- **Verdict:** PARTLY.
- **Severity:** INTERNAL.
- **Evidence:**
  - `effect_presets_api.js:177-178` confirmed, and the user never saw the numbers.
  - **Refuted effect:** when a take lapses, the editor makes a new held take and both Dry and Wet play it (`EffectsChainEditorModal.vue:131-140`). The preview also renders with `useCache` (`personas_api.js:401-410`), so re-holding the same line usually returns the same audio.
- **Surviving claim:** These are two internal cache limits nobody saw, not a user-facing defect.
- **FIX:**
  1. Show the two numbers for the user's word. Optionally replace the cache with `lru-cache` (see Also-seen 2).
  2. Attack:
     - `lru-cache` (`max` + `ttl`) is the standard. It is in `node_modules` only through jsdom (11.5.3), so it would need to become a direct server dependency.
     - Making the numbers settings would add two settings nobody asked for: an open question, not the default.
     - Blast radius: `effect_presets_api.js:177-185`, `personas_api.js:38,423`.
  3. Surviving fix: show the numbers.

---

**34. Effects' drag dependency went into JustVoice, not the kit.**
- **Verdict:** PARTLY.
- **Severity:** INTERNAL.
- **Evidence:**
  - JustVoice's `package.json:36,38` has `@vueuse/integrations` and `sortablejs`; the kit's `ui/package.json:25` has only `@vueuse/core`. `EffectsChainEditorModal.vue:25,78` imports `useSortable`.
  - **Refuted part:** plan §4 was never asked (no Effects question). VueUse's `useSortable` is used as its docs show, so nothing is hand-rolled. The kit has no drag-list control, and the family rule targets controls the kit ships.
- **Surviving claim:** The plan's stated placement was changed in a "Built" note without telling the user.
- **FIX:**
  1. Ask: keep it in JustVoice until a second app needs drag, or build a kit control now.
  2. Attack:
     - It is VueUse's `useSortable` either way (vueuse.org/integrations/useSortable).
     - A kit `UiSortableList` would be our own wrapper, so NOT STANDARD and in need of its own word.
     - Blast radius: JustVoice `package.json`, kit `ui/package.json`, `EffectsChainEditorModal.vue`.
  3. Surviving fix: ask. Until then it stays as it is.

---

**35. Lexicons and Speech engines carry the implementer's wording.**
- **Verdict:** PARTLY.
- **Severity:** VISIBLE.
- **Evidence:**
  - **Refuted part:** the "What for?" label is the mock's (`_s13`).
  - The rest is the implementer's:
    - the "What for?" paragraph (`SpeechEnginesTab.vue:952-956`). It names `/v1/transcribe`, `/v1/align` and `justvoice.transcribe` to end users. The mock said: "Whisper is not a voice — it transcribes the reference clips you clone from, so a clone arrives with its text already filled in."
    - `LexiconsPage.vue:203` and `:208`, both new.
    - `:211`, which rewords the mock's "Editing an entry marks them stale, not re-rendered — you choose when to pay for it."
- **Surviving claim:** Four strings were never shown.
- **FIX:**
  1. List the four strings beside the mock's words.
  2. Attack:
     - They are inline literals; propose nothing as decided.
     - Blast radius: the two files; `docs/engines.md` and `docs/lexicons.md` if they quote them.
  3. Surviving fix: as in step 1.

---

**36. "Picking an engine" is nine typed rows.**
- **Verdict:** REFUTED as an unapproved narrowing.
- **Severity:** n/a now.
- **Evidence:** The rows were approved word for word. Plan §5 said "draft below, the user's to approve: new words", Q4 asked "Lean: as drafted", and the user answered "4 your rec" (TASKS:203-205). "Facts from the manifests" described where the draft's facts came from (`model_catalog.modelsFor`, read 2026-10-09), not a runtime read.
- **What survives:** a follow-up only. The 2026-10-13 "adopt everything" decision makes the table incomplete (`SpeechEnginesTab.vue:66-76`), so it belongs in that plan's blast radius.

---

**37. The updater's "Restart now" and every status message were never asked.**
- **Verdict:** CONFIRMED.
- **Severity:** VISIBLE.
- **Evidence:**
  - The approved Q5 lean: "check at start-up and say when an update is ready; download when you press Download; install on the next restart".
  - The plan's §6, as it stood when the user answered (5dd2428, lines 174-180), had no "Restart now" and no strings. "Restart now" first appears in the design text added by 312f3c1, after the answer.
  - Code: `UpdatesPanel.vue:88-89` → `shell/main.js:597-608` `quitAndInstall`; the strings are in `en.json:1677-1691`.
- **FIX:**
  1. Show the button and the 13 strings to the user. Until they say yes, consider dropping "Restart now" to match the approved words exactly.
  2. Attack:
     - `quitAndInstall` is electron-updater's documented API, and the strings are vue-i18n keys in one kit file.
     - Open questions: keep "Restart now"? Each string?
     - Blast radius: kit `ui/src/components/UpdatesPanel.vue`; `ui/src/i18n/locales/en.json` `kit.updates.*`; `shell/main.js` `updateInstall`; `COMMANDS` in `shell/main.js:51` and `preload.js:16`; the three apps' Settings mounts.
  3. Surviving fix: as in step 1.

---

**38. On a Mac the updater only checks and links to the release page.**
- **Verdict:** PARTLY (mostly refuted).
- **Severity:** VISIBLE (Mac users).
- **Evidence:**
  - **Refuted part:** the Mac case was in the plan before the answer (5dd2428 §6: "macOS cannot update itself without a signed app (the paid Apple account); there it says a new version is out, with the link"). It is also forced: electron-updater on macOS needs a signed app (electron.build/auto-update). Code: `shell/main.js:465`.
- **Surviving claim:** The chat question never mentioned the Mac case.
- **FIX:**
  1. Tell the user in one line, with the choice: sign the app (a paid Apple Developer account) or keep the link.
  2. Attack: standard behaviour; no code.
  3. Surviving fix: as in step 1.

---

**39. docgen's updater is off.**
- **Verdict:** PARTLY.
- **Severity:** VISIBLE (low; docgen users).
- **Evidence:**
  - docgen's `src-electron/electron-main.js` passes no `updates`.
  - **Refuted part:** docgen has no `.github/workflows` and no electron-builder `publish`, so there is no feed. Turning the updater on would only show an error.
  - The plan's §6, as it stood when the user answered, named docgen.
  - Also seen: docgen's `src/pages/SettingsPage.vue:48` hardcodes `APP_VERSION = "0.1.0"`, the same problem JustVoice's Q7 fixed.
- **Surviving claim:** docgen has neither releases nor an updater, and the user wasn't asked.
- **FIX:**
  1. Ask whether docgen gets releases. If yes: a release workflow plus electron-builder `publish: github`, as JustVoice and JustWrite have, then `updates: { releasesUrl }`, and the version read from the app.
  2. Attack:
     - Standard: electron-builder publish plus electron-updater.
     - Open questions: docgen's release URL, and its release timing.
     - Blast radius: docgen `quasar.config.js`; a new `.github/workflows/release.yml`; `src-electron/electron-main.js`; `SettingsPage.vue:48-49`.
  3. Surviving fix: ask.

---

**40. Page tasks: a waiting step has its own Cancel.**
- **Verdict:** PARTLY.
- **Severity:** VISIBLE (minor).
- **Evidence:**
  - **Refuted part:** "Cancel stops one step" follows from the approved banner, "the batch only — … with the bar and Cancel" (TASKS:2996-2999), on a page that "shows only its own tasks".
  - Beyond the approved "one line, no bar": the waiting line's Cancel (`StudioRunBanner.vue:87-93`).
  - The implementer's words: both Cancel titles, "Stops X's run. … already done are kept." and "Takes these … out of the queue."
- **Surviving claim:** The waiting line's Cancel and both Cancel titles were never shown.
- **FIX:**
  1. Show them to the user.
  2. Attack:
     - Open question: keep the waiting line's Cancel? Without it, a queued scan can't be withdrawn until it starts.
     - Blast radius: `StudioRunBanner.vue`; `chapterRun.js` `cancelRun`.
  3. Surviving fix: as in step 1.

---

**41. The Claude adapter: thinking "off" is silently dropped on Opus 5.5, Fable and Mythos.**
- **Verdict:** PARTLY.
- **Severity:** VISIBLE (cost; reachable whenever a feature runs on one of these models with thinking off).
- **Evidence:**
  - `anthropic.js:66-75` and `:143-146`: for these models nothing is sent when thinking is off, and no effort either.
  - The claude-api skill confirms the API side: on Opus 5.5, `disabled` returns a 400 at every effort, and the default effort is `medium`; on Fable and Mythos, thinking is always on. So "off" runs adaptive thinking at the default effort.
  - No approval found. Kit 9b534ef (2026-10-10) extended an older Fable/Mythos omission to Opus 5.5.
  - It cuts against the user's 2026-08-06 ruling "no fancy magic — honest provider errors + one fix-pointer sentence" (kit TASKS:1062-1066; `ConfigColumn.vue:311-313`).
  - **Refuted part:** `DEFAULT_MODEL` and the 4096 defaults predate this work (the JavaScript port, f9f6268), and the 4096 budget applies only to older models.
- **Surviving claim:** On these three models, "thinking off" silently runs with thinking at the default effort and says nothing, against the 2026-08-06 ruling.
- **FIX:**
  1. Ask the user: per the ruling, send what is configured and let the API's 400 come back with one fix-pointer sentence; or map Off to effort `low`.
  2. Attack:
     - Anthropic's documented control on these models is effort ("omit the param and lower effort instead"). Mapping Off to `low` would be a new rule: open question.
     - The fix-pointer sentence is new wording: open question.
     - Blast radius: kit `server/src/llm/anthropic.js` (`_applyReasoning`, `GENERATIONS`); `server/tests/adapter_extra.test.js`; every app preset with thinking off routed to these models; kit RESEARCH §7.
  3. Surviving fix: ask, with those two options.

---

**42. The Alice test book ships in the installer, and so do the other test fixtures.**
- **Verdict:** CONFIRMED, and wider than the review said.
- **Severity:** INTERNAL (installer size).
- **Evidence:**
  - `server/package.json` has no `files` field. The packaged app installs `justvoice-server` with `--install-links` (`quasar.config.js:133`), so npm packs the whole folder.
  - The last local build (`dist/electron/UnPackaged`, 2026-10-10 00:13, before Alice landed at 00:59) contains `justvoice-server/{samples,scripts,src,tests,vitest.config.js}`. Its `win-unpacked/.../app.asar.unpacked/node_modules/justvoice-server/samples/` holds the-ninth-facet, the-salt-iron-road and the-speckled-band.
  - At runtime the app reads only the-ninth-facet (`demo_projects.js:17-20`).
  - So Alice (189 KB EPUB plus a 17 KB answer key) ships in the next build, and the tests, scripts and two other test books (about 0.5 MB) already ship. This predates the one-click work; Alice joined an existing convention.
- **FIX:**
  1. Add npm's `files` field to `server/package.json`: `["src", "samples/the-ninth-facet"]`.
  2. Attack:
     - Standard: package.json `files` (docs.npmjs.com, configuring-npm/package-json#files), which `npm pack` and so `--install-links` respect.
     - Open question: does the-ninth-facet's eval data (`attribution-truth.json`, `discover-eval.json`) ship with the demo?
     - Open question: should the test books move to `server/tests/fixtures`?
     - Blast radius: `quasar.config.js` `asarUnpack`; `demo_projects.js`; `server/tests/script_flags.test.js`, `segmentation.test.js` and `server/scripts/eval_attribution.js` read samples from the checkout, so they are unaffected; the family guard (check it doesn't expect `tests/` inside the package).
     - Alternative: `.npmignore`, a deny-list that leaks more easily.
  3. Surviving fix: the `files` allow-list.

---

**Also seen 1. Channels' audio-device list is a placeholder.**
- **Verdict:** PARTLY.
- **Severity:** VISIBLE (low).
- **Evidence:**
  - `native.js:106-108` returns `[]`, carried over from Tauri's placeholder (e307227).
  - **Refuted part:** `AudioChannelsSection.vue:143` hides "N system audio devices detected" when the list is empty, so no false count is ever shown.
- **Surviving claim:** The Devices field asks you to type device ids by hand, with nothing to pick from.
- **FIX:**
  1. Ask: build it, or hide the field.
  2. Attack:
     - Building it can use web standards: `navigator.mediaDevices.enumerateDevices()` (kind `audiooutput`) and `HTMLMediaElement.setSinkId()` (MDN). The shell already grants `media`.
     - Blast radius: `native.js`, `AudioChannelsSection.vue`, and every player that would honour `device_ids` (`channels_api.js` stores them; their consumers were not checked).
  3. Surviving fix: ask.

---

**Also seen 2. `TTLCache` is a hand-port of Python's cachetools.**
- **Verdict:** CONFIRMED (NOT STANDARD, never asked).
- **Severity:** INTERNAL.
- **Evidence:** `voice_preview_api.js:117-160`. It is used at `voice_preview_api.js:218-220` and `effect_presets_api.js:178`, and tested by `server/tests/voice_preview_lru.test.js`.
- **FIX:**
  1. Replace it with `lru-cache` (`max` + `ttl`) as a direct server dependency.
  2. Attack:
     - The semantics match: ttl counts from set, and a get updates recency (lru-cache's `updateAgeOnGet` is false by default). Expired entries are purged lazily unless `ttlAutopurge` is set.
     - Blast radius: the four instances above, plus that test.
  3. Surviving fix: as in step 1, after the user's word on the NOT STANDARD port (or simply as the standard replacement).
