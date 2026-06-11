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

---

*Sections 3–9 (database, routes, chunking, effects, lineage, dictation,
personalities), frontend sweep, and the licensing sweep are appended as
those audit modules complete.*

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
