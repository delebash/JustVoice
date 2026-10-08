// SPDX-License-Identifier: MIT
// One-time settings→DB migration for LLM providers — convergence part 2 (the port of
// justvoice/engines/llm/migrate_providers.py).
//
// Until 2026-08-01 JustVoice persisted its LLM providers in `settings.engines.llm[]`. Full
// convergence moves provider storage to the shared DB table (`llm_providers`, owned by
// `installLlm`), the same place JustWrite keeps them — one storage, one CRUD surface, one
// registry boot path.
//
// This copies each settings row into the DB store ONCE. Idempotent by id-existence: a row
// already in the DB (migrated earlier, or user-edited since) is never touched, so re-running
// on every boot is safe and user edits win forever after. The settings list stays as dormant
// legacy data, but NOTHING reads it anymore.

import { stores } from "@delebash/llm-runner/llm";
import { getLogger } from "@delebash/llm-runner/platform/log";

const log = getLogger("justvoice.engines.llm.migrate_providers");

/** Copy `settings.engines.llm[]` rows into the shared DB provider store. Returns how many rows
 * were migrated (0 on every boot after the first). */
export function migrateSettingsProvidersToDb(settings) {
  const store = stores.getProviderStore();
  let migrated = 0;
  for (const cfg of [...((settings.engines && settings.engines.llm) || [])]) {
    try {
      if (store.get(cfg.id) === null) {
        store.add(cfg);
        migrated += 1;
      }
    } catch (e) {
      // one bad legacy row must not kill boot
      log.warning(`provider migration skipped '${cfg?.id ?? "?"}': ${e?.message ?? e}`);
    }
  }
  if (migrated) log.info(`migrated ${migrated} LLM provider(s) from settings.engines.llm to the DB store`);
  return migrated;
}
