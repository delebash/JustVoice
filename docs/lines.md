# Lines — the game home base

Game projects live line-by-line, not chapter-by-chapter. The Lines tab is every
line of the project in one grid: stable id, character, text, and a **derived
status** — `none` (never rendered), `rendered`, or `stale` (rendered, then the
text changed).

## The id is sacred

Your line ids come from your import (`source_ref` in the CSV, or generated
`sNN_lNNN`) and never change. That's what makes the writers'-room loop work:

1. The writers send a new sheet. **Re-import it** — lines merge **by id**.
2. Only lines whose text actually changed go `stale`; everything else keeps its
   rendered take untouched.
3. **Re-render N changed lines** does exactly that — the 480 lines that didn't
   change don't cost a render.

## Export

The per-line export writes one WAV per line, named by your `source_ref` (or the
generated id), plus a JSON manifest — drop the folder into your engine's import
pipeline. CSV import expects fixed headers — `scene, character, text, delivery,
pause_after_ms` (only `text` is required); see
[Import formats](import-formats.md).
