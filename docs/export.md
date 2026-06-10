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

M4B muxing happens client-side, not on the JustVoice server. The audiobook flow is:

1. JustWrite calls JustVoice `/v1/chapters/render` per chapter → gets mastered WAVs back.
2. JustWrite holds the manuscript + chapter metadata + cover art.
3. JustWrite's `services/m4b.js` uses FFmpeg.wasm to mux the WAVs into one M4B file with:
   - Chapter markers from the chapter manifest
   - Embedded cover art
   - Metadata (title, author, narrator, ASIN if set)
4. User downloads the M4B → uploads to ACX.

For non-JustWrite workflows (a podcaster manually assembling an audiobook), you can use any external M4B muxer (`ffmpeg`, MP3Tag, Audiobook Builder) on the per-chapter WAVs JustVoice exports.

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

- **M4B is missing chapter markers** — JustWrite must pass the chapter manifest to FFmpeg's `-i FFMETADATAFILE` argument. Check JustWrite's `services/m4b.js` for the call.
- **WAV plays at wrong speed** — Mismatched sample rate. Check the engine's output rate vs the destination application's expected rate. Engines emit at their native rate (Kokoro 24 kHz, Chatterbox 24 kHz, LuxTTS 48 kHz, TADA 24 kHz).
- **Mastered audio is silent at the start** — A bug in the mastering normalize step. Try the "iAudio" target instead of ACX; iAudio's threshold is gentler.
- **ZIP export is huge** — Unmastered + every take is large. Use the project export with "Default takes only" checkbox to slim it down.
