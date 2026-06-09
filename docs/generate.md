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
| 🎭 Profile | Pick a [voice profile](profiles.md) — wraps voice + delivery defaults + effects + personality. |
| 🎛️ Effects | Apply a saved effects chain to the output. |
| 🎭 Persona rewrite | (Only when the selected profile has a personality prompt) Re-rolls input through the persona's LLM rewrite before TTS. |
| 🔁 Autoplay | Auto-play the result on render. |

The two action buttons at the right end:
- **🎲 Compose** — only appears when the selected profile has a personality prompt. Asks the LLM to write a fresh in-character line and fills the textarea. Requires LLM service configured.
- **▶ Generate** — renders the textarea content. While rendering, shows **⏹** to stop.

## Capability banner

Below the chip bar is a banner showing what the currently-loaded engine actually accepts:

- ✓ pitch ±N st (native) — engine accepts pitch shift directly
- ✓ temperature — sampling-variance knob is real
- ✓ seed — deterministic generation supported
- ✓ N emotion tags — the engine has a discrete emotion enum (e.g. Higgs's 21 tags)
- ✓ free-form delivery — accepts the Delivery direction textarea (Qwen3 / LuxTTS only)
- ✓ cloning — accepts a reference WAV
- ✓ IPA phoneme input — bypass the text parser (Kokoro)

Engines that don't support a feature show **✗** with a note ("use Qwen3 / LuxTTS"). The pills are sourced from `/v1/engines/capabilities` — they reflect what each engine's adapter actually wires, not aspirational claims. See [engines.md](engines.md) for per-engine details.

## Delivery overlay

The card below the banner has paired slider + number inputs for the engine's accepted knobs:

- **Speed** — 0.5–2.0× pacing multiplier
- **Temperature** — sampling variance (engine-specific range)
- **Pitch** — semitones. Native for LuxTTS / Higgs; post-process via pedalboard for others; disabled when no pitch path exists.
- **Gain** — output WAV amplitude in dB
- **Pause before / after** — silence padding in ms
- **Seed** — randomize button next to it

### Emotion dropdown

Shows ONLY when the engine declares an emotion taxonomy (Higgs has 21 tags). For Higgs, the dropdown's hint reads "Inserted at the start of the line — shapes the whole turn" because emotion tags must be turn-leading.

### Delivery direction (free-form)

Shown ONLY when the engine accepts a freeform `instruct` field (Qwen3 / LuxTTS). For Chatterbox the field is disabled with a hint to use the Emotion dropdown or inline paralinguistic tags instead.

### Engine-specific JSON (advanced)

Collapsed `<details>` for power users — paste arbitrary engine-specific overrides like `{"exaggeration": 1.2, "cfg_weight": 0.5}`. Merged with the form values; form wins on conflict.

## Paralinguistic slash menu

Type **/** in the textarea. A menu pops up with the engine's inline-tag taxonomy:

- **Chatterbox-Turbo:** `[laugh] [cough] [chuckle] [sigh]` — inline anywhere.
- **Higgs Audio v3:** `<|emotion:anger|>`, `<|style:whispering|>`, `<|prosody:speed_slow|>` (placed at start of turn); `<|sfx:laughter|>`, `<|sfx:cough|>` (inline anywhere).
- **Dia:** `[S1] [S2]` speaker tags + `(laughs) (sighs) (clears throat)` for non-verbal sounds.
- **MOSS-TTSD:** `[S1] [S2] [S3]` speaker markers + `[pause 1.5s]` for exact timing.
- **Kokoro:** no inline tags (speed only).

Filter by typing. Use ↑↓ to navigate, Enter / Tab to insert, Esc to close. Tags with the start-of-turn placement rule (Higgs emotions / style / prosody) get inserted at position 0 regardless of cursor location.

## Auto-chunking

Long text (> `settings.generation.max_chunk_chars`, default 800) gets split at sentence boundaries, rendered per-chunk, and crossfade-concatenated. You don't need to do anything — the server detects long input and switches paths automatically.

The splitter knows about abbreviations (`Mr.`, `Dr.`, `e.g.`), decimal numbers, CJK sentence-end punctuation (`。！？`), and treats `[bracket]` paralinguistic tags as atomic (never split inside one).

Per-chunk seeds are deterministically varied (`seed + chunk_index`) so the same `(text, seed)` pair always produces the same output, while artefact correlation across chunks stays low.

## History

The card at the bottom shows your last 10 generations across the whole DB:
- ▶ replay via the global audio player
- ★ favorite
- ↻ retry (re-render with the same args)
- ✕ delete

Click a take to see its lineage via the [take versioning](take-versioning.md) chain.

## Troubleshooting

- **"No engine loaded. Go to Engines → Load."** — Click the link to the [Engines](engines.md) tab and load one. Kokoro is the lightest if you're unsure.
- **Voice dropdown says "no voices available"** — The loaded engine is clone-only (Chatterbox) and you haven't cloned a reference WAV yet. Use the link in the banner to [Voices](voices.md).
- **Compose button missing** — No profile selected, or the selected profile has no personality prompt. Edit the profile.
- **Compose returns "LLM not configured"** — Wire an OpenAI-compatible endpoint in Settings → External.
- **Slash menu shows no tags** — The loaded engine has no inline-tag taxonomy. Switch to Chatterbox-Turbo, Higgs, Dia, or MOSS to access tags.
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
| Emotion dropdown | `delivery.emotion` |
| Delivery direction | `delivery.instruct` |
| Engine-JSON details | `delivery.engine` |
| Render preset (no UI yet) | `preset_id` |
| Lexicon attach | `lexicons: ["lex_id"]` |

All endpoints documented in Settings → API reference card.
