# JustVoice

A cross-platform voice production server: **Electron shell + Vue 3 renderer + Node server
(Hono + SQLite)**, with every speech model run by one audio.cpp process (the speech runtime).
Also runs **headless** (`npm run server`, or the installed app's `justvoice-server serve`), no
window. Plain `.js` everywhere (`"type": "module"`) — no TypeScript, no `.mjs`/`.cjs`, and no
Python anywhere (the user's rulings, 2026-10-08).

Standalone product. JustWrite drives JustVoice for audiobooks — JW hands over the prose, JV does
its own casting and narration — but JustVoice does not depend on JustWrite. The boundary rules
live in `docs/dev/design-decisions.md` §3 — read them before touching anything cross-app. (The
original `CONTRACT.md` was archived to `docs/plans/archive/` by the 2026-08-04 docs campaign;
its endpoint table is stale — trust `server/src/api/*` route literals.)

The AI/LLM stack is shared with JustWrite: `@delebash/llm-runner` (the kit's Node package, `../just-llm-runner/server`) + `@delebash/llm-ui` (Vue).
Only TTS and each app's feature catalog differ. A change in those repos lands here too.

The family rules every family repo follows: @../just-llm-runner/docs/family-rules.md

## Commands

```bash
npm install                        # the renderer + the server/ workspace; once: cd src-electron && npm install
                                   # (the speech runtime installs from the app)
npm run dev                        # builds ../audio.cpp, then Quasar's dev server (1430, HMR 1431) + Electron
npm run build                      # production installer (Quasar's Electron mode → dist/electron/Packaged)
npm run dev:spa                    # the renderer alone in a browser tab (start the server yourself)
npm run build:spa                  # the browser build (dist/spa), what the headless server serves

npm run server                     # headless; same UI at / (options after --)
npm run lint && npm run test:server && npm run test:unit   # all must pass before a commit
node ../just-llm-runner/scripts/check-family.js            # the family guard — must pass too
```

The dev data folder is `<repo>/data` (gitignored) — the desktop app, `npm run server` and every
script read it; there is one data root (the Electron move's ruling 6, moved 2026-10-08).

The server's audio math runs in `audiocpp_dsp`, a small program from our audio.cpp fork's `dsp/`
module (since 2026-10-07): the server, its tests and the gate all need it built — `npm run dev`
builds it beside the runtime into `../audio.cpp/build/jv-dev/bin`, or `JUSTVOICE_DSP_EXE` names
one. Its proof against the code it replaced is recorded in RESEARCH §6 and the fork's
`dsp/README.md`.

**One speech runtime runs every engine (since 2026-10-01).** Installing any engine — the
runtime row on AI Settings → Speech engines — downloads the pinned audio.cpp build for this
machine (`<data>/engines-runtime/audiocpp/`, binaries via the kit's `acquireRuntime`, which
leaves upstream's Python reference scripts out) plus eSpeak NG; each engine is then a catalog
(`server/src/engines/<id>/manifest.js`) of GGUF model files in the speech cache.
`docs/plans/2026-10-01-audiocpp-switch.md` is the record; `docs/engines.md` the user-facing
half. Voice training (LoRA) was removed 2026-10-02 — no PyTorch anywhere.

**`npm run dev` runs our audio.cpp checkout, not the release (since 2026-10-03).** Our fork
(github.com/delebash/audio.cpp, branch `jv`) is checked out beside this repo at `../audio.cpp`,
the way the kit sits at `../just-llm-runner`. `npm run dev` (Quasar's `beforeDev` hook in
`quasar.config.js`) builds the checkout into `../audio.cpp/build/jv-dev` (only what changed; the first build sets the folder up
— CUDA 12.4 when installed, about 30 min — `scripts/audiocpp-dev.js`), then starts the app with
`JUSTVOICE_AUDIOCPP_BUILD` naming that build, which the server runs instead of the pinned
release, with every feature on (`server/src/engines/audiocpp/dev_build.js`). A failed build
stops `npm run dev`. The runtime row shows `audio.cpp dev · <commit>`. **Test the app this way**
— never a private audio.cpp server with a scratch config. A packaged app, `npm run server` and
the tests run the pinned release. Record: TASKS "`npm run dev` always runs the latest
audio.cpp".

**The headless launcher is `justvoice-server`, never `justvoice`.** The app's exe is
`justvoice.exe`; a launcher with the same name makes Windows resolve the bare name to the GUI exe
instead (under Tauri that spawned infinite windows). `build/launcher/justvoice-server.cmd` runs
the exe as Node (`ELECTRON_RUN_AS_NODE=1`) on `server/src/serve.js`. Never rename it to match
the exe.

**The desktop shell is the kit's** (`@delebash/llm-runner/shell`, checked against Electron's
security checklist 2026-10-08): `src-electron/electron-main.js` only names this app's settings;
the renderer reaches the shell through `src/services/native.js` alone (`window.appShell`).

**A Quasar app, laid out as its CLI creates a project** (the kit's `docs/app-structure.md` §Q): boot
files `src/boot/` (no `main.js`), `src/App.vue` a bare `<router-view>`, the chrome `src/layouts/MainLayout.vue`,
the screens `src/pages/<Name>Page.vue`, the stylesheets `src/css/`; `/dictate` and `/offline` are routes
outside the layout. The server is its own package (`server/package.json`, `justvoice-server`, a workspace;
its bundled samples in `server/samples/`).

## The renderer gate

The Playwright headless smoke is the gate for any renderer or GUI change:

```bash
npm run server -- --host 127.0.0.1 --port 8741         # background — see below
npm run build:spa
JV_BASE=http://127.0.0.1:8741 npm run smoke            # drives every view, asserts zero JS errors
```

`JV_BASE` overrides the base URL — pass it, because the script's own default is
17494, not 8741. `scripts/smoke_gui.js` screenshots tabs.

**If the app is running, gate against IT — never start the 8741 server beside
it** (2026-10-04). The 8741 server opens the app's own data folder, where
warm-on-boot is on, so the moment the smoke (or any browser) loads its UI it
loads the default chat model into a SECOND llama-server — two copies of gemma on
one 8 GB card; on 2026-10-04 it ran out of memory and fell back to the CPU. The
app's server serves the same freshly built `dist/spa/` at `/`, so:

```bash
npm run build:spa
JV_BASE=http://127.0.0.1:17494 npm run smoke           # the running app's own server
```

Use the 8741 recipe above only when the app is closed — then nothing competes
for the card. Either way the gate reads the app's database; a running app just
also runs the server code it was started with, so restart it after server edits
before trusting a server-backed check.

**One data root (since 2026-10-08).** Under Tauri a source checkout had two — the desktop
shell's `src-tauri/target/debug/data` and a bare headless run's `<repo>/data` — and a gate run
without `--data-dir` tested a database the app never opened (2026-08-21: seven "failing" views
that were fine in the app). The Electron move gave the shell and the server one ladder, and the
dev root moved to `<repo>/data`; the empty headless root that sat there was renamed aside to
`data-old-2026-08-22/`. History: `docs/plans/2026-08-21-blend-rework-and-consistency-audit.md`
§18.1, `docs/plans/2026-08-22-data-dirs-and-disk-reclaim.md` §2–3.

**Run the gate before claiming a renderer fix works, but do not mistake it for
proof of the fix.** It loads each view and counts JS errors. It does not click
tabs, load models or play audio — so a change to any of those is covered only by
whatever unit test you write for it.

**There is NO `e2e/` here** — no real-webview harness, deferred by your word on
2026-08-06 (*"for now we are not doing jv harness or deep audit…"*, tracked in
`docs/dev/TASKS.md`). This file used to claim `e2e/` was "the packaged-app check",
which was the same documented-but-not-runnable failure the browser-lookup note
below describes. JustWrite and i18n-docgen have that harness (against the built
app); when JustVoice picks it up, docgen's is the donor and
`scripts/e2e.js`, `verify_all.js` and `shots.js` retire with it — they are
browser-driven, banned as an acceptance surface on 2026-08-02.

**Browser lookup has one door — `scripts/lib/smoke-common.js`.** Import `findChrome()` or
`chromeLaunchOptions()` from it; never re-fork the lookup and never hardcode a browser path. The
implementation is the kit's `../just-llm-runner/scripts/lib/exec-resolve.js` (one copy for the
family; the door binds `JV_CHROME`): it probes `/opt/pw-browsers` (the dev container's prebuilt
browsers), `~/.cache/ms-playwright` and `%LOCALAPPDATA%\ms-playwright`, across Linux, Windows and
macOS layouts, skips `headless_shell` builds (they lack the surface these scripts drive), and
honours `JV_CHROME` above everything. Returning `undefined` is a SUCCESS value — it lets
Playwright resolve from its own registry. Node-side tooling needs the kit checked out as a
sibling — the same layout the kit UI alias (quasar.config.js) already requires.

Until 2026-07-29 every script carried its own Linux-only copy and the seven verify/parity scripts
hardcoded `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, pinned to a browser version — so
none of them could find a browser on Windows and the gate was documented as runnable when it was
not. The gate (`smoke.js`) and every verify script import the shared lookup; since 2026-08-08 the
implementation lives in the kit. The one-off snapshot scripts predating the law are not converted.

## Invariants that bite

- **Settings live in SQLite via `SettingsStore`**, reachable through `PATCH /v1/settings`; the database runs on the kit's `platform/sql.js` (better-sqlite3). `settings.json` was folded into the `settings` table and renderer UI prefs into `prefs` (the 2026-06-19 storage rewrite; `SettingsStore` imports a legacy `settings.json` once). The tables are `server/src/database/models_schema.js`. Per-artifact JSON sidecars on disk are the exception and still live: `storage/atomic.js`'s `atomicWriteJson` (tmp + rename + fsync) writes voice manifests (`storage/voices.js`).
- **`server/src/models.js` is the source of truth for the wire shapes.** The Vue client fetches directly against those shapes; the JustWrite-facing boundary rules are `docs/dev/design-decisions.md` §3.
- **A mock is production minus the plumbing.** When a mock is asked for, the only thing it may omit is the wiring — no server, no real audio, no persistence. Everything else is the deliverable: **production copy only** (never design commentary, "still a proposal", or notes on what changed), **nav and controls that actually work**, **real enum values and labels verified in the code** (an invented-but-plausible option is worse than a missing one), **real states** — empty, blocked, stale, error — not just the happy path, **counts and names consistent across every screen**, **no leftovers from earlier drafts**, and the app's own tokens and density. Audit the whole file before publishing, not just the screen last edited.

  **A mock is built in the app itself** (decided 2026-10-04 — the HTML mock shared only the tokens, so screens built with the real controls never looked like it): a Vue page in `src/pages/mock/` (its pieces in `src/components/mock/`, its made-up data in `src/services/mock/`) on the kit's own components and the app's own classes, with made-up data and no server, reached at `#/mock/...` under `npm run dev` only (`src/router/mockRoutes.js`; a packaged build leaves it out). A shape the app doesn't have yet is promoted into `src/css/app.scss` first, so the real page reuses it. Before calling a screen done, screenshot the mock and the app at the same width and list every difference. Record: `docs/plans/2026-10-04-persona-voice-making.md` §2. The old HTML mock in `docs/plans/mock/` is **frozen** (decided 2026-10-04): no more edits. It stays only as the picture of screens not yet redone, and each is drawn fresh in the app when its work starts; anything new is drawn only in the app. The Personas list and persona page already are.
- **Before UI work or a design sweep, read `docs/dev/design-law.md`** — the method, the class inventory and the 7-point conformance checklist. A shape no page has yet is promoted into `src/css/app.scss` as a canonical class, never a scoped one-off.
- **Upstream library and model facts** (licences, parameters, capabilities) get checked on the web, never recalled.

## What goes where

| Concern | Layer |
|---|---|
| TTS/STT models + the speech runtime | `server/src/engines/<engine>/manifest.js` (catalog) · `engines/audiocpp/` (runtime + request mapping) |
| Storage — settings, voices, profiles, projects, chapters, takes, generations, lexicons, personas, story items, renderer prefs | `server/src/storage/` + `database/` |
| Render orchestration + cache | `server/src/render_core.js`, `api/render_chapter_api.js` |
| Audio math — effects, speed/gain/pitch, joins, trim, resampling, analyzer, blends | our fork's `dsp/` (`audiocpp_dsp`), reached through `server/src/audio/dsp_client.js` |
| WAV headers, mastering | `server/src/audio/`, `mastering.js` |
| API endpoints | `server/src/api/<area>_api.js` (registered in `server/src/app.js`) |
| Request/response shapes | `server/src/models.js` |
| UI components and pages | `src/components/`, `src/pages/`, the chrome `src/layouts/MainLayout.vue` |
| Pinia stores (api, toasts, tasks) | `src/stores/` |
| Desktop-only concerns (file picker, OS paths, tray) | the kit's shell, reached through `src/services/native.js`; `src-electron/electron-main.js` names the settings |

Renderer/server are larger here than in JustWrite, and a few stores are domain-rich (engines,
takes, generation). That is scope, not drift.

## Who it is for

Five audiences sharing one engine pool, voice profiles, lexicons and personas — differentiation
lives in the import/export pipelines and per-use-case surfaces: **audiobook producers** (the
primary differentiator — long-form narration, multi-character casting, pronunciation discipline,
ACX-spec mastering, the JustWrite workflow), **game developers** (Unreal, NPC dialogue at 50–500
line scale, per-line WAV + JSON sidecar), **podcasters** (multi-track Stories timeline,
paralinguistic tags, effects chain), **dictation users** (global hotkey, system audio capture, MCP
server), and **accessibility users** (real-time TTS, screen-reader integration — future).

## Where to look

**Before researching anything — reading code to answer a question, measuring, briefing an agent — read the subject's section of `docs/dev/RESEARCH.md`** (what is already known, with the proof; the family rule, 2026-10-04). Research isn't done until its facts land there.

| For | Read |
|---|---|
| The JustWrite ↔ JustVoice boundary | `docs/dev/design-decisions.md` §3 (archived original: `docs/plans/archive/CONTRACT.md`) |
| UI design method, class inventory, sweep checklist | `docs/dev/design-law.md` |
| Open work across all three repos | `../justwrite-app/docs/TASKS.md` |
| The shared AI-stack ledger | `../just-llm-runner/docs/plans/archive/2026-07-06-outstanding-master-plan.md` |
| Per-task history and evidence | `docs/plans/*` |
| Product scope and feature history | `docs/plans/archive/FEATURES.md`, `docs/plans/archive/DESIGN_FREEZE.md` (both historical records) |

Read branch and working-tree state from git, never from a doc.
