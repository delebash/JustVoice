> **Status note (added post-execution):** all six slices shipped on `claude/jolly-curie-jkgysf`. D2/D3's "Studio is the landing view / Home(Studio) first" was **superseded by live user testing the same night** — Projects is the first sidebar item and the landing tab; Studio is the workspace you open a project into. See MORNING_RECAP.md (2026-06-10 late night) for the corrections.

# JustVoice UX Restructure — Workflow, Engine Switching, De-centering Generate

## Context

The user's assessment after using the app: Generate reads as "the main thing" by accident, the real production workflow (project → cast → render → re-roll → export) is hard to follow across Projects/Studio/Chapter, and engine switching is unintuitive (go to Engines → pick variant → Load → wait → go back; voice pickers only show the loaded engine's voices).

**Hard constraint (user-confirmed):** exactly one TTS engine loaded at a time (GPU memory). The manager already enforces this (one slot per `kind`, loading evicts the previous TTS).

**Key fact that shapes the design:** voice catalogs do NOT require loaded models. `/v1/voices` (`server/justvoice/api/voices_api.py:41-55`) already unions (a) manifest `STATIC_VOICES` (Kokoro 54, Qwen3 9, Dia speakers — declared, available cold), (b) stored clones/designs in the DB with their `engine` field, (c) in-process external providers. So browsing voices is free; only *rendering* with a cold voice costs a swap. The whole design hinges on making that swap moment explicit, predictable, and rare.

## Decisions (USER-CONFIRMED 2026-06-10 — all locked)

| # | Decision | Confirmed choice |
|---|----------|---------|
| D1 | Swap timing | **At render time.** Picking a voice is always free. Rendering with a cold voice prompts once: "Mara uses Chatterbox — swap from Kokoro? (~40s)" with an "always swap without asking" checkbox (persisted as `settings.generation.auto_engine_swap`). Batch renders group by engine (one swap per engine, not per block). |
| D2 | Home surface | **Project-first.** Studio becomes the home workspace (Cast → Script → Render → **Takes** tabs, project switcher in its header). Generate demotes to "Scratchpad". |
| D3 | Navigation | **Consolidate to 8 items, nothing hidden by use case:** Home(Studio) · Scratchpad · Stories · Captures · Library · Labs · Engines · Settings. |
| D4 | STT providers | **STT becomes a provider slot like TTS/LLM.** Local Whisper stays the installed default; users can register online STT providers — **openai-compatible adapter only to start** (`POST {base_url}/audio/transcriptions`, covers OpenAI/Groq/self-hosted whisper servers). Engines → STT tab gets a "Registered providers" section + active-provider selector. |
| D5 | Whisper warm-up | **Background load at boot** (non-blocking): after server health OK, if Whisper is installed and `captures.stt_provider == "local-whisper"`, kick off the load and show it as a task ("Preparing dictation"). Never blocks the UI; first Record waits on the in-flight load instead of cold-starting it. |
| D6 | Progress visibility | **Every AI-shaped wait rides the existing task system** (`renderTasks` store → TaskStrip + TaskStatusPanel): engine swaps triggered by the 409-retry helper, boot Whisper preload, online STT transcription — same pattern as today's generate/install/train/compose tasks. |
| D7 | User docs | Distill the design explanations from this session into the in-app docs (`docs/` + toc.json): engine pool model, free voice browsing vs. swap-at-render, batch grouping, STT providers. |

---

## Workstream 0 — Immediate bug (ship first, tiny)

**Whisper invisible in Engines — two stacked bugs (verified):**
1. `src/renderer/src/views/EnginesView.vue:58` — `KIND_LABELS = {tts, llm, embedding}`; `availableKinds` iterates this map, so `kind="stt"` engines never get a tab. Fix: add `stt: "STT"`.
2. Even with the tab, the Load button would be disabled: `selectedVariantFor()` needs a non-empty variant list, but `models_for()` (`server/justvoice/engines/model_catalog.py:15` match statement) has no `whisper` case, so `GET /v1/engines/whisper/models` returns nothing. Fix: add `_whisper_variants()` (base 74 MB / small 244 / medium 769 / large 1500 / turbo 1500, `vram_min_mb=0` — CPU-capable) and a `whisper` case; confirm `known_engines()` (engines/catalog.py) includes managed manifests so the route's existence check passes.

Verify: STT tab renders, whisper row shows the five sizes, Install/Load work, loading whisper does NOT evict the loaded TTS engine (separate kind slot).

## Workstream 1 — Voice-catalog truth model (server)

Goal: every picker can show *all* renderable voices with honest availability.

1. **Per-(engine,variant) voice cache.** New SQLite table `engine_voice_cache(engine_id, variant_id, voices_json, refreshed_at)`. On every successful load, the manager already receives the live voice list in the `/load` response (`manager.py:1165` area) — persist it there. Reconciles variant-dependent and model-update drift.
2. **Availability flags on `/v1/voices`.** Each `Voice` gains `engine_loaded: bool` and `variant_id: str|null` (compare `manifest.id`/variant against `get_manager().current_for("tts")` + `current_variant_id`). Cheap, no engine calls.
3. Voices from never-loaded, no-static-voices variants: omitted (nothing to show) — Engines tab notes "preset voices appear after first load" on such variants. Only affects non-default Qwen3 variants today.

Files: `database/models.py` (+migration in `database/migrations.py`), `engines/manager.py` (persist on load), `api/voices_api.py`, `models.py` (Voice fields).

## Workstream 2 — Swap-at-render (server)

1. **Explicit swap contract.** `GenerateRequest` and block/scene render requests gain `allow_engine_swap: bool = false`. When the resolved voice's engine (or variant) ≠ loaded: if `allow_engine_swap` or `settings.generation.auto_engine_swap` → swap (existing auto-load path) and proceed; else → **409** problem+json `{code: "engine-swap-required", from_engine, to_engine, to_variant, est_seconds}`. `est_seconds` heuristic from manifest `REQUIREMENTS.disk_space_mb` (rough tiers; honest "first load may take minutes" when weights not on disk).
   - Touch points: `api/generate_api.py` (managed + in-process paths), `render_core.render_line` / `_ManagedEngineFacade.load` (raise typed error instead of silent load), `api/takes_api.py::render_block`.
2. **Batch renders group by engine.** In `api/render_chapter_api.py` scene mode: order lines by resolved engine (stable within engine by position), render, then reassemble by position before concat — one swap per engine per batch instead of per block. Same for `BooksView` batch loop (server does it free once scene mode does).
3. New setting `generation.auto_engine_swap: bool = false` in `models.py` Settings.

## Workstream 3 — Shared VoicePicker (client)

New `components/VoicePicker.vue` replacing the five divergent pickers:
- Search + grouped by engine; rows show name, language, `engine · variant` tag, and a state badge: `● loaded` / `⇄ swap ~40s` / `⬇ not installed` (disabled, links to Engines).
- Emits `voice_id`; never triggers loads itself (D1).
- Swap prompt is one shared helper: catch the 409 `engine-swap-required` → `confirmDialog` with est. time + "always swap" checkbox (PATCHes the setting) → retry request with `allow_engine_swap: true`; progress rides the existing task strip (engine load already emits task events).

Integrate in: `GenerateView` voice chip, `StudioView` cast voice library, `ChapterView` regen picker, `StoriesView` generator bar, `RenderLabView`. The topbar engine pill becomes a swap-status pill: shows `engine · variant`, pulses during swaps, click → Engines.

## Workstream 4 — Project-first home (D2)

1. **Studio absorbs Chapter.** `ChapterView`'s block/take editor becomes Studio's fourth tab ("Takes" / per-use-case label), sharing Studio's project picker (drop Chapter's own project/scene selectors; keep scene select within the tab). `ChapterView.vue` content moves; sidebar entry removed; `#chapter` hash redirects to `#studio` + tab.
2. **Studio header = project workspace**: project switcher + "New project" + Import (reuses `ImportModal`) so Projects/BooksView becomes reachable *from* Studio ("Manage projects" link) rather than a sibling concept. BooksView stays as the management surface (metadata, QC, M4B, export) — linked, not duplicated.
3. **Landing logic** (`App.vue` `DEFAULT_TAB_BY_USE_CASE` + `resolveInitialTab`): last-opened project exists → Studio; no projects → Studio's empty state, which offers the three entry actions (Import manuscript · New project · "Just try a line" → Scratchpad).
4. **Generate → "Scratchpad"** (label/icon/lede change only in this slice; its internal layout polish is a later pass).
5. Overview: remove from nav; its stat cards move to Studio's empty state and Settings → Diagnostics. (Engine pill + task strip already cover live status globally.)

## Workstream 5 — Navigation consolidation (D3)

`App.vue` VIEWS/LANES rework to 8 flat items, **no `visibleFor` gating anywhere** (delete the mechanism; onboarding still sets terminology via `useCopy`):

1. Home (Studio) · 2. Scratchpad · 3. Stories · 4. Captures · 5. **Library** — new shell view with sub-tabs hosting existing `VoicesView/PersonasView/LexiconsView/EffectsView/RenderPresetsView` unchanged · 6. **Labs** — same shell pattern hosting `CompareView/AudioToolsView/RenderLabView/SpeakerLabView/TrainView` · 7. Engines · 8. Settings — gains sub-tabs absorbing `CacheView/AudioChannelsView/WebhooksView` plus existing GPU/logs (they're already settings-shaped).

Implementation: one generic `views/TabShellView.vue` (prop: tab list of {id,label,component}); hash routing extends to `#library/voices` style sub-paths; `HELP_SLUG_BY_VIEW` and KeyboardCheatsheet updated. Deleted: nothing — views are re-homed, not rewritten.

## Workstream 6 — STT provider slot (D4 + D5)

Mirror the TTS external-provider pattern (`EnginesSettings.external`, `models.py:266`) for STT.

**Server:**
1. `models.py`: new `ExternalSTTProviderConfig {id, label, provider_type: Literal["openai-compat"], base_url, api_key, model}`; `EnginesSettings.external_stt: list[...] = []`; `CapturesSettings` gains `stt_provider: str = "local-whisper"` and `preload_stt: bool = True` (existing `stt_model` keeps governing local Whisper size).
2. New `engines/stt_external.py`: `transcribe_external(cfg, audio_path, language) -> str` — httpx multipart POST `{base_url}/audio/transcriptions` (file + model + optional language), returns `.text`. ~40 lines.
3. `api/captures_api.py`: both transcription call sites (`create_capture` ~:184-203 and `retranscribe_capture` :316-324) route through one `_transcribe(audio_path, language)` dispatcher: `stt_provider == "local-whisper"` → existing `_ensure_stt_loaded()` + `manager.transcribe`; else look up the provider in `external_stt` → `transcribe_external` (no Whisper load gate at all). Unknown provider id → 422.
4. Readiness surface: `GET /v1/captures/readiness` (or extend existing status) reports `{provider, ready, detail}` — local: model-on-disk/loaded; external: base_url + key present.

**Client (EnginesView STT tab):**
5. "Registered providers" section under the Whisper engine card, same layout as the TTS tab; `ProviderForm` gains `kindHint="stt"` (fields: provider_type [openai-compat], base_url, api_key, model). Saved via PATCH `/v1/settings` into `engines.external_stt`.
6. Active-provider radio ("Used for dictation: ● Local Whisper ○ <provider label>") → PATCH `captures.stt_provider`.
7. `CapturesView`: replace the 503-toast-only readiness with the readiness endpoint — pill shows "Preparing dictation…" while local Whisper loads; online provider with missing key shows an actionable hint linking to Engines → STT.

**Boot preload (D5):** in `App.vue` boot sequence (after the `/v1/health` poll succeeds, `onMounted` ~line 322): if `captures.preload_stt` and provider is local-whisper and whisper installed-but-not-loaded → fire the existing engine-load API and `renderTasks.start({kind:"load", label:"Preparing dictation (Whisper)"})` with the same polling pattern EnginesView uses (EnginesView.vue ~line 399). Non-blocking; failure → quiet task-fail, dictation falls back to today's lazy load on first Record.

**Tests:** dispatcher unit tests (local path untouched; external path with mocked httpx; missing-key → 422/actionable error); settings round-trip for `external_stt`.

## Workstream 7 — User docs (D7)

Docs live in `docs/` (bundled via `import.meta.glob`, TOC in `docs/toc.json`, surfaced by HelpTrigger/JvHelpDrawer):
1. Rewrite `core-concepts` + `engines` docs around the model explained in this session: one engine in VRAM at a time; browsing voices is always free (catalogs come from manifests + DB, not loaded models); only rendering with a cold voice costs a swap; batch renders swap once per engine, not per block; the swap prompt and "always swap" setting.
2. `providers` doc: the three provider slots (TTS / LLM / STT), what openai-compatible means, when to use online vs. local.
3. `dictation` doc: local Whisper default, boot preload, switching to an online STT provider.
4. Update `HELP_SLUG_BY_VIEW` (App.vue ~:117-136) + `toc.json` for the new nav shape (Studio-home, Scratchpad, Library, Labs).

## Phasing / commits

1. **Slice A**: WS0 + WS1 + WS2 (server truth + swap contract + grouped batch) + tests.
2. **Slice B**: WS3 VoicePicker + swap-prompt helper + integration in Generate/Studio/Chapter/Stories.
3. **Slice C**: WS4 Studio-home + Chapter merge + landing logic + Scratchpad rename.
4. **Slice D**: WS5 nav consolidation + TabShellView + Settings absorption.
5. **Slice E**: WS6 STT provider slot + boot preload + readiness UI.
6. **Slice F**: WS7 docs + MORNING_RECAP update.

Each slice: ruff + pytest green, vite build green, commit + push to `claude/jolly-curie-jkgysf`.

## Verification

- **Server tests**: 409 swap contract (cold voice without flag → 409 with `to_engine`; with flag → renders via mocked manager; `auto_engine_swap` setting bypasses), batch group-by-engine ordering (mixed-engine scene → blocks reassembled in position order, engine-load called once per engine via mock), voice availability flags (`engine_loaded` true only for the current slot), voice-cache persistence on load.
- **Build**: `npx vite build` after each slice; `create_app()` route-count boot check.
- **Server tests (Slice E)**: STT dispatcher — local path unchanged, external path hits mocked openai-compat endpoint, provider with missing credentials fails actionably.
- **Manual smoke (user, post-merge)**: fresh boot lands in Studio empty state, task strip shows "Preparing dictation (Whisper)" without blocking → import/create project → cast with a Kokoro voice + a Chatterbox clone (spans 2 engines, warning chip shows) → render scene (one swap prompt with "always swap" checkbox, grouped render, swap progress in task strip) → Takes tab re-roll → Scratchpad quick line with a cold voice triggers the swap prompt → Engines → STT shows Whisper sizes + Registered providers; register an openai-compat STT provider, switch dictation to it, record → transcript comes back with no local model loaded.

## Explicitly out of scope (later passes)

Scratchpad internal layout redesign; visual-design changes (palette/typography locked); accessibility re-introduction; Unreal export; Train/Blend engine flags.
