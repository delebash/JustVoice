# Journey: Audiobook — Sarah, indie author

> *Note (2026-08-04): near-accurate against the shipped app; the per-chapter script/render status columns described in step 3 are not in the current Projects chapters table.*

<!-- SPDX-License-Identifier: MIT -->

Sarah finished her novel *Stillwater* (8 chapters, ~32k words) and wants an
audiobook she can submit to ACX. She may have written it in JustWrite, or she
may just have an EPUB/DOCX — both paths land in the same place.

Mock: `preview/journeys-preview.html#audiobook/1`

## The path

1. **New project → kind picker.** She picks **Audiobook**. This sets the
   sidebar vocabulary (Chapters), the default mastering preset (ACX −20 LUFS),
   the Studio steps (Cast → Script → Render), and the export surface (M4B +
   chapter WAVs).
2. **Import.** She drops `stillwater.epub`. JustVoice splits on headings,
   shows a dry-run table (chapter titles, word counts, est. audio minutes,
   front matter auto-skipped), and imports nothing until she confirms.
   An EPUB carries no speaker info — the UI says so and points at Script.
3. **Chapters** is her home base: per-chapter script status (`attributed` /
   `2 new speakers` / `not analyzed`) and render status (`mastered` /
   `rendering` / `—`).
4. **Studio · Cast.** Narrator (her cloned voice) + characters. Smart-assign
   proposes from the voice library; she overrides per card.
5. **Studio · Script.** LLM attributes each line (speaker, kind, confidence).
   Speakers found that aren't in the cast surface in a banner:
   *"Create personas & add to cast"* or *"Merge into existing…"* — this is how
   an EPUB grows a cast without a JustWrite project behind it.
6. **Studio · Render.** Chapter batch render; hash cache means only changed
   lines hit the engine; ACX mastering applied per chapter with a pass/fail
   check column.
7. **Export.** One M4B with chapter markers (AAC), or per-chapter WAV/MP3.
   ACX checklist (RMS window, peak, noise floor, room tone, credits) is green
   before the button is.

## Acceptance criteria (for the real implementation)

- EPUB/DOCX/MD/TXT/.jw.json all reach the same dry-run preview.
- Script-discovered speakers create personas with `imported_from` provenance
  and join the cast in one click.
- Re-render after a text edit touches only the edited lines (cache by text hash).
- ACX check runs per chapter and blocks nothing — it informs.
