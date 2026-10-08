// SPDX-License-Identifier: MIT
// Speaker names are unique within a book; persona names unique across the library (the port of
// tests/test_unique_names_in_a_book.py).
//
// Two books may each have a "Narrator" or a "Mother", but one book never holds two speakers
// called the same — Script's speaker list, attribution and Discover all resolve names within a
// book. Case and extra spaces don't count. Checked when a speaker is added (Cast's ＋ Add,
// Discover's Add) and renamed; an import keeps the book's characters exactly as the book has
// them.
import { afterEach, expect, test } from "vitest";
import { appClient, closeApps } from "./app_helpers.js";
import { bookJson } from "./jw_fixtures.js";

afterEach(closeApps);

/** The Python fixture: the app on a fresh folder + seed_workspace(). */
const client = async () => (await appClient(undefined, { seed: true })).c;

async function book(c, name = "The Ninth Facet") {
  const r = await c.post("/v1/projects", { json: { name, project_type: "audiobook" } });
  expect(r.status, r.text).toBe(201);
  return r.json().id;
}

const add = (c, pid, name) => c.post(`/v1/projects/${pid}/speakers`, { json: { name } });

test("a_book_refuses_a_second_speaker_with_the_same_name", async () => {
  const c = await client();
  const pid = await book(c);
  expect((await add(c, pid, "Mara")).status).toBe(201);
  const r = await add(c, pid, "  mara ");
  expect(r.status).toBe(409);
  expect(r.json().detail).toContain('already has a speaker called "Mara"');
});

test("two_books_may_share_a_speaker_name", async () => {
  const c = await client();
  const one = await book(c, "One");
  const two = await book(c, "Two");
  expect((await add(c, one, "Mother")).status).toBe(201);
  expect((await add(c, two, "Mother")).status).toBe(201);
});

test("persona_names_are_unique_across_the_library", async () => {
  // 2026-09-29: a persona is a voice in the library, so its name is unique there — case and
  // extra spaces don't count. (Speakers: unique per book.)
  const c = await client();
  const first = await c.post("/v1/personas", { json: { name: "  Gravel   old man " } });
  expect(first.status).toBe(201);
  expect(first.json().name).toBe("Gravel old man");
  for (const clash of ["Gravel old man", "gravel OLD man", " gravel  old  man"]) {
    const r = await c.post("/v1/personas", { json: { name: clash } });
    expect(r.status, r.text).toBe(409);
    expect(r.json().detail, r.text).toContain('"Gravel old man"');
  }
});

test("a_persona_must_have_a_name", async () => {
  const c = await client();
  for (const blank of ["", "   "]) {
    const r = await c.post("/v1/personas", { json: { name: blank } });
    expect(r.status).toBe(400);
    expect(r.json().detail).toContain("needs a name");
  }
  const pid = (await c.post("/v1/personas", { json: { name: "Warm" } })).json().id;
  expect((await c.patch(`/v1/personas/${pid}`, { json: { name: " " } })).status).toBe(400);
});

test("a_persona_rename_is_refused_into_a_taken_name", async () => {
  const c = await client();
  const warm = (await c.post("/v1/personas", { json: { name: "Warm" } })).json().id;
  await c.post("/v1/personas", { json: { name: "Crisp" } });
  const r = await c.patch(`/v1/personas/${warm}`, { json: { name: "CRISP" } });
  expect(r.status).toBe(409);
  expect(r.json().detail).toContain('"Crisp"');
  // Its own name, in another case, is not a clash.
  expect((await c.patch(`/v1/personas/${warm}`, { json: { name: "WARM" } })).json().name).toBe("WARM");
  expect((await c.patch("/v1/personas/persona_nope", { json: { name: "Other" } })).status).toBe(404);
});

test("a_rename_is_refused_when_the_book_has_that_name", async () => {
  const c = await client();
  const pid = await book(c);
  const mara = (await add(c, pid, "Mara")).json().id;
  const tom = (await add(c, pid, "Tom")).json().id;
  const r = await c.patch(`/v1/speakers/${tom}`, { json: { name: "MARA" } });
  expect(r.status).toBe(409);
  expect(r.json().detail).toContain("Mara");
  expect((await c.patch(`/v1/speakers/${tom}`, { json: { name: "Tom Harlan" } })).status).toBe(200);
  // Only case changes: still the same name, never a clash.
  expect((await c.patch(`/v1/speakers/${mara}`, { json: { name: "MARA" } })).status).toBe(200);
});

test("discover_add_is_refused_for_a_name_the_book_has", async () => {
  const c = await client();
  const pid = await book(c);
  await add(c, pid, "Mara");
  const r = await c.post(`/v1/projects/${pid}/speakers/promote`, { json: { candidates: [{ name: "mara" }] } });
  expect(r.status).toBe(409);
  expect((await c.get(`/v1/projects/${pid}/speakers`)).json().speakers.map((s) => s.name)).toEqual(["Mara"]);
});

test("an_import_keeps_the_books_characters_as_they_are", async () => {
  const c = await client();
  const guard = { main: false, age: 0, gender: "", pronouns: "", aliases: [], lifeStatus: "alive", oneLiner: "", role: "", tags: [] };
  const b = bookJson({
    characters: [
      { id: "g1", name: "Guard", ...guard },
      { id: "g2", name: "Guard", ...guard },
    ],
  });
  const r = await c.post("/v1/projects/import?source=justwrite", { json: b });
  expect(r.status, r.text).toBe(200);
  const speakers = (await c.get(`/v1/projects/${r.json().project_id}/speakers`)).json().speakers;
  expect(speakers.map((s) => s.name)).toEqual(["Guard", "Guard"]);
});
