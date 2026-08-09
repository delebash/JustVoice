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
   change don't cost a render. The batch runs as one render job on the server:
   lines are grouped by engine (one model load per engine instead of one per
   speaker change), the task strip shows live `done/total` progress, and Cancel
   stops cleanly after the line in flight. A line that fails no longer stops
   the rest — the others keep rendering, the failures stay `stale`, and the
   same button picks them up on the next pass. If the server restarts
   mid-batch, nothing is lost: finished lines keep their takes and the
   remaining ones are still `stale`.

## Export

The per-line export writes one WAV per line, named by your `source_ref` (or the
generated id), plus a JSON manifest — drop the folder into your engine's import
pipeline. CSV import expects fixed headers — `scene, character, text, delivery,
pause_after_ms` (only `text` is required); see
[Import & export](import-and-export.md).
