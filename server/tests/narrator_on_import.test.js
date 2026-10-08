// SPDX-License-Identifier: MIT
// An import never makes a narrator; a book's own "Narrator" becomes it (the port of
// tests/test_narrator_on_import.py).
//
// Until 2026-09-29 every import made a new "Narrator" persona, and deleting the book left it in
// the library — re-imports piled them up. Decided that day: no book gets a narrator on its own;
// you tick one in Cast or use "+ Add Narrator". One case stays: a manuscript may ship its own
// narrator character (`docs/import-and-export.md`), and that character is marked as the
// narrator. Nothing new is created.
import { afterEach, expect, test } from "vitest";
import { appClient, closeApps } from "./app_helpers.js";
import { bookJson } from "./jw_fixtures.js";

afterEach(closeApps);

/** The Python fixture: the app on a fresh folder + seed_workspace(). */
const client = async () => (await appClient(undefined, { seed: true })).c;

const cast = async (c, projectId) => (await c.get(`/v1/projects/${projectId}/speakers`)).json().speakers;

async function importBook(c, kwargs = {}) {
  const r = await c.post("/v1/projects/import?source=justwrite", { json: bookJson(kwargs) });
  expect(r.status, r.text).toBe(200);
  return r.json().project_id;
}

test("an_import_makes_no_narrator", async () => {
  const c = await client();
  const people = await cast(c, await importBook(c));
  expect(people.map((p) => p.name)).toEqual(["Mara Vance"]);
  expect(people.filter((p) => p.role_label === "narrator")).toEqual([]);
  expect((await c.get("/v1/personas")).json().personas, "an import makes no persona").toEqual([]);
});

test("reimporting_a_deleted_book_leaves_nothing_behind", async () => {
  // The pile-up this replaced: import, delete, import again. Speakers go with their book; the
  // library of personas never saw them.
  const c = await client();
  const first = await importBook(c);
  expect((await c.delete(`/v1/projects/${first}`)).status).toBe(200);
  const second = await importBook(c);
  expect((await cast(c, second)).map((p) => p.name)).toEqual(["Mara Vance"]);
  expect((await c.get("/v1/personas")).json().personas).toEqual([]);
});

test("a_book_that_names_its_own_narrator_gets_one_not_two", async () => {
  const c = await client();
  const pid = await importBook(c, {
    characters: [
      {
        id: "narr",
        name: "Narrator",
        main: true,
        age: 0,
        gender: "",
        pronouns: "",
        aliases: [],
        lifeStatus: "alive",
        oneLiner: "",
        role: "",
        tags: [],
      },
    ],
  });
  const people = await cast(c, pid);
  const narrators = people.filter((p) => p.name.toLowerCase() === "narrator");
  expect(narrators.length, JSON.stringify(people)).toBe(1);
  // The book's own character was adopted — it carries the role now.
  expect(narrators[0].role_label).toBe("narrator");
});

test("a_game_import_gets_no_narrator", async () => {
  // NPCs only — no single prose voice. Same rule as create_project.
  const c = await client();
  const csv = Buffer.from("scene,character,text\nq1,Hale,Halt.\n");
  const r = await c.post("/v1/projects/import", {
    data: { source: "csv_lines" },
    files: { file: ["lines.csv", csv, "text/csv"] },
  });
  expect(r.status, r.text).toBe(200);
  const people = await cast(c, r.json().project_id);
  expect(
    people.filter((p) => p.name.toLowerCase() === "narrator"),
    JSON.stringify(people),
  ).toEqual([]);
});

// ── One narrator rule (2026-09-30, docs/plans/2026-09-30-script-leftovers.md B6) ──

const SRT = Buffer.from(
  "1\n00:00:01,000 --> 00:00:03,000\nNARRATOR: The rain fell on the quay.\n\n" + "2\n00:00:03,500 --> 00:00:05,000\nMARA: We leave at dawn.\n",
  "utf8",
);

async function importSrt(c) {
  const r = await c.post("/v1/projects/import", {
    data: { source: "srt" },
    files: { file: ["scene.srt", SRT, "application/x-subrip"] },
  });
  expect(r.status, r.text).toBe(200);
  return r.json().project_id;
}

test("a_custom_import_adopts_its_own_narrator", async () => {
  const c = await client();
  const pid = await importSrt(c);
  expect((await c.get(`/v1/projects/${pid}`)).json().project_type).toBe("custom");
  const narrators = (await cast(c, pid)).filter((p) => p.name.toLowerCase() === "narrator");
  expect(narrators.length).toBe(1);
  expect(narrators[0].role_label).toBe("narrator");
});

test("a_speaker_merely_called_narrator_is_not_the_narrator", async () => {
  // The role is the rule — Studio and Cast read only the role, and so does the server now; a
  // name alone made the two disagree.
  const c = await client();
  const pid = (await c.post("/v1/projects", { json: { name: "The Ninth Facet", project_type: "audiobook" } })).json().id;
  const r = await c.post(`/v1/projects/${pid}/speakers`, { json: { name: "Narrator" } });
  expect([200, 201], r.text).toContain(r.status);
  const sceneId = (await c.post(`/v1/projects/${pid}/scenes`, { json: { title: "One" } })).json().id;
  await c.post(`/v1/scenes/${sceneId}/blocks`, { json: { text: "The rain fell." } });
  expect((await c.get(`/v1/scenes/${sceneId}/script`)).json().narrator_id).toBeNull();
});
