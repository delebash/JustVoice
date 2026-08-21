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


// ── Dropdown options over capability rows — the ONE builder ───────────
//
// Every model dropdown in the app rides these two helpers (user ruling
// 2026-08-21: "we should reuse same mechanism"): the load state comes
// from the engines store — the SAME store the topbar pill and the
// Engines tab read, refreshed by the jv:health-refresh event — and the
// list is alphabetical, always. The vocabulary matches the rest of the
// app: "· loaded" / "(not loaded)" / "(not installed)".

function statusSuffix(engine) {
  if (engine.status === "loaded") return " · loaded";
  if (engine.status === "not_installed") return " (not installed)";
  return " (not loaded)";
}

/** One option per capability ROW (checkpoint family) — value = rowId. */
export function rowOptions(rows, engines, field) {
  return capableRows(rows, engines, field)
    .map((b) => ({
      name: b.row.display_name || b.rowId,
      label: `${b.row.display_name || b.rowId}${statusSuffix(b.engine)}`,
      value: b.rowId,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    .map(({ label, value }) => ({ label, value }));
}

/** One option per ENGINE (deduped) — value = engine id. For pickers that
 *  choose the engine itself (Import's "Model that speaks as this clip",
 *  the Dataset Builder's Model). */
export function engineOptionsFor(rows, engines, field) {
  const seen = new Set();
  const out = [];
  for (const b of capableRows(rows, engines, field)) {
    if (seen.has(b.engine.id)) continue;
    seen.add(b.engine.id);
    out.push({
      name: b.engine.name || b.engine.id,
      label: `${b.engine.name || b.engine.id}${statusSuffix(b.engine)}`,
      value: b.engine.id,
    });
  }
  return out
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    .map(({ label, value }) => ({ label, value }));
}
