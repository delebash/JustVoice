<!-- SPDX-License-Identifier: MIT -->
# Cast's batch: pick a voice it couldn't match · three findings fixed (2026-10-06)

**Decision:** TASKS "Cast's batch lets you pick a voice it couldn't match; the three findings
fixed" (verbatim — "fix the stuff you found and your rec a go"). The cause of the batch's misses
is measured in TASKS "The demo cast for Render…" and RESEARCH §7.

## 1. What each fix is

1. **The batch's unmatched speaker gets a voice dropdown** (`CastNewPersonas.vue`). Where the row
   said *no voice matched — cast them yourself*, it has a Voice dropdown, placeholder **Pick a
   voice**, listing the same voices the batch matched from (installed voices that speak the book's
   language — `voicesForBook`), each labelled as the rest of the list labels a voice
   (`voiceLabel`: *Fable (UK) · Male · British English · Kokoro*). Picking one ticks the row and
   gives it ▶; Create makes its persona like any other row. A matched row is unchanged.
2. **The update check stops pretending.** No updater exists (no plugin in any `Cargo.toml`, no
   signed feed; the Electron study §4 found none in the family), yet Settings → Updates offered
   Stable / Beta / Nightly and a Check that always answered *You're on the latest version*, over
   a note about a signed GitHub feed. Updates becomes JustWrite's panel: the version and the
   release notes (`UpdatesPanel` with no actions). A real updater comes with the Electron move
   (`electron-updater`, study §5).
3. **Settings → Logs names the real folder.** *Live tail is read from ~/.justvoice/logs/* becomes
   *The server writes it to `<data folder>/logs`*, with the path read from `/v1/system/info`
   (Settings already reads it on mount); Open log file uses the same path.
4. **The server-unreachable screen keeps checking** (the kit's `ConnectionError.vue`, which
   JustWrite mounts too). While it shows, it asks the server every 2 seconds (`checkServer`, one
   try) and loads the app when it answers. Retry stays. No new words on the screen.

## 2. Blast radius (greps run 2026-10-06)

| Change | Readers / producers (grep) | Already on the path |
|---|---|---|
| `CastNewPersonas` gains `voices`; a picked voice fills an unmatched row | `StudioCast.vue:35` (import), `:680` (the one mount) · `newAsk` `:520`, `:570` (set), `:573`, `:595`, `:674`, `:680-681` · `create` → `createNewPersonas` `:572-604` reads `p.speaker`, `p.voice.id` | `voicesForBook` already filtered the voices sent to the model (`:527`) |
| The fake updater goes (`updater`, `checkForUpdates`, `downloadUpdate`, `restartAndInstall`, `justvoice:updater_channel`, `.jv-updater-*`) | only `SettingsView.vue` (grep of src, scripts, docs: no other reader; docs name none) · TASKS:75-79 and RESEARCH:635 describe it | JustWrite: `<UpdatesPanel :app-version :changelog-html />` (`justwrite-app/src/views/SettingsView.vue:1614`) |
| The Logs line and Open log file read `data_dir` | `SettingsView.vue:925` (`openLogFile`), `:1823` (the line), `:1826` (the button) · `loadGpuInfo` `:459-467` already fetches `/v1/system/info` | the tray's Open log file is Rust (`lib.rs` `open_logs`), unchanged |
| `ConnectionError` probes while shown | mounted by `JustVioce/src/main.js:193`, `justwrite-app/src/main.js:110`; a JustWrite test mounts and unmounts it (`familyLabels.bite.test.js:33`) · `checkServer` (`serverApi.js:203`) called by both apps' `main.js` | the transport is configured before the screen mounts (both apps call `checkServer` first) |
