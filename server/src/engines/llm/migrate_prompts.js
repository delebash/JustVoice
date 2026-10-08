// SPDX-License-Identifier: MIT
// One-time prompt migration: `jv_feature_prompts` → the SHARED `feature_prompts` table + preset
// tunable lift (convergence part 3's data half; ruling 1+9, 2026-08-05: prompt TEXT always
// migrates preserving user edits — seed-if-missing, never clobber; a row's hand-changed
// temperature/think lifts into that feature's assigned preset). The port of
// justvoice/engines/llm/migrate_prompts.py.
//
// Runs at boot in two halves around the shared seed:
//
//   migrateJvPromptsToShared()        BEFORE seedLlm — an EDITED old row is inserted under its
//       new key first, so the shared insert-if-missing seed skips it (the edit wins). UNEDITED
//       rows are NOT copied: the new seed defaults are deliberately better shaped, and copying
//       an unedited old row would pin the worse shape forever.
//
//   liftEditedTunablesIntoPresets()   AFTER seedLlm — presets must exist before their
//       temperature/think can be overwritten. Marker-guarded one-time
//       (`jv_prompt_tunables_lifted`), and on success it DROPS the legacy table — this module
//       reads the legacy rows by raw SQL and is the table's last consumer.
//
// Edit detection compares against the OLD seed defaults, reconstructed here: the old system
// texts are the same constants the new seed uses (they never forked), and the old user
// templates were the single-brace attribution template for the tier pair and "" everywhere
// else. Both functions are synchronous over the database but load the extraction modules
// (another slice's) on first use, so they are async.

import * as llmDb from "@delebash/llm-runner/llm/db";
import { getLogger } from "@delebash/llm-runner/platform/log";
import * as dbSession from "../../database/session.js";

const log = getLogger("justvoice.engines.llm.migrate_prompts");

// Old key → new key (the family dotted spelling; `identify` predates it).
const KEY_RENAMES = { identify: "speaker_attribution.identify" };

// The attribution user template's pre-shared substitution tokens → today's {{var}} names
// (`characters` is `speakers` since 2026-09-29).
const BRACE_TOKENS = { characters: "speakers", corrections: "corrections", paragraphs: "paragraphs" };

// The OLD seeded attribution user template, verbatim (single-brace .replace tokens —
// extraction/prompts.py's USER_TEMPLATE before the {{var}} move).
const OLD_ATTR_USER_TEMPLATE = `Characters in this scene:
{characters}
{corrections}
Paragraphs (dialogue segments tagged inline):

{paragraphs}

Return only the JSON array, one entry per [D#] in the order they appear.
`;

export function _convertBraces(text) {
  for (const [oldName, newName] of Object.entries(BRACE_TOKENS)) {
    text = text.replaceAll(`{${oldName}}`, `{{${newName}}}`);
  }
  return text;
}

/** The retired seeder's per-key defaults, for edit detection. System texts import from the
 * same homes the old seeder used — they never forked. */
async function oldSeedDefaults() {
  const { IDENTIFY_SYSTEM } = await import("../../extraction/identify.js");
  const { DIRECT_SYSTEM, GUIDED_SYSTEM } = await import("../../extraction/prompts.js");
  const { DEFAULT_FEATURE_PROMPTS } = await import("../../seed_feature_prompts.js");
  return {
    smart_assign: { system: DEFAULT_FEATURE_PROMPTS.smart_assign.system, user_template: "", temperature: 0.2, think: false },
    show_notes: { system: DEFAULT_FEATURE_PROMPTS.show_notes.system, user_template: "", temperature: 0.4, think: false },
    "speaker_attribution.guided": { system: GUIDED_SYSTEM, user_template: OLD_ATTR_USER_TEMPLATE, temperature: 0.2, think: false },
    "speaker_attribution.direct": { system: DIRECT_SYSTEM, user_template: OLD_ATTR_USER_TEMPLATE, temperature: 0.2, think: false },
    identify: { system: IDENTIFY_SYSTEM, user_template: "", temperature: 0.2, think: false },
  };
}

/** The legacy table's rows via raw SQL — [] when the table is absent (fresh install, or
 * already migrated + dropped). */
function oldRows() {
  const h = dbSession.cfg.handle;
  if (h === null) return [];
  let rows;
  try {
    rows = h.all('SELECT "key", feature, system, user_template, temperature, think FROM jv_feature_prompts');
  } catch {
    return []; // no such table
  }
  return rows.map((r) => ({
    key: r.key,
    feature: r.feature,
    system: r.system,
    user_template: r.user_template,
    temperature: r.temperature,
    think: Boolean(r.think),
  }));
}

/** DROP the migrated table (idempotent). Only called from the lift's success paths — a failed
 * migration must keep the rows for the next boot. */
function dropLegacyTable() {
  const h = dbSession.cfg.handle;
  if (h === null) return;
  try {
    h.exec("DROP TABLE IF EXISTS jv_feature_prompts");
  } catch (e) {
    log.warning(`could not drop legacy jv_feature_prompts: ${e?.message ?? e}`);
  }
}

/** Insert every EDITED legacy row into the shared table under its new key. Idempotent by
 * construction: insert only when the new key is absent. */
export async function migrateJvPromptsToShared() {
  const rows = oldRows();
  if (!rows.length) return;
  const oldSeeds = await oldSeedDefaults();
  const { DEFAULT_FEATURE_PROMPTS: NEW_SEEDS } = await import("../../seed_feature_prompts.js");
  try {
    const s = llmDb.session();
    const existing = new Set(s.all('select "key" from feature_prompts').map((r) => r.key));
    let migrated = 0;
    s.tx(() => {
      for (const row of rows) {
        const newKey = KEY_RENAMES[row.key] ?? row.key;
        const newSeed = Object.hasOwn(NEW_SEEDS, newKey) ? NEW_SEEDS[newKey] : null;
        const oldSeed = Object.hasOwn(oldSeeds, row.key) ? oldSeeds[row.key] : null;
        if (newSeed === null || oldSeed === null || existing.has(newKey)) continue;
        const systemEdited = row.system !== oldSeed.system;
        const userEdited = row.user_template !== oldSeed.user_template;
        if (!(systemEdited || userEdited)) continue; // untouched → the new seed's better shape wins
        s.insert("feature_prompts", {
          key: newKey,
          feature: String(newSeed.feature || newKey),
          system: systemEdited ? row.system : String(newSeed.system || ""),
          user_template: userEdited ? _convertBraces(row.user_template) : String(newSeed.user_template || ""),
          built_in: true,
          json_mode: Boolean(newSeed.json_mode ?? false),
          json_schema: String(newSeed.json_schema || ""),
        });
        migrated += 1;
      }
    });
    if (migrated) log.info(`migrated ${migrated} edited jv_feature_prompts row(s) into the shared table`);
  } catch (e) {
    // migration must never stop a boot
    log.warning(`jv prompt migration failed (rows kept for the next boot): ${e?.message ?? e}`);
  }
}

/** Once: a legacy row's hand-changed temperature/think overwrites its feature's ASSIGNED
 * preset (the one-source rule — tunables live on presets). After seedLlm so the preset rows
 * exist. On success (the fresh lift or the marker saying it already happened) the legacy table
 * drops. */
export async function liftEditedTunablesIntoPresets() {
  const rows = oldRows();
  if (!rows.length) return;
  const oldSeeds = await oldSeedDefaults();
  const { DEFAULT_FEATURE_PRESETS } = await import("../../seed_presets.js");
  try {
    const s = llmDb.session();
    if (s.get("runner_setting", "jv_prompt_tunables_lifted")) {
      // Lifted on an earlier boot (before the drop existed) — the table is migrated residue.
      dropLegacyTable();
      return;
    }
    let lifted = 0;
    s.tx(() => {
      for (const row of rows) {
        const oldSeed = Object.hasOwn(oldSeeds, row.key) ? oldSeeds[row.key] : null;
        if (oldSeed === null) continue;
        const newKey = KEY_RENAMES[row.key] ?? row.key;
        const presetId = DEFAULT_FEATURE_PRESETS[newKey] ?? "";
        const preset = presetId ? s.get("engine_presets", presetId) : null;
        if (!preset) continue;
        const patch = {};
        if (row.temperature !== (oldSeed.temperature ?? null)) {
          patch.temperature = row.temperature;
          lifted += 1;
        }
        if (Boolean(row.think) !== Boolean(oldSeed.think ?? false)) {
          patch.think = Boolean(row.think);
          lifted += 1;
        }
        if (Object.keys(patch).length) s.update("engine_presets", patch, { id: presetId });
      }
      s.insert("runner_setting", { key: "jv_prompt_tunables_lifted", value: "1" });
    });
    if (lifted) log.info(`lifted ${lifted} hand-changed prompt tunable(s) into presets`);
    // Both halves succeeded — the legacy rows are fully absorbed.
    dropLegacyTable();
  } catch (e) {
    log.warning(`jv tunable lift failed (presets keep seed values): ${e?.message ?? e}`);
  }
}
