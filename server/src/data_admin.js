// SPDX-License-Identifier: MIT
// Host wiring for the shared data backup/restore/reset router (the kit's `makeDataRouter`) —
// the port of justvoice/data_admin.py (JW's data_admin was the donor, 2026-08-06).
//
// - Backup/restore cover BOTH table sets on the one SQLite file (JV's domain tables + the
//   shared LLM tables) plus the file-backed content roots below. The engine/model caches stay
//   out — downloads re-fetch.
// - The include-audio choice is the kit DataManagement options seam: the UI sends
//   `?exclude=generations,captures` and the shared backup route skips those dirs.
// - `runFactoryReset` IS the factory reset — the one implementation (POST /v1/data/reset).

import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { LLM_TABLES } from "@delebash/llm-runner/llm";
import * as lifecycle from "@delebash/llm-runner/runner/lifecycle";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { makeDataRouter } from "@delebash/llm-runner/platform/data_api";
import * as appState from "./app_state.js";
import { runMigrations } from "./database/migrations.js";
import { TABLE_NAMES, TABLES } from "./database/models.js";
import * as dbSeed from "./database/seed.js";
import * as dbSession from "./database/session.js";
import * as llmBootstrap from "./llm_bootstrap.js";
import { construct, Settings } from "./models.js";
import { generationsRoot, lexiconsRoot, personasRoot, projectsRoot, voicesRoot } from "./paths.js";
import { LexiconStore } from "./storage/lexicons.js";
import { PersonaStore } from "./storage/personas.js";
import { VoiceStore } from "./storage/voices.js";

const log = getLogger("justvoice.data_admin");

const msg = (e) => e?.message ?? String(e);

/**
 * Clean slate for everything AI-resident (the family rule, 2026-07-11: no child keeps
 * running under pre-reset/pre-restore config while the UI claims the new one is active): the
 * shared LLM runner's children + VRAM ledger, the managed TTS engine slots, and any
 * runtime-registered external engines. Best-effort throughout — a reset/restore must never
 * fail on teardown. (The engine modules are another slice's; loaded lazily, as Python did.)
 */
export async function _stopAiEnginesBestEffort() {
  try {
    await lifecycle.getService().stop();
  } catch {
    /* best-effort */
  }
  try {
    const manager = await import("./engines/manager.js");
    await manager.getManager().unload();
  } catch (e) {
    log.warning(`engine teardown: managed-engine unload failed: ${msg(e)}`);
  }
  try {
    const { EngineRegistry } = await import("./engines/registry.js");
    const state = appState.getState();
    const registry = state.engines ?? null;
    if (registry !== null) {
      for (const engine of registry.all()) {
        try {
          await engine.unload();
        } catch {
          /* best-effort per engine */
        }
      }
      state.engines = new EngineRegistry();
    }
  } catch (e) {
    log.warning(`engine teardown: engine-registry reset failed: ${msg(e)}`);
  }
}

/** The content roots a backup carries (multi-GB model downloads stay out — they re-fetch).
 * `captures` has its own root — dictation recordings are user data. */
export function _assetDirs() {
  const dataDir = appState.getState().dataDir ?? null;
  if (dataDir === null) return {};
  return {
    voices: voicesRoot(dataDir),
    personas: personasRoot(dataDir),
    lexicons: lexiconsRoot(dataDir),
    projects: projectsRoot(dataDir),
    generations: generationsRoot(dataDir),
    captures: path.join(dataDir, "captures"),
  };
}

/**
 * Wipe to as-new-install — the one reset implementation. Returns tables cleared.
 *
 * Deletes every DB row AND the file-backed stores (personas, voices, lexicons, project JSON,
 * generation audio, capture recordings), clears the render cache, and resets settings to
 * defaults — keeping only the server host/port section so the running instance stays
 * reachable. Downloaded engine models on disk are NOT deleted (multi-GB).
 */
export async function runFactoryReset() {
  const state = appState.getState();

  // 0. Unload everything AI-resident FIRST, while the config it was spawned from still
  // exists (JW's donor lesson).
  await _stopAiEnginesBestEffort();

  // 1. The database resets the way a fresh install creates it: delete the SQLite file and
  // re-run initDb (create + migrations + seeds). Guarantees the post-reset schema is
  // identical to a new install — dropping tables in place kept legacy drift alive (user-hit
  // three times on 2026-06-12). Falls back to dropping tables when the DB isn't the module's
  // file-backed one (tests).
  let cleared = 0;
  const dbPath = dbSession.cfg.dbPath;
  let fileRecreated = false;
  if (dbPath !== null && dbSession.cfg.handle !== null) {
    dbSession.closeDb();
    const dataDir = path.dirname(dbPath);
    for (const suffix of ["", "-wal", "-shm"]) {
      const p = `${dbPath}${suffix}`;
      try {
        rmSync(p, { force: true });
      } catch (e) {
        log.warning(`factory reset: could not delete ${p}: ${msg(e)}`);
      }
    }
    // Windows can hold the file open — only count this path as done when the file is
    // actually gone; otherwise fall through to dropping tables in place.
    fileRecreated = !existsSync(dbPath);
    dbSession.cfg.dbPath = null;
    dbSession.initDb(dataDir);
    if (fileRecreated) {
      dbSeed.seedBuiltinEffectPresets();
      // The SAME file carries the shared LLM tables — re-wire storage at the NEW handle +
      // re-seed BOTH sets (the family's dual-table reset lesson).
      llmBootstrap.reseedSharedLlm(dbSession.cfg.handle);
      cleared = TABLE_NAMES.length;
    } else {
      log.warning("factory reset: DB file locked — dropping tables in place instead");
    }
  }
  if (!fileRecreated && dbSession.cfg.handle !== null) {
    const h = dbSession.cfg.handle;
    // (Python left foreign keys OFF on that pooled connection afterwards; the one
    // connection here gets back the setting it had.)
    const fkWas = h.raw.pragma("foreign_keys", { simple: true });
    h.exec("PRAGMA foreign_keys=OFF");
    try {
      const names = h
        .all("select name from sqlite_master where type = 'table' and name not like 'sqlite~_%' escape '~' order by name")
        .map((r) => r.name);
      for (const name of names) {
        h.exec(`DROP TABLE IF EXISTS "${name}"`);
        cleared += 1;
      }
    } finally {
      h.exec(`PRAGMA foreign_keys=${fkWas ? "ON" : "OFF"}`);
    }
    h.createTables(TABLES);
    runMigrations(h);
    dbSeed.seedBuiltinEffectPresets();
    // Dropped-in-place path: the shared tables were dropped with the rest — recreate +
    // reseed them on the same handle.
    llmBootstrap.reseedSharedLlm(h);
  }

  // 2. File-backed stores — blow away the dirs and re-instantiate the stores so their caches
  // drop too (user-hit 2026-06-12: personas survived reset). Captures audio joins the wipe
  // (the as-new-install promise). Engine model downloads stay.
  const dataDir = state.dataDir ?? null;
  if (dataDir !== null) {
    for (const root of [
      personasRoot(dataDir),
      voicesRoot(dataDir),
      lexiconsRoot(dataDir),
      projectsRoot(dataDir),
      generationsRoot(dataDir),
      path.join(dataDir, "captures"),
    ]) {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch (e) {
        log.warning(`factory reset: could not clear ${root}: ${msg(e)}`);
      }
    }
    state.personas = new PersonaStore(dataDir);
    state.voices = new VoiceStore(dataDir);
    state.lexicons = new LexiconStore(dataDir);
  }

  // 3. Render cache — memory + disk. (Engine teardown already ran in step 0.)
  const cache = state._renderCache ?? null;
  if (cache !== null) {
    try {
      cache.clear();
    } catch (e) {
      log.warning(`factory reset: cache clear failed: ${msg(e)}`);
    }
  }

  // 4. Settings to defaults; the live server section survives so the instance stays
  // reachable on its current host/port.
  const current = state.settings.get();
  state.settings.set(construct(Settings, { server: current.server }));

  log.warning(`FACTORY RESET executed — ${cleared} tables cleared`);
  return cleared;
}

export function getDataRouter() {
  return makeDataRouter({
    getDbPath: () => dbSession.cfg.dbPath,
    metadata: [TABLES, LLM_TABLES],
    runReset: runFactoryReset,
    assetDirs: _assetDirs,
    // A restore replaces routing/models/engine config under the live app — same clean-slate
    // rule as reset.
    onReplaced: _stopAiEnginesBestEffort,
  });
}
