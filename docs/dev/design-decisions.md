# Design decisions — the distilled record (JustVoice)

Refreshed 2026-11-05 against the code.

Distilled 2026-08-04 by the docs campaign from `DESIGN_FREEZE.md` (2026-06-08),
`CONTRACT.md` (2026-06-09), the 2026-06-24 full-convergence plan, and the Morning
Recap — all now in `../plans/archive/`. Where code reversed a frozen decision, THIS
doc states today's truth and §5 records the reversal. Open product questions from
the freeze live in `TASKS.md`; the deferred list in `IDEAS.md`. The F1/F2
integration decisions record (2026-07-15) is executed history at
`../plans/archive/2026-07-15-jv-shared-llm-integration-decisions.md` — F1 shipped
~90% of it as decided; its still-live residue was extracted to `TASKS.md`
2026-08-06.

## 1 · Product shape

- **A voice production studio with five first-class use cases** — audiobook (chapters
  + cast + lexicons + ACX + M4B), game voicing (Unreal NPC lines at 50–500 scale,
  per-line WAV + JSON sidecar), podcast (multi-track timeline, paralinguistic tags),
  dictation (hotkey + local speech recognition + LLM refine + paste injection), accessibility/TTS.
  **No use case is privileged**; all five share the engine pool, voice profiles,
  personas, lexicons, effects, and the HTTP API. Differentiation lives at the UI tab
  level + per-use-case export pipelines.
- **The project model is type-discriminated, not book-specific**: `projects.project_type
  ∈ audiobook|game_voicelines|podcast|custom` (`server/src/api/projects_api.js:74`);
  scene = chapter/dialogue-tree/segment; block = paragraph/NPC-line/take. One data model
  serves all use cases. **Why no forks** (distilled 2026-08-06 from the archived
  data-model decision): a subtype fork and a metadata-blob hybrid were both weighed and
  rejected — the audiobook schema already generalizes, and every per-use-case difference
  is expressible as `project_type` + `useCopy()` terminology (`src/services/copy.js:73`)
  + view gating + empty states, so a second schema would only buy drift. Do not
  re-litigate.
- The per-use-case flow shapes live in `CONCEPTS.md` §6, the user docs
  (`projects.md` · `studio.md` · `lines.md`), and the podcast Timeline spec kept
  live at `journey-podcast.md` (this folder). The audiobook/game journeys are
  banner'd history in `../plans/archive/` (2026-08-06 sweep); the earlier "only
  place the flow shapes are written down" claim here was false.

## 2 · Locked stack + behavior decisions (current truth)

- **Stack:** Electron desktop shell (the kit's `runDesktopApp`; `src-electron/electron-main.js`
  names the app, its window on `app://justvoice` — `server/src/app.js:119`) · Quasar (Vite) +
  Vue 3 + Pinia renderer (NOT React) · a Node server on Hono, its own package
  `justvoice-server` (`server/package.json`, `server/src/app.js`) · SQLite through the kit's
  `platform/sql.js` (better-sqlite3), one file `justvoice.db` (`server/src/database/session.js:26`)
  · audio as files under the data folder (`generations/`, `voices/`, `captures/`… —
  `server/src/paths.js:41-54`), paths in rows · audio math in our audio.cpp fork's
  `audiocpp_dsp` (`server/src/audio/dsp_client.js`). No Python, no TypeScript in the app (the
  user's rulings, 2026-10-08). Replaced: the Tauri 2 shell and the Python FastAPI +
  SQLAlchemy server, deleted 2026-10-08 (`a605a7cb`).
- **Cross-app rules** (distilled 2026-08-06 from the archived 2026-06-18 decision; its
  language rule is dead): the shared stack is the kit — `@delebash/core` (Node,
  `../just-core/packages/core`) + `@delebash/ui`; the 06-18 "shared runner is Python, no
  third language" died with the move to JavaScript. Still true: **the runner is the single
  hardware authority** — detection AND cross-subsystem VRAM budgeting (speech + LLM) go
  through the kit (`runner/hardware.js`, the arbiter, `runner/speech_placement.js`), never
  a second probe (`server/src/system_info.js:6-19` complies); **a backend is justified by
  consumers, not symmetry**. The runner is in the token path: the kit owns `/v1/ai/run` +
  `/v1/ai/stream` (just-core `llm/prompts.js:848,887`), and local llama.cpp tokens flow
  through its `llm/openai_compat.js` adapter.
- **License: MIT** (`LICENSE`; was Apache-2.0; the GPL flirtation died when pedalboard was
  replaced by first-party DSP 2026-07-29 — see `NOTICE.md`). That DSP has lived in our
  audio.cpp fork's `dsp/` module (`audiocpp_dsp`) since 2026-10-07. Lifts carry per-file headers.
- **Migrations: none for the schema — the user resets.** `initDb` creates any table the
  file lacks and leaves existing ones alone; no column upgrades (the pre-release
  no-migrations rule, `server/src/database/session.js:7-11`). The family standard is the
  kit's `migrate()` on `PRAGMA user_version` (just-core `platform/migrate.js`, app-structure
  §16); JustVoice does not call it — its drop-and-reseed is a recorded open deviation
  (app-structure.md:1141, 1297). Seeds are insert-if-missing. Still carrying old data
  forward: `SettingsStore`'s one-time `settings.json` import and LLM-key camelCase rename
  (`server/src/storage/settings_store.js:5-9, 28-67`), and, in `seedWorkspace()`
  (`server/src/database/seed.js:138-172`), JV's legacy prompt rows and settings-held
  providers into the shared tables (`engines/llm/migrate_prompts.js`,
  `migrate_providers.js`) and the speech runtime's settings and transcription model
  retired into the kit. Settings live in a SQLite `settings` row (why: below); renderer
  prefs go through `/v1/prefs` (the kit's prefs router over JV's `prefs` table,
  `server/src/api/prefs_api.js`).
- **Engines: every speech model runs in ONE runtime — the kit's `audiocpp` runtime on our
  audio.cpp fork** (the switch 2026-10-01; the kit's since round E, 2026-10-29). The list is
  generated, not hand-kept: every speech family in audio.cpp's catalog
  (`server/src/engines/audiocpp/seed_audiocpp_catalog.json`) with a supported, community or
  experimental model and a complete GGUF package becomes an engine
  (`engines/audiocpp/generated.js:961`, discovered by `engines/model_catalog.js:129-133`) —
  81 on 2026-11-05 (51 speech, 30 recognition), seven described by our own files
  (`OWN_ENGINES`: asr, chatterbox, kitten, kokoro, pocket, qwen3, voxcpm2 — generated.js:881).
  Their files are the kit's `runtime_model` rows, pinned by repo, revision, path, SHA-256 and
  size (`engines/audiocpp/kit_models.js:1-12`). Transcription is the kit's **Transcription**
  feature on its stt preset (`feature_catalog.js:15`, `seed_presets.js` `p_transcription`).
  Plus external providers: OpenAI-compatible (`engines/external_openai.js`) and
  ElevenLabs/Speechify/Speechmatics (`engines/tts_providers/`). The per-engine Python venvs
  and their engines (LuxTTS, TADA, MOSS-TTSD, Whisper) went with the switch
  (`docs/plans/2026-10-01-audiocpp-switch.md`); dia was dropped 2026-08-17. The generated
  list (2026-10-11, `df2b40ee`) reversed two drops: MOSS-TTSD is back as an Apache-2.0
  audio.cpp family, and Higgs (removed 2026-06-09, non-commercial weights) is offered behind
  the licence gate.
- **Licence gate (decided 2026-10-11):** an engine whose commercial use isn't a plain "Yes"
  asks the user to accept its licence once before its first download; until then the kit
  answers 403 terms-required (`engines/audiocpp/kit_hooks.js:70-76`,
  `engines/model_catalog.js:176-180`).
- **Headless launcher naming guard (durable):** the app's exe is `justvoice.exe`; the
  headless launcher is `justvoice-server` (`build/launcher/justvoice-server.cmd` runs the exe
  as Node on `server/src/serve.js`) — never the exe's name, or Windows resolves the bare name
  to the GUI exe (the `CreateProcessW` spawn-loop; under Tauri it spawned infinite windows).
  Must survive any rename. Headless: `justvoice-server serve` (or `npm run server`) serves the
  UI at `/` (`/ui` redirects — `server/src/app.js:469-474`); port **17494**
  (`server/src/version.js:17`); optional bearer token (`server/src/auth.js`, the kit's
  `bearerAuth`).
- **Wire contract:** the TypeBox models in `server/src/models.js` are the source of truth for
  the wire shapes (snake_case, every field its Python name — `models.js:1-4`); additions are
  non-breaking, removals/shape changes are major bumps (the policy — nothing enforces it). The
  server publishes no OpenAPI document (`server/src/app.js:219-220`); the freeze-era CI
  OpenAPI snapshot never existed.
- **Voice tuning precedence** — `server/src/delivery_merge.js:92` `mergeDelivery`: the
  persona's delivery, then `request.delivery` on top (render presets sat above both until
  they were removed, 2026-10-03). Dict-deep merge incl. `delivery.engine.*`; flat engine keys
  are nested first (`nestEngineKeys`, :57). One plan runs it for every path —
  `persona_render.planLine` (`server/src/persona_render.js:320`): `/v1/generate`
  (`api/generate_api.js:249,362`), chapter render (`line_takes.planBlock`,
  `api/render_chapter_api.js:135`), persona previews (`api/personas_api.js:428,503`).
- **Channel bindings are PERSONA-level** — `/v1/personas/:persona_id/channels`
  (`server/src/api/channels_api.js:97,103`); the freeze's profile-level design shipped
  differently. Its Settings section is hidden until routing a persona to an output is built
  (decided 2026-10-15; `src/services/settingsSections.js`).
- GPU: the kit's runtime installs the pinned fork build that suits the machine (Auto · CUDA ·
  Vulkan · CPU · Metal — just-core `runner/runtimes.js:97`), switchable on AI Settings →
  Speech (the kit's runtime tab); no PyTorch ships or installs. Each model runs on the
  graphics card or the CPU, Auto/GPU/CPU per model (`runner/speech_placement.js`). No speech
  model loads at boot — on its first line or the user's Load (`server/src/app.js:150-151`).
  `npm run dev` runs our `../audio.cpp` checkout's build instead (AGENTS.md;
  `engines/audiocpp/dev_build.js`). The freeze's "first launch <1–3 s" is unverified; its 20
  rotating load messages are not in the code (they appear only in `DESIGN_FREEZE.md:775`).
- Render queue is resumable: `render_jobs` rows survive a restart; a job a dead server left
  queued or running is marked paused at boot and Resume re-runs its unfinished blocks
  (`server/src/render_jobs.js:299-304`, `app.js:195-202`; `POST /v1/render_jobs/:job_id/resume`);
  one-click book runs the same (`book_run.js:617`; `POST /v1/book_runs/:run_id/resume`). Take
  versioning: per-line (block) takes with `is_default`, lineage via `source_take_id` (the
  `takes` table, `database/models_schema.js:762`). Voice previews: in-memory LRU cap 20 /
  10-min TTL, discarded unless promoted — no library pollution
  (`api/voice_preview_api.js:5,124`).
- Webhooks: the four events fire from one place each (a take saved, a render job's end, a voice
  made — `fireEvent`, since 2026-11-05), each signed with the secret kept on its row; at-least-once, backoff 1s/5s/30s/5m (4 retries, 5 attempts),
  `X-JustVoice-Signature: hex(hmac_sha256(secret, body))` (`api/webhooks_api.js:5-6,201`).
  Bulk-delete (`DELETE /v1/generations`): `confirm=false` is a dry-run, ≥1 filter required
  (`api/bulk_delete_api.js:77-91,144`). Unverified: generations sourced `mcp`/`rest` skip
  main-window autoplay (MCP generations carry `source: "mcp"`, `mcp/tools.js:99`, but no
  autoplay of new generations was found in `src/`); recordings need ≥0.5 s (no such check
  found). MCP (corrected 2026-08-04 — the freeze's "6 tools, off by default" was wrong):
  **4 tools** (`justvoice.speak/list_voices/transcribe/list_personas` —
  `server/src/mcp/tools.js:184,200,211,225`), mounted **unconditionally** at `/mcp` on the
  app port (Streamable HTTP, the official MCP SDK, built in since 2026-10-08 —
  `mcp/server.js`, `app.js:419-426`), behind the same bearer token and Origin check as `/v1`
  (`app.js:123` `GUARDED_PREFIXES`); `MCPSettings` holds one field, `default_voice`
  (`models.js:465-467`); `transcribe`'s `audio_path` is loopback-only (`tools.js:153`).
- **Backup vs export:** backup = whole-server disaster recovery (the kit's `/v1/data/backup`,
  wired in `server/src/data_admin.js`); export = per-project handoff
  (`GET /v1/projects/:project_id/export`, `api/project_export_api.js:49`).

### The why the code holds

- **Backup format and size.** A backup is a ZIP of `db.sqlite` — a `VACUUM INTO` copy, WAL-safe,
  the live file never locked — plus the content folders (voices, personas, lexicons, projects,
  generations, captures — `server/src/data_admin.js:115`); model caches stay out (they
  re-download), and `?exclude=generations,captures` drops the audio (data_admin.js:8-9). There
  is no format version: a restore is a column-aware table copy — only the columns both sides
  have — so an older or newer backup still loads (just-core `platform/data_api.js:11-16, 828`).
  Size: the archive is written to a work folder beside the database, on the data's own drive,
  and streamed from it, never held in memory (data_api.js:83-88, 747-748); ZIP64 past 2 GiB
  (`platform/zip.js:17,49`); a restore streams its upload to disk and refuses (413) one that
  won't fit the drive with 256 MB to spare (data_api.js:138, 159-165, 921). A restore keeps
  this computer's engine builds and machine settings (`keepTables`/`keepRows`,
  data_api.js:73-81) — a backup's download URLs would otherwise run a malicious backup's code.
  This replaced the Python `/v1/backup` (`BACKUP_SCHEMA_VERSION = "1"`, built in memory —
  "for very large backups (>4GB) a streaming … impl would be needed"), deleted 2026-08-06 with
  no old-zip compatibility (`f47776fa`).
- **Settings in a SQLite row, not `settings.json`.** Phase 1.5 folded the atomic
  `settings.json` into the singleton row of the `settings` table so SQLite is the one backend
  (`server/src/storage/settings_store.js:5-7`): one store the server owns, and the backup's
  database copy carries the settings with everything else. The typed `Settings` model and
  `GET/PUT/PATCH /v1/settings` stayed; only persistence moved (the Python header,
  `a605a7cb^:server/justvoice/storage/settings_store.py:4-9`). An old `settings.json` is
  imported once and removed, so older installs and pre-fold backups keep their config; a
  corrupt row falls back to defaults with a warning (settings_store.js:6-9).
- **No hardcoded values a user might want to change** (family rule 1, just-core
  `docs/family-rules.md:8`). JustVoice carries it with: the typed `Settings`, every field with
  its default, edited through `PATCH /v1/settings` (`server/src/models.js`); insert-if-missing
  seeds that never overwrite an edit — the AI presets, which own every tunable
  (`seed_presets.js`), the action prompts (`seed_feature_prompts.js`), the built-in effect
  presets (`database/seed.js:5-8`); the speech runtime's settings, now the kit's runner settings
  `<name>:audiocpp` (seed.js:26-33); and per-engine user layers in
  `settings.engines.engine_overrides[engine]` — default model, piece length per model, load
  options, terms accepted (`models.js:398-413`; `PUT /v1/engines/:id/models/:variant_id/runtime-options`).
  The Python-era per-variant download-source override (`/v1/engines/{id}/sources`: point a
  variant at a mirror or fork) is gone: it left with round E (2026-10-29, `5b6f56a4`), when
  model files became pinned `runtime_model` rows. Nothing replaced it — no kit route edits a
  model's source (just-core `llm/runtimes_api.js:90-214`).
- **Past corrections are worked examples in the attribution prompt.** Changing a line's
  speaker in Studio (a block PATCH, `api/projects_api.js:1091-1095`) or the AI Lab's reassign
  (`POST /v1/projects/:project_id/corrections`, `api/extraction_api.js:2094-2101`) goes through
  one writer, `recordCorrection`: `{text_snippet ≤400 chars, speaker_id}` per book, the newest
  200 kept (extraction_api.js:1167-1179). Analyze and the Lab feed the 12 newest into the
  prompt (`_resolveCorrections`, extraction_api.js:187-193, called at :550 and :1864) as a
  "Past corrections from the writer" block (`extraction/prompts.js:112-123`), speaker ids
  remapped to the prompt's handles (`extraction/pipeline.js:685-688`). Why, in the code's
  words: a feedback loop (extraction_api.js:188) — the corrections are "ground truth — apply
  the same reasoning to similar lines" (prompts.js:42-43).
- **Product rules the user ruled, kept here when their tracker items closed (2026-11-05):**
  - **Voice tuning stays on the voice, and the Voice Designer stays** (2026-08-15, the voice-workflow
    redesign §8 — `../plans/2026-08-15-voice-workflow-redesign.md`).
  - **A run is scoped with an inline grid, never a modal; every line can always be seen, by chapter,
    in order** — filters are lenses, never the view (the same redesign).
  - **An emotion reaches a model only as its own tag — never a near neighbour** (sad is not
    `[crying]`), and the written direction is composed persona → emotion → line
    (`delivery_merge.js` `composeInstruct`; decided 2026-08-17 when `style_prompt` was deleted).
  - **The self-hosted provider list keeps Dia-TTS-Server** (`src/components/TtsProviderForm.vue`) although
    the Dia engine was dropped (2026-08-17): it points at someone else's OpenAI-compatible server and
    costs nothing.
  - **The kit's corner task stack stays out of JustVoice:** a page shows only its own AI tasks; the ✨
    button and the AI Tasks page show them all (2026-10-18; `src/layouts/MainLayout.vue`).

## 3 · The JV↔JW boundary (from CONTRACT, endpoint table corrected)

- **JustWrite is writing-only** — no audio code of any kind, ever again (the last,
  `services/m4b.js`, is gone and must not come back). JustVoice owns everything
  downstream of the manuscript.
- **The handoff is a FILE export, not live HTTP**: JW exports a book `<Title>.zip`
  (`book.json` + `images/`; its Export page's .zip card and Settings → Backups —
  `GET /v1/projects/:project_id/export`, justwrite-app `server/src/api/book_transfer_api.js:96`);
  the user imports it in JustVoice (`POST /v1/projects/import`, `api/projects_api.js:1284`, the
  `justwrite` adapter). Neither app calls or spawns the other at runtime — JW's code names
  JustVoice only in comments (grep, 2026-11-05) — so there is no JV version for JW to pin.
- **Data ownership: JW owns the manuscript and the character roster; JV owns speaker
  attribution and casting**, and everything voiced — VoiceProfile/samples, Persona, Lexicon,
  Generation, Take, RenderJob, M4B, mastered WAVs. The Book entity lives in JW. JW's export
  carries no attribution JV could use: `book.json` (justwrite-app `server/src/book_io.js:606`
  `assemble`) holds the prose as scene HTML, the roster (`characters[]`: name, gender, age,
  pronouns, role, oneLiner, aliases) and per-scene POV and character links — no line names
  its speaker. JV's adapter reads only the roster and the prose
  (`server/src/imports/adapters/justwrite.js:195-206, 233-235`) and imports every line with
  `character_id: null` (:239); Studio's Analyze (JV's extraction pipeline) attributes them.
  (The old "speaker attribution = JW" line was the archived CONTRACT's row, found false below.)
- Why the split: multi-use requires JV standalone; a JW-only caller would couple
  TTS to novel-writing and block the other four use cases.
- **The archived CONTRACT's endpoint table is stale** — no `/v1/profiles*` family
  ever shipped (voices are `/v1/voices*`), `render_chapter_async`/`render_story`/
  `lexicons/apply` don't exist, and `/v1/jobs/:id` is the kit's job router over the book's
  export jobs (`server/src/app.js:388-390`). Trust `server/src/api/*` route literals, not the
  old table.
- **Two of the archived CONTRACT's data-ownership rows are false** (verified
  2026-08-08). Its Speaker-attribution row (`CONTRACT.md:91`) claims attribution
  is "computed in JustWrite's `services/speakerAttribution.js`" and passed inside
  the `/render_chapter` payload — no such JW file exists (grep-verified), and
  attribution actually runs server-side in JustVoice's extraction pipeline,
  driven from Studio's Analyze (`POST /v1/scenes/:scene_id/analyze`,
  `api/extraction_api.js:1569`). Its Persona row (`CONTRACT.md:94`) claims a
  per-persona render-time LLM rewrite behind a `personality` flag — the persona's
  delivery text actually feeds `delivery.instruct` at render
  (`server/src/api/render_chapter_api.js:9-10`; the field is `voice_instruct` since the
  2026-08-15 split), and compose/rewrite are explicit user actions
  (`POST /v1/personas/:id/compose`, `/rewrite` in `api/personas_api.js`), never a
  render-time pass.
- **The archived CONTRACT's enforcement mechanism was never built, and guards a
  boundary that doesn't exist** (struck 2026-08-08, user's word): it cites
  `server/justvoice/openapi.json` + `server/tests/test_contract.py` as the
  JW→JV HTTP contract's enforcement — neither file was ever written, and the
  handoff above is a FILE export with no runtime HTTP, so there is nothing for
  an HTTP-contract suite to enforce. (If the book-zip import format ever wants
  enforcement, that is a new decision, not this one — open as TASKS "The JW→JV
  book-format contract has no lock on the JustWrite side".)

## 4 · Convergence outcomes (2026-06-24 arc, closed)

- **Layer A complete: both apps share ONE renderer kit** (`@delebash/ui` +
  its `common/`): one serverApi transport (JW's SSE `aiFeature.js` was the one kept
  exception — deleted 2026-07-06, JW `cda8b331`), one appearance engine (JV's palette
  reproduced hue-driven in `tokens.css`), one AppModal + AppDialog, all primitives/shells
  shared — `components/ui/` no longer exists in either app. Kit shells read semantic
  `--font-display`/`--font-body`; each app maps them.
- **Layer B decision (user, 2026-06-24): NO shared `server_core` package** —
  servers stay separate, basics uniform BY CONVENTION (headless `/ui` mount,
  optional bearer auth, RFC-7807 errors, settings-driven CORS). The ~60 truly-shared
  lines weren't worth a boot-critical cross-repo package; the one substantial shared
  server piece was `llm_runner`. **Reversed:** sameness by construction (decided
  2026-10-17, app-structure §14–§15) — the server basics are the kit's `@delebash/core/platform`
  (`createServer`, problem+json, CSRF, CORS, bearer auth, `serveUi`, the data/logs/disk/jobs
  routers — `server/src/app.js:19-36`); the UI is served at `/`.
- **The operating principle (user, 2026-06-23):** converge by default — ONE shared
  component per job; an app not needing a feature is NOT a reason to fork or defer a
  simpler variant. Applies to any reusable code, not just primitives.
- **App shell is keep-alike per app, NOT shared** — the convention lives in the
  family standard (today each app's `src/layouts/MainLayout.vue`, app-structure §11, built
  from kit pieces); the ruling fixed two real JV bugs (missing `grid-template-rows`
  nav-jump; `100vh`-ignores-zoom dead space — `src/css/app.scss:35-36` keeps the
  `height:100%` chain) and both apps carried a shell smoke guard.
- Root cause of JV's original divergence, worth remembering: its markup was carried
  from an HTML preview mock (`.jv-*` utilities) instead of built component-first.
- Regression baselines when the arc closed: JV smoke 14/14 · JW headless smoke
  27/27 · pytest JV 286 / JW 82. Convergence branch: `claude/admiring-galileo-il3q0o`.
- The Layer C anti-divergence guard was built 2026-08-07 as the kit's
  `scripts/check-family.js` (forks of kit components, drifted copies, hand-rolled shapes,
  one Hono); whether it checks the hand-rolled fetch and a second `init_db` named here is
  unverified. The server-basics parity sweep (camelCase responses, health/settings shape):
  JV's wire is still snake_case (`models.js:4`); the sweep's status is unverified.

## 5 · Freeze rows the code has since reversed (anti-drift ledger)

| The freeze said | Today |
|---|---|
| Apache-2.0 (→ GPL when pedalboard) | MIT everywhere; first-party DSP, in our audio.cpp fork's `dsp/` since 2026-10-07 |
| 9 engines v1 | Generated from audio.cpp's catalog: 81 on 2026-11-05, 51 speech + 30 recognition (`engines/audiocpp/generated.js:961`), plus external providers |
| 13 tabs, flat | 13 pages in the layout + `/dictate` and `/offline` outside it (`src/router/routes.js`); Labs went 2026-10-08 (`41021123`; Train had gone to Voices, then was removed 2026-10-02); engines → AI Settings → Speech; Cache/Webhooks → **Settings** sections, Channels' section hidden |
| `settings.json` atomic store | SQLite `settings` row; `/v1/prefs` for renderer prefs |
| 3-way theme toggle in localStorage | the shared kit appearance engine, prefs in SQL |
| channels bind to profiles | channels bind to **personas** |
| `/v1/render_jobs*`, `/v1/generate_async`, per-gen stream/cancel | `/v1/render_chapter`, `/v1/render/cache-stats`, `/v1/generate/:generation_id/status` (SSE); `/v1/render_jobs` create · cancel · resume came back 2026-08-09 (`3a5a23d7`; `api/render_jobs_api.js:79-113`); no `generate_async` |
| `/v1/backup` · `/v1/restore` (versioned manifest, replace or merge) | the kit's `/v1/data/backup` · `restore` · `reset` (2026-08-06, `f47776fa`): no version stamp, replace only (§2 "Backup format and size") |
| `/v1/effects/available`·`/presets`, `/v1/cache` GET+DELETE, `/v1/training_jobs*`, `/v1/unreal/voicelines/*`, `/v1/health/filesystem` | `/v1/effects/catalog`·`/v1/effect-presets`, `/v1/cache/stats·clear·recent`, no training (`/v1/train*` removed 2026-10-02), `/v1/projects/:project_id/export_voicelines`, `/v1/system/info` |
| — (absent from the freeze) | `/v1/voices/design`, scene analyze/discover-speakers, `/v1/llm/smart-assign`, project qc/show-notes/narrator/corrections, `/v1/extraction/*`, `/v1/prefs`, `/v1/logs/tail` (`/v1/feature-pins` came and went — dropped with F1 Phase 2) |
