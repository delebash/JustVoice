// SPDX-License-Identifier: MIT
// JustVoice's sync — projects, scripts, personas and lexicons through the family's sync product
// (@delebash/sqlite-sync, the ../just-sqlite-sync repo). Every device keeps them all and works
// offline; changes travel by a file carried by hand, through a cloud folder, or over HTTP with
// another device or a server. The decision, verbatim: docs/dev/TASKS.md "JustVoice's sync —
// projects, scripts, personas and lexicons"; the user guide: docs/sync.md.
//
// The product's app layer (`@delebash/sqlite-sync/app`) runs the rest — this device's identity,
// the settings, the auto-sync, listening on the network, pairing, the by-hand file and the routes.
// What is JustVoice's own is here: which tables sync (a project with its chapters, lines,
// speakers and corrections; the personas; the lexicons and their words — never the audio:
// takes, generations, render jobs, captures; never the voices, which are files; never the
// settings or the AI tables), the persona avatar (a file on this device) kept per device, where
// the `sync` section and the bearer tokens live, what a by-hand file holds, and the error shape.

import { betterSqlite3Adapter, parseStamp } from "@delebash/sqlite-sync";
import { createAppSync } from "@delebash/sqlite-sync/app";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { pyJson } from "@delebash/llm-runner/platform/pyjson";
import { getState } from "./app_state.js";
import * as session from "./database/session.js";
import { ApiError, HttpError } from "./errors.js";

const log = getLogger("justvoice.sync");

/** Raised when the synced tables change shape in a way older devices can't apply (the engine
 * refuses newer batches: "update JustVoice on this device"). */
export const SYNC_SCHEMA_VERSION = 1;

export const SYNC_TABLES = ["projects", "scenes", "blocks", "speakers", "speaker_corrections", "personas", "lexicons", "lexicon_entries"];

function tableConfig() {
  const out = {};
  for (const t of SYNC_TABLES) out[t] = {};
  // the avatar is a file in this device's data folder; files don't sync
  out.personas = { exclude: ["avatar_path"] };
  return out;
}

// ── the `sync` section: its own row of the settings table ─────────────────────────────────
// Not a section of the Settings tree: Settings' PUT replaces the whole tree, and a window holding
// an older copy would put back an older library key (the cloud folder's files then fail to
// decrypt) or drop the paired devices. Only the sync routes write this row.

const SYNC_ROW = "sync";

function readSyncRow() {
  const h = session.cfg.handle;
  const row = h?.get("settings", SYNC_ROW);
  return row?.data ? JSON.parse(row.data) : null;
}

function writeSyncRow(cfg) {
  const h = session.cfg.handle;
  const data = pyJson(cfg);
  if (h.get("settings", SYNC_ROW)) h.update("settings", { data }, { id: SYNC_ROW });
  else h.insert("settings", { id: SYNC_ROW, data });
}

// ── what a by-hand file holds ────────────────────────────────────────────────────────────

// A project's own rows: [table, column, the table that column points at].
const CHILDREN = [
  ["scenes", "project_id", "projects"],
  ["blocks", "scene_id", "scenes"],
  ["speakers", "project_id", "projects"],
  ["speaker_corrections", "project_id", "projects"],
  ["lexicons", "project_id", "projects"],
  ["lexicons", "persona_id", "personas"],
  ["lexicon_entries", "lexicon_id", "lexicons"],
];

// What was deleted from what: a deleted row's id no longer says which project it was in (the
// engine keeps only a deletion mark), so a trigger notes each deleted row's parent first — a
// project's file then carries the lines, chapters and words deleted from it, and no others.
const DELETED = "jv_sync_deleted";

function ensureDeletedLog(h) {
  h.exec(`CREATE TABLE IF NOT EXISTS ${DELETED} (tbl TEXT NOT NULL, id TEXT NOT NULL, parent_tbl TEXT NOT NULL, parent_id TEXT NOT NULL, PRIMARY KEY (tbl, id, parent_tbl))`);
  const byTable = new Map();
  for (const [t, col, parent] of CHILDREN) byTable.set(t, [...(byTable.get(t) ?? []), [col, parent]]);
  for (const [t, links] of byTable) {
    const notes = links
      .map(([col, parent]) => `INSERT OR REPLACE INTO ${DELETED} (tbl, id, parent_tbl, parent_id) SELECT '${t}', OLD.id, '${parent}', OLD."${col}" WHERE OLD."${col}" IS NOT NULL;`)
      .join(" ");
    h.exec(`CREATE TRIGGER IF NOT EXISTS ${DELETED}_${t} BEFORE DELETE ON "${t}" BEGIN ${notes} END`);
  }
}

/**
 * The picked projects, each complete: its chapters and lines, speakers and corrections, the
 * personas that play it, and the lexicons it and they use with their words (the precedent:
 * GET /v1/projects/:id/export) — and what was deleted from them. Closed over every foreign key
 * among the synced tables, so an import never finds a row whose parent is missing — the engine
 * would delete that row there (the cascade's rule) and the delete would travel back to this
 * device. A project reached only that way (a persona uses its lexicon) comes as its row alone,
 * not its chapters.
 */
function projectScope(h, ids) {
  const picked = new Set(ids);
  const sets = Object.fromEntries(SYNC_TABLES.map((t) => [t, new Set()]));
  for (const id of ids) sets.projects.add(id);
  const parents = [];
  for (const t of SYNC_TABLES) {
    for (const fk of h.all(`PRAGMA foreign_key_list("${t}")`)) {
      if (SYNC_TABLES.includes(fk.table)) parents.push([t, fk.from, fk.table]);
    }
  }
  const inSet = (s) => [JSON.stringify([...s])];
  let grew = true;
  const add = (t, rows) => {
    for (const { id } of rows) {
      if (id != null && !sets[t].has(id)) {
        sets[t].add(id);
        grew = true;
      }
    }
  };
  while (grew) {
    grew = false;
    for (const [t, col, parent] of CHILDREN) {
      const from = parent === "projects" ? picked : sets[parent];
      if (from.size) add(t, h.all(`SELECT id FROM "${t}" WHERE "${col}" IN (SELECT value FROM json_each(?))`, inSet(from)));
    }
    for (const [t, col, parent] of parents) {
      if (sets[t].size) add(parent, h.all(`SELECT "${col}" AS id FROM "${t}" WHERE id IN (SELECT value FROM json_each(?)) AND "${col}" IS NOT NULL`, inSet(sets[t])));
    }
  }
  // a deleted row comes when it was deleted from a row the file holds (its chapter, its lexicon…)
  const deleted = new Set();
  for (const r of h.all(`SELECT tbl, id, parent_tbl, parent_id FROM ${DELETED}`)) {
    const from = r.parent_tbl === "projects" ? picked : sets[r.parent_tbl];
    if (from?.has(r.parent_id)) deleted.add(`${r.tbl}\u0000${r.id}`);
  }
  return (t, pk) => (sets[t]?.has(pk[0]) ?? false) || deleted.has(`${t}\u0000${pk[0]}`);
}

/** When each project last changed: the newest stamp among the changes its file would hold (a
 * project's own `updated_at` doesn't move when its script does). For the export picker. */
function projectsChangedAt(h, sync) {
  const projects = h.all("SELECT id, name FROM projects ORDER BY name COLLATE NOCASE");
  const scopes = projects.map((p) => ({ p, inScope: projectScope(h, [p.id]), ms: 0 }));
  for (const ch of sync.changesSince({}).changes) {
    const ms = parseStamp(ch.s).ms;
    const pk = JSON.parse(ch.k);
    for (const e of scopes) if (ms > e.ms && e.inScope(ch.t, pk)) e.ms = ms;
  }
  return scopes.map(({ p, ms }) => ({ id: p.id, title: p.name, updatedAt: ms ? new Date(ms).toISOString() : null }));
}

const appSync = createAppSync({
  app: "justvoice",
  appName: "JustVoice",
  schemaVersion: SYNC_SCHEMA_VERSION,
  tables: tableConfig,
  database: () => betterSqlite3Adapter(session.cfg.handle.raw),
  settings: { read: readSyncRow, write: writeSyncRow },
  auth: {
    tokens: () => getState().settings.get().auth.tokens ?? [],
    add: (token) => {
      const store = getState().settings;
      const all = store.get();
      all.auth.tokens = [...(all.auth.tokens ?? []).filter((t) => typeof t === "string" && t), token];
      store.set(all);
    },
  },
  units: {
    scope: (ids) => projectScope(session.cfg.handle, ids),
    name: (ids) => session.cfg.handle.get("projects", ids[0])?.name || "Projects",
    extension: "jvsync",
    noun: "projects",
  },
  errors: {
    badRequest: (detail) => new HttpError(400, detail),
    notReady: () => new HttpError(503, "database not ready"),
    // 409 problem+json: `detail` is the reason in words, `error` the engine's code
    // (library-mismatch, schema-too-new, clock-drift, wrong-key, …) so the window can say what to do
    refused: (e) => new ApiError(409, e.code, "Sync refused", e.message, { error: e.code, ...(e.details ?? {}) }),
  },
  log,
});

/** Open sync on the synced tables (after initDb). Safe to call again. */
export function openSync(dataDir) {
  ensureDeletedLog(session.cfg.handle);
  return appSync.open(dataDir);
}
/** The engine, or null before boot. */
export const getSync = () => appSync.get();
/** Stamp what the triggers noted — after every write request (app.js) and before every sync. */
export const flushSync = () => appSync.flush();
/** A factory reset made a new database: this device starts a new library. */
export function resetSync(dataDir) {
  ensureDeletedLog(session.cfg.handle);
  return appSync.reset(dataDir);
}
/** Stop the auto-sync timers (the server is stopping). */
export const stopSync = () => appSync.stop();
/** "0.0.0.0" when paired devices may connect (the setting is on and a pairing token exists). */
export const networkHost = () => appSync.networkHost();

/** The routes: /v1/sync/… — the product's, and the projects for the export picker. */
export async function router(app) {
  await appSync.routes(app);
  app.get("/v1/sync/projects", async () => {
    const sync = appSync.get();
    if (!sync || !session.cfg.handle) throw new HttpError(503, "database not ready");
    return { projects: projectsChangedAt(session.cfg.handle, sync) };
  });
}
