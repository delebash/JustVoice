# JustVoice

A cross-platform voice production server: **Tauri 2 shell + Vue 3 renderer + Python (FastAPI +
SQLite) server**, with PyTorch TTS engines in-process and Kokoro through `sherpa-onnx-python`.
Also runs **headless** as `justvoice-server serve`, no Tauri shell.

Standalone product. JustWrite drives JustVoice for audiobooks — JW hands over the prose, JV does
its own casting and narration — but JustVoice does not depend on JustWrite. The boundary rules
live in `docs/dev/design-decisions.md` §3 — read them before touching anything cross-app. (The
original `CONTRACT.md` was archived to `docs/plans/archive/` by the 2026-08-04 docs campaign;
its endpoint table is stale — trust `server/justvoice/api/*` route literals.)

The AI/LLM stack is shared with JustWrite: `just-llm-runner` (Python) + `@delebash/llm-ui` (Vue).
Only TTS and each app's feature catalog differ. A change in those repos lands here too.

## Commands

```bash
npm install
cd server && pip install -e . && cd ..   # engines install their own venvs from the app
npm run tauri dev                  # Tauri + Vite + Python sidecar (dev port 1430, HMR 1431)
npm run tauri build                # production installer

justvoice-server serve             # headless; same UI at /ui/
cd server && ruff check . && pytest    # both must pass before a commit
npm run check:engines              # per-engine: manifest vs venv, pins vs upstream
```

**Engines install themselves, one venv each.** Clicking Install on an engine row
builds `engines/<id>/.venv` on Python 3.13 from that manifest alone — uv downloads a
managed CPython if the machine has none, so nothing has to be installed by hand. The
server itself is separate: `pip install -e .` in a dev checkout, a frozen PyInstaller
sidecar in a release, and it never touches the uv cache. `docs/dev/code-map.md` §3e is
the mechanism; `docs/engines.md` is the user-facing half.

**The console script is `justvoice-server`, never `justvoice`.** The Tauri binary is
`justvoice.exe`; giving both the same name makes Windows `CreateProcessW` resolve
`Command::new("justvoice")` to the Tauri binary itself and spawn infinite windows. Never revert
that rename — the Python package and console-script names stay as they are until a deliberate
rename PR that preserves this fix.

## The renderer gate

The Playwright headless smoke is the gate for any renderer or GUI change:

```bash
justvoice-server serve --host 127.0.0.1 --port 8741 \
  --data-dir src-tauri/target/debug/data              # background — see below
npm run build:vite
JV_BASE=http://127.0.0.1:8741 npm run smoke            # drives every view, asserts zero JS errors
```

`JV_BASE` overrides the base URL — pass it, because the script's own default is
17494, not 8741. `scripts/smoke_gui.js` screenshots tabs.

**`--data-dir` is not optional in development.** There are two data roots in a
source checkout and they are NOT the same database. The desktop shell resolves
`exe_dir()/data`, which in `tauri dev` is `src-tauri/target/debug/data`, and
hands it to the sidecar as `JUSTVOICE_DATA_DIR`. A bare headless run has no such
variable and falls through to `install_dir()`, which unfrozen is the **checkout
root** — a second, usually much older `<repo>/data`. In a packaged build both
resolve to the frozen executable's folder, so this divergence exists only in
dev. Omit the flag and the gate tests a database the app never opens: on
2026-08-21 that produced seven "failing" views that were fine in the app. The
reasoning and the ladder are in
`docs/plans/2026-08-21-blend-rework-and-consistency-audit.md` §18.1.

**Run the gate before claiming a renderer fix works, but do not mistake it for
proof of the fix.** It loads each view and counts JS errors. It does not click
tabs, load models or play audio — so a change to any of those is covered only by
whatever unit test you write for it.

**There is NO `e2e/` here** — no real-webview harness, deferred by your word on
2026-08-06 (*"for now we are not doing jv harness or deep audit…"*, tracked in
`docs/dev/TASKS.md`). This file used to claim `e2e/` was "the packaged-app check",
which was the same documented-but-not-runnable failure the browser-lookup note
below describes. JustWrite and i18n-docgen have that harness (tauri-driver against
the built binary); when JustVoice picks it up, docgen's is the donor and
`scripts/e2e.js`, `verify_all.js` and `shots.js` retire with it — they are
browser-driven, banned as an acceptance surface on 2026-08-02.

**Browser lookup has one door — `scripts/lib/smoke-common.js`.** Import `findChrome()` or
`chromeLaunchOptions()` from it; never re-fork the lookup and never hardcode a browser path. The
implementation is the kit's `../just-llm-runner/scripts/lib/exec-resolve.mjs` (one copy for the
family; the door binds `JV_CHROME`): it probes `/opt/pw-browsers` (the dev container's prebuilt
browsers), `~/.cache/ms-playwright` and `%LOCALAPPDATA%\ms-playwright`, across Linux, Windows and
macOS layouts, skips `headless_shell` builds (they lack the surface these scripts drive), and
honours `JV_CHROME` above everything. Returning `undefined` is a SUCCESS value — it lets
Playwright resolve from its own registry. `scripts/py.js` rides the same kit resolver
(`JV_PYTHON`, `server/.venv`), so node-side tooling needs the kit checked out as a sibling —
the same layout the vite alias already requires.

Until 2026-07-29 every script carried its own Linux-only copy and the seven verify/parity scripts
hardcoded `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, pinned to a browser version — so
none of them could find a browser on Windows and the gate was documented as runnable when it was
not. The gate (`smoke.js`) and every verify script import the shared lookup; since 2026-08-08 the
implementation lives in the kit. The one-off snapshot scripts predating the law are not converted.

## Invariants that bite

- **No hardcoded operator-tunable values.** Every knob lives in settings (SQLite via `SettingsStore`) and is reachable through `PATCH /v1/settings`.
- **SQLite via SQLAlchemy is the primary persistence layer**, and there is no renderer-side store. `settings.json` was folded into the `settings` table and renderer UI prefs into `prefs` (the 2026-06-19 storage rewrite; `SettingsStore` imports a legacy `settings.json` once). Per-artifact JSON sidecars on disk are the exception and still live: `storage/atomic.py`'s `atomic_write_json` (tmp + `os.replace` + fsync) writes voice manifests (`storage/voices.py`) and training-job records (`storage/training_jobs.py`).
- **`server/justvoice/models.py` is the cross-language source of truth.** The Vue client fetches directly against the OpenAPI shape; the JustWrite-facing boundary rules are `docs/dev/design-decisions.md` §3.
- **Business logic never goes in Rust.** `src-tauri/` is plumbing — spawn the sidecar, host the webview, shut down cleanly. If you are writing logic there, it belongs in Python.
- **Every file carries an SPDX-License-Identifier header.** Files lifted from an upstream MIT codebase also carry a full attribution block referencing `voicebox-pin.txt`. Ship license is MIT.
- **A mock is production minus the plumbing.** When a mock is asked for, the only thing it may omit is the wiring — no server, no real audio, no persistence. Everything else is the deliverable: **production copy only** (never design commentary, "still a proposal", or notes on what changed), **nav and controls that actually work**, **real enum values and labels verified in the code** (an invented-but-plausible option is worse than a missing one), **real states** — empty, blocked, stale, error — not just the happy path, **counts and names consistent across every screen**, **no leftovers from earlier drafts**, and the app's own tokens and density. Audit the whole file before publishing, not just the screen last edited.
- **Precedent before pattern** — before adding any UI surface, name the existing view that already solves that shape and use its canonical class; if nothing exists, promote a new canonical class into `styles.css` rather than a scoped one-off. The method, the class inventory and the 7-point conformance checklist are in `docs/dev/design-law.md`. Read it before UI work or a design sweep.
- **Nothing gets hand-rolled that `@delebash/llm-ui` already ships.** Not just form fields — this rule covers **every** repeated UI surface: tables, sliders, progress, modals, tabs, empty states, toasts, dialogs, long-running tasks. The `Jv*` forks were deleted 2026-06-23; there is no local `components/ui/`.

  **Check before you build.** The inventory is `../just-llm-runner/ui/src/common/index.js` and `ui/src/index.js` — read the export list, then read the component's own header comment, which documents its full prop/slot API. As of 2026-08-21 that includes:

  | Shape | Use | Never |
  |---|---|---|
  | fields | `UiInput` `UiSecretInput` `UiTextarea` `UiNumber` `UiSelect` `UiMultiSelect` `UiCheckbox` `UiToggle` `UiSlider` `UiColorPicker` `UiField` | a raw `<input>`, `<select>`, `<textarea>` |
  | buttons / labels | `UiButton` `UiTag` `UiChip` `UiSegmented` `Icon` | a raw `<button>` outside a control's internals |
  | data grids | `UiTable` — sorting, filtering, pagination, `#empty`, per-cell and per-header slots, `:full-width-row`, `:row-class` | a hand-rolled `<table>` with its own sort state |
  | progress | `UiProgress`, and `DownloadBar` + `createDownloadTask` for anything long-running | a bespoke `<div>` with a width percentage |
  | shells / chrome | `SettingsShell` `PaneHeader` `Breadcrumb` `AppModal` `AppDialog` `EmptyState` `ConnectionError` `HelpDrawer` | a scoped copy of a strip or panel another view already has |
  | services | `pushToast` `confirmDialog` `promptDialog` `openPath` `openExternal` `saveBlob` `languageName` `fmtBytes` | a local re-implementation |

  **A gap is filled in the kit, not worked around locally.** If the kit component is 95 % right, add the missing prop *there* — every app gains it and the next adopter does not re-hit the wall. Two worked examples from 2026-08-21: `UiSlider` and `languageNames` did not exist and were added to the kit; `UiTable` could class a banner row but not a record row, so it gained `:row-class` rather than the consumer pushing state onto an inner div. Kit changes are additive by default — verify by building **both** consumer apps before committing.

  **Adopting a kit component is not automatically a win.** Check what you lose: a hand-rolled surface often carries per-row state, a keyboard path, or a class hook the kit component has no slot for. Find that first and either close the gap in the kit or say plainly what regressed — silently dropping it is how `.row-orphan` ended up styling one cell.
- **Reuse extends to this app's own services, not just the kit.** Before writing a fetch-and-poll, a task, or a channel, check `src/services/` — `ttsJobChannel.js` already wraps engine install/download in the kit's task shape. Two call sites building the same `createDownloadTask({…})` by hand is a copy, and copies share bugs: an engine load has no status endpoint, so both places fake the channel — and Retry therefore re-arms a poll loop that never reaches a terminal and never loads anything. One shared `makeEngineLoadTask` would let that be fixed once.
- **Verify feature-parity claims against upstream file by file**, never from a summary. The failure mode is lifted-but-not-wired code — an auto-chunking module landed but was not imported by the generate API for weeks. Upstream library and model facts (licences, parameters, capabilities) get checked on the web, never recalled.

## What goes where

| Concern | Layer |
|---|---|
| TTS model loading + inference | `server/justvoice/engines/<engine>/` (`manifest.py` + `engine.py` per engine) |
| Storage — settings, voices, profiles, projects, chapters, takes, generations, lexicons, personas, story items, renderer prefs | `server/justvoice/storage/` + `database/` |
| Render orchestration + cache | `server/justvoice/render_core.py`, `api/render_chapter_api.py` |
| Audio analyzer, WAV math, mastering | `server/justvoice/audio/`, `mastering.py` |
| API endpoints | `server/justvoice/api/<area>_api.py` |
| Request/response shapes | `server/justvoice/models.py` |
| UI components and views | `src/components/`, `views/` |
| Pinia stores (api, toasts, tasks) | `src/stores/` |
| Desktop-only concerns (file picker, OS paths) | `src-tauri/src/lib.rs` |

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

| For | Read |
|---|---|
| The JustWrite ↔ JustVoice boundary | `docs/dev/design-decisions.md` §3 (archived original: `docs/plans/archive/CONTRACT.md`) |
| UI design method, class inventory, sweep checklist | `docs/dev/design-law.md` |
| Open work across all three repos | `../justwrite-app/docs/TASKS.md` |
| The shared AI-stack ledger | `../just-llm-runner/docs/plans/archive/2026-07-06-outstanding-master-plan.md` |
| Per-task history and evidence | `docs/plans/*` |
| Product scope and feature history | `docs/plans/archive/FEATURES.md`, `docs/plans/archive/DESIGN_FREEZE.md` (both historical records) |

Read branch and working-tree state from git, never from a doc.
