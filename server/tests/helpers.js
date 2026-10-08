// SPDX-License-Identifier: MIT
// Test helpers shared by JustVoice's server suites (conftest.py / conftest_db.py's fixtures).
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDatabase } from "@delebash/llm-runner/platform/sql";
import { runMigrations } from "../src/database/migrations.js";
import { TABLES } from "../src/database/models.js";
import * as session from "../src/database/session.js";

// Nothing a test does may reach the family registry or a real cache.
const SANDBOX = mkdtempSync(path.join(tmpdir(), "jv-test-home-"));
process.env.JUST_AI_HOME = path.join(SANDBOX, "family");
process.env.LLM_RUNNER_CACHE = path.join(SANDBOX, "user-cache");

/** pytest's `tmp_path`: a fresh empty folder. */
export function tmpPath(prefix = "jv-test-") {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

/** conftest's `tmp_storage_dir`: `<tmp_path>/storage` (not created). */
export const tmpStorageDir = (tmp) => path.join(tmp, "storage");

/**
 * conftest_db's `tmp_db`: a fresh SQLite file in its own temp folder with every table and the
 * migrations run — and, like that fixture's engine, no foreign-key pragma (SQLite's default,
 * OFF). Returns the handle (Python yielded a session factory + the engine).
 */
export function tmpDb() {
  const dir = tmpPath("jv-test-db-");
  mkdirSync(dir, { recursive: true });
  const h = openDatabase(path.join(dir, "justvoice.test.db"), { foreignKeys: false });
  h.register(TABLES);
  h.createTables(TABLES);
  runMigrations(h);
  return h;
}

/** `init_db(tmp_path)` — the module database pointed at this test's own folder. */
export function initDbAt(dir) {
  session.initDb(dir);
  return session.cfg.handle;
}

/** Forget the module database (close it) — between tests that each init their own. */
export function closeModuleDb() {
  session.closeDb();
  session.cfg.dbPath = null;
}
