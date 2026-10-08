// SPDX-License-Identifier: MIT
// A speaker's pronouns (persona build P9, 2026-10-04 —
// docs/plans/2026-09-30-voice-gender-and-pronouns.md §3): set on Cast, filled by a JustWrite
// import, read by Script's Analyze and Smart-assign, never heard (the port of
// tests/test_speaker_pronouns.py).
import { afterEach, describe, expect, test } from "vitest";
import { _resolveCast } from "../src/api/extraction_api.js";
import { _formatCharacters, SmartAssignCharacter } from "../src/api/smart_assign_api.js";
import { Scene, uuid } from "../src/database/models.js";
import * as session from "../src/database/session.js";
import { promptHandles } from "../src/extraction/pipeline.js";
import { formatCharacters } from "../src/extraction/prompts.js";
import { _pronouns } from "../src/imports/adapters/justwrite.js";
import { construct } from "../src/models.js";
import { appClient, closeApps } from "./app_helpers.js";

afterEach(closeApps);

/** The `client` fixture: the app on a fresh data dir (no seeded workspace). */
async function makeClient() {
  return (await appClient()).c;
}

async function _project(c) {
  const r = await c.post("/v1/projects", { json: { name: "Stillwater", project_type: "audiobook" } });
  expect(r.status, r.text).toBe(201);
  return r.json().id;
}

test("cast_sets_changes_and_clears_a_speakers_pronouns", async () => {
  const c = await makeClient();
  const pid = await _project(c);
  const made = await c.post(`/v1/projects/${pid}/speakers`, { json: { name: "Mara", pronouns: "she/her" } });
  expect(made.status).toBe(201);
  expect(made.json().pronouns).toBe("she/her");
  const sid = made.json().id;
  expect((await c.patch(`/v1/speakers/${sid}`, { json: { pronouns: "they/them" } })).json().pronouns).toBe("they/them");
  // A PATCH that leaves it out keeps it; null clears it.
  expect((await c.patch(`/v1/speakers/${sid}`, { json: { description: "A pilot." } })).json().pronouns).toBe("they/them");
  expect((await c.patch(`/v1/speakers/${sid}`, { json: { pronouns: null } })).json().pronouns).toBeNull();
  expect((await c.patch(`/v1/speakers/${sid}`, { json: { pronouns: "xe/xem" } })).status).toBe(422);
  const listed = (await c.get(`/v1/projects/${pid}/speakers`)).json().speakers;
  expect(listed.map((s) => [s.name, s.pronouns])).toEqual([["Mara", null]]);
});

describe("a_justwrite_sheets_pronouns_become_one_of_the_four", () => {
  test.each([
    ["he/him", "he/him"],
    [" She/Her ", "she/her"],
    ["they", "they/them"],
    ["it/its", "it/its"],
    ["xe/xem", null],
    ["", null],
    [null, null],
  ])("%j → %j", (sheet, want) => {
    expect(_pronouns({ pronouns: sheet })).toBe(want);
  });
});

test("analyze_and_smart_assign_are_told_the_pronouns", () => {
  // The attribution prompt's speakers line (via the readable handles), and Smart-assign's.
  const cast = [
    { id: "s1", name: "Mara Vance", pronouns: "she/her", aliases: [] },
    { id: "s2", name: "Odd", pronouns: null, aliases: [] },
  ];
  const line = formatCharacters(promptHandles(cast)[0]);
  expect(line).toContain('name="Mara Vance", pronouns="she/her"');
  expect(line.split("pronouns=").length - 1).toBe(1);

  const out = _formatCharacters([construct(SmartAssignCharacter, { id: "s1", name: "Mara Vance", pronouns: "she/her" })]);
  expect(out).toContain('pronouns="she/her"');
});

test("the_cast_resolver_sends_each_speakers_pronouns", async () => {
  const c = await makeClient();
  const pid = await _project(c);
  await c.post(`/v1/projects/${pid}/speakers`, { json: { name: "Mara", pronouns: "she/her" } });
  const h = session.getDb();
  const sceneId = uuid();
  h.insert(Scene, { id: sceneId, project_id: pid, title: "One", position: 0 });
  const cast = _resolveCast(sceneId, h);
  expect(cast.map((x) => [x.name, x.pronouns])).toEqual([["Mara", "she/her"]]);
});
