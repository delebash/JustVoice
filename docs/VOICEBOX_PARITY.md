# Voicebox parity audit

Audit of JustVoice against upstream voicebox at the pinned commit
`b35b909` (see `voicebox-pin.txt`; local clone verified at exactly that
SHA — same code as the v0.5.0 desktop build). Method per
`feedback_upstream_audit_hard_rule`: every row verified by reading both
sides' source and (where marked *live*) by running the endpoint/UI. No
row is based on recall or summaries.

Classifications:

- **ported+wired** — works through JustVoice's API/UI (route/view cited)
- **lifted-not-wired** — code existed but nothing called it ⛔
- **diverged** — ported then changed deliberately (rationale noted)
- **dropped-on-purpose** — not carried over, with rationale
- **missing** — upstream has it, we don't (gap list)

Date: 2026-06-11. Sections are appended as audit modules complete.

---

## 1. `backends/` → `server/justvoice/engines/`

Upstream runs every engine **in-process** behind per-engine backend
classes; JustVoice runs engines as **venv-isolated subprocesses** behind
`manifest.py` + `engine.py` pairs (deliberate architectural divergence —
install Chatterbox without breaking Kokoro).

| Upstream backend | JustVoice counterpart | Class | Notes |
|---|---|---|---|
| `chatterbox_backend.py` (mtl_tts @ ResembleAI/chatterbox) | `engines/chatterbox/` | **diverged** (subprocess) | Multilingual class + repo verified identical. |
| `chatterbox_turbo_backend.py` (tts_turbo @ ResembleAI/chatterbox-turbo) | chatterbox variant `chatterbox-turbo-v1` | **was lifted-not-wired → FIXED** | See finding F2. |
| `qwen_custom_voice_backend.py` (12Hz-{1.7B,0.6B}-CustomVoice) | `engines/qwen3/` variants `qwen3-cv-*` | **was partial → FIXED** | 0.6B was listed but unloadable; see F2. |
| `pytorch_backend.py` Qwen Base (12Hz-{1.7B,0.6B}-Base) | `engines/qwen3/` variants `qwen3-base-*` | **was missing → ADDED** | Clone-only; drops `instruct` (upstream behavior). |
| `kokoro_backend.py` (hexgrad/Kokoro-82M via PyTorch) | `engines/kokoro/` (sherpa-onnx) | **diverged** | Same model family, ONNX runtime instead of PyTorch — CPU-realtime on purpose. |
| `luxtts_backend.py` (YatharthS/LuxTTS) | `engines/luxtts/` | **diverged** (subprocess) | Same repo. |
| `hume_backend.py` (TADA 1B / 3B-ml) | `engines/tada/` | **diverged** | We ship 3B-ml + codec; 1B not listed — acceptable (3B covers it; add on demand). |
| `mlx_backend.py` (Apple Silicon MLX) | — | **dropped-on-purpose** | We are PyTorch + sherpa-onnx; macOS runs CPU/MPS paths. Revisit if Mac perf complaints arrive. |
| `qwen_llm_backend.py` (Qwen3 LLM 0.6B/1.7B/4B) | — | **missing** | Bundled local LLM gap — see §9 / gap list G1. |
| Whisper STT (mlx/pytorch backends + `services/transcribe.py`) | readiness probe only | **missing** | Gap G2. |
| — | `engines/dia/`, `engines/moss_tts/` | JustVoice additions | Dia 1.6B + MOSS-TTSD; no upstream counterpart. |
| — | `engines/tts_providers/` (ElevenLabs, Speechify, Speechmatics), `external_openai.py` | JustVoice additions | Online/self-hosted providers — upstream has no cloud TTS. |

**Finding F1 — multi-model loading (user question, verified live in
screenshots + source).** Upstream allows multiple TTS models resident at
once (`backends/__init__.py` keeps a per-engine instance dict; nothing
auto-evicts; unload is manual `POST /models/{name}/unload`). VRAM stacks
additively. JustVoice's `EngineManager` uses per-KIND slots (tts / llm /
embedding): a new TTS evicts the prior TTS, while an LLM stays resident
(speaker attribution needs both). **diverged-on-purpose** — safer for
3–8 GB models on 8 GB cards. If "Kokoro for previews + big model for
finals" becomes a real workflow, add an opt-in multi-load setting with a
VRAM warning (Next horizons).

**Finding F2 — the variant dropdown was cosmetic ⛔ (fixed 2026-06-11).**
Every `engine.py` `load()` accepted `variant` and ignored it: picking
"Chatterbox Turbo" loaded Multilingual; "Qwen3 0.6B" loaded 1.7B. The
catalog also pointed at placeholder repos (`Qwen/Qwen3-TTS-1.7B`,
`ResembleAI/chatterbox-multilingual` — the latter likely nonexistent) and
listed an unverifiable "Chatterbox Original (English)" variant. Fixed:
chatterbox + qwen3 now branch on the variant id with repos/classes
verified from upstream's backends; catalog rewritten to the four real
Qwen checkpoints + two real Chatterbox checkpoints;
`tests/test_variant_wiring.py` pins catalog ids ↔ engine maps.
(Model-load paths remain machine-verifiable only with GPUs/models — the
container test covers the wiring contract.)

## 2. `mcp_server/` → `server/justvoice/mcp/` (NEW)

**Was the prime lifted-not-wired find ⛔ (fixed 2026-06-11).** JustVoice
had the `mcp_bindings` table + CRUD API (`/v1/mcp/bindings`) but no MCP
server — nothing ever read a binding. Upstream ships a full FastMCP
server. Ported with attribution headers, adapted:

| Upstream | JustVoice | Status |
|---|---|---|
| `server.py` — FastMCP at /mcp, Streamable HTTP | `mcp/server.py` (+ bare-`/mcp` shim; Starlette Mount never matches the exact path) | **ported+wired** (live: handshake + tool calls verified on both `/mcp` and `/mcp/`) |
| `context.py` — X-Voicebox-Client-Id middleware, ContextVars, loopback gate, last-seen stamping | `mcp/context.py` — `X-JustVoice-Client-Id` | **ported+wired** (live: probe call created the binding row w/ `last_seen_at`) |
| `resolve.py` — explicit arg → binding → global default | `mcp/resolve.py` — voice → persona → binding persona → `settings.mcp.default_voice` (new knob) | **ported+wired** (`tests/test_mcp_server.py::test_resolve_precedence`) |
| `tools.py` — voicebox.speak/transcribe/list_captures/list_profiles | `justvoice.speak` / `list_voices` / `list_personas` | **ported+wired** (live: list_voices returns the same 64 voices as `/v1/voices`) |
| voicebox.transcribe | — | **missing** until G2 (Whisper engine) lands; add with it |
| `events.py` — speak-pill SSE for DictateWindow | — | **deferred** with desktop dictation work |
| stdio shim binary (`voicebox-mcp.exe`) | — | **missing** — packaging concern; Next horizons (Ship-it) |
| `POST /speak` REST mirror (ACP/A2A callers) | `/v1/generate` exists; no binding-aware mirror | **partial** — gap G4 (small) |

Speak diverges deliberately: voicebox plays on the user's speakers;
headless JustVoice persists a `Generation` (source=`mcp`) and returns
`/v1/generations/{id}/audio`.

**Finding F3 — persona split-brain hit MCP bindings ⛔ (fixed).** A
persona created via `POST /v1/personas` existed only in the file store,
so binding it (`mcp_bindings.persona_id` FK → SQLite `personas`) failed
with an IntegrityError. `PersonaStore` now mirrors create/update/delete
into SQLite (`storage/personas.py::_mirror_to_db`).

## 3. `database/` → `server/justvoice/database/`

| Upstream table | JustVoice | Status |
|---|---|---|
| `profiles` + `profile_samples` | `personas` (+ voices file store) | **diverged** — Profile-kill rollout; persona is the sole identity layer. |
| `generations`, `generation_versions` | same names | **diverged** — we add per-block `takes` (re-roll paragraph 47 without invalidating 48); upstream versions whole generations. |
| `stories`, `story_items` | same names | **ported** (multi-track additions ours). |
| `projects` | `projects` + `scenes`/`blocks`/`project_personas` | **diverged** — ours carries the import/production model. |
| `audio_channels` + 2 mapping tables | `channels` + `persona_channels` | **diverged** (persona-keyed). |
| `capture_settings` (singleton: stt model, refinement toggles, chords, auto-paste, default playback voice) | — | **missing** — lands with dictation/STT work (as a `settings.json` section per our no-DB-singletons rule), G2. |
| `generation_settings` (singleton) | `settings.json` `generation` section | **diverged-on-purpose**; all four knobs present (max_chunk_chars / crossfade_ms / normalize_audio / autoplay_on_generate). |
| `mcp_client_bindings` | `mcp_bindings` | **ported+wired** (see §2). |
| `seed.py` (builtin effect presets + version backfill) | was missing | **FIXED** — see F5. |
| `migrations.py` (inspector-based add-column) | same pattern | **ported**. |
| — | webhooks, render_presets/jobs, speaker_corrections, training_jobs, lexicons | JustVoice additions. |

## 6. Effects → `audio/effects.py` + presets

Upstream effect registry: chorus, reverb, delay, compressor, gain,
highpass, lowpass, pitch_shift (8 types). Ours covers all of them after
F4, plus additions (distortion, eq_low/eq_mid/eq_high shelf/peak filters).

**Finding F4 — `chorus` missing + `enabled` flag ignored ⛔ (fixed).**
`_build_plugins` had no chorus branch — the Robotic preset would have
silently become a no-op chain — and entries with `enabled: false` were
still applied (upstream skips them; the chain editor toggles effects
without removing them). Both fixed; `tests/test_seed_effect_presets.py::
test_disabled_effects_are_skipped` pins the contract.

**Finding F5 — built-in presets never seeded ⛔ (fixed).** The
`EffectPreset` model + API shipped `is_builtin` guards from day one but
nothing inserted the rows — `/v1/effect-presets` returned `[]` (verified
live). Ported upstream's `BUILTIN_PRESETS` data into
`database/seed.py` (attribution header), called idempotently from
`create_app`. Live-verified: Robotic / Radio / Echo Chamber / Deep Voice
now served.

## 4. Routes (`app.py` route surface)

Route-by-route disposition (upstream route → ours): `/generate` →
`/v1/generate` (**ported+diverged** — chunked, cache, lexicons);
`/health` → `/v1/health`; `/profiles*` → `/v1/voices` + `/v1/personas`
(Profile-kill); `/history` → `/v1/takes/recent`; `/models*` →
`/v1/engines` + `/v1/engines/{id}/models`; `/effects*` →
`/v1/effect-presets` + apply-as-version; `/stories*` → `/v1/stories*`;
`/channels*` → `/v1/channels*`; `/settings` → `/v1/settings`;
`/captures*` + `/transcribe` → **ADDED 2026-06-11** (was missing — see
§8); `/llm/generate` → provider dispatch (no raw passthrough endpoint —
dropped-on-purpose: features go through pins); `/speak` → gap G4;
`/cuda` (GPU info) → `/v1/system` (**diverged**; GPU detail is thinner —
noted for the Engines "This machine" card); `/events/*` SSE →
`/v1/streams/*` (**diverged**); `/tasks` → `/v1/active-tasks`.

## 5. Auto-chunking + crossfade

**ported+wired, re-verified.** `audio/chunked.py` (attributed lift) is
imported and exercised by BOTH paths: `api/generate_api.py` (managed +
in-process branches) and `render_core.render_line` (chapter/production
renders). Knobs live in `settings.generation` (all four upstream knobs
present). `tests/test_chunked.py` covers the splitter.

## 7. Version lineage

Upstream: `GenerationVersion` chain with `source_version_id`, default
flag, favorites on the History surface. Ours: per-block `Take` chain
(`source_take_id`) + `GET /v1/takes/{id}/lineage` + LineageViewer
(mounted this session), `GenerationVersion` kept for one-off Generate
work. **diverged** (per-block versioning is deliberately finer-grained).
**Finding F6 ⛔ (fixed):** `Generation.is_favorited` was serialized but
had no write path, and the History table's ★/↻/✕ buttons had no
handlers. Wired: `PATCH /v1/generations/{id}/favorite`,
`DELETE /v1/generations/{id}`, UI handlers + tooltips
(`tests/test_generation_history_actions.py`).

## 8. Dictation / captures (gaps G1+G2 — server side CLOSED 2026-06-11)

Upstream backend pieces and their new JustVoice counterparts:

| Upstream | JustVoice | Status |
|---|---|---|
| Whisper STT backends (5 sizes, transformers) | `engines/whisper/` managed engine, KIND="stt" (new slot kind) | **ported** (attributed; recipe identical — 16 kHz, forced-language decoder ids, no_grad) |
| Qwen3 LLM backends (0.6B/1.7B/4B) | `engines/qwen3_llm/` managed engine, KIND="llm" + `local-qwen3` provider adapter | **ported** (chat template, enable_thinking=False, few-shot turns, top_p 0.9) |
| `services/refinement.py` | `justvoice/refinement.py` | **ported verbatim** (prompt corpus + repetition-collapse + example set; LLM call goes through provider dispatch, feature="refine") |
| `routes/captures.py` + `routes/transcription.py` | `api/captures_api.py` — /v1/transcribe + /v1/captures CRUD/refine/retranscribe | **ported** (the `captures` DB table existed with NO api — schema-without-API, same failure family) |
| `capture_settings` singleton | `settings.captures` section (stt_model, language, auto_refine, llm_model, 3 refinement toggles, allow_auto_paste, default_playback_voice, hotkey_enabled, chord lists) | **ported** as settings.json section |
| voicebox.transcribe MCP tool | `justvoice.transcribe` (base64 or loopback-only absolute path, 200 MB cap) | **ported** |
| Global hotkey / chord capture / auto-paste / DictateWindow | Tauri-side stubs | **deferred** — desktop work; server contract now exists for it |

Engines UI gains an STT tab; shim gains `/chat` + `/transcribe` routes;
manager gains chat()/transcribe() slot passthroughs. Model loads remain
machine-verifiable only with GPU+models — wiring covered by
`tests/test_captures.py` (fake STT) + `tests/test_variant_wiring.py`.

## 9. Personalities (Compose / Rewrite / "Respond")

Upstream at the pin ships ONLY `/profiles/{id}/compose`; rewrite happens
implicitly inside `/generate` when `personality=true`; **"Respond" from
the README has no code path** (their own comment: "there is no
standalone rewrite/respond/speak endpoint"). Ours: explicit
`/v1/personas/{id}/compose` + `/v1/personas/{id}/rewrite`
(preview-then-accept; never a render-time hook — locked decision #3).
**diverged-on-purpose, surface exceeds upstream.** With the bundled LLM
landed, both now work with zero external setup once qwen3-llm is
installed.

## Frontend sweep (upstream `app/src/components/` vs our views)

Tab-level coverage: VoicesTab→Voices · CapturesTab→Captures ·
EffectsTab→Effects · ModelsTab→Engines · StoriesTab→Stories ·
AudioStudio/AudioTab→Audio Tools · MainEditor+Generation→Generate ·
History→Generate History table · ServerTab→Settings sub-tabs (all 8
upstream sub-tabs have JustVoice counterparts incl. Logs/Changelog/About).
Desktop-only pieces (AccessibilityGate, InputMonitoringGate, TitleBar)
defer with the Tauri work. **Findings from the sweep:** the Settings →
MCP panel was mock-grade (fake toggles, wrong snippets, dead bindings
table) — rebuilt against the real server; **F7** — Overview's Recent
generations fetched a NONEXISTENT `/v1/generations/recent` (table
permanently empty, three dead action buttons) — now reads
`/v1/takes/recent` with play/favorite/re-render wired.

## Licensing sweep

`voicebox-pin.txt` references grew from **4 → 21 files** this pass.
Newly attributed: the MCP package (4 files), refinement.py,
captures_api.py, seed.py, whisper + qwen3_llm engines, and adapted-from
headers on database/models.py, chatterbox/engine.py, qwen3/engine.py.
Independent-implementation files (mastering, analyzer, render_core,
imports/, extraction/) verified as not lifted — no header needed beyond
SPDX.

## Gap list (ranked by user value)

- **G1 — bundled local LLM (Qwen3 0.6B/1.7B/4B).** Powers dictation
  refinement + Compose/Rewrite/Respond with zero setup. Port
  `services/refinement.py` (repetition-collapse pre-pass, toggle-built
  prompts, few-shot chat turns) — self-contained, high value.
- **G2 — bundled Whisper STT** (5 sizes) + `/v1/transcribe` +
  `justvoice.transcribe` MCP tool. Server-side; not desktop-dependent.
- **G3 — TADA 1B variant** (small; add catalog row when wanted).
- **G4 — binding-aware `POST /speak` REST mirror** for non-MCP agents.
- **G5 — MLX backends** — dropped-on-purpose; revisit on Mac demand.
