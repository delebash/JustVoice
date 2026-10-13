// SPDX-License-Identifier: MIT
// Settings folded into SQLite (Phase 1.5) — persistence + the legacy settings.json import and
// retirement (the port of tests/test_settings_sqlite.py).
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { construct, Settings } from "../src/models.js";
import { readSettingsReadOnly } from "../src/storage/settings_store.js";
import { appClient, closeApps } from "./app_helpers.js";
import { tmpPath } from "./helpers.js";

afterEach(closeApps);

test("patch_persists_in_sqlite_no_json_file", async () => {
  const dir = tmpPath();
  const { c } = await appClient(dir);
  expect((await c.patch("/v1/settings", { json: { server: { host: "0.0.0.0" } } })).status).toBe(200);
  // A fresh app instance on the same data dir reads the persisted row.
  const { c: c2 } = await appClient(dir);
  expect((await c2.get("/v1/settings")).json().server.host).toBe("0.0.0.0");
  // SQLite is the store — no settings.json is written.
  expect(existsSync(path.join(dir, "settings.json"))).toBe(false);
});

test("legacy_settings_json_imported_then_retired", async () => {
  // An existing install (or a restored pre-fold backup) carries a settings.json.
  const dir = tmpPath();
  writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ server: { host: "0.0.0.0" } }), "utf8");
  const { c } = await appClient(dir);
  // First load imports it into the DB row...
  expect((await c.get("/v1/settings")).json().server.host).toBe("0.0.0.0");
  // ...then retires the file so the DB is the sole source.
  expect(existsSync(path.join(dir, "settings.json"))).toBe(false);
});

test("read_only_settings_read_writes_nothing", async () => {
  // serve.js reads the port this way before anything opens the database (the narrowings review,
  // P6): no database is created, no settings.json retired, and an open database isn't touched.
  const empty = tmpPath();
  expect(readSettingsReadOnly(empty).server.port).toBe(construct(Settings, {}).server.port);
  expect(existsSync(path.join(empty, "justvoice.db"))).toBe(false);

  const legacy = tmpPath();
  writeFileSync(path.join(legacy, "settings.json"), JSON.stringify({ server: { port: 17999 } }), "utf8");
  expect(readSettingsReadOnly(legacy).server.port).toBe(17999);
  expect(existsSync(path.join(legacy, "settings.json"))).toBe(true);
  expect(existsSync(path.join(legacy, "justvoice.db"))).toBe(false);

  // Another server has the database open: its saved port is read, and the file stays as it was.
  const dir = tmpPath();
  const { c } = await appClient(dir);
  expect((await c.patch("/v1/settings", { json: { server: { port: 17888 } } })).status).toBe(200);
  const db = path.join(dir, "justvoice.db");
  const before = { bytes: readFileSync(db), mtimeMs: statSync(db).mtimeMs };
  expect(readSettingsReadOnly(dir).server.port).toBe(17888);
  expect(readFileSync(db).equals(before.bytes)).toBe(true);
  expect(statSync(db).mtimeMs).toBe(before.mtimeMs);
});
