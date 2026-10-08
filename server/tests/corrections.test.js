// SPDX-License-Identifier: MIT
// Correction memory — THE one writer (parity batch 2026-08-06) — the port of
// tests/test_corrections.py.
//
// `extraction_api.recordCorrection` is shared by the Studio block-PATCH side effect and the
// attribution Lab's reassign door (POST /v1/projects/{id}/corrections); these tests pin the shared
// behavior: the 400-char snippet cap, the 200-per-project cap, and both doors landing in the same
// table the count/clear routes read.
import { afterEach, expect, test } from "vitest";
import { recordCorrection } from "../src/api/extraction_api.js";
import { Block, SpeakerCorrection } from "../src/database/models.js";
import * as session from "../src/database/session.js";
import { appClient, closeApps } from "./app_helpers.js";
import { cpSlice } from "@delebash/llm-runner/platform/py";

afterEach(closeApps);

/** The app, no seed (Python's `client` fixture). */
async function client() {
  const { c } = await appClient();
  return c;
}

const CSV = `id,scene,character,text
Q01_A,Ashfall,Hale,"Halt. State your business."
Q01_B,Ashfall,Hale,"The well's dry."
`;

async function _importProject(c) {
  const r = await c.post("/v1/projects/import", {
    data: { source: "csv_lines", dry_run: "false" },
    files: { file: ["emberfall.csv", Buffer.from(CSV), "text/csv"] },
  });
  expect(r.status, r.text).toBe(200);
  return r.json().project_id;
}

async function _mkSpeaker(c, pid, name) {
  const r = await c.post(`/v1/projects/${pid}/speakers`, { json: { name } });
  expect(r.status, r.text).toBe(201);
  return r.json().id;
}

const _count = async (c, pid) => (await c.get(`/v1/projects/${pid}/corrections/count`)).json().count;

/** The project's correction rows, read straight from the table. */
const _rows = (pid) => session.getDb().all(`select * from ${SpeakerCorrection} where project_id = ?`, [pid], SpeakerCorrection);

test("lab_door_records_and_counts", async () => {
  // speaker_id is an FK to speakers — the door records REAL speakers of the book (the
  // renderer's reassign offers only the book's speakers).
  const c = await client();
  const pid = await _importProject(c);
  const hale = await _mkSpeaker(c, pid, "Hale the Elder");
  expect(await _count(c, pid)).toBe(0);

  const r = await c.post(`/v1/projects/${pid}/corrections`, { json: { text_snippet: "“Halt,” he said.", speaker_id: hale } });
  expect(r.status, r.text).toBe(200);
  expect(r.json()).toEqual({ ok: true, count: 1 });
  expect(await _count(c, pid)).toBe(1);

  // Clear wipes the project's memory.
  expect((await c.delete(`/v1/projects/${pid}/corrections`)).json().deleted).toBe(1);
  expect(await _count(c, pid)).toBe(0);
});

test("lab_door_refuses_unknown_speakers", async () => {
  // A synthetic lab-cast id is not a speaker, and nor is another book's — the door answers 404,
  // never a 500 off the FK.
  const c = await client();
  const pid = await _importProject(c);
  const other = await _importProject(c);
  const theirs = await _mkSpeaker(c, other, "Stranger");
  for (const bad of ["c_hale_0", theirs]) {
    const r = await c.post(`/v1/projects/${pid}/corrections`, { json: { text_snippet: "“Halt,” he said.", speaker_id: bad } });
    expect(r.status, r.text).toBe(404);
  }
  expect(await _count(c, pid)).toBe(0);
});

test("snippet_capped_at_400_chars", async () => {
  const c = await client();
  const pid = await _importProject(c);
  const who = await _mkSpeaker(c, pid, "Anna");
  await c.post(`/v1/projects/${pid}/corrections`, { json: { text_snippet: "x".repeat(1000), speaker_id: who } });
  const rows = _rows(pid);
  expect(rows.length).toBe(1);
  expect(rows[0].text_snippet.length).toBe(400);
});

test("cap_at_200_per_project", async () => {
  const c = await client();
  const pid = await _importProject(c);
  const other = await _importProject(c);
  const whoA = await _mkSpeaker(c, pid, "Anna");
  const whoB = await _mkSpeaker(c, other, "Bram");

  const h = session.getDb();
  h.tx(() => {
    for (let i = 0; i < 205; i++) recordCorrection(h, pid, `line ${i}`, whoA);
    recordCorrection(h, other, "the other project's row", whoB);
  });
  expect(h.count(SpeakerCorrection, { project_id: pid })).toBe(200);
  // The cap is per-project — the sibling's row is untouched.
  expect(h.count(SpeakerCorrection, { project_id: other })).toBe(1);
});

test("studio_block_patch_shares_the_writer", async () => {
  // A speaker reassign on a block writes the SAME correction memory the Lab door does (the
  // shared recordCorrection — the two cannot drift).
  const c = await client();
  const pid = await _importProject(c);
  const keeper = await _mkSpeaker(c, pid, "Keeper");
  const block = session.getDb().one(`select * from ${Block} limit 1`, [], Block);
  const [blockId, blockText] = [block.id, block.text];

  const r = await c.patch(`/v1/blocks/${blockId}`, { json: { speaker_id: keeper } });
  expect(r.status, r.text).toBe(200);

  expect(await _count(c, pid)).toBe(1);
  const rows = _rows(pid);
  expect(rows.length).toBe(1);
  expect(rows[0].speaker_id).toBe(keeper);
  expect(rows[0].text_snippet).toBe(cpSlice(blockText, 0, 400));
});
