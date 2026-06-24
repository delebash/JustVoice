# Full cross-app convergence plan — server + GUI (2026-06-24)

Scope: **JustVoice (JV)** + **JustWrite (JW)** + the shared packages
(`@delebash/llm-ui`/`@delebash/ui`, `just-llm-runner`). Goal (user): the two
apps should be **the same code except necessary domain functionality**, so the
next app reuses instead of reinvents. This doc is the grounded audit + the
options + the recommendation. Supersedes the renderer-only
`2026-06-23-cross-app-shared-ui-audit.md` (that one is now the "renderer kit"
sub-plan; this is the master).

> Every claim below was read file-by-file this session (not from memory).

---

## 1. Where we are — what's shared vs duplicated (grounded)

### Already shared (done)
- **Renderer primitives** — `Ui*` kit (`@delebash/llm-ui/common/`). **JV done**
  (`components/ui/` empty); **JW still on its `Jw*` forks** (not yet merged).
- **Renderer shells/services** (this session) — `Icon`, `Breadcrumb`, `dialog.js`,
  `tooltip.js`, the Help system, `Toast`+`toastBridge`, `EmptyState`,
  `ConnectionError`. JV wired; JW still on its own copies.
- **LLM stack** — `just-llm-runner` (Python) + the `Lu*`/LLM Vue views. **Both
  servers** import `from llm_runner...` (verified) and **both** mount the same
  `llm_runner` router in-process. This is the proof shared Python packages work
  here.

### Same architecture, but DUPLICATED (the problem)
The migration the user remembers **did work** — both apps are now: Vue3+Tauri
thin client → FastAPI `create_app()` → SQLAlchemy+SQLite, AppState singleton,
both mounting the shared `llm_runner`. They are **not** different designs. But
they are **two separate codebases that re-implement the same scaffolding**:

**Server (only `llm_runner` is shared — nothing else):**
| Concern | JV | JW | Evidence |
|---|---|---|---|
| AppState singleton | `app_state.py:65-77` | `app_state.py:16-27` | `set_state`/`get_state` **byte-identical** |
| DB bootstrap | `database/session.py` | `database.py` | **near-identical** `init_db`/`get_db`; JW docstring literally: *"Mirrors JustVoice's session bootstrap"* |
| CLI `serve` | `cli.py` | `cli.py` | same Typer+uvicorn+`create_app` shape + same naming-collision note |
| `create_app` factory | `app.py:1-446` | `app.py:1-114` | same FastAPI factory + CORS + static-UI + `llm_runner` mount + router registration |
| Migrations runner | `database/migrations.py` | `migrations.py` | same idempotent add-column pattern |
| Settings/prefs store + endpoints | `api/settings_api.py`,`prefs_api.py` | `api/settings.py` | generic key-value persistence, re-implemented |
| Generic infra endpoints | `api/health.py` | `api/health.py`,`sessions.py`,`workspace.py`,`images.py` | health near-identical; sessions/images generic |

**Renderer (the diverged trio + modals):**
| Concern | JV | JW | Status |
|---|---|---|---|
| `serverApi.js` | 139 lines — full transport (base+auth+`request`/verbs/dedupe/blob/form/safe/lastError) | 28 lines — **only** the origin-aware base resolver; transport scattered across ~16 service files each hand-rolling `fetch` | JV follows the app-standard; JW drifted |
| `appearance.js` | 32 lines — light/dark/system only | **490 lines** — full theme engine (accent/gold/functional hues, fonts, button knobs, tints, ink palettes, ui-scale, nav typography, presets) | JV would ADOPT JW's engine + a JV-appropriate knob subset |
| `AppDialog.vue` | ✅ imports kit `AppDialog` (local deleted) | ✅ imports kit `AppDialog`; local `AppDialog.vue` + `dialog.js` deleted, `configureDialog` wired | ✅ **DONE both** — kit `AppDialog` (on kit AppModal + shared dialog.js) is the only host |
| Modal system | ✅ all migrated to kit `AppModal`; `.jv-overlay`/`.jv-modal*`/`.jv-dialog*`/`.jv-help-drawer*` globals removed | ✅ kit `AppModal` (Slice A) + kit `AppDialog`; dead `.app-modal*`/`.app-dialog` removed | ✅ **DONE both** — ONE modal shell + ONE prompt/confirm host across both apps |

### Genuinely different — necessary, do NOT share
JV: engines/audio/generate/render/voices/takes/personas/lexicons + `auth.py`.
JW: projects/chapters/manuscript-export/chat/versions/RAG/book_io.
Different products → different domain code. Everything ELSE above is scaffolding.

---

## 2. Target architecture

Each app = **shared packages + its domain code, nothing else.**

```
@delebash/ui          general Vue: primitives + shells + services
                      (button/input/select/modal/dialog/toast/help/empty/
                       connection + serverApi transport + appearance engine)
@delebash/llm-ui      LLM-specific Vue views (provider/prompt/routing/model)
just-llm-runner       Python LLM core (DONE)
@delebash/server-core (NEW) Python: create_app helper + AppState base + CLI
                      serve + init_db/get_db/migrations framework + settings/
                      prefs store + generic infra endpoints (health/settings/
                      sessions/images/workspace)
```
- JV app = packages + engines/audio/voices/render/takes (+ auth).
- JW app = packages + manuscript/chapters/chat/versions/RAG.
- Each adapter passes **config** (db filename, domain `Base`, migrations fn,
  knob catalog, auth injector) — never a copy of the machinery.

> Today `@delebash/ui` physically lives inside `@delebash/llm-ui/common/` — it
> graduates to its own folder/package as part of this work (the kit comment
> already says "the future @delebash/ui").

---

## 3. The work, by layer

### Layer A — finish the renderer kit (both apps on ONE kit)
1. **serverApi** (trio) — extract the origin-aware resolver + JV's transport to
   the kit; `configureServerApi({ resolveBase, authToken? })` (auth optional). JV
   repoints its imports; **JW adopts it and deletes its ~17 scattered `fetch`
   helpers**. Unblocks `connection.js` (shared too).
   - ✅ **Kit done**: `common/services/serverApi.js` = `makeOriginAwareResolver`
     + `configureServerApi` + `serverUrl/url` + transport (request/verbs/dedupe/
     blob/form/safe/lastError) + `checkServer` (folds in connection.js).
     `client.js`'s `request/requestStream` dropped from the public index (kept
     internal via relative imports) to free the name for the transport.
   - ✅ **JV done**: `config.js` uses the shared resolver (+ `jt:server`
     override); `main.js` calls `configureServerApi({resolveBase, authToken})` at
     boot then the kit `checkServer`; `stores/api.js` delegates to the kit
     transport; `services/serverApi.js` + `services/connection.js` deleted.
     Verified: build clean (JV+JW), smoke 14/14 with live server data.
   - ✅ **JW done**: `serverApi.js` now uses the shared resolver (per-app
     config only); `main.js` calls `configureServerApi({resolveBase})` + kit
     `checkServer`; `connection.js` deleted; **12 scattered-fetch services
     repointed to the kit transport** (settings/usage/workspace/embed/versions/
     chat/sessions/provider/routing/project/image/rag-vector). `aiFeature.js`
     keeps raw fetch on the shared `serverUrl` — it's a streaming (SSE) +
     task-panel domain runner, a proven-different case, not generic transport.
     Verified: build clean; **JW headless smoke 25/25 routes, zero JS errors,
     live data through the kit**. Both apps now share ONE transport.
   - ✅ **JV straggler done**: `services/prefs.js` now uses the kit
     `safeRequest`/`patch` (keepalive) instead of hand-rolled `base()/
     authHeaders()/fetch`. Smoke green (prefs hydrate through the kit).
2. **appearance** (trio) — extract JW's theme engine as the shared
   `applyAppearance(config)` machinery + a per-app knob **catalog**. JV adopts
   the engine with a JV-appropriate catalog (no editor/manuscript knobs) → JV
   gains real theming; JW keeps its full catalog.
   - ✅ **Slice 1 (engine → kit; JW adopts) done.** Kit
     `common/services/appearance.js` = the generic engine (`applyAppearance(cfg,
     {extraApply})` + mode/accent/gold/functional-hue/font/button-knob/tint/ink/
     scale/nav-typography application + system-pref listener) + all generic
     catalogs + `migrateAppearance`/`DEFAULT_APPEARANCE`. JW's `appearance.js`
     slimmed to: re-export the shared catalogs + JW-specific `PAPER_TINTS`/
     `THEME_PRESETS`/`DEFAULT` (brand + editor) + an `editorExtraApply` hook for
     the manuscript-editor vars. **JW visual parity verified** — build clean,
     smoke 25/25, screenshot pixel-identical (accent-hue 14, Spline Sans,
     Fraunces). The public kit index now `export *`s from `common/`.
   - ⏭ **Slice 2 (JV) — groundwork done, ready to execute carefully.** JV's
     palette measured in OKLCH (don't guess): accent `oklch(0.538 0.080 166)`
     (hue 166 green) · accent-ink `0.446 0.068` · accent-soft `0.948 0.011` ·
     accent-line `0.840 0.035` · gold/warn hue 82 · danger `0.517 0.137 34`
     (hue 34) · info hue 250 · success = accent hue 166. JV keeps its OWN
     per-family L/C keyed to `--accent-hue`/`--danger-hue`/`--success-hue`/
     `--info-hue` so the **default hues reproduce JV's current hex EXACTLY**
     (no shift) while the engine's hue knobs retint. Surfaces/ink/mono stay
     JV's. Two kit-engine fixes needed first (both JW-safe): (a) drop the
     hardcoded `--font-mono` set (mono is an app constant in tokens.css, not a
     theme knob — JW's value is unchanged); (b) add **Inter** to `UI_FONTS` so
     JV's default UI font is preserved. Then JV `tokens.css` hue-drives accent +
     functional families + adds the button-knob vars; JV `appearance.js` = kit
     engine + JV DEFAULT (Inter, accentHue 166, inkPalette auto) + JV catalog
     (no editor/display knobs); JV `main.js`/`uiStore` migrate `theme` →
     `appearance.mode` + `applyAppearance` at boot. Verify per-view screenshots
     (green + warm paper preserved).
   - ✅ **Slice 2 (JV) done.** JV `tokens.css` hue-driven (accent/gold/functional
     keyed to the hue vars with JV's measured L/C → default hues reproduce JV's
     exact palette; surfaces/ink/mono stay JV's) + button-knob vars. JV
     `appearance.js` = kit engine + JV DEFAULT (Inter, accentHue 166, …). The
     duplicated local appearance system in SettingsView was removed and its UI
     (theme/size/accent/language) rewired to `ui.appearance`/`ui.setAppearance`;
     `uiStore.theme` → `ui.appearance` (migrates both legacy theme prefs); the
     dead density knob → live `uiScale`; `main.js` force-inits the ui store so
     the engine applies at first paint (every view). Verified: build clean
     (JV+JW), smoke 14/14, screenshots — light green `oklch(.538 .08 166)` exact,
     dark green `oklch(.673 .093 166)`, Inter + JetBrains mono preserved, accent
     knob live (166→30 retints), Settings surface bound to the shared engine.
   - ⏭ **Slice 3 (JV, optional polish):** expand the Settings → Appearance
     surface to the fuller knob set (fonts/button-radius/density/ink) the engine
     now supports — JV currently exposes theme/size/accent/language.
3. **modal system + AppDialog** (T5) — shared self-contained `AppModal` (scoped
   styles = canonical look) + `AppDialog` host on top of it.
   - ✅ **Slice A done.** Kit `common/components/AppModal.vue` — Reka Dialog,
     self-centering + data-state animations, canonical-token scoped styles,
     `closeLabel` prop (i18n-friendly). **JW's 26 AppModal consumers repointed**
     to the kit; JW `AppModal.vue` deleted. JV's own `AppModal.vue` was **dead
     code** (no real consumer — only a comment) → deleted. Verified: build clean
     (JV+JW), JW smoke 25/25, modal screenshot (Multi-reader panel) renders
     correctly with JW theming.
   - ✅ **Slice B done (JV).** All JV hand-rolled `.jv-overlay`/`.jv-modal`
     modals migrated to the kit `AppModal` (StudioView ×2, GenerateView ×2 the
     last of the batch; earlier: KeyboardCheatsheet, NewProjectModal, ChordPicker,
     LineageViewer, VoiceParamsModal, EffectsChainEditorModal, QuickSetup,
     ProjectsView, PersonasView, RenderPresetsView, LexiconsView, ImportModal,
     VoicesView). The `.jv-overlay`/`.jv-modal*` **and** the dead
     `.jv-dialog*`/`.jv-help-drawer*` globals (leftover from the HelpDrawer kit
     migration) + the 4 orphaned `@keyframes` (jvOverlayIn/Out, jvModalIn,
     jvDrawerIn) were removed from `styles.css`. Verified: build clean, smoke
     14/14 zero JS errors, screenshots.
   - ✅ **AppDialog done (kit + JV).** New shared `common/components/AppDialog.vue`
     built **on** the kit `AppModal` (one overlay/animation/token shell — no CSS
     fork), driven by the already-shared `dialog.js`. Field types text/textarea/
     select (union of both forks). New `configureDialog({ labels })` +
     reactive `dialogLabels` keep the kit i18n-agnostic (apps inject localized
     defaults; English defaults match JW's en.json verbatim). JV `App.vue` now
     imports `AppDialog` from the kit; JV's local `components/AppDialog.vue`
     deleted. Verified: confirm + prompt dialogs open/focus/close (interaction
     test, autofocus through the AppModal slot, close-animation teardown),
     screenshots, zero JS exceptions.
   - ✅ **AppDialog done (JW too).** JW's 16 `services/dialog.js` callsites
     repointed to the kit; JW's local `services/dialog.js` + `components/AppDialog.vue`
     deleted; `App.vue` imports the kit `AppDialog`; `configureDialog({ labels })`
     wired in `main.js` from JW's en.json (copy stays app-owned). Removed the dead
     `.app-modal*`/`.app-dialog` shell CSS (the `.modal-title` content class +
     the older `.modal*` system stay — still used). Verified: build clean,
     headless smoke 27/27 zero JS errors, interaction test (prompt + confirm
     open/autofocus/close, JW labels via configureDialog) zero JS exceptions,
     screenshots (JW Fine Press theming correct). **Both apps now share ONE
     modal shell + ONE prompt/confirm host — the modal system is fully
     converged.**
4. **JW UI merge** — JW `Jw*` → kit `Ui*` + JW shell forks → kit, exactly as JV
   did. JW deletes its forks and imports the kit.
   - ✅ **Icon done**: 77 importers repointed to the kit `Icon`; JW `Icon.vue`
     deleted (byte-identical to the kit's). Build + headless smoke 25/25 green.
   - ✅ **Shells done (all of them).** `Breadcrumb` (12), `EmptyState` (9),
     `tooltip` directive, `Toast`+`toastBridge`, `ConnectionError` (props), and
     the whole help system (`HelpDrawer`/`HelpTrigger`/help state via
     `configureHelp` with onOpenFull/onOpenWeb + the kit empty-state "Browse all
     docs") all repointed to the kit; the JW forks + `services/tooltip.js`,
     `services/toastBridge.js`, `services/helpMarkdown.js` and the ui-store help
     state deleted. Surfaced + fixed the font-token gap (kit shells read
     semantic `--font-display`/`--font-body`; both apps now map them). Verified:
     builds, smoke 27/27, interaction tests + screenshots, computed-style checks.
   - ✅ **AppButton/Input/Textarea/Checkbox/Tag already on the kit** (0 `Jw*`
     importers remain for these).
   - ⏭ remaining primitives: `JwSelect`→`UiSelect` (13), `JwNumber`→`UiNumber`
     (2), `JwTable`→`UiTable` (11), `JwColorPicker` (3). **Promote `UiNumber`
     (locale number input) + `UiTable` (TanStack) to the kit first — no
     equivalent yet; decide `JwColorPicker` (promote vs JW-local).**
5. Delete every renderer fork; both apps' smokes green.

### Layer B — extract `@delebash/server-core`
1. **Strict file-by-file server audit first** (the part not yet done at line
   level) — settle the exact shared/per-app boundary for create_app, init_db,
   migrations, settings/prefs, infra endpoints.
2. Extract: `create_app(domain_routers, *, Base, db_filename, migrations, ...)`,
   `AppState` base, CLI `serve` scaffolding, `init_db`/`get_db`/migrations
   framework, settings/prefs store, generic infra endpoints.
3. Wire both servers to consume it; delete the duplicated scaffolding; both
   apps' `pytest` suites green.

### Layer C — lock it
- Both apps: full `pytest` + ruff + headless smoke green.
- A **guard** (lint/CI rule) that fails on re-divergence: a new hand-rolled
  `fetch` in a renderer service, a forked `Jw*`/`Jv*` primitive, a second
  copy of `init_db`/`set_state`.

---

## 4. Options

- **Option A — Full convergence, by layer (RECOMMENDED).** Do Layer A (renderer
  kit, both apps incl. the JW merge) → Layer B (server-core) → Layer C (lock).
  End state = the target architecture; both apps thin; all duplication deleted.
  Biggest effort; the only one that actually finishes the job. Touches JW.
- **Option B — Renderer-only now.** Finish Layer A across both apps; defer the
  server-core (Layer B) to a later session. Leaves the duplicated server
  scaffolding in place but gets the GUI fully converged.
- **Option C — Keep incremental (status quo).** Continue file-by-file, JV-first,
  deferring the hard pieces. This is what we've been doing; it's also the
  pattern that left the trio + modals + entire server-core undone.

---

## 5. Recommendation

**Option A, sequenced by layer, both apps as consumers from the start.**

Rationale: the user's stated goal is "same code except necessary functionality,"
and the evidence (byte-identical `set_state`, "Mirrors JustVoice" DB bootstrap,
scattered JW `fetch`) shows the remaining differences are **duplicated
scaffolding, not divergent design** — exactly what a shared package deletes. A
shared thing isn't "done" until **both** apps consume it and the forks are gone,
so JW must come in now (not "later"). Sequence by layer so each phase is
independently verifiable (smoke for renderer, pytest for server) and we never
hold half-migrated state across a layer.

Order within A:
1. Trio: **serverApi** (foundation; unblocks connection.js) → **appearance**
   (engine + per-app catalog) → **modals/AppDialog**.
2. **JW primitive + shell merge** (bring JW fully onto the kit).
3. **server-core** extraction (after its own strict file-by-file audit).
4. Lock (suites green + anti-divergence guard).

Honesty caveats: (a) the appearance step is a real **feature uplift for JV** (a
new Settings → Appearance surface) — flag before building if you'd rather JV
stay minimal; (b) the server-core extraction needs its **own line-level audit**
before I touch it; (c) this is large — but it's the job, done without the
defer-hatches.
