# Chapter editor

The **Chapter** tab is the multi-line audiobook workspace. Pick a project → chapter → scene → block. Each block is a paragraph (or speech act). Each block has takes (versions). Render the whole chapter as a single mastered WAV.

This is where audiobook production lives. For one-off renders use [generate.md](generate.md). (The Stories tab's multi-track timeline is a placeholder — there is no timeline editor to send you to yet.)

## Concepts

- **Project** — a book, a game's dialogue, a podcast season. Holds metadata + its speakers (the people in it, each played by a persona) + an optional manifest. See [core-concepts.md](core-concepts.md).
- **Chapter** — a top-level division. An audiobook chapter, a game scene, a podcast episode.
- **Scene** — an intermediate division inside a chapter. Useful for long chapters; otherwise can be one scene per chapter.
- **Block** — a single rendering unit. Each block has its own text + its speaker + per-block delivery override. On import it's a paragraph; once [Studio · Script](studio.md) analyzes the chapter it becomes one **speaker turn**, because a paragraph that mixes narration and dialogue needs more than one voice. Expect a chapter to show more, shorter blocks after analysis — the words don't change, only where the cuts are. Performance notes and import line-ids follow the paragraph they came from.
- **Take** — one rendered version of a block. Re-rolling a block creates a new take with a lineage chain back to its source. See [take-versioning.md](take-versioning.md).

A chapter render walks every block in order, picks the default take for each, runs the effects chain of the persona that plays each speaker, masters the concatenation to the project's target, and emits one WAV. Re-rendering a single block doesn't invalidate the other blocks' cached takes.

## Navigation

The left pane lists projects → chapters → scenes → blocks. Click to navigate. The right pane shows the currently-selected block.

The chapters list carries per-chapter **Script** and **Render** status columns — Script shows attribution state (e.g. `unassigned speakers` when lines still need a speaker), Render shows cache state (`✓ cached` / `n/m cached`) — so you can see at a glance which chapters still need attribution or rendering.

Top toolbar:
- **Import** — pull in a script via one of the [import adapters](import-and-export.md) (JustWrite JSON / CSV / SRT / Audacity labels / JustVoice standard schema).
- **Render chapter** — kick off the chapter pipeline (default takes only). A
  chapter with lines nobody speaks **refuses to render** and names them —
  they'd otherwise be missing from the audio with nothing said. Fix them in
  [Studio · Script](studio.md#a-chapter), which can send them
  all to the narrator in one click. `♪ marker` rows are exempt: they're
  direction, not speech, and never blocked anything.
- **Export** — bundle the chapter as WAV / M4B / ZIP.

## Per-block controls

- **Speaker** — the line's speaker, shown as a tag. Who speaks each line is set in [Studio · Script](studio.md); who plays each speaker in [Studio · Cast](studio.md#cast).
- **Text** — the block content. Editable inline.
- **Delivery override** — per-block delivery tweaks (volume nudge, pause-before, emotion), on top of the persona's own settings.
- **Takes carousel** — `← Take 3 of 7 →` arrows + dropdown with timestamps. Click any take to switch the default.
- **Audio player** — plays the current default take, inline on the block itself.
- **Actions row** — Regenerate / Set as default / Compare / Delete (two-step confirm).
- **Lineage pill** — `← from Take N` if this take was re-rolled from another. Click for the full lineage timeline.

## Render flow

When you click **Render chapter**:

1. JustVoice walks each block in order.
2. For each block: finds its speaker and the persona that plays them, then applies the book's lexicon, then that persona's → its delivery defaults → the block's delivery override → renders via the engine → runs the persona's **effects chain**.
3. Concatenates the per-block WAVs with crossfade (per `settings.generation.crossfade_ms`).
4. Applies the mastering target — the project's, else the project kind's (ACX for audiobooks; see [mastering.md](mastering.md#which-preset-a-render-uses)).
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
- **CSV** — `character,text` columns (`character` names the line's speaker)
- **SRT** — subtitle files (timing ignored; lines become blocks)
- **Audacity labels** — label-track export
- **JustVoice standard** — our own portable schema

See [import-and-export.md](import-and-export.md) for adapter specifics + JSON schemas.

## Per-persona settings

Each persona that plays a speaker can set:
- **Engine** — one persona on Chatterbox, the rest on Kokoro.
- **Lexicon** — Old Crow's persona adds street-slang.lex on Old Crow's lines; every line is read with the book's lexicon first (Overview → **Pronunciation lexicon**).
- **Delivery defaults** — per-persona speed / pitch / emotion baseline.

A persona that plays several speakers brings the same settings to all of them.

A line's own override sits on top of these.

## Audio export

After rendering, the **Export** action produces:
- **WAV** — raw single file (or one per chapter for multi-chapter projects)
- **M4B** — audiobook container with chapter markers, muxed **on the server** by ffmpeg via
  `POST /v1/projects/{id}/export_m4b` (needs ffmpeg on PATH — see [Audiobook → M4B](import-and-export.md#audiobook--m4b))
- **ZIP** — bundle of per-block WAVs + a manifest.json for game-dev workflows

Mastering is already applied on the render itself — WAV out, encoded on export. Change the target via [mastering.md](mastering.md#which-preset-a-render-uses).

### Captions

Every rendered chapter can produce a caption file — `GET
/v1/scenes/{scene_id}/captions?format=vtt` (or `srt`). The server renders
the chapter (already-rendered lines come from cache) and times **every word
of the real text** with the speech-recognition engine's word aligner
(Qwen3-ForcedAligner, which downloads with the Speech recognition model). The
aligner is given the words, so it never has to guess them — it only measures
where each one falls. Use the `.vtt` for web players and read-along; `.srt`
for video editors. The timing is right for captions and follow-along
highlighting, not for sample-exact editing.

The speech runtime must be installed; the Speech recognition model loads on
first use, and downloads first if it isn't on disk yet (3.6 GB with its
aligner). Until 2026-10-01 captions used Whisper's word timings, which had
stopped coming back at all on current builds; the aligner replaces them.

## Troubleshooting

- **"No project selected. Go to Projects."** — Click the link to import or create a blank project.
- **"No blocks in this scene"** — Empty scene. Add blocks via the import flow or click "+ Block" on the scene.
- **A block won't render** — It needs a speaker (Studio · Script), the speaker needs a persona (Studio · Cast), and the persona needs a voice (Personas). The render refusal names whichever is missing.
- **Chapter render fails partway** — Check the task-strip error. Most common: engine failed to load on first use; load it manually via [engines.md](engines.md) first.
- **Mastered output is too quiet / loud** — Switch mastering target in [mastering.md](mastering.md).
