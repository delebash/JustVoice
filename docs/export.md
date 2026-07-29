# Export — WAV / M4B / ZIP

JustVoice produces audio in three shapes, depending on what you're doing with it:

| Format | What it is | Use case |
|---|---|---|
| **WAV** | Single uncompressed audio file | One-line renders, podcast intros, game NPC lines |
| **M4B** | Audiobook container with chapter markers | ACX submission, audiobook distribution |
| **ZIP** | Bundle of per-block WAVs + manifest.json | Game-dev workflows, archival, hand-off to a DAW |

## Single render → WAV

Every `/v1/generate` call returns `audio/wav`. The Generate tab's ▶ button downloads through the browser's audio element; the History card's ▶ replays via the [global player](generate.md#history).

To save the file outside the app:
- **Generate tab** — right-click the audio player → "Save audio as…"
- **API** — `curl -X POST -H "Content-Type: application/json" -d '...' /v1/generate > out.wav`

## Chapter render → mastered WAV

Chapter renders apply mastering before emitting WAV. Choose the target via [mastering.md](mastering.md):
- **ACX** — Audible-compliant (-23 LUFS / -3 dB peak / -60 dB noise floor)
- **iAudio** — Apple Books target
- **Podcast** — -16 LUFS loudness war target
- **YouTube** — -14 LUFS streaming target
- **None** — raw concatenation, no mastering

The chapter tab's **Render → Export → WAV** action emits one mastered WAV per chapter.

## Audiobook → M4B

M4B assembly happens **on the JustVoice server** — one endpoint, one download, no other app
involved. `POST /v1/projects/{project_id}/export_m4b` returns a finished `.m4b`.

1. `assemble_project()` renders every scene through the **production render path** (the same
   scene resolution and `render_core` the Studio Render tab uses), so the exported book sounds
   exactly like what you previewed.
2. One `ffmpeg` invocation muxes it: the chapter WAVs go through the concat demuxer, an
   FFMETADATA file supplies the chapter marks, and `-f ipod` writes the M4B container at
   `aac 128k`.
3. Title comes from the project name; author is read from the project description when it starts
   with `by `.
4. Download → upload to ACX.

**ffmpeg must be on the server's PATH.** Without it the endpoint returns `503` with
`"ffmpeg is not installed — required for M4B export"` rather than failing silently. This is the
same ffmpeg [mastering](mastering.md) requires.

Cover art and narrator/ASIN metadata are **not** written today — add them in a tag editor
(MP3Tag, Audiobook Builder) if your distributor wants them.

> JustWrite does not touch audio at all. Earlier versions of this page described client-side
> muxing in JustWrite via `services/m4b.js` and FFmpeg.wasm — that has not been true since audio
> moved wholly into JustVoice, and no such code remains in JustWrite.

## Game-dev → ZIP bundle

For NPC dialogue + game audio, the Chapter tab's **Export → ZIP** packages:
- One WAV per block, named by block_id (or by block.character + sequence if set)
- A `manifest.json` listing each WAV's metadata:
  ```json
  {
    "version": 1,
    "project": "RPG-7",
    "blocks": [
      {
        "id": "blk_001",
        "character": "Shopkeeper",
        "scene": "Tavern",
        "text": "Welcome, traveler. What'll it be?",
        "file": "blocks/blk_001.wav",
        "duration_sec": 2.4,
        "engine": "chatterbox",
        "delivery": {"speed": 0.95, "emotion": "neutral"}
      }
    ]
  }
  ```
- Optional per-block JSON sidecars with viseme data (if the engine produced it) for lip-sync rigs

Unreal / Unity integration plans: an `.uplugin` (Unreal) and `.unitypackage` (Unity) will consume this manifest format directly. Until those ship, write a small script in your engine to read manifest.json + load the WAVs as `USoundWave` / `AudioClip` assets.

### Whole project → voiceline ZIP

`POST /v1/projects/{project_id}/export_voicelines` does the same thing for an entire project
rather than one chapter, and downloads as `<project>_VO.zip`.

- **One WAV per line**, named by its stable line id and grouped into a folder per scene, so the
  archive stays diffable across re-exports — the same line keeps the same path.
- **`manifest.json`** alongside, in the format above.
- Every line is rendered through the **production render path** (`render_core.render_line` with
  the persona's delivery and lexicon), so the export matches what the Studio Render tab
  produced. It is not a separate, drifting code path.

Stable ids are what make this useful in a game pipeline: re-export after editing three lines and
only those three files change, so your engine's asset diff stays small. That is also why
[re-import](import-formats.md) rejects rows without a stable id — positional `row:N` fallbacks
would silently mismatch every line the moment the sheet was reordered.

## Project export (full project archive)

The Projects tab's **Export project** action produces a `.justvoice.zip` archive:
- All chapters' rendered WAVs
- All takes (not just defaults — full history for re-roll archaeology)
- The project's full SQLite snapshot
- Persona cast list + voice profile bindings
- Lexicons used
- Render presets

Useful for handing a project to a collaborator, archiving a finished book, or moving between machines. Import via Projects → "+ Import → .justvoice.zip".

## Single take → ZIP (with effects history)

Per-take ZIP export (endpoint exists but not yet exposed in the UI): bundles the take's audio + every effects-applied version + a manifest with the lineage. Useful for handing a take to a sound designer.

API: `GET /v1/takes/{take_id}/export` returns the ZIP.

## Mastered audio direct from API

For agents / scripts driving JustVoice via MCP:
- `POST /v1/master` — apply a mastering preset to bytes you supply
- `POST /v1/analyze` — get LUFS / peak / noise floor report on bytes

Useful for masking JustVoice-produced audio without re-rendering.

## Troubleshooting

- **M4B export fails with 503** — ffmpeg is not on the server's PATH. Install it and restart the server; the same binary powers [mastering](mastering.md).
- **M4B is missing chapter markers** — chapters come from the FFMETADATA file `mux_m4b()` writes, one entry per assembled chapter. A project whose scenes have not been rendered produces no chapters; render first, then export.
- **WAV plays at wrong speed** — Mismatched sample rate. Check the engine's output rate vs the destination application's expected rate. Engines emit at their native rate (Kokoro 24 kHz, Chatterbox 24 kHz, LuxTTS 48 kHz, TADA 24 kHz).
- **Mastered audio is silent at the start** — A bug in the mastering normalize step. Try the "iAudio" target instead of ACX; iAudio's threshold is gentler.
- **ZIP export is huge** — Unmastered + every take is large. Use the project export with "Default takes only" checkbox to slim it down.
