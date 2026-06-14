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

_(populated per view below)_

# TRACK C — Server code findings

_(populated after client tracks)_

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
- **[G-CORE-2] P3 · Two boolean controls coexist.** `JvToggle` (switch)
  AND `.jv-check` (styled native checkbox, used in 12 places:
  Generate/Import/Settings×2/Books/Captures/Studio/ProviderForm×3/
  QuickSetup/EffectsChain). RULE #1 #1 says "JvToggle/styled control,
  never a native checkbox" — `.jv-check` is a styled checkbox so it's
  arguably compliant, but having two boolean idioms is a consistency
  smell. **User decision:** is the split intentional (toggle = setting,
  check = multi-select row) or should it unify? Not a bug; flagging for
  a ruling.

---

# Per-view audit log

_(each view: screenshot reviewed + code read; GUI + client findings)_

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
