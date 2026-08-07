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
cd server && pip install -e .[kokoro] && cd ..
npm run tauri dev                  # Tauri + Vite + Python sidecar (dev port 1430, HMR 1431)
npm run tauri build                # production installer

justvoice-server serve             # headless; same UI at /ui/
cd server && ruff check . && pytest    # both must pass before a commit
```

**The console script is `justvoice-server`, never `justvoice`.** The Tauri binary is
`justvoice.exe`; giving both the same name makes Windows `CreateProcessW` resolve
`Command::new("justvoice")` to the Tauri binary itself and spawn infinite windows. Never revert
that rename — the Python package and console-script names stay as they are until a deliberate
rename PR that preserves this fix.

## The renderer gate

The Playwright headless smoke is the gate for any renderer or GUI change:

```bash
justvoice-server serve --host 127.0.0.1 --port 8741   # background
npm run build:vite
node scripts/smoke.js                                  # drives every view, asserts zero JS errors
```

`scripts/smoke_gui.js` screenshots tabs. `e2e/` (tauri-driver against the built binary) is the
packaged-app check, not the quick gate. `JV_BASE` overrides the base URL.

**Browser lookup lives in one place — `scripts/lib/smoke-common.js`.** Import `findChrome()` or
`chromeLaunchOptions()` from it; never re-fork the lookup and never hardcode a browser path. It
probes `/opt/pw-browsers` (the dev container's prebuilt browsers), `~/.cache/ms-playwright` and
`%LOCALAPPDATA%\ms-playwright`, across Linux, Windows and macOS layouts, skips `headless_shell`
builds (they lack the surface these scripts drive), and honours `JV_CHROME` above everything.
Returning `undefined` is a SUCCESS value — it lets Playwright resolve from its own registry.

Until 2026-07-29 every script carried its own Linux-only copy and the seven verify/parity scripts
hardcoded `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, pinned to a browser version — so
none of them could find a browser on Windows and the gate was documented as runnable when it was
not. All eight now import the shared resolver.

## Invariants that bite

- **No hardcoded operator-tunable values.** Every knob lives in settings (SQLite via `SettingsStore`) and is reachable through `PATCH /v1/settings`.
- **SQLite via SQLAlchemy is the primary persistence layer**, and there is no renderer-side store. `settings.json` was folded into the `settings` table and renderer UI prefs into `prefs` (the 2026-06-19 storage rewrite; `SettingsStore` imports a legacy `settings.json` once). Per-artifact JSON sidecars on disk are the exception and still live: `storage/atomic.py`'s `atomic_write_json` (tmp + `os.replace` + fsync) writes voice manifests (`storage/voices.py`) and training-job records (`storage/training_jobs.py`).
- **`server/justvoice/models.py` is the cross-language source of truth.** The Vue client fetches directly against the OpenAPI shape; the JustWrite-facing boundary rules are `docs/dev/design-decisions.md` §3.
- **Business logic never goes in Rust.** `src-tauri/` is plumbing — spawn the sidecar, host the webview, shut down cleanly. If you are writing logic there, it belongs in Python.
- **Every file carries an SPDX-License-Identifier header.** Files lifted from an upstream MIT codebase also carry a full attribution block referencing `voicebox-pin.txt`. Ship license is MIT.
- **Precedent before pattern** — before adding any UI surface, name the existing view that already solves that shape and use its canonical class; if nothing exists, promote a new canonical class into `styles.css` rather than a scoped one-off. The method, the class inventory and the 7-point conformance checklist are in `docs/dev/design-law.md`. Read it before UI work or a design sweep.
- **Form primitives come from `@delebash/llm-ui`** (`UiButton`, `UiInput`, `UiSelect`, `UiToggle`, `UiCheckbox`, `UiField`, `UiTag`, `UiChip`). The `Jv*` forks were deleted 2026-06-23; there is no local `components/ui/`. A gap gets solved in the kit so both apps get it.
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
