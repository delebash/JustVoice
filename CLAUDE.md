# JustVoice — agent instructions

**A cross-platform open-source voice production server. Tauri + Vue + Python.**

Product name: **JustVoice**. The Python package + console-script names (`justtts` / `justtts-server`) are kept as technical identifiers until a deliberate rename PR — the `justtts-server` naming-collision fix from `project_gotchas` must be preserved through the rename. References to "JustTTS" in older memory files refer to the same product under its prior name.

Serves audiobook production, game dialogue (Unreal), podcasting, dictation, and accessibility. Standalone product — JustWrite drives JustVoice for audiobooks but JustVoice does not depend on JustWrite. See `CONTRACT.md` for the JustWrite↔JustVoice HTTP boundary. Also runs **headless** as `justtts-server serve` (no Tauri shell), same as voicebox's headless mode.

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

**One exception**: UX design direction during Phase 4. The user explicitly said this is the only blocker — pause for visual-direction feedback before doing UX-redesign work that depends on it.

## Session-start reading

On a fresh session you'll already have:
- This file (`CLAUDE.md`) auto-loaded
- The memory index (`~/.claude/projects/E--Dev-Web-justtts/memory/MEMORY.md`) auto-loaded — every memory file has a one-line description there

What to do at session start:
1. Read `MORNING_RECAP.md` in this repo — single file, gets you to the current state of code, what shipped, what's pending
2. Read `CONTRACT.md` if any work touches the JustWrite↔JustTTS boundary
3. Look at the memory-index one-liners — note which exist; don't read them yet
4. When a question or task touches a topic an index entry covers, **then** read that specific memory file before answering

**Highest-priority memory files** (load before touching the relevant code):

- `project_final_architecture` — current architectural plan (NOT forking voicebox; lifting patterns; JustTTS=engine pool, JustWrite=audiobook orchestration). READ FIRST.
- `project_use_cases` — multi-use (audiobook + game + podcast + dictation); ALL voicebox features in scope.
- `project_licensing_attribution` — per-file SPDX headers + lifted-file attribution blocks; current Apache-2.0, flips to GPL-3.0-or-later when pedalboard lands.
- `feedback_ultracode_usage_rule` — when to invoke ultracode vs solo Opus vs Sonnet subagent.
- `project_gotchas` — `justtts-server` rename, native-dialog ban, Tauri spawn-loop fix. Load before debugging boot failures.
- `feedback_user_preferences` — terse reports, no permission-asking, verify by running code.

**Failure modes from prior sessions** (signals you missed the relevant memory): proposing forking voicebox after 2026-06-08 (we decided NOT to fork), proposing Rust anywhere, Docker, asking permission, using native dialogs, hallucinating file paths, re-investigating decisions already made. If you catch yourself about to do any of these, that's the cue to load the matching memory file.

## Architecture

Three layers:

1. **`src-tauri/`** — Tauri 2 desktop shell. Pure plumbing: spawn the Python sidecar, host the webview, shut down cleanly. Don't put business logic here.

2. **`src/renderer/`** — Vue 3 + Vite single-page app. Pinia stores for state. Components in `src/renderer/src/components/`. Views (one per tab) in `src/renderer/src/views/`. Talks HTTP to the Python server.

3. **`server/justtts/`** — Python 3.10+ FastAPI server. All business logic: engines, storage, render pipeline, mastering, cache, API. PyTorch-based engines run in-process. Kokoro runs through `sherpa-onnx-python`. SQLite (via SQLAlchemy) is the primary persistence layer.

## What goes where

| Concern | Layer |
|---|---|
| TTS model loading + inference | `server/justtts/engines/<engine>/` (manifest.py + engine.py per engine) |
| Storage (settings, voices, profiles, projects, chapters, takes, generations, lexicons, personas, story_items) | `server/justtts/storage/` (SQLite via SQLAlchemy + atomic JSON for `settings.json` only) |
| Render orchestration + cache | `server/justtts/render_core.py` + `server/justtts/api/render_chapter_api.py` |
| Audio analyzer + WAV math + mastering | `server/justtts/audio/` + `server/justtts/mastering.py` |
| API endpoints | `server/justtts/api/<area>_api.py` |
| Pydantic models (request/response shapes) | `server/justtts/models.py` |
| UI components + views | `src/renderer/src/components/` and `views/` |
| Pinia stores (api, toasts, tasks) | `src/renderer/src/stores/` |
| Desktop-only concerns (file picker, OS-level paths) | `src-tauri/src/lib.rs` |

## Project rules

- **Python**: ruff for lint, pytest for tests. Run `ruff check` + `pytest` before committing.
- **Vue**: prefer single-file components. **Mercury aesthetic is being dropped in Phase 4** for a distinct multi-use visual identity (decision deferred to Phase 4 design pass — see `project_final_architecture`). No CSS framework — `styles.css` carries the canonical design tokens.
- **Rust** (Tauri shell): keep minimal. If you find yourself writing business logic in Rust, move it to Python.
- **No hardcoded operator-tunable values** — every knob lives in `settings.json` + reachable via `PATCH /v1/settings`.
- **All commits**: ruff + pytest pass.
- **Cross-language API stability**: Pydantic models in `server/justtts/models.py` are the source of truth. The Vue client uses fetch directly against the OpenAPI shape. The CONTRACT.md endpoint list is the JustWrite-facing surface.
- **Storage**: SQLite (via SQLAlchemy) is the primary persistence layer for everything except user-editable preferences. `settings.json` is the ONLY remaining atomic-JSON store. The migration from atomic JSON to SQLite happens in Phase 1.5.
- **Licensing**: every file gets an SPDX-License-Identifier header. Lifted/ported/translated files from voicebox get a full attribution block referencing `voicebox-pin.txt`. See `project_licensing_attribution` memory for templates and CI guards.

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

JustTTS / JustVoice is a voice production studio for FIVE distinct audiences:

1. **Audiobook producers** (primary differentiator). Long-form narration. Multi-character casting via personas. Pronunciation discipline via lexicons. ACX-spec mastering. JustWrite-driven workflow via CONTRACT.md.
2. **Game developers** (Unreal Engine integration). NPC dialogue at 50–500 character scale. Per-line WAV + JSON sidecar export. Future `.uplugin` for Unreal Editor.
3. **Podcasters**. Multi-track Stories timeline, paralinguistic tags, effects chain.
4. **Dictation users**. Global hotkey, system audio capture, MCP server for agent-driven workflows.
5. **Accessibility users**. Real-time TTS, screen-reader integration (future).

All five use cases share the same engine pool + voice profiles + lexicons + personas. Differentiation is in import/export pipelines + per-use-case UI surfaces.
