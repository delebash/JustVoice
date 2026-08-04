# Design decisions — the distilled record (JustVoice)

Distilled 2026-08-04 by the docs campaign from `DESIGN_FREEZE.md` (2026-06-08),
`CONTRACT.md` (2026-06-09), the 2026-06-24 full-convergence plan, and the Morning
Recap — all now in `../plans/archive/`. Where code reversed a frozen decision, THIS
doc states today's truth and §5 records the reversal. Open product questions from
the freeze live in `TASKS.md`; the deferred list in `IDEAS.md`. The F1/F2
integration decisions record stays live at
`../decisions/2026-07-15-jv-shared-llm-integration-decisions.md`.

## 1 · Product shape

- **A voice production studio with five first-class use cases** — audiobook (chapters
  + cast + lexicons + ACX + M4B), game voicing (Unreal NPC lines at 50–500 scale,
  per-line WAV + JSON sidecar), podcast (multi-track timeline, paralinguistic tags),
  dictation (hotkey + Whisper + LLM refine + paste injection), accessibility/TTS.
  **No use case is privileged**; all five share the engine pool, voice profiles,
  personas, lexicons, effects, and the HTTP API. Differentiation lives at the UI tab
  level + per-use-case export pipelines.
- **The project model is type-discriminated, not book-specific**: `projects.project_type
  ∈ audiobook|game_voicelines|podcast|custom`; scene = chapter/dialogue-tree/segment;
  block = paragraph/NPC-line/take. One data model serves all use cases.
- The per-use-case UX narratives live in `../journeys/` (audiobook · game · podcast)
  — the only place the kind-picker/import/Studio flow shapes are written down; kept live.

## 2 · Locked stack + behavior decisions (current truth)

- Tauri 2 shell · Vue 3 + Pinia + Vite renderer (NOT React) · Python FastAPI +
  SQLite/SQLAlchemy server · audio blobs as files under `data/audio/`, paths in rows.
- **License: MIT** (was Apache-2.0; the GPL flirtation died when pedalboard was
  replaced by first-party DSP 2026-07-29 — see `NOTICE.md`). Lifts carry per-file headers.
- **Migrations: hand-rolled idempotent column-existence checks — no Alembic.**
  Settings live in a SQLite `settings` row (the freeze-era `settings.json` is legacy;
  renderer prefs go through `/v1/prefs`).
- **Engines: 7** (kokoro, luxtts, qwen3, chatterbox [3 variants], tada, dia,
  moss_tts — `engines/catalog.py`) + external OpenAI-compatible; Higgs removed
  2026-06-09 (non-commercial weights). **Per-engine venvs** — one engine's install
  can never break another's deps.
- **Sidecar naming guard (durable):** console scripts are `justvoice` /
  `justvoice-server` — the split avoids the Windows `CreateProcessW` spawn-loop and
  must survive any rename. Headless: `justvoice-server serve` serves the UI at
  `/ui/`; port **17494**; optional bearer token.
- **Wire contract:** Pydantic models in `server/justvoice/models.py` are the
  cross-language source of truth; additions are non-breaking, removals/shape changes
  are major bumps. (The freeze-era CI OpenAPI-snapshot claim is UNVERIFIED — no
  `openapi.json` / `test_contract.py` found; tracked.)
- **Three-tier voice tuning precedence** — code-verbatim from
  `server/justvoice/delivery_merge.py` (corrected 2026-08-04; the archived
  CONTRACT's ordering was wrong): Tier 1 (lowest) engine defaults from
  CAPABILITY_DETAILS → Tier 2 `VoiceProfile.default_delivery` → Tier 3 (highest)
  `RenderPreset.delivery_overlay` OR `request.delivery` — one shared top tier.
  Dict-deep merge incl. `delivery.engine.*`; called identically from
  `/v1/generate` and chapter render.
- **Channel bindings are PERSONA-level** — `/v1/personas/{id}/channels`
  (`api/channels_api.py`); the freeze's profile-level design shipped differently.
- CUDA: installer ships CPU-baseline torch (~250 MB); GPU is an in-app opt-in wheel
  download + `restart_server`. First launch is real (<1–3 s), no engine preload,
  models load lazily behind 20 rotating messages.
- Render queue is resumable (`RenderJob` survives restart; `_run_startup` requeues).
  Take versioning: per-paragraph selector with `is_default`, lineage via
  `source_take_id`. Voice previews: in-memory LRU cap 20 / 10-min TTL, discarded
  unless promoted — no library pollution.
- Webhooks: at-least-once, backoff 1s/5s/30s/5m ×3,
  `X-JustVoice-Signature: hex(hmac_sha256(secret, body))`. Bulk-delete:
  `confirm=False` is a dry-run, ≥1 filter required. Generations sourced `mcp`/`rest`
  skip main-window autoplay. Recordings need ≥0.5 s. MCP (corrected 2026-08-04 — the freeze's "6 tools, off
  by default" was wrong): **4 tools** (`justvoice.speak/list_voices/transcribe/
  list_personas`), mounted **unconditionally** at `/mcp` on the app port (only a
  missing `fastmcp` disables it); `MCPSettings` holds one field, `default_voice`;
  `transcribe`'s `audio_path` is loopback-only.
- **Backup vs export:** backup = whole-server disaster recovery; export =
  per-project handoff.

## 3 · The JV↔JW boundary (from CONTRACT, endpoint table corrected)

- **JustWrite is writing-only** — no audio code of any kind, ever again (the last,
  `services/m4b.js`, is gone and must not come back). JustVoice owns everything
  downstream of the manuscript.
- **The handoff is a FILE export, not live HTTP**: JW exports a book `.zip`
  (Settings → Backups); the user opens it in JustVoice. JW never calls JV at
  runtime — there is no JV version for JW to pin. JV never spawns JW (JV is the
  spawned-by in the sidecar arrangement, never the spawner).
- Data ownership: manuscript text, character roster, speaker attribution = JW.
  VoiceProfile/samples, Persona, Lexicon, Generation, Take, RenderJob, M4B,
  mastered WAVs = JV. The Book entity lives in JW.
- Why the split: multi-use requires JV standalone; a JW-only caller would couple
  TTS to novel-writing and block the other four use cases.
- **The archived CONTRACT's endpoint table is stale** — no `/v1/profiles*` family
  ever shipped (voices are `/v1/voices*`), `render_chapter_async`/`render_story`/
  `lexicons/apply` don't exist, `/v1/jobs/{id}` means engine/model INSTALL jobs.
  Trust `server/justvoice/api/*` route literals, not the old table.

## 4 · Convergence outcomes (2026-06-24 arc, closed)

- **Layer A complete: both apps share ONE renderer kit** (`@delebash/llm-ui` +
  its `common/`): one serverApi transport (JW's SSE `aiFeature.js` is the one kept
  exception), one appearance engine (JV's palette reproduced hue-driven in
  `tokens.css`), one AppModal + AppDialog, all primitives/shells shared —
  `components/ui/` is EMPTY in both apps. Kit shells read semantic
  `--font-display`/`--font-body`; each app maps them.
- **Layer B decision (user, 2026-06-24): NO shared `server_core` package** —
  servers stay separate, basics uniform BY CONVENTION (headless `/ui` mount,
  optional bearer auth, RFC-7807 errors, settings-driven CORS). The ~60 truly-shared
  lines weren't worth a boot-critical cross-repo package; the one substantial shared
  server piece is already `llm_runner`.
- **The operating principle (user, 2026-06-23):** converge by default — ONE shared
  component per job; an app not needing a feature is NOT a reason to fork or defer a
  simpler variant. Applies to any reusable code, not just primitives.
- **App shell is keep-alike per app, NOT shared** — the convention lives in the
  family standard; the ruling fixed two real JV bugs (missing `grid-template-rows`
  nav-jump; `100vh`-ignores-zoom dead space) and both apps carry a shell smoke guard.
- Root cause of JV's original divergence, worth remembering: its markup was carried
  from an HTML preview mock (`.jv-*` utilities) instead of built component-first.
- Regression baselines when the arc closed: JV smoke 14/14 · JW headless smoke
  27/27 · pytest JV 286 / JW 82. Convergence branch: `claude/admiring-galileo-il3q0o`.
- Still wanted (tracked): the Layer C anti-divergence guard (fail on a new
  hand-rolled fetch / forked primitive / second `init_db` copy) + the server-basics
  parity sweep (camelCase responses, health/settings shape).

## 5 · Freeze rows the code has since reversed (anti-drift ledger)

| The freeze said | Today |
|---|---|
| Apache-2.0 (→ GPL when pedalboard) | MIT everywhere; first-party DSP |
| 9 engines v1 | 7 (catalog.py) |
| 13 tabs, flat | 14 routes + 3 hidden; Train/Compare/SpeakerLab/RenderLab/Audio → **Labs**; Cache/Channels/Webhooks → **Settings** |
| `settings.json` atomic store | SQLite `settings` row; `/v1/prefs` for renderer prefs |
| 3-way theme toggle in localStorage | the shared kit appearance engine, prefs in SQL |
| channels bind to profiles | channels bind to **personas** |
| `/v1/render_jobs*`, `/v1/generate_async`, per-gen stream/cancel | `/v1/render_chapter`, `/v1/render/cache-stats`, `/v1/generate/{id}/status` |
| `/v1/effects/available`·`/presets`, `/v1/cache` GET+DELETE, `/v1/training_jobs*`, `/v1/unreal/voicelines/*`, `/v1/health/filesystem` | `/v1/effects/catalog`·`/v1/effect-presets`, `/v1/cache/stats·clear·recent`, `/v1/train*`, `/v1/projects/{id}/export_voicelines`, `/v1/system/info` |
| — (absent from the freeze) | `/v1/voices/design`, scene analyze/discover-speakers, `/v1/llm/smart-assign`·`preset-suggest`, project qc/show-notes/narrator/corrections, `/v1/extraction/*`, `/v1/feature-pins`, `/v1/prefs`, `/v1/logs/tail` |
