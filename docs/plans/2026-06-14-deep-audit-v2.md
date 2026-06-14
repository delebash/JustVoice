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
