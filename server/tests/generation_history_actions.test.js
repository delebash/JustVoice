// SPDX-License-Identifier: MIT
// Single-generation delete, wired by the parity audit (the port of
// tests/test_generation_history_actions.py). (The ★ favorite and its toggle went with Generate's
// History, 2026-10-05.)
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { appClient, closeApps } from "./app_helpers.js";
import { Generation, uuid } from "../src/database/models.js";
import * as session from "../src/database/session.js";

afterEach(closeApps);

function makeGeneration(dir) {
  const wav = path.join(dir, "g.wav");
  writeFileSync(wav, Buffer.from("RIFF0000WAVE", "latin1"));
  const id = uuid();
  session.getDb().insert(Generation, { id, text: "hello", engine: "test", status: "completed", audio_path: wav });
  return id;
}

test("delete_generation_removes_row_and_audio", async () => {
  const { c, dir } = await appClient();
  const genId = makeGeneration(dir);
  const audio = path.join(dir, "g.wav");
  expect(existsSync(audio)).toBe(true);

  const r = await c.delete(`/v1/generations/${genId}`);
  expect(r.status === 200 && r.json().deleted === true).toBe(true);
  expect(existsSync(audio)).toBe(false);

  const rows = (await c.get("/v1/takes/recent")).json().takes;
  expect(rows.every((t) => t.id !== genId)).toBe(true);

  expect((await c.delete(`/v1/generations/${genId}`)).status).toBe(404);
});
