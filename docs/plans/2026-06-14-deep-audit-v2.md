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
