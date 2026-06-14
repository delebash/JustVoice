# Engines: consistent download → load contract + inline progress UI

**Authored 2026-06-14 (busy-rubin).** User-reported defects + UX request:

- Chatterbox "Download" says installed instantly with no real download (model fetch
  is hidden inside `Load`, not surfaced as a download step).
- Kokoro downloads but the progress bar hangs through download AND extraction.
- Clicking Download lights up "Downloading" + "Load/Unload" on **every** variant
  for that engine (state keyed per-engine instead of per-variant).
- After a download finishes the button still says "Download" until a page refresh.
- UX ask: a bigger, prominent inline progress strip per model row; Cancel button;
  same shape for engine install too.

**User rulings (locked, 2026-06-14):**

1. **Same contract for ALL engines.** Download is its own step that reports real
   bytes for every engine; Load is a separate action against on-disk weights.
2. **Big inline progress strip on the row** that is downloading/installing
   (full-width, large bar, % + MB done/total + MB/s + ETA, current file, Cancel,
   error region). The compact mini-progress goes away. Same shape for engine
   install (venv build) too.
3. **Real Cancel + partial cleanup** — server kills the snapshot_download +
   deletes the partial dir; client Cancel POSTs `/v1/jobs/{id}/cancel`.
4. **Operator-overridable download sources** (CLAUDE.md: "no hardcoded
   operator-tunable values"). Today the model URLs / HF repos are
   **hardcoded** in each engine's `manifest.py` and there is no GUI to
   override them (verified 2026-06-14: only `settings.engines.kokoro
   .model_dir_override` exists, path-only, no UI). User decree: an URL
   shift must be repairable from the GUI without editing code.

---

## Server (`server/justvoice/`)

### S0 — Settings-overridable download sources

- Extend `settings.engines.<engine_id>` with:
  ```py
  class EngineModelSourceOverride(BaseModel):
      url: str | None = None           # for URL-tarball engines (kokoro)
      hf_repo: str | None = None       # for HF-snapshot engines
      hf_revision: str | None = None   # pin a commit / tag

  class EngineOverrides(BaseModel):
      model_dir_override: str | None = None        # already exists for kokoro
      sources: dict[str, EngineModelSourceOverride] = {}  # variant_id → override
  ```
- The prefetch worker resolves the source as:
  override.url || override.hf_repo+revision || manifest.MODELS[variant].url || .hf_repo.
- Add `GET /v1/engines/{engine}/sources` → returns, per variant, the
  effective source + provenance (`"manifest"` | `"override"`). The renderer
  uses this to populate the per-row "Source" affordance.
- Add `PUT /v1/engines/{engine}/sources/{variant}` and `DELETE` (clear back
  to manifest default). Both write through PATCH `/v1/settings`.

### S1 — One pre-Load fetch path per engine

- Make `MODELS = [{hf_repo, size_mb, url?, ...}, ...]` the contract (kokoro
  declares its URL-tarball model in MODELS instead of the separate block).
- Each engine plugin exposes `prefetch_model(variant_id) -> Path`:
  - HF repos → `huggingface_hub.snapshot_download(repo_id, local_dir=…,
    cache_dir=…, tqdm_class=ProgressReporter)`. The reporter pushes bytes into
    the job row.
  - URL tarballs (kokoro) → streamed `requests.get(stream=True)` with chunked
    bytes accounting, then tar extraction with its own bytes counter (kokoro's
    700 MB is mostly extract — count both phases against `bytes_total`).
- The engine's `load()` ASSUMES the variant is on disk. If not, it fails with
  a clear `needs_download` error rather than fetching inline. (This kills the
  Chatterbox "Load downloads silently" behavior.)

### S2 — Job rows with real progress + cancel

- Per-variant job rows in the existing job store (the engine_id+variant_id pair
  is the natural key — currently the install path is per-engine, conflating
  variants).
- Job row fields: `phase` (connecting | downloading | extracting | verifying |
  completed | failed | cancelled), `bytes_downloaded`, `bytes_total`,
  `current_file`, `started_at`, `last_update_at`, `error`.
- `POST /v1/jobs/{id}/cancel`: sets a cooperative cancel flag; the prefetch
  worker checks it between files / chunks, raises, and the finally-block
  deletes the partial directory. The job row flips to `cancelled`.

### S3 — Per-variant install + delete endpoints

- `POST /v1/engines/{engine}/install` already accepts `{ model_variant }` —
  use it as the per-variant Download (currently install conflates "make engine
  ready" with "fetch model" for venv engines; split them):
  - `POST /v1/engines/{engine}/install_engine` → builds the venv (for
    `ISOLATION="venv"` engines). No model bytes.
  - `POST /v1/engines/{engine}/install` (kept) → fetches the named variant
    using prefetch_model. **No venv work here.**
- `DELETE /v1/engines/{engine}/models/{variant}` already exists; verify it
  reports `freed_bytes` so the row can show what was reclaimed.

### S4 — Recommender reports per-variant on-disk truth

- `/v1/engines/{engine}/models/recommended` already has
  `downloaded_variant_ids` — make it the ONLY source of truth. The renderer
  should never fall back to `engine.status === "installed"` to decide whether
  a variant is on disk (that's the "all variants flip to Load" bug).

## Client (`src/renderer/src/views/EnginesView.vue`)

### C1 — State keyed per (engine, variant), not per engine

- Replace `busy[engineId]`, `progress[engineId]`, `installJobs[engineId]` with
  composite keys: `busy[`${engineId}/${variantId}`]`. Same for `progress`.
- `contextualAction` and `modelOnDisk` consult the per-variant key.
- `isOnDisk` STOPS falling back to `engine.status` — uses only
  `variants[engine.id]?.recommended?.downloaded_variant_ids`.

### C2 — Refresh re-fetches variants after install/delete

- After `install()` / `unload()` / `deleteModel()`, the code calls `refresh()`,
  but `refresh()` early-returns for any engine whose variants are already
  cached (`if (variants[eng.id]) return;`). Fix: `install()` /
  `deleteModel()` already `delete variants[engineId]` — extend to install too
  so the refresh actually re-reads recommended.

### C3 — Inline progress strip (the UX change)

- New canonical class `.jv-install-strip` (promoted to `styles.css` so the
  same strip serves engine-install + per-variant Download): full-row block
  with:
  - Title row: engine/variant name · phase pill · MB done / total · MB/s · ETA
  - Wide bar (height ~10px), gradient fill, indeterminate stripes when
    `bytes_total` is null.
  - Footer row: `current_file` (truncated mono) · Cancel button (real,
    POSTs `/v1/jobs/{id}/cancel`) · error in danger color.
- Replaces the tiny `.ev-progress` slice in the current `.ev-ghead`. Rendered
  inside `.ev-gbody` so it's prominent and adjacent to the model row.
- For engine-install (venv build), the same strip renders against the engine
  group header until install completes.

### C4 — Operator-overridable source UI

- Per model-row: a small `Source: <hostname> ▾` link/affordance under the
  variant name (muted text, matches the existing per-row metadata).
- Click → inline editor (canonical jv-overlay/jv-modal): one field for URL
  or hf_repo (+ optional revision), with the manifest default shown as
  placeholder and a "Reset to default" link.
- Status pill: `default` (no override) vs `overridden` (operator set).
- Overrides apply on the NEXT Download — no live-reload mid-flight.
- For overridden sources the download strip prepends "(operator source)"
  so it's visible in the progress UI, not just buried in settings.

### C5 — Polling + freshness

- Continue the existing 800ms job poll, but tag stale jobs (`last_update_at >
  10s ago`) with a "Stuck" pill in the strip — matches the Tasks pattern.

## Verification

- New committed `scripts/verify-engines.mjs` (Playwright) that exercises
  the FULL contract against a server with a stubbed prefetch:
  - Engine-install for a venv engine shows the strip; Cancel kills it and
    no partial venv is left.
  - Per-variant Download shows the strip with bytes ticking; sibling variant
    rows stay as **Download** (not "Downloading") and don't flip to Load.
  - On completion the row's button updates to **Load** WITHOUT a page
    refresh (validates C2).
  - Cancel mid-download removes partial files (validates S2) and the row
    snaps back to **Download**.
- Existing `verify-dialogs` (31/31) + `verify-no-fakes` (16/16) re-run as
  regression gates.

## Execution order (per RULE #2 — single-item queue)

1. **S0**: settings schema + GET/PUT/DELETE sources endpoints (no UI yet).
   Source override resolution wired into the (existing) prefetch path so
   custom URLs are honored even before the renderer ships the UI.
2. **S1**: extract `prefetch_model` worker (kokoro keeps current URL/tar
   behavior wrapped in the worker; chatterbox + the other 8 HF engines get
   a real `snapshot_download` prefetch wired to the existing job store).
3. **S4**: make `downloaded_variant_ids` authoritative; renderer C1 + C2.
4. **S2**: Cancel endpoint + cleanup. Renderer Cancel button wired.
5. **C3**: inline progress strip + canonical class.
6. **C4**: per-row source override UI (the GUI for S0).
7. **verify-engines.mjs** end-to-end (incl. an override-source round trip).
8. Repeat the regression suites; commit per step; push.

This plan is the contract. Don't deviate without updating this file in the
same commit.
