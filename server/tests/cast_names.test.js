// SPDX-License-Identifier: MIT
// The speakers endpoint ships names, not just ids — each speaker carries its persona's NAME
// beside the persona id (the port of tests/test_cast_names.py).
//
// User ruling 2026-08-15 — "we should not be using these types of ids in user facing gui".
// Since the 2026-09-29 split a book's cast is its speakers.
import { afterEach, expect, test } from "vitest";
import { appClient, closeApps } from "./app_helpers.js";

afterEach(closeApps);

async function project(c, kind = "audiobook") {
  const r = await c.post("/v1/projects", { json: { name: "The Ninth Facet", project_type: kind } });
  expect(r.status, r.text).toBe(201);
  return r.json().id;
}

test("speakers_carry_their_personas_name", async () => {
  const { c } = await appClient();
  const pid = await project(c);
  const voice = (await c.post("/v1/personas", { json: { name: "Warm narrator" } })).json().id;
  const r = await c.post(`/v1/projects/${pid}/speakers`, { json: { name: "Mara Vance", persona_id: voice } });
  expect(r.status, r.text).toBe(201);
  expect(r.json().persona_name).toBe("Warm narrator");
  const listed = (await c.get(`/v1/projects/${pid}/speakers`)).json().speakers;
  expect(listed.map((s) => [s.name, s.persona_name])).toEqual([["Mara Vance", "Warm narrator"]]);
});

test("narrator_responses_carry_names_too", async () => {
  const { c } = await appClient();
  const pid = await project(c);
  const r = await c.post(`/v1/projects/${pid}/narrator`);
  expect(r.status, r.text).toBe(201);
  expect(r.json().speakers.map((s) => s.name)).toEqual(["Narrator"]);
});

test("deleting_a_persona_leaves_its_speakers_uncast_not_nameless", async () => {
  // A deleted persona un-casts the speakers it played (SET NULL); the speakers keep their names
  // — nothing reaches the GUI as a bare id.
  const { c } = await appClient();
  const pid = await project(c);
  const ghost = (await c.post("/v1/personas", { json: { name: "Ghost" } })).json().id;
  await c.post(`/v1/projects/${pid}/speakers`, { json: { name: "Mara", persona_id: ghost } });
  expect((await c.delete(`/v1/personas/${ghost}`)).status).toBe(200);
  const listed = (await c.get(`/v1/projects/${pid}/speakers`)).json().speakers;
  expect(listed.length).toBe(1);
  const [s] = listed;
  expect([s.name, s.persona_id, s.persona_name]).toEqual(["Mara", null, null]);
});
