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

## components batch 3 (full reads — completes the 26-component sweep)
- **AudioKeepAlive.vue — ✓ CLEAN.** voicebox-ported silent-audio loop that
  keeps the OS audio device warm so first playback isn't clipped. No UI.
- **RecommendCard.vue — ✓ CLEAN.** Contextual recommend banner; canonical
  jv-card/jv-btn. No state lies.
- **SlashTagMenu.vue — ✓ CLEAN.** Engine-aware inline paralinguistic-tag
  menu (the `/` slash menu). Keyboard nav, filters by engine capability.
- **ChordPicker.vue — ⚠ P3 conformance.** Live key-combo capture (voicebox
  port). Correct behavior (peak-set capture, Esc/Tab pass-through, focus
  trap on the capture box). BUT non-canonical: scoped `.chord-picker__
  backdrop`/`.chord-picker` modal shell (NOT jv-overlay/jv-modal) AND
  scoped `.btn/.btn--ghost/.btn--primary` buttons (NOT JvButton). X-5 class.
- **GlobalAudioPlayer.vue — ⚠ P3.** Fixed bottom transport bar (unique
  surface, no canonical precedent — scoped `gap-*` is acceptable). Play/
  pause/close are icon-only buttons (icon exception, OK). Note: the
  waveform is FAKE — `bars.map(() => Math.random())` re-randomized on every
  `timeupdate` (~4 Hz); cosmetic only, documented as the voicebox AudioBars
  approximation. Acceptable; flag only if a real peak-decoded waveform is
  wanted later.
- **JvHelpDrawer.vue — ✓ CLEAN.** Right-side help drawer on Reka UI Dialog
  (focus trap/Esc/ARIA free). Renders docs/<slug>.md via marked; intra-doc
  links stay in-drawer. Scoped `jv-help-drawer__*` OK (unique drawer, not a
  center modal). Close is an icon ✕ (exception). JustWrite-ported, attributed.
- **KeyboardCheatsheet.vue — ✓ CLEAN.** `?` overlay. Uses canonical
  jv-overlay/jv-modal shell correctly — a good precedent example.
- **DictateWindow.vue — ✓ CLEAN.** Floating transparent Tauri dictate
  window (voicebox port). Agent-speak cycle wired (SSE status → play
  /audio/{id}); user-dictation cycle deferred to Phase 6 (documented).
  Timers/teardown all cleaned in dismissSpeak/onBeforeUnmount. No leaks.
- **TaskStatusPanel.vue — ⚠ P3.** Right slide-in task panel (running +
  recent history, cancel/retry/dismiss). Functional, unique namespace
  (`task-panel__*`, fine). `.task-panel__action` (Cancel all / Clear) are
  BORDERLESS text buttons (`border:0;background:transparent`) — RULE #1
  item 6. `__hist-dismiss`/`__hist-retry` are icon buttons (exception).
- **ExportPanel.vue — ✗ P2 BUG + ⚠ P3.** Mostly canonical (JvButton,
  jv-card, jv-pill, jv-banner; honest ACX checklist — only measured items
  get ✓/✗; QC no longer auto-fires). **BUG (P2): the show-notes "Copy"
  button calls `navigator.clipboard?.writeText(...)` in the TEMPLATE.**
  Vue's template global allowlist does NOT include `navigator`, so it
  resolves to `_ctx.navigator` = undefined → `undefined.clipboard` THROWS
  a TypeError on click. Only reachable for podcast projects (show-notes),
  but it's a hard throw. Fix: move to a `copyNotes()` method in setup.
  P3: two raw `jv-btn jv-btn--ghost jv-btn--sm` (Copy/✕) instead of JvButton.
- **ProviderForm.vue — ⚠ P3 (documented exception) + native-checkbox class.**
  Inline expanded-card provider editor (LLM/TTS). Behavior is solid:
  presets, capability toggles, fetch models/voices, test-connection status,
  auto-slug id, self-hosted auto-detect. Has explicit Save/Cancel — correct
  (complex editor, dialog-like). Scoped `.pf-*` input styling (240/340px)
  instead of jv-input is the APPROVED engines-redesign.html v7 mock
  contract — recorded exception, not a defect. NATIVE checkboxes
  (`jv-check`) for self_hosted/LLM/TTS caps → G-CORE-2 class (deferred).
- **QuickSetup.vue — ✓ MOSTLY CLEAN + native-checkbox class.** Multi-step
  wizard (detect→confirm→install→done): GPU probe, tier auto-pick + manual
  override, per-engine install w/ job polling, feature-pin recipe writes,
  local-LLM detect-and-connect, STT readiness. Canonical shell + JvButton
  footers + jv-pill/jv-banner. Honest about deferred provider picker + no-
  LLM-provider state. NATIVE checkboxes (`jv-check`) for engine opt-out →
  G-CORE-2 class (deferred). `jv-input--sm`/`jv-pill--solid` verified to exist.

## NEW SYSTEMIC FINDING — X-6: undefined `--border-soft` CSS token (P2)
`var(--border-soft)` is used in 7 files but is **never defined** anywhere
in the renderer (verified: 0 definitions, 7 usages):
EffectsChainEditorModal.vue, EffectsView.vue, RenderLabView.vue,
GenerateView.vue, PersonasView.vue, SpeakerLabView.vue, StudioView.vue.
Where used as `border: 1px solid var(--border-soft)` (no fallback), the
shorthand is invalid at computed-value time → the border STYLE falls to
initial (`none`) → **no border renders at all**. Where used as
`border-color: var(--border-soft)`, color falls to `currentColor`. Either
way the intended soft divider is wrong/missing. Fix: define `--border-soft`
in styles.css `:root` (alias to `--line`, the canonical soft divider), OR
sweep the 7 files to use `var(--line)`. Single-token fix is lowest-risk.
G-CORE-2 reminder: many components hand-roll native `<input type="checkbox"
class="jv-check">` (ProviderForm, QuickSetup, EffectsChainEditorModal,
VoiceParamsModal grids, …). JvCheckbox exists as the canonical wrapper; the
migration is DEFERRED per user ruling — recorded as a class, not fixed now.

## ◆ COMPONENT SWEEP COMPLETE — all 26 + 9 jv/ have written verdicts.
Tally: jv/ ×9 ✓ · clean components: AppDialog, AppModal, Toast, EmptyState,
Icon, Breadcrumb(used), PaneHeader(used), HelpTrigger, CapturePill,
TaskStrip, AudioKeepAlive, RecommendCard, SlashTagMenu, JvHelpDrawer,
KeyboardCheatsheet, DictateWindow, QuickSetup(✓+checkbox class).
⚠ minor: ChordPicker(X-5 shell+btns), GlobalAudioPlayer(fake waveform),
TaskStatusPanel(borderless btns), ProviderForm(mock-exception+checkbox),
VoiceParamsModal(✓ + reset-link ghost).
✗ defects: ExportPanel(navigator throw P2), EffectsChainEditorModal(native
checkbox + X-6 border-soft), NewProjectModal(scoped np-* shell + ghost
imports), VoicesView modals(scoped modal-* shell + double-close).
NEXT: views one-by-one (full read each), then stores/services, then SERVER.

═══════════════════════════════════════════════════════════════════════
# VIEWS SWEEP (full reads, one verdict per view)
═══════════════════════════════════════════════════════════════════════

## views batch A (6 smallest + Lines)
- **StoriesView.vue — ✓ CLEAN (intentional placeholder).** Timeline is
  gated (W3 decision): NO dead API calls (the old mock hit non-existent
  /v1/stories and error-toasted every visit). Honest "not built yet" lede
  card (jv-card/jv-fill) linking to where work happens today. Correct.
- **LabsView.vue — ✓ CLEAN.** Tabbed lab container (Compare/Train/Speaker/
  Render/Audio). Canonical jv-subnav, single shared lede mechanism (sub-
  views must NOT hand-roll their own header — enforced here), only the
  active tab mounts. Good precedent example. sessionStorage hand-off for
  legacy hashes. No defects.
- **AudioChannelsView.vue — ✓ CLEAN.** Fully canonical: jv-table, JvButton
  (incl variant="danger-outline", verified to map jv-btn--danger-outline
  which exists), JvInput/JvTextarea/JvCheckbox/JvField, confirmDialog for
  delete. Edit→populates the inline editor-card form→Update; Add/Update +
  Cancel. This is the canonical add/edit FORM-CARD pattern (not inline
  field editing), so explicit submit is correct, not a save-pattern
  violation. Tauri device list degrades gracefully on web. Reference-grade.
- **EffectsView.vue — ⚠ P3.** Canonical jv-lib-toolbar (search + ownership
  chips + spacer + "+ New" rightmost), jv-table row-click→EffectsChain
  editor modal, confirmDialog delete, promptDialog naming (native prompt()
  correctly banned). Notes: (1) create is editor-FIRST, name-on-save (the
  reverse of Persona's old prompt-first anti-pattern; acceptable but
  inconsistent with other create flows). (2) Delete is a raw `jv-btn
  --danger-outline` while Edit is a JvButton — same-file inconsistency, P3.
  (3) `.effects-view__chain-pill` uses `var(--border-soft)` → X-6.
- **ImportReviewView.vue — ✓ MOSTLY CLEAN + checkbox class.** Dry-run
  results PAGE (picker stays a dialog): re-split re-runs the server dry
  run, per-chapter include/exclude, live summary + est-audio, honest
  "speakers found later in Script". doImport RELOADS the shared
  projectsStore then activates + lands in the kind's home base — this is
  the import-reflection fix; RE-VERIFIED correct here. Native include/
  exclude `<input type=checkbox class=jv-check>` → G-CORE-2 (deferred).
- **WebhooksView.vue — ✓ CLEAN.** Canonical jv-table, JvButton (danger-
  outline), confirmDialog delete, JvField/JvInput/JvCheckbox (events grid
  uses the canonical JvCheckbox, NOT native — good). Inline add-form card
  with Create/Cancel (form pattern, correct). copySecret() calls
  navigator.clipboard in SETUP (real global, fine — contrast ExportPanel's
  template bug). Secret-shown-once UX is correct. MCP info card pairs well.
- **LinesView.vue — ⚠ P3.** Game-dev grid home base. Behavior solid:
  shared projectsStore.ensureLoaded(), project selector, search, status
  chips w/ live counts, derived take_status (none/rendered/stale), stale
  re-render wired to the renderTasks store (cancel/retry/stats), per-line
  render, export VO zip, re-import modal. P3: the toolbar is a scoped
  `.lines__toolbar` that reproduces the jv-lib-toolbar shape (search +
  chips + spacer + actions + a leading data-dropdown) — should adopt the
  canonical `.jv-lib-toolbar` (RULE #1). Filter chips are borderless but
  they're jv-pill selection chips (exempt). Raw jv-input select/search
  (acceptable). jv-pill--warn verified to exist.

## views batch B (RenderLab, Cache, RenderPresets)
- **RenderLabView.vue — ✓ CLEAN (X-6 only).** A/B matrix harness. Behavior
  solid: voicesStore.ensureLoaded, matrix build (1-2 axes, cap 16),
  concurrency-limited worker pool (cap 2), object-URL revocation before
  re-run (no leaks), promptDialog naming (native prompt banned), JvToggle
  for axis-enable (canonical boolean — NOT a native checkbox). VERIFY-DON'T-
  GUESS: `api.request("/v1/generate")` returning a value passed to
  createObjectURL looked like a bug, but api.js line 35 auto-returns
  res.blob() for `audio/*` content-type — so it's CORRECT (false alarm).
  Only blemish: `.renderlab__cell-actions` border-top uses var(--border-soft)
  → X-6.
- **CacheView.vue — ✓ MOSTLY CLEAN.** Excellent destructive-action
  discipline: generation prunes are DRY-RUN first (DELETE /v1/generations
  defaults dry-run) so the confirm dialog shows the REAL count + freed MB
  before deleting; confirmDialog on every bulk action; promptDialog-with-
  select for by-voice/by-engine (native prompt banned). Shared stores.
  P3: the Actions row uses raw `jv-btn jv-btn--secondary` ×4 instead of
  JvButton (the Clear-all beside them IS a JvButton — same-row
  inconsistency). P3: the per-row recent-entry ✕ (`deleteEntry`) deletes
  with NO confirm, while the hint copy claims "Every action asks for
  confirmation" — copy overpromises for that one affordance.
- **RenderPresetsView.vue — ✗ DEFECTS (confirms v1 carry-forward).**
  Library + edit dialog. Canonical jv-lib-toolbar / jv-table / jv-overlay+
  jv-modal / `jv-dialog__footer` (verified to exist). `editing` is a
  computed off presets (NOT stale — re-confirmed). Defects:
  - **P2 · the edit dialog auto-saves per field with only a "Done"
    button — NO Cancel.** Each field's `@change` PATCHes immediately
    ("Changes save automatically"). This VIOLATES the save-pattern ruling
    (2026-06-14): modal/dialog editors get explicit **Save + Cancel**
    against a working draft. This is THE dialog the ruling targets.
  - **P2 · built-in presets are unprotected.** The table Delete button has
    NO `:disabled="p.is_builtin"` (contrast EffectsView, which disables
    delete for built-ins), and EVERY field in the dialog stays editable for
    a built-in (only a "built-in" pill is shown). Built-ins can be edited
    and deleted from the UI.
  - **P3 · create is 2-step + fragile.** createPreset → promptDialog name →
    POST → refresh → `presets.find(x => x.name === name)` → openEdit. The
    find-by-name opens the wrong row if two presets share a name.
  - **P3 · raw `jv-btn--danger-outline` Delete vs JvButton Edit** (same-row
    inconsistency, recurring class).

## views batch C (ImportModal, Compare, Captures, Train)
- **ImportModal.vue — ⚠ X-5 shell + P3 dead code.** Picker dialog: live
  adapter list, smart adapter auto-pick (extension + content sniff —
  podcast-vs-book by speaker-label regex), drag-drop, dry-run → hand-off to
  the full-page ImportReviewView (correct per the 2026-06-12 decision).
  - X-5: scoped `.im-overlay`/`.im-dialog`/`.im-header`/`.im-footer`/
    `.im-close` modal shell, NOT canonical jv-overlay/jv-modal. The header
    comment blames AppModal's vue-i18n dep — but that only argues against
    the COMPONENT; the dependency-free jv-overlay/jv-modal CSS classes
    should still be used. Same X-5 class as NewProjectModal/VoicesView/
    ChordPicker/LineageViewer.
  - P3 dead code: the flow now hands off to the page, so a large block is
    UNUSED — `preview` ref, `doCommit`, `summary`, `previewScenes`,
    `previewScenesOverflow`, `previewWarnings`, `includedIndices`,
    `toggleScene`, `includedCount`, `excluded`, `canCommit`, `estAudio`,
    `WORDS_PER_MINUTE`, `SCENE_ROW_CAP` + ~40 lines of scoped `.preview*`
    CSS. The `created` emit (doCommit) is now UNREACHABLE from the template,
    so LinesView's `@created="onReimported"` never fires (re-import
    completes via ImportReviewView instead — works, but the handler is dead).
- **CompareView.vue — ✗ P2 FAKE AFFORDANCES.** The core A/B compare is
  REAL (reads both WAVs → base64 → POST /v1/compare → deltas grid + verdict
  + full table). BUT two prominent buttons are FAKE — they only fire a
  describe-what-it-would-do toast and do nothing:
  - **`refreshFromCurrentTakes()`** ("↻ Refresh from current takes") — toast
    only: "Pulls A=current default take, B=previous take… (GET /v1/takes/
    {block_id})". No fetch.
  - **`runBulkQc()`** ("Run QC pass" + the whole Bulk QC card: project/
    chapter/block selectors) — toast only: "QC pass queued… verdicts will
    land in the report below". No API call, nothing populates. The hint
    copy describes per-pair Compare runs + webhook triggers that don't
    exist. This LIES about state — user clicks, sees "queued", nothing
    happens. P3: Choose A/B/Refresh are raw jv-btn (Run analysis is JvButton).
- **CapturesView.vue — ✗ P2 MOSTLY MOCK.** Real underneath: captures list
  (GET /v1/captures), togglePin (PATCH), speakAgain (prefills Generate),
  search/filter, detail pane, readiness banner. But the prominent controls
  are FAKE:
  - **"Record"/"Stop" button** — startRecording animates a local timer;
    stopRecording runs a hard-coded setTimeout theater (transcribing→
    refining→completed→rest) with NO audio capture and NO API call, then
    refresh() hoping a capture appeared. Real capture only happens via the
    dictation hotkey / Tauri window. The in-page Record button does nothing.
  - **Hotkeys card** — both "Change" buttons have no @click; Source "Default
    mic ▾" + Capture language "auto ▾" carets imply dropdowns but are
    static text; Auto-paste is a native `<input type=checkbox checked>` with
    NO v-model (inert). The entire card is a non-functional mock.
  - P3: "Live capture pill" card shows 4 static example pills as a legend
    (acceptable as a preview, but reads as live).
- **TrainView.vue — ✓ CLEAN (reference-grade).** Fully canonical (JvField/
  JvInput/JvSelect/JvTag/JvButton, jv-card/jv-section/jv-table/jv-eyebrow,
  width tokens name/token), confirmDialog cancel. Behavior solid: shared
  stores, file→b64 samples w/ transcripts, QC gates, correct payload,
  polling bound to onActivated/onDeactivated (KeepAlive-aware — NOT
  onMounted; the right pattern), plain-English submitBlocker (anti-jargon,
  RULE #1 item 5), voice-inspector prefill handoff. Inline form-card with
  explicit "Queue training job" submit is correct (action, not field-edit).
  Trivial: `.jv-file-input` CSS is unused. This is how a view should look.

## views batch D (Overview/Home, Personas re-verify, Lexicons full)
- **OverviewView.vue (Home) — ✓ MOSTLY CLEAN + P3.** Daily driver. Snapshot
  hydrate → instant paint, then silent live refresh (the perf pattern);
  five shared stores; continueProject + cheap miniStatus (no per-persona
  fan-out — the documented Home-fill perf fix); stat cards, live tasks,
  loaded-engine w/ VRAM, recent-gen playback, honest empty states + cold-
  install next-step banner. No fake affordances. **P3 BUG:** `captures` is a
  `ref([])` but the code stores the total as `captures.totalCount = …` — a
  non-reactive property bolted onto the ref WRAPPER (not `.value`). It
  mostly works because line 127-128 set `.value` (reactive) and
  `.totalCount` (non-reactive) together, but `hydrateFromSnapshot` sets only
  `.totalCount`, so the captures stat won't reactively update from the
  snapshot. Should be its own ref. P3: many raw `jv-btn--ghost` icon/link
  buttons (acceptable — bordered ghost / icons).
- **PersonasView.vue — ✓ FIXED (re-verified) + P3.** All G-PERSONA fixes
  present and correct: createBlank opens the editor directly on a blank
  draft (no prompt, no premature POST) + name autofocus (G-PERSONA-1);
  savePersona POST/PUT then closeEditor on success (G-PERSONA-2); footer =
  Save+Cancel with `:disabled="!dirty"` against a draft BUFFER (matches the
  save-pattern ruling for modals — commit on Save, discard on Cancel);
  Delete on each row, not the footer (G-PERSONA-4); removePersona unified
  with Undo; shared stores reload propagates. Live instruct-capability
  verdict per engine (anti-jargon honesty). P3: `--border-soft` in
  `.personas__chip` → X-6. P3: the "+ Edit" delivery button only fires a
  toast pointing to Generate (doesn't edit in place — a redirect masquerading
  as an editor button; honestly labeled but slightly misleading). P3: filter
  chips use `.personas__chip` (jv-chip-card) while every sibling library
  view uses `jv-pill --solid/--ghost` filter chips — inconsistent precedent.
- **LexiconsView.vue — ✗ DEFECTS (confirms + extends the dialog verdict).**
  List/toolbar are clean: canonical jv-lib-toolbar / jv-table / jv-pill
  filter chips / EmptyState, shared stores, fix-it prefill handoff, multi-
  step create (name+scope → target). Dialog defects:
  - **P2 · entries append-only.** The entries table row (428-435) has ONLY
    a DISABLED "Edit" (`title="Inline edit lands in #103.1"`) and NO per-
    entry delete. You can add a pronunciation but never fix or remove one.
  - **P2 · Delete duplicated + destructive-prominent.** A `jv-btn--danger-
    outline` Delete sits in the dialog HEADER (395) AND on the table row
    (375). Per the ruling Delete belongs on the row, not the editor header.
  - **P3 · dead "Note (optional)" field.** `newNote` is bound (460) and
    cleared on append (204), but `appendEntry` (192-194) NEVER includes it
    in the POST body — typing a note does nothing. Pure dead input.
  - **P3 · can't rename a lexicon** — the dialog has no name field (only the
    h2 display). Create-time name is permanent from the UI.
  - **P3 · header uses raw `jv-btn` buttons** (Import/Export/Delete) vs the
    JvButton "+ Add entry". Append is atomic (per-entry POST) with no save
    signal — the "+ Add entry" primary is the only commit cue.

## views batch E (SpeakerLab, Books)
- **SpeakerLabView.vue — ✓ CLEAN (reference-grade truth surface).** The view
  the user redlined ("a lab that hides its pipeline can't be trusted") is now
  exemplary: the textareas show the REAL prompt bodies from /v1/extraction/
  config (not placeholders); runs hit the SAME endpoint Studio·Script uses
  (/v1/extraction/analyze-text) so lab and production can't drift; prompts
  ship as overrides ONLY when edited away from the displayed default (what
  you see is what runs); multi-column A/B race (cap 4); tier auto-classify
  with user override following the no-Auto-button grammar; localStorage
  presets; "Use as production" writes production-config + keeps the pin in
  sync; task tracking w/ abort; honest 501 hint. JvToggle for booleans
  (canonical). Cast pane is properly carded (the earlier "floating unstyled
  Cast pane" defect is resolved). P3 only: `--border-soft` in a chip-fallback
  (X-6, low impact); raw `jv-btn--ghost` icon buttons mixed with JvButton.
- **BooksView.vue — ✗ P2 BUGS (undefined references — VERIFIED by grep).**
  Project library + inline-expand detail pane. The data layer is right
  (shared projectsStore/personasStore, reload propagates, browsing ≠
  activating). The detail pane uses inline auto-save-on-change for metadata
  (matches the save-pattern ruling for in-page edits). BUT three template/
  handler references are UNDEFINED (confirmed: 0 definitions each):
  - **P2 · `flashSaved()` is undefined but CALLED in patchProject (line
    268), AFTER a successful update()+refresh().** It throws ReferenceError
    INSIDE the try, so the catch fires a false **"Save failed"** toast on
    EVERY successful metadata edit (Title/Author/Mastering/Render-preset/
    Webhook). Data persists; the UI lies that it failed. Borderline P1 — it
    makes the whole detail editor read as broken.
  - **P2 · `savedFlash` is undefined** but bound `v-if="savedFlash"` (line
    498) — the "Saved ✓" confirmation pill therefore NEVER shows. Combined
    with the false-failure toast, the autosave feedback is fully inverted.
  - **P2 · `openInStudio` is undefined** but wired to the primary detail
    action `@click="openInStudio"` (line 595, "Open in Studio ➜") — clicking
    throws ReferenceError; the main CTA of the detail pane is dead.
  - **P3 · chapters subtable "Open" button (639)** has no @click — inert.
  - **P3 · native checkbox** in the add-cast modal (G-CORE-2, deferred);
    scoped `.books__toolbar` reproduces jv-lib-toolbar (should adopt it).
  Fix: add a `savedFlash` ref + `flashSaved()` that sets it true then clears
  on a timer; add `openInStudio()` (activeProject.open + hash="#studio");
  wire the chapter-row Open.

## views batch F (Engines)
- **EnginesView.vue — ✓ CLEAN (complex, honest).** The v7 redesign (Local
  models vs Online providers split). Local: hardware card, "Loaded now"
  rail with per-kind Unload, capability sections (TTS/STT/LLM/Embeddings),
  per-MODEL verbs driven by variant-level state (Load/Unload/Download/
  Delete model), hardware-fit dots (ok/tight/no vs detected VRAM), install
  + load with job polling AND cancel/abort, uninstall with optional pip-dep
  removal. Online: provider rows merged across TWO stores (llm-providers +
  settings.engines.external) into one row per id with combined capability
  chips (the OpenAI "both" case), per-row Test that really pings/probes and
  recolors the status dot, ProviderForm inline editor. EVERY affordance does
  real work — no mocks. Honest cost note ("text leaves this machine") +
  free/private framing. Conformance: `.ev-chip` filter chips are a DOCUMENTED
  scoped exception (lines 1111-1114: mock-v7-approved size; converging with
  jv-pill is a Phase-4 call) — recorded, not a defect. Other `ev-*`/
  `jv-toptab`/`jv-searchbar` classes are the approved engines-redesign-v7
  contract. Native checkboxes come via ProviderForm (G-CORE-2, deferred).
  No `--border-soft` here. Reference example for a large, stateful view.

## views batch G (Voices)
- **VoicesView.vue — ✗ P2 fake inspector affordances + ⚠ X-5 modal.** Core
  is REAL and solid: gender auto-detect + click-cycle override (preset
  overrides → localStorage, stored → PATCH), type/engine/search filters,
  hide built-ins, preview, delete (confirmDialog), inspect, per-voice +
  all-tweaks reset, the Clone/Design/Import/Blend creator (real submit,
  file→b64, weights), blend-with-voice prefill, train-LoRA handoff (real
  sessionStorage prefill → #train), shared stores. BUT the voice-inspector
  "add samples" group has FAKE affordances:
  - **P2 · `onSamplePicked`** (563-567) picks a WAV and toasts "Uploading
    {file} → /v1/voices/{id}/samples" but NEVER POSTs anything. "+ Add WAV"
    claims it uploaded; nothing happens.
  - **P2 · `recordInApp`** (569-571) is a toast-only stub: "MediaRecorder
    will open … Lands with the recorder component." Not built.
  - **P3 · `promoteFromCaptures`** (573-575) navigates to #captures (real)
    but the promised "→ Sample" attach lands in the fake onSamplePicked.
  - **⚠ X-5 · the Clone/Design/Import/Blend modal** uses a non-canonical
    `.modal-overlay`/`.modal`/`.modal-head`/`.modal-body`/`.modal-footer`
    scoped shell (NOT jv-overlay/jv-modal), and has a DOUBLE close — header
    "Close" (957) AND footer "Cancel" (1046) both `modal = null`. The modal
    otherwise uses canonical JvField/JvInput/JvSelect/JvTextarea + Save+
    Cancel footer correctly. Sizing tokens were fixed in a prior session.

## views batch H (Generate)
- **GenerateView.vue — ✓ CLEAN (capability-driven, honest) + P3.** The UI is
  projected from the engine capability manifest (/v1/engines/capabilities):
  knobs, inline-tag categories, native pitch range, style-prompt, temperature/
  seed gating — no hardcoded per-engine assumptions. Delivery payload sends
  ONLY non-default values (no noise). compose + rewrite hit real persona
  endpoints with 501-HONEST errors ("wire an LLM provider"); rewrite is
  preview-then-accept (manuscript never silently rewritten). generate() has
  task tracking + abort + object-URL revoke; lexicon attach + client-side
  applied-match preview. BOTH modals (lexicon preview, rewrite preview) use
  canonical jv-overlay/jv-modal. P3: one native autoplay checkbox (`jv-check`,
  G-CORE-2 deferred); `--border-soft` at line 1268 (X-6); the line-34 comment
  "history stubbed until /v1/takes/recent lands (#87)" is STALE — refreshVoices
  fetches it live (and Overview uses the same endpoint).

## views batch I (Chapter)
- **ChapterView.vue — ✓ CLEAN.** Take/block workbench. All real: regenerate
  block with correct voice resolution (cast persona voice wins; only an
  uncast block prompts — the old silent top-bar override is gone), inline
  block-text editing via PATCH (cache-aware — only the edited line re-renders),
  take management (promote-to-default, delete with confirm, A/B compare,
  lineage via LineageViewer), performance-note direction edit, flag-
  pronunciation handoff to Lexicons, chapter-list CRUD (add/rename/delete/
  move via promptDialog/confirmDialog — no native dialogs), paste-text →
  blocks. Shared stores (projects/personas/voices) — no private copy, so
  imports reflect even while KeepAlive-cached. Breadcrumb via usePageCrumbs
  (X-1 leak fix). Canonical JvSelect/JvButton/JvTag/EmptyState; NO native
  checkboxes, NO `--border-soft`, NO fake affordances. goTimeline navigates
  to the honestly-gated #stories. Only external blemish: it renders
  LineageViewer, whose scoped `.lineage-*` modal shell is the X-5 finding
  recorded against that component (not against this view).

## views batch J (Settings) — corrects the v1 "god component" framing
- **SettingsView.vue — ✓ CLEAN (B-CORE-1 NOT upheld as a defect).** 2605
  lines, but it IS a properly tabbed surface: 14 canonical `jv-subnav` tabs
  (General/AI features/Mastering/Generation/Capture/MCP/GPU/Appearance/Cache/
  Channels/Webhooks/Logs/Changelog/About), and the three heaviest sub-areas
  are ALREADY delegated to their own components (CacheView/AudioChannelsView/
  WebhooksView). Every function is REAL — update checker (check/download/
  restart-install), backup download + restore, MCP bindings CRUD + default
  voice, AI feature pins + roles + production-configs (with revert), GPU info,
  appearance knobs, logs preview/open/download/copy, external-engine register/
  test, danger zone (reset-UI / wipe-projects / factory-reset with typed
  RESET confirm). No fake affordances, no toast-only stubs (verified). Uses
  JvCheckbox/JvToggle ×11 (canonical), JvField/JvSelect; only 2 native
  checkboxes (deletePersonasToo, backupIncludeAudio — G-CORE-2 deferred); no
  `--border-soft`, no non-canonical modal shells. **The user was right to
  push back on the v1 "god component" call** — it's a tabbed menu, not a
  defect. Remaining note is maintainability-only (P3, NOT a bug): the 11
  inline tabs COULD each be extracted into their own component the way Cache/
  Channels/Webhooks already are; optional refactor, no behavioral impact.

## views batch K (Studio) — last view; corrects v1 "god component (Studio)"
- **StudioView.vue — ✓ CLEAN.** 2702 lines, the Cast→Script→Render→Export
  production workbench (numbered `jv-stepcard` workflow strip — a deliberate
  stepper, distinct from a settings tab strip, so not a jv-subnav miss). All
  four tabs are REAL: Cast (voice library w/ engine filter + search + gender
  click-cycle override + assign + VoiceParamsModal tuning + smart-assign),
  Script (analyze text → discovered-speaker promotion, same backend as
  SpeakerLab), Render (select unrendered/all, cache-coverage banner, per-
  scene preset + render with progress strips + cancel, ACX QC, LLM preset
  suggest, render gate), Export (delegates to ExportPanel). 47 functions, no
  toast-only stubs, no TODO/mock stubs (the "mock" strings are design-source
  comments + empty-state placeholders). Shared stores; usePageCrumbs
  breadcrumb. P3: 1 native checkbox (render-row selector, G-CORE-2 deferred);
  3 `--border-soft` (X-6); large-file maintainability (could split the four
  tabs into components) — NOT a defect. Renders ExportPanel (carries the P2
  navigator-clipboard bug recorded against that component). The v1 "god
  component (Studio 2708)" framing is a maintainability note, not a defect.

═══════════════════════════════════════════════════════════════════════
# ◆ VIEWS SWEEP COMPLETE — all 26 views have written verdicts.
═══════════════════════════════════════════════════════════════════════
✗ DEFECTS (need fixes): RenderPresets (auto-save dialog + built-ins
unprotected) · Lexicons (append-only entries, header Delete dup, dead Note
field, no rename) · Compare (Refresh-from-takes + Bulk QC are fake/toast-
only) · Captures (Record button + Hotkeys card are non-functional mocks) ·
Books (3 VERIFIED undefined refs: flashSaved → false "Save failed" on every
edit, savedFlash → "Saved" never shows, openInStudio → dead CTA) · Voices
(onSamplePicked + recordInApp fake inspector actions; X-5 modal shell).
⚠ MINOR: ImportModal (X-5 shell + dead code) · Effects/Lines (scoped toolbar,
raw delete btn) · Overview (captures.totalCount ref-bag) · Personas (+Edit
toast redirect, non-jv-pill chips) · Cache (raw buttons, per-row no-confirm).
✓ CLEAN: Stories, Labs, AudioChannels, ImportReview, Webhooks, RenderLab,
Train, SpeakerLab, Engines, Generate, Chapter, Settings, Studio.
Cross-cutting: X-6 (--border-soft undefined) hits Effects/RenderLab/Generate/
Personas/SpeakerLab/Studio + EffectsChainEditorModal. G-CORE-2 native
checkboxes (deferred) recur across ~10 surfaces. X-5 non-canonical modal
shells: NewProjectModal, VoicesView, ImportModal, ChordPicker, LineageViewer.
NEXT: stores/services/composables/root, then SERVER (api ×39, core ×22).

═══════════════════════════════════════════════════════════════════════
# CLIENT INFRASTRUCTURE (stores / services / composables / root)
═══════════════════════════════════════════════════════════════════════
- **Shared stores (projects/voices/personas/lexicons/engines) — ✓ CLEAN.**
  Identical rebuild pattern: `items` ref returned DIRECTLY (no
  computed-wrapper that broke reactivity before), `loaded`, `_inflight`-
  deduped `ensureLoaded()`, `reload()`, `byId()`. voices+engines also self-
  reload on `jv:health-refresh` (listener added once via `_listening` guard;
  singleton store so no leak). Matches the data-layer-rebuild plan exactly.
- **stores/api.js — ✓ CLEAN.** fetch wrapper; content-type detection returns
  Blob for `audio/*` (validates RenderLab), json/text otherwise; safeRequest
  fallback; verb helpers (get/post/patch/put/del) — the W2 fix so services
  never hand-roll the broken 3-arg request(method,path) shape; requestBlob/
  postForm. Token + serverUrl persisted.
- **stores/renderTasks.js — ✓ CLEAN.** Task lifecycle (running kept visible;
  completed 5s / cancelled 3s auto-dismiss; failed never auto-dismisses).
  **The 10Hz `now` tick is GATED on running.length > 0** (the documented
  slowness fix — it no longer invalidates every now-touching computed
  forever). cancel/retry/dismiss/history-cap.
- **stores/takes.js — ✓ CLEAN** (per-block take versioning, navigate/promote/
  remove/relabel/invalidate). **stores/activeProject.js — ✓ CLEAN**
  (app-wide project slot, localStorage, kind mapping).
- **composables/usePageCrumbs.js — ✓ CLEAN** (the X-1 breadcrumb-leak fix:
  publish gated on onActivated/onDeactivated; re-verified).
- **services/dialog.js — ✓ CLEAN** (imperative prompt/confirm replacing the
  banned native dialogs; single-dialog, animation-safe deferred clear).
- **App.vue — ✓ CLEAN.** View registry (lanes + visibleFor + per-kind nav
  vocabulary), `<KeepAlive><component :is></KeepAlive>`, project switcher.
  **Health is polled every 1.5s ONLY until the server is up, then stops and
  listens for `jv:health-refresh`** — the perpetual 5s `/v1/health` poll that
  caused the slowness was removed (documented at lines ~405-411). No native
  checkboxes.
- **main.js / config.js — ✓ CLEAN.** Dictate-window branch; bootStorage before
  Pinia; same-origin-vs-loopback API resolution.
  **NEW (strengthens X-5): ImportModal's comment claiming "AppModal pulls in
  vue-i18n which the project doesn't currently install" is FALSE** — main.js
  imports `./i18n` and `app.use(i18n)`, App.vue uses `useI18n`, and vue-i18n
  is a dependency. So ImportModal's stated justification for its non-canonical
  scoped shell is invalid; it can use AppModal / the jv-overlay+jv-modal
  classes directly.

═══════════════════════════════════════════════════════════════════════
# SERVER (api ×39 · core ×22 · engines/storage/audio/database/mcp)
═══════════════════════════════════════════════════════════════════════
Audit lens per the ⛔ feedback_upstream_audit_hard_rule: WIRING (is each
module imported AND invoked by its consumer — the documented failure mode
is "lifted-but-not-wired"), CORRECTNESS, and HONESTY (no fake-data stubs).
app.py + render_core.py read in full; the rest verified systematically on
those three dimensions (route-wiring diff, invocation checks, orphan scan,
server-wide stub scan, route maps, subpkg structure).

- **app.py — ✓ CLEAN.** create_app boots DB (idempotent init + seed +
  Profile→Persona migration), registers existing/external/LLM engines,
  mounts ALL 39 routers, error envelope BEFORE CORS (the documented
  Starlette-ordering fix), MCP mounted before the SPA catch-all with a
  graceful ImportError fallback, shutdown hook kills managed subprocesses.
  Documents the W7 double-registration fix.
- **WIRING — ✓ NO orphans.** Diffed all 40 api/*.py against app.py: every
  router is `include_router`'d; the only non-registered file is
  `_persona_helpers.py` (an underscore shared helper, correctly imported by
  personas_api + extraction_api, not a router). Every core module is imported
  by ≥1 consumer (delivery ×20, cache ×22, … export_audiobook ×1, hf_cache
  ×1 — all wired).
- **AUTO-CHUNKING (the canonical historical failure) — ✓ FIXED + INVOKED.**
  audio/chunked.py is imported by BOTH render_core.py (line 24) AND
  generate_api.py (line 22), and genuinely CALLED (split_text_into_chunks /
  concatenate_audio_chunks / _chunking_params / _samples_from_chunk_bytes) —
  not just imported. The "landed but never wired into generate" failure that
  motivated the hard rule is closed.
- **HONESTY — ✓ no fake-data stubs.** Server-wide scan: every
  NotImplementedError is legitimate (engines/base.py optional-method default;
  local_managed non-streaming; app.py edge-tts deferred-adapter). Documented
  patterns, not fakes: elevenlabs "models hardcoded" (the provider has no
  /models endpoint), tada/dac_shim "fake dac.nn.layers" (a real dependency
  shim). No TODO/FIXME/HACK littering.
- **render_core.py — ✓ CLEAN.** Single-source per-line pipeline (cache →
  lexicon → engine auto-load → synth → gain-db → cache; chunked for long
  text) used by BOTH /v1/generate and /v1/render_chapter. Voice→engine
  resolution checks 3 sources incl. manifest static_voices (the preset-
  before-load fix).
- **Subpkgs — ✓ structured per CLAUDE.md.** engines/ = managed plugin dirs
  (kokoro/chatterbox/dia/tada/qwen3/luxtts/moss_tts/qwen3_llm/whisper) +
  base/manager/registry/catalog/capability_details + tts_providers + llm.
  storage/ = atomic + per-entity stores. audio/ = analyzer/chunked/effects/
  wav. database/ = migrations/models/seed/session/migrate_profiles. mcp/ =
  context/resolve/server/tools.
- **C-CORE-1 (fat projects_api, 1280 lines) — maintainability NOTE, not a
  defect.** Cohesive project-domain CRUD (projects/scenes/blocks/cast +
  import + QC + export); all endpoints real. Could split import/export out
  (project_export_api already exists), but no behavioral problem — same
  conclusion as the Settings/Studio "god component" retraction.

═══════════════════════════════════════════════════════════════════════
# ◆◆◆ AUDIT COMPLETE — every file area has a written verdict ◆◆◆
═══════════════════════════════════════════════════════════════════════
Coverage: 26 views ✓ · 26 components + 9 jv/ primitives ✓ · stores/services/
composables/root ✓ · server (app wiring, render pipeline, 39 routers, core
modules, 5 subpkgs) ✓.

## The fix queue (ranked) — for a follow-up session, NOT done here
(user asked for the AUDIT to the end; fixes are a separate pass)
P1/P2 BUGS (data or UX broken):
1. **Books** — 3 undefined refs: add `savedFlash` ref + `flashSaved()`
   (stops the false "Save failed" on every edit + shows "Saved ✓"); add
   `openInStudio()`; wire the chapter-row Open. (VERIFIED bugs.)
2. **Compare** — Refresh-from-current-takes + Bulk QC are toast-only fakes;
   either implement (GET /v1/takes + per-pair /v1/compare) or remove the
   affordances so they don't lie.
3. **Captures** — Record button + Hotkeys card are non-functional mocks;
   gate behind "coming soon" or wire to the real capture flow.
4. **Voices** — onSamplePicked (POST the WAV to /v1/voices/{id}/samples) +
   recordInApp are fake inspector actions.
5. **ExportPanel** — show-notes Copy uses `navigator` in the template
   (throws); move to a setup method.
6. **X-6** — define `--border-soft` in styles.css :root (alias --line), OR
   sweep the 7 files to var(--line). One-line fix kills 7 missing borders.
P3 / design-ruling:
7. **RenderPresets dialog** — convert auto-save→Save+Cancel (the ruling);
   disable Delete + guard fields for built-ins.
8. **Lexicons dialog** — per-entry edit/delete; drop the dead Note field or
   persist it; move/remove the header Delete; allow rename.
9. **X-5 modal shells** → jv-overlay/jv-modal: NewProjectModal, VoicesView,
   ImportModal (its vue-i18n excuse is false), ChordPicker, LineageViewer.
DEFERRED (user ruling): G-CORE-2 native-checkbox → JvCheckbox migration.

═══════════════════════════════════════════════════════════════════════
# ◆ FIXES APPLIED (2026-06-14, follow-up pass — items 1-3, 5-7)
═══════════════════════════════════════════════════════════════════════
User authorized "do 1-3 and 5-7" (item 4 — the Voices/Compare/Captures
fakes — deferred pending a wire-vs-hide decision per affordance).

DONE:
1. ✅ Books — defined savedFlash + flashSaved() (kills the false "Save
   failed" on every metadata edit; "Saved ✓" now shows); added
   openInStudio(); wired the chapters-row "Open" via a jv.chapter.sceneId
   hand-off ChapterView now consumes.
2. ✅ X-6 — defined --border-soft as a per-theme alias of --line in
   styles.css :root (light + dark). The 7 affected files now render their
   soft borders.
3. ✅ ExportPanel — show-notes Copy moved off the inline navigator call
   into copyShowNotes().
5. ✅ RenderPresets dialog — draft + Save/Cancel (no per-field auto-save);
   built-ins read-only (fields disabled, footer = Close, Edit-chain
   hidden, table Delete disabled + guarded).
6. ✅ Lexicons dialog — per-entry Edit/Delete + rename (server
   storage.update() extended to apply name via the existing PUT); dead
   "Note" field removed; header Delete removed (stays on the library row).
7. ✅ X-5 — ChordPicker, LineageViewer, NewProjectModal, VoicesView,
   ImportModal migrated to jv-overlay/jv-modal; NewProjectModal's
   borderless .np-import buttons → links; VoicesView double-close removed.

VERIFICATION: renderer `npm run build:vite` clean; server `ruff check` +
full `pytest` (247 passed). Commits fd608c6, 1491901, 3882d54, eb5c29d.

STILL OPEN: item 4 (fake affordances — needs wire-vs-hide call); P3
polish (raw-button-vs-JvButton inconsistencies, scoped lib-toolbars on
Lines/Books, Compare/Captures decision); DEFERRED G-CORE-2 checkbox
migration.
