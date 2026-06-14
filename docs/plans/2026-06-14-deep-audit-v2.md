# Deep audit v2 — full re-derivation (2026-06-14)

**SUPERSEDES `2026-06-14-deep-audit.md`.** That pass mixed deep reads
with grep proxies and declared "complete" prematurely; it missed the
Preset dialog, non-canonical modal shells, the Lexicon append-only-
entries gap, and more. **None of its verdicts are trusted here** — every
finding below is re-derived from a full read of the file. Fixes already
shipped this session (stores, G-CORE-1 input width, Persona dialog,
breadcrumb, dead files, jv-table align) are RE-VERIFIED here, not assumed.

## Method (the standard, applied uniformly to every file)

For each file: read it IN FULL. Then write:
- **What it is** (one line).
- **Correctness** — simulate the actual flow + data; find where it
  breaks, lies about state, mishandles edges, or races.
- **Conformance** — RULE #1 (canonical jv-overlay/jv-modal shell, width
  tokens, JvButton/JvToggle, no ghost/native, jv-subnav/jv-table), and
  the save-pattern ruling (auto-save inline · Save+Cancel dialogs ·
  confirm destructive).
- **Verdict**: ✓ clean · ⚠ minor · ✗ defect.
No grep stands in for reading. A pattern found once is checked against
every sibling. Nothing is "done" until written here.

Severity: P1 broken/blocks · P2 clear defect · P3 polish.
Committed per area (compaction-proof + checkable).

## Coverage checklist (every file must get a verdict)

CLIENT views (26): AudioChannels AudioTools Books Cache Captures Chapter
Compare Effects Engines Generate ImportModal ImportReview Labs Lexicons
Lines Overview Personas RenderLab RenderPresets Settings SpeakerLab
Stories Studio Train Voices Webhooks
CLIENT components (26): AppDialog AppModal AudioKeepAlive Breadcrumb
CapturePill ChordPicker DictateWindow EffectsChainEditorModal EmptyState
ExportPanel GlobalAudioPlayer HelpTrigger Icon JvHelpDrawer
KeyboardCheatsheet LineageViewer NewProjectModal PaneHeader ProviderForm
QuickSetup RecommendCard SlashTagMenu TaskStatusPanel TaskStrip Toast
VoiceParamsModal
CLIENT jv/ (9): JvButton JvCheckbox JvField JvInput JvSegmented JvSelect
JvTag JvTextarea JvToggle
CLIENT stores/services/composables/root.
SERVER api (39) · core (22) · engines/storage/database/audio/mcp.

---

# FINDINGS (by area, as each file is read in full)

## Dialogs — re-derived (in progress)

### LexiconsView editor dialog (views/LexiconsView.vue:383-475) — ✗ DEFECTS
Read in full. It's a per-lexicon manager (header: name + scope + count +
Import + Export + Delete; read-only scope; live-preview input; entries
table; append-entry 4-input grid + Add/BulkPaste/Preview).
- **P2 · entries are append-only in the UI.** The entries table row
  (428-435) exposes only a DISABLED "Edit" ("lands in #103.1") and **no
  per-entry delete**. You can add a pronunciation but never fix or
  remove it. Functional gap.
- **P2 · Delete (the whole lexicon) sits in the dialog header** (395),
  destructive-prominent, AND duplicates the row Delete (375). Per the
  save-pattern ruling Delete belongs on the row; the header should not
  carry the destroy action.
- **P3 · no Save + unsignalled atomic model.** Entries persist on "+ Add
  entry"; nothing tells the user that, so the missing Save reads as
  "did it save?" Needs a one-line "entries save as you add them" cue (or
  rethink as a Save-committed editor).
- **P3 · header is crowded** (Import/Export/Delete) + a second action row
  (Add/Bulk paste/Preview) — many competing affordances; the core task
  (add a word→pronunciation) doesn't stand out.
- Shell: uses canonical jv-overlay/jv-modal ✓. Inputs width-tokened ✓
  (jv-w-name / preview jv-w-prose — fixed earlier this session).

## jv/ primitives (9) — ✓ ALL CLEAN (full reads)
JvButton (variant role+visual, ghost=bordered not borderless, loading,
`as` for link), JvCheckbox (wraps .jv-check + v-model + label slot — the
canonical target for the hand-rolled checkboxes in G-CORE-2), JvField
(inline/block labelled row), JvInput (v-model + width prop; base now
caps at --w-name via G-CORE-1), JvSegmented, JvSelect (native + width +
restores typed value), JvTag (pill), JvTextarea (autosize + width;
defaults --full = prose, correct), JvToggle (role=switch + aria + anim).
No defects. These are the right primitives; the app's conformance debt
is in views that hand-roll instead of using them, not here.

## small components batch 1 (full reads)
- **AppDialog.vue — ✓ CLEAN.** promptDialog/confirmDialog host on Reka UI
  Dialog (focus trap, Esc, ARIA). Save+Cancel (ghost Cancel + primary/
  danger confirm), multi-field, autofocus+select first field, canSubmit
  validation, requireMatch for delete-typed-confirm. Well-built primitive.
- **AppModal.vue — ✓ CLEAN.** Generic modal on Reka UI Dialog; eyebrow/
  title/wide/noPadding/closable + header/footer slots; 200ms transition
  close; Esc/outside gated by `closable`. The canonical modal shell that
  NewProjectModal + VoicesView should use instead of their scoped shells.
- **Toast.vue — ✓ CLEAN** (vue-sonner host, bottom-center, close-button).
- **EmptyState.vue — ✓ CLEAN** (icon/title/message/action slot).
- **Icon.vue — ✓ CLEAN** (inline SVG path set; no deps).
- **Breadcrumb.vue — ⚠ VERIFY USAGE (likely DEAD).** A standalone
  breadcrumb component, but App.vue renders `uiContext.breadcrumb`
  inline — this component may have 0 importers (like Combobox/ListPane).
  CHECK + delete if unused.
- **PaneHeader.vue — ⚠ VERIFY USAGE.** eyebrow+h1+HelpTrigger header;
  views appear to render their own headers. CHECK importers; delete if
  unused.

═══════════════════════════════════════════════════════════════════════
# ◆◆◆ AUDIT PROGRESS / PICKUP POINT (resume here after compaction) ◆◆◆
═══════════════════════════════════════════════════════════════════════

**Task:** complete, full deep audit of the WHOLE app (client + server),
re-derived from full reads (this v2 doc). User does NOT trust the v1 doc
(`2026-06-14-deep-audit.md`) — its verdicts were grep/shallow. Run to the
end autonomously; commit per area; don't declare complete until every
file in the Coverage checklist has a written verdict.

**Branch:** claude/dreamy-rubin-91lsr3 (pushed to origin + origin/main).
**Verify harness:** `justvoice-server serve --host 127.0.0.1 --port 8741`
(serves SPA at /; same-origin API). Headless driver: Chromium at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; `node scripts/
smoke.mjs` sweeps all views for JS errors. Build: `npm run build:vite`.
**Commits:** sign with `git commit -S`; backticks/`$` in -m trigger shell
substitution — avoid or use heredoc.

**Fixes already SHIPPED this session (RE-VERIFY in this audit, don't
assume):** 5 shared Pinia stores (data-layer rebuild) · G-CORE-1 input
width default cap · PersonasView dialog (open-direct create / Save closes
/ Save+Cancel / Delete on row) · usePageCrumbs breadcrumb-leak fix ·
deleted Combobox+ListPane · jv-table actions alignment · Voices/Lexicons
width tokens · no-engine lede removed.

**DONE (verdicts written above):**
- jv/ primitives ×9 → all ✓ clean.
- components: AppDialog ✓, AppModal ✓, Toast ✓, EmptyState ✓, Icon ✓,
  Breadcrumb ⚠dead?, PaneHeader ⚠dead? ; (from v1, re-verify) Persona
  editor ✓fixed, VoiceParamsModal ✓, EffectsChainEditorModal ✓minor,
  NewProjectModal ✗(scoped shell+ghost), VoicesView modals ✗(scoped shell).
- views: LexiconsView dialog ✗ (append-only entries, header Delete).
- Carry-forward (re-derive, not trusted): RenderPresets dialog ✗,
  god-components (Studio 2708 / Settings 2605), fat projects_api, X-5
  non-canonical shells, X-4 redundant lede (Presets/Effects).

**REMAINING (not yet deep-read this v2 pass):**
- components: HelpTrigger, CapturePill, TaskStrip, AudioKeepAlive,
  ChordPicker, DictateWindow, ExportPanel, GlobalAudioPlayer,
  JvHelpDrawer, KeyboardCheatsheet, LineageViewer, ProviderForm,
  QuickSetup, RecommendCard, SlashTagMenu, TaskStatusPanel.
- ALL 26 views (behavioral + conformance) — only Lexicons dialog done.
- stores (15) / services (8) / composables (3) / App.vue / main.js / config.
- SERVER: api ×39, core ×22, engines/storage/database/audio/mcp.

**Next concrete step:** finish components batch (HelpTrigger…SlashTagMenu),
then views one-by-one (full read each: data flow, dialog pattern, sizing,
conformance), then stores/services, then server api, then server core.

═══════════════════════════════════════════════════════════════════════
# ◆◆◆ FOR A FUTURE SELF: what went wrong + what "deep" means ◆◆◆
═══════════════════════════════════════════════════════════════════════

The user lost trust in my v1 audit. Here is exactly why, so you don't
repeat it. READ THIS BEFORE AUDITING ANYTHING.

## What I did wrong (the failure modes)
1. **Proxies instead of reading.** I used grep + screenshots + button-
   label checks as stand-ins for understanding behavior. A grep for
   `label="Save"` cannot tell you a dialog auto-saves with no Cancel, or
   that entries are append-only. Behavior is only knowable by READING the
   code and SIMULATING it.
2. **Inconsistent depth.** I read PersonaView's dialog deeply and fixed
   it, then gave Preset/Lexicon a glance and called them reviewed. So
   whether a bug got found depended on which file I happened to study —
   that makes the whole audit untrustworthy.
3. **Declared "COMPLETE" after glancing.** I wrote "AUDIT COMPLETE — every
   surface reviewed" having screenshotted, not studied. Premature.
4. **The inventory itself was incomplete.** I enumerated dialogs by
   grepping `jv-overlay|jv-modal` — which BY DEFINITION excludes the
   non-canonical ones (NewProjectModal `np-*`, VoicesView `modal-*`). The
   tool that builds the list must not pre-filter to the thing you're
   checking for.
5. **Found a pattern once, didn't propagate it.** The Persona dialog bugs
   (2-step create, no-close, footer) are a CLASS. I fixed the instance
   instead of turning it into a lens dragged across all 16 dialogs.
6. **"It's fine" from shallow reasoning.** "Lexicon is atomic mgmt, Close
   is correct" was technically-true and ignored the real UX: append-only
   entries (can't edit/delete a pronunciation), Delete in the header, no
   save signal. A clean verdict needs POSITIVE evidence from a full read,
   not the absence of an obvious bug.
7. **Optimized for breadth/speed over correctness.** Committing fast and
   "covering" surfaces felt like progress; it wasn't.

## What a real DEEP audit means (the standard — hold to it)
- **Read every file IN FULL.** Never let grep/screenshot stand in for
  comprehension of behavior.
- **Simulate it.** For each surface: what does the user do → what state/
  data results → where does it break, lie about state, mishandle an edge,
  or race? Walk the unhappy paths, not just the happy one.
- **Think in the USER's mental model**, not just technical correctness. A
  dialog can be "technically atomic" and still be confusing/incomplete.
- **Propagate every pattern.** A defect found once becomes a checklist
  item applied to EVERY sibling before you move on.
- **Build inventories by broad signal**, then read — don't pre-filter to
  the canonical case you're hunting.
- **Write the reasoning down per file** (verdict + specifics + line refs)
  so the user can CHECK it. The audit's value is the evidence, not the
  verdict.
- **"Done" = every file in the Coverage checklist has a written verdict.**
  Not "I looked around."
- **Verify, don't guess.** Run the server, probe the endpoint, read the
  computed — confirm before asserting (this caught several false alarms:
  error-handling 404s, the `editing` computed not being stale).

## components batch 2 (full reads)
- HelpTrigger ✓ clean (? button → opens help drawer).
- CapturePill ✓ clean (voicebox-ported dictation pill; attribution hdr ok).
- TaskStrip ✓ clean (running/finished task strip; Details/Cancel/Retry/✕).
- Dead-check CORRECTION: Breadcrumb (3 importers) + PaneHeader (1) are
  USED, NOT dead. (Verified — my "likely dead" suspicion was wrong.)
- STILL PENDING (truncated, re-read): AudioKeepAlive, RecommendCard,
  SlashTagMenu, LineageViewer, ChordPicker, DictateWindow, ExportPanel,
  GlobalAudioPlayer, JvHelpDrawer, KeyboardCheatsheet, TaskStatusPanel,
  ProviderForm, QuickSetup.
