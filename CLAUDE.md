# JustTTS — agent instructions

**A cross-platform open-source TTS server built for audiobook production. Tauri + Vue + Python.**

## ⛔ RULE #0 — NEVER ASK FOR PERMISSION

The user has told Claude 5+ times across past sessions to stop asking permission. The pattern keeps recurring. Read this rule before you write any sentence ending in `?` or any phrase from the blocklist:

**Blocked phrasing — never say these:**
- "Want me to ...?"
- "Should I ...?"
- "Let me know if ..."
- "If you want me to ..., say go"
- "Anything else before I proceed?"
- "Want me to keep going / pause to test?"
- Any A/B/C option list ending in "which one?"
- Any soft closing question shape

**You have full permission. Forever. In every scope of this project:**
- Edit / add / delete files
- Run shell commands (cargo, npm, pip, python, git, gh)
- Cargo fmt / cargo check / cargo test / cargo build
- Git operations (commit, push, branch)
- Web research (WebFetch, WebSearch)
- Save / update memory files
- Make design decisions on multi-option forks
- Move between phases of approved multi-phase plans

Confirm only for genuinely destructive ops (`git reset --hard`, force-push to main, dropping data, deleting work).

**Correct turn-ending shape**: one-sentence factual report ("Phase X done, files: ...") immediately followed by the next tool call. NO question at the end. If work is genuinely complete or blocked, a flat statement of that fact.

## REQUIRED reading order, every session

1. This file
2. `MORNING_RECAP.md` in this repo — current state, what shipped recently, where to pick up
3. `~/.claude/projects/E--Dev-Web-justtts/memory/MEMORY.md` — scan all linked memories, especially `project_state`, `project_gotchas`, `project_architecture_pivot`
4. `~/.claude/projects/E--Dev-Web-justwrite-app/memory/project_tts_picks.md` — TTS architecture canon (still applies post-pivot)

**If you skip step 3 you will**: re-propose abandoned approaches (Rust core, Docker, forking voicebox), break the dev loop with the spawn-loop bug, miss the JustWrite-component-reuse directive, hallucinate file paths.

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
cd server && pip install -e .[kokoro]
justtts-server serve     # NOT `justtts serve` — see project_gotchas memory

# Build production installer
npm run tauri build
```

**Important — naming**: the Python console script is `justtts-server`, not `justtts`. The Tauri binary is `justtts.exe`; using the same name for both causes Windows `CreateProcessW` to resolve `Command::new("justtts")` to the Tauri binary itself, spawning infinite windows. Never revert the rename.

## What this app is for

Audiobook producers. Long-form narration. Multi-character casting via personas. Pronunciation discipline via lexicons. ACX-spec mastering. The architecture also handles general TTS workloads (podcasting, accessibility, game dialogue) but the feature shape is driven by the audiobook use case.
