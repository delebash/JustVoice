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

## Session-start reading

On a fresh session you'll already have:
- This file (`CLAUDE.md`) auto-loaded
- The memory index (`~/.claude/projects/E--Dev-Web-justtts/memory/MEMORY.md`) auto-loaded — every memory file has a one-line description there

What to do at session start:
1. Read `MORNING_RECAP.md` in this repo — single file, gets you to the current state of code, what shipped, what's pending
2. Look at the memory-index one-liners — note which exist; don't read them yet
3. When a question or task touches a topic an index entry covers, **then** read that specific memory file before answering

Read-on-demand, not bulk-read. Specifically: read `project_architecture_pivot` before any architecture proposal; read `project_gotchas` before debugging a boot failure; read `feedback_user_preferences` if uncertain about tone or permission norms; read `reference_repo_layout` instead of grepping for file paths; read `project_phase5_engine_flips` when touching blend or train; read `reference_justwrite_components` before building a new UI primitive; read `reference_legacy_repo` if asked about the old code. The other index entries follow the same pattern — the one-liner tells you when to load the full file.

**Failure modes from prior sessions** (signals you missed the relevant memory): proposing Rust anywhere, forking voicebox, Docker, asking permission, using native dialogs, hallucinating file paths, re-investigating decisions already made. If you catch yourself about to do any of these, that's the cue to load the matching memory file.

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
