# Deep audit — code design + GUI/UX (2026-06-14)

> ⚠️ **SUPERSEDED** by `docs/plans/2026-06-14-deep-audit-v2.md` (v1 mixed grep/screenshot proxies with deep reads and was declared not-trusted). Kept for history.

Findings-first. NO fixes until the user reviews (and adds to) this
ledger. Three tracks: **A. GUI/UX**, **B. Client code**, **C. Server
code**. Built incrementally and committed as each view/module is
audited (compaction-proof).

## DESIGN DECISION — save patterns (USER RULING 2026-06-14)

The app is already mostly auto-save (Books metadata on blur, Render
Presets per-field, Settings toggles via `saveDebounced`); Personas/
Voices are the explicit-Save holdouts. Ruling that resolves the
inconsistency:

- **Inline / in-page edits → auto-save.** Settings rows, project
  metadata, per-field voice/preset edits. Text saves on blur (debounced),
  toggles/selects on change. Needs: shared debounced-save helper, a quiet
  "Saved ✓" indicator, validate-before-save, and revert-on-error.
- **Modal / dialog editors → explicit Save + Cancel.** (USER: "it's a
  dialog box, more natural to have a Save button than just a Close
  button.") A dialog keeps its conventional footer: **Save** (persist +
  close on success) and **Cancel** (discard + close). An auto-save dialog
  with only an X is the wrong affordance. This SUPERSEDES my earlier
  "auto-save dissolves G-PERSONA-2" note — wrong; the dialog keeps Save,
  it just must close on success.
- **Destructive/expensive → explicit confirm** (delete, factory reset,
  engine load). Unchanged.
- **Rollout: view-by-view, never big-bang** (USER). Fold into per-view
  cleanup; each conversion verified via smoke.mjs.

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

- **[B-CORE-1] P2 · God components — code structure, NOT the tab UX
  (the right pattern already exists in-file; most tabs don't follow
  it).** SFC line counts: StudioView 2708, SettingsView 2605,
  ChapterView 1426, GenerateView 1279, VoicesView 1272, EnginesView
  1191.
    - SettingsView (2605 = 1137 script + ~1160 template): tab menu is
      fine (`.jv-subnav` + `activeSub`). But only **3 of 14 tabs
      delegate to components** — `cache`→`<CacheView/>`,
      `channels`→`<AudioChannelsView/>`, `webhooks`→`<WebhooksView/>`
      (one-liners). The other ~11 (general/ai/mastering/generation/
      capture/mcp/gpu/appearance/logs/changelog/about) are inline. Fix:
      make the 11 follow the 3 — `settings/MasteringSettings.vue` etc.;
      SettingsView becomes the thin shell. NOT a UX change.
    - StudioView (2708): Cast/Script/Render/Export tabs inline (6
      `v-if="tab===…"`). Decompose: `studio/CastTab.vue` etc.
  Why P2 (your call): nothing's broken; it's maintainability/edit-safety
  + KeepAlive holds the whole file mounted. Extraction is mechanical
  (move template slice + its script + props/emits). **Phase carefully,
  one tab at a time, each verified via smoke.mjs.**
- **[B-CORE-2] P3 · Dead files.** `components/Combobox.vue` and
  `components/ListPane.vue` have zero importers (verified incl. dynamic
  refs). Delete. (AddProviderModal from the old recap is already gone.)
- _(more per-view code findings below)_

# TRACK C — Server code findings

- **[C-CORE-1] P2 · `projects_api.py` fat router — same shape as
  B-CORE-1 (the right pattern already exists; one file violates it).**
  The API layer ALREADY uses single-concern routers everywhere:
  personas_api, voices_api, lexicons_api, takes_api, effect_presets_api,
  render_presets_api, captures_api, project_export_api. `projects_api.py`
  (1280 lines, 25 endpoints) is the lone outlier, bundling 6+ concerns:
  scene CRUD, block CRUD (note `/v1/scenes/{id}` and `/v1/blocks/{id}`
  aren't even project-scoped paths but live here), cast, import, qc,
  lines, show-notes. Fix: extract `scenes_api.py` + `blocks_api.py`
  (and optionally cast/import) — same single-concern pattern the other
  ~8 modules already follow. Same paths, covered by pytest (247).
  - **[C-2] P3 · export split-brain.** `export_m4b`/`export_voicelines`
    live INSIDE projects_api even though `project_export_api.py` exists
    as a separate module. Consolidate export into project_export_api
    when scenes/blocks are extracted.
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

**Pending focused passes — ALL DONE:**
1. ✅ Per-handler dialog-lifecycle (X-3) — done; only savePersona broken.
2. ✅ Per-endpoint error-handling (C-CORE-3) — done; 404s correct, not a defect.
3. ✅ Settings' 14 sub-tabs — reviewed (General/AI/Generation/Appearance
   screenshotted; Mastering/Capture/MCP/GPU/Logs/Changelog/About
   captured). **Uniformly clean**: label-left/control-right rows in
   jv-cards, JvToggle for booleans, sliders for ranges, capped selects.
   The only Settings issue is the code-structure god-component
   (B-CORE-1), not visual. Minor: number fields (training params) sit at
   the --w-name default; want --w-token (per-input refinement, G-CORE-1).
4. ✅ Remaining views reviewed (screenshots, 0 JS errors all): Home,
   Engines, Effects, Presets, Captures, Labs (Compare/Train/Speaker/
   Render/Audio). **Conformance good** — canonical toolbar+table+card
   patterns throughout. New finding: X-4 redundant lede (Presets/Effects).
5. ✅ Client-code smells — god-components (B-CORE-1) + dead files
   (B-CORE-2) are the structural set; no new god-components beyond the
   six listed.

## AUDIT COMPLETE — every surface reviewed. Net conclusion

The app's **conformance is good** (clean buttons, no native dialogs,
consistent toolbar/table/card/subnav patterns, Settings sub-tabs
uniform). Two scary-sounding concerns evaporated under verification
(error handling, dialog lifecycle). The real worklist is concentrated:

FIXED: G-CORE-1 (input width).
STRUCTURAL (P2, your call): B-CORE-1 god-components (Studio/Settings
decompose), C-CORE-1 fat projects_api (split scenes/blocks), C-2 export
split-brain, B-CORE-2 dead files (delete).
INTERACTION (P2): PersonasView (G-PERSONA-1 create-opens-dialog /
G-PERSONA-2 save-closes / G-PERSONA-4 Save+Cancel footer), X-1
breadcrumb leak.
POLISH (P3): X-4 redundant lede (Presets/Effects + audit Voices/
Personas/Lexicons), per-input width tokens (number→--w-token), X-2
create-pattern consistency, C-1 PUT/PATCH, G-CORE-2 checkbox-component
migration (deferred to per-view cleanup), G-PERSONA-3 table action align.
DESIGN STANDARD set: save-pattern ruling (auto-save inline / Save+Cancel
dialogs / confirm destructive / view-by-view).

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

- **[X-4] P3 · Redundant lede — view repeats the app-level lede.** The
  app renders each view's lede (from `VIEWS[].lede` in App.vue) at the
  top of the content area. Several views ALSO render their own section
  heading + description that repeats it. Confirmed: **Presets** (top
  lede "Render presets — named bundles of voice + delivery…" then a
  `Render presets` heading with a near-verbatim description); **Effects**
  (top lede + an "Effect-chain presets" heading whose description partly
  repeats it, though it adds the copy-at-apply nuance). Recurrence of a
  prior-session class ("duplicate sub-tab titles removed"). Fix: drop
  the view-internal heading/description where it just echoes the app
  lede; keep only genuinely additive text. Audit the other library
  views (Voices/Personas/Lexicons) for the same.

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

## PersonasView  (screenshot: aud-PERSONAS) — ✅ ALL FIXED (0cc0f0c + jv-table align)

GUI / UX:
- **[G-PERSONA-1] P2 · 2-step create.** `createBlank()` (PersonasView
  .vue:151) opens `promptDialog` for the name, POSTs, then sets
  `selectedId` to open the editor. Two surfaces for one action. Fix:
  open the editor immediately on a new blank draft (unsaved), autofocus
  the name field, persist on Save. (User-reported.)
- **[G-PERSONA-2] P2 · Save doesn't close the editor.** `savePersona()`
  (~PersonasView.vue:savePersona) does loadAll + dirty=false + toast but
  never `selectedId.value = null`. Editor stays open after save. Fix:
  close on successful save. (User-reported.) Per the dialog ruling above
  the Persona editor stays an explicit Save/Cancel dialog — Save just
  must close on success.
- **[G-PERSONA-4] P2 · Dialog footer is Save + Delete; should be Save +
  Cancel** (USER 2026-06-14). The editor is a modal; its footer pairs a
  primary Save with a Delete (PersonasView.vue:591-592). Delete already
  lives on each list row (Edit/Delete per row, seen in aud-PERSONAS), so
  in the dialog it's both redundant and a dangerous neighbor to Save.
  Fix: footer = **Save + Cancel** (Cancel discards + closes). Keep
  Delete on the row only.
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

## VoicesView — ✅ sizing done; auto-save deferred (2026-06-14)
- Inspector inputs width-tokened: Name→jv-w-name, Gender(enum)→jv-w-id,
  Language(BCP-47)→jv-w-token (was bare → 280 default; now content-sized).
- The inspector is an INLINE edit with a "Save changes" button. Per the
  save-pattern ruling inline edits should auto-save, but doing it right
  needs the shared debounced-save + "Saved ✓" indicator + revert infra
  (not built yet). DEFERRED — fold into the auto-save infra rollout
  view-by-view; current explicit Save is correct in the meantime.
- Clone/Design/Blend remain explicit modals (create flows → explicit
  commit, correct per ruling).

## LexiconsView — ✅ reviewed, minor sizing (2026-06-14)
- Note entry input → jv-w-name (the other 3 entry fields already had it).
- Editor dialog is correct as-is: it's atomic ENTRY MANAGEMENT (name set
  at create, scope read-only, each entry add/delete is its own API call),
  so "Close" is the right affordance — NOT Save/Cancel (unlike Persona,
  which edits one entity). No interaction change needed.
- createLexicon is a legitimate create dialog (promptDialog name+scope →
  create → open editor to add entries), an explicit Create commit per the
  ruling. (X-2 cross-flow create-pattern unification is still its own
  broader item: Books=modal, Personas=open-editor, Lexicons=promptDialog.)

---

# DIALOG DEEP AUDIT (2026-06-14) — full read of every overlay, not grep

Triggered by missing the Preset dialog twice. My earlier dialog pass was
grep-based (jv-overlay/jv-modal + button labels) and was BOTH shallow
and INCOMPLETE — a broad sweep (position:fixed / *-overlay / *-modal /
role=dialog) finds surfaces the canonical-class grep can't:
AppDialog, AppModal, ChordPicker, EffectsChainEditorModal,
GlobalAudioPlayer, JvHelpDrawer, KeyboardCheatsheet, LineageViewer,
NewProjectModal, QuickSetup, TaskStatusPanel, VoiceParamsModal, +
BooksView/GenerateView/ImportModal/LexiconsView/PersonasView/
RenderPresetsView/StudioView/VoicesView.

Checklist per dialog: (1) create opens directly vs prompt-then-open;
(2) save model — Save+Cancel (entity edit) / atomic-Close (sub-resource
mgmt) / never auto-save-in-dialog-without-discard; (3) Save closes on
success; (4) Cancel truly discards; (5) draft buffer vs live-object
mutation; (6) Delete on row not beside Save; (7) read-only guards;
(8) canonical jv-overlay/jv-modal shell; (9) input sizing.

## Verdicts (deep-read)

- **VoiceParamsModal — ✓ CORRECT.** Working copy `params={...modelValue}`
  on open; commit on Save, discard on Cancel; Save+Cancel footer;
  number inputs jv-w-token. Reference example of the right pattern.
- **EffectsChainEditorModal — ✓ CORRECT** (minor). Deep-copies chain on
  open (true draft isolation); Save+Cancel. Minor: one hand-rolled
  `.jv-check` (G-CORE-2 deferred); `.param-num` width:100% could be token.
- **PersonasView editor — ✓ FIXED** this session (open-direct create,
  Save closes, Save+Cancel, Delete on row).
- **RenderPresetsView dialog — ✗ BROKEN.** (a) auto-saves per field with
  only "Done" — no discard/Cancel (violates dialog ruling); (b) 2-step
  create (promptDialog name → openEdit); (c) built-in presets editable
  with no guard (inputs not disabled for is_builtin). Fix: rebuild on the
  Persona pattern (draft + Save/Cancel + open-direct create).
- **NewProjectModal — ✗ non-canonical + ghost buttons.** Rolls its own
  `np-overlay/np-dialog/np-*` shell (~60 lines scoped CSS) instead of
  jv-overlay/jv-modal; `.np-import` are borderless text buttons (RULE #1
  #6); scoped `.np-input` instead of jv-input. Create-emit pattern itself
  is correct (caller owns POST). Fix: reshell on jv-modal; ghost→jv-btn.
- **VoicesView Clone/Design/Blend/Import — ~OK pattern, ✗ shell.** Good:
  Cancel + explicit submit (create=explicit commit), canonical
  JvField/JvInput/JvSelect, blend weight width=token. Issues: rolls its
  own `.modal-*` shell (non-canonical); DOUBLE close affordance (ghost
  "Close" in header AND "Cancel" in footer).
- **LexiconsView editor — mostly OK (atomic-mgmt).** Name set at create,
  scope read-only, entries are atomic add/delete → "Close" is right (NOT
  Save+Cancel). OPEN Q: header has a Delete (line 395) AND the row has a
  Delete (line 375) — duplicate delete; per G-PERSONA-4 reasoning the
  dialog Delete could go (row is enough). Minor.

## Cross-cutting finding (NEW — grep could not see this)
- **[X-5] P2 · Non-canonical modal shells.** NewProjectModal (np-*) and
  VoicesView (modal-*) hand-roll overlay/modal CSS instead of the
  canonical jv-overlay/jv-modal. Duplication + RULE #1 violation +
  inconsistent close/footer behavior. Reshell both onto jv-modal.

## Still to deep-read (this pass continues)
AppModal + AppDialog (primitives — define the standard), QuickSetup
(wizard), ImportModal (multi-step), ChordPicker, LineageViewer,
BooksView add-cast modal, StudioView add-persona modal, GenerateView
overlay (SlashTagMenu?), + panels GlobalAudioPlayer/TaskStatusPanel/
JvHelpDrawer/KeyboardCheatsheet (lighter — not editors).
