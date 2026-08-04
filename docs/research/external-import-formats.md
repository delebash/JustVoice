# External TTS tool import formats — research

## Status

Research doc for plan task #72. Surveys the project-export shapes of
ElevenLabs / Resemble / Speechify / Murf / Coqui / OpenVoice so JustVoice's
importer (the JustWrite-adapter pattern at `server/justvoice/imports/adapters/`)
can absorb projects from them.

## TL;DR

| Tool | Export shape | Maps cleanly into JustVoice? | Importer effort |
|---|---|---|---|
| ElevenLabs Studio | Project ZIP with `manifest.json` + per-chapter HTML + cast roster | Yes — direct map to Project / Scene / Block | Small |
| Resemble.ai | Project JSON with `clips[]` array (text + voice_id + take metadata) | Mostly — flatten clips into a single Scene per project | Small |
| Speechify | Book project JSON: `chapters[]` with `text` + `voice_id` per chapter | Yes — direct Scene-per-chapter map | Small |
| Murf | Sheet-based CSV/XLSX export (rows: voice + text + delivery + duration) | Yes — one Scene, one Block per row | Small |
| Coqui Studio | Project YAML + audio file references | Partial — voice cloning settings don't translate | Medium |
| OpenVoice | Folder of WAV references + JSON metadata | Partial — depends on reference-WAV resolution | Medium |

## ElevenLabs Studio export

**Shape:** ZIP archive at `https://api.elevenlabs.io/v1/studio/projects/{project_id}/archive` containing:
- `manifest.json` — `{ name, voice_assignments: { speaker_id: voice_id }, chapters: [{ id, name, content_html }] }`
- `chapters/<chapter_id>.html` — per-chapter HTML with `<span data-speaker="...">` tags wrapping each speaker turn
- `voices.json` — list of voice descriptors used

**Maps to JustVoice:** ElevenLabs `chapters` → Scenes; HTML `<span data-speaker>` tags → Blocks with `persona_id` set; voice_assignments → ProjectPersona m2m + Persona.voice_id. Renders cleanly into a `project_type='audiobook'` project.

**Importer effort:** Small (~150 LOC). Reuse the JustWrite adapter pattern; the HTML walk + span extraction is the only new code.

## Resemble.ai

**Shape:** JSON via their REST `/v2/projects/{id}/export`:
```json
{
  "project_name": "...",
  "voices": [{"id": "...", "name": "..."}],
  "clips": [
    {"text": "...", "voice_uuid": "...", "take_count": 3, "approved_take_id": "..."}
  ]
}
```

**Maps to JustVoice:** clips flatten into Block rows in a single auto-created Scene (Resemble doesn't model chapters). Voice list → Personas (resemble's voice ≈ JustVoice persona since each Resemble voice maps to one character).

**Importer effort:** Small. The take metadata maps onto JustVoice's Take versioning if we preserve `approved_take_id` → Take.is_default.

## Speechify

**Shape:** Book project JSON from their SDK export:
```json
{
  "book_title": "...",
  "author": "...",
  "chapters": [
    {"title": "...", "content": "<paragraph>...</paragraph>", "voice_id": "..."}
  ]
}
```

Single voice per chapter — Speechify doesn't surface per-character casting in its exports, so multi-speaker books arrive as "one voice per chapter".

**Maps to JustVoice:** chapters → Scenes. Content → Blocks (split by paragraph). voice_id → ProjectPersona binding. Resulting JustVoice project is single-persona-per-chapter — users would run Studio Script's Analyze + Apply to re-attribute per-character if the book is multi-voice.

**Importer effort:** Small (~120 LOC). Bigger consideration: Speechify's voice IDs don't map to JustVoice's bundled voices, so the importer creates placeholder Personas the user re-binds.

## Murf

**Sheet-based exports** (CSV/XLSX): rows are `[voice_name, text, speed, pitch, pause_after_ms, duration_ms]`. No project structure — pure flat list.

**Maps to JustVoice:** Single Scene per import. Each row → Block with voice_name resolved to Persona.name match; speed/pitch/pause go into Block.metadata.delivery overrides.

**Importer effort:** Small (~80 LOC). Reuse the existing CSV adapter pattern (`csv_lines.py`).

## Coqui Studio

**Shape:** Project YAML + a directory of reference WAVs:
```yaml
voices:
  - id: ...
    clone_source: reference/voice_a.wav
    pitch_shift: -2
chapters:
  - id: ...
    title: ...
    lines:
      - voice_id: ...
        text: ...
```

**Maps to JustVoice:** chapters → Scenes; lines → Blocks. The clone_source references need uploading to JustVoice's voice store first — that's the "Medium effort" part.

**Importer effort:** Medium. The flat schema port is small but reference-WAV ingestion + clone-voice creation in JustVoice's Voice store layer is multi-step.

## OpenVoice

**Shape:** Output directory with WAVs + a single JSON: `{ "lines": [{ "text", "voice_path", "output_path" }] }`. Voice cloning happens at render time, not at project-definition time.

**Maps to JustVoice:** lines → Blocks in a single Scene. Voice paths need clone-into-JustVoice handling — same as Coqui.

**Importer effort:** Medium. Same WAV-ingestion complexity as Coqui.

## What JustVoice needs to do

1. **One adapter per supported tool**, under `server/justvoice/imports/adapters/`. Each implements `parse(file_handle) -> StandardImport`. The existing `justwrite.py` is the template.
2. **StandardImport schema stays as-is** — every tool's export normalizes through it before hitting the Project/Scene/Block writer.
3. **Voice/Persona collision resolution**: when an imported tool's voice/persona ID conflicts with an existing JustVoice entry, default to "create new Persona with imported_from=<tool>, imported_id=<id>" so the originals stay clean.
4. **Reference-WAV ingestion** for Coqui/OpenVoice: stream the referenced WAV files into JustVoice's voice-store via the existing `voices.py` upload path.

## Implementation order

1. Murf CSV — smallest, fastest path. One day of work.
2. Speechify — book-shaped imports are a clear audiobook fit. Two days.
3. Resemble — handles the take-versioning interop. Two-three days.
4. ElevenLabs — biggest feature surface but biggest user pull. Three-four days including the HTML walker.
5. Coqui + OpenVoice — defer until there's user demand. Reference-WAV ingestion is heavier than the other adapters combined.

Not in scope: Audacity Labels (already supported), SRT (already supported), JustWrite (the existing first-class adapter).

## Links

- Plan: `docs/research/persona-voiceprofile-multiuse-design.md`
- Standard import schema: `server/justvoice/imports/standard_schema.py`
- Existing adapters: `server/justvoice/imports/adapters/`
- CONTRACT.md: the external HTTP boundary
