# Phase plan

Executive status: post-architecture-decision execution plan (2026-06-08). See `~/.claude/projects/E--Dev-Web-justtts/memory/project_final_architecture.md` for the full plan; this file is the in-repo summary contributors see first.

## Decision summary

- **JustVoice-new stays as the base.** ~328 LOC of utilities + UX patterns were lifted from an upstream MIT codebase with per-file attribution headers (see `NOTICE.md`).
- **JustVoice = engine pool + voice production. JustWrite = audiobook orchestration UI.** Wire format = HTTP. See `CONTRACT.md`.
- **Multi-use product**: audiobook + game (Unreal) + podcast + dictation + accessibility.
- **License**: Apache-2.0 today; flips to **GPL-3.0-or-later** when pedalboard adoption lands (Phase 3+).
- **Stack stays Vue 3 + Pinia + Tauri 2 + Python 3.10+ FastAPI**. No React rewrite.
- **Storage**: migrate from atomic JSON to SQLite (via SQLAlchemy). `settings.json` is the only remaining JSON store.
- **UX**: Mercury aesthetic dropped. New visual identity chosen in Phase 4 design pass.
- **Navigation**: 80px left icon sidebar.
- **Engines**: all ~10 (no MVP trim).

## Phase 1 — Foundation docs ✅ in progress

Deliverables:
- `CONTRACT.md` — JustWrite↔JustVoice HTTP boundary ✅
- `NOTICE.md` — third-party attribution ✅
- `LICENSES.md` — dep license table ✅
- `voicebox-pin.txt` — pinned upstream MIT commit referenced by per-file attribution headers ✅
- `LICENSES/Apache-2.0.txt` — full license text (pending)
- `LICENSES/MIT.txt` — full license text (pending)
- `LICENSES/BSD-3-Clause.txt` — full license text (pending)
- `CLAUDE.md` — updated for multi-use + storage + license changes ✅
- `MORNING_RECAP.md` — updated to reflect FINAL architecture ✅

## Phase 1.5 — Storage migration (atomic JSON → SQLite)

Goal: Replace `server/justtts/storage/*.json` patterns with SQLite tables via SQLAlchemy. Lift the upstream hand-rolled migration pattern.

Deliverables:
- `server/justtts/storage/db.py` — SQLAlchemy engine + session + base
- `server/justtts/storage/migrations.py` — idempotent column-existence migrations (lifted from upstream — per-file MIT attribution in header)
- ORM models for: VoiceProfile, ProfileSample, Persona, Lexicon, LexiconEntry, Project, Chapter, Scene, Block, Generation, Take, RenderJob, StoryItem
- Per-storage-module migration of CRUD code from JSON to SQLAlchemy queries
- `settings.json` retained as the only atomic-JSON store
- Tests covering CRUD on each ORM model

## Phase 2 — Test baseline + mastering verification

Goal: pytest baseline (>=15 tests). Verify mastering.py targets ACX spec.

Deliverables:
- `server/tests/test_mastering.py` — verify loudnorm filter targets -23 LUFS / -3 dB peak / -60 dB noise floor
- `server/tests/test_render_chapter.py` — happy path, multi-block, error handling
- `server/tests/test_analyzer.py` — LUFS/peak/noise floor measurement
- `server/tests/test_lexicons.py` — application + per-character override
- `server/tests/test_personas.py` — persona LLM rewrite path
- `server/tests/test_engine_manifests.py` — every engine manifest valid + discoverable
- `server/tests/test_takes.py` — version chain + set-default
- `server/tests/test_contract.py` — OpenAPI snapshot matches CONTRACT.md endpoints
- CI workflow: ruff + pytest on every PR
- mastering.py audit (already verified — uses ffmpeg loudnorm, not np.clip; no fix needed)

## Phase 3 — Voicebox utility + UX lift

Goal: lift `~328 LOC` of upstream `base.py` utilities + `chunked_tts.py` + supporting patterns (per-file MIT attribution headers). Adopt pedalboard (triggers license flip).

Deliverables:
- `server/justtts/engines/base.py` — port of upstream `base.py` with per-file MIT attribution block (is_model_cached, get_torch_device, model_load_progress, patch_chatterbox_f32, combine_voice_prompts, manual_seed, empty_device_cache, check_cuda_compatibility)
- `server/justtts/audio/chunked.py` — port of upstream `chunked_tts.py` (per-file MIT attribution)
- `server/justtts/audio/effects.py` — adopt pedalboard for effects chain (compressor, EQ, reverb, etc.)
- **LICENSE FLIP PR**: root `LICENSE` Apache-2.0 → GPL-3.0-or-later, `pyproject.toml`'s license field, `NOTICE.md`, `LICENSES.md`, every first-party SPDX header. Atomic commit.
- Refactor existing engine plugins to use unified base
- Wire `chunked_generate()` into `render_core.py`; expose `max_chunk_chars` + `crossfade_ms` in `settings.json`

## Phase 4 — Take versioning + UX pattern port + complete UX redesign (revised after gap audit)

Goal: per-paragraph take versioning, port all upstream UX patterns to Vue, complete visual redesign. Scope grew from 4-5w → 6-8w after reading upstream GUI code directly (~20 features missed in initial scoping).

**🛑 PAUSE BEFORE STARTING UI WORK (4b)** — needs UX visual direction from user (one of: modern-pro-tool / editorial-but-modern / studio-tool-minimal). Phase 4a + 4c can start without it.

Phase 4a (backend, no UX block, ~1.5w):
- `server/justtts/storage/takes.py` — Take ORM + lineage
- `server/justtts/api/takes_api.py` — list/create/set-default/delete
- `render_chapter_api` extended to record each render as a Take row
- **Audio channels backend**: `storage/channels.py` + `api/channels_api.py` for voice → output-device routing
- **MCP per-client bindings backend**: client_id, label, profile mapping, last_seen_at
- **SSE generation progress** — server-sent events streaming generation state (queued / loading_model / generating / completed / failed)
- **RestoreActiveTasks** — recover in-flight generations across server restart

Phase 4b (UI, blocked on UX direction, ~3-4w):
- 80px left icon sidebar replacing top nav
- ChapterView TrackEditor.vue (WaveSurfer + trim + volume + take selector)
- Voicebox Stories timeline editor ported to Vue
- VoiceInspector + multi-sample cloning UX + record-in-app
- Effects chain editor (pedalboard-backed)
- Models / Engines tab
- FloatingGenerateBox (cross-route generate widget)
- ListPane primitive translated to Vue
- AudioPlayer global transport (Pinia store) with native device routing
- Paralinguistic input slash-menu
- **Settings layout with 8 nested sub-routes** (General / Generation / Captures / MCP / GPU / Logs / Changelog / About)
- **ChordPicker** keyboard-combo editor (live key capture)
- **Animated CapturePill** + readiness preview
- **Accessibility + Input Monitoring gates** (Mac TCC) inline on relevant pages
- **Dictation readiness checklist** (6 gates)
- **GpuInfoCard** + CUDA wheel download UI
- **MCP install snippets** (Claude Desktop / claude-code / stdio shim) with copy buttons + OS-detected paths
- **MCP per-client bindings table** + add-binding form + tools sidebar
- **API reference inline card**
- **Full auto-updater section** (check / download progress / restart-install / errors)
- **Theme + Language selectors**
- **Audio channels routing** on Voices tab (per-voice channel MultiSelect)
- Aesthetic redesign: complete CSS overhaul, drop Mercury, distinct identity

Phase 4c (Tauri shell work, no UX block, ~1w):
- **Keep server running when app closes** — Rust IPC + sidecar lifecycle preservation
- **System tray + close-to-tray** (task #59)
- **DictateWindow** as separate `?view=dictate` Tauri webview that floats above other apps
- **AudioKeepAlive** preventing OS audio device sleep
- **TitleBarDragRegion** for frameless window dragging
- **Network access mode** (local 127.0.0.1 vs remote 0.0.0.0) bind selection wired into the Python sidecar args

## Phase 5 — JustWrite integration

Goal: JustWrite drives JustVoice via HTTP for audiobook production.

Deliverables:
- JustWrite's `services/render.js` calls `POST /v1/render_chapter` per chapter
- JustWrite's `src-tauri/src/lib.rs:944-1107` extended/renamed: `justtts_install` clones JustVoice-new, sets up per-engine venvs, downloads default models
- End-to-end smoke test: JustWrite project → JustVoice HTTP → chapter WAVs → JustWrite mux to M4B (via `services/m4b.js`) → ACX validation pass
- OpenAPI snapshot committed; JustWrite consumes the typed shape

## Phase 6 — Optional: MCP + Unreal + signing + tray + release

Deliverables:
- Port the upstream `mcp_server/` (gated by `settings.mcp.enabled`) for Unreal/agent-driven integrations
- Unreal `.uplugin` (separate repo) calling `/v1/render_chapter` for NPC dialogue
- Tauri updater config (delebash GitHub releases endpoint + minisign keys)
- **System tray + close-to-tray** via Tauri 2's `tray` module:
  - Tray icon with status (green / yellow / red)
  - Right-click menu: Show/Hide window, Start/Stop/Restart server, Start dictation, Toggle MCP, Open settings, Copy server URL, Open logs, About, Quit
  - Left-click: toggle window visibility
  - Close-button → minimize-to-tray (configurable in Settings)
- Windows EV-cert signing + macOS notarization workflow
- v0.1.0 release: installers, changelog, README polish
