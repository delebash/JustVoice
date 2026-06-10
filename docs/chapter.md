# Takes editor (Home → Studio → Takes tab)

The block/take editor lives inside **Home (Studio)** as the **Takes** tab. The project comes from Studio's header switcher; pick a chapter/scene inside the tab. Each block is a paragraph (or speech act). Each block has takes (versions). Render the whole chapter from Studio's Render tab as a single mastered WAV.

(The old standalone "Chapter" sidebar entry is gone — `#chapter` bookmarks land in Studio.) For one-off renders use the [Scratchpad](generate.md). For multi-track timeline arrangement use [stories.md](stories.md).

## Concepts

- **Project** — a book, a game's NPC roster, a podcast season. Holds metadata + the persona cast list + an optional manifest. See [core-concepts.md](core-concepts.md).
- **Chapter** — a top-level division. An audiobook chapter, a game scene, a podcast episode.
- **Scene** — an intermediate division inside a chapter. Useful for long chapters; otherwise can be one scene per chapter.
- **Block** — a single rendering unit. Usually a paragraph. Each block has its own text + persona attribution + per-block delivery override.
- **Take** — one rendered version of a block. Re-rolling a block creates a new take with a lineage chain back to its source. See [take-versioning.md](take-versioning.md).

A chapter render walks every block in order, picks the default take for each, optionally masters the concatenation, and emits one WAV. Re-rendering a single block doesn't invalidate the other blocks' cached takes.

## Navigation

The left pane lists projects → chapters → scenes → blocks. Click to navigate. The right pane shows the currently-selected block.

Top toolbar:
- **Import** — pull in a script via one of the [import adapters](import-formats.md) (JustWrite JSON / CSV / SRT / Audacity labels / JustVoice standard schema).
- **Render chapter** — kick off the chapter pipeline (default takes only).
- **Export** — bundle the chapter as WAV / M4B / ZIP.

## Per-block controls

- **Persona attribution** — pick the speaking character from the project's cast.
- **Text** — the block content. Editable inline.
- **Delivery override** — per-block delivery tweaks (volume nudge, pause-before, emotion). Tier-3 in the [3-tier voice tuning](profiles.md#3-tier-voice-tuning) merge.
- **Takes carousel** — `← Take 3 of 7 →` arrows + dropdown with timestamps. Click any take to switch the default.
- **Audio player** — plays the current default take via the global player.
- **Actions row** — Regenerate / Set as default / Compare / Delete (two-step confirm).
- **Lineage pill** — `← from Take N` if this take was re-rolled from another. Click for the full lineage timeline.

## Render flow

When you click **Render chapter**:

1. JustVoice walks each block in order.
2. For each block: applies its persona's lexicon → applies the persona's profile → applies the block's delivery override → renders via the engine.
3. Concatenates the per-block WAVs with crossfade (per `settings.generation.crossfade_ms`).
4. Optionally applies the chapter's mastering target (ACX / iAudio / Podcast / YouTube — see [mastering.md](mastering.md)).
5. Emits one WAV.

Long blocks auto-chunk at sentence boundaries (same path as `/v1/generate`).

Rendering is cancellable and resumable. The render-task strip at the top of the screen shows progress; closing the app preserves the queue.

## Re-roll workflow

Don't like a block's take?
1. Adjust its delivery override (slow it down, add pause, change emotion).
2. Click **Regenerate** — creates a new take with `source_take_id` pointing at the previous default.
3. Use the takes carousel to A/B between them.
4. Click **Set as default** on whichever wins.

Old takes stay in the DB until you bulk-delete them — useful for going back if the new direction is worse.

## Project import

The Takes tab follows Studio's project switcher. New users: use **Import manuscript** in Studio's header (or the empty-state buttons). Adapters:

- **JustWrite JSON** — the primary integration (see [CONTRACT.md](../CONTRACT.md))
- **CSV** — `character,text` columns
- **SRT** — subtitle files (timing ignored; lines become blocks)
- **Audacity labels** — label-track export
- **JustVoice standard** — our own portable schema

See [import-formats.md](import-formats.md) for adapter specifics + JSON schemas.

## Per-character override

Each persona in the cast can override:
- **Engine** — one character uses Chatterbox, the rest use Kokoro.
- **Lexicon** — Old Crow uses street-slang.lex; everyone else uses the project default.
- **Delivery defaults** — per-character speed / pitch / emotion baseline.

These overrides feed Tier-2 of the [3-tier voice tuning](profiles.md#3-tier-voice-tuning) merge.

## Audio export

After rendering, the **Export** action produces:
- **WAV** — raw single file (or one per chapter for multi-chapter projects)
- **M4B** — audiobook container with chapter markers (muxed client-side by JustWrite's `services/m4b.js` via FFmpeg.wasm — see [CONTRACT.md](../CONTRACT.md))
- **ZIP** — bundle of per-block WAVs + a manifest.json for game-dev workflows

Mastering is applied before export — change the target via [mastering.md](mastering.md).

## Troubleshooting

- **"No project selected. Go to Projects."** — Click the link to import or create a blank project.
- **"No blocks in this scene"** — Empty scene. Add blocks via the import flow or click "+ Block" on the scene.
- **A block won't render** — Check the persona is attributed (not "(unset)") and has a voice assigned in the Cast tab.
- **"Engine swap needed" on regenerate** — the picked voice's engine isn't loaded; confirm the swap (or tick *Always swap without asking*). Batch renders group blocks by engine server-side, so a multi-engine cast swaps once per engine — never per block.
- **Chapter render fails partway** — Check the task-strip error for the failing engine; the strip's ↻ Retry re-runs the render.
- **Mastered output is too quiet / loud** — Switch mastering target in [mastering.md](mastering.md).
