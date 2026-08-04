# Param-honesty audit (Generate + render_chapter) — 2026-06-13

Scope: confirm every UI-sent param reaches a real engine surface, and
every engine surface has a UI control. Continuation of the wiring
audit (2026-06-13-wiring-audit.md) which deliberately left
`/v1/generate` and `/v1/render_chapter` out.

## Server-side accepted shape

`GenerateRequest` (models.py:932):
`voice`, `text`, `language`, `delivery` (Delivery), `seed`,
`lexicons`, `cache_scope`, `cache`, `persona_id`, `preset_id`.

`Delivery` (models.py:921):
`speed`, `emotion`, `pitch`, `pause_before`, `pause_after`,
`gain_db`, `instruct`, `engine` (free-form dict).

`RenderChapterRequest` (models.py:961):
`lines[]`, `scene_id`, `preset_id`, `between_lines.silence_ms`,
`master`, `title`, `author`, `book`, `cache_scope`, `lexicons[]`.

Pydantic config: no `extra="allow"`. Default behaviour drops unknown
fields silently. The engines receive `req.delivery.model_dump(
exclude_none=True)` — anything not in the model is invisible to the
engines.

## Findings

### DEAD KNOBS in GenerateView

UI renders the control, user can interact, value goes into
`buildDelivery()` at the wrong path, Pydantic discards it, no engine
ever sees it.

1. **Temperature slider** (`GenerateView.vue:378`).
   UI sends `delivery.temperature`. `Delivery` model has no
   `temperature` field. Dropped. Chatterbox at `engine.py:174` reads
   `engine_overrides.get("temperature", 0.8)`. UI never populates
   `delivery.engine.temperature` either — `temperature` and
   `talker_temperature` are in `PRIMARY_KNOB_KEYS` (line 168) which
   are excluded from `manifestedKnobs` (line 173) precisely so the
   primary slider handles them. The slider just doesn't.

2. **Style-prompt textarea** (`GenerateView.vue:381`).
   UI sends `delivery.style_prompt`. No `style_prompt` field on
   `Delivery`. Dropped. Qwen3 capability detail declares
   `supports_style_prompt=True` (`capability_details.py:179`), but
   the Qwen3 adapter doesn't read it from anywhere — see
   `qwen3/engine.py:146-177`, the only thing the adapter pulls from
   delivery is `instruct`.

3. **Seed input** (`GenerateView.vue:379`).
   UI sends `delivery.seed`. The `Delivery` model has no `seed`;
   the GenerateRequest model has `seed` at the top level (line 937).
   Server reads `req.seed`, which is undefined because the UI puts
   it elsewhere.

### Qwen3 dead knobs server-side (deeper than wire path)

Qwen3's capability surface (`capability_details.py:172-200`) declares
knobs the adapter doesn't pass through:

- `talker_temperature` (default 0.9) — adapter calls
  `model.generate_custom_voice(text, speaker, language, instruct)`
  with NO temperature.
- `talker_top_k`, `talker_top_p` — same. Not passed.
- `style_prompt` (via `supports_style_prompt=True`) — adapter only
  reads `instruct`.

Fixing the UI wire path alone makes Chatterbox's temperature live but
does NOT make Qwen3's temperature live — the adapter has to be
updated to pass `talker_temperature` to the model, and upstream
`qwen-tts.generate_custom_voice` has to actually accept it. NEEDS
UPSTREAM VERIFICATION before adapter changes (hard rule:
`feedback_upstream_audit_hard_rule`).

### ChapterView regen — fidelity bug

`ChapterView.vue:310` regen sends:

```js
{ lines: [{ voice, text: block.text }], between_lines: { silence_ms: 0 } }
```

Missing: `preset_id`, `lexicons`. The user expects regen to produce
a take that matches the rest of the chapter; the implementation
silently diverges (no preset, no lexicons). User decision (2026-06-13):
fix the REQUEST to inherit project's `preset_id` + `lexicons`. Do
NOT add per-block UI controls for mastering / preset / lexicon /
delivery / seed — they're project-scope concepts and per-block
overrides would silently break consistency.

### ChapterView regen — no UI controls panel (user decision)

Considered and rejected:

| Control | Verdict | Why |
|---|---|---|
| Mastering preset | Skip | Chapter-level concept; per-block overridden on rejoin. |
| Render preset | Skip | Project-scope. Divergence breaks consistency. |
| Lexicons | Skip | Project pronunciation contract; per-block override hides the real fix. |
| Per-block delivery | Skip | Persistent persona or block delivery is the right home. |
| Seed | Skip | Each click is already a new RNG roll. Exposing seed turns regen into Generate-lite. |
| Voice picker | Already there | Inline prompt at `ChapterView.vue:283` for uncast lines. |

## Queue (ALL SHIPPED)

A. **ChapterView regen** ✅ — request inherits `default_lexicon_id`
   from the active project. `preset_id` deliberately NOT inherited:
   project.metadata.render_preset is a UI enum (`default` /
   `quick_draft` / `final_ship`) and not a `render_presets.id`, and
   the last-used preset isn't persisted on block or scene. If
   preset inheritance becomes a need, plumb it from the block's
   most recent `Generation.preset_id` (TakeResponse currently only
   exposes `generation_id` — server-side join needed).
B. **Server `Delivery` model** ✅ — added `temperature`, `seed`,
   `style_prompt`. Pydantic preserves what UI sends.
C. **`generate_api.py`** ✅ — `delivery.seed` overrides `req.seed`
   in the effective-seed resolution. Per-chunk math unchanged.
D. **Chatterbox adapter** ✅ — reads `delivery.temperature` first
   (UI primary), falls back to `delivery.engine.temperature`.
   Both turbo + multilingual + base paths covered.
E. **Qwen3 adapter — style_prompt** ✅ — merged with `instruct`
   into a single natural-language directive ("style. instruct").
F. **Qwen3 adapter — talker_temperature** ✅ — **verified upstream**
   via Context7/WebFetch: `generate_custom_voice` /
   `generate_voice_clone` forward HuggingFace `model.generate`
   kwargs (`temperature`, `top_k`, `top_p`). Adapter now maps:
   - `delivery.temperature` → HF `temperature` (primary slider)
   - `delivery.engine.talker_temperature` → HF `temperature` (fallback)
   - `delivery.engine.talker_top_k` → HF `top_k`
   - `delivery.engine.talker_top_p` → HF `top_p`

Not in this queue (RenderLab + scene-mode render_chapter still
unaudited). Worth a follow-up pass once the Generate-side dead knobs
are healed.
