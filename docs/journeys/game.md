# Journey: Game dialogue — Marcus, solo game dev

> ⚠️ **DESIGN TARGET (banner added 2026-08-04).** This journey narrates the intended experience; several steps are NOT BUILT yet — CSV import uses FIXED headers (scene, character, text, delivery, pause_after_ms — only text required): there is no column-mapping UI and no per-project mapping memory; export filenames derive from source_ref or sNN_lNNN with no selectable pattern, and there is no changed-only export. The stable-id merge, stale derivation, and re-render-only-stale ARE real.

<!-- SPDX-License-Identifier: MIT -->

Marcus is building *Emberfall* in Unreal. His quest editor exports dialogue as
CSV: 124 lines, 9 NPCs, 6 quests. The line — not the chapter — is his unit of
work, and his line IDs are sacred: the game engine loads audio by ID.

Mock: `preview/journeys-preview.html#game/1`

## The path

1. **New project → kind picker.** He picks **Game dialogue**. Sidebar says
   **Lines**, master defaults to 48 kHz per-line mono, Studio collapses to
   Cast → Render (no LLM Script step — his CSV already names speakers).
2. **CSV import → column mapping.** One-time mapping: `dialogue_id → Line ID`,
   `speaker → Character`, `text → Line text`, `quest → Group`,
   `direction → Performance note`. Mapping is saved per project. Speakers
   become personas. Duplicate-ID check runs before import.
3. **Lines grid** is his home base: spreadsheet rows (ID · NPC · text · take
   status), grouped by quest, filterable by status. **Re-import** of the
   writers' next CSV revision updates text in place by ID; only lines whose
   text changed go *stale* — a banner offers "Re-render 12 changed lines".
4. **Studio · Cast at scale.** 9 NPCs in a table (cards don't scale);
   per-NPC voice + performance defaults (e.g. whisper + reverb send for the
   ghost). "Test line" previews the voice on a real line from the script.
5. **Studio · Render.** Whole batch fans out; per-quest progress; cache hits
   skip the engine; failed lines retry without blocking the batch.
6. **Export.** Folder per quest, file per line named by line ID
   (`Q01_Ashfall_Village/Q01_HALE_001.wav`), naming pattern selectable, plus
   `manifest.json` — one diffable entry per line (text, hash, duration, voice,
   rendered_at). "Export changed only" ships just the stale ones.
   Unreal `.uplugin` is future work and shown as a planned pill.

## Acceptance criteria

- Stable line IDs survive re-import; text changes mark takes stale, nothing
  duplicates.
- Export filenames are exactly the line IDs — the game build consumes them
  with zero renaming.
- `manifest.json` is deterministic and git-diffable.
- A 500-line project stays usable: grid virtualizes, batch render streams
  progress.
