# Phase 5 — JustWrite → JustVoice integration

> Coordinated changes to `E:\Dev\Web\justwrite-app` so JustWrite drives JustVoice over HTTP for audiobook production. Per `CONTRACT.md`: JustWrite owns the manuscript + cast + M4B mux; JustVoice owns the engine pool + ACX mastering.

**JustVoice side: DONE.** All HTTP endpoints + Tauri shell support exist.

**JustWrite side: TO DO** (edits live in JustWrite's repo, not this one).

## What JustVoice exposes (already in this repo, ready to call)

- `POST /v1/projects/import?source=justwrite` — accepts a JustWrite book export JSON, auto-creates Project + Scenes + Blocks + Personas + VoiceProfiles. Returns `{ project_id, scene_count, block_count, persona_count, created_personas, reused_personas }`. See `server/justvoice/api/projects_api.py:JustWriteBookImport`.
- `POST /v1/render_jobs` — kicks off a chapter / project render. SSE progress at `/v1/render_jobs/{id}/stream`.
- `POST /v1/master` — applies the active mastering preset (ACX by default) to a chapter WAV.
- `POST /v1/analyze` — LUFS / peak / noise floor / clipping report (the ACX QC gate).
- `GET /v1/projects/{id}/export` — bundle the project as a ZIP (project + cast + lexicons + audio + masters).
- All standard CRUD: `/v1/voices`, `/v1/personas`, `/v1/lexicons`, `/v1/engines`, `/v1/settings`.

## JustWrite-side changes required

### 1. Rename the install Rust command

**File**: `justwrite-app/src-tauri/src/lib.rs:944-1107` (per the audit).

```rust
// Replace JustWrite's legacy `*_install` command (whatever name it currently uses)
// with `justvoice_install`. Optionally keep the old one as a deprecated alias
// for backward compat with users running the previous JustWrite installer.
#[tauri::command]
async fn justvoice_install(app: tauri::AppHandle) -> Result<InstallResult, String> {
    // Clones JustVoice and runs its per-engine venv setup.
    // Repo: https://github.com/delebash/justvoice-new  (or new fork URL)
    // Branch: main
    // Then runs the per-engine venv setup via `python -m justvoice.cli setup`.
    install_from_git(
        &app,
        "https://github.com/delebash/justvoice-new.git",
        "main",
        "justvoice-server",  // installed via `pip install -e server/`
    ).await
}

#[tauri::command]
fn justvoice_health(server_url: String) -> Result<bool, String> {
    // Hit GET {server_url}/v1/health; return true if status_code 200.
}
```

Register both in `invoke_handler!` alongside (or replacing) the legacy install command.

### 2. Point `services/render.js` at JustVoice's endpoints

**File**: `justwrite-app/src/renderer/src/services/render.js` (the existing render-driving code).

Replace the legacy server URLs with JustVoice's. Add a config item to JustWrite settings for the JustVoice server URL (default `http://127.0.0.1:17494`).

Concrete shape: when the user clicks "Render audiobook" in StudioView, do this loop:

```js
// Pseudo-code — the actual rewrites need to live in JustWrite's repo.
import { justvoiceClient } from "./justvoice.js";

export async function renderAudiobook(book, opts = {}) {
  // 1. Import the book as a JustVoice Project (one-time per book).
  if (!book.justvoiceProjectId) {
    const result = await justvoiceClient.import("justwrite", book);
    book.justvoiceProjectId = result.project_id;
  }

  // 2. Kick off a render job for the project.
  const job = await justvoiceClient.startRenderJob({
    scope: "project",
    project_id: book.justvoiceProjectId,
  });

  // 3. Subscribe to SSE progress.
  const source = new EventSource(`${SERVER_URL}/v1/render_jobs/${job.id}/stream`);
  source.onmessage = (evt) => {
    const update = JSON.parse(evt.data);
    opts.onProgress?.(update);
  };

  // 4. When job completes, fetch per-chapter mastered WAVs.
  // 5. Run JustWrite's existing m4b.js (FFmpeg.wasm) to mux chapters into an M4B.
  // 6. Save M4B locally; user uploads to ACX.
}
```

### 3. Update JustWrite's `services/speakerAttribution.js` to include `justvoice_persona_id`

When JustWrite identifies which character speaks a paragraph, also write the corresponding JustVoice `Persona.id` (returned by the import step) so re-renders don't re-create personas.

### 4. Add JustVoice server URL config to JustWrite settings

```js
// justwrite-app/src/renderer/src/stores/settings.js
{
  justvoice: {
    serverUrl: "http://127.0.0.1:17494",
    bearerToken: "",
    installed: false,
  }
}
```

### 5. Update `StudioView.vue` to show JustVoice status

- Render job progress bar (driven by SSE)
- Cast panel — show JustVoice persona IDs alongside JustWrite character IDs
- ACX QC badge per chapter (green/yellow/red from `/v1/analyze` result)

### 6. End-to-end smoke test

1. JustWrite opens a new book.
2. User adds 3 characters with bios.
3. User writes 2 chapters with dialogue.
4. User clicks "Render audiobook."
5. JustWrite:
   - Imports the book as a JustVoice Project (`POST /v1/projects/import?source=justwrite`)
   - Starts a render job (`POST /v1/render_jobs`)
   - Subscribes to SSE progress
6. JustVoice:
   - Renders each block via the chosen engine
   - Applies ACX mastering per chapter
   - Marks the job complete
7. JustWrite:
   - Downloads each chapter's mastered WAV
   - Runs `services/m4b.js` (FFmpeg.wasm) to mux into M4B with chapter markers
   - Surfaces the M4B for ACX upload
8. User submits to ACX.

## Open question — JustWrite book export schema

JustVoice's `JustWriteBookImport` Pydantic model in `projects_api.py` is a reasonable guess at the export shape. Before the spike, look at JustWrite's actual export code (under `justwrite-app/src/renderer/src/services/export/*`) and adjust the Pydantic model + sample JSON if the field names don't match.

## When this lands

Once Phase 5 ships, the audiobook workflow is end-to-end:

> Author writes in JustWrite → JustWrite calls JustVoice via HTTP → JustVoice renders + masters → JustWrite muxes M4B locally → User uploads to ACX.

JustVoice stays usable for game (Unreal) + podcast + dictation users via its own standalone UI; JustWrite is one of many drivers.
