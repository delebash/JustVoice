// SPDX-License-Identifier: MIT
// The cleanup's worked examples follow the Capture toggles (2026-10-08). With every toggle off a
// real model still removed fillers and applied spoken corrections, because the examples teaching
// those rode along with every call; now an example rides only when the toggles it shows are on.
// With all three off, every example keeps every word it was given — only capitals and
// punctuation change — and each toggle turned on adds its own examples. The Lab run sends the same
// set as production.
import { afterEach, expect, test, vi } from "vitest";
import * as run from "../src/engines/llm/run.js";
import { REFINEMENT_EXAMPLES, RefinementFlags, refinementExamplesFor, refineTranscript } from "../src/refinement.js";
import { appClient, closeApps } from "./app_helpers.js";

afterEach(closeApps);

const ALL_OFF = new RefinementFlags({ smartCleanup: false, selfCorrection: false, preserveTechnical: false });
const words = (s) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
const key = ([user]) => user;

test("with_every_toggle_off_the_examples_keep_every_word", () => {
  const off = refinementExamplesFor(ALL_OFF);
  expect(off.length).toBeGreaterThanOrEqual(2);
  for (const [user, assistant] of off) expect(words(assistant), user).toEqual(words(user));
});

test("each_toggle_adds_its_own_examples", () => {
  const off = new Set(refinementExamplesFor(ALL_OFF).map(key));
  for (const toggle of ["smartCleanup", "selfCorrection", "preserveTechnical"]) {
    const one = refinementExamplesFor(new RefinementFlags({ ...ALL_OFF, [toggle]: true }));
    const added = one.filter((e) => !off.has(key(e)));
    expect(added.length, toggle).toBeGreaterThan(0);
    // What a toggle adds changes the words — that is what it teaches.
    for (const [user, assistant] of added) expect(words(assistant), `${toggle}: ${user}`).not.toEqual(words(user));
    // Nothing the all-off set has is lost.
    for (const k of off) expect(one.map(key)).toContain(k);
  }
  // All on is the full list, in its order.
  expect(refinementExamplesFor(new RefinementFlags())).toEqual(REFINEMENT_EXAMPLES);
});

test("production_and_the_lab_send_the_toggles_examples", async () => {
  const calls = [];
  vi.spyOn(run, "runFeature").mockImplementation(async (_action, _vars, overrides) => {
    calls.push(overrides.history);
    return { text: "ok", model: "m" };
  });
  const { c } = await appClient(undefined, { seed: true }); // the prompt rows the system is composed from
  await refineTranscript("um hello", ALL_OFF);
  const expected = refinementExamplesFor(ALL_OFF).flatMap(([u, a]) => [
    { role: "user", content: u },
    { role: "assistant", content: a },
  ]);
  expect(calls[0]).toEqual(expected);

  const off = { captures: { smart_cleanup: false, self_correction: false, preserve_technical: false } };
  expect((await c.patch("/v1/settings", { json: off })).status).toBe(200);
  const r = await c.post("/v1/refine/lab-run", { json: { transcript: "um hello" } });
  expect(r.status, r.text).toBe(200);
  expect(calls.at(-1)).toEqual(expected);
});
