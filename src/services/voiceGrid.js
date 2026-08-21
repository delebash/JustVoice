// SPDX-License-Identifier: MIT
// The voices library grid's row rules.
//
// Pure, and out of the view, for one reason: the grid moved onto the kit's
// `UiTable` on 2026-08-21 and the row STATE did not survive the move. It was
// pushed onto a div inside the name cell, so an orphan row dimmed one cell and
// the playing row tinted one cell. Nothing caught it, because the renderer gate
// loads views and counts JS errors — it never plays a voice. Rules that decide
// what a row LOOKS like belong somewhere a unit test can reach them.

/**
 * State classes for one row of the voices grid, in the shape `:class` takes.
 * Passed to `UiTable`'s `:row-class`, so they land on the `<tr>` itself.
 *
 * @param {object} row        the voice row
 * @param {Array}  orphanIds  ids whose engine is no longer installed
 * @param {string} playingId  the voice playing right now, or ""
 */
export function voiceRowState(row, orphanIds, playingId) {
  return {
    "row-orphan": (orphanIds || []).includes(row?.id),
    // The `row?.id` guard is load-bearing: with nothing playing, `playingId` is
    // "" and a row that somehow has no id would otherwise match it.
    "voices-view__row--playing": !!row?.id && playingId === row.id,
  };
}
