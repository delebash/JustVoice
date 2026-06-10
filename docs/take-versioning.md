# Take versioning

Every render of a Block produces a **Take**. JustVoice keeps every take so you can iterate without losing earlier versions. Source-lineage is preserved across regenerates, effect applications, and engine swaps.

## What you see

In the Chapter editor, each Block row shows:

- A **prev / next** arrow pair plus the count: "Take 3 of 7".
- A dropdown listing every take with timestamps + a ★ marker on the **default** (the one that gets included in renders and exports).
- A **source-lineage pill** like "← from Take 2" when the current take was produced by regenerating from an earlier one. Click it to see the full chain (planned: Lineage panel).
- The audio player for the active take.

## Actions

| Button | What it does |
|---|---|
| ↻ Regenerate | Render the Block again. Produces a new take with `source_take_id` pointing at the current one. |
| Set as default | Make the selected take the default. Renders and exports use this take. |
| ⚖ Compare A/B | Open a side-by-side audio player to A/B test two takes of the same Block. |
| ★ Favorite | Tag the take. Bulk delete + cache prune skip favorited takes. |
| 🎛 Apply effect → new version | Run the takes through an effects chain. **Non-destructive** — produces a new take with effects baked in; the original survives. |
| Delete | Removes the take. Disabled when the take is the current default. |

## When to use it

- **Voice tuning.** Render the same Block 3-5 times with different temperature / exaggeration / cfg_weight settings, then A/B compare and pick the winner.
- **Voice-profile changes.** When you change a Persona's voice mid-book, you can re-render the affected Blocks without losing the original takes — useful for "do I actually prefer the new voice."
- **Effects exploration.** Apply Radio voice, Echo Chamber, Robotic, or a custom effect chain to test ideas. Each application is a new version; revert by setting the source take as default.

## Settings snapshot

Every take stores `settings_snapshot`: a frozen copy of every input that produced it — voice, engine, temperature, seed, effects chain, lexicon entries applied, persona LLM rewrite output if any. You can read this on any take to know exactly what produced it (the Scratchpad's Show JSON view, or the take detail panel in Studio → Takes).

## Cleanup

Disk usage grows fast with many takes. Three cleanup paths:

- **Bulk delete generations** from Settings → Data → bulk delete with filters (older than 30 days, unfavorited, per-voice, etc.).
- **Per-block delete** from the take navigator (one take at a time, blocked for the default).
- **Project export then delete** — export the project as ZIP, then delete the project; the renders go with it.

Source-lineage chains are preserved through deletes — if Take 3 was the source of Take 4 and you delete Take 3, Take 4's `source_take_id` becomes null but the chain history (in `settings_snapshot`) survives.
