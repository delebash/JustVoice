# JustVoice — v1.0 Design Freeze

> Single source of truth for v1.0. Every architectural decision lives here. Memory files point to this; CLAUDE.md points to this; code reviews reject drift from this. Drafted 2026-06-08 evening after the multi-workflow architecture decision and the voicebox feature-parity deep-dive (234 features cataloged in `preview/voicebox-feature-comparison.md`).
>
> **Status legend**: ✅ locked · ⏳ pending user answer · 📋 deferred to v1.1+

---

## 1. Product positioning

**JustVoice is a voice production studio** with first-class support for **five distinct use cases**:

1. **Audiobook production** (chapters + cast + lexicons + ACX mastering + M4B export — driven by JustWrite or standalone)
2. **Game character voicing** (Unreal Engine NPC dialogue, large character casts at 50-500 scale, per-line WAV + JSON sidecar export, future `.uplugin`)
3. **Podcast production** (multi-track timeline, paralinguistic tags, intros/outros, multi-character)
4. **Dictation** (global hotkey, system audio capture, Whisper transcription, LLM refinement, OS-level paste injection)
5. **Accessibility & general TTS** (screen-reader-friendly playback, headless server for remote access)

**No use case is privileged over the others.** All five share the same engine pool, voice profile system, persona system, lexicons, effects chain, and HTTP API. Differentiation lives at the UI tab level + per-use-case export pipelines.

---

## 2. The locked decisions

| Decision | Value |
|---|---|
| Stack — desktop shell | ✅ Tauri 2 (Rust) — same as voicebox, JustWrite |
| Stack — renderer | ✅ Vue 3 + Pinia + Vite (NOT React; we keep what we have, port voicebox patterns to Vue) |
| Stack — backend | ✅ Python 3.10+ FastAPI + SQLite via SQLAlchemy |
| Primary persistence | ✅ SQLite (`data/justvoice.db`); `settings.json` is the only remaining atomic-JSON store |
| Audio blobs | ✅ Files on disk under `data/audio/`, paths referenced from SQLite rows |
| Migration pattern | ✅ Hand-rolled idempotent column-existence checks (lifted from voicebox `backend/database/migrations.py`); no Alembic |
| License (today) | ✅ Apache-2.0 |
| License (after pedalboard adoption) | ✅ GPL-3.0-or-later (atomic flip commit) |
| Attribution policy | ✅ See `project_licensing_attribution` memory + per-file headers on lifts |
| Use cases | ✅ Audiobook + game + podcast + dictation + accessibility (all first-class) |
| Engine count v1 | ✅ All 10 (Kokoro, Chatterbox×2, Qwen3×2, LuxTTS, TADA, Dia, MossTTS, Higgs) + external OpenAI-compatible |
| Engine isolation | ✅ Per-engine venv (existing JustVoice advantage over voicebox's module-global singletons) |
| Aesthetic — light mode | ✅ Cream paper `#f6f5f1` + forest green accent `#3a7d63` + warm gold warnings `#c89a3a` + oxblood danger `#a8442e`. Sans throughout. Rounded but not bubbly. The preview HTML's look IS the canon. |
| Aesthetic — dark mode | ✅ Deep charcoal `#1a1a1c` + warm off-white text `#e8e6e1` + same forest-green accent (slightly desaturated for dark contrast). Auto via `prefers-color-scheme` AND manual override via Settings → General → Theme picker (light / dark / system). |
| Theme toggle | ✅ Three-way: **light** / **dark** / **system** (follows OS via `prefers-color-scheme` media query). Persisted in `voicebox-ui` localStorage key (rename to `justvoice-ui`). Implementation: `:root.dark` class toggle on `document.documentElement`. Auto-applied on rehydrate. Same pattern voicebox uses (uiStore.theme + ThemeSelect.tsx in Settings → General). |
| Navigation | ✅ 80px left icon sidebar, 13 tabs (Generate, Stories, Chapters, Voices, Personas, Lexicons, Capture, Effects, Engines, Train, Compare, Cache, Settings) |
| Sidecar pattern | ✅ JustWrite spawns JustVoice as a child process (existing pattern in `justwrite-app/src-tauri/src/lib.rs:944-1107`) |
| Headless mode | ✅ Python sidecar runs standalone via `justtts-server serve`, serves UI at `/ui/`, same as voicebox |
| Cross-language contract | ✅ Pydantic models in `server/justtts/models.py` are the source of truth; OpenAPI snapshot diffed in CI |
| Sidecar binary name | ✅ `justtts-server` (NOT `justtts` — avoids Windows `CreateProcessW` spawn-loop with the Tauri binary) |
| Product brand name | ⏳ JustVoice (pending USPTO TESS + Google check — task #58). All docs use "JustVoice"; Python package + console-script `justtts`/`justtts-server` keep their names until the rename PR. |

---

## 3. Pending decisions with proposed answers

These are ⏳ rows from the prior status table. Each has a proposed answer; user confirms or overrides:

### 3.1 Pedalboard adoption timing → **Phase 3** ✅ ANSWERED 2026-06-08

Trigger the Apache → GPL-3.0-or-later license flip in Phase 3 when we lift voicebox's effects chain. The flip is **atomic** — a single git commit that updates: root `LICENSE`, `server/pyproject.toml`'s license field, `NOTICE.md`, `LICENSES.md`, every first-party file's SPDX header (`Apache-2.0` → `GPL-3.0-or-later`), every lifted-file dual header (`MIT AND Apache-2.0` → `MIT AND GPL-3.0-or-later`). No partial state.

### 3.2 JustWrite book export schema → **defer to Phase 5 spike**

We need to look at JustWrite's actual export shape (JSON/EPUB/custom) before locking. Add to Phase 5 a 1-day spike: read `justwrite-app/src/renderer/src/services/export/*` to determine the format, then design `POST /books/import` against the real shape. Don't pre-design against an imagined schema.

### 3.3 MCP timing → **Phase 4a backend + Phase 4b UI; ship in v1**

User confirmed multi-use including Unreal. MCP is the agent-callable surface. Ship it in v1. Backend port in Phase 4a, settings UI + bindings table in Phase 4b. Gated by `settings.mcp.enabled` (default off; user opts in).

### 3.4 Code signing → **Windows-only at v1.0; Mac + Linux at v1.1**

Apple Developer enrollment is $99/yr + 1-3 business days. Windows EV cert is $200-400/yr + 2-4 weeks. Mac signing requires more. Buys 4-6 weeks of focus on real audiobook features for v1.0. Mac users get Gatekeeper warning ("unidentified developer, right-click → Open") which is acceptable for an open-source project at v1.0. Linux AppImage is unsigned by default.

### 3.5 Audio channels routing → **MVP backend + UI; deferred to opt-in**

Backend model ships (channels table + per-profile channel_ids array — needed for future) but the Voices tab MultiSelect for channel routing is hidden behind a Settings toggle (default off). Users with multi-output setups (OBS, separate monitors) flip the toggle. Audiobook narrators don't see the complexity.

### 3.6 Take versioning UI → **per-paragraph (the more useful one)**

In ChapterView, each block (paragraph) gets a take-selector dropdown showing all generated takes with set-default. Re-rendering one block doesn't invalidate the rest. This is the killer audiobook QA workflow.

### 3.7 Render queue persistence → **full implementation**

`RenderJob` ORM survives server restart. On startup, `_run_startup` requeues any uncompleted JobBlocks from RenderJobs with status='running'. SSE progress stream for active job. Cancel from UI. Acceptable for v1 because chapter renders take real time and crashing mid-render shouldn't lose hours of work.

### 3.8 External provider per-character → **single global override in v1, per-character in v1.1**

Single setting in External Engines config: "Use external provider for all generations" (off by default). Per-character provider override is power-user and adds UX complexity (extra column in cast table, fallback handling on rate limit). Defer.

### 3.9 Mastering presets exposed in UI → **all 4 editable**

ACX, iAudio, Podcast, YouTube — all visible in Settings, all editable, ACX is the default selection. Power users adjust target LUFS / peak / noise floor / sample rate / channels per preset. Per CLAUDE.md "no hardcoded operator-tunable values."

### 3.10 CUDA wheel download flow → **lift voicebox's pattern (RESTORED)**

I was wrong earlier to suggest cutting this. Single-installer story REQUIRES it.

- Installer ships **CPU-baseline torch** (small — ~250 MB instead of 3-5 GB for CUDA)
- GPU settings page shows "GPU detected: NVIDIA RTX 4090 (CUDA 12.4 not installed)"
- "Install CUDA support" button kicks off the wheel download (`backend/services/cuda.py`'s `check_and_update_cuda_binary` pattern)
- Background task downloads cu124/cu128 wheel via pip-index URL, shows progress in GPU settings + sidebar toast
- After install, server restarts (Rust IPC `restart_server` command) to load CUDA-enabled torch
- Same flow handles auto-update when torch + CUDA versions go stale

Lift `voicebox/backend/services/cuda.py` + `voicebox/app/src/components/ServerSettings/GpuAcceleration.tsx` patterns.

### 3.11 First-launch warmup → **fast real startup + cosmetic rotating messages**

Voicebox's loading screen rotates 20 friendly messages every 3 seconds ("Warming up tensors...", "Calibrating synthesizer engine...", "Building voice embeddings...") while the actual server boots. The messages are decorative — the real startup is fast (<1s for migrations + queue init + GPU check + HF cache mkdir).

**JustVoice adopts the same pattern with our own messages** tailored to multi-use:

- "Warming up tensors..."
- "Initializing voice engines..."
- "Loading personas..."
- "Sharpening lexicon dictionaries..."
- "Calibrating ACX mastering pipeline..."
- "Preparing chapter render queue..."
- "Indexing voice profiles..."
- "Building generation cache..."
- "Tuning audio device routing..."
- "Connecting to model cache..."
- "Verifying CUDA support..."
- "Scanning installed engines..."
- "Optimizing sample crossfades..."
- "Loading character library..."
- "Aligning phoneme dictionaries..."
- "Preparing audiobook export pipeline..."
- "Spinning up dictation listener..."
- "Preparing MCP server endpoints..."
- "Polishing voice embedding space..."
- "Ready when you are..."

The actual `_run_startup` (in `server/justtts/app.py`) does:

1. Log version + Python + platform info
2. SQLite migrations (idempotent column-existence checks, <50ms)
3. Init render task queue
4. Mark stale "generating" rows as "failed" (orphan cleanup from previous crash)
5. Engine plugin discovery (scan `engines/<id>/manifest.py`)
6. Log profile + generation counts
7. GPU backend detection
8. `check_cuda_compatibility()` — warn if torch ↔ GPU mismatch
9. Background task: `check_and_update_cuda_binary()` (CUDA wheel auto-update check)
10. HF cache directory ensure
11. Init progress manager event loop
12. Log "Ready"

Total time: ~1-3 seconds typical. First-ever launch on a fresh machine takes longer because model downloads start when the user picks an engine — not on startup.

---

## 4. Data model (full SQLite schema)

All tables lift voicebox's idempotent migration helper pattern. PKs are UUIDs (str). Foreign keys NOT explicitly indexed by SQLAlchemy `relationship()` (voicebox pattern); ON DELETE CASCADE wired manually in migrations.

### 4.1 Voice & engine layer

```
profiles
  id                  TEXT PRIMARY KEY
  name                TEXT NOT NULL UNIQUE
  description         TEXT
  language            TEXT DEFAULT 'en'
  avatar_path         TEXT
  voice_type          TEXT NOT NULL    -- 'cloned' | 'preset' | 'designed'
  preset_engine       TEXT             -- for voice_type='preset' (kokoro, qwen_custom_voice)
  preset_voice_id     TEXT             -- e.g. 'am_adam' for Kokoro preset
  design_prompt       TEXT             -- for voice_type='designed'
  default_engine      TEXT             -- which engine to use for this voice
  effects_chain       TEXT             -- JSON: serialized EffectConfig[]
  default_lexicon_id  TEXT             -- FK to lexicons (per-profile lexicon override)
  generation_count    INTEGER DEFAULT 0
  sample_count        INTEGER DEFAULT 0
  created_at          DATETIME
  updated_at          DATETIME

profile_samples
  id                  TEXT PRIMARY KEY
  profile_id          TEXT NOT NULL FK profiles.id ON DELETE CASCADE
  audio_path          TEXT NOT NULL    -- absolute file path on disk
  reference_text      TEXT NOT NULL
  duration_sec        REAL
  sample_rate         INTEGER
  created_at          DATETIME

profile_channels  -- per-voice multi-output routing (audio device assignments)
  profile_id          TEXT NOT NULL FK profiles.id ON DELETE CASCADE
  channel_id          TEXT NOT NULL FK channels.id ON DELETE CASCADE
  PRIMARY KEY (profile_id, channel_id)
```

### 4.2 Persona layer (JustVoice addition beyond voicebox)

```
personas
  id                  TEXT PRIMARY KEY
  name                TEXT NOT NULL
  bio                 TEXT             -- max 2000 chars (character backstory)
  voice_profile_id    TEXT FK profiles.id  -- which voice this persona uses
  engine_override     TEXT             -- override the profile's default_engine
  lexicon_id          TEXT FK lexicons.id  -- per-persona lexicon override
  personality_enabled BOOLEAN DEFAULT 0    -- toggles LLM-rewrite at generation time
  imported_from       TEXT             -- 'justwrite' / 'manual' / 'unreal'
  imported_id         TEXT             -- foreign key into JustWrite character roster
  created_at          DATETIME
  updated_at          DATETIME
```

### 4.3 Lexicon layer (JustVoice addition)

```
lexicons
  id                  TEXT PRIMARY KEY
  name                TEXT NOT NULL
  description         TEXT
  scope               TEXT NOT NULL    -- 'global' | 'project' | 'persona'
  project_id          TEXT FK projects.id  -- for scope='project'
  persona_id          TEXT FK personas.id  -- for scope='persona'
  created_at          DATETIME
  updated_at          DATETIME

lexicon_entries
  id                  TEXT PRIMARY KEY
  lexicon_id          TEXT NOT NULL FK lexicons.id ON DELETE CASCADE
  word                TEXT NOT NULL
  pronunciation       TEXT NOT NULL    -- IPA or ASCII-phonetic
  notation            TEXT NOT NULL DEFAULT 'phonetic'  -- 'ipa' | 'phonetic'
  notes               TEXT
  created_at          DATETIME
```

### 4.4 Project layer — generalized over use cases (KEY DECISION)

Following the user's correction: not "Books" specific. A **Project** has a type discriminator and supports audiobook / game / podcast equally:

```
projects
  id                  TEXT PRIMARY KEY
  name                TEXT NOT NULL
  description         TEXT
  project_type        TEXT NOT NULL    -- 'audiobook' | 'game_voicelines' | 'podcast' | 'custom'
  metadata            TEXT             -- JSON: per-type metadata (title/author for audiobook;
                                       --  studio/engine for game; episode_number for podcast)
  default_lexicon_id  TEXT FK lexicons.id
  mastering_preset    TEXT             -- 'acx' | 'iaudio' | 'podcast' | 'youtube' | custom
  imported_from       TEXT             -- 'justwrite' / 'manual' / 'unreal_uplugin'
  imported_id         TEXT             -- ID in source system
  created_at          DATETIME
  updated_at          DATETIME

project_personas  -- which personas (cast) are in this project
  project_id          TEXT NOT NULL FK projects.id ON DELETE CASCADE
  persona_id          TEXT NOT NULL FK personas.id ON DELETE CASCADE
  role_label          TEXT             -- 'narrator' / 'protagonist' / 'antagonist' / 'NPC' / etc.
  PRIMARY KEY (project_id, persona_id)

scenes  -- audiobook: chapter; game: dialogue tree / quest; podcast: episode segment
  id                  TEXT PRIMARY KEY
  project_id          TEXT NOT NULL FK projects.id ON DELETE CASCADE
  position            INTEGER NOT NULL  -- ordinal within the project
  title               TEXT
  description         TEXT
  metadata            TEXT             -- JSON: chapter_number, scene_id, episode_part, etc.
  created_at          DATETIME

blocks  -- audiobook: paragraph; game: NPC line; podcast: take/segment
  id                  TEXT PRIMARY KEY
  scene_id            TEXT NOT NULL FK scenes.id ON DELETE CASCADE
  position            INTEGER NOT NULL
  text                TEXT NOT NULL
  persona_id          TEXT FK personas.id   -- which character speaks this block
  direction           TEXT             -- emotion/style hint (passed through to engine instruct)
  metadata            TEXT             -- JSON: dialogue_tree_id, emotion_tag, viseme_data, etc.
  created_at          DATETIME
```

**Audiobook usage**: project.project_type='audiobook' → scene = chapter, block = paragraph. Mastering preset 'acx'. Imported_from='justwrite'.

**Game usage**: project.project_type='game_voicelines' → scene = dialogue tree / quest / scenario, block = single NPC line. Metadata holds dialogue_tree_id, scene_id from Unreal. Imported_from='unreal_uplugin'.

**Podcast usage**: project.project_type='podcast' → scene = episode segment, block = take. Mastering preset 'podcast'.

This is the heart of the cross-use-case design. Single data model serves all three.

### 4.5 Generation + take layer

```
generations  -- a single TTS render of a block (or ad-hoc text)
  id                  TEXT PRIMARY KEY
  block_id            TEXT FK blocks.id        -- nullable for ad-hoc generations
  persona_id          TEXT FK personas.id      -- nullable
  profile_id          TEXT NOT NULL FK profiles.id
  text                TEXT NOT NULL
  language            TEXT DEFAULT 'en'
  engine              TEXT NOT NULL
  seed                INTEGER
  instruct            TEXT
  audio_path          TEXT             -- absolute file path; null until completed
  duration_sec        REAL
  status              TEXT NOT NULL    -- 'queued' | 'loading_model' | 'generating' | 'completed' | 'failed' | 'cancelled'
  error               TEXT
  is_favorited        BOOLEAN DEFAULT 0
  source              TEXT NOT NULL    -- 'manual' | 'chapter_render' | 'mcp_speak' | 'dictate_replay'
  effects_chain       TEXT             -- JSON: applied effects
  cache_key           TEXT             -- engine-prefixed MD5 for cache lookup
  created_at          DATETIME

takes  -- per-block take versioning (JustVoice addition for re-roll workflow)
  id                  TEXT PRIMARY KEY
  block_id            TEXT NOT NULL FK blocks.id ON DELETE CASCADE
  generation_id       TEXT NOT NULL FK generations.id ON DELETE CASCADE
  source_take_id      TEXT FK takes.id   -- lineage; null if this is the original take
  is_default          BOOLEAN DEFAULT 0  -- exactly one default per block at render time
  label               TEXT               -- user-assigned label ('take 1', 'angrier', 'fast version')
  created_at          DATETIME

generation_versions  -- voicebox's non-destructive effects pattern; we keep this for ad-hoc effects on history rows
  id                  TEXT PRIMARY KEY
  generation_id       TEXT NOT NULL FK generations.id ON DELETE CASCADE
  source_version_id   TEXT FK generation_versions.id
  audio_path          TEXT NOT NULL
  effects_chain       TEXT             -- JSON
  is_default          BOOLEAN DEFAULT 0
  created_at          DATETIME
```

### 4.6 Render orchestration

```
render_jobs  -- resumable scene/project renders
  id                  TEXT PRIMARY KEY
  project_id          TEXT NOT NULL FK projects.id ON DELETE CASCADE
  scope               TEXT NOT NULL    -- 'project' | 'scene' | 'blocks'
  scope_ids           TEXT             -- JSON list of scene_ids or block_ids
  status              TEXT NOT NULL    -- 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  total_blocks        INTEGER
  completed_blocks    INTEGER DEFAULT 0
  failed_blocks       INTEGER DEFAULT 0
  started_at          DATETIME
  finished_at         DATETIME
  created_at          DATETIME

render_job_blocks  -- per-block status within a render job
  id                  TEXT PRIMARY KEY
  job_id              TEXT NOT NULL FK render_jobs.id ON DELETE CASCADE
  block_id            TEXT NOT NULL FK blocks.id ON DELETE CASCADE
  generation_id       TEXT FK generations.id   -- the take this job produced
  status              TEXT NOT NULL    -- 'pending' | 'running' | 'completed' | 'failed'
  attempts            INTEGER DEFAULT 0
  last_error          TEXT
  created_at          DATETIME
  updated_at          DATETIME
```

### 4.7 Stories (DAW timeline — kept from voicebox for multi-track game/podcast assembly)

```
stories  -- voicebox's multi-track timeline; kept for podcast + game assembly
  id                  TEXT PRIMARY KEY
  project_id          TEXT FK projects.id   -- can be tied to a project or freestanding
  name                TEXT NOT NULL
  description         TEXT
  created_at          DATETIME

story_items
  id                  TEXT PRIMARY KEY
  story_id            TEXT NOT NULL FK stories.id ON DELETE CASCADE
  generation_id       TEXT FK generations.id
  version_id          TEXT FK generation_versions.id
  track               INTEGER NOT NULL
  start_time_ms       INTEGER NOT NULL
  trim_start_ms       INTEGER DEFAULT 0
  trim_end_ms         INTEGER DEFAULT 0
  volume              REAL DEFAULT 1.0
  duration            REAL             -- denormalized for fast timeline scrubbing
  created_at          DATETIME
```

### 4.8 Audio device channels (voice → output device routing)

```
channels
  id                  TEXT PRIMARY KEY
  name                TEXT NOT NULL UNIQUE
  is_default          BOOLEAN DEFAULT 0
  device_ids          TEXT NOT NULL    -- JSON list of OS audio device IDs (can be multiple — broadcast)
  created_at          DATETIME
```

### 4.9 MCP integration (per-client voice bindings)

```
mcp_bindings
  client_id           TEXT PRIMARY KEY  -- e.g. 'claude-code', 'cursor', 'unreal-editor'
  label               TEXT
  profile_id          TEXT FK profiles.id  -- which voice this client speaks as
  default_personality BOOLEAN DEFAULT 0    -- per-client default for speak.personality flag
  default_engine      TEXT             -- per-client engine override (null = profile's default)
  last_seen_at        DATETIME
  created_at          DATETIME
```

Per-client defaults matter: when an Unreal editor calls `justvoice.speak(text=...)` without specifying personality or engine, the binding's defaults apply. Lets the user configure "Unreal NPC dialogue always uses engine=Chatterbox with personality=true" once.

### 4.10 Captures (dictation recordings)

```
captures
  id                  TEXT PRIMARY KEY
  audio_path          TEXT NOT NULL
  source              TEXT NOT NULL    -- 'mic' | 'system_audio' | 'upload'
  language            TEXT
  duration_ms         INTEGER
  transcript          TEXT             -- final refined transcript
  raw_transcript      TEXT             -- pre-refinement Whisper output
  refinement_flags    TEXT             -- JSON: { smart_cleanup, self_correction, preserve_technical }
  created_at          DATETIME
```

### 4.11 Effects presets (custom user-defined effect chains)

```
effect_presets
  id                  TEXT PRIMARY KEY
  name                TEXT NOT NULL UNIQUE
  description         TEXT
  chain               TEXT NOT NULL    -- JSON: EffectConfig[]
  is_builtin          BOOLEAN DEFAULT 0  -- 1 for Robotic/Radio/Echo Chamber/Deep Voice
  created_at          DATETIME
```

### 4.12 Webhooks (v1.0 from gap-decision workflow)

```
webhooks
  id                  TEXT PRIMARY KEY
  url                 TEXT NOT NULL
  events_json         TEXT NOT NULL    -- JSON array of WebhookEvent literals
  secret_hash         TEXT NOT NULL    -- bcrypt of the secret (raw secret returned ONCE at creation)
  enabled             BOOLEAN NOT NULL DEFAULT 1
  last_delivery_at    DATETIME
  last_status_code    INTEGER
  log_tail_json       TEXT NOT NULL DEFAULT '[]'  -- rolling tail capped at 50 entries
  created_at          DATETIME
```

Event vocabulary: `render.completed`, `render.failed`, `generation.created`, `voice.created`, `training.completed`, `training.failed`, `model.download.completed`, `model.download.failed`. Closed `Literal` so integrators get IDE completion.

### 4.13 Render presets (v1.0 from gap-decision workflow)

```
render_presets
  id                  TEXT PRIMARY KEY
  name                TEXT NOT NULL
  project_id          TEXT FK projects.id ON DELETE CASCADE  -- nullable; null = global preset
  voice_id            TEXT NOT NULL FK profiles.id ON DELETE RESTRICT
  delivery_json       TEXT NOT NULL DEFAULT '{}'  -- Delivery shape
  master              TEXT             -- 'acx' | 'inaudio' | 'podcast' | 'youtube' | 'none' | NULL
  lexicons_json       TEXT NOT NULL DEFAULT '[]'  -- JSON array of lexicon ids
  seed                INTEGER
  cache_scope         TEXT NOT NULL DEFAULT 'default'
  description         TEXT
  created_at          DATETIME
  updated_at          DATETIME

-- Unique name per project_id (treats null as empty string)
CREATE UNIQUE INDEX idx_render_presets_name_per_project
  ON render_presets(COALESCE(project_id, ''), name);
```

Use case: audiobook producers lock per-book presets (mastering preset + character voice + lexicon); game-devs lock per-character presets for cross-NPC consistency. Voice re-casting mid-book = PATCH the preset, future chapters use the new voice.

### 4.14 Generations — schema additions for bulk-delete + presets

```
ALTER TABLE generations ADD COLUMN status TEXT NOT NULL DEFAULT 'ok';
  -- 'ok' | 'failed' — required by bulk-delete status filter

ALTER TABLE generations ADD COLUMN preset_id TEXT
  REFERENCES render_presets(id) ON DELETE SET NULL;
  -- which preset (if any) produced this generation; null for ad-hoc

CREATE INDEX idx_generations_voice_scope_status_created
  ON generations(voice_id, scope, status, created_at);

CREATE INDEX idx_generations_project_chapter
  ON generations(project_id, chapter_id);
```

### 4.15 Training jobs (was §4.12)

```
training_jobs
  id                  TEXT PRIMARY KEY
  profile_id          TEXT NOT NULL FK profiles.id ON DELETE CASCADE
  engine              TEXT NOT NULL
  status              TEXT NOT NULL    -- 'qc' | 'training' | 'completed' | 'failed'
  samples_accepted    INTEGER
  samples_rejected    INTEGER
  current_step        INTEGER
  total_steps         INTEGER
  loss_history        TEXT             -- JSON: list of {step, loss}
  adapter_path        TEXT             -- path to PEFT/LoRA adapter
  error               TEXT
  started_at          DATETIME
  finished_at         DATETIME
  created_at          DATETIME
```

---

## 5. HTTP API surface (v1.0 endpoints)

Versioned `/v1/*`. All shapes from `server/justtts/models.py`. OpenAPI snapshot diffed in CI.

### Voice + profile
- `GET /v1/voices` — list profiles
- `POST /v1/voices/clone` — create cloned voice from samples
- `POST /v1/voices/import` — import .justvoice.zip
- `GET /v1/voices/{id}` — get profile detail
- `PATCH /v1/voices/{id}` — update profile
- `DELETE /v1/voices/{id}`
- `POST /v1/voices/{id}/samples` — add sample
- `DELETE /v1/voices/{id}/samples/{sample_id}`
- `GET /v1/voices/{id}/export` — download .justvoice.zip
- `POST /v1/voices/blend` — blend two profiles

### Persona
- `GET /v1/personas`
- `POST /v1/personas`
- `GET /v1/personas/{id}`
- `PATCH /v1/personas/{id}`
- `DELETE /v1/personas/{id}`

### Lexicon
- `GET /v1/lexicons`
- `POST /v1/lexicons`
- `GET /v1/lexicons/{id}` — with entries
- `PATCH /v1/lexicons/{id}`
- `DELETE /v1/lexicons/{id}`
- `POST /v1/lexicons/{id}/entries` — add entry
- `PATCH /v1/lexicons/{id}/entries/{entry_id}`
- `DELETE /v1/lexicons/{id}/entries/{entry_id}`
- `POST /v1/lexicons/apply` — preview lexicon application on text (no persistence)

### Project / scene / block
- `GET /v1/projects`
- `POST /v1/projects` — create empty project (any type)
- `POST /v1/projects/import` — import from JustWrite/Unreal/etc. (`?source=justwrite|unreal_uplugin|json`)
- `GET /v1/projects/{id}` — with scenes + blocks summary
- `PATCH /v1/projects/{id}`
- `DELETE /v1/projects/{id}`
- `GET /v1/projects/{id}/scenes`
- `POST /v1/projects/{id}/scenes`
- `GET /v1/projects/{id}/cast` — personas + role labels
- `POST /v1/projects/{id}/cast` — assign persona to project
- `GET /v1/scenes/{id}/blocks`
- `POST /v1/scenes/{id}/blocks`
- `PATCH /v1/blocks/{id}`
- `DELETE /v1/blocks/{id}`

### Generation
- `POST /v1/generate` — synchronous generation (single text + voice + engine; returns audio)
- `POST /v1/generate_async` — async queued generation (returns generation_id; poll via SSE)
- `GET /v1/generate/{id}/stream` — SSE stream of generation status
- `POST /v1/generate/{id}/cancel`
- `POST /v1/blocks/{id}/render` — render a single block (creates take)
- `GET /v1/takes/by_block/{block_id}` — list all takes for a block
- `POST /v1/takes/{id}/set_default` — mark this take as the active one for the block
- `DELETE /v1/takes/{id}`

### Render jobs
- `POST /v1/render_jobs` — start a project/scene/block-list render
- `GET /v1/render_jobs/{id}` — status with progress
- `GET /v1/render_jobs/{id}/stream` — SSE progress
- `POST /v1/render_jobs/{id}/pause`
- `POST /v1/render_jobs/{id}/resume`
- `POST /v1/render_jobs/{id}/cancel`

### Mastering + analysis
- `POST /v1/master` — apply preset to a WAV (preset name or inline custom)
- `POST /v1/analyze` — LUFS/peak/noise floor report on a WAV
- `POST /v1/compare` — A/B WAV comparison

### Engine management
- `GET /v1/engines`
- `POST /v1/engines/{id}/install`
- `POST /v1/engines/{id}/load`
- `POST /v1/engines/{id}/unload`
- `DELETE /v1/engines/{id}` — uninstall
- `POST /v1/engines/external` — add an OpenAI-compatible external engine
- `PATCH /v1/engines/external/{id}`
- `DELETE /v1/engines/external/{id}`

### Settings
- `GET /v1/settings`
- `PATCH /v1/settings`

### Storage / system
- `GET /v1/health` — `{ status, version, model_loaded, gpu_available, gpu_type, backend_variant, vram_used_mb }`
- `GET /v1/health/filesystem` — data dirs (used by Settings → Generation "Open folder")
- `GET /v1/cache` — render cache stats
- `DELETE /v1/cache` — bulk prune (with filters by age / engine / voice)
- `GET /v1/active_tasks` — `{ generations: [...], downloads: [...] }` — recovers in-flight tasks on page-refresh / window-reopen. Polled every 30s by `useRestoreActiveTasks`.
- `GET /v1/capture/readiness` — `{ stt: ModelReadiness, llm: ModelReadiness }` — Whisper + Qwen3 LLM availability for the dictation flow. Polled every 5s while either is missing/downloading; stops once both green.

### SSE streams (server-sent events, individual long-poll endpoints)
- `GET /v1/generate/{id}/status` — per-generation status stream: `loading_model | generating | completed | failed | not_found` + `duration` + `error` + `source`
- `GET /v1/models/progress/{model_name}` — per-model download progress: `{ status: 'downloading'|'extracting'|'complete'|'error', current, total, progress, filename }`
- `GET /v1/render_jobs/{id}/stream` — per-render-job progress (already in §5)

### Captures + dictation
- `GET /v1/captures`
- `POST /v1/captures` — upload a captured WAV
- `GET /v1/captures/{id}`
- `DELETE /v1/captures/{id}`
- `POST /v1/captures/{id}/promote` — promote to voice sample

### Effects
- `GET /v1/effects/available` — engine-supplied catalog (effect types + param schemas)
- `GET /v1/effects/presets`
- `POST /v1/effects/presets`
- `PATCH /v1/effects/presets/{id}`
- `DELETE /v1/effects/presets/{id}`

### Audio channels
- `GET /v1/channels`
- `POST /v1/channels`
- `PATCH /v1/channels/{id}`
- `DELETE /v1/channels/{id}`
- `GET /v1/profiles/{id}/channels`
- `PUT /v1/profiles/{id}/channels` — set channel assignments

### Training
- `GET /v1/training_jobs`
- `POST /v1/training_jobs`
- `GET /v1/training_jobs/{id}` — status with loss history
- `POST /v1/training_jobs/{id}/cancel`

### Webhooks (v1.0 from gap-decision workflow)
- `GET /v1/webhooks` — list registered subscriptions (secret never returned; only `secret_set: bool`)
- `POST /v1/webhooks` — register `{ url, events[], secret? (auto-generated), enabled }` — returns subscription + secret ONCE
- `DELETE /v1/webhooks/{id}` — idempotent
- `POST /v1/webhooks/{id}/test` — fire synthetic event, 10s sync wait, returns `{ delivered, status_code, latency_ms, error? }`

**Delivery semantics:** at-least-once, exponential backoff (1s, 5s, 30s, 5m, max 3 retries), HMAC signature header = `X-JustVoice-Signature: hex(hmac_sha256(secret, body))`. Failed deliveries logged to `log_tail_json` (capped 50 entries per sub). No full delivery history (defer to activity-log v1.1+).

### Bulk-delete generations (v1.0)
- `DELETE /v1/generations` — query params: `voice_id?`, `scope?`, `status: 'ok'|'failed'?`, `older_than: ISO8601?`, `chapter_id?`, `project_id?`, `confirm: bool=False`

`confirm=False` returns dry-run with would-be-deleted count + bytes WITHOUT deleting (forces explicit confirmation). At least one filter required (400 otherwise). Cascades to disk file removal. Atomic single SQL DELETE.

### Backup + Restore (v1.0)
- `GET /v1/backup?include_generations=true` — streams a single ZIP: `application/zip; attachment; filename=justvoice-backup-{iso}.zip`
  - ZIP layout: `manifest.json` (schema_version + server_version + created_at + file_count), `settings.json`, `db/justvoice.sqlite`, `voices/<id>/{embedding.npy, adapter.pt, reference.wav}`, `generations/<scope>/<sha>.wav`, `projects/<id>/...`
  - Stream-zipped so 50 GB backups don't load into RAM
- `POST /v1/restore` — multipart: `file: UploadFile`, `mode: 'replace'|'merge'='replace'`, `confirm: bool=False`
  - Pauses render queue during restore
  - `mode=replace`: nukes existing rows. `mode=merge`: upserts by id, skips conflicts
  - `confirm=False`: dry-run manifest summary, no state change
  - Schema_version mismatch → 409 + migration hint
  - Webhooks re-fired after restore

### Render presets (v1.0)
- `GET /v1/presets?project_id=...` — list (project_id=null filter = global presets)
- `POST /v1/presets` — `{ name, voice_id, delivery?, master?, lexicons[]?, seed?, cache_scope?, project_id?, description? }`
- `PATCH /v1/presets/{id}` — partial update (every field optional)
- `DELETE /v1/presets/{id}` — does NOT affect prior generations rendered with this preset
- **Extension to `POST /v1/generate`**: new optional `preset_id` field. If set, voice/delivery/lexicons/seed/cache_scope taken from preset; any explicit fields override per-field. 400 if both `preset_id` and `voice` null.

### Voice clone preview (v1.0)
- `POST /v1/voices/preview` — generate a short audition clip from a candidate voice WITHOUT persisting:
  - Body: `{ engine, source: 'cloned'|'designed'|'blended'|'imported', ref_wav_b64?, transcript?, prompt?, source_voice_ids?, weights?, strategy?, preview_text='The quick brown fox...', language='en-US', delivery? }`
  - Returns `{ wav_b64, duration_sec, preview_id }`
  - Server holds the candidate voice in an in-memory LRU (cap 20, 10 min TTL) keyed by preview_id
  - If TTL expires without promote, voice is discarded — no library pollution
- `POST /v1/voices/preview/{preview_id}/save` — promote a previewed voice to the persistent library:
  - Body: `{ name, gender? }` → returns `VoiceRecord`
  - 404 if preview_id expired from LRU
  - Idempotent on preview_id

The audiobook-casting workflow: audition 5 candidates per character, save 1, the other 4 discard automatically.

### Project export (v1.0)
- `GET /v1/projects/{id}/export?include_audio=true&include_masters=true&format=zip` — stream a single ZIP:
  - `project.json`, `scenes/*.json`, `cast/<voice_id>.json` (+ reference.wav if cloned), `lexicons/*.json`, `audio/<chapter>/<block_id>.wav`, `masters/<chapter>.mp3`, `manifest.json`
  - Pairs with future `POST /v1/projects/import` (deferred for round-trip after v1.0 ship)
  - Different from `/v1/backup`: backup = whole-server disaster recovery; export = per-project handoff (machine migration, author proofs, Unreal QA handoff)

### MCP bindings
- `GET /v1/mcp/bindings`
- `POST /v1/mcp/bindings`
- `PATCH /v1/mcp/bindings/{client_id}`
- `DELETE /v1/mcp/bindings/{client_id}`

### MCP server (mounted separately at /mcp)
- FastMCP HTTP transport (Streamable HTTP)
- `ClientIdMiddleware` sets `current_client_id` contextvar from `X-JustVoice-Client-Id` header
- `request_is_loopback()` security gate for filesystem-touching tools

**Tools exposed (extended from voicebox's 4 to 6 for our use cases):**

| Tool | Args | Notes |
|---|---|---|
| `justvoice.speak` | `text`, `profile?` (name or id), `engine?`, `personality?`, `language?` | Falls back to per-client `mcp_bindings.profile_id` then global default voice. Per-binding `default_personality` and `default_engine` apply when args omitted. Audio plays via DictateWindow agent-speak cycle, saved to History. |
| `justvoice.transcribe` | `audio_base64` OR `audio_path` (loopback-only), `language?`, `model?` | 200 MB limit. `audio_path` security-gated to loopback callers so a `0.0.0.0`-bound server doesn't become an arbitrary-file-read primitive. |
| `justvoice.list_voices` | `limit=20`, `offset=0` | Cloned + preset + designed profiles. |
| `justvoice.list_personas` | `limit=20`, `offset=0` | Character roster with voice + lexicon mapping. |
| `justvoice.list_captures` | `limit=20`, `offset=0` | Most-recent first with transcripts. |
| `justvoice.render_block` | `block_id`, `voice_profile?`, `engine?` | Render a specific block in a project (returns generation_id). Used by Unreal editor + scripted tooling. |

### Unreal integration (Phase 6)
- `GET /v1/unreal/voicelines/{project_id}` — list voicelines with metadata (NPC, scene, line_id) suitable for direct Unreal asset import
- `GET /v1/unreal/voicelines/{project_id}.zip` — bulk download (WAV per line + JSON sidecar)

---

## 6. Tab inventory (13 tabs)

Each tab × feature checklist. Phase 4b builds these in this order, with the side nav unlocking tabs as backend support lands.

| Tab | Icon | Surface | Voicebox source | Lifts cataloged in |
|---|---|---|---|---|
| 1. Generate | 📝 (Volume2) | Main TTS playground. Text input + voice/engine picker + paralinguistic slash-menu + history table | MainEditor + FloatingGenerateBox + HistoryTable | preview.md §1 |
| 2. Stories | 🎬 (AudioLines) | Multi-track timeline editor. Drag-arrange clips, trim, split, version-pin, volume | StoriesTab + StoryTrackEditor + StoryList | preview.md §3 |
| 3. Chapters | 📖 (BookOpen) | Manuscript view per project. Per-block character chip + voice override + per-block take selector + render queue | **JustVoice original** (ChapterView.vue exists; redesign) | preview.md §2 |
| 4. Voices | 🎙️ (Mic) | Voice profile library. Cloned + preset + designed; multi-sample + record-in-app + import/export | VoicesTab + VoiceInspector + ProfileForm + AudioSampleRecording/System/Upload | preview.md §4 |
| 5. Personas | 🎭 | Character bios with voice + lexicon override + personality LLM prompt | **JustVoice original** | preview.md §5 |
| 6. Lexicons | 📚 | Pronunciation dictionaries with IPA + ASCII, per-book and per-persona scope, live preview | **JustVoice original** | preview.md §6 |
| 7. Capture | 🎚️ (Captions) | Dictation pill + global hotkey + Whisper transcription + LLM refinement | CapturesTab + DictateWindow + CapturePill + DictationReadinessChecklist | preview.md §7 |
| 8. Effects | 🎛️ (Wand2) | Pedalboard chain editor with drag-reorder + presets + per-effect params | EffectsTab + EffectsChainEditor + EffectsList + EffectsDetail | preview.md §8 |
| 9. Engines | 🧠 (Box) | Model management: install/load/unload + CUDA wheel + per-engine venv | ModelsTab + ModelManagement | preview.md §9 |
| 10. Train | 🏋️ | Voice training jobs (PEFT/LoRA) with QC pipeline | **JustVoice original** | preview.md §10 |
| 11. Compare | ⚖️ | A/B WAV comparison with peak/RMS/RMSE/duration diff | **JustVoice original** | preview.md §11 |
| 12. Cache | 💾 | Render cache management: stats, age-based prune, by-voice prune | **JustVoice original** | preview.md §12 |
| 13. Settings | ⚙️ | Nested router with 8 sub-pages: General, Generation, Captures, MCP, GPU, Logs, Changelog, About | ServerTab + all sub-pages | preview.md §13 |

Plus the **fixed system surfaces** (not tabs):
- 80px left icon sidebar (Sidebar.tsx)
- Global AudioPlayer / StoryTrackEditor bottom dock (AppFrame.tsx)
- FloatingGenerateBox cross-route (Generation/FloatingGenerateBox.tsx)
- DictateWindow separate transparent webview (DictateWindow.tsx)
- System tray with right-click menu (JustVoice addition)
- TitleBarDragRegion (Tauri frameless drag)
- AudioKeepAlive (silent loop preventing WKWebView audio session teardown)

---

## 7. CUDA wheel download flow (single-installer story)

**Installer ships CPU-baseline torch** (~250 MB). GPU support is opt-in via in-app wheel download.

Boot sequence on first launch with NVIDIA GPU:

1. Tauri shell spawns Python sidecar
2. `_run_startup` detects backend (CPU since no CUDA torch installed)
3. `_run_startup` queues background task `check_and_update_cuda_binary`
4. Background task detects NVIDIA GPU is present (via `nvidia-smi` or `torch.cuda.is_available()` against system CUDA libs)
5. Toast in sidebar: "GPU detected — install CUDA support for 10× faster generation?"
6. User clicks → opens Settings → GPU
7. GPU page shows "Install CUDA 12.4 support" button + estimated wheel size
8. Click → background `pip install torch --index-url https://download.pytorch.org/whl/cu124`
9. Progress bar in GPU page + sidebar toast (idle → stopping server → downloading → installing → restarting → ready)
10. After install, sidebar issues Tauri `restart_server` IPC; new Python process loads CUDA-enabled torch
11. GPU page now shows live GpuInfoCard with VRAM used

Same flow handles auto-update when torch + CUDA wheels go stale (e.g., CUDA 12.4 → 12.8 with a new GPU generation).

Lifts from voicebox: `backend/services/cuda.py` + `app/src/components/ServerSettings/GpuAcceleration.tsx` + `app/src/components/ServerSettings/ModelProgress.tsx`.

---

## 8. First-launch warmup behavior

### What the user sees (cosmetic theater — lifted from voicebox)

A centered logo + 20-message rotating list, cycling every 3 seconds during server boot. Messages tailored to JustVoice:

```
Warming up tensors...
Initializing voice engines...
Loading personas...
Sharpening lexicon dictionaries...
Calibrating ACX mastering pipeline...
Preparing chapter render queue...
Indexing voice profiles...
Building generation cache...
Tuning audio device routing...
Connecting to model cache...
Verifying CUDA support...
Scanning installed engines...
Optimizing sample crossfades...
Loading character library...
Aligning phoneme dictionaries...
Preparing audiobook export pipeline...
Spinning up dictation listener...
Preparing MCP server endpoints...
Polishing voice embedding space...
Ready when you are...
```

ShinyText component for the message (subtle accent-color shine animation). Logo with backdrop blur. Same `animate-fade-in-scale` + `animate-fade-in-delayed` keyframes voicebox uses.

### What actually happens (~1-3 seconds typical)

1. **Tauri shell** spawns the Python sidecar with `--parent-pid <X>` + auto-port + `--data-dir <path>`
2. **Renderer** polls `/health` until ready (or receives `onServerReady` callback via Rust IPC)
3. **Sidecar `_run_startup`**:
   - Log version + Python + platform
   - SQLite migrations (idempotent, <50ms)
   - Init render task queue
   - Mark stale "generating" rows as failed (orphan cleanup)
   - Engine plugin discovery (`engines/<id>/manifest.py` scan)
   - Log profile + generation counts
   - GPU detection + CUDA compatibility check
   - Background task: `check_and_update_cuda_binary` (CUDA wheel auto-update)
   - HF cache directory ensure
   - Init progress manager
   - Log "Ready"
4. **Renderer** transitions from loading screen to `RouterProvider`

No engine model preloading. No voice embedding pre-computation. Models load lazily when first needed. This keeps first-launch fast even with 10 engines installed.

### Recovery on launch (re-attach to in-flight work)

After server boot, the renderer mounts `useRestoreActiveTasks` (30s poll) which calls `GET /v1/active_tasks` to recover:

- **Pending generations** — repopulates `generationStore.pendingGenerationIds` and re-subscribes to per-generation SSE streams. If a chapter render was in progress when the user closed the window with `keep_server_running=true`, opening the window again resumes the progress UI without missing a beat.
- **Active downloads** — for any model that was downloading (CUDA wheel, Whisper, LLM, TTS engine weights), re-attaches the toast UI to the existing SSE stream at `/v1/models/progress/{model_name}`.

This means closing-and-reopening the window mid-render is non-destructive even without `keep_server_running` if the server happens to outlast (e.g. user closed window but didn't quit the app via tray menu).

---

## 9. Release scope (v1.0)

**In v1.0**:
- All 13 tabs functional
- All 10 engines installable + loadable
- JustWrite import endpoint (Phase 5 spike confirms shape first)
- Books → Chapters → Scenes → Blocks data model (audiobook use case end-to-end)
- ACX mastering preset with QC validator
- Take versioning at paragraph granularity
- Lexicons with per-book + per-persona scopes
- Personas with LLM personality rewrite
- Render queue with resume + SSE progress
- MCP server (gated by settings toggle, default off)
- Dictation (full voicebox parity)
- System tray + close-to-tray + keep-server-running
- DictateWindow agent-speak cycle
- AudioKeepAlive
- CUDA wheel download flow
- Windows installer signed (EV cert)
- Mac/Linux installers unsigned (Gatekeeper warning)
- Updater pointing at delebash GitHub releases

**Out of scope for v1 entirely (📋📋 — not v1.1, requires product-shape change):**
- Multi-user accounts (would need `user_id` column on every storage table; revisit only if a v2 hosted/SaaS product becomes a goal)

**Deferred to v1.1+ (📋)**:
- Apple notarization
- Linux AppImage signing
- Audio channels MultiSelect on Voices (backend ships, UI gated)
- Per-character external provider override
- Unreal `.uplugin` (separate repo)
- Cross-character consistency tools (voice-embedding drift detection)
- Audiobook publishing assistant (cover art, ACX submission validator, retail sample)
- Per-engine GPU memory budget settings
- Voice profile multi-engine alternates (fallback)
- Plugin/extension system for community engines
- **Full-text search** — revisit when generation count >2000 + first user complaint. SQLite FTS5 virtual table.
- **Activity log** — revisit on first webhook-replay incident (integrator's receiver was down). Append-only sqlite table.
- **`POST /v1/projects/import` for non-JustWrite sources** — JustWrite import ships v1.0; generic re-import of an exported project bundle defers.

**Skip entirely (never ships):**
- **Multi-user accounts** — would require v2 product pivot to SaaS; documented in README to head off scope creep.
- **Voice analytics** (generation_count over time, last_used, etc.) — vanity metrics, computable client-side from `/v1/generations` if anyone ever wants them.

---

## 10. Open questions for the user

The proposed answers in §3 above need your confirm/override. The ones that genuinely need YOUR input:

1. **§3.4 Code signing**: Windows-only EV cert ($200-400/yr) for v1.0, Mac + Linux at v1.1? — affects launch timeline by ~4-6 weeks if you want all-platforms-day-1
2. **§3.5 Audio channels UI** in v1 (gated toggle) vs v1.1: which?
3. **§3.8 External provider per-character** in v1 vs v1.1
4. ~~**§3.10 Pedalboard adoption timing**~~ — ✅ ANSWERED 2026-06-08: Phase 3 with atomic license-flip commit.
5. ~~**§5 API**: any endpoints I'm missing for use cases you care about?~~ — ✅ ANSWERED 2026-06-08 by gap-decision workflow. Added 14 new endpoints (webhooks ×4, bulk-delete ×1, backup/restore ×2, presets ×4, voice preview ×2, project export ×1) + 2 new SQLite tables (webhooks, render_presets) + 3 new indexes + 2 column adds on generations.
6. **§6 Tab order**: does the current ordering match how you'd want users to discover features? (Generate / Stories / Chapters first because they're most-used; Train / Compare / Cache at the bottom because they're admin-shaped)
7. **§8 Loading messages**: are the 20 message variants in the right tone (playful pro-tool) or too playful for your audience?
8. **§9 Release scope**: anything in "deferred to v1.1" that should actually be in v1.0?

---

## 11. Honest coverage statement

This document is built on ~90% coverage of voicebox's codebase. Specifically:

**Cataloged with confidence (234 features in `preview/voicebox-feature-comparison.md`):**
- All 7 top-level tabs + 8 settings sub-pages
- All major frontend components
- 8 Zustand stores
- 21 Tauri invoke_handler commands
- Tauri close/exit lifecycle
- Backend `app.py` startup/shutdown
- DictateWindow build/show/park logic
- Most settings page UIs

**Not yet read (~10% of voicebox, mostly plumbing):**
- ~1300 LOC of Rust modules (speak_monitor, hotkey_monitor, audio_capture/*, accessibility, focus_capture, input_monitoring, keyboard_layout, synthetic_keys, clipboard, audio_output)
- 18 React hooks (useStoryPlayback, useGeneration, useChordSync, useSystemAudioCapture, useTranscription, useCaptureRecordingSession, useRestoreActiveTasks, useModelDownloadToast, useAudioPlayer, useAudioRecording, useGenerationProgress, useStories, useMCPBindings, useSettings, useDictationReadiness, useServer, useProfiles, useHistory)
- MCP server backend internals (mcp_server/*.py)
- ~10 backend route files (most mirror frontend hooks I cataloged)
- 4 backend services: personality.py, refinement.py, versions.py, task_queue.py
- Remaining sections of AboutPage, ChangelogPage, GpuPage
- i18n locale strings (every user-visible string)

**Risk**: low for missing top-level features. Medium for missing edge-case UX (bulk operations buried in hooks, specific keyboard shortcuts). The frontend tab inventory + settings inventory are solid.

**Mitigation**: a targeted second pass over the ~30 unread files would close the gap in ~45 min focused. If you want this done before code resumes, say so; otherwise the gaps will surface during implementation and we patch them then.

### Coverage update — gap-4 targeted deep dive completed (2026-06-08 late)

Closed the remaining gaps in hooks + MCP backend + select Rust modules. Specific additions to this freeze from gap-4:

- **`mcp_bindings.default_personality` and `default_engine`** columns — per-client defaults for the speak tool, not just profile mapping. Critical for the "Unreal NPCs always use Chatterbox + persona" config.
- **`/v1/active_tasks` endpoint** — page-refresh recovery for in-flight generations + downloads (polled 30s by `useRestoreActiveTasks`)
- **`/v1/capture/readiness` endpoint** — Whisper + LLM model readiness (polled 5s by `useDictationReadiness` while either is missing)
- **`/v1/generate/{id}/status` SSE** — per-generation status stream (subscribed by `useGenerationProgress` for autoplay-on-complete)
- **`/v1/models/progress/{model_name}` SSE** — per-model download progress (subscribed by `useModelDownloadToast`)
- **6 MCP tools** (not 4) — added `justvoice.list_personas` and `justvoice.render_block` for Unreal editor scripting
- **Security gate**: `audio_path` arg on `transcribe` is loopback-only via `request_is_loopback()` — prevents `0.0.0.0`-bound server from becoming arbitrary-file-read
- **Sibling webview broadcast pattern**: `tauriEmit('capture:created', ...)` from DictateWindow → main window picks up the new capture row. Same pattern works for any feature where a separate Tauri webview needs to update main-window state.
- **AGENT_SOURCES skip**: when a generation's `source` field is `'mcp'` or `'rest'`, the main-window AudioPlayer skips autoplay (DictateWindow handles playback). Prevents double-playback when an MCP agent calls `speak`.
- **Recording duration gate**: 0.5s minimum before MediaRecorder emits a usable webm blob; under this, surface "Recording too short, canceled" instead of bubbling a backend 400.

Cumulative coverage now: ~95% of voicebox's user-facing surface. Remaining gaps are in the unread ~10 Rust modules (paste injection, hotkey internals, accessibility check internals) and a few backend services (refinement.py, personality.py implementation details). These are PURE implementation, no new user-facing features expected.

**Deep dive is closed. Code resumes on user's answer to §10 questions.**

Once these are answered, the freeze is locked and code resumes against the spec.
