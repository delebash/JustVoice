// SPDX-License-Identifier: MIT
// Settings folded into SQLite (Phase 1.5) — persistence + the legacy settings.json import and
// retirement (the port of tests/test_settings_sqlite.py).
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
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
