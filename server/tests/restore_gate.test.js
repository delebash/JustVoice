// SPDX-License-Identifier: MIT
// The restore behind the kit's MaintenanceGate (decided 2026-10-20): all or nothing — the folders
// swapped in by rename, then the tables — and a take still being read out to a paused player doesn't
// refuse it: the restore closes the file first (storage/open_files.js). Windows won't rename a folder
// with a file open inside it, so on Windows this is the case that would answer 409 "files-in-use".
import { createReadStream, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import * as session from "../src/database/session.js";
import { generationsRoot } from "../src/paths.js";
import { closedOnRestore } from "../src/storage/open_files.js";
import { appClient, closeApps } from "./app_helpers.js";

afterEach(closeApps);

const restoreFrom = (c, backup) => c.post("/v1/data/restore", { files: { file: ["backup.zip", backup.content, "application/zip"] } });
const projectIds = () => session.cfg.handle.all("SELECT id FROM projects ORDER BY id").map((p) => p.id);

test("a take being played doesn't refuse a restore: its file is closed first", async () => {
  const { c, dir } = await appClient();
  const file = path.join(generationsRoot(dir), "playing.wav");
  writeFileSync(file, Buffer.alloc(1 << 20));
  session.cfg.handle.insert("projects", { id: "p1", name: "Before", project_type: "audiobook" });
  const backup = await c.get("/v1/data/backup");
  expect(backup.status).toBe(200);
  session.cfg.handle.insert("projects", { id: "p2", name: "After", project_type: "audiobook" });

  // a player that read a little and paused: the file stays open
  const stream = closedOnRestore(createReadStream(file, { highWaterMark: 1024 }));
  stream.on("error", () => {}); // the restore's close ends it with an AbortError
  await new Promise((r) => stream.once("readable", r));
  const closed = new Promise((r) => stream.once("close", r));

  const r = await restoreFrom(c, backup);
  expect(r.status, r.text).toBe(200);
  await closed;
  expect(projectIds()).toEqual(["p1"]);
});
