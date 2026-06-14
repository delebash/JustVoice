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

# TRACK B — Client code findings

_(populated per view below)_

# TRACK C — Server code findings

_(populated after client tracks)_

---

# Per-view audit log

_(each view: screenshot reviewed + code read; GUI + client findings)_
