// SPDX-License-Identifier: MIT
// Test helpers shared by JustVoice's server suites (conftest.py / conftest_db.py's fixtures).
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDatabase } from "@delebash/llm-runner/platform/sql";
import { TABLES } from "../src/database/models.js";
import * as session from "../src/database/session.js";

// Nothing a test does may reach the family registry or a real cache.
const SANDBOX = mkdtempSync(path.join(tmpdir(), "jv-test-home-"));
process.env.JUST_AI_HOME = path.join(SANDBOX, "family");
process.env.LLM_RUNNER_CACHE = path.join(SANDBOX, "user-cache");

/**
 * One request to a Hono app (`app.request` — no socket, no port), answered the way Fastify's
 * `inject` answered: `{statusCode, headers, body, payload, rawPayload, json()}` — `headers` a plain
 * object with lowercase names, `body`/`payload` the text, `rawPayload` a Buffer, `json()`
 * synchronous (the body is read first).
 *   payload: an object is sent as JSON (with `content-type: application/json`, as inject did); a
 *            string or Buffer as it is, with no content type unless `headers` names one (a string
 *            goes as bytes, so the platform adds no text/plain type — the family's rules then read
 *            it as JSON, as they read inject's);
 *   remoteAddress: the client's address (inject's default, 127.0.0.1).
 */
export async function inject(app, { method = "GET", url, payload, headers = {}, remoteAddress = "127.0.0.1" } = {}) {
  const sent = { ...headers };
  let body;
  if (payload !== undefined && payload !== null) {
    if (typeof payload === "string") body = new TextEncoder().encode(payload);
    else if (payload instanceof Uint8Array) body = payload;
    else {
      body = new TextEncoder().encode(JSON.stringify(payload));
      if (!Object.keys(sent).some((k) => k.toLowerCase() === "content-type")) sent["content-type"] = "application/json";
    }
  }
  const r = await app.request(url, { method, headers: sent, body }, { incoming: { socket: { remoteAddress } } });
  const rawPayload = Buffer.from(await r.arrayBuffer());
  const text = rawPayload.toString("utf8");
  const out = {};
  r.headers.forEach((v, k) => {
    out[k] = v;
  });
  return { statusCode: r.status, headers: out, body: text, payload: text, rawPayload, json: () => JSON.parse(text) };
}

/** pytest's `tmp_path`: a fresh empty folder. */
export function tmpPath(prefix = "jv-test-") {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

/** conftest's `tmp_storage_dir`: `<tmp_path>/storage` (not created). */
export const tmpStorageDir = (tmp) => path.join(tmp, "storage");

/**
 * conftest_db's `tmp_db`: a fresh SQLite file in its own temp folder with every table — and,
 * like that fixture's engine, no foreign-key pragma (SQLite's default, OFF). Returns the handle
 * (Python yielded a session factory + the engine).
 */
export function tmpDb() {
  const dir = tmpPath("jv-test-db-");
  mkdirSync(dir, { recursive: true });
  const h = openDatabase(path.join(dir, "justvoice.test.db"), { foreignKeys: false });
  h.register(TABLES);
  h.createTables(TABLES);
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
