// SPDX-License-Identifier: MIT
// Engines marked for removal must say so on the wire — and must still work (the port of
// tests/test_engine_deprecation.py). The user's ruling: "dont remove them now you can mark
// them for removal and hide them if you want" — a non-empty manifest `DEPRECATED` string marks
// the engine and carries the user-facing reason, and nothing blocks install or load. Since round E
// (docs/plans/2026-10-29-round-e-onto-the-kit.md) the kit's audio.cpp runtime downloads and loads
// the models: a marked engine's models stay seeded into it, its downloads pass our licence hook,
// and its lines go.
//
// Nothing shipped is marked today; the mechanism stays, so these tests mark Kokoro for the
// length of a test.
import { afterEach, expect, test } from "vitest";
import { appClient, closeApps } from "./app_helpers.js";
import { endSpeech, endState, fakeSpeechRuntime, useState } from "./engines_helpers.js";
import * as hooks from "../src/engines/audiocpp/kit_hooks.js";
import { runtimeModelRows, variantOf } from "../src/engines/audiocpp/kit_models.js";
import * as kitSpeech from "../src/engines/audiocpp/kit_speech.js";
import { discoverEngines } from "../src/engines/model_catalog.js";

const REASON = "Marked for removal in this test — the reason a user reads on the badge.";
let restore = null;
afterEach(async () => {
  await closeApps();
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

test("marking_does_NOT_block_a_download_or_a_line", async () => {
  // Mark and hide, NOT remove: a marked engine somebody installed keeps working, and
  // downloading it again stays possible — its models stay in the kit's runtime, a download of one
  // passes our hook, and a line on one goes (the kit downloads and loads it — round E).
  const m = marked();
  const rows = runtimeModelRows().filter((r) => variantOf(r.id)?.engineId === "kokoro");
  expect(rows.map((r) => r.id)).toEqual(m.module.VARIANTS.map((v) => v.id));
  for (const r of rows) expect(hooks.beforeDownload(r), r.id).toBeUndefined();
  useState();
  try {
    const svc = fakeSpeechRuntime();
    await kitSpeech.speak("kokoro", "kokoro-82m-q8", { voice_id: "af_heart", text: "Hello." }); // must not throw
    expect(svc.lines.map((l) => l.modelId)).toEqual(["kokoro-82m-q8"]);
  } finally {
    endSpeech();
    endState();
  }
});

test("the_catalog_serves_the_mark", async () => {
  marked();
  const { c } = await appClient();
  const body = (await c.get("/v1/engines")).json();
  const served = Object.fromEntries(body.engines.filter((e) => e.backend === "managed").map((e) => [e.id, e]));
  expect(Object.keys(served).length, "no managed engines served").toBeGreaterThan(0);
  expect(served.kokoro.deprecated).toBe(REASON);
  for (const [engineId, row] of Object.entries(served)) {
    if (engineId !== "kokoro") expect(row.deprecated, engineId).toBe("");
  }
});
