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
| `AppDialog.vue` | 203 | 242 | host for the (already-shared) `dialog.js`; a specialized modal → converges with the modal system |
| Modal system | **16 hand-rolled** `.jv-overlay`/`.jv-modal` modals + 1 `AppModal` | funnels ~11 modals through `AppModal` | migrate JV's 16 → shared `AppModal`, retire the globals |

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
3. **modal system + AppDialog** (T5) — shared self-contained `AppModal` (scoped
   styles = canonical look) + `AppDialog` host on top of it. Migrate JV's 16
   hand-rolled modals + JW's ~11 onto it; retire `.jv-overlay`/`.jv-modal`.
4. **JW UI merge** — JW `Jw*` → kit `Ui*` + JW shell forks → kit, exactly as JV
   did. JW deletes its forks and imports the kit.
   - ✅ **Icon done**: 77 importers repointed to the kit `Icon`; JW `Icon.vue`
     deleted (byte-identical to the kit's). Build + headless smoke 25/25 green.
   - ⏭ remaining shells: `Breadcrumb`, `dialog`/`tooltip` services, `Toast`,
     `EmptyState`, `ConnectionError` (props), `HelpDrawer`/`HelpTrigger`
     (configureHelp with onOpenFull/onOpenWeb — JW has a HelpView + web docs).
   - ⏭ primitives: `JwButton→UiButton`, `JwInput`, `JwSelect`, `JwTextarea`,
     `JwCheckbox`, `JwTag` (per-primitive API reconciliation). **Gaps to
     promote to the kit first: `UiNumber` (JwNumber, locale number input) +
     `UiTable` (JwTable, TanStack) — no kit equivalent yet.**
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
