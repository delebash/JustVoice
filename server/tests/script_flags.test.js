// SPDX-License-Identifier: MIT
// Script's Check column — extraction/flags.js (§8.24, 3a) — the port of
// tests/test_script_flags.py.
//
// Each check was measured on answer-keyed books before it was built (§8.23, §8.25). These pin
// the rules as measured, on hand-made runs and on the three sample books' answer keys, where
// every flag is by definition a false alarm.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { Line, flagGroups, flaggedLines, linesFromRows, quoteLeftOpen } from "../src/extraction/flags.js";
import { detectMarks, segmentParagraphs, splitIntoParagraphs } from "../src/extraction/segmentation.js";
import { runAdapter } from "../src/imports/index.js";

const CAST = new Set(["marius", "june", "renn", "narrator"]);
const SAMPLES = path.resolve(import.meta.dirname, "..", "samples"); // the server package's bundled samples

const say = (i, who, text = "“Line.”", { p = null, source = "llm", llm = null } = {}) =>
  new Line({ id: `d${i}`, speaker: who, text, spoken: true, source, paragraph: p === null ? i : p, llm_speaker: llm });

const prose = (i, text = "He paused.", { p = null } = {}) =>
  new Line({ id: `n${i}`, speaker: "narrator", text, spoken: false, source: "narration", paragraph: p === null ? i : p });

const checks = (lines, cast = CAST) => flagGroups(lines, cast).map((g) => [g.check, g.speaker, g.lines]);
const runs = (lines) => checks(lines).filter((c) => c[0] === "run");

// ── Three in a row ─────────────────────────────────────────────────────────

test("three_turns_with_no_reply_flag_the_whole_run", () => {
  // "Ino." / "Quartermaster." / "Breathe." all went to one speaker, and the wrong one was the
  // MIDDLE line — so the group is the run, not its third.
  const lines = [say(0, "june"), say(1, "june"), say(2, "june"), say(3, "marius")];
  const run = flagGroups(lines, CAST).filter((g) => g.check === "run");
  expect(run.length).toBe(1);
  expect(run[0].lines).toEqual(["d0", "d1", "d2"]);
  expect(run[0].turns).toBe(3);
});

test("two_turns_are_a_normal_exchange", () => {
  expect(runs([say(0, "june"), say(1, "june"), say(2, "marius")])).toEqual([]);
});

test("a_narration_only_paragraph_breaks_the_run", () => {
  expect(runs([say(0, "june"), say(1, "june"), prose(2), say(3, "june")])).toEqual([]);
});

test("narration_inside_a_spoken_paragraph_does_not_break_it", () => {
  const lines = [say(0, "june"), say(1, "june", undefined, { p: 1 }), prose(1, "she said,", { p: 1 }), say(9, "june", undefined, { p: 1 }), say(2, "june")];
  expect(runs(lines)).toEqual([["run", "june", ["d0", "d1", "d9", "d2"]]]);
});

test("a_speech_over_several_paragraphs_is_one_turn", () => {
  // Helen Stoner's account: each paragraph opens a quote, only the last closes it. Counted per
  // paragraph it was 2 false alarms on the key.
  const lines = [say(0, "june", "“It began last spring."), say(1, "june", "“Then the letters stopped."), say(2, "june", "“That is all.”"), say(3, "marius"), say(4, "june")];
  expect(runs(lines)).toEqual([]);
});

test("the_speech_then_two_more_turns_is_three", () => {
  const lines = [say(0, "june", "“It began last spring."), say(1, "june", "“That is all.”"), say(2, "june"), say(3, "june")];
  const groups = flagGroups(lines, CAST).filter((g) => g.check === "run");
  expect(groups.length).toBe(1);
  expect(groups[0].turns).toBe(3);
});

test("a_paragraph_with_two_speakers_or_none_breaks_the_run", () => {
  const two = [say(0, "june"), say(1, "june"), say(2, "june", undefined, { p: 2 }), say(8, "marius", undefined, { p: 2 }), say(3, "june")];
  const none = [say(0, "june"), say(1, "june"), say(2, null, undefined, { source: "floored" }), say(3, "june")];
  expect(runs(two)).toEqual([]);
  expect(runs(none)).toEqual([]);
});

test("lines_you_set_are_never_marked", () => {
  const mixed = [say(0, "june", undefined, { source: "corrected" }), say(1, "june"), say(2, "june")];
  expect(runs(mixed)).toEqual([["run", "june", ["d1", "d2"]]]);
  const yours = [0, 1, 2].map((i) => say(i, "june", undefined, { source: "corrected" }));
  expect(checks(yours)).toEqual([]);
});

test("imported_lines_are_their_own_paragraphs_and_never_marked", () => {
  const lines = [0, 1, 2, 3].map((i) => say(i, "june", undefined, { source: "manual" }));
  for (const ln of lines) ln.paragraph = null;
  expect(checks(lines)).toEqual([]);
});

// ── One line at a time ─────────────────────────────────────────────────────

test("a_personas_only_line", () => {
  const lines = [say(0, "marius"), say(1, "june"), say(2, "marius"), say(3, "renn")];
  expect(checks(lines)).toContainEqual(["only", "renn", ["d3"]]);
  expect(checks(lines)).toContainEqual(["only", "june", ["d1"]]);
  expect(checks(lines).some((c) => c[0] === "only" && c[1] === "marius")).toBe(false);
});

test("the_narrator_is_an_ordinary_persona", () => {
  // No "given to the Narrator" check (2026-09-29): any cast member can narrate, and a
  // first-person narrator speaks. One line of it is an only line, three in a row a run.
  const lines = [say(0, "narrator"), say(1, "june"), say(2, "june")];
  expect(checks(lines)).toEqual([["only", "narrator", ["d0"]]]);
  const three = [...[0, 1, 2].map((i) => say(i, "narrator")), say(3, "june")];
  expect(checks(three).map((c) => c[0])).toEqual(["run", "only"]);
});

test("the_book_and_the_model_disagree", () => {
  const lines = [say(0, "june", undefined, { source: "tag", llm: "marius" }), say(1, "marius"), say(2, "june")];
  const dis = flagGroups(lines, CAST).filter((g) => g.check === "disagree");
  expect(dis.length).toBe(1);
  expect(dis[0].speaker).toBe("june");
  expect(dis[0].other).toBe("marius");
});

test("a_speaker_the_cast_does_not_hold_is_never_an_only_line", () => {
  // Since 2026-09-29 a removed speaker's lines lose their speaker, so this only happens with
  // stale ids — the "only line" check is still about the cast.
  const lines = [say(0, "tom"), say(1, "tom"), say(2, "june"), say(3, "june")];
  expect(checks(lines).some((c) => c[0] === "only" && c[1] === "tom")).toBe(false);
});

test("groups_come_in_reading_order", () => {
  const lines = [say(0, "renn"), say(1, "june"), say(2, "june"), say(3, "june"), say(4, "marius", undefined, { source: "tag", llm: "june" })];
  expect(checks(lines).map((c) => c[0])).toEqual(["only", "run", "only", "disagree"]);
  expect(flaggedLines(flagGroups(lines, CAST))).toEqual(new Set(["d0", "d1", "d2", "d3", "d4"]));
});

test("quote_left_open", () => {
  expect(quoteLeftOpen("“It began last spring.")).toBe(true);
  expect(quoteLeftOpen('"It began last spring.')).toBe(true);
  expect(quoteLeftOpen("“It began,” she said.")).toBe(false);
  expect(quoteLeftOpen('"It began," she said.')).toBe(false);
});

test("the_pipelines_rows_as_lines", () => {
  const rows = [
    { paragraph_idx: 0, kind: "narration", text: "He sat.", speaker: "narrator", source: "narration" },
    { paragraph_idx: 1, kind: "dialogue", text: "Go.", speaker: "june", source: "tag", llm_speaker: "marius" },
    { paragraph_idx: 2, kind: "dialogue", text: "No.", speaker: "unknown", source: "floored", llm_speaker: "marius" },
  ];
  const lines = linesFromRows(rows);
  expect(lines.map((ln) => ln.id)).toEqual(["N0", "D0", "D1"]);
  expect(lines[1].llm_speaker).toBe("marius"); // the book won, the model differed
  expect(lines[2].speaker).toBeNull();
  expect(lines[2].llm_speaker).toBeNull();
});

// ── The answer keys: every flag there is a false alarm ─────────────────────

function* _keyLines(sample) {
  const root = path.join(SAMPLES, sample);
  const key = JSON.parse(readFileSync(path.join(root, "attribution-truth.json"), "utf8"));
  const bookFile = key.book ?? "book.json";
  const book = runAdapter(key.adapter ?? "justwrite", readFileSync(path.join(root, bookFile)), { filename: bookFile });
  const cast = new Set(key.cast.map((c) => (typeof c === "string" ? c : c.name)));
  for (const scene of book.scenes) {
    const truth = key.chapters[scene.title];
    if (truth === undefined) continue;
    const text = scene.lines
      .filter((l) => l.text)
      .map((l) => l.text)
      .join("\n\n");
    const paras = splitIntoParagraphs(text);
    const lines = [];
    let d = 0;
    segmentParagraphs(paras).forEach((seg, i) => {
      if (seg.kind === "dialogue") {
        const who = truth[String(d)];
        lines.push(new Line({ id: `D${d}`, speaker: who === undefined || who === null || who === "unknown" ? null : who, text: seg.text, source: "llm", paragraph: seg.paragraph_idx }));
        d += 1;
      } else {
        lines.push(new Line({ id: `N${i}`, speaker: "Narrator", text: seg.text, spoken: false, source: "narration", paragraph: seg.paragraph_idx }));
      }
    });
    const marks = detectMarks(text); // the chapter's, as the app and the eval read it
    const openParas = new Set(paras.flatMap((p, i) => (quoteLeftOpen(p, marks) ? [i] : [])));
    yield [scene.title, flagGroups(lines, cast, { openParagraphs: openParas })];
  }
}

describe("the_answer_keys_raise_no_run_flag", () => {
  test.each(["the-ninth-facet", "the-salt-iron-road", "the-speckled-band"])("%s", (sample) => {
    for (const [, groups] of _keyLines(sample)) expect(groups.filter((g) => g.check === "run" || g.check === "disagree")).toEqual([]);
  });
});

test("the_answer_keys_only_lines_are_real_ones", () => {
  // A persona with one line in a chapter is flagged whether or not the line is right — the
  // check asks. On the keys that is exactly one line.
  const only = [];
  for (const s of ["the-ninth-facet", "the-salt-iron-road", "the-speckled-band"]) {
    for (const [t, groups] of _keyLines(s)) for (const g of groups) if (g.check === "only") only.push([s, t, g.speaker]);
  }
  expect(only).toEqual([["the-ninth-facet", "Bigger Inside", "Odeline Marran"]]);
});

