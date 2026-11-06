// SPDX-License-Identifier: MIT
// A line given a speaker who isn't in its book is a 404 that names it, on Add and on a change — not a
// 500 from the foreign key. A Python bug copied into the port on purpose (TASKS "The family moves to
// Electron…", agent 3's list; fixed 2026-11-05 as decided 2026-10-08).
import { afterEach, expect, test } from "vitest";
import { appClient, closeApps } from "./app_helpers.js";

afterEach(closeApps);

test("an_unknown_speaker_on_a_line_is_a_404", async () => {
  const { c } = await appClient();
  const book = async (name) => (await c.post("/v1/projects", { json: { name, project_type: "audiobook" } })).json().id;
  const pid = await book("Lines");
  const other = await book("Another");
  const sid = (await c.post(`/v1/projects/${pid}/scenes`, { json: { title: "One" } })).json().id;
  const stranger = (await c.post(`/v1/projects/${other}/speakers`, { json: { name: "Stranger" } })).json().id;

  const add = await c.post(`/v1/scenes/${sid}/blocks`, { json: { text: "Hello.", speaker_id: "nobody" } });
  expect(add.status).toBe(404);
  expect(add.json().detail).toBe("speaker nobody not found in this book");
  const bid = (await c.post(`/v1/scenes/${sid}/blocks`, { json: { text: "Hello." } })).json().id;
  for (const speaker of ["nobody", stranger]) {
    const r = await c.patch(`/v1/blocks/${bid}`, { json: { speaker_id: speaker } });
    expect(r.status, r.text).toBe(404);
  }
  const mara = (await c.post(`/v1/projects/${pid}/speakers`, { json: { name: "Mara" } })).json().id;
  expect((await c.patch(`/v1/blocks/${bid}`, { json: { speaker_id: mara } })).status).toBe(200);
  expect((await c.patch(`/v1/blocks/${bid}`, { json: { speaker_id: null } })).status).toBe(200);
});
