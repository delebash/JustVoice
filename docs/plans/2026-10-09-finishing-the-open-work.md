# Finishing the open work (plan, 2026-10-09)

The user's go, verbatim in TASKS ("Every open task, in the recommended order"): *"do it all your rec
go, lets get all the tasks completed"* — on 1 the installer's audio program, 2 the loose ends, 3
JustVoice's product work, 4 the kit's engine findings; then *"we only want to do a full release once
all tasks are done except to one release you recommend now"*. This plan carries the design for 3 and
4, the standard each piece follows, its blast radius, and the questions the decisions leave open.
1 and 2 need no decisions and are recorded at the end (§7).

## 1 · The Scene — what it is

A **scene** is one treatment laid over a run of the book: **one direction text** added to every
line's own direction, and **one effects chain** stacked after each persona's own chain. Nothing
else. The redesign ruled it (`2026-08-15-voice-workflow-redesign.md`):

> | **Scene** | an effects chain + appended direction text | that passage | (:352)
>
> A scene may apply anything that **composes**. It may never apply anything that **replaces**. (:358)
>
> Render presets are DELETED, not renamed … Replaced by: scene direction text (with saved
> snippets — that is where "Quiet Reflection" / "Dramatic" / "Action" go) + an effects chain from
> the existing library. (:411–419)

So a scene has no numbers and no emotion — those would overwrite each persona's and nobody would
sound like themselves (the mock's own words, `docs/plans/mock/_s12.html`). Render presets are
already gone (`ad93a61`, 2026-10-03); the scene is the layer that replaces them, built new.

**Not decided by this plan, and not assumed either way:** whether a speaker's persona can change by
scene (redesign §8.21 item 7, the user: *"i dont know yet"*). A scene never touches who plays whom.

**What the screen shows** (mock `_s12`): the scene's name and where it applies; Scene direction —
the text, the saved snippets (built-ins + "💾 Save this"), which models perform it; Scene effects —
a chain picked from the Effects library, "Edit"; Apply — this chapter / chosen chapters / the whole
book; "What this scene sounds like" — one line per persona in it (persona · voice · pace · its own
direction + the scene's), "everyone also gets <chain>"; "Hear the difference" — ▶ Without / ▶ With
on a line of the chapter.

**How it reaches the audio** (verified 2026-10-09):
- Direction joins in `persona_render.planLine` — `composeInstruct(design, delivery.instruct ||
  standing, delivery.emotion, direction)` (`persona_render.js:286`): the scene's text goes between
  the persona's standing direction and the line's own (most specific last, `delivery_merge.js:31`).
  Engines that read written direction: Qwen3 CustomVoice and VoxCPM2 (`engines/audiocpp/slot.js:785,
  860`) — the mock's "only Qwen3" is out of date; the screen names them through the shared
  `personaFacts.directionSentence`.
- Effects stack in the same plan — `effects: chainEntries(persona.effects_chain)`
  (`persona_render.js:296`) becomes the persona's entries followed by the scene's.
- Both are inside a line's cache key (`render_core._inputsKey`, `:575–585`: the delivery's instruct
  and `effectsChainHash`), so a scene's lines read **stale** on Render the moment it changes, with no
  marking code (`line_takes.takeIsCurrent`, `:374`).
- Stored: a new table `scene_treatments` (`project_id`, `name`, `direction`, `effects_chain` JSON —
  a **copy** of the chain picked from the library plus the library entry's name, because the library
  (`effect_presets`) does not sync and a synced scene must sound the same on another device), and a
  link table to the chapters it applies to. (In code a "scene" is a chapter — the `scenes` table —
  so the new names say *treatment*; the screen says *Scene*.) Both join JustVoice's sync
  (`server/src/sync.js:31` `SYNC_TABLES`).
- Saved snippets: the three built-ins carry the deleted presets' direction text word for word
  (`git show ad93a61^:server/justvoice/database/seed.py` :145–170 — "Expressive, emotionally charged
  dialogue. Vary intensity with the line; let tension show." · "Soft, intimate, introspective. Slow
  down, lower the energy, leave room around sentences." · "Urgent and propulsive. Quick pacing,
  clipped pauses, momentum from line to line."); their numbers do not carry (a scene adds no numbers).

**Standard:** the family's server and screen shapes (a `<area>_api.js` router on the kit's
`input()`, a `src/pages/` page on the kit's controls, the in-app mock first — CLAUDE.md "A mock is
built in the app itself"). Nothing NOT STANDARD.

**Blast radius** (greps, 2026-10-09):
```
planLine(          generate_api.js:265, :371 · personas_api.js:391, :444 · line_takes.js:284
composeInstruct(   generate_api.js:276, :379 · persona_render.js:286
chainEntries(      persona_render.js:296
takeIsCurrent(     line_takes.js:436 (sceneLines → Render's states) · planKey( line_takes.js:379
SYNC_TABLES        sync.js:31 (+ the parent list :66)
```
Generate and the persona previews pass no chapter, so they get no scene: unchanged. The chapter
render (`line_takes.planBlock` → `planLine`) is the one caller that gains the scene.

## 2 · New project — one page

**What it is** (mock `_s1`): one page — what you are making (the four kinds), Name, Language; then
"Bring the words in" (drop a file, with the table of what each source brings), the master target,
and "What you get". Today: a kind-card modal (`NewProjectModal.vue`, Language already in it since
2026-10-03) plus a separate Import modal (`ImportModal.vue`), whose dry run continues on
`#importreview`.

**Design:** a page at `#/new`, the create path's one door — the modal goes. Kind, Name, Language;
an optional file, previewed by the existing dry run (`POST /v1/projects/import` with `dry_run`) in
the "What you get" card, which counts what will land; Create makes the project in one request — the
import endpoint already creates and imports at once (`projects_api.js:1317`) and gains `name`,
`kind` and `language` fields that override what the file says. The Import modal stays only for
re-importing into an existing project (Overview, Lines). The master target: a new project gets its
kind's target (ruled 2026-09-29, TASKS :4788) — the page states it, not the mock's chooser.

**Blast radius:**
```
NewProjectModal    ProjectsPage.vue:20, :232
ImportModal        ProjectsPage.vue:19, :231 · LinesBoard.vue:22, :291 · StudioOverview.vue:43, :327
the doors          HomePage.vue:237, MainLayout.vue:334 (jv.projects.createKind) ·
                   StudioScript.vue:343 (jv.projects.openImport) → ProjectsPage.vue:168–174
POST /v1/projects/import   src/services/projects.js:43 (the one caller)
```
Found on the way: the three `@created` listeners on ImportModal (ProjectsPage :231, LinesBoard :295,
StudioOverview :327) never fire — it emits only `close`. They go with the change.

## 3 · Lexicons — hear it, try it, see what it touches

Mock `_s10`. Today the page has the library, scope, entries, Scan the book, a text-only preview, and
already warns per entry when no model reads IPA (`LexiconsPage.vue:135–149`, from
`supports_phoneme_input`). Adding:
- **▶ per entry** and **Try a word** (as each persona the lexicon reaches): before / after through
  `POST /v1/generate` with `lexicons: []` against `[this lexicon]` (`generate_api.js:434` — the
  request names exactly the lexicons applied), the persona's voice, the page's one player
  (`usePagePlayer` + `PlayTransport`, design law).
- **Affects:** "N lines contain one of these words" — a new count endpoint over the lines in the
  lexicon's reach (a global lexicon: every project; a project lexicon: its project; a persona
  lexicon: that persona's lines), matching words with the server's own matcher (`render_core`
  `_ipaWords` / `_applyLexicons`). Editing an entry already makes those lines read stale on Render
  (staleness is computed from each line's key); the card says so, as the mock does.
- **The IPA note** moves from a per-entry hint to the card the mock shows.

Blast radius: new endpoint only; `/v1/generate` unchanged (one more caller); `lexiconMatches(`
(`PersonaEditorPage.vue:650`) untouched.

**Built 2026-10-09** — where it differs from the above:
- ▶ and Try a word go through `POST /v1/personas/preview` with the persona as a draft whose lexicon
  is swapped (this one, or none), not `/v1/generate`: the preview already shapes a line the way the
  persona does (its delivery and effects), so before and after differ by the lexicon alone
  (`voiceAudition.auditionWithLexicon`). Checked on the 8741 server: the same word, Kokoro, gave
  different audio with the lexicon and the same audio twice with it.
- **The reach** — "a global lexicon: every project" above is wrong. The render reads a lexicon only
  as a book's (`default_lexicon_id`, every line of the book) or a persona's (`lexicon_id`, the
  lines its speakers say) — `render_core.lineLexicons` — so `GET /v1/lexicons/:id/reach` returns
  those books, the personas that carry it or are cast there, and the count of lines in that reach
  containing one of its words. A lexicon nothing points at reaches nothing, and the card says
  where to choose it. The words match by the engine's IPA rule (`render_core.wordsIn`, taken out
  of `_ipaWords` unchanged): whole words, any case. A respelling also replaces its exact spelling
  inside a longer word (`_applyLexicons`), which the count leaves out.
- The IPA note sits under the entries table; the Kind column keeps *IPA · Kokoro only*.

## 4 · Effects — reorder by dragging, hear it dry and wet

Mock `_s11`. Today the Effects page is the preset library; a persona's chain is edited in
`EffectsChainEditorModal.vue` (↑/↓ only — its header comment claims drag) from the persona page.
Adding to the chain editor:
- **Drag to reorder** — VueUse's `useSortable` (`@vueuse/integrations` 15.0.0, MIT, over SortableJS
  1.15.7, MIT; the family is on `@vueuse/core` 15). Standard — the same project the family already
  uses; the kit's UI takes the dependency so every app has it (family rules: a gap is filled in the
  kit). JustWrite's hand-rolled drags (chapters, plot board) are not touched by this.
- **A / B it** — ▶ Dry / ▶ Wet on one take: one preview render with no effects, then the chain
  applied to that same audio on the server (`audio/effects.js` `applyEffectsChain`, today reachable
  only inside Generate's fallback, `generate_api.js:406`) — a small endpoint takes the preview's
  audio id and a chain. "Same take, chain on / off" is then literally true.
- **Order matters** — the mock's card.

Blast radius: `EffectsChainEditorModal` — `EffectsPage.vue:34,:205` · `PersonaEditorPage.vue:44,
:1318` · `mock/MockPersonaEditorPage.vue:32,:899`; `applyEffects(` — `generate_api.js:406`,
`audio/effects.js:60`.

**Built 2026-10-09** — where it differs from the above:
- `useSortable` is imported by the chain editor itself (`@vueuse/integrations/useSortable`, as
  VueUse documents it); JustVoice installs `@vueuse/integrations` and `sortablejs`. The kit takes
  no dependency yet: a kit peer is declared by the kit file that imports it (SyncPanel and
  `qrcode`), and no kit control drags a list today — the first one that does takes it that way.
- The take: the persona preview with `hold: true` (its chain emptied) keeps the take 10 minutes
  and answers `{ take_id, wav_b64, duration_sec, expires_at }`; `POST /v1/effects/apply
  { take_id, chain }` puts a chain on it (`effect_presets_api.js`). A held take, because the
  render cache keys a line by its chain — two previews are two renders, two takes on a model
  that samples. Checked on the 8741 server with Kokoro: one render, then the chain on it, Dry and
  Wet both 1.225 s.
- **A / B it** shows when the editor has a persona — the persona page. From the Effects page (a
  preset) there is no voice to speak with; the mock draws only the persona's case.
- ↑ and ↓ stay beside the grip, for the keyboard.

## 5 · Speech engines — what each model gives you and what it gives up

Mock `_s13`, which predates audio.cpp (LuxTTS and Whisper are gone; Kitten, Pocket and VoxCPM2 are
new). Today `SpeechEnginesTab.vue` shows install/load, languages, cloning, built-in voice counts,
licence, size, placement. Adding:
- **"Picking an engine is picking what a voice can do"** — the If you want… / Use / What you give
  up table, its rows written from today's manifests (draft below, the user's to approve: new words).
- **Direction per model** — `directed_by` on `GET /v1/engines/:id/models` (from
  `voice_model.directedBy`, today only on voices and personas), shown with `personaFacts.directionCell`.
- **Speech recognition's "What for?"** — the clone transcripts and dictation it serves.
- **`docs/engines.md`** — its use-case list contradicts its own table twice (49 vs 54 Kokoro
  voices; Chatterbox 19 vs 23 languages): fixed to the manifests.

Draft rows (facts from the manifests, read from `model_catalog.modelsFor` 2026-10-09 — sizes at 8-bit: Kokoro 180 MB, Kitten 288 MB, Pocket 246 MB, Chatterbox Nano 587 MB / Turbo 840 MB / Multilingual 1,991 MB, Qwen3 1.6–2.7 GB, VoxCPM2 2,818 MB):

| If you want… | Use | What you give up |
|---|---|---|
| Ready-made voices, fast, on any machine | Kokoro — 54 built-in voices, 9 languages | No cloning and no written direction — pace, pitch, gain and pauses only |
| English voices made for the CPU | Kitten — 8 built-in voices | English only; no cloning, no written direction; the same seed does not repeat the same audio |
| Someone's own voice on a modest machine | Pocket — cloning, 20 built-in voices | One language per model; no written direction |
| To direct performances in words | Qwen3 CustomVoice — 9 built-in voices, 10 languages | Cannot clone |
| Someone's own voice, in 10 languages | Qwen3 Base | Written direction is dropped |
| A voice designed from a description | Qwen3 VoiceDesign | — |
| Someone's own voice, with per-line emotion tags | Chatterbox Turbo or Nano — 19 tags | English only; no written direction |
| Someone's own voice in another language | Chatterbox Multilingual — 23 languages | No written direction, no tags |
| Cloning, designing and written direction together | VoxCPM2 — 30 languages | The largest download (2.8 GB at 8-bit) |

Blast radius: `SpeechEnginesTab` — `AiPage.vue:25, :94`; the models wire gains a field (readers:
`PersonaCloneMaker.vue:187`, `PersonaDesignMaker.vue:58`, `QuickSetup.vue:144`,
`SpeechEnginesTab.vue:170` — an added field changes none of them).

**Built 2026-10-09** — where it differs from the above:
- The table's rows as drafted, above the engine sections. The mock's paragraph under the title
  ("You choose an engine once, when you cast a persona to a voice…") is left out: new wording,
  in words the app no longer uses — waiting for the user's word.
- `directed_by` per model family (`voice_model.modelOfVariant` → `directedBy`), null for speech
  recognition. The chip shows `directionCell`'s words in the chips' capitals, without a tag
  count — the tab has no capability rows.
- "What for?" says what speech recognition serves in code: Captures' dictation, a capture's words
  filling a clone's transcript, `/v1/transcribe`, `/v1/align` (caption word timings) and the MCP
  tool `justvoice.transcribe`. The mock's "a clone arrives with its text already filled in" holds
  only for a capture — an uploaded clip is not transcribed.
- `docs/engines.md`: 54 voices, 23 languages, Chatterbox's language list (it lacked Hebrew,
  Russian, Chinese and Japanese), and the `BUILT-IN · N` chip (it said `PRESETS · N`).

## 6 · After the screens

- **The updater** — `electron-updater` (electron-builder's own; standard), in the kit's shell
  (`runDesktopApp` — the four `src-electron/electron-main.js`) with three bridge commands (check,
  download, install) and the kit's `UpdatesPanel` `#actions` slot (JustWrite, JustVoice, docgen
  Settings → Updates). Each app's release workflow uploads the feed file (`latest.yml`). macOS
  cannot update itself without a signed app (the paid Apple account); there it says a new version is
  out, with the link. It is tested against a local feed until the first release exists — the apps'
  releases wait for the cross-platform release (the user's rule).

  **Design (2026-10-09, before building)** — each piece and its standard:
  - **The updater**: `electron-updater` 6.8.9 (MIT, the stable line beside electron-builder
    26.15.3; 7.x is alpha) — https://www.electron.build/auto-update. In the kit's shell, loaded
    only in a packaged app: `autoDownload = false` (Download is pressed), `autoInstallOnAppQuit`
    (its default — a downloaded update installs when the app quits, so on the next start it is
    there), `checkForUpdates()` once the window is up, `downloadUpdate()`, `quitAndInstall()`
    for "Restart now". Its events (`checking-for-update`, `update-available`,
    `update-not-available`, `download-progress`, `update-downloaded`, `error`) become one status
    the shell keeps and pushes. macOS: check only — `MacUpdater` installs only a zip through
    Squirrel.Mac, which needs a signed app; the status carries the release's link instead.
  - **The feed**: electron-builder's `publish` (`provider: github`) — with it set, electron-builder
    26.15.3 writes `app-update.yml` into the app and `latest.yml` / `latest-mac.yml` /
    `latest-linux.yml` beside the installers even under `-P never` (read in
    `app-builder-lib/out/publish/PublishManager.js`: "file should be generated regardless of publish
    state"; a DMG writes its update info too, `dmg-builder/out/dmg.js`). The release workflows keep
    building with `-P never` and upload those files and the `.blockmap`s with the installers.
    A draft release is invisible to the updater until it is published — the user's act.
  - **The bridge**: four commands on the one preload object — `updateStatus` (the status, for a
    page opened after the start-up check), `updateCheck`, `updateDownload`, `updateInstall` —
    and one push, `update:status` (`appShell.on` allows `update:` beside `tray:`). The apps
    reach them through `src/services/native.js` alone (`updater`).
  - **The screen**: the kit's `UpdatesPanel` takes an optional `updater` and shows the status and
    its one button in its head (Check again · Download · Restart now · the release's link on a
    Mac); `#actions` stays. One component for the three apps.
  - **Which apps**: JustVoice and JustWrite name their releases page (`updates.releasesUrl` in
    `electron-main.js`) and set `publish`; docgen has no release workflow, so its shell runs with
    updates off and its panel shows only the notes. The template stays without one.
  - **Testing before a release exists**: a development run takes a local feed from
    `<APP>_UPDATE_FEED` (electron-updater's `forceDevUpdateConfig` + a `generic` feed) — read only
    when the app is not packaged.

  **Built 2026-10-09** — as designed, with one change: the development feed is a written
  `dev-app-update.yml` (`updateConfigPath`), because `setFeedURL` alone checks but fails the
  download (ENOENT). Checked in JustVoice's real window (`npm run dev`, a local feed of 9.9.9 with a
  dummy installer): the start-up check found it, the panel said *Version 9.9.9 is out.* with
  Download, the download ran and verified, and the panel said *Version 9.9.9 is downloaded. It
  installs when you quit the app.* with Restart now — which was not pressed (in development it
  would run the dummy). Not checked: a real install, which needs two built versions and a
  release. Found: electron-updater keeps the downloaded installer in the OS cache folder
  (`%LOCALAPPDATA%\justvoice-updater\pending`), outside the data folder the user chose, with no
  option to move it — for the user's word.

  Blast radius: `COMMANDS` — `shell/main.js:51`, `shell/preload.js:16` (must match);
  `appShell.on` — each app's `native.js` `onShellEvent` (JustVoice, JustWrite, docgen) and
  `MainLayout.vue` (tray events, unchanged); `<UpdatesPanel` — JustVoice `SettingsPage.vue:1845`,
  JustWrite `SettingsPage.vue:1632`, docgen `SettingsPage.vue:363` (a new optional prop);
  `runDesktopApp(` — the four `src-electron/electron-main.js`; the release workflows — JustVoice and
  JustWrite `.github/workflows/release.yml`.
- **Voice training (gap 5)** — a LoRA trainer in C++ on ggml for the speech runtime: nothing in our
  repos to build from, so research first (what ggml's training support covers, what upstream
  audio.cpp has for LoRA, the size of the job), written up before any code.
  **Written 2026-10-09:** [`2026-10-09-voice-training-findings.md`](2026-10-09-voice-training-findings.md)
  (the facts in RESEARCH §9) — three questions for the user; no code.
- **The kit's engine findings** — verify first which are already closed by the shared Electron shell
  (the data folder's ladder, the server's stop); then the KV/context sizing faults, fixed together as
  their item demands; then the two smoke tests that fail only inside the suite.

  **Done 2026-10-09:**
  - *The data folder's ladder* — closed. One implementation: the shell's `resolveDataRoot` and all
    three servers' `paths` call the kit's `data_paths.resolveDataDir`; no Tauri shell is left; the
    shell puts Chromium's files under `<root>/electron`. Measured: two development launches of
    JustVoice's window wrote nothing to `%APPDATA%` or `%LOCALAPPDATA%` (the folders there —
    `dev.justvoice.app`, `justvoice`, `Electron` — were last written between July and
    2026-10-07, Tauri's and the move's). The one new outside write is the updater's download cache
    (§6 above, for the user's word).
  - *The server's stop* — closed. All three servers run through the kit's `runServer`
    (`platform/serve.js`), which answers the shell's `stop` by refusing new connections, closing
    the app and exiting; the shell kills only after 8 s.
  - *The KV/context faults* — not built: the user's ruling (2026-09-19) is all three faults together
    with a corrected CUDA seed, and the seed only from multi-box evidence — `__overhead__` rows from
    at least two more machines. One machine is all there is here.
  - *The suite-only smoke tests* — not run: they start a real router on :8080 and must never run
    while an app is up; JustWrite's router held :8080 (a JustWrite server was running).

## 7 · Already done or underway under the go

- 1 — the fork's release builds `audiocpp_dsp` everywhere (fork 342d2737, 55b150f4 — the Linux
  builds needed Signalsmith's headers as SYSTEM includes); a dry run of v0.9.0-jv.5 is running; then
  the tag, the pin move, and the installer step (`scripts/audiocpp-dsp-package.js`, electron-builder
  `extraFiles` — written, held uncommitted until the pin moves so `npm run build` never breaks on
  main).
- 2 — docgen pushed; the kit's READMEs, tracker lines and the guard's restored checks (kit 0289acc);
  JustWrite's marketing screenshot routes (a8726da). The bundled fonts (JustVoice 3eaf205).

## 8 · Questions

1. **Scene — what does a scene apply to?**
   The mock shows both "38 of 214 lines of chapter 1" and Apply "this chapter / chosen chapters /
   the whole book".
   Lean: whole chapters — this one, chosen ones, or the whole book (the Apply choices); a run of
   lines inside a chapter later, if you want it.
2. **New project — one page at `#/new`, the modal gone, Import kept only for re-importing?**
   Lean: yes, and the master target stated as the kind's (the 2026-09-29 ruling), not chosen.
3. **Effects — the mock's "From" column (scene rows in a persona's chain)?**
   A persona's chain is edited from the persona page, outside any chapter, so it has no scene to
   show.
   Lean: leave the column out of the persona's chain; the Scene page shows what every persona gets
   on top ("everyone also gets …").
4. **Engines — the "Picking an engine" rows (§5)?**
   Lean: as drafted.
5. **The updater — download by itself, or ask first?**
   Lean: check at start-up and say when an update is ready; download when you press Download;
   install on the next restart.
6. **Voice training — research now or after everything else?**
   Lean: after the screens, the updater and the kit findings, as a findings write-up before any
   code.

## 9 · Review passes

- *The items:* every screen read against its mock and the five research reports (2026-10-09).
- *How they interact:* the scene's direction and chain go through `planLine`, which Generate and the
  previews also call — they pass no chapter, so they are unchanged; Effects' A/B uses the persona's
  chain only, so it never shows a scene's; Lexicons' Try a word goes through `/v1/generate`, which
  applies no scene. Sync: the new tables join `SYNC_TABLES`; the library they copy from does not sync,
  hence the copy.
- *My own claims:* "render presets live" (the 2026-09-30 gap note) was out of date — removed
  2026-10-03; "no Language field" was out of date — added 2026-10-03; "only Qwen3 reads direction"
  is out of date — VoxCPM2 too. Each corrected above from the code.
- *The checker:* no test covers a scene yet; the chapter render's tests and Render's state tests are
  where the new cases go (`server/tests/`).
- *The untouched neighbours:* JustWrite's hand-rolled drags; the persona page's own preview; the
  render cache's format (the key already holds what changes).
