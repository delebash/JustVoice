# Chapter editor

The **Chapter** tab is the multi-line audiobook workspace. Pick a project → chapter → scene → block. Each block is a paragraph (or speech act). Each block has takes (versions). Render the whole chapter as a single mastered WAV.

This is where audiobook production lives. For one-off renders use [generate.md](generate.md). For multi-track timeline arrangement use [stories.md](stories.md).

## Concepts

- **Project** — a book, a game's NPC roster, a podcast season. Holds metadata + the persona cast list + an optional manifest. See [core-concepts.md](core-concepts.md).
- **Chapter** — a top-level division. An audiobook chapter, a game scene, a podcast episode.
- **Scene** — an intermediate division inside a chapter. Useful for long chapters; otherwise can be one scene per chapter.
- **Block** — a single rendering unit. Each block has its own text + persona attribution + per-block delivery override. On import it's a paragraph; once [Studio · Script](studio.md) analyzes the chapter it becomes one **speaker turn**, because a paragraph that mixes narration and dialogue needs more than one voice. Expect a chapter to show more, shorter blocks after analysis — the words don't change, only where the cuts are. Performance notes and import line-ids follow the paragraph they came from.
- **Take** — one rendered version of a block. Re-rolling a block creates a new take with a lineage chain back to its source. See [take-versioning.md](take-versioning.md).

A chapter render walks every block in order, picks the default take for each, optionally masters the concatenation, and emits one WAV. Re-rendering a single block doesn't invalidate the other blocks' cached takes.

## Navigation

The left pane lists projects → chapters → scenes → blocks. Click to navigate. The right pane shows the currently-selected block.

The chapters list carries per-chapter **Script** and **Render** status columns — Script shows attribution state (e.g. `unassigned speakers` when lines still need a persona), Render shows cache state (`✓ cached` / `n/m cached`) — so you can see at a glance which chapters still need attribution or rendering.

Top toolbar:
- **Import** — pull in a script via one of the [import adapters](import-and-export.md) (JustWrite JSON / CSV / SRT / Audacity labels / JustVoice standard schema).
- **Render chapter** — kick off the chapter pipeline (default takes only). A
  chapter with lines nobody speaks **refuses to render** and names them —
  they'd otherwise be missing from the audio with nothing said. Fix them in
  [Studio · Script](studio.md#fixing-what-it-got-wrong), which can send them
  all to the narrator in one click. `♪ marker` rows are exempt: they're
  direction, not speech, and never blocked anything.
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

The Chapter tab is gated on having a project selected. New users: hit the **Go to Projects** link in the empty-state banner to import a manuscript. Adapters:

- **JustWrite JSON** — the primary integration (export a book from JustWrite, open it here)
- **CSV** — `character,text` columns
- **SRT** — subtitle files (timing ignored; lines become blocks)
- **Audacity labels** — label-track export
- **JustVoice standard** — our own portable schema

See [import-and-export.md](import-and-export.md) for adapter specifics + JSON schemas.

## Per-character override

Each persona in the cast can override:
- **Engine** — one character uses Chatterbox, the rest use Kokoro.
- **Lexicon** — Old Crow uses street-slang.lex; everyone else uses the project default.
- **Delivery defaults** — per-character speed / pitch / emotion baseline.

These overrides feed Tier-2 of the [3-tier voice tuning](profiles.md#3-tier-voice-tuning) merge.

## Audio export

After rendering, the **Export** action produces:
- **WAV** — raw single file (or one per chapter for multi-chapter projects)
- **M4B** — audiobook container with chapter markers, muxed **on the server** by ffmpeg via
  `POST /v1/projects/{id}/export_m4b` (needs ffmpeg on PATH — see [Audiobook → M4B](import-and-export.md#audiobook--m4b))
- **ZIP** — bundle of per-block WAVs + a manifest.json for game-dev workflows

Mastering is applied before export — change the target via [mastering.md](mastering.md).

## Troubleshooting

- **"No project selected. Go to Projects."** — Click the link to import or create a blank project.
- **"No blocks in this scene"** — Empty scene. Add blocks via the import flow or click "+ Block" on the scene.
- **A block won't render** — Check the persona is attributed (not "(unset)"). Persona must map to a profile or have an engine fallback.
- **Chapter render fails partway** — Check the task-strip error. Most common: engine failed to load on first use; load it manually via [engines.md](engines.md) first.
- **Mastered output is too quiet / loud** — Switch mastering target in [mastering.md](mastering.md).
