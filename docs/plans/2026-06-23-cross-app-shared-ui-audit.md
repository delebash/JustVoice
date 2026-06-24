# Cross-app shared-code audit + convergence plan (2026-06-23)

Scope: JustVoice (JV) + JustWrite (JW) + the shared kit `@delebash/llm-ui`
(`just-llm-runner/ui/src/`). Goal (user, 2026-06-23): "shared components so when we
build another app we **reuse instead of reinvent**." JV's UI primitives are already
converged to `Ui*`; this audit asks (1) do the shared *LLM views* use those
primitives, and (2) what *else* across both apps should be shared. **No JW
conversion yet** (user hold) — this is the audit + plan; implementation is a
separate, JV-first pass.

The kit's `common/` is explicitly "the future `@delebash/ui` — general,
app-agnostic UI primitives" (`ui/src/common/index.js`). That is the home for
everything below that converges.

## Progress (JV-first; JW left on its forks per the hold)

- ✅ **T1 done** (commit `just-llm-runner` + JV) — `Icon.vue`, `Breadcrumb.vue`,
  `dialog.js`, `tooltip.js` moved to the kit (`common/`); JV imports them; JV
  forks deleted. Verified build+smoke.
- ✅ **T3 done** (runner `07b4f18` · JV `7ec1be8` · JW `d237a84`) — shared
  `HelpDrawer` + `HelpTrigger` + `helpMarkdown` + kit-owned open-state
  (`help.js`) with `configureHelp(adapter)`. JV wired via `main.js`
  `configureHelp({loadDoc,hasDoc,titleForSlug})`, keeps `services/helpDocs.js`
  (content) local; JV forks deleted. JV **gained** anchor support (heading ids +
  scroll-into-view). `marked` added to both apps' `dedupe` + kit peerDep (JW
  change is plumbing-only; JW still uses its own help components). Verified:
  build clean (JV+JW), smoke 14/14 zero errors, drawer opens to "Getting
  started" (2955 chars, 4 heading ids, 1 rewritten link), Esc-closes.
- ⏭ **Next:** T2 (light-drift shells/services) → Q1 cleanup → **T4 PAUSE+ASK**
  (diverged trio: `serverApi.js`, `appearance.js`, `AppDialog.vue`).

---

## Q1 — Do the shared LLM views use our shared `Ui*` primitives?

**Yes, almost entirely.** Verified per file (`just-llm-runner/ui/src/`):

| Shared view/component | Uses `Ui*` | raw `<button/input/select/textarea>` | Verdict |
|---|---|---|---|
| `views/AiModelsArea.vue` | UiButton | 0 | ✅ clean |
| `views/QuickSetup.vue` | UiButton | 0 | ✅ clean |
| `views/RoutingPresets.vue` | UiButton, UiInput | 0 | ✅ clean |
| `views/PromptLab.vue` | UiButton, UiInput, UiTextarea, UiCheckbox | 1 (`:128` `<button>`) | ⚠️ 1 raw button → UiButton |
| `views/FeatureWorkbench.vue` | UiButton, UiInput, UiTextarea, UiCheckbox + LuModelPicker | 5 | ⚠️ classify the 5 raw els |
| `views/ProviderForm.vue` | UiButton, UiInput, UiSegmented + LuCombobox, LuModelCatalog | 2 | ⚠️ classify the 2 raw els |
| `components/LuCombobox.vue` | — | 2 (`<input>`) | ✅ legit — it *is* a combobox primitive built on input |
| `components/LuModelPicker.vue` | — | 2 | ✅ legit primitive |
| `components/LuModelCatalog.vue` | UiButton | 0 | ✅ clean |

**Finding:** the shared LLM layer is internally consistent on `Ui*`. Only a small
cleanup remains (PromptLab's 1 raw button + classify ~7 raw elements in
FeatureWorkbench/ProviderForm; some may be legit like `<select>`→`UiSelect` now
that it exists). The `Lu*` components are LLM-domain primitives (combobox/model
picker) that legitimately wrap raw inputs.

**One real gap (Q2 overlap):** JW ships its OWN `Combobox.vue` + `ModelPicker.vue`
+ `ProviderSelect.vue` while the kit has `LuCombobox`/`LuModelPicker`. That's a
duplicate — JW should consume the shared `Lu*` (or they get promoted to `Ui*`).

---

## Q2 — What else should be a shared component? (strict-diff signal)

Both apps carry **parallel copies** of the app-shell + standard services — the
"9-19× duplicated services" drift the rules warn about. Each row is the same file
in both apps, normalized for jv/jw naming, with the diff-line count (0 = identical
apart from naming → trivially shared; high = real divergence):

| File (both apps) | diff | JV / JW lines | Tier — action |
|---|---|---|---|
| `services/dialog.js` | 1 | 75 / 74 | **T1** identical → share now |
| `services/tooltip.js` | 1 | 144 / 143 | **T1** identical → share now |
| `components/Breadcrumb.vue` | 1 | 45 / 44 | **T1** identical → share now |
| `components/Icon.vue` | 1 | 107 / 106 | **T1** identical → share now |
| `services/connection.js` | 20 | 24 / 20 | **T2** light drift → reconcile + share |
| `components/Toast.vue` | 17 | 26 / 21 | **T2** + `toastBridge.js` (35) |
| `components/PaneHeader.vue` | 25 | 27 / 30 | **T2** light → share |
| `components/ConnectionError.vue` | 26 | 40 / 38 | **T2** light → share |
| `services/helpMarkdown.js` | 49 | 45 / 68 | **T3 (help system)** |
| `components/HelpTrigger.vue` | 64 | 72 / 68 | **T3 (help system)** |
| `JvHelpDrawer`/`JwHelpDrawer.vue` | (fork — verified) | 278 / 280 | **T3 (help system)** |
| `components/EmptyState.vue` | 64 | 50 / 60 | **T2/3** reconcile → share |
| `components/AppModal.vue` | 67 | 90 / 117 | **T2/3** reconcile (Reka Dialog shell) |
| `components/AppDialog.vue` | 125 | 203 / 242 | **T4** diverged — shared core + per-app slots |
| `services/serverApi.js` | 157 | 139 / 28 | **T4** diverged — extract origin-aware core; endpoints stay app-local |
| `services/appearance.js` | 514 | 32 / 490 | **T4** diverged — JW has the full theme-knob engine; share the engine, per-app knob set |

Also parallel (named differently, same job): `KeyboardCheatsheet.vue` (JV) ↔
`ShortcutCheatsheet.vue` (JW); JW `Combobox`/`ModelPicker`/`ProviderSelect` ↔ kit
`Lu*` (Q1 gap above).

**Per-app-LEGIT (do NOT share):** everything domain-specific — JW's editor/Tiptap,
manuscript export, the `*Modal.vue` feature modals, RichEditor, MentionList, etc.;
JV's audio/Studio/effects/dictation, VoiceParamsModal, EffectsChainEditorModal,
CapturePill, etc. These are feature catalog, not reusable scaffolding.

---

## The plan — convergence into `@delebash/ui` (the kit's `common/`)

Target home: `just-llm-runner/ui/src/common/` (components + a new `services/`),
consumed by both apps via the existing `@delebash/llm-ui` alias. Each app keeps a
thin local layer that injects its **config** (design tokens, help content, server
endpoint surface, theme-knob set) — never a copy of the machinery.

**Order (each step = extract to kit → wire JV → verify JV build+smoke → [JW later]):**

1. **T1 — the freebies (identical):** `dialog.js`, `tooltip.js`, `Breadcrumb.vue`,
   `Icon.vue`. Move verbatim to the kit; JV imports them; delete JV copies. Zero
   risk (they're byte-identical). *(Icon: confirm both ship the same icon set.)*
2. **T3 — the help SYSTEM** (the one already verified): shared `HelpDrawer` +
   `HelpTrigger` + `helpMarkdown`, with a small `configureHelp({ docs })` so each
   app plugs in its own `services/helpDocs.js` + `docs/*.md` content. (Drop the
   stale "JV has no router" fork-reason — JV has vue-router now.)
3. **T2 — light-drift shells/services:** `connection.js`, `Toast.vue` +
   `toastBridge.js`, `PaneHeader.vue`, `ConnectionError.vue`, `EmptyState.vue`,
   `AppModal.vue`. Reconcile the small diffs to one implementation; JV wires it.
4. **T4 — the diverged trio (decisions needed):**
   - `serverApi.js` → extract the app-standard core (origin-aware base + `url()` +
     `request`/`safeRequest`/`requestBlob`/`postForm`); per-app endpoint helpers
     stay local.
   - `appearance.js` → share the token-apply engine + the knob framework; each app
     declares its own knob set (JW has many; JV few).
   - `AppDialog.vue` → shared prompt/confirm host; per-app field types via slots.
5. **Q1 cleanup:** PromptLab/FeatureWorkbench/ProviderForm raw-element stragglers →
   `Ui*`; converge JW's `Combobox`/`ModelPicker`/`ProviderSelect` onto the kit's
   `Lu*` (JW step — deferred).

**Verification gate (every step):** `build:vite` + headless smoke (zero JS errors)
on JV — and on JW once its turn comes — plus a screenshot for any visible surface.
Single-instance peers already handled (vite `dedupe`).

**Decisions for the user (the "2 and 3" follow-ups):**
- (a) Do T1–T3 now JV-only, leaving JW to adopt later (keeps JW untouched but
  leaves it on its forks until then), **or** pair each extraction with the JW wire
  so both converge together (touches JW)?
- (b) Naming: these graduate from `Jv*`/`Jw*` to `Ui*` in the kit — confirm the
  shell components (modal/dialog/breadcrumb/icon/toast/help) live under the same
  `common/` as the primitives (recommended) vs a separate module.
- (c) `appearance.js`/`serverApi.js` are the app-standard scaffolding — confirm we
  extract their shared core now vs treat as a later phase.
