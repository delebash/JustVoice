## Platform and open-work review (decisions of 2026-10-05 → 2026-10-12)

I found 42 findings across five areas. Nothing was edited. Every line cited was read, either by me or by one of three read-only helper slices; I re-read the lines behind the main claims.

The biggest:
- **Screens skipped their approved steps:** Lexicons, Effects and Speech engines went to production with no in-app mock first and no per-screen go (#26).
- **The Hono move hand-rolled pieces the approved plan named as standard:** CORS, the body limit and validation (#1–#3).
- **Sync filled seven gaps the user never saw.** A backup restore can now overwrite newer work on paired computers (#14–#21).
- **The desktop app ignores the Port setting,** and the API-docs toggle does nothing (#7, #8).

Two things the user should hear straight away:
- **Data risk:** restoring an old backup now pushes it to every paired or cloud-folder computer as the newest change (#18).
- **Breaks the approved rule:** the server now rewrites audio samples itself, against Electron ruling 1 (#5).

## Findings

### A. The server moves to Hono (decided 2026-10-09) — the kit's plan `docs/plans/2026-10-09-hono-standard.md`

**1. CORS is a hand-written port; the approved plan named `hono/cors`.**
- (a) Hono plan §3.
- (b) "CORS | `hono/cors` (the kit's CSRF/origin rules stay ours, as today)" — the user: "your rec on all go".
- (c) `just-llm-runner/server/src/platform/cors.js:1-4`: "Starlette's CORSMiddleware … as a Hono middleware". JustVoice's `server/src/app.js:313` calls `starletteCors(...)`. Nothing imports `hono/cors`.
- (d) Our own code where the standard was named. It is older than the Hono decision (the 2026-10-08 step-4 rec 2 moved it into the kit). The Hono plan replaced that, but §9 records keeping it without asking.
- (e) Sure.
- (f) Use `hono/cors`, or ask for the Starlette port by name as NOT STANDARD.

**2. The body-size limit is hand-checked, with an unseen 1 GiB number.**
- (a) Hono plan §3 and §4.
- (b) "Body size limits | `hono/body-limit`" and "`bodyLimit` | `hono/body-limit`".
- (c) Kit `platform/server.js:48`: `const BODY_LIMIT = 1024 * 1024 * 1024; // 1 GiB`, checked by hand at `:144-151` (413).
- (d) Hand-rolled, and the number was never shown.
- (e) Sure.
- (f) Use `hono/body-limit`; the user picks the limit.

**3. Request validation grew past the NOT STANDARD piece the user approved.**
- (a) Hono plan §5.
- (b) Option a: "Hono's documented `validator()` + ajv … the glue (~20–30 lines …) is ours → NOT STANDARD" — the user: "3 a".
- (c) Kit `platform/server.js:208-245`: `input()` calls `c.req.addValidatedData` directly and never uses `validator()`. §9: "not Hono's `validator()` … (~100 lines)".
- (d) A larger, different NOT STANDARD piece, never taken back to the user by name.
- (e) Sure.
- (f) Bring `input()` to the user by name, with the reason.

**4. MCP doesn't go through `@hono/mcp`.**
- (a) Hono plan §3.
- (b) "MCP | the official SDK's `webStandardStreamableHttp.js` … through `@hono/mcp` 0.3.2".
- (c) JustVoice TASKS "The server moves to Hono", BUILT: "(not `@hono/mcp` — …)". `server/src/mcp/server.js` uses the SDK's `WebStandardStreamableHTTPServerTransport` directly.
- (d) Departs from the approved table without asking. The result is still the official SDK.
- (e) Unsure whether it matters.
- (f) Note it for the user's word.

### B. The family moves to Electron and a Node server (study §9, plan 2026-10-07, step-5 recs)

**5. The server rewrites audio samples itself, against ruling 1.**
- (a) Study §9 ruling 1; the FINDING "Digital silence…" (decided 2026-10-11).
- (b) Ruling 1: "all the audio math into audio.cpp", and per the study "The server does no sample math at all." The guard: "fills any stretch of pure digital silence with that inaudible noise".
- (c) `server/src/engines/audiocpp/slot.js:210` writes samples: `out.writeInt16LE((seed % (2 * lsb + 1)) - lsb, …)`. `:128` `cfg = { … REFERENCES_KEPT: 200, SILENCE_RUN_S: 0.01, SILENCE_FILL_LSB: 2 }`.
- (d) Sample math in the JavaScript server instead of `audiocpp_dsp`. The 10 ms run length and the 200 kept files were never shown; ±2 LSB was in the finding text.
- (e) Sure.
- (f) Move the fill into the fork's `dsp/` as an endpoint, and show the numbers.

**6. The desktop app ignores the Port setting and force-kills whatever holds 17494.**
- (a) Family rule: no hardcoded values a user might want to change.
- (b) None — the user never saw this.
- (c) `src-electron/electron-main.js:22` `port: 17494`. The kit's `shell/main.js:198` always passes `--port`. `:166-192` `evictStaleListener` runs `taskkill /F` on the port's owner. `SettingsPage.vue:1204-1213` offers a Port field ("Restart required after changing").
- (d) A changed port never reaches the desktop app. A headless `justvoice-server serve` on the default port is hard-killed when the window opens. Both carried over from the Tauri shell.
- (e) Sure on the code; unsure whether the user ever accepted the eviction.
- (f) Read the port from settings, and ask before killing a program.

**7. Settings → Server's "Interactive API docs" toggle does nothing.**
- (a) Ruling 5 / plan §0: the JavaScript servers keep the same app and the same screens.
- (b) None — the user never saw the feature dropped.
- (c) `SettingsPage.vue:1221-1226` "Enable Swagger UI at /docs and ReDoc at /redoc" binds `settings.server.docs_enabled`. `server/src/app.js:260-261`: "the JavaScript server publishes no OpenAPI document". `docs/settings-reference.md:32` still lists the setting.
- (d) Half done: the feature was lost in the port, but the toggle and the docs still promise it.
- (e) Sure.
- (f) Ask: rebuild it the Hono way (`@hono/swagger-ui` + an OpenAPI document), or remove the toggle and the docs.

**8. Two tray items do nothing.**
- (a) Q7, the dictation addon "when built".
- (b) None.
- (c) `src-electron/electron-main.js:49-52`: "🎙️ Start dictation (⌥⌘V)" and "🎚️ MCP server: toggle". Only open-settings, about and copy-URL are handled (`MainLayout.vue:454-456`). The comment at `:47-48` says "the events go nowhere yet".
- (d) Every desktop user sees two dead items, and a Mac shortcut label on Windows.
- (e) Sure.
- (f) Hide them until they are wired, with the user's word.

**9. The shell's stop timeout is a number the user never saw.**
- (a) Electron plan §1.1: "waits, then kills".
- (b) No number given.
- (c) Kit `shell/main.js:82` `const STOP_WAIT_MS = 8000`. Tauri waited 10 s + 5 s.
- (d) An engine shutdown that takes longer than 8 s is killed.
- (e) Sure; minor.
- (f) Confirm the number or make it a setting.

**10. The default CORS list still holds Tauri origins, and the window's origin depends on the list.**
- (a) Step-5 rec 4.
- (b) "The desktop window's origin `app://justvoice` is allowed by CORS and CSRF".
- (c) `server/src/models.js:318-330` still lists `tauri://localhost` and `http(s)://tauri.localhost`. `app.js:310` installs CORS, desktop origin included, only `if (corsOrigins.length || corsRegex)`.
- (d) Tauri leftovers. With both CORS settings emptied by API, the window would lose CORS.
- (e) Sure on the code; low impact.
- (f) Drop the Tauri origins and always allow `app://justvoice`.

**11. The clean-room rewrite's 21 gap rulings were never shown to the user.**
- (a) TASKS "The family moves to Electron…", "SPEC WRITTEN 2026-10-08".
- (b) Approved: "a clean-room rewrite of all 14 credited pieces … the four Vue components (keep-alive, chord picker, capture pill, dictate window)". The 21 gaps were "ruled with my rec under 'your rec you can do it all without me'" — a reply given to two other questions.
- (c) `ChordPicker.vue` was deleted, not rewritten (ruling 7). `/mcp` moved behind the bearer token (11). The splitter's rules changed (`server/src/audio/chunked.js:1-17`). `migrations.js` was deleted (1).
- (d) Behaviour changes the user never saw, including one approved piece dropped (the chord picker).
- (e) Unsure: "you can do it all without me" may be read as a blanket delegation.
- (f) Show the user the 21 rulings as a list, with ChordPicker first.

### C. JustVoice's sync (decided 2026-10-08)

All of C share (a) TASKS "JustVoice's sync…" and (b) "projects, scripts, personas and lexicons, but not the audio, voice files or generated takes". Each item below except #21 is one of the "Choices made under 'your rec' where the decision had gaps (each reversible — say if not)", which were never shown.

**12. The `.jvsync` file extension was chosen without the user.**
- (c) `server/src/sync.js:171` `extension: "jvsync"`; `SettingsPage.vue:1193`.
- (d) A file type the user sees but never named.
- (e) Sure.
- (f) Ask.

**13. Speakers and corrections, and so the cast, count as "the script".**
- (c) `sync.js:31` `SYNC_TABLES = ["projects","scenes","blocks","speakers","speaker_corrections",…]`.
- (d) Who plays whom syncs, though the approved words don't name it. A likely reading, but not asked.
- (e) Sure.
- (f) Confirm with the user.

**14. A persona's picture does not sync.**
- (c) `sync.js:37` `out.personas = { exclude: ["avatar_path"] }`.
- (d) Narrows "personas": a synced persona arrives with no picture.
- (e) Sure.
- (f) Ask: sync the picture, or keep it per computer.

**15. An imported voice bundle now keeps its id.**
- (c) `server/src/voice_bundle.js:138` `const ownId = … voicesStore.get(m.id) == null ? m.id : ""`.
- (d) Changes voice import outside the sync decision.
- (e) Sure.
- (f) Ask.

**16. A backup restore and a factory reset now act on sync.**
- (c) `server/src/data_admin.js:199-201` `resetSync`; `:214-218` "the restored projects sync as this device's change".
- (d) Restoring an old backup pushes it to every paired or cloud-folder computer as the newest change, which can overwrite newer work. A reset silently unpairs this computer.
- (e) Sure on the code; the overwrite is inferred from newer-stamp-wins.
- (f) Put both to the user; consider asking before a restore propagates.

**17. A JustVoice-only deletion log sits beside the sync product.**
- (c) `sync.js:77-89`: its own `jv_sync_deleted` table and `BEFORE DELETE` triggers. `:100-137` `projectScope` follows every foreign key.
- (d) NOT STANDARD and app-local, against the family rule "A gap is filled in the kit". JustWrite has nothing like it.
- (e) Sure that it is hand-rolled; unsure where it belongs.
- (f) Move it into `@delebash/sqlite-sync`, or get the user's word by name.

**18. The sync notice offers Reload, with its own wording, in a copied watcher.**
- (c) `src/services/syncWatch.js:35-38`: "Changes from another device arrived." / "Reload to see them." / `duration: 30000`; `:15` `let wait = 5`. Lines 10-31 copy JustWrite's `projectApi.js` `watchSync`.
- (d) Wording and timings the user never saw. JustWrite reloads by itself while JustVoice asks first. The copy breaks "Copies drift".
- (e) Sure.
- (f) One `watchSync` in the kit, with the behaviour and the words put to the user.

**19. Sync stays an app-only Settings section.**
- (c) `src/services/settingsSections.js:11` "app section (not yet the family canon …)".
- (e) Sure; low impact.
- (f) Ask.

**20. A podcast's Stories timeline doesn't sync.**
- (c) `sync.js:31` leaves out `stories` and `story_items`; `stories` has a `project_id`.
- (d) Possibly implied by "not the audio", but never said, and `docs/sync.md` doesn't list it under what stays.
- (e) Unsure.
- (f) Ask, and document it either way.

**21. The kit's re-load-while-loading fix fills gaps of its own.**
- (a)/(b) "The work's eight questions", answer 2: "run it when the load finishes".
- (c) Kit `runner/lifecycle.js` (commit 1347b49): "the newest ask winning … A stop drops it", and the kept re-tune runs "also after a failed load".
- (d) Three behaviours the user never saw.
- (e) Unsure; they are sensible.
- (f) List them for the user.

### D. Labs goes; Quasar; the version

**22. The Labs removal is half done in the docs and one error message.**
- (a) "Labs goes …".
- (b) "it goes everywhere: … those three routes and their tests".
- (c) Still there:
  - `docs/import-and-export.md:503-504` lists `POST /v1/master` and `POST /v1/analyze`.
  - `docs/dev/code-map.md:957,962` lists `/labs` and the redirects.
  - `server/src/mastering.js:156` "…before /v1/master."
  - `legacy-gui/index.html:863` still calls `/v1/compare` (kept by the implementer as "frozen").
- (d) API users and the ffmpeg error point at routes that now 404.
- (e) Sure.
- (f) Delete or reword those lines; ask about the legacy panel.

**23. Labs was removed without the promised list being shown first.**
- (a)/(b) "I'd show you the full list of what's affected before removing anything."
- (c) The decision and the removal landed in one commit, 4102112. The blast radius appears only in BUILT.
- (e) Unsure: "1 2 and 3 your rec" may have been taken as covering it.
- (f) Show the list now.

**24. `quasarBaseLayer()` is a NOT STANDARD build step the user never saw.**
- (a) Kit TASKS "Every family app moves to Quasar", OPEN 5.
- (b) The user's word covered `dropQuasarDisabledRule` only ("A small build step of our own … needs your word").
- (c) JustVoice's `postcss.config.js` runs `quasarBaseLayer()`, putting all of Quasar's CSS in a cascade layer. The kit's plan `2026-10-09-kit-controls-on-quasar.md:49` says "under 'your recs'".
- (d) The global rule says a blanket "your rec" never covers a NOT STANDARD piece.
- (e) Sure.
- (f) Bring it to the user by name.

**25. The app id departs from §Q.**
- (a) Kit `app-structure.md` §Q.2 and §1.
- (b) "`appId: 'com.<id>.app'`".
- (c) `quasar.config.js:145` `appId: 'dev.justvoice.app'`; `src-capacitor/capacitor.config.js:7`.
- (d) The only family app off the law; no TASKS line records an exception.
- (e) Unsure: it may be kept on purpose for install identity.
- (f) Ask: a recorded exception, or `com.justvoice.app`.

The version (answer 1 of "Four answers") is built as approved. One loose end, unsure: the displayed version comes from `server/package.json` (`server/src/version.js:10`), while electron-updater compares the root `package.json`. Both say 0.1.0 today, but nothing ties them together. Fix: derive one from the other, or assert they are equal.

### E. "Every open task, in the recommended order" (2026-10-09) — the screens and the updater

**26. Lexicons, Effects and Speech engines were built with no in-app mock first and no per-screen go.**
- (a) "Every open task…", item 3.
- (b) "each is drawn in the app first, then built; each phase needs its own go".
- (c) `git log --all` on `src/pages/mock`, `src/components/mock` and `src/views/mock` shows no Lexicons, Effects or New project mock ever. The Speech engines mock arrived 2026-10-11 (cdb332f), after 217c444. The builds (d414330, 40acc92, 217c444) cite only the frozen HTML mocks `_s10`, `_s11` and `_s13`. Only Engines' rows (Q4) and New project got answers.
- (d) The approved process was skipped; three screens went straight to production.
- (e) Sure.
- (f) Draw each in the app, compare it with the built screen, and get a go per screen.

**27. New project fills the name, kind and language from the file — never shown.**
- (a) Same entry, New project.
- (b) "the dialog stays, a file is optional in it, and the import review page you already have follows when there is one" plus "The small table of what each file type brings in".
- (c) `src/components/NewProjectModal.vue:127-129`: `if (!nameChosen.value && p.name) name.value = p.name; if (!kindChosen.value …) selected.value = p.kind; if (!language.value && p.language) …`.
- (d) A behaviour the user never saw: the file silently overrides suggested values.
- (e) Sure.
- (f) Ask.

**28. Projects' ⬇ Import now opens New project, and the old import picker is gone there.**
- (a)/(b) As in 27.
- (c) `src/pages/ProjectsPage.vue:181`, `⬇ Import` → `createBlank`; the empty state at `:193`; Script's import door at `:151-158`. "Or start from — a file" was removed.
- (d) Rewired doors the user never saw. The format picker is now automatic (`pickAdapter`) unless an extension is ambiguous.
- (e) Sure.
- (f) Confirm with the user.

**29. New project's wording was chosen by the implementer.**
- (a) Same entry. Its NOT field: "wording and looks the decisions leave open are asked, not chosen".
- (b) None for these strings.
- (c) `NewProjectModal.vue`:
  - `:231` "Bring the words in — optional" (the mock's words)
  - `:237` "Read it as"
  - `:239` "Reading the file…"
  - `:241` "Start without a file"
  - `:245` "or drop it here. Create then opens its review…"
  - `:90` "What comes in"
  - `:149` "…isn't a file JustVoice imports — the table lists what it reads."
- (e) Sure.
- (f) List the strings for the user's word.

**30. Lexicons' ▶ goes through a different route, so it isn't "as it will be said".**
- (a) Plan 2026-10-09 §3.
- (b) "before / after through `POST /v1/generate` with `lexicons: []` against `[this lexicon]`".
- (c) `src/services/voiceAudition.js:58-61` posts `/v1/personas/preview` with `persona: { ...persona, lexicon_id: lexiconId }`. The ▶ title at `LexiconsPage.vue:710` says "Hear “X” as it will be said". A render applies the book's and the persona's lexicons together (`render_core.js:460-463` `lineLexicons`).
- (d) The route change was recorded only in the plan's "Built" note, never asked. When the book's and the persona's lexicons differ, neither Before nor After matches the render, and both pass through the persona's effects.
- (e) Sure on the path; the audible mismatch depends on the data and was not run.
- (f) Tell the user. After = `lineLexicons` with this lexicon in its place; Before = the same without it.

**31. A lexicon entry can't be heard until saved.**
- (a)/(b) §3: "▶ per entry and Try a word".
- (c) `LexiconsPage.vue:709-710` `:disabled="!isSaved(row) || !hearAsId"`, title "Save the lexicon to hear this entry".
- (d) You can't try a spelling before committing it, and saving marks every reached line stale.
- (e) Sure.
- (f) Send the draft entries with the preview, or ask.

**32. Try a word offers only some personas.**
- (a)/(b) §3: "Try a word (as each persona the lexicon reaches)".
- (c) `LexiconsPage.vue:195-198` `return inReach.length ? inReach : personas.value;`
- (d) Once any persona is in reach, every other persona disappears from the picker.
- (e) Unsure: it matches the plan's text, which was never asked as a question.
- (f) Ask: all personas, with those in reach first?

**33. Effects keeps a held take 10 minutes, at most 16 server-wide.**
- (a) Plan §4 "Built", written after the build.
- (b) None — the user never saw these numbers.
- (c) `server/src/api/effect_presets_api.js:177-178` `HELD_TAKE_TTL_S = 10 * 60; heldTakes = new TTLCache(16, …)`.
- (d) Hardcoded. A lapsed take re-renders Dry, which on a sampling model is a different take.
- (e) Sure.
- (f) Show the numbers or make them settings.

**34. Effects' drag dependency went into JustVoice instead of the kit.**
- (a)/(b) Plan §4: "the kit's UI takes the dependency so every app has it (family rules: a gap is filled in the kit)".
- (c) JustVoice's `package.json` has `@vueuse/integrations` and `sortablejs`. The kit's `ui/package.json` has only `@vueuse/core`. `EffectsChainEditorModal.vue:25,78` imports `useSortable` on the app side. The "Built" note's "The kit takes no dependency yet" is the implementer's own call.
- (e) Sure.
- (f) Ask whether it moves into the kit now, as the approved design says.

**35. Lexicons and Speech engines carry implementer wording.**
- (a) NOT: "wording … asked, not chosen".
- (b) Plan §5 said only "the clone transcripts and dictation it serves".
- (c) The strings:
  - `SpeechEnginesTab.vue:950-956`: "What for?" and its paragraph, which names `/v1/transcribe`, `/v1/align` and the MCP tool to end users.
  - `LexiconsPage.vue:203`: "Nothing reads this lexicon yet, so try it in any persona's voice."
  - `LexiconsPage.vue:208`: "Nothing reads this lexicon yet — choose it on a book's Overview or on a persona's page."
  - `LexiconsPage.vue:211`: "Editing an entry makes them read stale on Render — nothing renders again until you choose to."
- (e) Sure.
- (f) List them for the user's word.

**36. "Picking an engine…" is nine typed rows that no longer cover the engine list.**
- (a) Plan §5, Q4 (approved "as drafted"), against the 2026-10-13 decision "adopt everything audio.cpp has".
- (b) "facts from the manifests".
- (c) `SpeechEnginesTab.vue:66-76` `const PICKING = [ … ]` holds literal facts ("Kokoro — 54 built-in voices, 9 languages", "2.8 GB at 8-bit").
- (d) Not read from the manifests, so it will drift. It names only the hand-wired engines.
- (e) Unsure: the rows were approved verbatim.
- (f) Ask: generate them from the manifests, or say which engines they cover.

**37. The updater's "Restart now" and every status message were not asked.**
- (a) "Every open task…", Q5, plus its NOT field.
- (b) "check at start-up and say when an update is ready; download when you press Download; install on the next restart".
- (c) Kit `ui/src/components/UpdatesPanel.vue:88-89` "Restart now" → `shell/main.js:602-610` `quitAndInstall`. The kit's `en.json` `kit.updates.*`: "Version {version} is out.", "…It installs when you quit the app.", "Couldn't update: {error}", "Open the release page".
- (d) An extra control and wording first written in the plan's §6 after the decision.
- (e) Sure.
- (f) Show the button and the strings to the user.

**38. On a Mac the updater only checks and links to the release page.**
- (a)/(b) As in 37. The Mac case was in the plan text, not in the question answered.
- (c) Kit `shell/main.js:465` `canInstall: process.platform !== "darwin"`.
- (e) Unsure whether the user saw it.
- (f) Confirm.

**39. docgen's updater is off, though the plan included it.**
- (a)/(b) Plan §6: "(JustWrite, JustVoice, docgen Settings → Updates)".
- (c) docgen's `src-electron/electron-main.js` passes no `updates:`. TASKS BUILT: "docgen's stays off until it has releases".
- (d) A narrowing with a reason but no ruling.
- (e) Sure.
- (f) Ask.

### F. Page tasks, and the one-click work built so far

**40. Page tasks: Cancel stops one step, and a waiting step has its own Cancel.**
- (a) "A page shows only its own AI tasks…".
- (b) A waiting scan is "one line, no bar"; nothing about Cancel.
- (c) `src/components/StudioRunBanner.vue:87-91`: the waiting line has a Cancel, and `cancelRun(projectId, kind)` stops one step only. TASKS BUILT: "Named in the plan §1 as following from …".
- (d) Cancel used to stop the whole queue; the implementer concluded otherwise.
- (e) Unsure: it arguably follows from the decision.
- (f) Put both behaviours to the user, one line each.

**41. The Claude adapter: thinking "off" is silently ignored on Opus 5.5, Fable and Mythos.**
- (a) "One-click audiobook…" BUILT: "the kit's Claude adapter takes the 5.x models (kit 9b534ef)". The goal: "not [using] too much tokens so it is very cheap".
- (b) None — the user never saw this.
- (c) Kit `server/src/llm/anthropic.js:66-68`: "null where it can't be (Fable, Mythos, Opus 5.5 400 on disabled; … the model thinks anyway)". Also hardcoded: `DEFAULT_MODEL = "claude-haiku-4-5"` (`:39`) and the 4096 budget / max_tokens defaults (`:155`, `:177`).
- (d) A user who switches thinking off still pays for it, and nothing on screen says so.
- (e) Unsure on the UI side (greps only).
- (f) Say "this model always thinks" when the switch is off on these models; put the defaults to the user.

**42. The Alice test book and its answer key ship in the installer.**
- (a) "One-click audiobook…" BUILT: "`server/samples/alice-in-wonderland/`".
- (b) "your rec on 1-2 go" (Alice as the test book). Nothing about shipping it.
- (c) `server/samples/alice-in-wonderland/{book.epub,attribution-truth.json}`. Only tests read it. `quasar.config.js:158` unpacks `justvoice-server/samples/**`, and `server/package.json` has no `files` field. `the-speckled-band` is the same case.
- (d) About 200 KB of test fixtures reach every install.
- (e) Unsure: I did not build the package to confirm.
- (f) Move them to `server/tests/fixtures/`, or exclude them from packaging.

## Decisions checked with no finding
- **The Electron data folder** matches the 2026-10-08 answers: `%LOCALAPPDATA%\<App>\<App>`, `dataroot.txt` beside it, Chromium's files in `electron`, and `<repo>/data` in development.
- **The rest of the Electron rulings hold:**
  - the window on `app://` with a CSP
  - headless as the exe run as Node through `justvoice-server.cmd`
  - a sandboxed preload with a narrow command list, its source `.js`
  - the installer keeps `data\`
  - the speech runtime at `<data>/engines-runtime`
  - Electron 44.7.0, per the step-3 rec
- **No console (both 2026-10-07 entries):** every spawn in the JustVoice and kit servers goes through the kit's `platform/procs.js` with `windowsHide`.
  - "Mastering failed — every line's take is kept; Retry masters again." is at `src/services/renderRun.js:180`.
  - `runBusy` is at `StudioRenderChapter.vue:324`.
- **The updater's core behaviour** matches the approved words: one check at start-up, download when pressed, install on quit. The cache stays in electron-updater's own folder (eight questions, answer 3).
  - Stale tracker line: TASKS "Every open task…" BUILT still says that folder is "for the user's word", though answer 3 decided it.
- **The version:** `RENDER_KEY_VERSION = "0.0.1"`, and the sidebar and Settings → Updates both read `/v1/health`.
- **Labs, what was kept:** `analyzer.analyze`, `noiseMarginDb`, `mastering.master` and `AudioAnalysis` all remain.
- **The Quasar layout** matches §Q.1–§Q.10. The `beforeDev`/`beforeBuild` hooks are Quasar's documented hooks, and the 1430/1431 ports were carried over from Tauri.
- **vue-i18n step B:** Quasar's i18n preset plus `kitMessages()`, and the rewordings moved word for word.
- **Hono pieces built as planned:** `serveStatic`, busboy uploads, Hono's `stream`, CSRF kept as ours.
- **MCP** is on the SDK's `McpServer` + `registerTool`.
- **The Speech engines paragraph** is word for word (`SpeechEnginesTab.vue:931-935`).
- **Effects' A/B only on the persona page** follows the eight questions, answer 5.
- **"A demo project opens like any new project"** (`ProjectsPage.vue` `onCreateDemo` → `landOnOverview`).
- **"The header and Script hear an AI-model load made anywhere"** (`MainLayout.vue:370` `useRunnerModels`, `useAnalyzeModel.js:23-24`).
- **"JustVoice back on the shared AI cache"** and its kit fixes ("Setup stopped — nothing downloaded.", never recommending the app's own cache).
- **The one-click plan:** nothing past slice 0 is built, and §11's "N is a setting" has no code yet.

Also seen, outside these decisions:
- `native.js` `listAudioOutputDevices()` returns `[]`, a placeholder carried from Tauri, behind Channels' "N system audio devices detected".
- `voice_preview_api.js:120-125` hand-ports Python's TTLCache; the standard npm package `lru-cache` has TTL built in.
