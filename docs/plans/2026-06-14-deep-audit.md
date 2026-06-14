# Deep audit — code design + GUI/UX (2026-06-14)

Findings-first. NO fixes until the user reviews (and adds to) this
ledger. Three tracks: **A. GUI/UX**, **B. Client code**, **C. Server
code**. Built incrementally and committed as each view/module is
audited (compaction-proof).

## Method

- GUI findings are evidence-based: each cites a screenshot captured via
  the Playwright harness against the running app.
- Conformance is measured against CLAUDE.md **RULE #1** (design-
  conformance checklist) + the width tokens (`jv-w-name`/`jv-w-id`/
  `jv-w-token`) + canonical components (`JvButton`, `JvToggle`,
  `.jv-lib-toolbar`, `.jv-subnav`, `jv-table`, `confirmDialog`/
  `promptDialog`). Not invented taste — violations of the existing system.
- Interaction rubric (for flows): step-count (no needless prompts),
  focus management (cursor lands where you type), dialog lifecycle
  (save/cancel close the surface), and **cross-flow consistency** (same
  job → same pattern).
- Code findings: structural smells — duplication, god components, dead
  files, inconsistent patterns, leftover hacks, fat endpoints, error-
  handling inconsistency, dead routes.

## Finding format

`[ID] severity · location (file:line) · what's wrong · rule/standard
broken · proposed fix`

Severity: **P1** broken/blocks user · **P2** clear defect, not blocking
· **P3** polish/consistency.

## User-reported seeds (confirmed, to be folded into findings)

- New Persona is a needless 2-step (promptDialog for name → then opens
  the detail editor). Should open the editor directly with the name
  field focused. → see G-PERSONA-1.
- Saving a persona doesn't close the editor. → G-PERSONA-2.
- Text boxes wider than their content across views (RULE #1 #2). →
  tracked per-view as G-*-W.
- (space for user to add more before fixes begin)

---

# TRACK A — GUI / UX findings

_(populated per view below)_

### G-CORE-1 instances (bare untokened inputs, per view)

If we take root-fix (a) these resolve automatically; if (b), this is the
worklist: ChapterView ×1 · ImportReviewView ×1 · LexiconsView ×1 ·
RenderPresetsView ×4 · SettingsView ×1 · StudioView ×1 · VoicesView ×3.
(~12 total. Modest — confirms it's the *default* that bites, not
widespread bad authoring.)

### Positive findings (conformance that's actually GOOD — don't touch)

- **Buttons are clean.** Zero scoped one-off `.jv-btn--` variants
  (grep). All buttons use `JvButton`/`jv-btn`/`jv-rowact`/`jv-pill`.
  RULE #1 #4 satisfied. The `__actions` classes are flex-row containers,
  not button one-offs.
- **No native dialogs.** All `prompt(`/`confirm(` hits are ban-comments;
  real flows use `promptDialog`/`confirmDialog`.

# TRACK B — Client code findings

- **[B-CORE-1] P2 · God components.** SFC line counts: StudioView 2708,
  SettingsView 2605, ChapterView 1426, GenerateView 1279, VoicesView
  1272, EnginesView 1191. The top two are the worst — a single SFC
  holding many tabs/sections inline:
    - SettingsView (2605) = 14 sub-tabs (General/AI features/Mastering/
      Generation/Capture/MCP/GPU/Appearance/Cache/Channels/Webhooks/
      Logs/Changelog/About) inline. Decompose: one component per
      sub-tab (`settings/GeneralSettings.vue` …), SettingsView becomes
      the `.jv-subnav` shell.
    - StudioView (2708) = Cast/Script/Render/Export tabs inline (6
      `v-if="tab===…"` blocks). Decompose: `studio/CastTab.vue` etc.
  Lower-risk than it sounds — extraction is mechanical (move template +
  its script slice + props/emits). Big maintainability win; also makes
  KeepAlive cheaper. **Phase this carefully, one tab at a time, each
  verified via smoke.mjs.**
- **[B-CORE-2] P3 · Dead files.** `components/Combobox.vue` and
  `components/ListPane.vue` have zero importers (verified incl. dynamic
  refs). Delete. (AddProviderModal from the old recap is already gone.)
- _(more per-view code findings below)_

# TRACK C — Server code findings

- **[C-CORE-1] P2 · `projects_api.py` is a fat router** (1280 lines, 25
  endpoints) mixing six concerns: project CRUD · scene CRUD · block
  CRUD · cast · import (adapters/import) · qc/export/lines/demo/
  show-notes. Routes like `/v1/scenes/{id}` and `/v1/blocks/{id}` aren't
  even project-scoped paths but live here. Split: `scenes_api.py`,
  `blocks_api.py` at minimum (export already has its own module). Lower
  risk than client decomposition — moving route handlers between
  routers, same paths, covered by pytest (247 tests).
- **[C-CORE-2] P3 · `models.py` monolith** (1145 lines — every request/
  response model). Optional split by domain (`models/projects.py`, …).
  Low priority; it's cohesive, just large.
- **[C-CORE-3] RESOLVED — NOT a defect (live-probe verified).** Hit
  every by-id endpoint with a bogus id against the running server:
  GET `projects/personas/lexicons/voices/presets/scenes·blocks/cast`
  → all **404**; DELETE `personas/lexicons/projects/voices` → all
  **404**. So despite `voices_api`/`lexicons_api` having 0 raw
  `raise HTTPException`, they 404 correctly (via another mechanism). The
  low-count signal was misleading; error handling is sound. The earlier
  "might silently 200" worry was a false alarm — corrected by probing.
  - **[C-1] P3 (minor) · update-verb inconsistency.** `PATCH /v1/personas/
    {id}` → 405; personas update via **PUT**, while projects/blocks/scenes
    use **PATCH**. Harmless but inconsistent REST. Align to PATCH later.
- _(more per-module findings below after the per-endpoint pass)_

---

# CROSS-CUTTING (app-wide)

- **[X-1] P2 · App.vue breadcrumb not cleared on nav.** Screenshot
  (aud-PERSONAS) shows "Personas › Stillwater › 1 · Cast" — the
  "Stillwater › 1 · Cast" segment is ChapterView's crumb, still showing
  on Personas (a cross-project library that publishes no crumb of its
  own). Stale context leaks between views. Fix: App.vue clears
  `uiContext` on every view change; views that want a crumb re-publish
  on activate. (Recap claims this was done 2026-06-10 — verify it
  regressed or never covered store-driven nav.)
- **[X-2] P3 · Two different "create" patterns for the same job.**
  BooksView create = modal with fields (NewProjectModal). PersonasView
  create = `promptDialog` for name → then opens the detail editor.
  LexiconsView/RenderPresetsView create = `promptDialog`. Pick ONE
  canonical create pattern. (CORRECTION: an earlier draft said
  RenderPresetsView used native `prompt()` — that was read off the
  stale local-`main` checkout during the merge; the real file uses
  `promptDialog`. No native-dialog violations exist — verified by grep,
  all `prompt(` hits are ban-explaining comments.)

## Design-system core (the "everything's too big" root cause)

- **[G-CORE-1] P1 · Inputs default to `width:100%`; content-sizing is
  opt-in.** styles.css:854-858 — `.jv-input/.jv-textarea/.jv-select`
  are `width:100%` by default; the width tokens (`jv-w-name`/`jv-w-id`/
  `jv-w-token`/…, lines 873-880) only set `max-width`. So ANY input
  without a token stretches to fill its container. This is exactly
  backwards from RULE #1 #2 ("size to content; never full-width unless
  prose") and is the single root cause of the user's recurring "text
  box way too big for its content" complaint — it's not per-view sloppy
  authoring, it's the default. **This is the highest-leverage GUI fix.**
  Two ways:
    (a) ROOT FIX — change the default so a bare `.jv-input` is content/
        sane-width (e.g. a default `max-width` ~`--w-name`, or
        `width:auto`), and make full-width explicit via `.jv-w-full`/
        `--full`. Then audit the few places that genuinely want full
        width and tag them. Highest payoff, touches the base rule so
        every untagged input improves at once; risk = a pass over all
        inputs to confirm none needed the old full-width.
    (b) PER-INPUT — leave the default, add the correct width token to
        every bare `jv-input`. Safer, but tedious and leaves the trap
        in place for the next author.
  **User decision needed** (a vs b). Recommend (a) — it fixes the class,
  not the instances, and aligns the default with the stated rule.
- **[G-CORE-2] (USER RULING 2026-06-14: keep semantic split, unify
  implementation).** There are THREE boolean things:
    - `JvToggle` (switch) — 10 uses, all genuine on/off *settings*
      (SettingsView×7, SpeakerLab×2, RenderLab×1). Correct semantic.
    - `JvCheckbox` component — used in 3 views (Settings/Webhooks/
      AudioChannels). The intended component.
    - raw `<input type="checkbox" class="jv-check">` — hand-rolled in
      ~9 more sites (Generate, ImportReview, Settings×2, Books,
      Captures, Studio, ProviderForm×3, QuickSetup, EffectsChain).
  Ruling: **keep the toggle-vs-checkbox semantic split** (toggle = a
  setting you flip; checkbox = select-a-row / inline option — correct
  distinction, don't flatten). **Fixes:** (1) the `autoplay` concept is
  split across both — `.jv-check` in GenerateView:700 but `JvToggle` in
  SettingsView (`autoplay_on_generate`); resolve to one. (2) migrate
  hand-rolled `<input class="jv-check">` → the `JvCheckbox` component so
  there's one checkbox implementation. (Visual output is identical —
  JvCheckbox wraps the same `.jv-check` box — so this is code-hygiene;
  do the bulk migration during per-view cleanup / god-component
  decomposition to keep blast radius small. Autoplay mismatch fixed now.)

---

# Coverage map — enumerated vs pending

**Enumerated (this pass):** all systemic findings across the 3 tracks
(G-CORE-1/2, B-CORE-1/2, C-CORE-1/2/3, X-1/2/3), PersonasView full,
objective sweeps (untokened inputs per view, scoped buttons=clean,
native dialogs=none, god-component sizes, dead files, fat routers,
error-handling raw counts), screenshot review of Home/Projects/Chapters/
Studio/Generate/Voices/Settings/Personas (+remaining 6 captured).

**Pending focused passes (detail-gathering, not yet enumerated):**
1. Per-handler dialog-lifecycle (X-3) — read each of the 9 listed
   handlers, mark close-on-save correctness.
2. Per-endpoint error-handling (C-CORE-3) — for each GET/PATCH/DELETE
   by id, confirm missing id → 404 not 200. ~40 endpoints.
3. Settings' 14 sub-tabs — individual layout/sizing/flow review
   (AI features / ProviderForm most likely to hold sizing issues).
4. Remaining views' layout detail: Effects, Presets, Engines, Captures,
   Labs sub-views (SpeakerLab/RenderLab/Compare/Train), Lines, Stories,
   AudioTools, Cache, Channels, Webhooks, ImportReview.
5. Per-view client-code smells beyond god-components (duplication,
   prop-drilling) for the views not yet read in full.

These are bounded; each can be a committed sub-pass. The systemic
findings above are the high-leverage set and don't depend on them.

# Per-view audit log

_(each view: screenshot reviewed + code read; GUI + client findings)_

## G-CORE-2 execution decision (2026-06-14)

After reading all hand-rolled `.jv-check` sites: each sits in **bespoke
`<label>` markup** with context-specific inline styling (Generate
toolbar chip; inline Settings rows with custom gap/font-size; QuickSetup
/EffectsChain use `:checked`+`@change`, not `v-model`). Migrating them to
`JvCheckbox` reworks each layout for **identical visual output** — pure
hygiene, nonzero risk, no user-visible gain. **Decision: defer the
component migration into per-view cleanup / god-component decomposition
(B-CORE-1), where each markup is reworked anyway.** Doing it as a
standalone 9-site sweep now is the wrong risk/reward. The visible part of
G-CORE-2 (control type per context) is already correct under the ruling.

- **[G-CORE-2b] P2 · autoplay setting is not wired.** GenerateView's
  `autoplay` is a LOCAL ref (`ref(true)`, GenerateView.vue:81), a
  per-session toolbar checkbox. It NEVER reads the persisted
  `settings.generation.autoplay_on_generate` (SettingsView JvToggle).
  They both default true so behaviour matches by luck, but flipping the
  setting does nothing to Generate. Real defect = WIRING, not control
  type. Fix: Generate initializes `autoplay` from the persisted setting
  (and/or both bind the same source). Deferred with the per-view pass.

## Dialog / editor lifecycle (cross-cutting, needs per-handler pass)

- **[X-3] P2 · Editor-close-on-save — PASS DONE (read each handler).**
  Result: the issue is NOT widespread. **Only `PersonasView.savePersona`
  is genuinely broken** (no close — G-PERSONA-2). Verified-correct:
  `AudioChannelsView.save` (resets `editing` to blank → collapses),
  `ChapterView.saveBlockText` (`editingBlockId=null`),
  `RenderPresetsView.onChainSaved` (`editorOpen=false`, both branches),
  `BooksView.commitAddCast` (closes `addCastOpen`). Create-flows
  (`createBlank`/`createLexicon`) open the editor by design — that's the
  X-2 "create pattern" concern, not a close bug. (An automated
  gate-name heuristic gave several false positives; corrected by reading
  each handler.) **Net: X-3 reduces to the single G-PERSONA-2 fix.**

## PersonasView  (screenshot: aud-PERSONAS)

GUI / UX:
- **[G-PERSONA-1] P2 · 2-step create.** `createBlank()` (PersonasView
  .vue:151) opens `promptDialog` for the name, POSTs, then sets
  `selectedId` to open the editor. Two surfaces for one action. Fix:
  open the editor immediately on a new blank draft (unsaved), autofocus
  the name field, persist on Save. (User-reported.)
- **[G-PERSONA-2] P2 · Save doesn't close the editor.** `savePersona()`
  (~PersonasView.vue:savePersona) does loadAll + dirty=false + toast but
  never `selectedId.value = null`. Editor stays open after save. Fix:
  close on successful save. (User-reported.)
- **[G-PERSONA-3] P3 · Persona table column sizing + action alignment.**
  The PERSONA column stretches ~half the viewport with dead space; the
  ACTIONS header is not above its Edit/Delete buttons (buttons flung to
  the far right). RULE #1 #2 (size to content) + layout grammar (rows
  end where content ends; actions grouped under their header). Fix:
  content-sized name column, align actions under header.

Client code (Track B):
- **[B-PERSONA-1] P3 · God component.** PersonasView.vue is ~600 lines:
  list + full editor modal + effects-chain editor wiring + usage-detail
  + filters all in one SFC. The editor modal is a candidate to extract
  (`PersonaEditor.vue`). Assess after GUI fixes.
- Note: data-layer already converted to stores this session (clean).
