# JustTTS — agent instructions

**A cross-platform open-source TTS server built for audiobook production. Tauri + Vue + Python.**

## ⛔ RULE #0 — NEVER ASK FOR PERMISSION

You have full permission in this repo: edit files, run shell commands, run cargo / npm / pip, run git operations, do web research, save memory, make design decisions. Confirm only for genuinely destructive actions (force-push to main, dropping data, deleting work).

Don't end turns with questions. State what changed, then stop.

## Architecture

Three layers:

1. **`src-tauri/`** — Tauri 2 desktop shell. Pure plumbing: spawn the Python sidecar, host the webview, shut down cleanly. Don't put any business logic here. Mirrors JustWrite's Tauri shell.

2. **`src/renderer/`** — Vue 3 + Vite single-page app. Pinia stores for state. Components in `src/renderer/src/components/`. Views (one per tab) in `src/renderer/src/views/`. Talks HTTP to the Python server.

3. **`server/justtts/`** — Python 3.10+ FastAPI server. All business logic: engines, storage, render pipeline, mastering, cache, API. PyTorch-based engines run in-process. Kokoro runs through `sherpa-onnx-python`.

## What goes where

| Concern | Layer |
|---|---|
| TTS model loading + inference | `server/justtts/engines/<engine>.py` |
| Storage (settings, voices, personas, lexicons, training jobs) | `server/justtts/storage/` |
| Render orchestration + cache | `server/justtts/render_core.py` |
| Audio analyzer + WAV math | `server/justtts/audio/` |
| API endpoints | `server/justtts/api/<area>_api.py` |
| Pydantic models (request/response shapes) | `server/justtts/models.py` |
| UI components + views | `src/renderer/src/components/` and `views/` |
| Pinia stores (api, toasts, tasks) | `src/renderer/src/stores/` |
| Desktop-only concerns (file picker, OS-level paths) | `src-tauri/src/lib.rs` |

## Project rules

- **Python**: ruff for lint, pytest for tests. Run `ruff check` + `pytest` before committing.
- **Vue**: prefer single-file components. Don't introduce CSS frameworks — Mercury aesthetic in `styles.css` is the canon.
- **Rust** (Tauri shell): keep minimal. If you find yourself writing business logic in Rust, move it to Python.
- **No hardcoded operator-tunable values** — every knob should be in `settings.json` + reachable via `PATCH /v1/settings`.
- **All commits**: ruff + pytest pass.
- **Cross-language API stability**: Pydantic models in `server/justtts/models.py` are the source of truth. The Vue client uses fetch directly against the OpenAPI shape.

## How to run

```bash
# Dev (Tauri + Vite + Python sidecar all running)
npm install
cd server && pip install -e .[kokoro] && cd ..
npm run tauri dev

# Headless (Python server only — same UI via /ui/)
cd server && pip install -e .[kokoro] && justtts serve

# Build production installer
npm run tauri build
```

## What this app is for

Audiobook producers. Long-form narration. Multi-character casting via personas. Pronunciation discipline via lexicons. ACX-spec mastering. The architecture also handles general TTS workloads (podcasting, accessibility, game dialogue) but the feature shape is driven by the audiobook use case.
