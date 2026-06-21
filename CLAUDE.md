# JustVoice — agent instructions

**A cross-platform open-source voice production server. Tauri + Vue + Python.**

Product name: **JustVoice**. The Python package + console-script names (`justvoice` / `justvoice-server`) are kept as technical identifiers until a deliberate rename PR — the `justvoice-server` naming-collision fix from `project_gotchas` must be preserved through the rename. References to "JustVoice" in older memory files refer to the same product under its prior name.

Serves audiobook production, game dialogue (Unreal), podcasting, dictation, and accessibility. Standalone product — JustWrite drives JustVoice for audiobooks but JustVoice does not depend on JustWrite. See `CONTRACT.md` for the JustWrite↔JustVoice HTTP boundary. Also runs **headless** as `justvoice-server serve` (no Tauri shell).

> **Global rules** (`~/.claude/CLAUDE.md`) govern — the two PRIORITY rules + RULES #0–8 + the shared Vue 3 + Tauri 2 app standard. This file is JustVoice architecture + app-specific rules only; it does NOT restate the global rules.

## Session-start reading

On a fresh session you'll already have:
- This file (`CLAUDE.md`) auto-loaded
- The memory index (`~/.claude/projects/E--Dev-Web-justvoice/memory/MEMORY.md`) auto-loaded — every memory file has a one-line description there

What to do at session start:
1. Read `MORNING_RECAP.md` in this repo — single file, gets you to the current state of code, what shipped, what's pending
2. Read `CONTRACT.md` if any work touches the JustWrite↔JustVoice boundary
3. Look at the memory-index one-liners — note which exist; don't read them yet
4. When a question or task touches a topic an index entry covers, **then** read that specific memory file before answering

**Plans live in the repo (user rule, 2026-06-11).** Plan-mode files in
the container (`~/.claude/plans/`) are ephemeral — they die with the
session. When a plan is approved, copy it verbatim into
`docs/plans/<date>-<slug>.md` and commit it with the work that executes
it; if the plan is amended mid-execution (user decisions, verified
findings), update the repo copy in the same commit series. Past plans in
`docs/plans/` are project history — read the relevant one before
re-planning work in the same area.

**Highest-priority memory files** (load before touching the relevant code):

- ⛔ `feedback_upstream_audit_hard_rule` — **MANDATORY on every session, every feature touch.** (A) Feature-parity claims against any upstream codebase verified file-by-file, never from summaries — lifted-but-not-wired code is the failure mode (e.g. auto-chunking module landed but wasn't imported by the generate API for weeks). (B) Upstream library/model questions (license, parameters, capabilities) go to WebSearch/WebFetch/Context7 FIRST, never training-data recall (fabricated Chatterbox emotion enum, 2026-06-09). LOAD AND APPLY BEFORE ANY OTHER MEMORY.
- `reference_engine_capability_surface` — per-engine knob/inline-tag/pitch/cloning surfaces verified from upstream model cards + adapter line-level audits. Drives Generate UI + capability manifest endpoint.
- `project_final_architecture` — current architectural plan (JustVoice = engine pool; JustWrite = audiobook orchestration). READ FIRST.
- `project_use_cases` — multi-use (audiobook + game + podcast + dictation); full production studio scope.
- `project_licensing_attribution` — per-file SPDX headers + lifted-file attribution blocks (lifted code carries an MIT header pointing at `voicebox-pin.txt`); ship license is GPL-3.0-or-later.
- `feedback_ultracode_usage_rule` — when (rarely) to invoke ultracode. **User disabled subagent delegation 2026-06-09 — do all work inline by default.**
- `project_gotchas` — `justvoice-server` rename, native-dialog ban, Tauri spawn-loop fix. Load before debugging boot failures.
- `feedback_user_preferences` — terse reports, no permission-asking, verify by running code.

## ⛔ RULE #1 — PRECEDENT BEFORE PATTERN (UI work)

Root cause of a whole inconsistency class (user-hit repeatedly,
2026-06-12: bubble sub-nav next to Settings' tab strip, + New buttons
on different sides, three interaction patterns across four library
views): reaching for the nearest component instead of checking what
the app already does for the same job.

**Before adding ANY UI surface (toolbar, tab strip, list, dialog,
button row), STOP and answer in writing — in the code comment or
commit message — two questions:**
1. *Which existing view already solves this shape?* Name the file and
   the canonical class (e.g. `.jv-subnav`, `.jv-lib-toolbar`,
   table+dialog pattern). Then USE it.
2. *If genuinely nothing exists*, promote a NEW canonical class to
   `styles.css` first — never a scoped one-off — so the next view has
   a precedent to find.

A grep for the obvious class names (`jv-subnav`, `jv-lib-toolbar`,
`jv-table`, `jv-overlay`) costs 5 seconds; the user paying for the
inconsistency costs a test round. Canonical inventory so far:
`.jv-subnav` (tabbed views) · `.jv-lib-toolbar` (search → filter chips
→ data dropdowns → spacer → actions, "+ New" rightmost) · `jv-table` +
row-click→full-form dialog (library CRUD) · `confirmDialog`/
`promptDialog` (never native) · `.jv-overlay`/`.jv-modal` shells ·
`.jv-fill` (pane views that fill the content area) · `JvToggle`
(booleans — never raw `<input type="checkbox">`).

**Design-conformance checklist** (born 2026-06-12 after a
geometry-only "sweep" missed control-level slop — a sweep that doesn't
check these checked nothing). When asked to SWEEP the app, use the
canonical method verbatim:
`docs/plans/2026-06-12-design-conformance-audit.md` §Sweep method
(two passes incl. screenshot judgment, modal/data-state coverage,
recorded-exceptions ledger, findings before fixes):
1. Booleans → `JvToggle`/styled control, never a native checkbox.
2. Inputs/selects sized by content-typed width tokens (`jv-w-name` /
   `jv-w-id` / `jv-w-token` / `--w-*`) — never full-width stretch
   unless the content is prose.
3. Form rows → JvField pattern; sections that group controls → `jv-card`,
   not naked rows on the page background.
4. Buttons → `jv-btn`/`JvButton` variants only; no scoped one-offs.
5. No internal jargon in user-facing copy ("pin", "manifest", feature
   keys). If a knob's effect is invisible (e.g. a prompt resolved
   server-side), SHOW the resolved truth in the UI — never an empty
   box with a "defaults apply" placeholder (Speaker Lab lesson).
6. NO borderless text-only buttons (user decree 2026-06-12: "no ghost
   buttons"). The ghost variant renders as a thin-bordered quiet
   utility; jv-pill --ghost is a chip SELECTION state, not a button,
   and is exempt.
7. Layout grammar (rewritten 2026-06-12 after the copy-JustWrite
   correction — "you just decided to copy instead of think"): size
   every control to its content and let rows END where content ends —
   never inflate a field to "use" the width; dead space right of
   well-sized controls is not a defect. Group controls by what they
   act on (preset actions live beside the preset dropdown). Put the
   primary action where the eye lands when the user finishes — the end
   of the form, above its results — not flung to a far edge. Never
   orphan a fragment across a spacer. Don't surface internal modes as
   buttons; let auto-detection move the selection and show provenance
   as a muted note. References (incl. JustWrite) are for extracting
   PRINCIPLES — copying a reference's layout inherits its flaws.

## Shared app standard + JustVoice specifics

JustVoice follows the shared **Vue 3 + Tauri 2 app standard** in the global
`~/.claude/CLAUDE.md` (folder layout · `tokens.css`+`styles.css` · vue-router ·
origin-aware `services/serverApi.js` + `VITE_SERVER_URL` · per-domain Pinia
stores · `services/appearance.js` · Biome · server-side seed · connection-gate
boot). Don't restate that here — this section is JustVoice-specific only. Sibling
app: JustWrite. When a surface exists in both, they must match unless a
documented reason below says otherwise.

**JustVoice's justified differences:** larger renderer/server + native `lib.rs`
modules (engines, audio, dictation); dev port **1430** (HMR 1431); a few stores
are domain-rich (engines, takes, generation) — that's scope, not drift.

> **AI/LLM stack is shared** — `just-llm-runner` (Python) + `@delebash/llm-ui`
> (Vue), consumed by both apps; only TTS and each app's feature catalog differ.
> The current cutover state + the active plan docs (authoritative:
> `docs/plans/2026-06-20-shared-ai-stack-plan.md`) live in `MORNING_RECAP.md`,
> not here.

## Architecture

Three layers:

1. **`src-tauri/`** — Tauri 2 desktop shell. Pure plumbing: spawn the Python sidecar, host the webview, shut down cleanly. Don't put business logic here.

2. **`src/renderer/`** — Vue 3 + Vite single-page app. Pinia stores for state. Components in `src/renderer/src/components/`. Views (one per tab) in `src/renderer/src/views/`. Talks HTTP to the Python server.

3. **`server/justvoice/`** — Python 3.10+ FastAPI server. All business logic: engines, storage, render pipeline, mastering, cache, API. PyTorch-based engines run in-process. Kokoro runs through `sherpa-onnx-python`. SQLite (via SQLAlchemy) is the primary persistence layer.

## What goes where

| Concern | Layer |
|---|---|
| TTS model loading + inference | `server/justvoice/engines/<engine>/` (manifest.py + engine.py per engine) |
| Storage (settings, voices, profiles, projects, chapters, takes, generations, lexicons, personas, story_items, renderer prefs) | `server/justvoice/storage/` + `database/` (SQLite via SQLAlchemy — settings + prefs folded in; no atomic-JSON store) |
| Render orchestration + cache | `server/justvoice/render_core.py` + `server/justvoice/api/render_chapter_api.py` |
| Audio analyzer + WAV math + mastering | `server/justvoice/audio/` + `server/justvoice/mastering.py` |
| API endpoints | `server/justvoice/api/<area>_api.py` |
| Pydantic models (request/response shapes) | `server/justvoice/models.py` |
| UI components + views | `src/renderer/src/components/` and `views/` |
| Pinia stores (api, toasts, tasks) | `src/renderer/src/stores/` |
| Desktop-only concerns (file picker, OS-level paths) | `src-tauri/src/lib.rs` |

## Project rules

- **Python**: ruff for lint, pytest for tests. Run `ruff check` + `pytest` before committing.
- **Renderer gate — the Playwright headless smoke, and it RUNS in this dev
  container** (recurring wrong claim is "no renderer gate / not runnable here" —
  false; run it). Boot `justvoice-server serve --host 127.0.0.1 --port 8741`
  (background) + `npm run build:vite`, then `node scripts/smoke.mjs` — it drives
  headless Chromium over every view and asserts ZERO JS errors. Chromium is
  prebuilt at `/opt/pw-browsers` (the script auto-finds it; override with
  `JV_CHROME`; base URL via `JV_BASE`). `scripts/smoke_gui.mjs` screenshots tabs.
  **Run the smoke to verify any renderer/GUI change.** (`e2e/` tauri-driver
  drives the built binary — packaged-app check, not the quick gate.)
- **Vue**: prefer single-file components. **Mercury (the legacy-gui look: cream, sharp corners, oxblood) is already gone** — `styles.css` was rebuilt from `preview/full-app-preview.html` (warm paper, white cards, green accent, rounded). The Phase 4 design pass decides whether that working system becomes the final multi-use identity or gets evolved (see `project_final_architecture`). No CSS framework — `styles.css` carries the canonical design tokens.
- **Rust** (Tauri shell): keep minimal. If you find yourself writing business logic in Rust, move it to Python.
- **No hardcoded operator-tunable values** — every knob lives in settings (SQLite, via `SettingsStore`) + reachable via `PATCH /v1/settings`.
- **All commits**: ruff + pytest pass.
- **Cross-language API stability**: Pydantic models in `server/justvoice/models.py` are the source of truth. The Vue client uses fetch directly against the OpenAPI shape. The CONTRACT.md endpoint list is the JustWrite-facing surface.
- **Storage**: SQLite (via SQLAlchemy) is the persistence layer for everything. `settings.json` was folded into the `settings` table and renderer UI prefs into `prefs` (the 2026-06-19 storage rewrite — `SettingsStore` imports any legacy `settings.json` once); there is no atomic-JSON or renderer-side store left.
- **Licensing**: every file gets an SPDX-License-Identifier header. Files lifted from an upstream MIT codebase get a full attribution block referencing `voicebox-pin.txt`. See `project_licensing_attribution` memory for templates and CI guards.

## How to run

```bash
# Dev (Tauri + Vite + Python sidecar all running)
npm install
cd server && pip install -e .[kokoro] && cd ..
npm run tauri dev

# Headless (Python server only — same UI via /ui/)
cd server && pip install -e .[kokoro]
justvoice-server serve     # NOT `justvoice serve` — see project_gotchas memory

# Build production installer
npm run tauri build
```

**Important — naming**: the Python console script is `justvoice-server`, not `justvoice`. The Tauri binary is `justvoice.exe`; using the same name for both causes Windows `CreateProcessW` to resolve `Command::new("justvoice")` to the Tauri binary itself, spawning infinite windows. Never revert the rename.

## What this app is for

JustVoice is a voice production studio for FIVE distinct audiences:

1. **Audiobook producers** (primary differentiator). Long-form narration. Multi-character casting via personas. Pronunciation discipline via lexicons. ACX-spec mastering. JustWrite-driven workflow via CONTRACT.md.
2. **Game developers** (Unreal Engine integration). NPC dialogue at 50–500 character scale. Per-line WAV + JSON sidecar export. Future `.uplugin` for Unreal Editor.
3. **Podcasters**. Multi-track Stories timeline, paralinguistic tags, effects chain.
4. **Dictation users**. Global hotkey, system audio capture, MCP server for agent-driven workflows.
5. **Accessibility users**. Real-time TTS, screen-reader integration (future).

All five use cases share the same engine pool + voice profiles + lexicons + personas. Differentiation is in import/export pipelines + per-use-case UI surfaces.
