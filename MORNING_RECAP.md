# Morning recap — JustTTS

> The in-repo session-pickup doc. Reflects current code state, not history.
> If you're starting a fresh session, read this immediately after `CLAUDE.md`.

## Memory pointers (load on demand, don't bulk-read)

The memory index (`~/.claude/projects/E--Dev-Web-justtts/memory/MEMORY.md`) auto-loads with one-liners for each file. Load the full file only when a task or question touches its topic.

| When the situation is… | …load this memory |
|---|---|
| Touching architecture; tempted to propose Rust / Docker / voicebox / FFI | `project_architecture_pivot.md` |
| Debugging boot failure, spawn weirdness, vite errors, Tauri build errors | `project_gotchas.md` |
| Asked "where do I pick up?" or "what's next?" | `project_next_steps.md` |
| Touching `/v1/voices/blend` or `/v1/train` or an engine adapter's blend/train methods | `project_phase5_engine_flips.md` |
| About to grep / glob for a file path | `reference_repo_layout.md` |
| About to build a new UI primitive | `reference_justwrite_components.md` |
| Anything that references the legacy Rust repo | `reference_legacy_repo.md` |
| Adding any operator-tunable value related to training | `reference_settings_training.md` |
| About to write a question, native dialog, or non-terse closer | `feedback_user_preferences.md` |
| Need the canonical project pickup snapshot | `project_state.md` |

If a memory file conflicts with this recap, the memory file wins — recaps go stale, memories get edited as state changes.

## 🚢 BUILD MILESTONE — 2026-06-08 LATE: most of Phase 1-5 shipped + atomic license flip done. START HERE.

Multi-hour push completed Phase 1, 1.5, 2, 3, 4a, 4a-addendum, 4c (Tauri), and 5 backend half + 6 docs. Phase 4b (Vue UI tabs) has foundation in place but full UI sweep pending.

**Shipped this session:**
- **Phase 1 docs**: CONTRACT.md, NOTICE.md, LICENSES.md, voicebox-pin.txt, PHASE_PLAN.md, updated CLAUDE.md
- **Phase 1.5 SQLite**: 24 ORM tables (database/models.py) + migrations pattern lifted from voicebox MIT + session factory + foreign keys ON + init_db wired into create_app()
- **Phase 2 tests**: pytest baseline (~15 tests) + ACX preset tightened to -20 LUFS / -3.5 dB peak; mastering.py confirmed correct (uses ffmpeg loudnorm, not np.clip)
- **Phase 3 lifts + LICENSE FLIP**: voicebox base.py utilities lifted to engines/_torch_helpers.py (MIT AND GPL-3.0-or-later); chunked_tts.py lifted to audio/chunked.py + wired into render_core.py; GenerationSettings added; pedalboard added to deps; **atomic license flip Apache-2.0 → GPL-3.0-or-later** across LICENSE + pyproject.toml + NOTICE.md + LICENSES.md + 15 first-party SPDX headers
- **Phase 4a backend**: 14 new endpoints (takes, channels, mcp_bindings, projects, webhooks with HMAC, render_presets, bulk_delete with dry-run, backup/restore, voice_preview LRU, project_export, sse_streams, active_tasks, capture_readiness)
- **Phase 4a Tests**: 7 new test files for the new endpoints (test_render_presets, test_takes, test_projects, test_webhooks, test_voice_preview_lru, test_chunked, conftest_db)
- **Phase 4b foundation**: AudioKeepAlive.vue, ListPane.vue, CapturePill.vue, ChordPicker.vue, BooksView.vue + 5 new Pinia stores (server, player, ui, audioChannel, generation) + projects.js service for all new endpoints + App.vue updated to register BooksView and AudioKeepAlive
- **Phase 4c Tauri**: 21 Tauri invoke commands + system tray with 11-item menu + keep-server-running close-button intercept + sidecar lifecycle commands. Cargo.toml license flipped, tray-icon + image-png features enabled
- **Phase 5 JustVoice side**: All HTTP endpoints for JustWrite to drive JustVoice are live. PHASE5_JUSTWRITE_INTEGRATION.md documents the JustWrite-side edits needed in `justwrite-app/`
- **Phase 6 docs**: FEATURES.md (23 sections, ~6000 words, user-facing guide in JustWrite-docs style). Updated README.md.

**Locked decisions:**
- License: GPL-3.0-or-later (flip from Apache-2.0 happened atomically in Phase 3 with pedalboard adoption)
- Storage: SQLite primary, settings.json only atomic-JSON store
- Stack: Tauri 2 + Vue 3 + Pinia + Python FastAPI + SQLite
- Engines v1: all 10 (Kokoro / Chatterbox×2 / Qwen3×2 / LuxTTS / TADA / Dia / MossTTS / Higgs) + external OpenAI-compatible
- Aesthetic: cream paper + forest green + warm gold (the preview HTML's look — user said "refreshing")
- Multi-use case: audiobook + game (Unreal) + podcast + dictation + accessibility, all first-class
- Project model: Project → Scene → Block (use-case-generalized via project_type discriminator)
- Multi-user accounts: NEVER ship (out of scope forever; v2 product pivot if it ever happens)

**Still pending (deferred, none blocking):**
- Phase 4b: 8 settings sub-routes (General/Generation/Captures/MCP/GPU/Logs/Changelog/About), full aesthetic CSS sweep, StoriesView (timeline port), CapturesView (dictation UI), EffectsView (pedalboard editor) — land one-per-PR
- Phase 4c+5: DictateWindow agent-speak cycle (backend ready; Vue window + Rust setup pending)
- Phase 6: Apple notarization + Linux AppImage signing (Windows EV-cert is in v1 scope), full Vue UI smoke test
- UE Engine integration: research-first deep dive after main program completes (see [project_unreal_deep_dive_deferred](~/.claude/projects/E--Dev-Web-justtts/memory/project_unreal_deep_dive_deferred.md))

---

## 🔄 PRIOR DECISION — 2026-06-08 EVENING: NOT forking. JustTTS = engine pool + mastering; JustWrite = audiobook UI.

**Decision (2026-06-08, after 3 ultracode workflows = 104 agents, ~5.7M tokens):** Don't fork voicebox. Keep JustTTS-new and JustWrite as separate apps with an HTTP contract. Lift ~328 LOC of voicebox patterns (base.py utilities, chunked_tts, StoryItem timeline schema) with attribution. Voicebox is a reference snapshot, not an upstream. Full plan in memory file [project_final_architecture.md](../../C:/Users/danel/.claude/projects/E--Dev-Web-justtts/memory/project_final_architecture.md) — load that first.

**Why this beat the fork pick:** Workflow 3's completeness critic found the load-bearing fact workflows 1 and 2 missed — **JustWrite already ships m4b.js + speakerAttribution + StudioView Cast/Script/Render/Lab + ExportView M4B preset.** Forking voicebox throws away ~6 months of working audiobook code in justtts-new to inherit ~3-4 weeks of React UX scaffolding that voicebox built — and voicebox has ZERO audiobook surface (grep across backend/routes for chapter|lufs|acx|m4b|master|lexicon|train returns zero). Fully reversible (additive only).

**Contract:** JustWrite owns audiobook orchestration (manuscript, cast, render orchestration, M4B mux via FFmpeg.wasm). JustTTS owns engine pool + per-chapter render + ACX mastering + lexicons + personas + training. Wire format = JustTTS HTTP API.

**6 decision gates blocking code changes** (user must answer): TM on "JustVoice", audiobook-only-vs-multi-use, GPL-3.0 vs paid-tier, sidecar-vs-peer, Vue-vs-React, all-10-engines-vs-trim-to-4.

**6-phase roadmap (~10-14 weeks):** CONTRACT.md + LICENSES.md (2-3d) → pytest baseline + mastering.py audit (1w) → lift voicebox base.py + chunked_tts (1-2w) → take-versioning + ChapterView TrackEditor (2w) → JustWrite integration smoke (2-3w) → optional MCP for game/Unreal, signing, v0.1.0 (2-4w).

---

## 🗄️ SUPERSEDED — earlier "FORKING jamiepine/voicebox" pivot.

Earlier this session we landed on forking voicebox after 2 workflows. Workflow 3's completeness critic flipped the decision. Keeping the prior pivot text below as history; do not act on it.

**Earlier text (do not act):** Stop building this repo's hybrid shared/isolated venv infrastructure. Fork `jamiepine/voicebox` (MIT, 22k★) and add JustTTS-specific features on top. Likely renaming to **JustVoice** (TM check pending). Full audit + plan in memory file `project_fork_pivot.md` — load that first.

**Why this happened:** User raised forking 3x across this session; on the 3rd time I did the audit and found voicebox's `VoiceProfile.personality: Text` + `GenerationRequest.personality: bool` (in-character LLM rewrite before TTS) IS JustWrite's persona feature. Their `Story` → `StoryItem[]` timeline IS chapter/scene assembly. Their 7 engines are already cross-platform tested. Every day of hybrid-venv work was rebuilding solved problems. See memory `feedback_fork_voicebox_signal` for the meta-lesson.

**Current state of this repo (`justtts-new/`):**
- Working tree heavily modified, uncommitted. HEAD: `ce23a8c`.
- Everything below this section describes work that's now **research, not shipping code.** Kept for engine recipes + knowledge base.
- Voicebox upstream cloned at `E:\Dev\Web\voicebox-upstream\` for read-only audit (shallow clone). Don't push to it.

**When this session resumes, the plan is:**
1. TM check on "JustVoice" (USPTO + Google). If clear, lock; else fall back to JustTTS.
2. `gh repo fork jamiepine/voicebox --fork-name <name>` (gh CLI is auth'd as `delebash`).
3. Local dir reshuffle: existing `E:\Dev\Web\justtts\` (Rust archive) → `justtts-rust-archived\`; `E:\Dev\Web\justtts-new\` → `justtts-research-spike\`; fork clones into `E:\Dev\Web\justtts\` (or `justvoice\`).
4. First feature: `POST /books/import` (JustWrite book export → Stories + VoiceProfiles). Then lexicons, ACX mastering, chapter render.

**The rest of this recap is now historical.** Skip to "Where we are" only if you need engine-recipe context.

---

## ⭐ PREVIOUS SESSION — 2026-06-08 AM/PM (GUI rebuild + deep audit + hybrid venvs).

Big push on the renderer. **All work is in the working tree, UNCOMMITTED** (user handles commits). HEAD is still `ce23a8c`; `git status` shows many modified + new files.

**Model note:** the user runs Opus 4.7. A CLI migration had silently unpinned it (sessions fell back to 4.8 default). Re-pinned via `"model": "claude-opus-4-7"` in `~/.claude/settings.json`. They restarted to pick up 4.7 — that's why you're in a fresh session. See memory `feedback_model_and_tokens`. **Keep token usage lean** (inline over heavy subagent fan-out + screenshots).

**What shipped this session:**
1. **Fixed the "no engines / nothing works" bug** — stale old-code `justtts-server` was squatting on port 17494; a fresh sidecar failed to bind silently and the stale one served without CORS. Server-side CORS defaults + `config.js` origin resolution were already correct; the trap was the stale process. Hardened `src-tauri/src/lib.rs::spawn_sidecar` with a **port-collision guard** (probe → kill stale listener → wait → spawn → confirm-bind). `cargo check` ✓.
2. **Deep 4-way audit** (old GUI vs new GUI vs new server vs legacy server) → written to **`AUDIT_old_vs_new.md`** (root). Finding: server has all 43 endpoints; the new SPA had only built 7 of the old GUI's 11 views.
3. **Legacy GUI copied to `legacy-gui/` and served at `/legacy/`** (mount in `server/justtts/app.py`) for side-by-side UX comparison. New UI at `/`.
4. **Restyled the whole renderer** to the legacy crisp "Mercury" look the user prefers: cream paper, sharp corners, oxblood accent, uppercase letter-spaced labels. Self-contained in `src/renderer/src/styles.css` (+ `.app-shell` scroll fix, global control/utility classes). See memory `reference_gui_styling`.
5. **Built the 4 missing views**: Cache, Personas, Lexicons, Train. **Completed 3 partial views**: Voices (clone/design/import/blend modal), Settings (training + external-servers + URL-overrides sections), Engines (inline install progress row + model-variant picker). App now has **all 11 views**.
6. **Fixed 2 app-wide bugs**: `toastBridge.js` dropped `kind`/`duration` (errors weren't red) — now routes to `toast.error/success/...`; removed silent `catch(_){}` in OverviewView.

**Verified:** `vite build` ✓ (645 modules), `scripts/verify_all.mjs` → all 11 tabs render with **zero console errors**, persona-create tested end-to-end through the GUI. Dev servers were stopped + ports freed at session end.

**Where to pick up next:**
- ✅ **2026-06-08 PM-4 — plugin architecture shipped.** Every engine is now a self-contained folder under `server/justtts/engines/<id>/` with `manifest.py`, `engine.py`, `requirements.txt`, `__init__.py`. Discovery is automatic (`server/justtts/engines/manager.py::discover_engines` walks `engines/*/manifest.py`). Install creates a per-engine venv via uv, runs the engine's declarative `INSTALL` steps. Load spawns the engine subprocess (`<venv>/python engine.py serve --port 0`), reads back the auto-assigned port from stdout, hits `/load` over loopback HTTP. Synth proxies through to the subprocess; Uninstall rmtrees `.venv/`+`models/`+`voices/`+`state/`.
- **Shared SDK at `server/justtts_plugin/`** — pip-installed into every engine venv. Provides `EmbeddedEngine` base class, `SynthOutput.from_numpy()`, `serve()` FastAPI shim. Engine authors write ~30-100 lines of adapter on top of it.
- **All 8 engines have plugin files now**: kokoro (verified working — install + load + synth produces audio), chatterbox (voicebox-proven recipe), dia (Nari Labs Transformers integration), tada (voicebox-proven; ships DAC shim + Llama tokenizer redirect), qwen3 (voicebox CustomVoice; 9 preset speakers), luxtts (voicebox ZipVoice w/ piper-phonemize find-links + 2 git installs), moss-tts (EXPERIMENTAL — flash-attn likely fails on Windows), higgs-audio (EXPERIMENTAL — no PyPI, adapter scaffolded from HF model card).
- **Routes wired through manager**: `/v1/engines`, `/v1/engines/{id}/install`, `/v1/engines/{id}/load`, `/v1/engines/unload`, `DELETE /v1/engines/{id}` (with `?uninstall_deps=true` no longer needed — the engine's whole venv is removed), `/v1/jobs/{id}` (install progress + cancel), `/v1/generate`, `/v1/voices` (static voices surfaced from manifests so Kokoro's 54 + Qwen3's 9 are visible pre-load).
- **Legacy in-process backends deleted**: all 8 flat-file engine adapters under `server/justtts/engines/*.py` (kokoro.py, chatterbox.py, qwen3.py, tada.py, dia.py, luxtts.py, moss_tts.py, higgs_audio.py, kokoro_voices.py) gone, plus `factory.py`. The `external-openai-tts` adapter at `engines/external_openai.py` stays — it's just an HTTP client, no isolation needed.
- **Verified live (HTTP routes)**: GET /v1/engines lists all 8 managed engines, Kokoro shows `installed`, others `not_installed`. POST /v1/engines/kokoro/load → 200. POST /v1/generate (voice=af_heart) → 197 KB WAV with valid RIFF header. POST /v1/engines/unload → 200, subprocess terminates. Reload + second synth via am_michael → 90 KB WAV. /v1/voices shows 63 voices (54 Kokoro + 9 Qwen3 static).
- **Verification artifacts**: `scripts/_kokoro_plugin_test.wav` and `scripts/_synth_via_route.wav` and `scripts/_synth_after_reload.wav` for ear-checking.
- **What's NOT yet validated** — anything other than Kokoro's full lifecycle. Chatterbox / TADA / Qwen3 / Dia / LuxTTS should install (their recipes are voicebox-proven for the first four; Dia is straight-line transformers). MOSS and Higgs are experimental and likely need adapter edits on first install. The user has been warned in each engine's manifest comments.
- ✅ **2026-06-08 PM-3 UX polish round** (after user said the GUI still had real gaps):
  - **Colophon footer removed.** Server URL + bearer token moved to a new "Connection" section at the top of Settings (UI-side, persists in localStorage). The current server URL is now shown in the topbar next to the status pill ("● Operational · http://localhost:17494").
  - **External engine uninstall fixed.** `DELETE /v1/engines/{id}` only works for engines in `known_engines()`; external (OpenAI-compat) engines must go through `DELETE /v1/engines/external/{id}`. `EnginesView.uninstall()` now branches on `backend === "external-openai-tts"`.
  - **Engine description readability fixed.** The first table cell's description was rendering as `.endnote` (serif italic 300 muted) which washed out in packed rows. Replaced with `.engine-name` (serif italic 17px ink) + `.engine-desc` (sans 13px ink-2, line-height 1.5, max-width 480px).
  - **Cancel-install added (server + UI).** `installer.py` now has `cancel(job_id)` + a per-job Event flag, polled on every 64 KB chunk and at each file boundary. New `DELETE /v1/jobs/{id}` endpoint (202 accepted; worker flips phase=failed with error="cancelled by user" and `rmtree`s the partial model dir). Cancel button shows inline in the install progress row while phase isn't completed/failed. **Server must be restarted to pick up these endpoints/installer changes.**
  - **Load button toast hint** for external engines: appends "The remote TTS server isn't responding. Check that it's running, then try again." when load fails — the underlying 503 message ("External TTS server at http://… is not responding") is correct but easy to miss.
  - **Install button now installs Python deps too** (replaces the earlier "DEPS MISSING" warning surface — user pushed back that a warning the UI can't act on is just noise). Per-engine `pip_packages: list[str]` in `engines/catalog.py` (e.g. kokoro=`["sherpa-onnx>=1.13"]`, chatterbox=`["chatterbox-tts>=0.2","torch>=2.2"]`). `installer._run_install` now has a Phase 0: if `pip_packages` non-empty AND any `runtime_deps` not importable, it spawns `sys.executable -m pip install <packages>` as a subprocess, streams pip's stdout into the job's `current_file` for live progress (UI's progress row shows phase=`installing-deps` + indeterminate bar + latest pip line). Cancellable mid-install (same `_is_cancelled` poll, terminates the pip subprocess). Calls `importlib.invalidate_caches()` after success so the deferred `import` in `engine.load()` picks up the new package without restart. The earlier `missing_deps` field on `EngineInfo` was removed; the deps-missing tag + banner in `EnginesView` are removed too. Engines without a clean PyPI name yet (luxtts/tada/dia/moss/higgs) just skip the pip step — same model-file-only install as before.
  - Tab underline bumped to **2px solid** (was 1.5px → browser rounded to 1px → invisible on cream paper). Newsreader `@import` now includes the **italic axis** (`ital,opsz,wght@0,…,1,…`) which was the real "fonts wrong" cause. `.main-inner` no longer `margin: 0 auto` (content sits left-aligned at `padding: 0 40px`). `.grid-2` + `.stack` promoted to global primitives so views stop flex-rowing forms into cramped layouts. Many views had scoped CSS dropped because it was fighting the new globals.
- The big GUI work is **uncommitted** — user may want to review/commit first.
- ✅ **Audio tools view added** (2026-06-08 follow-on) — `AudioToolsView.vue` surfaces `POST /v1/analyze` + `POST /v1/master`; registered as 12th tab.
- ✅ **Legacy-alignment pass** (2026-06-08 PM, after user said "old looks better, info is in a square white box"). What changed:
  - `styles.css` refit: forest green accent restored (was oxblood), `.block` un-boxed (transparent + border-top hairline, no card), serif italic h3, stats/engine row/endnote/tags brought to legacy spec, main padding bumped to `56px 40px 80px`. See `reference_gui_styling` memory.
  - **GenerateView**: added pause_before (ms), pause_after (ms), engine-specific JSON knobs textarea (parsed + validated), inline tag-syntax help line. Field names match server `Delivery` model (`pause_before`/`pause_after`, not `_ms`).
  - **OverviewView**: added Personas stat card + per-engine Ready/Not loaded list (3-column editorial row). Loads `/v1/personas` in parallel with other refresh fetches.
  - **CompareView**: added Channels, Crest factor, Silence ratio, Clipping ratio, Max sample Δ rows + "How to read it" interpretive paragraph.
  - **SettingsView**: external engines table now editable inline (name/base_url/model/voices) and shows `voices` column. Backed by `settings.engines.external` (PUT-saved) rather than the read-only live `/v1/engines` list. Save toast says "Settings saved. Some changes may need a server restart."
  - Dropped scoped CSS from CacheView, EnginesView, SettingsView, CompareView, OverviewView so the new global system isn't overridden.
  - `vite build` ✓ (646 modules). **Not live-smoke tested** — user can reload `/` to see it next to `/legacy/`.
- **Not yet done / worth doing**: live-verify the new look against legacy in the browser; engine adapter package verification; Phase 5 flag flips; live-verify Kokoro install path; Voices clone/blend + Train against a loaded engine; `render_scene` for multi-voice chapters.

---

## Where we are (pre-2026-06-08 GUI session)

- **HEAD**: `ce23a8c` on `main` (working tree heavily modified since — see above)
- **Repo**: `E:\Dev\Web\justtts-new\` (GitHub: `delebash/JustTTS`)
- **Stack**: Tauri 2 shell + Vue 3 SPA + Python 3.10+ FastAPI
- **Routes loaded**: 54 (+ `/legacy` mount)
- **Build state**: vite build ✓, cargo check ✓, Python `create_app()` ✓
- **Tests**: none yet

## What just shipped

1. **Fresh rebuild from scratch as Tauri+Vue+Python** (the old Rust+Python hybrid is on GitHub as `JustTTS-rust-legacy` and on disk at `E:\Dev\Web\justtts\` — reference only, never modify).
2. **Full Python server** — 16 routers, atomic JSON storage, render pipeline with disk-LRU cache, mastering presets, analyzer + compare, RFC 7807 errors, bearer auth.
3. **Eight engine adapters** under a unified `TTSBackend` protocol:
   - Kokoro (via `sherpa-onnx-python` — real)
   - LuxTTS / Qwen3-TTS / Chatterbox (×3 variants) / TADA / Dia / MOSS-TTS / Higgs Audio v3 (scaffolds against assumed `from_pretrained()`/`generate()` shapes — each needs API verification when the package is actually installed)
   - external OpenAI-compatible TTS (`httpx`-backed)
4. **Vue 3 SPA** with 7 views (Overview / Generate / Chapter / Voices / Compare / Engines / Settings), reusing JustWrite's Jw\* primitives + AppDialog + Toast + design tokens.
5. **In-process training worker** — same QC pipeline (SNR / clipping / silence-ratio) as the legacy sidecar; callbacks apply directly to `AppState.training` instead of HTTP-posting to a separate Rust core.
6. **Tauri shell with sidecar autospawn** — `lib.rs` spawns `justtts-server serve` (NOT `justtts` — that name collides with the Tauri binary and infinite-spawns windows).

## Critical bug we just fixed

**Tauri binary name collision** (commit `f7944bb`). The Tauri binary is `justtts.exe`. The shell used to call `Command::new("justtts").arg("serve")`, which Windows `CreateProcessW` resolved to the Tauri binary itself (running-binary directory is searched before PATH), causing infinite window spawns.

**Fix**: renamed Python console script from `justtts` → `justtts-server` in `server/pyproject.toml`. The shell now spawns `justtts-server` with a `python -m justtts.cli` fallback. Devs need to re-run `pip install -e server/` once to get the new entry-point script. On the dev machine the script is at `E:\Python310\Scripts\justtts-server.exe`.

**Don't ever revert this rename.** Three safe spawn forms documented in `~/.claude/projects/E--Dev-Web-justtts/memory/project_gotchas.md`.

## Where to pick up

In rough priority order (also in `~/.claude/projects/E--Dev-Web-justtts/memory/project_next_steps.md`):

1. **Verify `tauri dev` boots cleanly end-to-end** — exactly one window, sidecar binds 17494, GUI tabs populate. Spawn-loop is fixed but hasn't been confirmed end-to-end yet on a fresh `pip install`.
2. **Smoke the API surface via the GUI** — Overview / Generate / Compare / Settings round-trips.
3. **PyInstaller bundling** for production `tauri build` (currently the Tauri shell expects `justtts-server.exe` next to itself but no build script produces it). Reference: `E:\Dev\Web\justtts\sidecars\justtts-sidecar\build_binary.py`.
4. **Engine adapter package verification** — one at a time, easiest first (luxtts → chatterbox → qwen3 → tada → higgs → dia → moss).
5. **Phase 5 engine-flag flips** for blend + train. Infrastructure is in place; adapters need `supports_embedding_blending=True` / `supports_training=True` + the matching methods. Start with Chatterbox.
6. **Pytest scaffold** — at minimum app-boot, router shapes, factory coverage, cache key derivation, compare round-trip.
7. **README sweep** — strip any language that hints at "sidecar as separate process" (the new architecture is in-process).

## Recent commits on main

```
5c91d13 docs: add MORNING_RECAP + harden CLAUDE.md autonomy rule
f7944bb fix(tauri): rename Python CLI to justtts-server to break spawn loop
74fd1ea build(tauri): add reqwest dep + bundle-required icon set
76e0890 feat(engines): port all seven sidecar engine adapters + training worker
87c4a72 feat: complete server, views, and Tauri shell wiring
abb0472 fix(server): syntax error in catalog Kokoro capabilities + drop unused Feature import
ead5d3f chore: initial scaffold — Tauri 2 shell + Vue 3 renderer + Python FastAPI server
```

## Things NOT to re-investigate

(Full list in `~/.claude/projects/E--Dev-Web-justtts/memory/project_architecture_pivot.md`.)

- Reintroducing Rust-native engines (sherpa-onnx Rust crate, Candle, Crane)
- Going Rust-only or building an FFI bridge between Tauri and Python
- ~~Forking voicebox~~ — **REVERSED 2026-06-08, we ARE forking; see top of this file**
- Docker pipeline
- TypeScript migration of the renderer — **REVERSED 2026-06-08, voicebox is TypeScript; we accept it**
- Reverting the `justtts-server` script rename

## How to run

```powershell
# One-time
cd E:\Dev\Web\justtts-new
npm install
cd server
pip install -e .[kokoro]
cd ..

# Dev loop
npm run tauri dev
```

Headless server only (no Tauri):
```powershell
cd E:\Dev\Web\justtts-new\server
justtts-server serve --port 17494
```

Smoke the Python factory:
```powershell
cd E:\Dev\Web\justtts-new\server
python -c "from justtts.app import create_app; print(len(create_app().routes))"
```

## Where everything lives

See `~/.claude/projects/E--Dev-Web-justtts/memory/reference_repo_layout.md` for the full file tree.
