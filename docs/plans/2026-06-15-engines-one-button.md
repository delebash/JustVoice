# Engines: one-button install (Ollama-style)

**Authored 2026-06-15 (busy-rubin).** User directive after the previous
download-contract work: "are we overcomplicating it?" — yes. Ollama is
`ollama pull → ollama run` with one button, one place, one mental model.
We had Download + Load + a Source ▾ pill + a settings override surface,
plus an architectural rot where prefetch lands in `models_dir/{variant_id}/`
but the engine's `from_pretrained()` reads from `~/.cache/huggingface/`.

This plan collapses the surface, fixes the rot, and removes UI clutter.

**User rulings (locked, 2026-06-15):**

1. **One button per model row.** Click "Load model" → if weights aren't
   downloaded yet, fetch them; then load. Progress strip shows phase
   throughout: connecting → downloading → extracting → loading → loaded.
   No separate Download button.
2. **Drop the C4 Source ▾ pill from the UI.** Keep the S0 endpoints
   (`/v1/engines/{id}/sources`) as a settings-level escape hatch for the
   rare URL-shift case, but don't surface in EnginesView. If we need it
   later we put it in a Settings → Engines troubleshooting card.
3. **Fix the cache-path mismatch** so prefetch lands where `engine.load()`
   reads. HF engines: write to HF cache (default `snapshot_download`
   behavior — drop our `local_dir=` override). Kokoro (URL tarball):
   keep `models_dir/{variant_id}/` since its `engine.load()` already
   reads there.

## Code paths in scope

### Server

- **`installer._hf_snapshot_to`** (S1 HF path): drop `local_dir=` so
  `snapshot_download` writes to its default cache (`~/.cache/huggingface/
  hub/models--<owner>--<repo>/...`). The tqdm-shaped reporter stays —
  bytes still tick correctly.
- **`installer._url_stream_to`** (S1 kokoro path): unchanged — kokoro's
  engine already reads `models_dir`.
- **`installer.spawn_prefetch`**: target dir logic switches: HF source
  → no explicit dir; URL source → `models_dir/{variant_id}/`. Cancel
  cleanup follows.
- **`/v1/engines/{id}/load`** (`engines_models_api`): when the engine
  is managed AND the variant's weights aren't on disk, prefetch BEFORE
  load, in the same job. Phase sequence:
  `connecting → downloading → extracting → loading-weights → warming-up
  → loaded`. The renderer just polls one job.
- **`/v1/engines/{id}/install`**: keep for the venv-only setup path
  (isolated engines that need pip first). The "Install engine" verb
  remains for venv-build engines (Dia, MOSS-TTS, etc.) since that's a
  legitimately separate step from model download. For shared-runtime
  engines (Chatterbox, Kokoro, etc.) there's no Install button — Load
  does everything.
- **`hf_cache.is_hf_repo_cached(repo)`** already exists and already
  drives the `on_disk` flag in `/v1/engines/{id}/models`. That probe is
  the source of truth. No new endpoint needed.

### Renderer

- **`EnginesView.vue` model row**:
  - **Before:** Download / Load / Loaded buttons depending on state.
  - **After:** One "Load" button. Status pill to the left shows
    `Loaded` / `Ready (downloaded)` / `Not downloaded`. Hover the pill
    for the size info. Click Load — if weights missing, the C3 strip
    appears below the row, runs through prefetch + load phases.
- **`install()` and `load()` functions**: merge into one — `load()`
  calls `/v1/engines/{id}/load` directly. The server takes care of the
  prefetch-first behavior. The renderer doesn't need to know whether
  weights are present.
- **C4 Source ▾ pill**: remove from the model-row markup. Keep the
  store + dialog helpers as dead code? No — delete them. If we need
  the override surface back we know where the endpoints live.
- **Header strip "Install engine"**: only renders for venv-build
  engines that need a separate setup. Chatterbox + Kokoro skip it.

## Risk + reversal

- The HF cache path is symlink-based. On Windows without dev mode,
  `huggingface_hub` falls back to file copies — still works, takes 2x
  disk during download. Not a regression from today; same code path.
- If a user has already pre-downloaded into the old `models_dir/{
  variant_id}/` location, the new code won't find it there for HF
  engines. We migrate by detecting the old dir on first load AND
  triggering re-fetch into HF cache. Document in MORNING_RECAP.
- The Source ▾ pill is gone but the endpoints remain. A user already
  on this build with an override set keeps using their override (S0
  resolver reads settings, not the pill). No data loss.

## Verification

- **Server tests** (extend `test_engine_sources_and_prefetch.py`):
  - `_hf_snapshot_to` no longer passes `local_dir` to snapshot_download
    (verified via fake module's call kwargs).
  - `/v1/engines/{id}/load` on a managed engine without weights kicks
    a prefetch job in the same flow (phase sequence visible from
    `/v1/jobs/{id}`).
- **Renderer Playwright** (rewrite `verify-engines-c1c2.mjs` →
  `verify-engines-onebutton.mjs`):
  - Only one action button per model row (no separate Download).
  - Clicking Load on a not-downloaded variant: strip shows downloading
    → extracting → loading; status pill flips to Loaded.
  - C4 Source ▾ pill is gone (selector returns 0).
  - Sibling variant stays untouched (C1 still works).
- **Regression**: c3 (strip + Cancel still correct), no-fakes, dialogs.

## Execution order (single-item)

1. **Plan committed** (this file).
2. **Server fix #1**: `_hf_snapshot_to` drops `local_dir=`.
3. **Server fix #2**: `/v1/engines/{id}/load` auto-prefetches when
   weights missing.
4. **Renderer #1**: collapse Download/Load to one button. Status pill
   left of action. Drop C4 source pill.
5. **Tests**: server + Playwright.
6. **Migration note** in MORNING_RECAP for users with old `models_dir`
   weights (they re-fetch on first Load; old dirs orphaned until they
   uninstall the engine).
7. Run all suites; commit one logical step at a time.
