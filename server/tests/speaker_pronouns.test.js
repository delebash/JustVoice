// SPDX-License-Identifier: MIT
// A speaker's pronouns (persona build P9, 2026-10-04 —
// docs/plans/2026-09-30-voice-gender-and-pronouns.md §3): set on Cast, filled by a JustWrite
// import, read by Script's Analyze and Smart-assign, never heard (the port of
// tests/test_speaker_pronouns.py). Two tests drive the Cast routes / extraction_api's cast
// resolver and wait for the API wave; the Smart-assign half of the third runs once
// api/smart_assign_api.js exists.
import { describe, expect, test } from "vitest";
import { promptHandles } from "../src/extraction/pipeline.js";
import { formatCharacters } from "../src/extraction/prompts.js";
import { _pronouns } from "../src/imports/adapters/justwrite.js";

let smartAssign = null;
try {
  smartAssign = await import("../src/api/smart_assign_api.js");
} catch (e) {
  if (!/Cannot find module|Failed to load url/.test(String(e?.message))) throw e;
}

test.todo("cast_sets_changes_and_clears_a_speakers_pronouns — waits for api/speakers_api.js + api/projects_api.js routes + app.js");

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

  if (smartAssign !== null) {
    const out = smartAssign._formatCharacters([{ id: "s1", name: "Mara Vance", pronouns: "she/her" }]);
    expect(out).toContain('pronouns="she/her"');
  }
});

test.todo("the_cast_resolver_sends_each_speakers_pronouns — waits for api/extraction_api.js (_resolve_cast) + app.js");
