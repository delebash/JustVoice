// SPDX-License-Identifier: MIT
// A speaker needs a name: a blank one is refused on Add and on a rename, as a persona's is. A Python
// bug copied into the port on purpose stored a rename to blanks as an empty name (TASKS "The family
// moves to Electron…", agent 3's list; fixed 2026-11-05 as decided 2026-10-08).
import { afterEach, expect, test } from "vitest";
import { appClient, closeApps } from "./app_helpers.js";

afterEach(closeApps);

test("a_blank_name_is_refused_on_add_and_on_rename", async () => {
  const { c } = await appClient();
  const pid = (await c.post("/v1/projects", { json: { name: "Names", project_type: "audiobook" } })).json().id;
  const blank = await c.post(`/v1/projects/${pid}/speakers`, { json: { name: "   " } });
  expect(blank.status).toBe(400);
  expect(blank.json().detail).toBe("A speaker needs a name.");
  const mara = (await c.post(`/v1/projects/${pid}/speakers`, { json: { name: "Mara" } })).json();
  const renamed = await c.patch(`/v1/speakers/${mara.id}`, { json: { name: " \t " } });
  expect(renamed.status).toBe(400);
  expect(renamed.json().detail).toBe("A speaker needs a name.");
  const speakers = (await c.get(`/v1/projects/${pid}/speakers`)).json().speakers;
  expect(speakers.map((s) => s.name)).toEqual(["Mara"]);
});
