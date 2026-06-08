# Morning recap — JustTTS

> The in-repo session-pickup doc. Reflects current code state, not history.
> If you're starting a fresh session, read this immediately after `CLAUDE.md`.

## Where we are (2026-06-08)

- **HEAD**: `f7944bb` on `main`
- **Repo**: `E:\Dev\Web\justtts-new\` (GitHub: `delebash/JustTTS`)
- **Stack**: Tauri 2 shell + Vue 3 SPA + Python 3.10+ FastAPI
- **Routes loaded**: 51
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
- Forking voicebox
- Docker pipeline
- TypeScript migration of the renderer
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
