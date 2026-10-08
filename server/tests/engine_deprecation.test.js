// SPDX-License-Identifier: MIT
// Engines marked for removal must say so on the wire — and must still work (the port of
// tests/test_engine_deprecation.py). The user's ruling: "dont remove them now you can mark
// them for removal and hide them if you want" — a non-empty manifest `DEPRECATED` string marks
// the engine and carries the user-facing reason, and nothing blocks install or load.
//
// Nothing shipped is marked today; the mechanism stays, so these tests mark Kokoro for the
// length of a test.
import { afterEach, expect, test, vi } from "vitest";
import "./engines_helpers.js";
import * as manager from "../src/engines/manager.js";
import { discoverEngines } from "../src/engines/manager.js";

const REASON = "Marked for removal in this test — the reason a user reads on the badge.";
let restore = null;
afterEach(() => {
  if (restore) restore();
  restore = null;
});

function marked() {
  const m = discoverEngines().get("kokoro");
  const had = Object.hasOwn(m.module, "DEPRECATED");
  const was = m.module.DEPRECATED;
  m.module.DEPRECATED = REASON;
  restore = () => {
    if (had) m.module.DEPRECATED = was;
    else delete m.module.DEPRECATED;
  };
  return m;
}

test("no_shipped_engine_is_marked", () => {
  const ids = [...discoverEngines().entries()].filter(([, m]) => m.deprecated).map(([id]) => id);
  expect(ids).toEqual([]);
});

test("the_mark_is_the_reason_a_user_reads", () => {
  // The flag is a sentence, not a boolean — the UI shows it verbatim.
  expect(marked().deprecated).toBe(REASON);
});

test("an_unmarked_engine_reports_an_empty_string_not_none", () => {
  // `deprecated` is always a string, so the renderer can `.trim()` it.
  for (const [eid, m] of discoverEngines()) expect(m.deprecated, eid).toBeTypeOf("string");
});

test("marking_does_NOT_block_install", async () => {
  // Mark and hide, NOT remove: a marked engine somebody installed keeps working, and
  // installing it again stays possible.
  const m = marked();
  const called = [];
  vi.spyOn(manager, "_installAudiocppRuntime").mockImplementation(async () => called.push("runtime"));
  await manager.installEngine(m); // must not throw
  expect(called).toEqual(["runtime"]);
});

test.todo("the_catalog_serves_the_mark — waits for app.js + api/engines_api.js");
