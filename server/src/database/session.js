// SPDX-License-Identifier: MIT
// The one database handle — `justvoice.db` in the data folder, opened with better-sqlite3 through
// the kit's `openDatabase`, foreign keys on.
//
// `cfg` holds the live handle and the file's path. Tests and the factory reset assign both
// properties directly, so everything here reads `cfg` at call time and never keeps a copy.
//
// Opening (`initDb`) is: open → register the schema (column kinds and the computed defaults) →
// create every table the file is missing, with the schema's exact DDL and indexes → publish the
// handle. A table that already exists is left as it is: there are no column upgrades (pre-release,
// the user resets instead — the no-migrations rule).

import { mkdirSync } from "node:fs";
import path from "node:path";
import { purePath, samePath } from "@delebash/llm-runner/platform/data_paths";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { RuntimeError } from "@delebash/llm-runner/platform/py";
import { openDatabase } from "@delebash/llm-runner/platform/sql";
import { defaultDataDir } from "../paths.js";
import { TABLES } from "./models.js";

const log = getLogger("justvoice.database.session");

/** The database file's name inside the data folder (backup and restore look for it). */
const DB_FILE = "justvoice.db";

export const cfg = { handle: null, dbPath: null };

function closeQuietly(h) {
  try {
    h.close();
  } catch {
    /* already closed, or the file went away — nothing to keep */
  }
}

/**
 * Open the database in `dataDir` (the default data folder when none is given). Nothing happens
 * when a handle is already open and no folder — or the same folder — is asked for; a different
 * folder closes the open handle first (a test process builds many apps, each on its own folder).
 */
export function initDb(dataDir = null) {
  if (cfg.handle !== null) {
    if (dataDir == null) return;
    if (cfg.dbPath !== null && samePath(path.dirname(cfg.dbPath), dataDir)) return;
    closeQuietly(cfg.handle);
    cfg.handle = null;
  }
  const folder = dataDir ?? defaultDataDir();
  mkdirSync(folder, { recursive: true });
  cfg.dbPath = purePath(path.join(folder, DB_FILE));

  const h = openDatabase(cfg.dbPath, { foreignKeys: true });
  h.register(TABLES);
  h.createTables(TABLES);
  cfg.handle = h;
  log.info(`database ready at ${cfg.dbPath}`);
}

/** The open handle. Throws when the database has not been opened yet. */
export function getDb() {
  if (cfg.handle === null) throw new RuntimeError("the database is not open yet — initDb() runs at app startup");
  return cfg.handle;
}

/** The database file's path, or null before `initDb`. */
export function getDbPath() {
  return cfg.dbPath;
}

/** Close the handle (if any). The path is kept; a caller that wants it gone clears it. */
export function closeDb() {
  if (cfg.handle !== null) closeQuietly(cfg.handle);
  cfg.handle = null;
}
