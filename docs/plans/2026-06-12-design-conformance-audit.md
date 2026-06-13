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


## ⚠ CORRECTION (2026-06-13) — what the resweep did and did NOT certify

User catch ("the full resweep is not done... we never resweeped the
whole app, did we?"). The resweep section above OVERSTATES. Precisely:

- The resweep was PROBE-LEVEL only: spacer-orphan detection + shell
  widths via DOM measurement. "Row grammar clean everywhere" means
  "no spacer-orphans" — nothing more.
- It ran against the PRE-CORRECTION rule 7 (the stretch-to-meet
  version, later rewritten in 6765167 after the copy-vs-think
  correction). It never checked stretch-to-fill, grouping by
  relatedness, primary-action placement, control semantics, or copy.
- The canonical method below (screenshot judgment pass, modal +
  data-state coverage) has only ever been applied to TWO pages:
  Speaker (c3867d1) and Train (c3033ab). Spot-verify those; every
  other surface, all modals, ImportReview, and all data-dependent
  states have NEVER been read against the final standard.

**Therefore: the FULL GUI sweep per the canonical method is still
PENDING.** What is genuinely complete is the mechanical layer (rules
1-6 probes: checkboxes, width tokens, button classes, naked controls,
ghost restyle) at the empty-state level. Sequence agreed with the user
2026-06-13: wiring audit (docs/plans/2026-06-13-wiring-audit.md) first
— its fixes may add/remove affordances — then the full judgment sweep
below across all surfaces. The user's QC batches outrank both when
they arrive.

## Sweep method (canonical — use this verbatim for the next sweep)

Two passes; neither alone counts. Findings land in this doc FIRST,
fixes execute only on the user's go, one surface per commit, each
ending with the whole-view checklist run against the new output.
Questions from the user during a sweep get answers, not edits.

**Pass 1 — mechanical (automatable probe + greps):**
native checkboxes/controls (INCLUDING inside modals) · width-token
violations (>content class, flex-stretch on non-prose) · buttons off
canonical classes · borderless-render regression (ghost decree) ·
controls outside card/table/toolbar shells · jargon greps in
user-facing strings ("pin", endpoint paths, HTTP codes, snake_case
keys) · zero JS errors per surface.

**Pass 2 — judgment (screenshot per surface, READ, not measured):**
layout grammar per checklist rule 7 (content-sized, rows end, grouped
by what controls act on, primary action in reading order — flag BOTH
stretch-to-fill and orphaned fragments) · control semantics (does the
control say what it does: internal modes as buttons, wrong intent for
the role, disabled states without a why, invisible defaults instead of
resolved truth) · copy read aloud once (duplication, double-named
fields, placeholder/hint overlap).

**Coverage that prior sweeps skipped — mandatory:**
the modal layer (Clone/Design/Blend, EffectsChainEditorModal,
ProviderForm inline edit, QuickSetup, ImportModal) · ImportReview via a
real dry-run import · data-dependent states (engine loaded, render
results present, train jobs running, populated history) — empty-state
screenshots certify nothing about working states.

**Do NOT:**
re-audit closed findings (spot-verify only) · re-flag recorded
exceptions (Engines ev-chip = Phase 4; char-x/vrow-main custom
affordances; prose textareas full width; Home full-row-link CTA) ·
copy any reference layout — JustWrite is consulted for PRINCIPLES only
and its own flaws (e.g. its giant preset dropdown) don't transfer.

**Honesty:** record false positives and deliberate exceptions so they
stop re-flagging; state coverage limits explicitly (what the container
can't exercise; Windows WebView2 rendering needs the user's machine).


## Full GUI judgment sweep — findings (2026-06-13)

First run of the canonical two-pass method across the whole app since
the ⚠ CORRECTION. Method actually executed: real data seeded (Stillwater
EPUB → audiobook, CSV → game "quest", markdown → "episode"; 7 personas,
1 lexicon, 4 built-in presets, a cast assignment), then a Playwright
probe at 1920px over 23 views + Settings' 15 sub-tabs + the modal layer,
fullPage screenshots READ one by one (not measured). Zero JS errors on
any surface. Findings land here; FIXES AWAIT THE USER'S GO.

### G-findings (ranked)

**G1 — ChapterView: no-takes block points at a button that isn't there
(control semantics, real dead-end).** A block with zero takes renders
"No takes yet — click Regenerate to create the first one."
(ChapterView.vue:913) but the Regenerate button lives inside the
`v-else` takes-exist branch (ChapterView.vue:1039) — so in the empty
state there is NO Regenerate/Generate affordance at all. The first
render of any block is unreachable from this view. Worst finding:
it's a broken core path, not cosmetics. Fix = surface a
Generate/Regenerate control (or route to it) in the no-takes state.

**G2 — Projects lede leaks API jargon (checklist rule 5).** "Multi-use
Project library. … Imports from JustWrite via POST
/v1/projects/import?source=justwrite." The endpoint path is internal —
users don't speak HTTP. Trim to the human sentence.

**G3 — Settings lede leaks internal filenames (checklist rule 5).**
"Every operator-tunable value. Per CLAUDE.md, no value is hardcoded —
every knob lives in settings.json." `CLAUDE.md` is an agent-instructions
file the user never sees; `settings.json` is an implementation detail.
(Distinct from the Settings → About API-reference TABLE, which documents
endpoints on purpose — that's correct and stays.)

**G4 — ProviderForm: two bare unstyled `<select>` (control
consistency).** `provider_type` (ProviderForm.vue:360) and
`response_format` (:442) are raw `<select>` with NO class — they render
as OS-native dropdown chrome (visible in the screenshot as the only
control on the page not matching the design). The app's two accepted
styled patterns are JvSelect (8 files) and `<select class="jv-input">`
(22 instances); these two are the only ones outside both. Worst on
Windows WebView2. Fix = give them `jv-input`(+width token) or JvSelect.
NB: ProviderForm's checkboxes ARE `.jv-check` (self_hosted/LLM/TTS) —
the bc9ee48 sweep held; not a finding.

**G5 — Modal header convention split (minor consistency).** Two shells
coexist: AppModal renders eyebrow + title + ×-top-right (Import,
EffectsChainEditor — clean), while AppDialog/promptDialog renders a
bare title with the × on its own line below it, left-aligned
(lexicon-create, prune-by-voice). The below-title left × reads as
awkward next to the AppModal pattern. Judgment call: align AppDialog's
close affordance to the top-right, or accept as the dialog-vs-modal
distinction. Lowest priority.

### Verified clean this pass (judged, pass the checklist)

ImportReview (first-ever render — styled `.jv-check`, primary "Import N
chapter →" at the end in reading order, honest "nothing imports until
you confirm" copy) · Import modal · Lexicon-create modal · Prune-by-
voice dialog (W1 dry-run flow confirmed in UI) · EffectsChainEditor
modal · QuickSetup modal · Persona-create modal · Generate (delivery
overlay, honest disabled-with-reason on Pitch + Delivery-direction) ·
Studio Cast (two-pane, game NPC table) · Chapter detail except G1 ·
Generate prose textarea · all 15 Settings sub-tabs (mechanically clean;
ledes G2/G3 aside) · Stories (now the W3 honest gate).

### False positives / recorded exceptions (do not re-flag)

- Generate SPEED/PITCH/GAIN/TEMPERATURE "wide inputs" = range sliders;
  full-column is correct.
- Studio Cast voice-library search (614px) = search over a list; wide
  is acceptable (resweep nuance).
- `jv-pill` / `jv-toggle` / `jv-stepcard` / `usecase-chip` /
  `chapter-view__flow-step` / `ev-chip` / `studio__char-x` /
  `studio__vrow-main` flagged by the probe's "button without literal
  jv-btn class" heuristic = all legitimate styled component classes or
  already-recorded exceptions (F3/F5). The heuristic over-reports;
  these are not off-canonical buttons.
- `<select class="jv-input">` (22) vs JvSelect (8) = two accepted styled
  conventions, not a defect (only the G4 BARE selects deviate).
- Settings → About API-reference table showing `/v1/...` = intentional
  API documentation, not lede jargon.

### Coverage limits (honest — needs the user's machine)

- Voice Clone/Design/Blend modals NOT exercised: Clone is correctly
  disabled without Chatterbox loaded, Design/Blend sit behind a
  collapsed "Other ways to add a voice" details — no TTS models in the
  container. Their internals are unjudged this pass.
- Data states requiring real renders/GPU unjudged: populated take
  navigators, loaded-engine delivery controls, running train jobs,
  render-results tables. Seeded projects/personas/lexicons exercised
  the structural states; audio-bearing states did not.
- Studio Script step didn't open under the probe (selector timeout) —
  Cast + Render judged, Script not.
- Windows WebView2 native rendering (where G4's bare selects look worst)
  reproduced only approximately under Linux chromium.

### Fix queue (executing on user go, 2026-06-13)

1. ✅ G1 ChapterView no-takes affordance — empty state now renders a
   primary "▶ Generate first take" button (reuses regenerateBlock,
   which resolves the cast voice or asks) + honest hint. Live-verified.
2. ✅ G4 ProviderForm two bare selects — provider_type + response_format
   now `class="jv-input jv-w-name"` (the 22-instance inline convention);
   scoped `.pf-row select` override dropped so the canonical box governs.
   Live-verified: zero bare selects in the form.
3. ✅ G2 + G3 lede de-jargon — Projects lede drops the POST /v1/... path
   ("Import manuscripts from JustWrite, or scripts and audio from other
   tools."); Settings lede drops CLAUDE.md/settings.json ("Every tunable
   setting in one place — nothing is hardcoded…"). Live-verified absent.
4. ✅ G5 modal header alignment — AppDialog header is now a flex row
   (title left, close top-right) matching .jv-modal__header; the close
   no longer drops below the title. Live-verified geometry.

**GUI fix queue COMPLETE (2026-06-13).** All five G-findings shipped,
one commit each, each live-verified. Spot-verify remains for the
data-state surfaces the container couldn't exercise (render results,
loaded-engine controls) — those need the user's machine.
