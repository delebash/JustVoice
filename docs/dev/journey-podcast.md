# Journey: Podcast — Priya, producer

> ⚠️ **DESIGN TARGET — kept live as the Timeline/episode-export spec (moved to
> dev docs 2026-08-06, user's call).** This journey narrates the intended experience;
> several steps are NOT BUILT yet — the multi-track timeline (the Stories tab is a
> placeholder), auto-lay onto per-speaker tracks, music-bed ducking, ad markers,
> per-track stems, and ID3 show art do not exist today. Podcast projects work through
> Chapters + Studio. Banner corrections (2026-08-06, code-verified): the podcast
> mastering preset's true peak is **−1.0 dBFS**, not −1.5 (`models.py` MasterPreset),
> and **nothing switches mastering by kind** — only an audiobook *import* sets `acx`;
> Studio render sends no `master` at all. Also wrong in step 1: podcast Studio does
> NOT collapse to Cast → Render — only game skips Script (`StudioView.vue`); podcast
> gets the full Cast → Script → Render → Export.

<!-- SPDX-License-Identifier: MIT -->

Priya produces *Signal & Noise*, a 3-host tech show. Sometimes she has a
scripted episode in markdown; sometimes she writes it directly in the app.
Her deliverable is one mastered episode file for the feed.

Mock: `preview/journeys-preview.html#podcast/1`

## The path

1. **New project → kind picker.** She picks **Podcast**. Sidebar says
   **Episodes** and gains **Timeline**; master defaults to −16 LUFS stereo;
   Studio is Cast → Render (speaker labels come from the script, no LLM step).
2. **Two ways into an episode**, converging on the same shape:
   - **Import** `ep42_script.md` — `SARAH:` / `JIN:` / `MAVE:` labels are
     detected, `[laughs]`-style tags preserved → 38 segments, 3 speakers.
   - **Write in app** — pick a speaker per paragraph, drop paralinguistic
     tags inline, add music/ad markers as you go.
3. **Segments view.** The episode as speaker-labeled rows with inline tag
   pills; music and ad markers sit between rows.
4. **Studio · Cast.** Three speakers → three voices. Tag support is surfaced
   per engine (supported tags perform; unsupported are stripped + logged).
5. **Timeline** (the Stories surface, grown up). Rendered segments auto-lay
   end-to-end on per-speaker voice tracks using a pause profile; music bed
   auto-ducks under voice; SFX/ad slots are draggable blocks.
6. **Export.** One episode MP3/WAV/AAC at −16 LUFS integrated, −1.5 dBTP,
   chapters from markers, ID3 show art. Loudness checklist mirrors the ACX
   one — same mastering engine, different target, switched by project kind.

## Acceptance criteria

- Markdown speaker detection handles `NAME:` and `**NAME:**` forms; unknown
  labels become new personas.
- Tags round-trip: kept in segment text, performed by capable engines,
  stripped-with-log otherwise.
- Timeline edits never re-render audio — assembly is non-destructive over
  rendered takes.
- Per-track stems export alongside the mixed master.
