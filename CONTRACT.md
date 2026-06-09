# JustTTS ↔ JustWrite Contract

> Authoritative definition of the boundary between JustTTS (voice production server) and JustWrite (novel writing app). Last revised 2026-06-09 (added profiles + capability manifest + take lineage + 3-tier voice tuning endpoints; see `MORNING_RECAP.md` "2026-06-09 ship list").

## Product split

- **JustWrite** — pure novel writing app. Owns: manuscript editor, character roster, scene/chapter tree, export to audiobook orchestration. Does NOT contain: TTS engine code, voice cloning, ACX mastering, M4B mux, lexicons, persona LLM-rewrite. Distributes as its own installer.

- **JustVoice** (Python package + console-script kept as `justtts` / `justtts-server` until the rename PR — naming-collision fix from `project_gotchas` memory must be preserved through the rename) — standalone voice production server. Owns: engine pool, voice profiles, voice cloning, persona LLM-rewrite, lexicons, per-chapter render, ACX mastering, take versioning, multi-track timeline editor, dictation, MCP server, captures. Distributes as its own installer with Tauri shell + Python sidecar.

The audiobook workflow is JustWrite *orchestrating* JustTTS via HTTP. JustWrite holds the manuscript and the project shape; JustTTS holds the voices and the audio.

## Why this split

The multi-use case for JustTTS — audiobook, game dialogue (Unreal), podcasting, dictation, accessibility — requires JustTTS to be a standalone product. JustWrite-only callers would couple TTS to novel writing, blocking the other use cases. Splitting also keeps JustWrite small for users who don't care about audio.

See `~/.claude/projects/E--Dev-Web-justtts/memory/project_use_cases.md` for the multi-use rationale.

## Wire format

JustTTS exposes a versioned HTTP API. All Pydantic request/response shapes live in `server/justtts/models.py` (the cross-language source of truth per CLAUDE.md). The Vue renderer and any external caller (JustWrite, an Unreal plugin, an MCP agent, a `curl` script) hit the same endpoints.

### Stable endpoints (semver-protected)

| Endpoint | Purpose | Consumer |
|---|---|---|
| `POST /v1/render_chapter` | Render a chapter (ordered list of blocks → audio segments + manifest) | JustWrite, MCP, CLI |
| `POST /v1/render_chapter_async` | Same but enqueues; returns job id | JustWrite (for large books) |
| `GET /v1/jobs/{id}` | Poll a render job's status | JustWrite |
| `DELETE /v1/jobs/{id}` | Cancel a render job | JustWrite |
| `POST /v1/master` | Apply a mastering preset to audio bytes | JustWrite |
| `POST /v1/analyze` | LUFS / peak / noise floor / clipping report | JustWrite |
| `POST /v1/generate` | Single-line synthesis → audio/wav. Auto-chunks long text. | All callers |
| `GET /v1/voices` | List voice catalog (engine presets + stored voices) | JustWrite, Unreal, all callers |
| `POST /v1/voices/clone` | Clone a voice from a sample | JustWrite (for fast cast UX), JustTTS UI |
| `POST /v1/voices/blend` | Blend two voice profiles | JustTTS UI (Phase 5+) |
| `GET /v1/profiles` | List voice profiles (name + voice_type + personality + default_delivery + effects_chain) | JustWrite, JustTTS UI |
| `GET /v1/profiles/{id}` | Get one profile | JustWrite, JustTTS UI |
| `POST /v1/profiles` | Create a voice profile | JustTTS UI |
| `PATCH /v1/profiles/{id}` | Update a voice profile | JustTTS UI |
| `DELETE /v1/profiles/{id}` | Delete a voice profile | JustTTS UI |
| `POST /v1/profiles/{id}/compose` | LLM-fill a fresh in-character line (501 until settings.llm wired) | JustTTS UI |
| `GET /v1/personas` | List personas (character bios + voice mapping) | JustWrite, JustTTS UI |
| `POST /v1/personas` | Create/update a persona | JustWrite, JustTTS UI |
| `GET /v1/lexicons` | List pronunciation dictionaries | JustWrite, JustTTS UI |
| `POST /v1/lexicons/apply` | Run a text through a lexicon (for preview) | JustWrite editor |
| `GET /v1/engines` | List installed engines + boolean capability flags | JustWrite, JustTTS UI |
| `GET /v1/engines/capabilities` | Full per-engine knob + inline-tag manifest (drives UI gating) | JustTTS UI |
| `GET /v1/engines/{id}/capabilities` | Single-engine knob + inline-tag detail | JustTTS UI |
| `POST /v1/engines/{id}/load` | Load an engine into memory | JustTTS UI |
| `GET /v1/takes/recent` | Last N generations across the DB — drives the History card | JustTTS UI |
| `GET /v1/takes/{id}/lineage` | Walk a take's source chain back to the original | JustTTS UI |
| `GET /v1/settings` | Read settings (operator-tunable values) | All callers |
| `PATCH /v1/settings` | Update settings | JustTTS UI |

Endpoint additions are non-breaking. Endpoint removals or shape changes are major-version bumps. The OpenAPI snapshot is committed to the JustTTS repo and diffed in CI.

### Three-tier voice tuning (2026-06-09)

`POST /v1/generate` accepts optional `profile_id` and `preset_id` fields. When set, the server merges delivery overlays in this precedence (highest first):

1. **Tier 3** — `RenderPreset.delivery_json` (looked up by `preset_id`)
2. **Tier 3** — the request's `delivery` field
3. **Tier 2** — `VoiceProfile.default_delivery` JSON (looked up by `profile_id`)
4. **Tier 1** — engine defaults (from the capability manifest)

The merge is dict-deep — engine-specific subdicts (`delivery.engine.*`) merge at the inner-key level too. Implementation: `server/justtts/delivery_merge.py`.

### Authentication

Bearer token in `Authorization: Bearer <token>` header. Token is configured in JustTTS settings + bundled into JustWrite's sidecar-install flow.

### Transport

JustTTS listens on `127.0.0.1:17494` (configurable). JustWrite spawns JustTTS as a sidecar via `justwrite-app/src-tauri/src/lib.rs` (the existing `voicebox_install` Rust command will be renamed `justvoice_install` or extended in Phase 5).

## Data ownership

| Entity | Owner | Notes |
|---|---|---|
| Manuscript text (book body, chapters, scenes, paragraphs) | JustWrite | Stays in JustWrite's IndexedDB / filesystem |
| Character roster + bios | JustWrite | Synced to JustTTS as `Persona` rows when cast for audio |
| Speaker attribution (which character speaks which line) | JustWrite | Computed in JustWrite's `services/speakerAttribution.js`; passed to JustTTS as part of `/render_chapter` payload |
| `VoiceProfile` (cloned/preset/designed voices) | JustTTS | SQLite-backed; created on demand from a `Persona` |
| `ProfileSample` (reference audio for cloning) | JustTTS | Audio blobs on disk, paths in SQLite |
| `Persona` (character bio + voice mapping + personality prompt) | JustTTS | SQLite-backed; per-persona LLM rewrite enabled by `personality` flag |
| `Lexicon` (pronunciation dictionary) | JustTTS | SQLite-backed; applied per render |
| `Generation` (a TTS render of a text block) | JustTTS | SQLite-backed; audio path on disk |
| `Take` (a generation version — for re-roll workflow) | JustTTS | SQLite-backed; lineage via `source_take_id` |
| `RenderJob` (a chapter render in progress) | JustTTS | SQLite-backed; resumable across server restarts |
| M4B file with chapter markers | JustWrite | JustWrite calls `/render_chapter` per chapter, then muxes locally via `services/m4b.js` (FFmpeg.wasm) |
| Per-chapter mastered WAVs | JustTTS (cache) + JustWrite (download) | Mastered output streamed/downloaded; cached on JustTTS side keyed by content hash |

## Render flow (audiobook end-to-end)

1. **JustWrite** holds a Book with Chapters and Scenes and Paragraphs. Each paragraph has a Character attribution and optional Direction (emotion/style hint).
2. User clicks "Render audiobook" in JustWrite's StudioView.
3. For each Chapter, JustWrite calls `POST /v1/render_chapter` with the ordered Blocks (text + character_id + direction + persona_overrides).
4. **JustTTS** for each block: applies the character's Persona (with personality LLM-rewrite if enabled) → applies the active Lexicon → selects the engine → renders audio → records a `Generation` row + `Take` row → returns audio bytes (or a URL).
5. JustWrite collects per-chapter WAVs.
6. JustWrite calls `POST /v1/master` per chapter with the active mastering preset (ACX/iAudio/Podcast/YouTube).
7. JustWrite's `services/m4b.js` muxes the mastered chapter WAVs into a single M4B with chapter markers using FFmpeg.wasm in-browser.
8. User downloads the M4B; uploads to ACX.

## Render flow (game dialogue — Unreal Engine)

1. **Unreal Editor** plugin (`.uplugin`, planned Phase 6) or a script calls `GET /v1/voices` to see available voice profiles.
2. For each NPC dialogue line, calls `POST /v1/render_chapter` with a single Block (or `/v1/generate` for the simpler case).
3. **JustTTS** returns audio bytes.
4. Plugin writes audio to `Content/Audio/Dialogue/<NPC>/<line_id>.wav` as a `USoundWave` asset.
5. Optional: a JSON sidecar with metadata (speaker, emotion, scene_id, line_id, viseme_data if available) for runtime lookup.

## Render flow (podcasting)

1. **JustTTS standalone UI** (the Vue renderer) holds the Story timeline.
2. User arranges `StoryItem`s on the timeline (multi-track, drag-to-arrange, trim, split, version-pin).
3. User exports the Story → calls `POST /v1/master` per track + `POST /v1/render_story` (Phase 5+) for the multi-track mixdown.
4. Output: a single mastered MP3 / WAV.

## What JustWrite MUST NOT do

- Hold any voice/audio backend code. m4b.js (FFmpeg.wasm-side muxing) is the only audio code in JustWrite — and it's a thin client of JustTTS, not a backend.
- Pin a specific JustTTS version. JustWrite hits the v1 endpoints; JustTTS guarantees v1 backward compatibility within a semver major.

## What JustTTS MUST NOT do

- Hold any manuscript / character-roster / scene structure. The Book entity lives in JustWrite. JustTTS only sees individual render requests + persistent Personas/Voices/Lexicons.
- Spawn JustWrite. JustTTS is the spawned-by, never the spawner. Standalone JustTTS users hit the JustTTS UI directly.

## Contract testing

- The OpenAPI schema for `/v1/*` lives at `server/justtts/openapi.json` (snapshot, regenerated in CI).
- On every PR, CI diffs the new OpenAPI snapshot against the committed one. Breaking changes (removed endpoint, removed required field, type narrowing) fail CI.
- JustWrite's `services/render.js` is the canonical consumer. Any breaking JustTTS PR must include a coordinated JustWrite PR.
- A `tests/test_contract.py` pytest module asserts the OpenAPI shape of every endpoint in this document.
