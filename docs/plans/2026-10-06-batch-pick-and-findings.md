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

## 3. Cast's All · No persona chips (decided 2026-10-06, "go for cast filter")

**What it is.** The Speakers head's *10 · 1 unassigned* becomes two kit `UiChip`s, Script's row:
**All 10** · **No persona 1**. The counts are every speaker of the book, the narrator included
(the Cast step card's *9/10 cast*). **No persona** shows only speakers with no persona — the
narrator's card too, only when it has none — and an empty result says *Everyone has a persona.*
**All** shows everyone. The choice resets when the book changes. Only what is shown changes:
Smart-assign and ＋ New persona read the whole cast as before.

| Change | Readers (grep `listed`, `unassigned`, `withoutPersona` in `StudioCast.vue`) | Already on the path |
|---|---|---|
| A shown list beside `listed` | `listed` `:71` (defined) · `:421` Smart-assign's `people` — **stays on `listed`** · `:665` the head's count (→ chips) · `:685` "No speakers yet" (stays: the book has none) · `:693` the game table's `:data` (→ shown) · `:710` the grid (→ shown) | `withoutPersona` `:519` (the batch) reads `props.speakers`, unchanged |
| `unassigned` goes | its one reader `:665` | the step card's *9/10 cast* is Studio's own (`StudioView.vue:253`, `overviewState`) |
| The narrator card follows the chip | `:633-659` (`v-if="narrator"`) · the Add Narrator button `:660` stays (it is no speaker) | — |
| Docs | `docs/studio.md:723-724` (*4 · 2 unassigned*) | — |

## 4. Render's "This line only" (decided 2026-10-06, "go" — reverses Slice 4's closed hatch, D3)

**What it is.** The line panel's closed **⚙ Override the numbers for this line** toggle and its four
bare number boxes go. In their place, always open, a section headed **This line only** with the
line *Pace, pitch, gain and the pause after, for this line alone. The persona's own settings don't
change.* Pace, Pitch and Gain are the persona page's own controls — the kit `UiSlider` (drag, or
type in its number box) in `.jv-knob-grid`, the same labels, ranges and units, from ONE list
(`SHAPE_KNOBS`, moved to `services/personaFacts.js` so the persona page, Render and both mocks read
the same one). Pause after is the persona page's number box (ms). Each has **↺** (removes this
line's value — *Back to June's pitch*), greyed while the line has none; **↺ Reset to default**
removes them all, greyed while there are none. An untouched line shows its persona's numbers (the
pause: the persona's, else Settings → Generation's). A value is saved when the slider is let go or
the box is left (the slider's `change`), not on every step of a drag; a value equal to the
persona's is saved as none, so "untouched" stays true. The row's dot stays.

| Change | Readers / producers (grep in `src`) | Already on the path |
|---|---|---|
| The toggle goes (`hatch`) | `StudioRenderChapter.vue:324` (state), `:558-560` (button, `v-if`) · mock `MockRenderChapterView.vue:159` (state), `:365-367` | — |
| The four boxes → sliders + Pause after box | `StudioRenderChapter.vue:561-578` · mock `:368-384` | `setNum` `:333` → `patchBlock(l, { line_override })` → `PATCH /v1/blocks/{id}` → `line_takes.merge_override` (a value sets, **null clears**, limits = the persona page's: `line_takes.py:40`) |
| Clear → ↺ each + ↺ Reset to default | `clearOverride` `StudioRenderChapter.vue:338`, `:579` · mock `:385` | the same PATCH with every key null |
| `overrideSet` | the row dot `:495` (stays; title reworded), the toggle label `:558` (goes), Clear `:579` (→ Reset's disabled) · mock `:160`, `:307`, `:365`, `:385` | — |
| `SHAPE_KNOBS` moves to `personaFacts.js` | `PersonaEditorView.vue:564` (def), `:1100` · `MockPersonaEditorView.vue:324` (def), `:462`, `:709` | `personaFacts.js` already holds the persona page's shared vocabulary |
| Words that name the toggle | `StudioRenderChapter.vue:12` (header), `:631` (foot) · mock `:430` · `docs/studio.md:882`, `:934-935`, `:953`, `:955-962` · `whats-new.md:147` (history — kept) | — |

## 5. Render: Rewrite for the narrator · the line's Style Instructions · ✎ Edit words ("your rec on all go")

**What it is.**
- **✏️ Rewrite** works on every line that has a speaker — narration included (*✏️ Rewrite as
  Narrator*). Render's only narrator exception was this button (`isNarrator` has no other reader);
  the server's speaker rewrite has no narrator rule and needs only a non-empty *Who they are*.
- **The line's direction** becomes the persona page's **Style Instructions** field — a labelled
  block `UiTextarea` with **↺** (clears it) and the hint *For this line only — added after June's own*
  (her Style Instructions quoted). A table cell can't hold that field, so it lives in the open line's
  panel; the row's *How it's said* cell shows the line's direction (or *as June always speaks*) and
  opens the line. Only on a model that takes written direction (the decision's own words): on
  Render the voice is fixed, so a control its model can't use isn't shown — the user, 2026-10-06:
  "i only want to show controls for that voice" (a first cut showed it greyed, the persona page's
  rule, and was corrected before commit). Saved when the box is left.
- **✎ Edit words** in the line panel: the line's text in a box, **Save** / **Cancel** — the same
  `PATCH /v1/blocks/{id} {text}` as Script's ✎ Edit… and Render's Rewrite Accept; the line turns
  stale and its takes are kept. Split and merge stay on Script.

| Change | Readers / producers (grep in `src`, `server`) | Already on the path |
|---|---|---|
| Rewrite's narrator gate goes | `StudioRenderChapter.vue:101` (`isNarrator`), `:388` (`rewriteTitle`), `:590-591` (the button) — no other reader · `speakers_api.rewrite_as_speaker` `:268` (no narrator rule; 400 on an empty *Who they are*) | the `persona_rewrite` prompt (`seed_feature_prompts.py:106`) says "no narration" — meant as "add no narration"; checked live on a narration line |
| Direction moves into the panel | `setDirection` `StudioRenderChapter.vue:228-232` · the cell `:516-519` · mock `MockRenderChapterView.vue:103-107`, `:315` | `PATCH {direction}` unchanged; `delivery_merge.compose_instruct` adds it after the persona's |
| ✎ Edit words | `patchBlock` `:214` (already sends `{text}` for Rewrite, `:383`) · Script's `editText` (`scriptReview.js:222`) sends the same | `projects_api.update_block` — a text change marks the line stale (RESEARCH §3) |
| Words | `docs/studio.md:940-953` (How it's said), `:1003-1015` (Rewrite), `:805` (Cast's *Who they are*) | — |

## 6. Render: a line can change what its model takes (decided 2026-10-06, "correct go")

**What it is.** The open line's **This line only** holds every control the persona page has for
that line's model — in the persona page's order — and only those (hidden, not greyed: the voice
is fixed on Render): Pace · Pitch · Gain · Pause after (every model) · **Style Instructions**
(a words model) · **Emotion** (the app's nine on a words model, the model's emotion tags on a tag
model) and **Register** (a tag model's) · **Sampling** — the model's own settings, as its
capability row lists them, minus speed and seed. Each shows the persona's value until changed, is
for this line only, has a ↺; **↺ Reset to default** clears them all (direction included), so the
line speaks exactly as its persona. A value equal to the persona's is saved as none.

**Stored like the persona's** (`PersonaModelSettings`): a line keeps `{knobs, emotion,
register_tag}` per model under its metadata's `line_models`, so a line set for Chatterbox never
sends its settings to Qwen3 after a recast, and an emotion is always in its own model's vocabulary.
`emotion: ""` means "none on this line" against a persona that has one. The render reads it in
`persona_render.model_settings` — the line's over the persona's, the same tag/words split.

| Change | Readers / producers (grep in `server/justvoice`, `src`) | Already on the path |
|---|---|---|
| `merge_override` takes `models` (`{model: {knobs: {k: v\|null}, emotion, register_tag} \| null} \| null`) | `projects_api.update_block` `:512-516` (the one caller) · `UpdateBlockRequest.line_override` `:219` | a value sets, null clears, a key left out is kept — the hatch's semantics |
| `line_override` returns `models` too | `line_takes.override_delivery` `:83` (must skip it) · `render_lines` `:276` (`"override"`, the page reads it) | — |
| `model_settings(persona, model, line)` | `persona_render.plan_line` `:241` (the one caller) | the tag/words emotion split (`_tagsets`), `nest_engine_keys` |
| `plan_line(…, line_models)` | `line_takes.plan_block` `:119` passes it · the other callers (`generate_api.py:282`, `:411`, `personas_api.py:361`, `:431`) pass none — unchanged | `plan_block` feeds the render (`render_chapter_api.py:176`), the game export (`export_voicelines.py:166`) and the stale check (`line_takes.py:207`) — so a line setting makes it stale |
| Render's panel | `StudioRenderChapter.vue` (`overrideSet`, `resetOverrides`, the section) · `GET /v1/engines/capabilities` (the persona page's own source: `knobs`, `inline_tags`, `emotion_values`) · `DeliveryKnobs.vue` gains a `knobs` prop | the persona keeps `default_delivery.models[model]` — the fallback each control shows |
| Tests | `server/tests/test_line_takes.py` (`test_the_line_override_merges_and_is_checked`) — the unknown-field message changes | — |
