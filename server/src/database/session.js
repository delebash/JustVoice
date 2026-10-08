// SPDX-License-Identifier: MIT
// The JustVoice SQLite database handle (the port of justvoice/database/session.py, whose
// init flow was lifted from an upstream MIT codebase — see voicebox-pin.txt).
//
// One better-sqlite3 handle (the kit's platform/sql.js) replaces SQLAlchemy's engine +
// session factory: every store reaches it through `getDb()` (or `cfg.handle`, which is null
// until `initDb` runs — the Python stores' "SessionLocal is None" check). Foreign keys are
// turned ON for the connection, as Python's connect hook did per connection; the kit's
// shared LLM tables live in the same file (the app passes this handle to installLlm).
//
// `cfg` holds the module state Python kept in globals (`engine`, `SessionLocal`,
// `_db_path`) — a test assigns its properties where Python monkeypatched them.

import { mkdirSync } from "node:fs";
import path from "node:path";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { RuntimeError } from "@delebash/llm-runner/platform/py";
import { purePath, samePath } from "@delebash/llm-runner/platform/data_paths";
import { openDatabase } from "@delebash/llm-runner/platform/sql";
import { defaultDataDir } from "../paths.js";
import { runMigrations } from "./migrations.js";
import { TABLES } from "./models.js";

const logger = getLogger("justvoice.database.session");

/** `handle` — the open database (null before initDb); `dbPath` — its file. */
export const cfg = { handle: null, dbPath: null };

/**
 * Open the database, run migrations, create tables. Idempotent for the same target —
 * re-inits when a DIFFERENT data dir is explicitly requested (tests: without this, the first
 * boot in a process pinned every later create_app(tmp) to the first dir). `dataDir`
 * defaults to `paths.defaultDataDir()`.
 */
export function initDb(dataDir = null) {
  if (cfg.handle !== null) {
    if (dataDir == null || (cfg.dbPath !== null && samePath(path.dirname(cfg.dbPath), dataDir))) return;
    try {
      cfg.handle.close();
    } catch {
      /* already closed */
    }
    cfg.handle = null;
  }
  const dir = dataDir ?? defaultDataDir();
  mkdirSync(dir, { recursive: true });
  cfg.dbPath = purePath(path.join(dir, "justvoice.db"));
  // Foreign keys must be turned on per connection for SQLite; better-sqlite3 has one.
  const h = openDatabase(cfg.dbPath, { foreignKeys: true });
  h.register(TABLES);
  // Idempotent column-existence migrations BEFORE create-tables, so schema changes land on
  // the existing tables (and creating is a no-op for tables already there).
  runMigrations(h);
  // Then ensure any net-new tables exist.
  h.createTables(TABLES);
  cfg.handle = h;
  logger.info(`Database: ${cfg.dbPath}`);
}

/** The open database handle (FastAPI's `get_db` dependency yielded a session). */
export function getDb() {
  if (cfg.handle === null) throw new RuntimeError("Database not initialized. Call init_db() during app startup.");
  return cfg.handle;
}

/** The resolved DB path, or null if initDb() hasn't run yet. */
export const getDbPath = () => cfg.dbPath;

/** Close the handle (and forget it) — factory reset's `engine.dispose()`, and tests. */
export function closeDb() {
  if (cfg.handle !== null) {
    try {
      cfg.handle.close();
    } catch {
      /* already closed */
    }
  }
  cfg.handle = null;
}
