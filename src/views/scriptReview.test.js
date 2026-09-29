// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";

import {
  applyLocally, checkQuestion, confidenceCell, confirm, decidedBy, filterCounts, keyAction,
  markOf, move, nextToCheck, numberKeys, popUndo, pushUndo, setSpeaker, speakerOptions, swap,
  swapState, toCheck, visibleLines, wasBefore,
} from "./scriptReview.js";

const line = (id, persona_id, extra = {}) => ({
  id, persona_id, source: "llm", confidence: 0.95, spoken: true, speakable: true, marker: false,
  flags: [], changed: false, metadata: { paragraph_idx: 0 }, paragraph: 0, ...extra,
});

// A chapter: narration, a run of three June lines (one group), a line with no
// speaker, and a line the last Analyze changed.
const LINES = [
  line("n0", "nar", { source: "narration", spoken: false, confidence: 1 }),
  line("d1", "june", { flags: [0] }),
  line("d2", "june", { flags: [0] }),
  line("d3", "june", { flags: [0] }),
  line("d4", null, { source: "floored", confidence: 0.4, floored_from: "marius" }),
  line("d5", "marius", { changed: true, prev_persona_id: "june" }),
  line("m6", null, { marker: true, speakable: false, spoken: false }),
];
const GROUPS = [{ check: "run", speaker: "june", lines: ["d1", "d2", "d3"], turns: 3 }];
const NAMES = { june: "June", marius: "Marius", nar: "Narrator", tom: "Tom Harlan" };
const nameOf = (id) => NAMES[id] || id;

describe("filters", () => {
  it("To check is flagged lines plus lines with no speaker", () => {
    expect(LINES.filter(toCheck).map((l) => l.id)).toEqual(["d1", "d2", "d3", "d4"]);
  });

  it("a filter's number is the number of rows it shows, markers left out", () => {
    expect(filterCounts(LINES)).toEqual({ all: 6, check: 4, none: 1, changed: 1 });
    for (const f of ["check", "none", "changed"]) {
      expect(visibleLines(LINES, { filter: f }).filter((l) => !l.marker)).toHaveLength(filterCounts(LINES)[f]);
    }
  });

  it("narrows to one speaker, and can show the lines around each", () => {
    expect(visibleLines(LINES, { speaker: "marius" }).map((l) => l.id)).toEqual(["d5"]);
    expect(visibleLines(LINES, { filter: "none", around: true }).map((l) => l.id)).toEqual(["d3", "d4", "d5"]);
  });
});

describe("selection", () => {
  it("moves among the lines shown, and stops at the ends", () => {
    const shown = visibleLines(LINES, { filter: "check" });
    expect(move(shown, "d1", 1)).toBe("d2");
    expect(move(shown, "d4", 1)).toBe("d4");
    expect(move(shown, "d1", -1)).toBe("d1");
    expect(move(shown, null, 1)).toBe("d1");
  });

  it("Next to check walks the whole chapter in reading order", () => {
    expect(nextToCheck(LINES, "n0", 1)).toBe("d1");
    expect(nextToCheck(LINES, "d3", 1)).toBe("d4");
    expect(nextToCheck(LINES, "d4", 1)).toBeNull();
    expect(nextToCheck(LINES, "d4", -1)).toBe("d3");
    expect(nextToCheck(LINES, null, 1)).toBe("d1");
  });
});

describe("speakers", () => {
  const speakers = [
    { persona_id: "nar", name: "Narrator", lines: 118, in_cast: true },
    { persona_id: "june", name: "June", lines: 33, in_cast: true },
    { persona_id: "marius", name: "Marius", lines: 38, in_cast: true },
    { persona_id: "renn", name: "Renn", lines: 0, in_cast: true },
    { persona_id: "tom", name: "Tom Harlan", lines: 14, in_cast: false },
  ];

  it("1–9 are this chapter's cast speakers, most lines first; the Narrator is 0", () => {
    expect(numberKeys(speakers, "nar")).toEqual(["marius", "june"]);
  });

  it("the dropdown offers the Narrator first, then the cast; a speaker who left only on their own lines", () => {
    expect(speakerOptions(speakers, "nar", line("x", "june")).map((o) => o.label))
      .toEqual(["Narrator", "Marius", "June", "Renn"]);
    expect(speakerOptions(speakers, "nar", line("x", "tom"))[0])
      .toEqual({ value: "tom", label: "Tom Harlan — not in this cast" });
  });
});

describe("changes", () => {
  it("setting a speaker makes the line yours and skips lines that already have them", () => {
    const ch = setSpeaker(LINES, ["d1", "d5", "m6"], "marius");
    expect(ch.map((c) => c.id)).toEqual(["d1"]);
    expect(ch[0].after).toEqual({ persona_id: "marius", source: "corrected" });
    expect(ch[0].before).toMatchObject({ persona_id: "june", source: "llm", extraction_confidence: 0.95 });
  });

  it("Looks right takes the whole mark, and never a line with no speaker", () => {
    expect(markOf(GROUPS, LINES, "d2")).toEqual(["d2", "d1", "d3"]);
    expect(markOf(GROUPS, LINES, "d5")).toEqual(["d5"]);
    expect(confirm(LINES, ["d1", "d2", "d3", "d4"]).map((c) => c.after)).toEqual([
      { source: "corrected" }, { source: "corrected" }, { source: "corrected" }]);
  });

  it("swap needs exactly two speakers, and trades them", () => {
    expect(swapState(LINES, ["d1", "d2"])).toMatchObject({ ok: false });
    expect(swapState(LINES, ["d1", "d4"]).reason).toMatch(/no speaker/);
    expect(swapState(LINES, ["d1", "d5"])).toEqual({ ok: true, a: "june", b: "marius" });
    expect(swap(LINES, ["d1", "d5"]).map((c) => [c.id, c.after.persona_id])).toEqual([["d1", "marius"], ["d5", "june"]]);
    expect(swap(LINES, ["d1", "d2"])).toEqual([]);
  });

  it("the page shows a change at once: the line is yours, unmarked and not 'changed'", () => {
    const after = applyLocally(LINES, setSpeaker(LINES, ["d5"], "june"));
    expect(after.find((l) => l.id === "d5")).toMatchObject({ persona_id: "june", source: "corrected", flags: [], changed: false });
    expect(after.find((l) => l.id === "d1")).toBe(LINES[1]);
  });
});

describe("undo", () => {
  it("steps back newest first, putting each line back and deleting the fixes it saved", () => {
    let stack = [];
    const a = setSpeaker(LINES, ["d1"], "marius").map((c) => ({ ...c, fixId: "fx1" }));
    stack = pushUndo(stack, a, "set");
    stack = pushUndo(stack, confirm(LINES, ["d5"]), "looks right");
    stack = pushUndo(stack, [], "nothing");        // a no-op leaves no entry
    expect(stack.map((e) => e.label)).toEqual(["looks right", "set"]);

    let u = popUndo(stack);
    expect(u.entry.label).toBe("looks right");
    expect(u.fixIds).toEqual([]);
    expect(u.patches[0].body).toMatchObject({ source: "llm", no_fix: true });

    u = popUndo(u.rest);
    expect(u.patches).toEqual([{ id: "d1", body: {
      persona_id: "june", source: "llm", extraction_confidence: 0.95,
      metadata: { paragraph_idx: 0 }, no_fix: true } }]);
    expect(u.fixIds).toEqual(["fx1"]);
    expect(popUndo(u.rest).entry).toBeNull();
  });

  it("puts back a line that had no speaker as having none", () => {
    const u = popUndo(pushUndo([], setSpeaker(LINES, ["d4"], "marius"), "set"));
    expect(u.patches[0].body.persona_id).toBeNull();
    expect(wasBefore(pushUndo([], setSpeaker(LINES, ["d1"], "marius"), "set"), "d1")).toBe("june");
  });
});

describe("keys", () => {
  const k = (key, mods = {}) => keyAction({ key, ...mods });
  it("maps the approved keys", () => {
    expect(k("j")).toEqual({ type: "move", delta: 1 });
    expect(k("k")).toEqual({ type: "move", delta: -1 });
    expect(k("n")).toEqual({ type: "next", dir: 1 });
    expect(k("N", { shiftKey: true })).toEqual({ type: "next", dir: -1 });
    expect(k("3")).toEqual({ type: "speaker", n: 3 });
    expect(k("0")).toEqual({ type: "speaker", n: 0 });
    expect(k("Enter")).toEqual({ type: "confirm", whole: false });
    expect(k("Enter", { shiftKey: true })).toEqual({ type: "confirm", whole: true });
    expect(k(" ")).toEqual({ type: "tick" });
    expect(k("[")).toEqual({ type: "chapter", delta: -1 });
    expect(k("]")).toEqual({ type: "chapter", delta: 1 });
    expect(k("z", { ctrlKey: true })).toEqual({ type: "undo" });
    expect(k("q")).toBeNull();
  });

  it("keeps its hands off a text field or dropdown", () => {
    expect(keyAction({ key: "j" }, true)).toBeNull();
    expect(keyAction({ key: "z", ctrlKey: true }, true)).toBeNull();
    expect(keyAction({ key: "c", ctrlKey: true })).toBeNull();
  });
});

describe("the words on a row", () => {
  it("says the evidence, not a category", () => {
    const rows = [
      line("t", "june", { source: "tag", anchor_words: "said June", paragraph: 4 }),
      line("p", "june", { source: "propagated", anchor_words: "said June", paragraph: 4 }),
    ];
    expect(decidedBy(rows[0], rows)).toMatchObject({ text: "“said June”", sub: "the book says so", quoted: true });
    expect(decidedBy(rows[1], rows).sub).toBe("earlier in the same paragraph");
    expect(decidedBy(rows[0], [rows[1], rows[0]]).sub).toBe("the book says so");
    expect(decidedBy(rows[1], [rows[1], rows[0]]).sub).toBe("later in the same paragraph");
    expect(decidedBy(LINES[0]).text).toBe("Narration");
    expect(decidedBy(LINES[1]).text).toBe("AI, from the story around it");
    expect(decidedBy(LINES[4]).text).toBe("AI wasn't sure");
    expect(decidedBy(line("x", null, { source: "floored", floored_from: "unknown" })).text).toBe("AI gave no answer");
    expect(decidedBy(line("x", "june", { source: "corrected" })).text).toBe("You");
    expect(decidedBy(line("x", null, { source: "llm" })).text).toBe("AI named no one in the cast");
    expect(decidedBy(line("x", "june", { source: null })).text).toBe("From the import");
  });

  it("asks the Check question in terms of the conversation", () => {
    expect(checkQuestion(LINES[1], GROUPS, nameOf)).toBe("June speaks 3 times with no reply — is one of these the other person's?");
    expect(checkQuestion(LINES[4], GROUPS, nameOf)).toBe("No speaker, so it can't render. The AI thought Marius, but wasn't sure.");
    expect(checkQuestion(LINES[5], GROUPS, nameOf)).toBe("");
    expect(checkQuestion(line("x", null, { source: "llm" }), GROUPS, nameOf))
      .toBe("No speaker, so it can't render. The AI didn't name anyone in the cast.");
    const g = [
      { check: "only", speaker: "marius", lines: ["a"] },
      { check: "disagree", speaker: "june", other: "marius", lines: ["a"] },
      { check: "narrator", speaker: "nar", lines: ["a"] },
    ];
    expect(checkQuestion(line("a", "marius", { flags: [0] }), g, nameOf, "Chapter")).toBe("Marius's only line in this chapter — is it theirs?");
    expect(checkQuestion(line("a", "june", { flags: [1] }), g, nameOf)).toBe("The book says June, the AI says Marius — whose line is it?");
    expect(checkQuestion(line("a", "nar", { flags: [2] }), g, nameOf)).toBe("Spoken, but given to the Narrator — whose line is it?");
  });

  it("shows confidence in the app's colours, and none on a line that is yours", () => {
    expect(confidenceCell(line("a", "x", { confidence: 0.97 }))).toEqual({ text: "97%", intent: "success" });
    expect(confidenceCell(line("a", "x", { confidence: 0.88 }))).toEqual({ text: "88%", intent: "ghost" });
    expect(confidenceCell(line("a", "x", { confidence: 0.41 }))).toEqual({ text: "41%", intent: "accent2" });
    expect(confidenceCell(line("a", "x", { source: "corrected" }))).toEqual({ text: "—", intent: null });
    // No speaker: the floor's number explains the drop; any other is a pick that isn't there.
    expect(confidenceCell(line("a", null, { source: "floored", confidence: 0.41 })).text).toBe("41%");
    expect(confidenceCell(line("a", null, { source: "llm", confidence: 1 })).text).toBe("—");
  });
});
