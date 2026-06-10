# Morning Recap — JustVoice

> The in-repo session-pickup doc. Reflects current code state, not history.
> Read this immediately after `CLAUDE.md`. If this file conflicts with a memory file, the memory file wins.

---

## BUILD MILESTONE — 2026-06-09: Capability manifest + profiles + auto-chunking wired + take-lineage + 3-tier voice tuning + global audio player. 81 server tests pass. vite build clean.

## 2026-06-09 evening ship — commit `7fdd6f1` (pushed)

Massive rebrand + license-hygiene sweep + UX polish. All in one commit.

**Brand rename — JustTTS → JustVoice:**
- All product-facing strings renamed across docs, UI, comments, Tauri configs, package metadata, legacy-gui, preview HTML, CSS tokens (`--voicebox` → `--info-blue`).
- **Preserved as technical identifiers** (spawn-loop fix from `project_gotchas`): Python package `server/justtts/`, console script `justtts-server`, Tauri binary `justtts.exe`, X-JustTTS-* HTTP wire headers (manager.py:1138-1140 + justtts_plugin/server.py:135-137), `JUSTTTS_DATA_DIR`/`JUSTTTS_MODEL_DIR`/`JUSTTTS_TORCH_INDEX` env vars. CLAUDE.md L5 keeps the rename-history note pointing readers at "JustTTS" in legacy memory files.

**Voicebox reference removal:**
- All non-attribution voicebox references stripped (~130 mentions): strategic docs, code comments, "voicebox-parity" labels, the comparison file (`preview/voicebox-feature-comparison.md` deleted), src-tag chip labels.
- **Kept where MIT §3 requires it**: `voicebox-pin.txt`, NOTICE.md voicebox section, LICENSES.md row, SPDX-FileCopyrightText headers on every lifted file (7 Rust + 5 Vue + 3 Python), visible UI footer at `SettingsView.vue:1787` + `preview/full-app-preview.html:1812` ("Portions ported from voicebox (MIT)…").

**Engine catalog — Higgs removed:**
- `server/justtts/engines/higgs_audio/` deleted entirely. Higgs Audio v3's weights ship under a non-commercial license that would taint commercial audiobook / game / podcast output.
- Each remaining engine's MODEL WEIGHTS license verified commercial-output-permitting via WebFetch on its HuggingFace model card (see `project_engine_weight_licenses` memory).
- Engines now: 7 base / 9 with variants (Kokoro, Chatterbox + Turbo + Multilingual, Qwen3 + 0.6B, LuxTTS, TADA, Dia, MOSS-TTSD) + external OpenAI-compatible.

**TADA Llama 3.2 attribution:**
- New manifest fields `WEIGHTS_LICENSE` + `ATTRIBUTION` (in `EmbeddedEngine`/manager.py:121-138) flow through `EngineInfo` (models.py:500-512) → `/v1/engines` → EnginesView card (`.engine-card__license` pill + `.engine-card__attribution` warn-tinted row).
- TADA manifest declares `WEIGHTS_LICENSE = "Llama-3.2-Community"` + `ATTRIBUTION = "Built with Llama"` per Llama §1.b.
- NOTICE.md + docs/engines.md document the attribution requirement.

**UX polish (long-running ops):**
- `renderTasks.js` store: `panelOpen` + `openPanel`/`closePanel`/`togglePanel`, `cancelAll`, `retry(id)`, `dismiss(id)`, `activeCount` computed, `_scheduleAutoDismiss` (5s completed / 3s cancelled / never failed), `_timers: Map`. Tasks accept `onRetry` callback.
- New components `TaskStrip.vue` (accent-tinted inline strip with Details/Cancel/Retry/Dismiss) + `TaskStatusPanel.vue` (right-side slide-in with Running + Recent sections, teleported, click-outside + Esc).
- Topbar status pill is now clickable button → `tasks.togglePanel()` (App.vue:203-212).

**Engine load — server-side cancel:**
- `EngineManager._cancel_load_requests: set[str]` + `request_cancel_load(engine_id)` method (manager.py:917-945). Polled at safe steps (shared-venv setup, model download, subprocess spawn, child /load).
- `POST /v1/engines/{id}/cancel-load` endpoint (engines_models_api.py:120-135). EnginesView wires `AbortController` + Cancel button + `onRetry: () => load(id, variant)` (EnginesView.vue:290-306).

**EnginesView card-layout rewrite:**
- Replaced table with `.engine-cards` grid + per-engine card. Status pill (4 visual states: loaded/loading/installed/not_installed), currently-loaded summary, install progress with indeterminate-shimmer, always-visible model picker with Recommended + ★ Currently loaded chips, footer Install (venv-only) / Unload / Uninstall.
- All `.engine-card__*` scoped CSS landed. Build 725 modules → 3.67s.

**Lexicon auto-attach on Generate:**
- `GenerateView.vue`: `attachedLexicon` ref (L194), watch on `selectedProfile` fetches `/v1/lexicons/{default_lexicon_id}` (L204-214), sends `body.lexicons = [attachedLexicon.value.id]` at render time (L391). Always-visible row with View applied entries modal.

## 2026-06-09 ship list (UX parity sweep)

**Backend:**
- `audio/chunked.py` finally wired into `api/generate_api.py:165-228` — auto-chunking now LIVE on both managed + in-process synth paths. Was lifted in task #53 but dead code until today.
- `api/profiles_api.py` — new module, full CRUD for VoiceProfile + `/compose` stub. List/get/create/update/delete + 501 compose handler.
- `database/models.py` — `personality` + `default_delivery` Text columns added to VoiceProfile (migration in `database/migrations.py:_migrate_voice_profiles_personality`).
- `api/takes_api.py` — added `GET /v1/takes/recent` (history table) + `GET /v1/takes/{id}/lineage` (take chain).
- `api/engines_api.py` — `/v1/engines/capabilities` + `/v1/engines/{id}/capabilities` endpoints from `engines/capability_details.py` (hand-authored, verified from upstream HuggingFace cards).
- `delivery_merge.py` — 3-tier merge (#88): preset > request > profile defaults. `GenerateRequest` gained `profile_id` + `preset_id` fields.
- Models: `KnobSpec`, `InlineTagSet`, `EngineCapabilityDetail`, `EngineCapabilitiesResponse` for capability manifest.

**Frontend:**
- New views: `ProfilesView.vue` (card grid + create/edit modal + test-compose).
- New components: `SlashTagMenu.vue` (engine-aware `/`-key tag picker, ↑↓ Enter Esc nav), `GlobalAudioPlayer.vue` (bottom-anchored player with animated bars + scrub + volume), `LineageViewer.vue` (vertical timeline modal for take chain).
- New store: `stores/audioPlayer.js` (pinia, shared `<audio>` element across views).
- `GenerateView.vue`: capability fetch replaces hardcoded CAPABILITY map; auto-resize textarea (140→360px); Profile + Compose chips; SlashTagMenu wired via `/` keystroke; history table (relative time + ▶ routes to GlobalAudioPlayer).
- `JvTextarea.vue`: opt-in `autosize` prop with min/max heights.
- `SettingsView.vue`: API reference table (#96), MCP install snippets (#92), GPU info card with `/v1/system` fetch (#91), Auto-updater UI hooked to Tauri (#90), Appearance picker writing CSS custom properties (#93).
- `App.vue`: ProfilesView mounted in sidebar between Voices + Personas.

**Memory + global rules:**
- `~/.claude/CLAUDE.md` (global, all-project): Rules #0 (no permission), #1 (verify don't guess), #2 (no subagent delegation), #3 (upstream parity is file-by-file), #4 (web research first for library/model questions). Removed never-commit rule per user.
- `feedback_upstream_audit_hard_rule.md`: project-specific reinforcement (file-by-file verification before parity claims; web research first for upstream library/model questions).
- `reference_engine_capability_surface.md`: per-engine knob + inline-tag surface, verified from upstream HuggingFace cards (Chatterbox-Turbo's `[laugh][cough]` paralinguistic, Qwen3 instruct field, Dia `[S1]/[S2]` + parenthetical paralinguistic, etc.).
- `feedback_static_vs_configurable.md`: don't over-configurize; static where it doesn't vary per deployment.
- `feedback_ultracode_usage_rule.md`: added "audits are NOT mechanical → solo Opus only".

**Closed tasks (2026-06-09):** #85, #86, #87, #88, #89, #90, #91, #92, #93, #94, #96, #98, #99, #100.

---

## BUILD MILESTONE — 2026-06-08 FINAL: JustVoice-native UI + take versioning + Tauri Rust subsystems all landed. vite build clean (676 modules, 39.70 kB CSS / 8.16 kB gzip). cargo check clean on Windows.

---

## Current HEAD

```
16bfacd feat(tauri+ui): take versioning UI + port voicebox Rust subsystems
ae3c0ce refactor(ui): sweep all 18 views to Jv* primitives + jv-* utility classes
35a2cf6 feat(ui): rewrite UI as JustVoice-native — delete JustWrite Jw* / tokens.css
de592a7 feat: JustVoice v1.0 design freeze + Phase 1-5 implementation + atomic license flip
```

Repo: `E:\Dev\Web\justtts-new\` (GitHub: `delebash/justtts-new`, branch: `main`)

---

## What is done

### Design system rewrite (commits 35a2cf6 + ae3c0ce)
- Deleted `assets/styles/tokens.css` (2026 LOC, JustWrite-inherited oklch system) and all 7 `Jw*` primitives under `components/ui/`.
- New `assets/styles/justvoice.css` (763 LOC): cream paper + white card + forest green + warm gold + oxblood palette; 8px radius; Inter. Tokens, reset, app shell, full primitive set (`.jv-card`, `.jv-btn`, `.jv-table`, `.jv-pane`, `.jv-floating`, `.jv-banner`, etc.).
- New `components/jv/` with 8 single-responsibility Jv* primitives: `JvButton`, `JvInput`, `JvTextarea`, `JvSelect`, `JvCheckbox`, `JvSegmented`, `JvTag`, `JvField`.
- All 18 views swept to use Jv* primitives and `jv-*` utility classes. Scoped CSS removed from all 18 views (layout rules only where needed).
- CSS bundle: ~74 kB down to 39.70 kB (gzip 8.16 kB).

### DictateWindow (commit 35a2cf6)
- `components/DictateWindow.vue` ported from upstream React to Vue (per-file MIT attribution in header).
- `main.js` routes `?view=dictate` to a standalone mount.
- Listens for `dictate:speak-start` Rust event, opens SSE on `/v1/generate/{id}/status`, plays via `HTMLAudioElement`, emits `dictate:show/hide` for Rust window chrome.

### Take-versioning UI (commit 16bfacd)
- `ChapterView.vue` rewritten: project → scene → block navigation; per-block prev/next take arrows (`← Take 3 of 7 →`); dropdown with timestamps + default marker; JvTag badge on default; source-lineage pill (`← from Take N`); audio player at `/v1/generations/{id}/audio`; action row (Regenerate / Set as default / Compare side-by-side / Delete with two-step confirm).
- New `stores/takes.js` (`useTakesStore`): keyed by `block_id`; `takes` Map, `loaded` Set, `activeTakeIds` Map; methods `fetchTakes / navigatePrev / navigateNext / promoteToDefault / removeTake / relabelTake / invalidate`.
- New `stores/api.js`: `.get / .post / .requestBlob / .postForm` helpers.
- Server: `server/justtts/api/takes_api.py` — `GET /v1/generations/{id}/audio` serves WAV via `FileResponse`.

### Tauri Rust subsystems (commit 16bfacd)
Ported from voicebox commit `b35b90961d5bc83a8b4e96e8b6ccde2a03152ff9` (MIT) under MIT AND GPL-3.0-or-later. Per-file attribution headers reference `voicebox-pin.txt`.

- `audio_capture/{mod,windows,linux,macos}.rs` — cpal mic; WASAPI loopback (Windows); PulseAudio (Linux); ScreenCaptureKit `#[cfg(target_os="macos")]`. Emits `audio_capture:samples` + `:complete` with WAV path under `${app_data}/captures/{uuid}.wav`.
- `hotkey_monitor.rs` — keytap global push-to-talk + toggle; chord strings parsed to key sets; tokio task; emits `hotkey:push-to-talk-start / -end / :toggle`.
- `synthetic_keys.rs` — paste injection: Win32 `OpenClipboard`/`SendInput` on Windows; `NSPasteboard`/`CGEventPost` on macOS. Linux TODO (X11/Wayland).
- `permissions.rs` — macOS TCC checks (accessibility + input monitoring); non-macOS stubs return `true`.
- `system_audio.rs` — thin wrapper around `audio_capture::is_supported()`.
- `lib.rs` — all 21 stub command bodies replaced with real impls.
- `Cargo.toml` — added cpal, wasapi (Win), screencapturekit + cidre (macOS), keytap, hound, uuid, platform conditionals.

### Earlier phases (all landed, not re-listed in detail)
- Phase 1 docs: CONTRACT.md, NOTICE.md, LICENSES.md, voicebox-pin.txt, PHASE_PLAN.md.
- Phase 1.5: 24-table SQLite ORM (`database/models.py`), SQLAlchemy sessions, `init_db` wired.
- Phase 2: pytest baseline (~15 tests), ACX preset tightened (-20 LUFS / -3.5 dB peak).
- Phase 3: upstream base.py lifted to `engines/_torch_helpers.py`; `chunked_tts.py` → `audio/chunked.py` (each carries per-file MIT attribution + references `voicebox-pin.txt`); `GenerationSettings` added; pedalboard added; **license flip Apache-2.0 → GPL-3.0-or-later** (atomic, across LICENSE + pyproject.toml + SPDX headers).
- Phase 4a: 14 new API endpoints (takes, channels, mcp_bindings, projects, webhooks+HMAC, render_presets, bulk_delete, backup/restore, voice_preview LRU, project_export, SSE streams, active_tasks, capture_readiness). 7 new test files.
- Phase 4b/4c: full 18-tab UI, 80px sidebar, Tauri 21 commands + system tray + keep-alive intercept, sidecar lifecycle.
- Phase 5: all JustWrite-facing HTTP endpoints live (CONTRACT.md surface).
- Plugin engine architecture: each engine is a self-contained folder with `manifest.py` / `engine.py` / per-engine venv. Discovery automatic. Install/load/unload wired through manager. Kokoro verified end-to-end (install → load → synth → 197 KB WAV). Other 7 engines scaffolded.

---

## What is still pending

- **Take regeneration path**: `POST /v1/blocks/{id}/render` does not yet atomically create a Generation + Take. Current Regenerate uses `/v1/render_chapter` (returns blob, no auto-Take). Noted in `ChapterView.vue` TODO.
- **Linux paste injection**: `synthetic_keys.rs` Linux branch is TODO (X11/Wayland).
- **Non-Kokoro engine lifecycle**: chatterbox / TADA / Qwen3 / Dia / LuxTTS should install (recipes verified against engine model cards); MOSS is EXPERIMENTAL (likely needs adapter edits on first install). Higgs was removed 2026-06-09 (non-commercial weight license).
- **Phase 5 engine-flag flips**: blend + train infrastructure is in place; adapters need `supports_embedding_blending=True` / `supports_training=True` + matching methods. Start with Chatterbox.
- **PyInstaller bundling**: production `tauri build` expects `justtts-server.exe` next to itself; no build script produces it yet. Reference: `E:\Dev\Web\justtts\sidecars\justtts-sidecar\build_binary.py`.
- **Signing**: Apple notarization + Linux AppImage signing pending (Windows EV-cert is v1 scope).
- **Live smoke test**: `tauri dev` end-to-end boot + GUI tab round-trips not re-confirmed after 16bfacd. Do this before any further Rust or server work.
- **UE integration**: deferred post-v1 (see memory `project_unreal_deep_dive_deferred`).

---

## Locked decisions

- License: GPL-3.0-or-later (atomic flip in Phase 3, not reversible)
- Storage: SQLite primary; `settings.json` is the only atomic-JSON store
- Stack: Tauri 2 + Vue 3 + Pinia + Python 3.10+ FastAPI + SQLite
- Engines v1: 9 (Kokoro / Chatterbox×2 / Qwen3×2 / LuxTTS / TADA / Dia / MossTTS) + external OpenAI-compatible — Higgs removed 2026-06-09 (non-commercial weight license; commercial-output use cases blocked)
- Design: JustVoice-native (cream/forest-green/gold/oxblood). JustWrite token system gone.
- Multi-use: audiobook + game (Unreal) + podcast + dictation + accessibility, all first-class
- No multi-user accounts (forever out of scope)
- `justtts-server` script name must not be reverted (spawn-loop prevention)

---

## Memory files — load on demand

| When the task touches… | Load this memory |
|---|---|
| Architecture; tempted to propose Rust / Docker / fork another upstream | `project_final_architecture.md` |
| Boot failure, spawn weirdness, Tauri build errors | `project_gotchas.md` |
| What to do next / priority order | `project_next_steps.md` |
| `/v1/voices/blend` or `/v1/train` or engine blend/train methods | `project_phase5_engine_flips.md` |
| Finding a file path in the repo | `reference_repo_layout.md` |
| Building a new UI component or token | (justvoice.css + `components/jv/` are now the source of truth; legacy `reference_justwrite_components` is stale) |
| Legacy Rust repo reference | `reference_legacy_repo.md` |
| Operator-tunable training settings | `reference_settings_training.md` |
| About to write a question or non-terse closer | `feedback_user_preferences.md` |
| When/how (rarely) to use ultracode — subagents disabled 2026-06-09 | `feedback_ultracode_usage_rule.md` |
| JustWrite↔JustVoice HTTP boundary | `CONTRACT.md` (in-repo) |
| Use-case scope (audiobook / game / podcast / dictation) | `project_use_cases.md` |
| Licensing, SPDX headers, lifted-file attribution | `project_licensing_attribution.md` |

---

## How to run

```powershell
# One-time setup
npm install
cd server; pip install -e .[kokoro]; cd ..

# Dev (Tauri + Vite + Python sidecar)
npm run tauri dev

# Headless Python server only
cd server
justtts-server serve --port 17494

# Verify server factory
python -c "from justtts.app import create_app; print(len(create_app().routes))"
```

Use `justtts-server`, never `justtts` — the Tauri binary owns that name on Windows.
