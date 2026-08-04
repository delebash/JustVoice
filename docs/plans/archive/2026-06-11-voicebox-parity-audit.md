# Plan: Voicebox parity audit — verify JustVoice vs upstream, file-by-file

## ADDENDUM (user request 2026-06-11): plan docs go in the repo

Plan-mode files live in the ephemeral container (`/root/.claude/plans/`)
and die with it. The user wants plan docs persisted in the repo for all
future sessions. Tasks:

1. Create `docs/plans/` in the JustVoice repo and save THIS plan file
   there as `docs/plans/2026-06-11-voicebox-parity-audit.md` (verbatim,
   including the verified findings and user decisions recorded in it).
2. Add a standing rule to `CLAUDE.md` (session-start/workflow section):
   when a plan is approved, copy the plan file into
   `docs/plans/<date>-<slug>.md` in the same commit series that executes
   it, and update it if the plan is amended mid-execution. Plans are
   project history, not container scratch.
3. Commit + push both.

## Context

JustVoice lifted/ported code from voicebox (pinned at `b35b909`, MIT — see
`voicebox-pin.txt`; the clone at `/home/user/voicebox` is at exactly that
SHA). The project's hard rule (`feedback_upstream_audit_hard_rule`) exists
because **lifted-but-not-wired is the recurring failure mode** (auto-chunking
sat unimported for weeks; this session found five more: dead ImportModal
methods, unmounted LineageViewer, invisible welcome modal, etc.). The user
wants a deliberate, file-by-file verification of what we have vs voicebox —
not from memory or summaries. Suspicion to start from: only **4** JustVoice
files reference the pin, yet far more was adapted (storage, DB session,
takes). Either little was lifted or attribution is under-applied — find out
which.

Also requested: preserve the follow-on recommendations raised in this
dialog + the last (JustWrite round-trip · Unreal .uplugin · Ship-it
packaging · idea-pass leftovers) as a recorded "Next horizons" list.

## Verified findings from the user's screenshots (read-only, done)

User supplied Voicebox v0.5.0 screenshots — same version as our pin
(`b35b909`, app/package.json `0.5.0`, last commit 2026-04-26), so the
screenshots ARE the pinned code; no upstream drift to chase. Verified in
source, answering the user's direct questions:

1. **Multi-model loading**: Voicebox DOES allow multiple TTS models loaded
   simultaneously — `backends/__init__.py` keeps a per-engine instance dict
   (`_tts_backends`); loading engine B never unloads engine A; unload is
   manual per model (`POST /models/{name}/unload`). VRAM stacks additively;
   it's tolerable upstream because several engines are tiny (Kokoro 82M,
   LuxTTS ~300MB). Opus 4.7's single-TTS-slot recommendation is what our
   `EngineManager` implements (per-KIND slots: tts/llm/embedding — new TTS
   evicts old TTS, LLM stays resident for attribution). Classify as
   **diverged-on-purpose**; document the rationale in VOICEBOX_PARITY.md and
   surface "Loaded" state honestly in the Engines UI.
2. **Bundled LLM**: Qwen3 **0.6B/1.7B/4B** (`qwen_llm_backend.py`, MLX 4-bit
   on Apple Silicon / PyTorch elsewhere). Used by `services/refinement.py`
   (dictation transcript cleanup: smart-cleanup / self-correction /
   preserve-technical toggles + few-shot chat-turn examples + deterministic
   repetition-collapse pre-pass) and `services/personality.py`
   (Compose/Rewrite/Respond). **JustVoice has NO bundled local LLM** — our
   `engines/llm/` is external providers only (ollama/openai-compat/
   anthropic/gemini). GAP.
3. **Bundled STT**: Whisper base/small/medium/large-v3/turbo via MLX/PyTorch
   backends + `services/transcribe.py`. JustVoice only has the readiness
   probe (`capture_readiness_api.py` checks HF cache) — **no transcribe
   engine/endpoint**. GAP (part of deferred dictation, but the engine
   catalog entry + /transcribe endpoint are not desktop-dependent).
4. **TTS model-set check**: upstream ships Qwen-TTS **Base** 1.7B/0.6B AND
   CustomVoice 1.7B/0.6B; our `qwen3` manifest shows only CustomVoice.
   Upstream ships **chatterbox_turbo** as its own backend; our chatterbox
   manifest references only `ResembleAI/chatterbox`. Audit both: add the
   missing variants or record dropped-on-purpose. MLX backends = expected
   dropped-on-purpose (we're PyTorch + sherpa-onnx); record it.
5. **MCP surface** (screenshots + `mcp_server/`): tools `voicebox.speak`,
   `voicebox.transcribe`, `voicebox.list_captures`, `voicebox.list_profiles`;
   HTTP transport at `/mcp` with `X-Voicebox-Client-Id` header, stdio shim
   binary fallback, per-AGENT voice bindings UI (client-id → voice), default
   playback voice, plus plain `POST /speak` (also ACP/A2A). This is the
   checklist-item-2 yardstick for our `mcp_bindings_api`.
6. **Settings/UI surfaces in screenshots to sweep against ours**: GPU tab
   (auto-detected device + VRAM + Active badge, CUDA/MLX/ROCm/XPU/DirectML/
   CPU-fallback copy), model detail modal (HF repo link, downloads/likes/
   license, on-disk size, Unload + Delete), download-progress toasts +
   inline row progress ("Connecting to HuggingFace…"), Logs/Changelog/About
   tabs, storage-location Open/Change, "keep server running when app
   closes", "allow network access" toggle.

## UI/UX items the user requested this pass (fold into fix commits)

- **EnginesView: description text renders vertically** (one word per line —
  narrow flex/grid track). Fix to normal horizontal paragraphs.
- **Tooltip sweep**: tooltips were added as-we-went on main views (Voices 15,
  SpeakerLab 16, Studio 13, Books 12, Settings 8…) but 28 files have ZERO
  `title=` (CapturesView, CompareView, RenderLabView, TrainView, EffectsView,
  OverviewView, ImportModal + most shared components/modals). Dedicated
  sweep: every icon-only button and non-obvious control gets a title.
- **Menu (sidebar) status**: 4-lane sidebar + per-use-case `visibleFor`
  shipped in App.vue — verified live; the user's install shows ALL tabs
  because their `primary_use_case` is "unset" ("Choose later" on the welcome
  modal), and unset deliberately shows everything. **Gap found**: the welcome
  modal shows once and Settings has NO control to pick/change the use case
  later — add a "Primary use case" picker to Settings → General that live
  re-filters the sidebar (writes the same `primary_use_case` app setting).
  The per-PROJECT-TYPE vocabulary (Chapters vs Episodes vs Quests when a
  project is open) stays Phase 4 design-pass work; record in Next horizons.
  [USER CONFIRMED 2026-06-11: keep per-project-type vocabulary in Phase 4,
  landing with the visual-design pass — do not pull it forward.]

## New gap work items (from this review — add to deliverable #2 scope)

- **Bundled local Whisper STT engine** (catalog entries base→turbo +
  `/v1/transcribe`; server-side, not desktop-dependent) — parity with
  upstream `services/transcribe.py`.
- **Bundled local Qwen3 LLM engine** (0.6B/1.7B/4B via transformers) as a
  first-class provider next to ollama/openai-compat — powers dictation
  refinement + personality features without external setup. Port
  `services/refinement.py` (repetition-collapse pre-pass + toggle-built
  prompt + few-shot chat turns) — it's self-contained and high-value.
- **Qwen-TTS Base 1.7B/0.6B variants + Chatterbox Turbo** — add to our
  manifests or record dropped-on-purpose after the adapter audit.

## Method (all inline — subagents disabled by user)

Audit unit = one upstream module/dir. For each, read the upstream source,
locate the JustVoice counterpart, and classify into exactly one of:

- **ported+wired** — feature works through JustVoice's API/UI (cite the route/view)
- **lifted-not-wired** — code exists but nothing calls it ⛔ (fix or file)
- **diverged** — ported then changed; note whether divergence is intentional
- **dropped-on-purpose** — with the rationale (one line)
- **missing** — upstream has it, we don't; goes to the gap list

Verification is by reading + running, never recall: grep the JustVoice call
sites, hit the endpoint/UI live (server + Playwright rig from `scripts/e2e.mjs`
patterns), run the relevant pytest file.

## Audit checklist (upstream → expected counterpart)

Backend (`/home/user/voicebox/backend/`):
1. `backends/` (11 engine files incl. **hume**, **mlx**, **pytorch**,
   `qwen_custom_voice`, `qwen_llm`) → `server/justvoice/engines/` manifests +
   manager. Known set mismatch: JustVoice has dia/moss-tts/tada; check which
   upstream backends were dropped vs missed (esp. MLX/Metal for macOS).
2. `mcp_server/` (server/tools/events/resolve/context) → JustVoice's
   `mcp_bindings_api` — **prime lifted-not-wired suspect**: does
   `voicebox.speak`-equivalent actually serve an MCP session?
3. `database/` (models/migrations/seed/session) → `server/justvoice/database/`
   — known adapted; diff for schema drift + migrations upstream added after
   the lift that we may want.
4. `models.py`, `config.py`, `app.py` routes → `models.py`/`settings`/api
   routers — route-by-route parity table.
5. Auto-chunking + crossfade → `audio/chunked.py` (wired into render_core —
   re-verify the wiring holds end-to-end).
6. Effects (pitch/reverb/delay/chorus/compression/filters) →
   `audio/effects.py` + effect presets — verify EVERY upstream effect type
   exists and applies (EffectsChainEditorModal had disabled buttons).
7. Version lineage (Original/Effects/Takes/source tracking/favorites) →
   takes + GenerationVersion + LineageViewer (just mounted this session —
   verify against upstream behavior).
8. Dictation (`app` + backend capture: chord bindings, push-to-talk→toggle
   upgrade, macOS paste injection, Whisper STT) → CapturesView/DictateWindow/
   ChordPicker + stubbed Tauri hotkey — classify the gap precisely (most of
   this is the deferred desktop work; the audit names exactly what upstream
   ships that we stubbed).
9. Personalities / Compose / Rewrite / Respond + bundled-LLM modes →
   personas.personality + compose/persona_rewrite feature pins — is
   "Respond" missing entirely?

Frontend (`/home/user/voicebox/app/src/`): view-by-view sweep vs
`src/renderer/src/views/` — flag upstream UX we silently lack.

Licensing sweep: for every file classified ported/lifted/diverged, confirm
the MIT attribution block referencing the pin SHA exists
(`project_licensing_attribution` templates). Fix headers in the same pass.

## Deliverables

1. `docs/VOICEBOX_PARITY.md` — the classified matrix (one row per module),
   findings list, and the gap list ranked by user value. Every claim cites
   file paths on both sides.
2. Immediate fixes for anything classified **lifted-not-wired** (same
   treatment as this session's finds: wire it or delete it, with tests).
3. Attribution headers added where the sweep finds lifted code without them.
4. `docs/IMPLEMENTATION_PLAN.md` gains a **"Next horizons"** section
   recording the kept recommendations: JustWrite↔JustVoice round-trip
   (CONTRACT.md live), Unreal .uplugin (manifest→SoundWaves→MetaHumanSDK,
   CONCEPTS §15), packaging/Ship-it (installers, model-download UX), plus
   the deferred idea-pass items (captions, Wwise, proof-listen QC,
   timeline ducking, Ollama in-app pull, Edit-voice modal).

## Verification

- Each "ported+wired" row demonstrated live (endpoint curl or Playwright
  click) or by the named passing test — no row ships on recall.
- ruff + pytest green after every fix commit; `node scripts/e2e.mjs` green
  at the end.
- Commits per module group, pushed to `claude/nice-franklin-dzisd5`.
