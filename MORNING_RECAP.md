# Morning Recap — JustVoice

> The in-repo session-pickup doc. Reflects current code state, not history.
> Read this immediately after `CLAUDE.md`. If this file conflicts with a memory file, the memory file wins.

---

## 2026-06-10 (late night) — post-restructure corrections from live user testing (same branch, commits fb81585..00977b8)

User tested the restructure build and corrected three things; all landed:

1. **Projects-first, NOT Studio-first (supersedes Slice C/D's D2/D3 landing).** Projects (BooksView) is back in the sidebar as the FIRST item and the landing tab for all production use cases (dictation → Captures). Studio label reverted from "Home" to "Studio" — it's the workspace you open a project INTO. Project creation with an explicit type happens in Projects ('+ New blank Project'). Projects → "Open in Studio" hands the selected project over via localStorage `jv.studio.pendingProjectId` (Studio loadAll reads+clears). Studio's start tab is per use case (`STUDIO_START_TAB_BY_USE_CASE`): podcast/dictation open on Script, audiobook/game on Cast — "podcast wouldn't want characters first".

2. **App-wide dialog bug (root cause of "New button doesn't work" + "modal at bottom of screen, locks it"):** Reka UI portals DialogOverlay + DialogContent to <body> as SIBLINGS and doesn't position the content; `.jv-dialog` had NO position rule → every prompt/confirm rendered in flow at page bottom UNDER the fixed overlay (z-index 200) that ate all clicks. Fixed: `.jv-dialog` fixed+centered, z 210, new jvDialogIn keyframes carrying the centering translate. WelcomeOnboarding's `.app-modal*` classes had ZERO css anywhere — same fix applied. Pattern note: `.jv-modal` users are fine (card is INSIDE .jv-overlay's flex centering); JvHelpDrawer self-positions.

3. **GUI quality pass driven by REAL screenshots** (headless chromium at /opt/pw-browsers against the live server + built dist — the screenshot harness recipe: boot `python -m uvicorn --factory justvoice.app:create_app`, playwright-core with executablePath to /opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell, PATCH settings app.onboarding_shown=true first). Fixes: `.jv-content > *` max-width 1160px centered (everything was full-bleed ~1330px); `accent-color` on range/checkbox/radio (sliders were browser-blue); Scratchpad's contradictory "No engine loaded → Go to Engines" banner removed (showed beside 64 pickable voices; emptyVoiceReason now only fires on a truly empty catalog); Stop is a labeled button only visible while rendering; Studio empty-cast void → EmptyState; **EnginesView kind-tab loop was hardcoded ['tts','llm','embedding'] so the STT tab NEVER rendered** despite Slice A's KIND_LABELS fix (label map ≠ render loop — Affordance-Table failure mode); now derives from KIND_LABELS with per-kind online counts.

**Still open:** user re-test of dialogs + landing flow; deeper visual polish (Settings double tab row, Engines NOT-INSTALLED badge styling, Books bulk-bar wrap) — candidates for the Phase 4 design pass; stories.md doc referenced by toc.json doesn't exist on disk.

### NEXT SESSION — requires the JustWrite repo added (user request 2026-06-10)

This session was scoped to JustVoice only (no list_repos/add_repo tools) — these two tasks were explicitly requested and BLOCKED on JustWrite access. Per ⛔ feedback_upstream_audit_hard_rule, do NOT do them from comment paraphrases — read JustWrite file-by-file.

**Task 1 — audit JustVoice Studio against JustWrite's studio tab ("what you got wrong").** Verify every lift claim line-by-line against the actual JustWrite source. The claim inventory to check:
- `StudioView.vue:5` — "Render flow ported in shape from JustWrite's StudioView.vue"
- `StudioView.vue:1050-1115` — voice library sidebar "per SettingsProviderForm.vue:965-1100", 13 affordances, letters A–J cited at :288/:296/:337
- `ProviderForm.vue:5` — "direct port of SettingsProviderForm.vue:362-657"; tier picker "per :225-242"
- `renderTasks.js:1` + `TaskStrip.vue:4` — adapted from JustWrite aiTasks.js / AiTaskStrip
Produce a Rule #6.1 Affordance Table (source file:line | affordance | present-in-JustVoice file:line ✅/❌) and fix the ❌s. Pay attention to the user's specific complaint area: how JustWrite's studio tab composes the workspace (layout, what's first, how casting/episode flows differ per content type).

**Task 2 — plan (then execute) removing JustWrite's audio studio.** End-state: JustWrite delegates ALL audio production to JustVoice over CONTRACT.md (`/v1/render_chapter`, `/v1/render_chapter_async` + jobs, voices/personas/lexicons endpoints). Note CONTRACT.md staleness flagged earlier: it lists `/v1/render_chapter_async` + `/v1/jobs/*` and `/v1/profiles`, which don't exist server-side yet — reconcile the contract BEFORE deleting anything in JustWrite (either build the async render+jobs surface in JustVoice or amend the contract). Audit which JustWrite components/services constitute its "audio studio" (its StudioView/audio tab, m4b.js stays per CONTRACT — M4B muxing is client-side in JustWrite), map each to its JustVoice replacement, then remove.

---

## 2026-06-10 (night) — UX restructure: swap-at-render, project-first home, 8-item nav, STT provider slot (branch `claude/jolly-curie-jkgysf`, slices A–F)

The approved UX-restructure plan landed in full. 152 server tests pass, ruff clean, vite build clean.

**Slice A (server truth + swap contract):** Whisper now visible in Engines (stt tab label + whisper in `known_engines()` + 5 variants in `model_catalog` — base/small/medium/large/turbo, `vram_mb=0` all CPU-capable). `engine_voice_cache` table persists each `/load` response's live voice list per (engine, variant); `/v1/voices` carries `engine_loaded` + `variant_id` flags and surfaces cached variant-discovered voices while cold. **Swap-at-render contract:** `allow_engine_swap` on Generate/RenderChapter/BlockRender requests; cold managed engine without the flag (or `generation.auto_engine_swap`) → 409 problem+json `engine-swap-required` with from/to engine, variant, est_seconds, weights_on_disk (`render_core.raise_if_swap_blocked`; ApiError gained `extra`). Batch `render_chapter` renders grouped by engine (stable in-engine order, output reassembled by position) — one swap per engine per batch.

**Slice B (client):** shared `VoicePicker.vue` (full catalog grouped by engine, ●/⇄/⬇ badges, never loads) replacing the five divergent pickers (Generate chip, Chapter regen + chip, Stories bar, RenderLab, plus Studio library badges + multi-engine-cast warning chip). `services/engineSwap.js withEngineSwap()` owns the 409→confirm(with "always swap" checkbox → settings read-modify-write)→retry flow under a kind:'load' task. api.js errors carry `.status`/`.body`; confirm dialogs support a checkbox. `/v1/health` now reports the manager's TTS slot + `current_variant` (the pill previously NEVER showed managed engines); topbar pill shows `engine · variant` and pulses during swaps.

**Slice C (project-first home):** Studio is the landing view (dictation → Captures); Studio header = project switcher + New + Import (ImportModal) + "Manage projects ›" (#books); no-projects empty state with the 3 entry actions; ChapterView absorbed as Studio's Takes tab via a `projectId` prop (own selector hidden when hosted); Generate→Scratchpad rename; Overview unrouted; #chapter/#overview redirect.

**Slice D (nav):** 8 flat sidebar items (Home·Scratchpad·Stories·Captures·Library·Labs·Engines·Settings), `visibleFor` gating deleted. `TabShellView.vue` hosts Library (Voices/Personas/Lexicons/Effects/Presets), Labs (Compare/Audio/RenderLab/SpeakerLab/Train), Settings (General/Cache/Channels/Webhooks). Hash routing handles `#library/voices` sub-paths; all legacy hashes rewrite in place. Projects (#books) routable but not in nav.

**Slice E (STT provider slot):** `engines.external_stt` + `captures.stt_provider`/`preload_stt`; `engines/stt_external.py` openai-compat adapter (`POST {base}/audio/transcriptions` — OpenAI/Groq/self-hosted); captures `_transcribe()` dispatcher (local keeps the Whisper gate, external skips it, unknown id → 422); provider-aware `/v1/capture/readiness`; Engines→STT "Used for dictation" radio + ProviderForm kindHint="stt"; **Whisper boot preload** as a visible non-blocking task (App.vue after first healthy poll, gated on installed+local+preload_stt). **Fixed latent data loss:** partial `{engines:{external}}` PATCHes validated as default-filled EnginesSettings and wiped `llm`/`feature_pins` on disk — all engines-section PATCHes now send the full section.

**Slice F (docs):** core-concepts "engine pool" section (browse free / swap-at-render / one-swap-per-engine batches / cache); engines.md loading section rewritten + STT section; providers.md covers the three provider slots; dictation.md local-vs-online STT; toc titles updated.

**Still open:** runtime smoke test against a live engine (swap prompt, grouped batch, boot preload, online STT end-to-end); Scratchpad internal layout polish; visual design pass (Phase 4); CONTRACT.md staleness from the prior session's list.

---

## 2026-06-10 (evening) — Full-app audit + dead-wiring sweep (branch `claude/jolly-curie-jkgysf`)

Full code audit (every view, every router) then a truth pass. 112 server tests pass, ruff clean, vite build clean. Key changes:

**Server:** new `/v1/stories` CRUD + `/v1/captures` list/delete (tables existed since Phase 1.5, views errored on every load); `/v1/cache/recent` + per-entry DELETE; **fixed destructive bug** — cache "prune by voice/engine/age" silently purged the ENTIRE cache (server ignored the filters); real `older_than_days` + 400 on unsupportable filters; `PATCH`/`DELETE /v1/generations/{id}` (History ★/✕); `/v1/logs/tail` + `/v1/logs/download` via in-memory ring buffer; `effects_preset_id` on GenerateRequest (persona chain → picked chain → render-preset chain); deduped double `projects_api` mount; OpenAPI license_info Apache→GPL; all 45 ruff violations fixed.

**Frontend:** deleted 14 dead files (stores player/generation/server/audioChannel, components AddProviderModal/AppModal/Breadcrumb/ChordPicker/Combobox/PaneHeader/StatPill, both roving-tabindex composables) + dead `/v1/profiles` service fns. **Generate chip pickers were unusable** — the select was a hidden 12px sliver; now an invisible overlay across the whole chip with a ▾ caret (Voice/Persona/Effects). Effects chip wired to effect presets for real. Stop button wired to AbortController; History ★/↻/✕ wired. VoicesView preview repointed to `/v1/generate`; fabricated sample rows removed. BooksView batch render now actually renders via `/v1/render_chapter` (was fake-success toasts); M4B/QC/re-master honestly disabled. Stories/Captures fake controls (simulated recording, narration-only generate) disabled with honest tooltips. LineageViewer finally mounted (ChapterView lineage pill → chain modal). SettingsView: `/v1/system/info` fix, logs card live, MCP binding ✕ wired, fake GPU phase/torch text removed, API table corrected, About buttons now real links. ALL native `prompt()`/`confirm()` replaced with in-app dialogs (10 views). **Accessibility removed as a use case** (onboarding card, store, copy.js, App.vue gating; stored values normalize via VALID-set fallback).

**Later same session (commits c7e34da..a74505f + Phase 3):** Phase 2 done (SQLite-only personas/voices/lexicons, JSON auto-import, ProjectStore deleted). Dictation done (whisper KIND=stt engine, /v1/captures pipeline, refinement via LLM feature-pin `dictation_refine`, webview WAV recorder — voicebox-informed, attribution in headers). Stories done (Web Audio playback, clip add/move/volume/delete, generate-at-playhead via new X-Generation-Id header). **Two foundational fixes:** /v1/generate now persists Generation rows (NOTHING wrote that table before — History/takes/stories all read it), and render_core gained a managed-engine facade (the whole chapter pipeline previously 404'd for every local engine — it only worked for external API providers). Phase 3 done: take-atomic `POST /v1/blocks/{id}/render` (Generation+Take+lineage in one call; ChapterView regen rewired), `GET /v1/projects/{id}/qc` (ACX bounds; noise floor honestly "not measured"), `GET /v1/projects/{id}/export_m4b` (scipy resample + ffmpeg mux, 501 without ffmpeg; BooksView buttons live).

**Still open:** runtime smoke test (`npm run tauri dev`) — dictation, Stories playback, block regen, M4B all unverified against a live engine; CONTRACT.md still lists `/v1/profiles` + `/v1/render_chapter_async` (neither exists); game WAV+JSON export; Train/Blend dead until engine flags flip (start Chatterbox); hotkey→pill→auto-paste desktop loop.

---

## 2026-06-10 — Rule #6.1 (Affordance Table) added + 4 lies caught + tests added

**11 commits this session.** Last sha: `4e58f87` (pushed to origin/main).

### What the session was about

Audited the "Phase 1-9 complete" claim from the prior session. User flagged that the "Add Provider button wired into EnginesView" claim was a lie — modal mounted + button added, but EnginesView still had ZERO of JustWrite's SettingsProviderForm affordances. Triggered an honest conversation about why JustVoice work has been worse than JustWrite work and a new global rule.

### Global rule added

**Rule #6.1 — the Affordance Table** appended to `~/.claude/CLAUDE.md`. Before declaring any non-trivial item done, produce a 3-column table:

1. **Source of truth (file:line)** — actual file read THIS turn, not a plan paraphrase
2. **Affordance** — one row per user-facing capability
3. **Present in my work? (file:line)** — ✅ with citation or ❌ with reason

Done = every row ✅. Any ❌ = work isn't done. Same shape as Rules #3/#4 — checkable artifact at point of claim. The abstract version of Rule #6 ("Don't be lazy. Do the whole job.") failed within a day; the artifact version is what's enforced going forward.

### 4 lies caught + rebuilt to honest scores (UI rebuilds)

| Item | Before | After | Honest ❌ remaining |
|---|---|---|---|
| EnginesView (provider config) | 1/20 ✅ | 17 ✅ / 1 ⚠ / 2 ❌ | Chatterbox + Dia hot-swap (endpoints don't exist locally) |
| Studio Cast voice library | 5/13 ✅ | 10 ✅ / 4 ⚠ / 0 ❌ | Pagination, online/offline status |
| QuickSetup wizard | 1/10 ✅ | 7 ✅ / 1 ⚠ / 1 N/A | Manual cloud provider picker |
| Settings AI Features | 4/11 ✅ | 6 ✅ / 0 ⚠ / 5 ❌ | Lab presets, prompt preview, usage timestamps, bulk pin |

### 3 risks closed by tests (post-rebuild)

- **Scene-mode `/v1/render_chapter`** — 11 new tests in `test_render_chapter_scene_mode.py`. Covers persona resolution, default_delivery merge, personality → delivery.instruct, preset (tier-3) winning over personality (tier-2), lexicon collection + dedup, missing-persona / no-voice / empty-text / unknown-scene edges. All pass.
- **Persona rewrite endpoint** — 7 new tests in `test_persona_rewrite.py`. Covers 404 (no persona) / 400 (empty text + no personality) / 501 (no LLM) / 502 (LLM failure) / 200 success including the `{original, rewritten, persona_id}` shape that StudioView's right-click handler reads. Plus a test that asserts the system prompt contains the persona's personality + `feature="persona_rewrite"` for correct pin routing.
- **Breadcrumb cleanup** — verified by read-through only. `App.vue:288-295` calls `uiContext.clear()` on view change; new view's `immediate:true` watcher re-publishes after. Vue 3 watch flush ordering guarantees clear-then-set. No Vitest in the repo so no runtime test.

### Test count

**85 → 103** (18 new). Pytest 103/103. Vite build passes.

### New components / views shipped this session

- `components/ProviderForm.vue` — inline editor with id / name / kind / base_url / API key / runner / chat model + Fetch / tier picker / embedding model / TTS model + Fetch / voices multi-select + Fetch / response_format / Ping / Save / Cancel / Delete. Matches JustWrite's `SettingsProviderForm.vue:362-657` pattern (read in full this turn).
- `components/KeyboardCheatsheet.vue` — `?` overlay listing shortcuts grouped by view. Esc to dismiss.
- `views/RenderPresetsView.vue` — render preset library; per-preset name / voice / master / effects-chain (opens EffectsChainEditorModal). Wires to `/v1/presets` CRUD; `effects_chain` column now in request/response.
- `stores/uiContext.js` — breadcrumb segment slot. App.vue topbar renders it; views push their context.

### New components from prior turns still in scope

- `components/AddProviderModal.vue` — **superseded by ProviderForm**. File still on disk, unused. Sweep later.
- `components/QuickSetup.vue` — fully rewritten this session into multi-step wizard.

### What's runtime-unverified (honest red flag)

I have NOT booted the app end-to-end this session. Vite build passes (1.24s, all components compile, all imports resolve, templates valid). Pytest passes (103/103). But the renderer↔backend flows below are unverified at runtime:

- Scene-mode `/v1/render_chapter` against the real Python server with a real engine (only tested at function level)
- ProviderForm against a live `/v1/llm-providers` registry — does Fetch models actually round-trip?
- Studio Render audio Blob → GlobalAudioPlayer URL lifecycle
- Breadcrumb publishing on real route changes
- QuickSetup multi-step flow against real `/v1/system/info` + `/v1/jobs/{job_id}` polling
- Settings AI Features fetch models button against a registered provider

First action for a next session: `npm run tauri dev`, click through each of those flows once, capture what breaks.

### Plan additions

`~/.claude/plans/1-what-are-the-magical-scone.md` gained 2 sections this session:
- **Q6 — UX density + width architecture** (7 content-typed width tokens + form primitives + per-surface shell rules)
- **Q7 — Other UX issues** (12 items across nav/forms/feedback/visual/discoverability/state)

### Conversational learnings (saved to memory this session)

- **Affordance Table rule** (`feedback_affordance_table_rule`) — Rule #6.1 mechanism
- **Phases ARE the checkpoint** (`feedback_phases_are_checkpoints`) — user designed phases so I wouldn't compress; "do it all" means no permission-ask, not lower bar
- **Excuse pattern** (`feedback_excuse_pattern`) — when called out I construct post-hoc explanations that put cause outside me. User correctly flagged this multiple times.

---

## BUILD MILESTONE — 2026-06-09: Capability manifest + profiles + auto-chunking wired + take-lineage + 3-tier voice tuning + global audio player. 81 server tests pass. vite build clean.

## 2026-06-09 evening ship — commit `7fdd6f1` (pushed)

Massive rebrand + license-hygiene sweep + UX polish. All in one commit.

**Brand rename — JustVoice → JustVoice:**
- All product-facing strings renamed across docs, UI, comments, Tauri configs, package metadata, legacy-gui, preview HTML, CSS tokens (`--voicebox` → `--info-blue`).
- **Preserved as technical identifiers** (spawn-loop fix from `project_gotchas`): Python package `server/justvoice/`, console script `justvoice-server`, Tauri binary `justvoice.exe`, X-JustVoice-* HTTP wire headers (manager.py:1138-1140 + justvoice_plugin/server.py:135-137), `JUSTVOICE_DATA_DIR`/`JUSTVOICE_MODEL_DIR`/`JUSTVOICE_TORCH_INDEX` env vars. CLAUDE.md L5 keeps the rename-history note pointing readers at "JustVoice" in legacy memory files.

**Voicebox reference removal:**
- All non-attribution voicebox references stripped (~130 mentions): strategic docs, code comments, "voicebox-parity" labels, the comparison file (`preview/voicebox-feature-comparison.md` deleted), src-tag chip labels.
- **Kept where MIT §3 requires it**: `voicebox-pin.txt`, NOTICE.md voicebox section, LICENSES.md row, SPDX-FileCopyrightText headers on every lifted file (7 Rust + 5 Vue + 3 Python), visible UI footer at `SettingsView.vue:1787` + `preview/full-app-preview.html:1812` ("Portions ported from voicebox (MIT)…").

**Engine catalog — Higgs removed:**
- `server/justvoice/engines/higgs_audio/` deleted entirely. Higgs Audio v3's weights ship under a non-commercial license that would taint commercial audiobook / game / podcast output.
- Each remaining engine's MODEL WEIGHTS license verified commercial-output-permitting via WebFetch on its HuggingFace model card (see `project_engine_weight_licenses` memory).
- Engines now: 7 base / 9 with variants (Kokoro, Chatterbox + Turbo + Multilingual, Qwen3 + 0.6B, LuxTTS, TADA, Dia, MOSS-TTSD) + external OpenAI-compatible.

**TADA Llama 3.2 attribution:**
- New manifest fields `WEIGHTS_LICENSE` + `ATTRIBUTION` (in `EmbeddedEngine`/manager.py:121-138) flow through `EngineInfo` (models.py:500-512) → `/v1/engines` → EnginesView card (`.engine-card__license` pill + `.engine-card__attribution` warn-tinted row).
- TADA manifest declares `WEIGHTS_LICENSE = "Llama-3.2-Community"` + `ATTRIBUTION = "Built with Llama"` per Llama §1.b.
- NOTICE.md + docs/engines.md document the attribution requirement.

**UX polish (long-running ops):**
- `renderTasks.js` store: `panelOpen` + `openPanel`/`closePanel`/`togglePanel`, `cancelAll`, `retry(id)`, `dismiss(id)`, `activeCount` computed, `_scheduleAutoDismiss` (5s completed / 3s cancelled / never failed), `_timers: Map`. Tasks accept `onRetry` callback.
- New components `TaskStrip.vue` (accent-tinted inline strip with Details/Cancel/Retry/Dismiss) + `TaskStatusPanel.vue` (right-side slide-in with Running + Recent sections, teleported, click-outside + Esc).
- Topbar status pill is now clickable button → `tasks.togglePanel()` (App.vue:203-212).

**Engine load — server-side cancel:**
- `EngineManager._cancel_load_requests: set[str]` + `request_cancel_load(engine_id)` method (manager.py:917-945). Polled at safe steps (shared-venv setup, model download, subprocess spawn, child /load).
- `POST /v1/engines/{id}/cancel-load` endpoint (engines_models_api.py:120-135). EnginesView wires `AbortController` + Cancel button + `onRetry: () => load(id, variant)` (EnginesView.vue:290-306).

**EnginesView card-layout rewrite:**
- Replaced table with `.engine-cards` grid + per-engine card. Status pill (4 visual states: loaded/loading/installed/not_installed), currently-loaded summary, install progress with indeterminate-shimmer, always-visible model picker with Recommended + ★ Currently loaded chips, footer Install (venv-only) / Unload / Uninstall.
- All `.engine-card__*` scoped CSS landed. Build 725 modules → 3.67s.

**Lexicon auto-attach on Generate:**
- `GenerateView.vue`: `attachedLexicon` ref (L194), watch on `selectedProfile` fetches `/v1/lexicons/{default_lexicon_id}` (L204-214), sends `body.lexicons = [attachedLexicon.value.id]` at render time (L391). Always-visible row with View applied entries modal.

## 2026-06-09 ship list (UX parity sweep)

**Backend:**
- `audio/chunked.py` finally wired into `api/generate_api.py:165-228` — auto-chunking now LIVE on both managed + in-process synth paths. Was lifted in task #53 but dead code until today.
- `api/profiles_api.py` — new module, full CRUD for VoiceProfile + `/compose` stub. List/get/create/update/delete + 501 compose handler.
- `database/models.py` — `personality` + `default_delivery` Text columns added to VoiceProfile (migration in `database/migrations.py:_migrate_voice_profiles_personality`).
- `api/takes_api.py` — added `GET /v1/takes/recent` (history table) + `GET /v1/takes/{id}/lineage` (take chain).
- `api/engines_api.py` — `/v1/engines/capabilities` + `/v1/engines/{id}/capabilities` endpoints from `engines/capability_details.py` (hand-authored, verified from upstream HuggingFace cards).
- `delivery_merge.py` — 3-tier merge (#88): preset > request > profile defaults. `GenerateRequest` gained `profile_id` + `preset_id` fields.
- Models: `KnobSpec`, `InlineTagSet`, `EngineCapabilityDetail`, `EngineCapabilitiesResponse` for capability manifest.

**Frontend:**
- New views: `ProfilesView.vue` (card grid + create/edit modal + test-compose).
- New components: `SlashTagMenu.vue` (engine-aware `/`-key tag picker, ↑↓ Enter Esc nav), `GlobalAudioPlayer.vue` (bottom-anchored player with animated bars + scrub + volume), `LineageViewer.vue` (vertical timeline modal for take chain).
- New store: `stores/audioPlayer.js` (pinia, shared `<audio>` element across views).
- `GenerateView.vue`: capability fetch replaces hardcoded CAPABILITY map; auto-resize textarea (140→360px); Profile + Compose chips; SlashTagMenu wired via `/` keystroke; history table (relative time + ▶ routes to GlobalAudioPlayer).
- `JvTextarea.vue`: opt-in `autosize` prop with min/max heights.
- `SettingsView.vue`: API reference table (#96), MCP install snippets (#92), GPU info card with `/v1/system` fetch (#91), Auto-updater UI hooked to Tauri (#90), Appearance picker writing CSS custom properties (#93).
- `App.vue`: ProfilesView mounted in sidebar between Voices + Personas.

**Memory + global rules:**
- `~/.claude/CLAUDE.md` (global, all-project): Rules #0 (no permission), #1 (verify don't guess), #2 (no subagent delegation), #3 (upstream parity is file-by-file), #4 (web research first for library/model questions). Removed never-commit rule per user.
- `feedback_upstream_audit_hard_rule.md`: project-specific reinforcement (file-by-file verification before parity claims; web research first for upstream library/model questions).
- `reference_engine_capability_surface.md`: per-engine knob + inline-tag surface, verified from upstream HuggingFace cards (Chatterbox-Turbo's `[laugh][cough]` paralinguistic, Qwen3 instruct field, Dia `[S1]/[S2]` + parenthetical paralinguistic, etc.).
- `feedback_static_vs_configurable.md`: don't over-configurize; static where it doesn't vary per deployment.
- `feedback_ultracode_usage_rule.md`: added "audits are NOT mechanical → solo Opus only".

**Closed tasks (2026-06-09):** #85, #86, #87, #88, #89, #90, #91, #92, #93, #94, #96, #98, #99, #100.

---

## BUILD MILESTONE — 2026-06-08 FINAL: JustVoice-native UI + take versioning + Tauri Rust subsystems all landed. vite build clean (676 modules, 39.70 kB CSS / 8.16 kB gzip). cargo check clean on Windows.

---

## Current HEAD

```
16bfacd feat(tauri+ui): take versioning UI + port voicebox Rust subsystems
ae3c0ce refactor(ui): sweep all 18 views to Jv* primitives + jv-* utility classes
35a2cf6 feat(ui): rewrite UI as JustVoice-native — delete JustWrite Jw* / tokens.css
de592a7 feat: JustVoice v1.0 design freeze + Phase 1-5 implementation + atomic license flip
```

Repo: `E:\Dev\Web\justvoice-new\` (GitHub: `delebash/justvoice-new`, branch: `main`)

---

## What is done

### Design system rewrite (commits 35a2cf6 + ae3c0ce)
- Deleted `assets/styles/tokens.css` (2026 LOC, JustWrite-inherited oklch system) and all 7 `Jw*` primitives under `components/ui/`.
- New `assets/styles/justvoice.css` (763 LOC): cream paper + white card + forest green + warm gold + oxblood palette; 8px radius; Inter. Tokens, reset, app shell, full primitive set (`.jv-card`, `.jv-btn`, `.jv-table`, `.jv-pane`, `.jv-floating`, `.jv-banner`, etc.).
- New `components/jv/` with 8 single-responsibility Jv* primitives: `JvButton`, `JvInput`, `JvTextarea`, `JvSelect`, `JvCheckbox`, `JvSegmented`, `JvTag`, `JvField`.
- All 18 views swept to use Jv* primitives and `jv-*` utility classes. Scoped CSS removed from all 18 views (layout rules only where needed).
- CSS bundle: ~74 kB down to 39.70 kB (gzip 8.16 kB).

### DictateWindow (commit 35a2cf6)
- `components/DictateWindow.vue` ported from upstream React to Vue (per-file MIT attribution in header).
- `main.js` routes `?view=dictate` to a standalone mount.
- Listens for `dictate:speak-start` Rust event, opens SSE on `/v1/generate/{id}/status`, plays via `HTMLAudioElement`, emits `dictate:show/hide` for Rust window chrome.

### Take-versioning UI (commit 16bfacd)
- `ChapterView.vue` rewritten: project → scene → block navigation; per-block prev/next take arrows (`← Take 3 of 7 →`); dropdown with timestamps + default marker; JvTag badge on default; source-lineage pill (`← from Take N`); audio player at `/v1/generations/{id}/audio`; action row (Regenerate / Set as default / Compare side-by-side / Delete with two-step confirm).
- New `stores/takes.js` (`useTakesStore`): keyed by `block_id`; `takes` Map, `loaded` Set, `activeTakeIds` Map; methods `fetchTakes / navigatePrev / navigateNext / promoteToDefault / removeTake / relabelTake / invalidate`.
- New `stores/api.js`: `.get / .post / .requestBlob / .postForm` helpers.
- Server: `server/justvoice/api/takes_api.py` — `GET /v1/generations/{id}/audio` serves WAV via `FileResponse`.

### Tauri Rust subsystems (commit 16bfacd)
Ported from voicebox commit `b35b90961d5bc83a8b4e96e8b6ccde2a03152ff9` (MIT) under MIT AND GPL-3.0-or-later. Per-file attribution headers reference `voicebox-pin.txt`.

- `audio_capture/{mod,windows,linux,macos}.rs` — cpal mic; WASAPI loopback (Windows); PulseAudio (Linux); ScreenCaptureKit `#[cfg(target_os="macos")]`. Emits `audio_capture:samples` + `:complete` with WAV path under `${app_data}/captures/{uuid}.wav`.
- `hotkey_monitor.rs` — keytap global push-to-talk + toggle; chord strings parsed to key sets; tokio task; emits `hotkey:push-to-talk-start / -end / :toggle`.
- `synthetic_keys.rs` — paste injection: Win32 `OpenClipboard`/`SendInput` on Windows; `NSPasteboard`/`CGEventPost` on macOS. Linux TODO (X11/Wayland).
- `permissions.rs` — macOS TCC checks (accessibility + input monitoring); non-macOS stubs return `true`.
- `system_audio.rs` — thin wrapper around `audio_capture::is_supported()`.
- `lib.rs` — all 21 stub command bodies replaced with real impls.
- `Cargo.toml` — added cpal, wasapi (Win), screencapturekit + cidre (macOS), keytap, hound, uuid, platform conditionals.

### Earlier phases (all landed, not re-listed in detail)
- Phase 1 docs: CONTRACT.md, NOTICE.md, LICENSES.md, voicebox-pin.txt, PHASE_PLAN.md.
- Phase 1.5: 24-table SQLite ORM (`database/models.py`), SQLAlchemy sessions, `init_db` wired.
- Phase 2: pytest baseline (~15 tests), ACX preset tightened (-20 LUFS / -3.5 dB peak).
- Phase 3: upstream base.py lifted to `engines/_torch_helpers.py`; `chunked_tts.py` → `audio/chunked.py` (each carries per-file MIT attribution + references `voicebox-pin.txt`); `GenerationSettings` added; pedalboard added; **license flip Apache-2.0 → GPL-3.0-or-later** (atomic, across LICENSE + pyproject.toml + SPDX headers).
- Phase 4a: 14 new API endpoints (takes, channels, mcp_bindings, projects, webhooks+HMAC, render_presets, bulk_delete, backup/restore, voice_preview LRU, project_export, SSE streams, active_tasks, capture_readiness). 7 new test files.
- Phase 4b/4c: full 18-tab UI, 80px sidebar, Tauri 21 commands + system tray + keep-alive intercept, sidecar lifecycle.
- Phase 5: all JustWrite-facing HTTP endpoints live (CONTRACT.md surface).
- Plugin engine architecture: each engine is a self-contained folder with `manifest.py` / `engine.py` / per-engine venv. Discovery automatic. Install/load/unload wired through manager. Kokoro verified end-to-end (install → load → synth → 197 KB WAV). Other 7 engines scaffolded.

---

## What is still pending

- **Take regeneration path**: `POST /v1/blocks/{id}/render` does not yet atomically create a Generation + Take. Current Regenerate uses `/v1/render_chapter` (returns blob, no auto-Take). Noted in `ChapterView.vue` TODO.
- **Linux paste injection**: `synthetic_keys.rs` Linux branch is TODO (X11/Wayland).
- **Non-Kokoro engine lifecycle**: chatterbox / TADA / Qwen3 / Dia / LuxTTS should install (recipes verified against engine model cards); MOSS is EXPERIMENTAL (likely needs adapter edits on first install). Higgs was removed 2026-06-09 (non-commercial weight license).
- **Phase 5 engine-flag flips**: blend + train infrastructure is in place; adapters need `supports_embedding_blending=True` / `supports_training=True` + matching methods. Start with Chatterbox.
- **PyInstaller bundling**: production `tauri build` expects `justvoice-server.exe` next to itself; no build script produces it yet. Reference: `E:\Dev\Web\justvoice\sidecars\justvoice-sidecar\build_binary.py`.
- **Signing**: Apple notarization + Linux AppImage signing pending (Windows EV-cert is v1 scope).
- **Live smoke test**: `tauri dev` end-to-end boot + GUI tab round-trips not re-confirmed after 16bfacd. Do this before any further Rust or server work.
- **UE integration**: deferred post-v1 (see memory `project_unreal_deep_dive_deferred`).

---

## Locked decisions

- License: GPL-3.0-or-later (atomic flip in Phase 3, not reversible)
- Storage: SQLite primary; `settings.json` is the only atomic-JSON store
- Stack: Tauri 2 + Vue 3 + Pinia + Python 3.10+ FastAPI + SQLite
- Engines v1: 9 (Kokoro / Chatterbox×2 / Qwen3×2 / LuxTTS / TADA / Dia / MossTTS) + external OpenAI-compatible — Higgs removed 2026-06-09 (non-commercial weight license; commercial-output use cases blocked)
- Design: JustVoice-native (cream/forest-green/gold/oxblood). JustWrite token system gone.
- Multi-use: audiobook + game (Unreal) + podcast + dictation + accessibility, all first-class
- No multi-user accounts (forever out of scope)
- `justvoice-server` script name must not be reverted (spawn-loop prevention)

---

## Memory files — load on demand

| When the task touches… | Load this memory |
|---|---|
| Architecture; tempted to propose Rust / Docker / fork another upstream | `project_final_architecture.md` |
| Boot failure, spawn weirdness, Tauri build errors | `project_gotchas.md` |
| What to do next / priority order | `project_next_steps.md` |
| `/v1/voices/blend` or `/v1/train` or engine blend/train methods | `project_phase5_engine_flips.md` |
| Finding a file path in the repo | `reference_repo_layout.md` |
| Building a new UI component or token | (justvoice.css + `components/jv/` are now the source of truth; legacy `reference_justwrite_components` is stale) |
| Legacy Rust repo reference | `reference_legacy_repo.md` |
| Operator-tunable training settings | `reference_settings_training.md` |
| About to write a question or non-terse closer | `feedback_user_preferences.md` |
| When/how (rarely) to use ultracode — subagents disabled 2026-06-09 | `feedback_ultracode_usage_rule.md` |
| JustWrite↔JustVoice HTTP boundary | `CONTRACT.md` (in-repo) |
| Use-case scope (audiobook / game / podcast / dictation) | `project_use_cases.md` |
| Licensing, SPDX headers, lifted-file attribution | `project_licensing_attribution.md` |

---

## How to run

```powershell
# One-time setup
npm install
cd server; pip install -e .; cd ..

# Dev (Tauri + Vite + Python sidecar)
npm run tauri dev

# Headless Python server only
cd server
justvoice-server serve --port 17494

# Verify server factory
python -c "from justvoice.app import create_app; print(len(create_app().routes))"
```

Use `justvoice-server`, never `justvoice` — the Tauri binary owns that name on Windows.
