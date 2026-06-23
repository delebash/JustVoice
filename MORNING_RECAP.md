# Morning Recap — JustVoice

> The in-repo session-pickup doc. Reflects current code state, not history.
> Read this immediately after `CLAUDE.md`. If this file conflicts with a memory file, the memory file wins.

---

## ⮕ ACTIVE WORK — read first (2026-06-23)

**Thread: converge JustVoice's UI primitives onto the shared `@delebash/llm-ui`
kit — DONE (8 slices, all pushed to `claude/admiring-galileo-il3q0o`).** Root
cause of the old divergence: JV's markup/CSS was carried over from an HTML
*preview* mock (raw `.jv-*` utility classes) instead of being built
component-first like JustWrite. Every JV primitive now uses the shared `Ui*`
components; `src/renderer/src/components/ui/` is **empty** (every `Jv*` fork
deleted).

Slices (each verified: `build:vite` + headless `smoke.mjs` zero-JS-errors +
screenshot; committed separately): Button→UiButton · Input (component + 74 raw
`<input>`)→UiInput · Textarea→UiTextarea · Toggle→UiToggle · Field→UiField (+
global `.ui-field*`) · Checkbox→UiCheckbox · Tag/chip (146 `.jv-pill`)→**UiTag**
(status badges) + new **UiChip** (interactive selection chips; distinct from
UiSegmented) · Select (JvSelect + 36 raw `<select>`)→new **Reka-based UiSelect**
(JV was on native `<select>` despite shipping reka-ui — the drift the user caught;
both apps now use Reka selects). All `.jv-input/.jv-pill/.jv-btn/.jv-toggle/
.jv-field/.jv-check/.jv-w-*` CSS deleted; JV keeps only token aliases + a few
JV-local tweaks (`.ui-tag--violet`, untagged-input width cap, `--tag-radius/
--chip-radius = --r-pill`).

**New shared components in the kit** (`just-llm-runner/ui/src/common/`): `UiChip`
+ `UiSelect` (Reka headless Select — supersedes JwSelect *and* JvSelect; superset
API + string-or-object options + `width`). `UiInput`/`UiTextarea` now
`defineExpose({focus,select,el})`. `.ui-tag` radius is token-driven. **Vite
`resolve.dedupe` added to BOTH apps** (`vue`,`reka-ui`,…) so the aliased kit
resolves single instances (Reka provide/inject + Vue reactivity need one copy).
JW build + headless smoke verified green after the shared changes.

**Operating principle reinforced (user, 2026-06-23):** converge by default — ONE
shared component per job, used by both apps; an app not needing a feature is NOT a
reason to fork or "defer" a simpler/native variant. Applies to ANY reusable code
that works on a standard Vue app, **not just primitives**. (Strengthened in
`~/.claude/CLAUDE.md` PRIORITY #1 tells + RULE #7.)

**NEXT (open): the help system is the next convergence.** Verified:
`JvHelpDrawer.vue` is a copy-paste-with-adaptation of `JwHelpDrawer.vue` (its own
header says so); `HelpTrigger.vue` + `services/helpMarkdown.js` are identical bar
naming; only `services/helpDocs.js` (content) legitimately differs. Plan: extract
a shared, pluggable help module (drawer shell + trigger + markdown renderer + open
state) into the kit; each app plugs in its own help **content**. One stale
fork-reason already found: the "JV has no router" excuse is obsolete (JV uses
vue-router now).

> ⚠️ DOCS DEBT to clear in-step (do NOT defer again — the user flagged that I let
> this go stale): JV `CLAUDE.md` RULE #1 "canonical inventory" + design-conformance
> checklist still name dead classes/components (`jv-btn`, `jv-pill`, `JvToggle`,
> native-checkbox→JvToggle) — point them at the shared `Ui*` kit. JW `CLAUDE.md`
> still documents the `Jw*` layer as canonical; JW's own `Jw*`→`Ui*` migration is
> the eventual sibling task.

---

## ⮕ ACTIVE WORK (2026-06-21 — shared AI/LLM stack, still in progress)

**Current thread: the shared AI/LLM stack convergence.** Authoritative plan:
`docs/plans/2026-06-20-shared-ai-stack-plan.md` — 20 settled decisions + a
reconciliation section; **read it before any AI work and do NOT re-litigate it.**
Branch: `claude/admiring-galileo-il3q0o` (all repos). Goal: JustVoice and
JustWrite run the SAME AI stack — `just-llm-runner` (Python) + `@delebash/llm-ui`
(Vue) — differing ONLY in TTS (JV) and each app's feature catalog.

**Shared packages (done + pushed):**
- `just-llm-runner` is now two subpackages: `llm_runner/runner/` (the local
  llama.cpp runner) + `llm_runner/llm/` (cloud-provider + dispatch + prompt layer
  lifted from JV — adapters, registry, tiers, usage, dispatch, and `prompts.py` =
  FeaturePromptRow + PromptStore Protocol + render + `make_prompt_router`/
  `make_feature_router`). Public API (`from llm_runner import router, …`) unchanged.
- `@delebash/llm-ui` (`just-llm-runner/ui/`, repo root) is **plain JS — no TS**:
  own origin-aware `client.js`, token-driven `lu-*` `styles.css`, `Lu*` primitives,
  and the first shared view `PromptLab.vue`. The old `ProviderBackend` adapter is
  deleted (the UI calls the same endpoints both apps mount). Vite alias
  `@delebash/llm-ui → ../just-llm-runner/ui/src` in both apps.
- Feature prompts are **DB-seeded + Lab-editable** (no hardcoded prompt text),
  served by the shared `/v1/ai/prompts` + `/v1/ai/run` + `/v1/ai/stream`. JV and
  JW both adopted it; their per-app duplicates were deleted (the Keystone =
  shared impl behind a host store adapter).

**JustWrite is the current focus app** (build the shared GUI in service of JW
first; JV adopts the identical result after). The A–F plan:
- A ✅ shared prompt subsystem → `llm_runner`. B ✅ JW server adopts it.
- C 🔄 shared `@delebash/llm-ui`: **PromptLab done + screenshot-verified in JW**;
  still to build — provider form (from JW's `SettingsProviderForm`), model picker,
  provider list, Features routing, Usage view.
- D ⬜ shared top-level "AI / Models" menu area (Decision 2). E ⬜ JW streaming
  features → `/v1/ai/stream`, then delete the old `/v1/llm/...` gateway.

**JustVoice's own state:** fully on the shared backend (no shims); it will adopt
the shared `@delebash/llm-ui` views after JW proves them, then layer TTS (the one
JV-only difference) on the same framework. **Still HARDWARE-GATED** (build/verify
on the user's GPU): the built-in runner's P1.5b auto-spawn + P1.6 benchmark +
working-config cache.

**Storage rewrite — DONE, both apps** (2026-06-18/19): JW fully off
kv/IndexedDB/localStorage; JV renderer prefs → `/v1/prefs`, `settings.json` →
SQLite `settings` row. Detail: JW `docs/plans/2026-06-18-unified-storage-no-idb.md`,
JV `docs/plans/2026-06-19-jv-prefs-to-sql.md`.

---

## History

Older dated session logs (2026-06-16 and earlier — the engines / storage / QC /
audit work that predates the shared-AI-stack effort) used to live here as a long
append-log. They are preserved in **git history** (this file's prior revisions);
the live state is the ACTIVE WORK block above + `docs/plans/` (authoritative:
`docs/plans/2026-06-20-shared-ai-stack-plan.md`). This recap is the MAP, not the
archive — keep it that way.
