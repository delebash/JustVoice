# Whole-app design-conformance audit — 2026-06-12

<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

Method: static census (grep for raw checkboxes, native dialogs, jargon)
+ rendered-DOM probe of every view and sub-tab at 1680px (native
checkbox count · inputs/selects >420px · buttons off the canonical
classes · controls outside any card/table/toolbar shell) + screenshot
review of every flagged surface. Checklist: CLAUDE.md RULE #1.
Zero JS errors anywhere. 29 surfaces probed.

## Coverage limits (honest)

- **Not rendered**: ImportReviewView (needs an import in flight) and
  the modal layer (Books add-personas, Studio voice-params,
  EffectsChainEditorModal, ProviderForm, QuickSetup) — static census
  only for those.
- Data-dependent states (engine loaded, render results, train jobs)
  not exercised.
- Windows WebView2 rendering (where native checkboxes go big + blue)
  reproduced only approximately under Linux chromium.

## Findings, ranked

### F1 — Labs · Render tab: fails most checklist rules (worst surface)
Naked sections on the page background (no cards), axis value inputs
500px for short comma lists, hand-rolled label rows instead of JvField,
2 raw checkboxes. Already queued; rebuild like the Speaker tab.

### F2 — Raw native checkboxes: 13 instances, 10 files (whole class)
Two species needing two fixes:
- **On/off settings → `JvToggle`** (Settings precedent): Generate
  Autoplay chip · Captures Auto-paste chip · Settings "also delete all
  personas" + "include audio" · ProviderForm self-hosted ·
  EffectsChainEditorModal boolean params · QuickSetup · RenderLab axis
  enables.
- **Row/multi-select in tables → a styled checkbox, not a toggle**:
  ImportReview include-rows · Studio voice-row select · Books modal
  rows · ProviderForm capability picks. Nothing canonical exists →
  promote `.jv-check` (custom box, accent fill — JustWrite's
  JwCheckbox precedent) to styles.css first, then sweep.
This also fixes the platform problem: native checkboxes render big +
OS-colored on Windows WebView2 regardless of our accent-color rule.

### F3 — Studio · Cast: naked toolbar controls + one-off button classes
Project select (480px) + persona search sit outside any shell; three
scoped button families (`studio__char-x`, `studio__vrow-main`,
`studio__voice-action`) off the canonical classes. Moderate — the
two-card layout itself is sound.

### F4 — Width-token misses (minor, mechanical)
Compare: Label A/B inputs 491px → `jv-w-name`. Settings · General:
override-URL 480px → `jv-w-url`. Settings · AI features: two 516px
role selects → cap at `jv-w-url`. (GPU path input at 480px = `--w-path`
exactly — false positive, correct as-is.)

### F5 — Approved divergences / acceptable (recorded so they stop
re-flagging)
- Engines view: `ev-tab`/`ev-chip` classes + 1150px search — the
  user-approved mock-v7 design system; unify class names in a later
  dedicated pass, not as slop.
- Chapters flow-step buttons (`chapter-view__flow-step`): unique
  wizard affordance, scoped on purpose.
- Generate prose textarea + GPU path input: full-width is the correct
  content-typed width.
- Settings · General `usecase-chip`: segmented chip group, visually
  canonical; rename-to-canonical optional.

### Clean surfaces (pass all five rules today)
Home · Projects · Chapters · Lines · Stories · Captures(*) · Voices ·
Personas · Lexicons · Effects · Presets · Labs Compare(*)/Train/
Speaker/Audio · Settings Mastering/Generation/Capture/MCP/GPU/
Appearance/Cache/Channels(*)/Webhooks/Logs/Changelog/About.
(*) = except the F2 checkbox instances listed above.

## Fix queue — ALL COMPLETE 2026-06-12

0. ✅ Engines reusable patterns promoted (.jv-toptab/.jv-searchbar;
   ev-chip stays scoped pending Phase 4 chip convergence) — c6923a4.
1. ✅ Render tab rebuild (F1) + .jv-eyebrow/.jv-pane-card promoted,
   SpeakerLab converted off its scoped copies — 261b841.
2. ✅ Canonical .jv-check (F2): 12 raw instances + JvCheckbox's internal
   input; all 16 views + every sub-tab verified zero unstyled — bc9ee48.
3. ✅ .jv-rowact promoted (Chapters + Studio row actions, 178 buttons);
   Studio project select → jv-w-name. Project bar's "naked" flag was a
   probe heuristic miss (it has a proper shell); char-x / vrow-main
   stay scoped as genuinely custom affordances — 20aea1d.
4. ✅ Width tokens (F4): Compare labels → name, Settings role selects →
   url, override-URL path→url — b21cde6.


## Resweep — 2026-06-12 late (rules 6-7 + shell, added after user catches)

The first audit's five rules missed three layers the user caught on the
Speaker tab (row grammar, shell widths, control semantics). Resweep of
all 19 surfaces at 1920px against the new rules:

- **Row grammar (rule 7)**: clean everywhere post-fixes. One probe flag
  — Home's next-step banner CTA ("Open Engines ➜") right-aligned after
  a spacer — is the right edge of a FULL-ROW LINK (the whole banner is
  the <a>); functionally an action cluster, recorded acceptable.
- **No-ghost decree (rule 6)**: handled at the token level (55f639a) —
  every ghost button app-wide renders outlined; no per-surface
  violations remain.
- **Shell widths**: tables / master-detail / workbench views are
  correctly wide (the JustWrite comparison nuance: width is fine when
  rows use it). ONE real catch: **Labs · Train** — a two-column form
  grid of ~250px controls spread across a 1750px card, huge dead
  interior; the queue-a-fine-tune card is form-first and should take
  `--shell-form` (880px). The jobs table below it stays wide. NOT yet
  fixed — queued for go.
- **Control semantics**: the Auto-pill and +Add classes were fixed in
  814c233; the remaining semantics layer is inherently per-surface
  judgment and stays a standing QC lens rather than a one-shot pass.
