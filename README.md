# 🎙️ JustVoice

**A cross-platform open-source voice production studio for audiobook producers, game developers, podcasters, dictation users, and accessibility users. Built on Tauri 2 + Vue 3 + Python FastAPI.**

JustWrite-compatible imports are one of several supported workflows — see `docs/import-formats.md`.

License: **MIT** (see `LICENSE`).

## What it does

- **Audiobook production** — write in JustWrite, produce in JustVoice, ship to ACX with chapter markers and ACX-spec mastering
- **Game NPC voicing** — voice 50–500 NPCs from one project, export per-line WAVs for Unreal Engine import
- **Podcasting** — multi-track timeline editor, paralinguistic tags, multi-character mixing
- **Dictation** — global hotkey + Whisper + local LLM refinement + OS-level paste injection
- **General TTS** — 9 engines (Kokoro, Chatterbox×2, Qwen3×2, LuxTTS, TADA, Dia, MossTTS, plus OpenAI-compatible external providers), all installable to isolated venvs and all permitting commercial output

**Five audiences share one engine pool, voice catalogue, lexicon, and persona layer — differentiation lives in import/export pipelines and per-use-case UI surfaces.**

## Documentation

Read the docs in this order:

| File | Purpose |
|---|---|
| **`FEATURES.md`** | **User-facing guide. Read first if you're using the app.** Every feature explained: what it is, when to use it, how to use it, worked examples, troubleshooting. |
| `DESIGN_FREEZE.md` | Architecture decisions, full data model, complete API surface |
| `CONTRACT.md` | The JustWrite ↔ JustVoice HTTP boundary contract |
| `docs/plans/archive/PHASE_PLAN.md` | Build phases 1 → 6 (status of each) |
| `docs/plans/archive/PHASE5_JUSTWRITE_INTEGRATION.md` | Concrete JustWrite-side edits for the JustWrite → JustVoice audiobook bridge |
| `NOTICE.md` | Third-party attribution (MIT/Apache lifts + Llama 3.2 weights for TADA) |
| `LICENSES.md` | Dependency license inventory |
| `MORNING_RECAP.md` | Current build state — what shipped, what's pending |
| `voicebox-pin.txt` | Pinned upstream commit hash for code lifted under MIT — referenced by per-file attribution headers |

## Quick start

### Desktop app

```bash
git clone https://github.com/delebash/justvoice-new.git
cd justvoice-new
npm install
cd server && pip install -e .[kokoro] && cd ..
npm run tauri dev
```

### Headless server (run on a remote box, hit from any browser)

```bash
cd server
pip install -e .[kokoro]
justvoice-server serve --port 17494
```

Then point any browser at `http://localhost:17494/ui/`.

> **Naming**: the Python console script is `justvoice-server`, not `justvoice`. Don't rename — on Windows, using the same name as the Tauri binary causes infinite spawn loops.

### Install more engines

```bash
cd server
pip install -e .[chatterbox]   # English cloning + paralinguistic tags
pip install -e .[qwen3]        # Multilingual TTS + designed voices
pip install -e .[all-engines]  # All bundled engines
pip install -e .[training]     # PEFT/LoRA fine-tuning
```

Or use the Engines tab in the UI for per-engine install with progress.

## Repository layout

```
.
├── index.html                 # Vite entry — the repo root is the Vite root
├── public/                    # Copied verbatim into the build
├── src-tauri/                 # Tauri 2 Rust shell (window mgmt + sidecar spawn + tray + system audio + 21 invoke commands)
├── src/                       # Vue 3 + Pinia + Vite SPA
│   ├── components/            # ListPane, CapturePill, ChordPicker, AudioKeepAlive, etc.
│   ├── stores/                # Pinia: api, server, player, ui, audioChannel, generation, renderTasks
│   ├── services/              # HTTP client per endpoint group (projects, webhooks, takes, …)
│   └── views/                 # One per top-level tab
├── server/                    # Python FastAPI server — the brain
│   ├── justvoice/
│   │   ├── api/               # /v1/* HTTP routes (~30 endpoint files)
│   │   ├── audio/             # WAV math, analyzer, chunked TTS
│   │   ├── database/          # SQLAlchemy ORM + idempotent column migrations
│   │   │   ├── models.py      # 24 ORM tables matching DESIGN_FREEZE §4
│   │   │   ├── migrations.py  # Idempotent column-existence helpers (per-file attribution in header)
│   │   │   └── session.py     # init_db + get_db dependency
│   │   ├── engines/           # Per-engine plugin manifests + adapters + per-engine venv
│   │   ├── storage/           # Atomic JSON for settings.json only (everything else is in SQLite now)
│   │   ├── models.py          # Pydantic source-of-truth (cross-language contract)
│   │   └── app.py             # FastAPI factory; create_app() registers all routers
│   └── tests/                 # pytest baseline
├── preview/
│   └── ux-feature-inventory.html  # Visual feature catalog (cream/forest-green aesthetic preview)
```

## What's done as of the current build

✅ **Phase 1** — Foundation docs (CONTRACT, NOTICE, LICENSES)
✅ **Phase 1.5** — SQLite migration: 24 ORM tables, idempotent migrations, foreign keys ON, init_db wired into FastAPI startup
✅ **Phase 2** — pytest baseline (~15 tests) + mastering.py audit (already correct — uses ffmpeg loudnorm, not np.clip)
✅ **Phase 3** — Upstream torch helpers + chunked TTS lifted (per-file MIT attribution in headers); pedalboard adopted; **atomic license flip Apache-2.0 → GPL-3.0-or-later** across LICENSE + pyproject.toml + 15 first-party SPDX headers. **Reversed 2026-07-29** — pedalboard replaced by our own DSP, flipped to MIT; see `NOTICE.md`
✅ **Phase 4a** — 14 new backend endpoints: takes, channels, mcp_bindings, projects (with JustWrite import), webhooks (HMAC signed), render_presets, bulk_delete (atomic with dry-run guard), backup/restore (stream-zipped), voice_preview (LRU), project_export, sse_streams, active_tasks, capture_readiness
✅ **Phase 4c (Tauri)** — System tray with 11-item menu, close-to-tray when keep-server-running is on, 21 Tauri invoke commands (start/stop/restart_server, set_keep_server_running, audio device + Mac TCC + hotkey stubs)
✅ **Phase 5 (JustVoice side)** — All endpoints for JustWrite to drive JustVoice are live; PHASE5_JUSTWRITE_INTEGRATION.md documents the JustWrite-side edits
✅ **Phase 6 partial** — README + FEATURES.md (23 sections, ~6000 words) + all architecture docs

🚧 **Phase 4b (UI)** — Foundation in place (AudioKeepAlive, ListPane, CapturePill, ChordPicker, 5 new Pinia stores, BooksView). Pending: 8 settings sub-routes, full aesthetic CSS sweep matching the preview HTML, StoriesView (timeline editor port), CapturesView (dictation pill), EffectsView (pedalboard chain editor)
🚧 **Phase 4c+5 (DictateWindow agent-speak cycle)** — Backend ready, Vue + Rust window-spawn integration pending
🚧 **UE integration** — Research-first, deferred until main program completes (see `project_unreal_deep_dive_deferred` memory)

## Status

See `MORNING_RECAP.md` for the current build state. JustVoice's data model + HTTP API + Tauri shell + license posture are all locked. Remaining work is mostly UI tabs (Phase 4b) — they land one-per-PR going forward.

## Project relationships

### To `justwrite-app` (same developer)

JustWrite is the novel-writing app. JustVoice can be driven by JustWrite (the audiobook workflow) OR run standalone (game, podcast, dictation). The wire format is HTTP per `CONTRACT.md`. JustWrite owns the manuscript + final M4B mux (via FFmpeg.wasm); JustVoice owns the engine pool + ACX mastering. Either can ship without the other.

### Upstream code lifts

A handful of files in this repo (`engines/_torch_helpers.py`, `audio/chunked.py`, `database/migrations.py`) carry per-file MIT attribution headers referencing a pinned upstream commit. The full license trail is in `NOTICE.md` + `voicebox-pin.txt`.

## Contributing

Per-file SPDX-License-Identifier headers required on every new file:

- `MIT` for first-party files
- `MIT` for files lifted from upstream MIT code too — but they additionally carry a full attribution block referencing the pinned commit in `voicebox-pin.txt`. The identifier is no longer compound because upstream and this project are both MIT now

See `project_licensing_attribution` in the memory layer for the policy + templates.

- **Python**: ruff for lint, pytest for tests. Run both before opening a PR.
- **Vue**: prefer single-file components. CSS variables for design tokens (no Tailwind).
- **Rust (Tauri shell)**: keep it minimal. Move business logic to Python.
- **Docs are mandatory**: every feature ships with a `FEATURES.md` section (what/when/how/examples/troubleshooting).
