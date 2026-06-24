# Morning Recap — JustVoice

> The in-repo session-pickup doc. Reflects current code state, not history.
> Read this immediately after `CLAUDE.md`. If this file conflicts with a memory file, the memory file wins.

---

## ⮕ ACTIVE WORK — read first (2026-06-24)

**Thread: FULL cross-app convergence — server + GUI (user greenlit Option A,
2026-06-24).** Master plan: `docs/plans/2026-06-24-full-convergence-plan.md`
(grounded two-sided audit + the target: each app = shared packages + domain code
only). Goal: JV and JW are the SAME code except necessary domain functionality.
Branch `claude/admiring-galileo-il3q0o` (all repos). No defer-hatches; both apps
become consumers of every shared piece; verify each (build+smoke / pytest).
Key proof from the audit: server `set_state` byte-identical; JW `database.py`
says "Mirrors JustVoice's session bootstrap"; JW HTTP scattered across ~17
hand-rolled `fetch` files; only `llm_runner` shared on the server today.

**Progress (Layer A — renderer kit):**
- ✅ **serverApi — BOTH apps done.** Shared kit transport
  (`common/services/serverApi.js`: resolver factory + `configureServerApi` +
  full transport + `checkServer`). JV: config/main/store wired, `serverApi.js`+
  `connection.js`+hand-rolled `prefs.js` fetch gone. JW: resolver-only config +
  `configureServerApi`, `connection.js` deleted, **12 scattered-fetch services
  repointed** to the kit (aiFeature stays raw — SSE streaming). Both verified:
  JV smoke 14/14, JW headless smoke 25/25, live data through the kit. The
  "~17 scattered JW fetch files" duplication is gone.
- ✅ **appearance engine — BOTH apps done.** Shared kit engine
  (`common/services/appearance.js`: `applyAppearance(cfg,{extraApply})` + generic
  catalogs). JW slimmed to re-export + editor `extraApply` (pixel-identical).
  JV adopted it (user OK'd Option A): `tokens.css` hue-driven (default hues =
  JV's measured palette → exact light/dark look, Inter + JetBrains mono kept),
  removed JV's duplicate local appearance system + rewired Settings to
  `ui.appearance`, dead density→live `uiScale`, `main.js` boot-applies. Accent
  knob now live. Verified both apps (smoke + screenshots, light+dark).
- ✅ **modal system + AppDialog — JV done; kit shipped.** Kit
  `common/components/AppModal.vue` (Slice A) is the ONE modal shell both apps use.
  ALL JV hand-rolled `.jv-overlay`/`.jv-modal` modals migrated to it (StudioView,
  GenerateView were the last two); `.jv-overlay`/`.jv-modal*` + the dead
  `.jv-dialog*`/`.jv-help-drawer*` globals + 4 orphaned `@keyframes` removed from
  `styles.css`. New shared `common/components/AppDialog.vue` (prompt/confirm host)
  built **on** the kit AppModal + the already-shared `dialog.js`, with
  `configureDialog({labels})` + reactive `dialogLabels` (kit stays i18n-agnostic;
  English defaults = JW's en.json). JV `App.vue` imports the kit `AppDialog`; JV's
  local one deleted. Verified: build clean, smoke 14/14, dialog/modal interaction
  test (open/autofocus/close-animation) + screenshots, zero JS exceptions.
- ✅ **AppDialog — BOTH apps done.** JW's 16 `services/dialog.js` callsites
  repointed to the kit; JW local `dialog.js` + `AppDialog.vue` deleted; `App.vue`
  imports the kit `AppDialog`; `configureDialog({labels})` wired in JW main.js
  from en.json; dead `.app-modal*`/`.app-dialog` CSS removed (kept `.modal-title`
  + the older `.modal*` system — still used). Verified: build clean, headless
  smoke 27/27, interaction test (prompt + confirm, JW Fine Press theming),
  screenshots, zero JS exceptions. **Both apps now share ONE modal shell + ONE
  prompt/confirm host.**
- ✅ **JW shells — ALL converged to the kit.** `Breadcrumb` (12), `EmptyState`
  (9), `tooltip` directive, `Toast`+`toastBridge`, `ConnectionError` (props), and
  the entire help system (`HelpDrawer`/`HelpTrigger`/help-state via
  `configureHelp({loadDoc,hasDoc,titleForSlug,onOpenFull,onOpenWeb})` + a kit
  empty-state "Browse all docs"). Deleted the JW forks + `services/tooltip.js`,
  `toastBridge.js`, `helpMarkdown.js`, `JwHelpDrawer.vue`, `HelpTrigger.vue`, and
  the ui-store help state. **Font-token gap found + fixed**: kit shells read the
  semantic `--font-display`/`--font-body`; both apps now map them in tokens.css
  (JW→serif Fraunces headings, JV→Inter), kit `styles.css` documents the
  contract. Verified both apps: builds, smoke (JV 14/14, JW 27/27), interaction
  tests (dialogs + help drawer) + screenshots + computed-style checks, zero JS
  exceptions.
- ✅ **JW primitives — ALL converged.** `JwSelect`→`UiSelect` (13);
  `JwNumber`→`UiNumber` (2, promoted UiNumber + a kit `setUiLocale` i18n-agnostic
  locale source); `JwTable`→`UiTable` (11, promoted UiTable + `@tanstack/vue-table`
  peer dep + `resolve.dedupe` in both apps, JV installed it for its future table
  convergence); `JwColorPicker`→`UiColorPicker` (3, promoted with a `presets`
  prop, JW passes its palette). **`components/ui/` is now EMPTY in BOTH apps.**
  Each verified: build + smoke 27/27 + interaction/visual checks + screenshots.
- ✅ **LAYER A (renderer kit) COMPLETE.** Both apps now share ONE kit
  (`@delebash/llm-ui`) for primitives, shells (modal/dialog/help/toast/tooltip/
  breadcrumb/empty/connection-error), services (serverApi/appearance/help/
  dialog/locale), and theming. No renderer forks remain.
- ✅ **Layer B audit DONE (file-by-file).** Read both apps' app.py/cli.py/
  paths.py/app_state.py/database — full per-unit shared/diverge table in the plan
  (`docs/plans/2026-06-24-full-convergence-plan.md` §Layer B). Finding: the server
  is legitimately less uniform than the renderer. **Share** `init_db`+`get_db`
  (JW's literally "mirrors JustVoice") and the `set_state`/`get_state`+`AppState`
  base (byte-identical); **partial** the `serve` CLI helper; **keep per-app**
  `default_data_dir` (JV legacy-compat) + the divergent `create_app` middleware/
  mounts. `server_core` lives in `just-llm-runner/` (sibling of `llm_runner`).
  pytest gates confirmed runnable here (JV 286, JW 82).
- ✅ **Server basics — DECISION: NO shared server-core package; keep the servers
  separate, make the basics uniform by convention.** Rationale: the one
  substantial shared server piece (the LLM stack) is already `llm_runner`; the
  rest (`init_db`/`AppState`/`cli`) is ~60 lines of stable boilerplate not worth a
  cross-repo, boot-critical package with shared global DB state, and JV's server
  is a genuinely heavier, domain-different service (TTS/engines/render/MCP/auth).
  Uniform basics shipped to JW (JV was the reference): **headless `/ui` static
  mount** (serve the SPA from the server), **optional bearer auth** (off by
  default; `auth` settings section; loopback-bypass flag), **RFC-7807
  problem+json errors** (ApiError + handlers + a 500 envelope before CORS),
  **settings-driven CORS**, and a **Settings → Server UI** (headless URL + token
  management). Verified: ruff + pytest (JW 82/82) + an end-to-end auth curl test
  + the headless-served smoke.
- ✅ **App shell — DECISION: keep-alike per app, NOT a shared component** (the
  rail/topbar paradigms legitimately differ — JV icon-rail + topbar vs JW
  titlebar + wide resizable sidebar + per-view headers; a shared shell would be a
  slot-heavy net-negative). Fixed JV's two real shell bugs to JW's discipline:
  **nav-jump** (`.app-shell` lacked `grid-template-rows` → a short view shrank
  the row → sidebar not full-height; rail scrolled as one block with a flex
  spacer) → `grid-template-rows: minmax(0,1fr)` + fixed-top/scroll-middle/
  fixed-bottom rail; **Compact dead-space** (`height:100vh` ignores the `<html>`
  zoom) → `height:100%` chain. Wrote the **"App shell structure" convention** into
  the global app-standard + added a **smoke guard in BOTH apps** (shell fills
  viewport · rail full-height · single scroller) so it can't silently drift again.

**⏭ WHAT'S LEFT FOR JV:**
1. **JV Appearance Settings → full knob set.** The shared appearance ENGINE
   supports the full set (font pairings, UI/display fonts, size scale, section-
   heading + nav-item style/size, accent2/gold, functional danger/success/info
   hues, ink palette) and JW exposes ALL of it; JV's Appearance tab still shows
   only Theme / Interface size / Accent hue / Language. Expose the full set in
   JV's `SettingsView` — the clearest remaining user-facing inconsistency.
2. **Layer C lock (optional):** a lint/CI guard beyond the shell smoke — flag a
   re-forked `Jw*`/`Jv*` primitive or a second copy of `init_db`/`set_state`.
3. **Optional / low value:** deeper server-basics sweep (response camelCase +
   health/settings shape parity); a deeper strict shell diff ("there may be
   more" — the smoke guard now catches the structural class).

**▶ NEXT THREAD (user-directed 2026-06-24): switch back to the JW shared-LLM
stack.** The shared AI/LLM cutover — `just-llm-runner` dispatch (`/v1/ai/*`) +
`@delebash/llm-ui` views, consumed by both apps; only TTS + each app's feature
catalog differ. Authoritative plan: `docs/plans/2026-06-20-shared-ai-stack-plan.md`.
Read it + JW's current LLM state (`services/openai-compat.js` → `/v1/llm/*`,
the `ai` store, what's migrated to `/v1/ai/*`) before acting.

---

## ⮕ EARLIER (2026-06-23): UI primitives converged onto `@delebash/llm-ui`

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

**Deeper convergence audit + plan (user, 2026-06-23): "what ELSE should be
shared so the next app reuses instead of reinvents?"** Authoritative tracker:
`docs/plans/2026-06-23-cross-app-shared-ui-audit.md` (Q1 = shared LLM views are
clean on `Ui*` bar ~8 raw-element stragglers; Q2 = both apps carry parallel
app-shell/services copies — strict-diff tiers T1–T4). Execute JV-first, no-stop,
**PAUSE+ASK only on the diverged trio (T4)**. Status:

- ✅ **T1 done** — `Icon`, `Breadcrumb`, `dialog.js`, `tooltip.js` → kit
  `common/`; JV wired; forks deleted.
- ✅ **T3 (help system) done** (runner `07b4f18` · JV `7ec1be8` · JW `d237a84`):
  shared `HelpDrawer` + `HelpTrigger` + `helpMarkdown` + kit-owned open-state
  (`common/services/help.js`, `configureHelp(adapter)`). JV wires it in `main.js`
  (`configureHelp({loadDoc,hasDoc,titleForSlug})`), keeps `services/helpDocs.js`
  (content) local; JV forks (`JvHelpDrawer`/`HelpTrigger`/`helpMarkdown`) deleted.
  JV **gained** anchor support (heading ids + scroll). `marked` → both apps'
  `dedupe` + kit peerDep (the JW edit is plumbing-only; JW still on its own help
  components). Verified: build clean JV+JW, smoke 14/14 zero errors, drawer renders
  "Getting started" (2955 chars · 4 heading ids · 1 rewritten link) + Esc-closes.
- ✅ **T2 (cleanly-shareable shells) done:** **Toast** (`Toast.vue`+`toastBridge.js`,
  29 call sites repointed, empirical toast-fire verified) · **EmptyState** (6 sites,
  Personas screenshot) · **ConnectionError** (per-app copy via props, dev:vite
  dead-backend screenshot) · **PaneHeader** (JV dead code — removed; JV titles panes
  via the global topbar, not a per-pane header). `vue-sonner` added to dedupe+peerDep.
- 🔁 **Reclassified (findings):** `connection.js` → **T4** (it *calls* the base-URL —
  needs the shared `serverApi` + an auth-header injector for JV's `jt:token`).
  `AppModal.vue` → **new T5 modal-system convergence**: JV has **16 hand-rolled
  `.jv-overlay`/`.jv-modal` modals + 1 AppModal consumer** (JW funnels ~11 through
  AppModal) — sharing only AppModal = dual modal systems (drift); correct fix is
  migrating all 17 JV modals + retiring the globals → judgment-heavy + visual risk,
  its own tier.
- ⏭ **Remaining:** **Q1 cleanup** (kit-internal raw-element stragglers in
  PromptLab/FeatureWorkbench/ProviderForm) → **T4 PAUSE+ASK** (`serverApi.js`,
  `appearance.js`, `AppDialog.vue`, `connection.js`; also size **T5 modal migration**).

> DOCS DEBT status: JV `CLAUDE.md` RULE #1 inventory + checklist — **cleared**
> (now point at the shared `Ui*` kit; `components/ui/` empty). JW `CLAUDE.md`
> still documents the `Jw*` layer as canonical — that's the deferred JW
> `Jw*`→`Ui*`/kit migration (do NOT touch JW source until that turn).

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
