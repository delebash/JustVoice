# Generate

The **Generate** tab renders one line of text to audio. Pick a voice, type the line, optionally apply delivery overlays, click ▶. The server returns audio bytes you can replay, favorite, or download.

This is JustVoice's primary single-line interface — for batch chapter-style rendering, see [chapter.md](take-versioning.md).

## When to use Generate

- **Dictation users** — quick line synthesis, paste, send. Use the [MCP server](mcp-server.md) for agent-driven workflows.
- **Game devs** — render NPC dialogue lines one at a time during iteration. Use [chapter.md](take-versioning.md) for bulk export.
- **Audiobook producers** — preview how a character sounds before committing to a full chapter render. Settings here flow into the chapter pipeline when you bind a [persona](personas.md) to a [profile](profiles.md).
- **Podcasters** — record a one-off intro / outro / ad-read. Drag the result onto the [stories.md](stories.md) timeline to assemble.

## The floating chip bar

Below the textarea is a row of chip cards. Each chip selects one input:

| Chip | What it does |
|---|---|
| 🎙️ Voice | Pick from the currently-loaded engine's voices. Disabled when no engine is loaded — see the "No engine loaded" banner. |
| 🧠 Engine | Shows which TTS engine is loaded. Switch via [engines.md](engines.md). |
| 🗣️ Lang | Language hint for engines that support per-call language switching (Chatterbox-Multilingual, Qwen3). |
| 👤 Profile | Pick a [voice profile](profiles.md) — wraps voice + delivery defaults + effects + personality. |
| 🎛️ Effects | Apply a saved effects chain to the output. |
| 🎭 Persona rewrite | Re-rolls input through the selected profile's personality prompt via LLM before TTS. Always visible; disabled (with tooltip) when no profile or no personality is set. |
| 🔁 Autoplay | Auto-play the result on render. |

The three action buttons at the right end:
- **🎲 Compose** — asks the LLM to write a fresh in-character line into the textarea, using the selected profile's `personality` prompt. Always visible; **disabled** when no profile is selected or the selected profile has no personality prompt (tooltip explains why). Requires an LLM service configured in Settings → External.
- **▶ Generate** — renders the textarea content. Disabled until a voice is picked.
- **⏹ Stop** — cancels a queued/running render. Always visible; disabled when nothing is in flight.

## Capability banner

Below the chip bar is a banner showing what the currently-loaded engine actually accepts:

- ✓ pitch ±N st (native) — engine accepts pitch shift directly
- ✓ temperature — sampling-variance knob is real
- ✓ seed — deterministic generation supported
- ✓ N emotion tags — the engine has a declared emotion taxonomy in its capability manifest
- ✓ free-form delivery — accepts the Delivery direction textarea (Qwen3 / LuxTTS only)
- ✓ cloning — accepts a reference WAV
- ✓ IPA phoneme input — bypass the text parser (Kokoro)

Engines that don't support a feature show **✗** with a note ("use Qwen3 / LuxTTS"). The pills are sourced from `/v1/engines/capabilities` — they reflect what each engine's adapter actually wires, not aspirational claims. The **loaded model's** row wins over the engine's: with Chatterbox Turbo loaded you get Turbo's controls (paralinguistic tags, no exaggeration/CFG sliders), not Multilingual's. See [engines.md](engines.md) for per-engine details.

## Delivery overlay

The card below the banner has paired slider + number inputs. The six **primary controls** are universal across engines:

- **Speed** — 0.5–2.0× pacing multiplier
- **Pitch** — semitones. Native for LuxTTS (T-shift); post-process via pedalboard for others; disabled when no pitch path exists.
- **Gain** — output WAV amplitude in dB
- **Temperature** — sampling variance (engine-specific range)
- **Pause before → after** — silence padding in ms
- **Seed** — `🎲 randomize` button next to it

### Emotion

There's **no dedicated Emotion dropdown** — emotion is inserted inline via the SlashTagMenu like every other inline tag. Type `/` in the main textarea (or click the **🏷️ Insert tag** button below the textarea) and pick from the engine's available tags — whatever the engine declares in its capability manifest.

The capability banner above the Delivery overlay still announces "✓ N emotion tags" for engines that have a taxonomy, so users know they're available. Tags whose manifest entry carries a `placement: start_of_turn` rule get inserted at the start of the line automatically (regardless of cursor position).

### Delivery direction (free-form)

Shown ONLY when the engine accepts a freeform `instruct` field (Qwen3 / LuxTTS). For Chatterbox the field is disabled with a hint to use the Emotion dropdown or inline paralinguistic tags instead. The pill in the label flips between `disabled · requires Qwen3-TTS or LuxTTS` (ghost) and `free-form` (green) based on capability.

### Style prompt (Qwen3-specific)

Optional short tone/style descriptor — e.g. `warm narrative voice, calm tempo`. Shown ONLY when the engine declares `supports_style_prompt: true` in its capability manifest (currently Qwen3 only). Different from Delivery direction: the style prompt sets a consistent voice character; the delivery direction shapes THIS line's delivery.

### Engine-specific knobs

Below the primary controls, the form auto-renders any extra knobs the engine declares in its capability manifest (`server/justvoice/engines/capability_details.py`). For example:

- **Chatterbox / Chatterbox-Turbo** — `exaggeration`, `cfg_weight`, `min_p` (advanced, Chatterbox vanilla only)
- **Qwen3** — advanced: `Top k`, `Top p`, `Repetition penalty`
- **LuxTTS** — native `T-shift` pitch (continuous), `inference_steps`, `guidance_scale`
- **TADA** — `Flow steps`, `Noise temperature`, `Speaker faithfulness`
- **Dia / MOSS** — per-engine sampler knobs

Each knob renders as a paired slider + number input, just like the primary controls. Non-advanced knobs appear in the main grid; advanced knobs live behind a collapsible `⚙ Show advanced knobs (N)` details block. Values only ship to the API when they differ from the engine's default — no payload noise.

This replaces the old "Raw engine knobs (JSON)" textarea. The manifest is the source of truth: add a `KnobSpec` to an engine's `capability_details.py` entry and the UI picks it up automatically.

## Lexicon preview

Below the engine-specific knobs there's a one-line row showing which pronunciation lexicon (if any) is attached to the current render:

> `Lexicon preview applies before TTS: [no lexicon attached pill] · 0 word replacements would apply · [View applied entries]`

The row is always visible — it has two states:

- **No lexicon attached** (default): the pill reads `no lexicon attached`, count is `0`, the `View applied entries` button is disabled. An inline hint reads `— attach via Personas.`
- **Lexicon attached**: the pill shows the lexicon name, the count reflects how many distinct words in the current textarea text would actually be replaced, and the `View applied entries` button opens a modal listing every match (`Word / Pronunciation / Format / Count`).

**How a lexicon gets attached.** Picking a Profile in the 👤 Profile chip auto-attaches that profile's `default_lexicon_id` lexicon (if it has one). The Generate view watches `selectedProfile`, fetches `/v1/lexicons/{id}`, and populates the row + modal. Switching profiles re-fetches; picking a profile without a lexicon drops back to the empty state. The lexicon is also sent to the server at render time as `lexicons: ["lex_id"]` so the actual pronunciation overrides apply during TTS — not just preview.

## Paralinguistic slash menu

Type **/** in the textarea. A menu pops up with the engine's inline-tag taxonomy:

- **Chatterbox-Turbo:** `[laugh] [cough] [chuckle] [sigh]` — inline anywhere.
- **Dia:** `[S1] [S2]` speaker tags + `(laughs) (sighs) (clears throat)` for non-verbal sounds.
- **MOSS-TTSD:** `[S1] [S2] [S3]` speaker markers + `[pause 1.5s]` for exact timing.
- **Kokoro:** no inline tags (speed only).

Filter by typing. Use ↑↓ to navigate, Enter / Tab to insert, Esc to close. Tags whose manifest carries a start-of-turn placement rule get inserted at position 0 regardless of cursor location.

## Auto-chunking

Long text (> `settings.generation.max_chunk_chars`, default 800) gets split at sentence boundaries, rendered per-chunk, and crossfade-concatenated. You don't need to do anything — the server detects long input and switches paths automatically.

The splitter knows about abbreviations (`Mr.`, `Dr.`, `e.g.`), decimal numbers, CJK sentence-end punctuation (`。！？`), and treats `[bracket]` paralinguistic tags as atomic (never split inside one).

Per-chunk seeds are deterministically varied (`seed + chunk_index`) so the same `(text, seed)` pair always produces the same output, while artefact correlation across chunks stays low.

## In-flight status strip + status panel

Hitting ▶ Generate (or any AI-driven action — Compose, chapter renders, engine installs, training jobs) pushes an accent-tinted progress strip into the top of the content area. It is the same shared strip every app in the family uses (`AiTaskStrip` from the shared UI kit), reading the shared task queue — a run keeps going even if you navigate away, and the strip follows you.

### Strip lifecycle

| State | Visual | Auto-dismiss |
|---|---|---|
| running | animated ✨ sparkle + elapsed seconds + per-task stat chips | — (Cancel button while running) |
| done | green ✓ badge + `done` + soft-green strip | 5 seconds |
| failed | red ⚠ badge + `failed` + inline error + red-bordered strip | **never** (manual ✕ only — so you can read the error) |
| cancelled | gray ⊘ badge + `cancelled` + muted strip | 3 seconds |

Per-task stat chips show the numbers each operation reports: characters, words, KB out and audio seconds for TTS renders; tokens and tokens-per-second for LLM-driven actions like Compose. A batch operation (Lines → *Re-render changed*) also shows a live `done/total` counter with a real progress bar. Single-call operations show elapsed time only — the strip never invents a percentage for work that doesn't report one.

Buttons on the right:
- **Details** — opens the AI-tasks status panel (see below).
- **Cancel** — while running. Cancelling aborts the actual request or batch, not just the display.
- **Retry** — on a finished task whose operation can re-run (renders, analyses, guesses). Also available from the panel's Recent list, so a failed run can be retried even after its strip is gone.
- **✕** — once finished, dismisses the strip immediately. Failed strips don't auto-clear so you can read the error.

A failed task also badges the ✨ AI-tasks button red until you open the panel — a failure can't slip past unseen while you're on another view.

### Status panel

The **AI tasks** panel slides in from the right. Open it from any strip's Details button, the ✨ button in the title bar, the ✨ AI tasks row in the sidebar, or the server-status pill in the title bar.

The panel has two sections:

- **Running** — accent-tinted cards for every active task: elapsed time, per-task stats, per-task Cancel, and a `Cancel all` action when more than one is running. Streaming LLM tasks also show a live/stalling/stuck freshness dot, calibrated to the stream's own pace.
- **Recent** — just-finished tasks still on screen, then the last 50 completed / cancelled / failed tasks with status icon (✓ / ⊘ / ⚠), duration, stat summary, the error message for failed runs, and Retry where the operation supports it. `🗑 Clear` clears the history.

The panel closes on outside click, Escape, or the ✕ Close button.

## History

The card at the bottom shows your last 10 generations across the whole DB:
- ▶ replay via the global audio player
- ★ favorite
- ↻ retry (re-render with the same args)
- ✕ delete

Click a take to see its lineage via the [take versioning](take-versioning.md) chain.

## Troubleshooting

- **"No engine loaded."** — Click the link to load one on the [Speech engines](engines.md) tab (AI page). Kokoro is the lightest if you're unsure.
- **Voice dropdown says "no voices available"** — The loaded engine is clone-only (Chatterbox) and you haven't cloned a reference WAV yet. Use the link in the banner to [Voices](voices.md).
- **Compose button is disabled (grayed out)** — No profile is selected, or the selected profile has no personality prompt. Pick a profile in the 👤 Profile chip or add a personality prompt via [Profiles](profiles.md).
- **Compose returns "LLM not configured"** — Wire an OpenAI-compatible endpoint in Settings → External.
- **Slash menu shows no tags** — The loaded engine has no inline-tag taxonomy. Switch to Chatterbox-Turbo, Dia, or MOSS to access tags.
- **Render is silent / clipped at the end** — Some engines (Chatterbox family) hallucinate trailing noise; the trim utility removes that. If clipping the actual content, file an issue with the offending text.
- **Pitch slider grayed out** — The engine doesn't accept pitch shift. Switch to LuxTTS for native pitch control.

## API parity

| UI control | API field |
|---|---|
| Textarea | `text` |
| Voice chip | `voice` (the voice ID) |
| Profile chip | `profile_id` (optional — applies Tier-2 delivery overlay) |
| Effects chip | `delivery.engine.*` (mostly profile-managed) |
| Seed | `seed` |
| Delivery overlay sliders | `delivery.speed / pitch / gain_db / temperature / pause_before / pause_after` |
| Inline emotion / paralinguistic / SFX tags (via SlashTagMenu) | inline in `text` (e.g. `[laugh]` for Chatterbox-Turbo, `(sighs)` for Dia) |
| Delivery direction | `delivery.instruct` |
| Style prompt | `delivery.style_prompt` (Qwen3 only) |
| Engine-specific knobs (advanced + primary) | `delivery.engine.{key}` — only sent when changed from default |
| Render preset (no UI yet) | `preset_id` |
| Lexicon attach | `lexicons: ["lex_id"]` |

All endpoints documented in Settings → API reference card.
