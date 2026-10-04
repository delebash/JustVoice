# Generate

The **Generate** tab renders one line of text to audio. Pick a voice, type the line, optionally apply delivery overlays, click ▶. The server returns audio bytes you can replay, favorite, or download.

This is JustVoice's primary single-line interface — for batch chapter-style rendering, see [chapter.md](take-versioning.md).

## When to use Generate

- **Dictation users** — quick line synthesis, paste, send. Use the [MCP server](mcp-server.md) for agent-driven workflows.
- **Game devs** — render dialogue lines one at a time during iteration. Use [chapter.md](take-versioning.md) for bulk export.
- **Audiobook producers** — preview how a persona sounds before committing to a full chapter render. Settings here flow into the chapter pipeline through the [persona](personas.md) that plays each speaker.
- **Podcasters** — record a one-off intro / outro / ad-read. (The Stories timeline is a placeholder; there is nothing to drag it onto yet.)

## The floating chip bar

Below the textarea is a row of chip cards. Each chip selects one input:

| Chip | What it does |
|---|---|
| 🎙️ Voice | Pick from the currently-loaded engine's voices. Disabled when no engine is loaded — see the "No engine loaded" banner. |
| 🧠 Engine | Shows which TTS engine is loaded. Switch via [engines.md](engines.md). |
| 🗣️ Lang | Language hint for engines that support per-call language switching (Chatterbox-Multilingual, Qwen3). |
| 👤 Persona | Pick a [persona](personas.md) — wraps voice + delivery defaults + effects + the spoken-delivery instruction. **Picking one switches the voice to the persona's own** (2026-10-03), so what you hear is the persona; you can still change the voice after. If the persona's voice is on an engine that isn't loaded, a note says so and names it. Its language, emotion or tags and seed come with it, through the same path a chapter render uses. (It was called "profile" before personas absorbed that entity.) |
| 🎛️ Effects | Apply a saved effects chain to the output. |
| 🔁 Autoplay | Auto-play the result on render. |

The action buttons at the right end:
- **✏️ Rewrite** — asks the LLM to rewrite the textarea text in the selected persona's voice, shown as a preview you accept or discard; nothing changes until you accept.
- **🎲 Compose** — asks the LLM to write a fresh line into the textarea in the selected persona's voice.

  Both read the persona's **Note on how it sounds** — Generate has no book, so there is no speaker's *Who they are* to read (who a person is lives on the book's speaker since 2026-09-29; Script's *Rewrite in character* reads that instead). Both are always visible and **disabled** when no persona is selected or its note is empty (the tooltip says so); a call without a note is refused with "*name* has no note on how it sounds — write one on the Personas page to use Compose / Rewrite." Both require an LLM service configured in Settings → External.
- **▶ Generate** — renders the textarea content. Disabled until a voice is picked.
- **⏹ Stop** — cancels a queued/running render. Always visible; disabled when nothing is in flight.

## Capability banner

Below the chip bar is a banner showing what the currently-loaded engine actually accepts:

- ✓ pitch ±N st — pitch shift is available (post-process on every engine)
- ✓ temperature — sampling-variance knob is real
- ✓ seed — deterministic generation supported
- ✓ N emotion tags — the engine has a declared emotion taxonomy in its capability manifest (none does today)
- ✓ free-form delivery — accepts the Delivery direction textarea (Qwen3 CustomVoice and VoiceDesign)
- ✓ cloning — accepts a reference WAV
- ✓ IPA phoneme input — takes pronunciations as phonemes (none does on the speech runtime yet)

Engines that don't support a feature show **✗** with a note naming one that does. The pills are sourced from `/v1/engines/capabilities` — they reflect what the speech runtime actually receives for each engine, not aspirational claims. The **loaded model's** row wins over the engine's: with Qwen3 Base loaded you get Base's controls (cloning, no free-form delivery), not CustomVoice's. See [engines.md](engines.md#what-each-engine-can-be-tuned-with) for per-engine details.

## Delivery overlay

The card below the banner holds the sliders. Each one is a track with its own
number box — the box is editable, because a slider alone cannot reliably land on
0.35 — and the labels under the ends say what moving it *means* rather than
repeating the numbers: Speed reads *slower · as written · faster*, Gain reads
*quieter · unchanged · louder*. The six **primary controls** are universal across
engines:

- **Speed** — 0.5–2.0× pacing multiplier, **on every engine**. **Kokoro** and **KittenTTS** pace themselves — the model reads faster or slower. Every other engine (Qwen3-TTS, Chatterbox, Pocket TTS, and cloud voices that take no speed) speaks at its own pace and the server then time-stretches the finished line, keeping its pitch. The hint under the slider says which: *Native — the engine paces itself.* or *Post-process — the rendered audio is time-stretched, pitch kept.* Until 2026-10-02 only Kokoro and KittenTTS honoured Speed, and the rest ignored it.
- **Pitch** — semitones, **post-process on every engine**. The rendered audio is pitch-shifted after synthesis, so it works the same everywhere. No engine transposes natively.
- **Gain** — output WAV amplitude in dB. Applied by the server, so it works on every engine.

Speed, Pitch and Gain are applied by the same server code here and in a chapter render, so a setting sounds the same from both. Until 2026-10-02 Generate applied none of the three — Pitch and Gain did nothing on this page, though they worked in chapters.
- **Temperature** — sampling variance (engine-specific range)
- **Pause before → after** — silence in ms around this line. Blank means "use the project's gap"; a value replaces it for that join, and a line's `pause after` plus the next line's `pause before` add together. **0 is a deliberate butt-join**, not "unset".
- **Seed** — `🎲 randomize` button next to it

### Delivery direction (free-form)

A textarea for describing how the line goes, in your own words — *"clipped, world-weary, dry"*. Shown always, but live ONLY when the loaded model accepts a freeform instruction, which today is **Qwen3-TTS CustomVoice and VoiceDesign** (Qwen3 Base clones and takes no instruction). On VoiceDesign the instruction is the voice description itself. The pill in the label flips between `disabled · requires Qwen3-TTS` (ghost) and `free-form` (green).

At render time this is joined with the persona's **Spoken delivery** and the line's own **direction** into the single instruction the engine receives, most specific last. See [personas.md](personas.md).

### Emotion

A dropdown of nine labels: *neutral · happy · sad · angry · fearful · whispered · shouted · sarcastic · contemptuous*.

It is a list rather than a sentence for one reason: **it is the only delivery control with a cross-engine meaning.** Prose can only be handed to an engine that reads prose, but a label can be compiled two different ways, so the same choice survives recasting a speaker onto a persona on a different engine.

- **Engines that read prose** (Qwen3-TTS CustomVoice and VoiceDesign) get the label folded into the instruction, alongside the persona's spoken delivery and the line's direction.
- **Engines with an emotion vocabulary** get their own token prefixed to the line instead. Chatterbox Turbo was that engine — pick *fearful* and it rendered `[fear] Who's there?` — and it is not available on the speech runtime yet (see [Engines → Not available yet](engines.md#not-available-yet)), so no engine takes emotion this way today.
- **Every other engine** (Kokoro, Chatterbox Multilingual, Qwen3 Base) has no way to express it. The field is disabled and says so, rather than accepting a value it would drop.

When an engine with a vocabulary is loaded, the list is filtered to what it can actually say and the hint names what it can't. *Neutral* is always available: it is expressible by adding nothing.

The vocabulary comes from `/v1/engines/capabilities` rather than being typed into the UI, so the picker cannot drift from what the server accepts.

**Emotion is not the same as an inline tag.** Emotion is the state the whole line is spoken in, so it is a field. A non-verbal sound happens at a *moment*, so it is typed where you want it — `/` in the textarea, or the **🏷️ Insert tag** button. No engine takes inline tags on the speech runtime today (Chatterbox Turbo, which did, is not available yet), so both list nothing, and bracketed text you type yourself is removed before the model sees it — never read out as a word.

### Engine-specific knobs

Below the primary controls, the form auto-renders any extra knobs the engine declares in its capability manifest (`server/justvoice/engines/capability_details.py`). For example:

- **Chatterbox Multilingual** — `Exaggeration`, `CFG weight`; advanced `Repetition penalty`, `Top p`
- **Qwen3** (every model) — advanced `Top k`, `Top p`, `Repetition penalty`
- **Kokoro**, **KittenTTS** — none beyond Speed, which these two take natively

Every engine takes a Seed: the same seed, text and settings give the same audio.

Each knob renders as a paired slider + number input, just like the primary controls. Non-advanced knobs appear in the main grid; advanced knobs live behind a collapsible `⚙ Show advanced knobs (N)` details block. Values only ship to the API when they differ from the engine's default — no payload noise.

This replaces the old "Raw engine knobs (JSON)" textarea. The manifest is the source of truth: add a `KnobSpec` to an engine's `capability_details.py` entry and the UI picks it up automatically — and a test fails until the speech runtime's request mapping (`engines/audiocpp/slot.py`) actually passes it on.

## Lexicon preview

Below the engine-specific knobs there's a one-line row showing which pronunciation lexicon (if any) is attached to the current render:

> `Lexicon preview applies before TTS: [no lexicon attached pill] · 0 word replacements would apply · [View applied entries]`

The row is always visible — it has two states:

- **No lexicon attached** (default): the pill reads `no lexicon attached`, count is `0`, the `View applied entries` button is disabled. An inline hint reads `— attach via Personas.`
- **Lexicon attached**: the pill shows the lexicon name, the count reflects how many distinct words in the current textarea text would actually be replaced, and the `View applied entries` button opens a modal listing every match (`Word / Pronunciation / Format / Count`).

**How a lexicon gets attached.** Picking a persona attaches that persona's lexicon (its **Lexicon** field, if it has one). The Generate view watches the selected persona, fetches `/v1/lexicons/{id}`, and populates the row + modal. Switching personas re-fetches; picking a persona without a lexicon drops back to the empty state. The lexicon is also sent to the server at render time as `lexicons: ["lex_id"]`, and the line is read through it: respellings replace the words — the same rules as a chapter ([Lexicons](lexicons.md#which-lexicons-a-line-is-read-with)). The preview lists IPA entries too (shown as `/ipa/`), but no engine on the speech runtime takes IPA yet: an entry with both a respelling and IPA is read with its respelling, and an IPA-only entry changes nothing. Until 2026-09-30 the server ignored it, so only the preview changed. A book's lexicon is not added here: a line on Generate belongs to no book.

## Paralinguistic slash menu

Type **/** in the textarea. A menu pops up with the loaded engine's inline-tag taxonomy — and today it is empty for every engine: none of Kokoro, Qwen3-TTS or Chatterbox Multilingual takes inline tags on the speech runtime. The engine that had tags, Chatterbox Turbo, is not available yet (see [Engines → Not available yet](engines.md#not-available-yet)).

When there are tags: filter by typing, ↑↓ to navigate, Enter / Tab to insert, Esc to close. Tags whose manifest carries a start-of-turn placement rule are inserted at position 0 regardless of cursor location.

## Auto-chunking

Long text (> `settings.generation.max_chunk_chars`, default 800) gets split at sentence boundaries, rendered per-chunk, and crossfade-concatenated. You don't need to do anything — the server detects long input and switches paths automatically.

Voice auditions on the Voices page use the same splitter at a much smaller
granularity (`settings.generation.stream_piece_chars`, default 200): each
sentence-sized piece is sent to your player the moment it renders, so
playback starts after the first piece instead of the whole render. Pieces
join with the same crossfade as the long-form path.

The splitter knows about abbreviations (`Mr.`, `Dr.`, `e.g.`), decimal numbers, CJK sentence-end punctuation (`。！？`), and treats `[bracket]` paralinguistic tags as atomic (never split inside one).

Per-chunk seeds are deterministically varied (`seed + chunk_index`) so the same `(text, seed)` pair always produces the same output, while artefact correlation across chunks stays low.

## In-flight status strip + status panel

Hitting ▶ Generate pushes an accent-tinted progress strip into the top of the content area. It is the same shared strip every app in the family uses (`AiTaskStrip` from the shared UI kit), reading the shared task queue — a run keeps going even if you navigate away, and the strip follows you.

Two kinds of work appear there, and only these two:

- **Anything that queries a language model** — Compose, Persona rewrite, Speaker attribution, Smart assign, ACX QC, Show notes, Voice gender. This is what the strip exists for, and it is the same queue JustWrite and the docs generator use for their own AI features.
- **Long TTS renders** — this view's ▶ Generate, a chapter render, Lines → *Re-render changed*, and a Studio scene render.

What does **not** appear there: installing an engine, downloading a model, and loading a model all report on their own row in the Speech engines tab (see [Engines](engines.md#cancelling-an-in-flight-load)). That is file and process work rather than model queries, and putting them in this queue only buried the runs you actually wanted to watch.

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

The **AI tasks** panel slides in from the right. Open it from any strip's Details button, the ✨ button in the title bar, or the ✨ AI tasks row in the sidebar. The server status in the title bar ("Operational", and how many tasks are in flight) is status only — it is not a button.

The panel has two sections:

- **Running** — accent-tinted cards for every active task: elapsed time, per-task stats, per-task Cancel, and a `Cancel all` action when more than one is running. Streaming LLM tasks also show a live/stalling/stuck freshness dot, calibrated to the stream's own pace.
- **Recent** — just-finished tasks still on screen, then the last 50 completed / cancelled / failed tasks with status icon (✓ / ⊘ / ⚠), duration, stat summary, the error message for failed runs, and Retry where the operation supports it. `🗑 Clear` clears the history.

The panel closes on outside click, Escape, or the ✕ Close button.

## History

The card at the bottom shows your last 10 generations across the whole DB:
- ▶ replay in a compact player right under the row
- ★ favorite
- ↻ retry (re-render with the same args)
- ✕ delete

Click a take to see its lineage via the [take versioning](take-versioning.md) chain.

## Troubleshooting

- **"No engine loaded."** — Click the link to load one on the [Speech engines](engines.md) tab (AI page). Kokoro is the lightest if you're unsure.
- **Voice dropdown says "no voices available"** — The loaded engine is clone-only (Chatterbox) and you haven't cloned a reference WAV yet. Use the link in the banner to [Voices](voices.md).
- **Compose or Rewrite is disabled (grayed out)** — No persona is selected, or the selected persona has no note on how it sounds. Pick one in the 👤 Persona chip, or write its **Note on how it sounds** in [Personas](personas.md).
- **Compose returns "LLM not configured"** — Wire an OpenAI-compatible endpoint in Settings → External.
- **Slash menu shows no tags** — No engine on the speech runtime takes inline tags yet. Bracketed text in the line is removed before rendering, so it is never read aloud.
- **Render is silent / clipped at the end** — Some engines (Chatterbox family) hallucinate trailing noise; the trim utility removes that. If clipping the actual content, file an issue with the offending text.
- **Pitch does nothing** — Pitch is applied after synthesis, so it works on every engine. If a value has no audible effect, check that it actually saved: an empty cell means "use the default", not zero.
- **An engine knob seems to be ignored** — Until 2026-08-17 engine-specific knobs never reached the engine at all (they were saved flat and read nested). If you are on an older build, that is why. Values set before the fix are picked up automatically — no re-entry needed — but any line rendered with them is cached under the old settings and needs a re-render.

## API parity

| UI control | API field |
|---|---|
| Textarea | `text` |
| Voice chip | `voice` (the voice ID) |
| Profile chip | `profile_id` (optional — applies Tier-2 delivery overlay) |
| Effects chip | `delivery.engine.*` (mostly profile-managed) |
| Seed | `seed` |
| Delivery overlay sliders | `delivery.speed / pitch / gain_db / temperature / pause_before / pause_after` |
| Inline emotion / paralinguistic / SFX tags (via SlashTagMenu) | inline in `text` — kept only for an engine that lists them (none today); every other `[tag]` is removed before rendering |
| Delivery direction | `delivery.instruct` |
| Emotion | `delivery.emotion` — folded into the instruction for Qwen3 CustomVoice and VoiceDesign |
| Engine-specific knobs (advanced + primary) | `delivery.engine.{key}` — only sent when changed from default |
| Lexicon attach | `lexicons: ["lex_id"]` |

All endpoints documented in Settings → API reference card.
