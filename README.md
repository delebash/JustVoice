# 🎙️ JustVoice

**A cross-platform open-source voice production studio for audiobook producers, game developers, podcasters, dictation users, and accessibility users. Built on Electron + Vue 3 + a Node server (Fastify + SQLite).**

JustWrite-compatible imports are one of several supported workflows — see `docs/import-formats.md`.

License: **MIT** (see `LICENSE`).

## What it does

- **Audiobook production** — write in JustWrite, produce in JustVoice, ship to ACX with chapter markers and ACX-spec mastering
- **Game NPC voicing** — voice 50–500 NPCs from one project, export per-line WAVs for Unreal Engine import
- **Podcasting** — multi-track timeline editor, paralinguistic tags, multi-character mixing
- **Dictation** — global hotkey + local speech recognition (Qwen3-ASR) + local LLM refinement + OS-level paste injection
- **General TTS** — Kokoro, Chatterbox Multilingual and Qwen3-TTS (CustomVoice, Base, VoiceDesign), run by one local speech runtime ([audio.cpp](https://github.com/0xShug0/audio.cpp)), plus OpenAI-compatible and cloud providers — every bundled model permits commercial output

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
| `NOTICE.md` | Third-party attribution (MIT/Apache lifts, the speech runtime, models) |
| `LICENSES.md` | Dependency license inventory |
| `MORNING_RECAP.md` | Current build state — what shipped, what's pending |

## Quick start

### Desktop app

```bash
git clone https://github.com/delebash/justvoice-new.git
cd justvoice-new
npm install
npm run dev
```

The shared AI stack (`@delebash/llm-runner`) comes from the kit checked out beside this repo
(`../just-llm-runner`), as `package.json` names it. `npm run dev` opens the desktop app on
Vite's dev server with hot reload; its server runs on the dev data folder `data/` in the
checkout. `npm run build` makes the installer (`release/`).

`npm run dev` runs the speech runtime from our audio.cpp source when it is checked out beside
this repo (`git clone -b jv https://github.com/delebash/audio.cpp ../audio.cpp`): it builds
that checkout first — only what changed; the first build takes about 30 minutes — so the app
always runs its latest code. That needs Visual Studio's C++ tools on Windows, plus the CUDA
12.4 toolkit for an NVIDIA build (without it you get the CPU build). Without the checkout the
app downloads the pinned release from the AI page as usual.

### Headless server (run on a remote box, hit from any browser)

```bash
npm run server -- --port 17494          # from a checkout
justvoice-server serve --port 17494     # an installed app (Windows, in the install folder)
```

Then point any browser at `http://localhost:17494/ui/`. More in
[docs/run-modes.md](docs/run-modes.md).

> **Naming**: the headless launcher is `justvoice-server`, never `justvoice` — the app's exe is
> `justvoice.exe`, and a launcher sharing its name makes Windows run the GUI exe instead.

### Install the speech engines

Use AI Settings → Speech engines in the UI: **Install speech runtime** downloads
the one program every engine runs on, in the build that suits your machine
(CUDA, Vulkan, CPU or Metal), and each model downloads from its own row. There
is nothing else to install; the app is the installer. See
[docs/engines.md](docs/engines.md).

## Repository layout

```
.
├── index.html                 # Vite entry — the repo root is the Vite root
├── public/                    # Copied verbatim into the build
├── electron/main.js           # The desktop app: the kit's shared Electron shell with this app's settings
├── build/                     # Icons and the headless launcher the installer ships
├── src/                       # Vue 3 + Pinia + Vite SPA
│   ├── components/            # ListPane, CapturePill, AudioKeepAlive, etc.
│   ├── stores/                # Pinia: api, server, player, ui, audioChannel, generation (AI tasks live in the kit's store)
│   ├── services/              # HTTP client per endpoint group; native.js is the one door to the desktop shell
│   └── views/                 # One per top-level tab
├── server/                    # The Node server (Fastify + SQLite) — the brain
│   ├── src/
│   │   ├── api/               # /v1/* HTTP routes, one file per area
│   │   ├── audio/             # WAV headers, the analyzer, chunked TTS, the DSP program's client
│   │   ├── database/          # The SQLite schema (models_schema.js), sessions, seeds
│   │   ├── engines/           # Per-engine model catalogs + audiocpp/ (the speech runtime + request mapping)
│   │   ├── storage/           # Voices, profiles, lexicons and the other stores
│   │   ├── models.js          # The request/response shapes (the wire contract)
│   │   ├── app.js             # The server: registers every router
│   │   └── serve.js           # The entry the desktop app and `npm run server` run
│   └── tests/                 # vitest (`npm run test:server`)
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

🚧 **Phase 4b (UI)** — Foundation in place (AudioKeepAlive, ListPane, CapturePill, 5 new Pinia stores, BooksView). Pending: 8 settings sub-routes, full aesthetic CSS sweep matching the preview HTML, StoriesView (timeline editor port), CapturesView (dictation pill), EffectsView (pedalboard chain editor)
🚧 **Phase 4c+5 (DictateWindow agent-speak cycle)** — Backend ready, Vue + Rust window-spawn integration pending
🚧 **UE integration** — Research-first, deferred until main program completes (see `project_unreal_deep_dive_deferred` memory)

## Status

See `MORNING_RECAP.md` for the current build state. JustVoice's data model + HTTP API + desktop shell + license posture are all locked. Remaining work is mostly UI tabs (Phase 4b) — they land one-per-PR going forward.

## Project relationships

### To `justwrite-app` (same developer)

JustWrite is the novel-writing app. JustVoice can be driven by JustWrite (the audiobook workflow) OR run standalone (game, podcast, dictation). The wire format is HTTP per `CONTRACT.md`. JustWrite owns the manuscript + final M4B mux (via FFmpeg.wasm); JustVoice owns the engine pool + ACX mastering. Either can ship without the other.

## Contributing

Per-file SPDX-License-Identifier headers required on every new file:

- `MIT` for first-party files
- Code taken from another project keeps its licence notice and gets an entry in `NOTICE.md`

See `project_licensing_attribution` in the memory layer for the policy + templates.

- **Server and app**: Biome for lint (`npm run lint`), vitest for tests (`npm run test:server`, `npm run test:unit`). Run them before opening a PR.
- **Vue**: prefer single-file components. CSS variables for design tokens (no Tailwind).
- **Desktop shell**: `electron/main.js` only names this app's settings; the shell is the kit's. Business logic lives in the server.
- **Docs are mandatory**: every feature ships with a `FEATURES.md` section (what/when/how/examples/troubleshooting).
