// SPDX-License-Identifier: MIT
// Sync in JustVoice (server/src/sync.js, ../just-sqlite-sync): what syncs — projects, scripts,
// personas and lexicons, never the audio; what a by-hand file of a project holds (closed over
// its foreign keys, so the device that imports it deletes nothing); where the sync settings
// live (their own row — a whole-tree settings save can't put back an older library key);
// pairing adds a token the auth check accepts; a factory reset starts a new library. "Another
// device" is a second database with JustVoice's tables and the same sync setup.
import { join } from "node:path";
import { betterSqlite3Adapter, decodeFile, openSync } from "@delebash/sqlite-sync";
import { openDatabase } from "@delebash/llm-runner/platform";
import { afterEach, expect, test } from "vitest";
import { getState } from "../src/app_state.js";
import { readAuth } from "../src/auth.js";
import { runFactoryReset } from "../src/data_admin.js";
import { TABLES } from "../src/database/models.js";
import * as session from "../src/database/session.js";
import { SYNC_SCHEMA_VERSION, SYNC_TABLES, flushSync, getSync } from "../src/sync.js";
import { appClient, closeApps } from "./app_helpers.js";
import { tmpPath } from "./helpers.js";

afterEach(closeApps);

/** Another JustVoice device: its own database, JustVoice's tables, the same sync setup. */
function otherDevice(name) {
  const h = openDatabase(join(tmpPath(), "justvoice.db"), { foreignKeys: true });
  h.register(TABLES);
  h.createTables(TABLES);
  const tables = Object.fromEntries(SYNC_TABLES.map((t) => [t, {}]));
  tables.personas = { exclude: ["avatar_path"] };
  return { h, sync: openSync(betterSqlite3Adapter(h.raw), { app: "justvoice", schemaVersion: SYNC_SCHEMA_VERSION, tables, deviceName: name }) };
}

/**
 * Two projects. "The Lamp" has a chapter with a line, a speaker played by Mira, a correction,
 * its own lexicon; Mira reads with "Other"'s lexicon and has her own; a take of the line exists.
 * "Other" has a chapter of its own; a global lexicon and a persona nobody plays are unused.
 */
function seedProjects() {
  const h = session.cfg.handle;
  h.tx(() => {
    h.insert("projects", { id: "p1", name: "The Lamp", project_type: "audiobook" });
    h.insert("projects", { id: "p2", name: "Other", project_type: "audiobook" });
    h.insert("lexicons", { id: "l1", name: "Lamp words", scope: "project", project_id: "p1" });
    h.insert("lexicons", { id: "l2", name: "Other words", scope: "project", project_id: "p2" });
    h.insert("lexicons", { id: "l4", name: "Everywhere", scope: "global" });
    h.update("projects", { default_lexicon_id: "l1" }, { id: "p1" });
    h.insert("personas", { id: "mira", name: "Mira", lexicon_id: "l2", avatar_path: "personas/mira.png" });
    h.insert("personas", { id: "idle", name: "Idle" });
    h.insert("lexicons", { id: "l3", name: "Mira's words", scope: "persona", persona_id: "mira" });
    for (const [id, lex] of [["e1", "l1"], ["e2", "l2"], ["e3", "l3"], ["e4", "l4"]]) {
      h.insert("lexicon_entries", { id, lexicon_id: lex, word: id, pronunciation: "x", notation: "phonetic" });
    }
    h.insert("scenes", { id: "s1", project_id: "p1", position: 0, title: "Arrival" });
    h.insert("scenes", { id: "s2", project_id: "p2", position: 0, title: "Elsewhere" });
    h.insert("speakers", { id: "sp1", project_id: "p1", name: "Mira", persona_id: "mira" });
    h.insert("blocks", { id: "b1", scene_id: "s1", position: 0, text: "The lamp was lying.", speaker_id: "sp1" });
    h.insert("speaker_corrections", { id: "c1", project_id: "p1", text_snippet: "lying", speaker_id: "sp1" });
    h.insert("generations", { id: "g1", block_id: "b1", text: "The lamp was lying.", engine: "kokoro", status: "done", ok_status: "unreviewed", source: "render" });
    h.insert("takes", { id: "t1", block_id: "b1", generation_id: "g1", is_default: true });
  });
  flushSync();
}

const idsByTable = (changes) => {
  const out = {};
  for (const ch of changes) (out[ch.t] ??= new Set()).add(JSON.parse(ch.k)[0]);
  return Object.fromEntries(Object.entries(out).map(([t, s]) => [t, [...s].sort()]));
};

test("the projects, scripts, personas and lexicons sync; the audio and the avatar don't", async () => {
  await appClient();
  seedProjects();
  const changes = getSync().changesSince({}).changes;
  const tables = idsByTable(changes);
  expect(Object.keys(tables).sort()).toEqual([...SYNC_TABLES].sort());
  expect(tables.personas).toEqual(["idle", "mira"]);
  expect(changes.some((ch) => ch.c === "avatar_path")).toBe(false);
});

test("a project's file holds it complete and closed over its keys; importing it deletes nothing", async () => {
  const { c } = await appClient();
  seedProjects();
  const r = await c.post("/v1/sync/export", { json: { projectIds: ["p1"] } });
  expect(r.status).toBe(200);
  expect(decodeURIComponent(r.headers["content-disposition"])).toMatch(/The Lamp \d{4}-\d{2}-\d{2}\.jvsync/);
  const batch = await decodeFile(new Uint8Array(r.content));
  expect(idsByTable(batch.changes)).toEqual({
    projects: ["p1", "p2"], // "Other" only as the row Mira's lexicon points at
    scenes: ["s1"],
    blocks: ["b1"],
    speakers: ["sp1"],
    speaker_corrections: ["c1"],
    personas: ["mira"],
    lexicons: ["l1", "l2", "l3"],
    lexicon_entries: ["e1", "e2", "e3"],
  });

  const phone = otherDevice("phone");
  phone.sync.apply(batch, { join: true });
  expect(phone.h.all("SELECT id, lexicon_id FROM personas")).toEqual([{ id: "mira", lexicon_id: "l2" }]);
  expect(phone.h.all("SELECT id, persona_id FROM speakers")).toEqual([{ id: "sp1", persona_id: "mira" }]);
  // nothing was missing a parent, so the phone deleted or emptied nothing of its own accord
  expect(phone.sync.vector()[phone.sync.device] ?? 0).toBe(0);
});

test("a project's file carries what was deleted from it, and nothing deleted elsewhere", async () => {
  const { c } = await appClient();
  seedProjects();
  const phone = otherDevice("phone");
  const exportOf = async (ids) => decodeFile(new Uint8Array((await c.post("/v1/sync/export", { json: { projectIds: ids } })).content));
  phone.sync.apply(await exportOf(["p1", "p2"]), { join: true });

  const h = session.cfg.handle;
  h.run("DELETE FROM blocks WHERE id = 'b1'"); // a line of The Lamp
  h.run("DELETE FROM lexicon_entries WHERE id = 'e3'"); // a word of Mira's, who plays in it
  h.run("DELETE FROM scenes WHERE id = 's2'"); // a chapter of Other
  flushSync();
  const changed = (await c.get("/v1/sync/projects")).json().projects;
  expect(changed.map((p) => p.title)).toEqual(["Other", "The Lamp"]);
  expect(changed.every((p) => Date.parse(p.updatedAt) > Date.now() - 60_000)).toBe(true);

  phone.sync.apply(await exportOf(["p1"]));
  expect(phone.h.all("SELECT id FROM blocks")).toEqual([]);
  expect(phone.h.all("SELECT id FROM lexicon_entries ORDER BY id").map((r) => r.id)).toEqual(["e1", "e2"]);
  expect(phone.h.all("SELECT id FROM scenes ORDER BY id").map((r) => r.id)).toEqual(["s1", "s2"]); // Other's wasn't picked
});

test("the sync settings keep their own row: a whole-tree settings save leaves the key alone", async () => {
  const { c } = await appClient();
  const stale = (await c.get("/v1/settings")).json(); // a window holds the settings tree…
  const paired = await c.post("/v1/sync/pair", { json: {} }); // …another screen pairs a device…
  expect(paired.status).toBe(200);
  const { key, token } = paired.json().code;
  expect(readAuth()[0]).toContain(token); // the new device's token opens the API
  stale.auth = getState().settings.get().auth; // (the screen reloads auth after pairing)
  expect((await c.put("/v1/settings", { json: stale })).status).toBe(200); // …and the window saves
  const status = (await c.get("/v1/sync/status")).json();
  expect(status.settings).toMatchObject({ hasKey: true, listenOnNetwork: true });
  expect(JSON.parse(session.cfg.handle.get("settings", "sync").data).key).toBe(key);
  expect("sync" in getState().settings.get()).toBe(false);
});

test("a factory reset starts a new library", async () => {
  await appClient();
  seedProjects();
  const before = getSync().library;
  await runFactoryReset();
  const after = getSync();
  expect(after.library).not.toBe(before);
  expect(after.changesSince({}).changes).toEqual([]);
  session.cfg.handle.insert("projects", { id: "p9", name: "New", project_type: "audiobook" });
  flushSync();
  expect(idsByTable(getSync().changesSince({}).changes)).toEqual({ projects: ["p9"] });
});
