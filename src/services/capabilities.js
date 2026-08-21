// SPDX-License-Identifier: MIT
// Reading the engine capability surface — GET /v1/engines/capabilities.
//
// The rows are keyed by engine id OR by variant id, and a variant row is
// the one that tells the truth: an engine-level row is the UNION across
// its checkpoint families. Qwen3 is the case that forced this — its
// engine row says "clones" because the Base family clones, while the
// CustomVoice family cannot, so an engine-level answer offers a tick the
// chosen checkpoint can't honour.
//
// Both surfaces that ask "which engines can do X" (the Voices page's
// new-voice tabs, and Train's base picker) resolve rows through here, so
// the rule lives once.

/**
 * Rows that can do `field`, each resolved back to its engine.
 *
 * @param {object} rows     the `engines` map from GET /v1/engines/capabilities
 * @param {Array}  engines  the engines store's items
 * @param {string} field    e.g. "supports_voice_cloning" / "supports_training"
 * @returns {Array<{rowId: string, row: object, engine: object, isVariant: boolean}>}
 */
export function capableRows(rows, engines, field) {
  if (!field) return [];
  const byEngine = new Map((engines || []).map((e) => [e.id, e]));
  const out = [];
  for (const [rowId, row] of Object.entries(rows || {})) {
    if (!row?.[field]) continue;
    // A row id is either an engine id, or a variant id whose engine id is
    // a prefix of it (qwen3-base → qwen3, chatterbox-turbo → chatterbox).
    const engine = byEngine.get(rowId)
      || (engines || []).find((e) => rowId.startsWith(`${e.id}-`));
    if (!engine) continue;
    // Marked-for-removal engines are never OFFERED for a new voice —
    // the 2026-08-17 roster ruling's picker half, wired 2026-08-21 (the
    // Engines tab already badges + hides them; this closes the Clone /
    // Design / Train / Dataset-builder pickers). Existing voices on a
    // deprecated engine keep rendering — this filters offers, not use.
    if ((engine.deprecated || "").trim()) continue;
    out.push({ rowId, row, engine, isVariant: rowId !== engine.id });
  }
  // Where an engine has variant rows, its union row is noise — it would
  // list the same engine twice and, for training, offer a row that
  // carries no defaults.
  const withVariants = new Set(out.filter((o) => o.isVariant).map((o) => o.engine.id));
  return out.filter((o) => o.isVariant || !withVariants.has(o.engine.id));
}
