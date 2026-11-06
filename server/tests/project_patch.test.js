// SPDX-License-Identifier: MIT
// PATCH /v1/projects/{id} answers the project as GET does — its chapter count included. A Python bug
// copied into the port on purpose answered `scene_count: 0` (TASKS "The family moves to Electron…",
// agent 3's list; fixed 2026-11-05 as decided 2026-10-08).
import { afterEach, expect, test } from "vitest";
import { appClient, closeApps } from "./app_helpers.js";

afterEach(closeApps);

test("patch_answers_the_chapter_count", async () => {
  const { c } = await appClient();
  const pid = (await c.post("/v1/projects", { json: { name: "Counted", project_type: "audiobook" } })).json().id;
  for (const title of ["One", "Two"]) {
    const r = await c.post(`/v1/projects/${pid}/scenes`, { json: { title } });
    expect(r.status, r.text).toBeLessThan(300);
  }
  expect((await c.get(`/v1/projects/${pid}`)).json().scene_count).toBe(2);
  const patched = await c.patch(`/v1/projects/${pid}`, { json: { name: "Counted again" } });
  expect(patched.status, patched.text).toBe(200);
  expect(patched.json().scene_count).toBe(2);
});
