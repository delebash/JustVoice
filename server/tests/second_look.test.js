// SPDX-License-Identifier: MIT
// Analyze's second look at lines it leaves with no speaker (2026-10-05) — the port of
// tests/test_second_look.py.
//
// What these pin: only spoken lines with no speaker are asked about — none, no call; a cast
// member it names is saved with source "second_look", marked "nearby", and counted as AI
// decided; a name it gives who is not in the cast stays on the line for Script's offer, and a
// re-analyze clears it; an answer below the floor, a cast member offered as "not in the cast", a
// line you set, and a failed call all leave the line as it was; the neighbouring chapters' text
// reaches the prompt, trimmed; the setting turns it off.
//
// The three "Through Analyze" tests drive the app's routes (POST /v1/scenes/{id}/analyze,
// /script, PATCH /v1/settings). The main pass is `pipeline.runFeature` (its prompt measure,
// `pipeline.measureFeature`, stubbed to "can't say"); the second look's own call is
// `second_look.runFeature`.
//
// Two of them FAIL in Python today (measured 2026-10-08):
// `analyze_saves_the_second_look_and_script_shows_it` and
// `the_offer_is_saved_and_a_reanalyze_clears_it`. Analyze's own second look is off by default
// since 2026-10-06 (ExtractionSettings.second_look false) and they never turn it on, so no
// second-look call is made (IndexError on `calls[0]`, KeyError on `not_in_cast`). Here they turn
// it on first (PATCH /v1/settings {extraction: {second_look: true}}) — what they test — and pass.
import { RuntimeError } from "@delebash/llm-runner/platform/py";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Line, flagGroups } from "../src/extraction/flags.js";
import * as pipeline from "../src/extraction/pipeline.js";
import { AttributionRow } from "../src/extraction/pipeline.js";
import * as sl from "../src/extraction/second_look.js";
import { construct, ExtractionSettings } from "../src/models.js";
import { appClient, closeApps } from "./app_helpers.js";
import { bookJson, scene } from "./jw_fixtures.js";

afterEach(closeApps);

const CFG = construct(ExtractionSettings, {});

const _row = (text, speaker = "unknown", kind = "dialogue", source = "floored", para = 0) =>
  new AttributionRow({ paragraph_idx: para, kind, text, speaker, confidence: 0.4, source });

/** runFeature that answers from `answers` in order and records the variables. */
function _stub(answers, calls) {
  return async (action, variables) => {
    calls.push([action, variables]);
    const ans = answers[calls.length - 1];
    if (ans instanceof Error) throw ans;
    return { text: JSON.stringify(ans) };
  };
}

async function _look(rows, answers, kw = {}) {
  const calls = [];
  vi.spyOn(sl, "runFeature").mockImplementation(_stub(answers, calls));
  const out = {};
  await sl.secondLook(rows, ["The candle burned.", "“You always find the candle first.”"], {
    castText: '- id="ode", name="Ode"',
    resolve: (raw) => (raw === "ode" ? "id-ode" : "unknown"),
    castNames: (n) => n.toLowerCase() === "ode",
    floor: 0.5,
    useFloor: true,
    beforeText: kw.before ?? null,
    afterText: kw.after ?? null,
    cfg: kw.cfg ?? CFG,
    skip: kw.skip ?? new Set(),
    rawOut: out,
  });
  return [calls, out.second_look];
}

// ── The pass ─────────────────────────────────────────────────────────────

test("a_named_cast_member_is_saved_marked", async () => {
  const rows = [_row("The candle burned.", "narrator", "narration", "narration"), _row("“You always find the candle first.”", undefined, undefined, undefined, 1)];
  const [calls, report] = await _look(rows, [{ speaker: "ode", confidence: 1 }]);
  expect(calls.length).toBe(1);
  expect(calls[0][0]).toBe("speaker_second_look");
  expect(calls[0][1].chapter).toContain("⟦“You always find the candle first.”⟧");
  expect([rows[1].speaker, rows[1].source, rows[1].confidence]).toEqual(["id-ode", "second_look", 1.0]);
  expect(report.named).toBe(1);
});

test("nothing_blank_means_no_call", async () => {
  const [calls, report] = await _look([_row("“Hello.”", "id-ode", undefined, "llm")], []);
  expect(calls).toEqual([]);
  expect(report.asked).toBe(0);
});

test("someone_not_in_the_cast_is_kept_for_the_offer", async () => {
  const rows = [_row("“You're for the Nine,”")];
  const [, report] = await _look(rows, [{ speaker: "unknown", not_in_cast: "Old Sedge" }]);
  expect(rows[0].speaker).toBe("unknown");
  expect(rows[0].not_in_cast).toBe("Old Sedge");
  expect(report.not_in_cast).toEqual(["Old Sedge"]);
});

describe("these_leave_the_line_as_it_was", () => {
  test.each([
    ["below the floor", { speaker: "ode", confidence: 0.3 }],
    ["a cast member is never 'not in the cast'", { speaker: "unknown", not_in_cast: "Ode" }],
    ["the narrator doesn't speak a quote here", { speaker: "narrator", confidence: 1 }],
    ["a failed call", new RuntimeError("model gone")],
  ])("%s", async (_name, answer) => {
    const rows = [_row("“You always find the candle first.”")];
    await _look(rows, [answer]);
    expect([rows[0].speaker, rows[0].source, rows[0].not_in_cast]).toEqual(["unknown", "floored", null]);
  });
});

test("a_line_you_set_is_not_asked_about", async () => {
  const [calls] = await _look([_row("“One.”"), _row("“Two.”")], [{ speaker: "unknown" }], { skip: new Set([0]) });
  expect(calls.length).toBe(1);
  expect(calls[0][1].line).toBe("“Two.”");
});

test("the_neighbours_are_trimmed_into_the_prompt", async () => {
  const before = Array.from({ length: 2000 }, (_, i) => `b${i}`).join(" ");
  const after = Array.from({ length: 2000 }, (_, i) => `a${i}`).join(" ");
  let [calls] = await _look([_row("“Hm.”")], [{ speaker: "unknown" }], { before, after });
  const v = calls[0][1];
  expect(v.before.split(" ")).toEqual(Array.from({ length: CFG.second_look_before }, (_, k) => `b${2000 - CFG.second_look_before + k}`));
  expect(v.after.split(" ")).toEqual(Array.from({ length: CFG.second_look_after }, (_, k) => `a${k}`));
  [calls] = await _look([_row("“Hm.”")], [{ speaker: "unknown" }]);
  expect(calls[0][1].before).toContain("first chapter");
  expect(calls[0][1].after).toContain("last chapter");
});

test("the_cast_carries_who_they_are", () => {
  // "Answers to Ode." is the only link from Odeline Marran to the "Ode" the next chapter names
  // — the main call's cast list leaves descriptions out.
  const text = sl.castLines([{ id: "odeline_marran", name: "Odeline Marran", aliases: [], description: "Has been living the same hour.\n\nAnswers to Ode." }]);
  expect(text).toBe('- id="odeline_marran", name="Odeline Marran", who="Has been living the same hour. Answers to Ode."');
});

test("a_second_look_line_carries_the_nearby_mark", () => {
  const lines = [new Line({ id: "a", speaker: "ode", text: "“You always find the candle first.”", source: "second_look" })];
  // "nearby" first: it is the question Script asks of the line.
  expect(flagGroups(lines, new Set(["ode"])).map((g) => g.check)).toEqual(["nearby", "only"]);
});

// ── Through Analyze ──────────────────────────────────────────────────────

const P1 = "The candle burned. The wax climbed.";
const P2 = "“You always find the candle first,” said someone in the dark.";

/** The app + a three-chapter book; `book.scene_id` is the middle chapter (Python's `client` +
 * `book` fixtures). */
async function _book() {
  const { c } = await appClient(undefined, { seed: true });
  const r = await c.post("/v1/projects/import?source=justwrite", {
    json: bookJson({
      chapters: [
        ["ch1", "One", [scene("scn1", "Before it all began, they had argued.")]],
        ["ch2", "Two", [scene("scn2", P1, P2)]],
        ["ch3", "Three", [scene("scn3", "“I'm Mara,” she said. “I lit the candle.”")]],
      ],
    }),
  });
  expect(r.status, r.text).toBe(200);
  const pid = r.json().project_id;
  const scenes = (await c.get(`/v1/projects/${pid}/scenes`)).json();
  return { c, book: { id: pid, scene_id: scenes[1].id } };
}

/** The main pass leaves the line with no speaker (`pipeline.runFeature`). */
function _mainUnknown() {
  vi.spyOn(pipeline, "measureFeature").mockResolvedValue(null);
  vi.spyOn(pipeline, "runFeature").mockImplementation(async () => ({
    text: '[{"dialogue_id": 0, "speaker": "unknown", "confidence": 0.2}]',
    prompt_tokens: 0,
    completion_tokens: 0,
    model: "stub",
  }));
}

/** Analyze's own second look, on — off by default since 2026-10-06 (see the header). */
async function _secondLookOn(c) {
  const r = await c.patch("/v1/settings", { json: { extraction: { second_look: true } } });
  expect(r.status, r.text).toBe(200);
}

async function _analyze(c, book) {
  const text = (await c.get(`/v1/scenes/${book.scene_id}/blocks`)).json().map((b) => b.text).join("\n\n");
  const r = await c.post(`/v1/scenes/${book.scene_id}/analyze`, { json: { text } });
  expect(r.status, r.text).toBe(200);
  return r.json();
}

const _spokenLine = async (c, book) => (await c.get(`/v1/scenes/${book.scene_id}/script`)).json().lines.find((ln) => ln.spoken);

test("analyze_saves_the_second_look_and_script_shows_it", async () => {
  const { c, book } = await _book();
  await _secondLookOn(c);
  const mara = (await c.get(`/v1/projects/${book.id}/speakers`)).json().speakers.find((s) => s.name === "Mara Vance").id;
  const calls = [];
  _mainUnknown();
  vi.spyOn(sl, "runFeature").mockImplementation(_stub([{ speaker: "mara_vance", confidence: 1 }], calls));
  await _analyze(c, book);
  expect(calls[0][1].before).toContain("argued");
  expect(calls[0][1].after).toContain("I lit the candle");

  const script = (await c.get(`/v1/scenes/${book.scene_id}/script`)).json();
  const line = script.lines.find((ln) => ln.spoken);
  expect([line.speaker_id, line.source]).toEqual([mara, "second_look"]);
  expect(script.flag_groups.some((f) => f.check === "nearby")).toBe(true);
  const chapter = (await c.get(`/v1/projects/${book.id}/script`)).json().chapters.find((ch) => ch.scene_id === book.scene_id);
  expect(chapter.guessed).toBeGreaterThanOrEqual(1);
  expect(chapter.no_speaker).toBe(0);
});

test("the_offer_is_saved_and_a_reanalyze_clears_it", async () => {
  const { c, book } = await _book();
  await _secondLookOn(c);
  _mainUnknown();
  const calls = [];
  vi.spyOn(sl, "runFeature").mockImplementation(_stub([{ speaker: "unknown", not_in_cast: "Old Sedge" }, { speaker: "unknown" }], calls));
  await _analyze(c, book);
  let line = await _spokenLine(c, book);
  expect(line.speaker_id).toBeNull();
  expect(line.metadata.not_in_cast).toBe("Old Sedge");
  await _analyze(c, book);
  line = await _spokenLine(c, book);
  expect(line.metadata).not.toHaveProperty("not_in_cast");
});

test("the_setting_turns_it_off", async () => {
  const { c, book } = await _book();
  expect((await c.patch("/v1/settings", { json: { extraction: { second_look: false } } })).status).toBe(200);
  const calls = [];
  _mainUnknown();
  vi.spyOn(sl, "runFeature").mockImplementation(_stub([], calls));
  await _analyze(c, book);
  expect(calls).toEqual([]);
  expect((await c.get("/v1/extraction/config")).json().second_look).toBe(false);
});
