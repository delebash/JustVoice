// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";

import {
  applyLocally, checkQuestion, confidenceCell, confirm, decidedBy, editText, filterCounts, lineFacets, keyAction,
  markOf, mergeState, move, nextToCheck, numberKeys, popUndo, pushUndo, setSpeaker, speakerOptions,
  swap, swapState, toCheck, visibleLines, wasBefore,
} from "./scriptReview.js";

const line = (id, speaker_id, extra = {}) => ({
  id, speaker_id, source: "llm", confidence: 0.95, spoken: true, speakable: true, marker: false,
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
  line("d5", "marius", { changed: true, prev_speaker_id: "june" }),
  line("m6", null, { marker: true, speakable: false, spoken: false }),
];
const GROUPS = [{ check: "run", speaker: "june", lines: ["d1", "d2", "d3"], turns: 3 }];
const NAMES = { june: "June", marius: "Marius", nar: "Narrator", tom: "Tom Harlan" };
const nameOf = (id) => NAMES[id] || id;

describe("filters", () => {
  it("To check is flagged lines plus lines with no speaker", () => {
    expect(LINES.filter(toCheck).map((l) => l.id)).toEqual(["d1", "d2", "d3", "d4"]);
  });

  it("narration waiting for the book's narrator is neither No speaker nor To check (2026-10-05)", () => {
    const waiting = line("n9", null, { source: "narration", spoken: false, waits_for_narrator: true });
    const lines = [...LINES, waiting];
    expect(toCheck(waiting)).toBe(false);
    const { check, none } = filterCounts(lines);
    expect({ check, none }).toEqual({ check: filterCounts(LINES).check, none: filterCounts(LINES).none });
    expect(nextToCheck(lines, "d4", 1)).toBe("d1");
  });

  it("a filter's number is the number of rows it shows — All counts the scene breaks it lists (2026-10-05)", () => {
    expect(filterCounts(LINES)).toEqual({ all: 7, check: 4, none: 1, changed: 1 });
    for (const f of ["all", "check", "none", "changed"]) {
      expect(visibleLines(LINES, { filter: f })).toHaveLength(filterCounts(LINES)[f]);
    }
  });

  it("counts the chips under the speaker, and each speaker under the chip (2026-10-05)", () => {
    const { chips, speakers } = lineFacets(LINES, { filter: "none", speaker: "marius" });
    for (const f of ["all", "check", "none", "changed"]) {
      expect(visibleLines(LINES, { filter: f, speaker: "marius" })).toHaveLength(chips[f]);
    }
    for (const [id, n] of Object.entries(speakers)) {
      expect(visibleLines(LINES, { filter: "none", speaker: id })).toHaveLength(n);
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
    expect(nextToCheck(LINES, "d4", -1)).toBe("d3");
    expect(nextToCheck(LINES, null, 1)).toBe("d1");
    expect(nextToCheck(LINES, null, -1)).toBe("d4");
  });

  it("wraps past either end (2026-09-29)", () => {
    expect(nextToCheck(LINES, "d4", 1)).toBe("d1");
    expect(nextToCheck(LINES, "d5", 1)).toBe("d1");
    expect(nextToCheck(LINES, "d1", -1)).toBe("d4");
  });

  it("a lone line to check is always reached — from above, below, or itself", () => {
    const one = [line("a", "june"), line("b", null), line("c", "june")];
    for (const from of ["a", "b", "c", null]) {
      expect(nextToCheck(one, from, 1)).toBe("b");
      expect(nextToCheck(one, from, -1)).toBe("b");
    }
  });

  it("finds nothing only when nothing needs checking", () => {
    expect(nextToCheck([line("a", "june"), line("b", "june")], "a", 1)).toBeNull();
    expect(nextToCheck([], null, 1)).toBeNull();
  });
});

describe("speakers", () => {
  const speakers = [
    { speaker_id: "nar", name: "Narrator", lines: 118 },
    { speaker_id: "june", name: "June", lines: 33 },
    { speaker_id: "marius", name: "Marius", lines: 38 },
    { speaker_id: "renn", name: "Renn", lines: 0 },
  ];

  it("1–9 are this chapter's speakers, most lines first; the Narrator is 0", () => {
    expect(numberKeys(speakers, "nar")).toEqual(["marius", "june"]);
  });

  it("the dropdown offers the Narrator first, then the book's speakers by lines", () => {
    expect(speakerOptions(speakers, "nar").map((o) => o.label))
      .toEqual(["Narrator", "Marius", "June", "Renn"]);
    expect(speakerOptions(speakers, "nar")[1]).toEqual({ value: "marius", label: "Marius" });
  });
});

describe("changes", () => {
  it("setting a speaker makes the line yours and skips lines that already have them", () => {
    const ch = setSpeaker(LINES, ["d1", "d5", "m6"], "marius");
    expect(ch.map((c) => c.id)).toEqual(["d1"]);
    expect(ch[0].after).toEqual({ speaker_id: "marius", source: "corrected" });
    expect(ch[0].before).toMatchObject({ speaker_id: "june", source: "llm", extraction_confidence: 0.95 });
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
    expect(swap(LINES, ["d1", "d5"]).map((c) => [c.id, c.after.speaker_id])).toEqual([["d1", "marius"], ["d5", "june"]]);
    expect(swap(LINES, ["d1", "d2"])).toEqual([]);
  });

  it("the page shows a change at once: the line is yours, unmarked and not 'changed'", () => {
    const after = applyLocally(LINES, setSpeaker(LINES, ["d5"], "june"));
    expect(after.find((l) => l.id === "d5")).toMatchObject({ speaker_id: "june", source: "corrected", flags: [], changed: false });
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
      speaker_id: "june", source: "llm", extraction_confidence: 0.95,
      metadata: { paragraph_idx: 0 }, no_fix: true } }]);
    expect(u.fixIds).toEqual(["fx1"]);
    expect(popUndo(u.rest).entry).toBeNull();
  });

  it("puts back a line that had no speaker as having none", () => {
    const u = popUndo(pushUndo([], setSpeaker(LINES, ["d4"], "marius"), "set"));
    expect(u.patches[0].body.speaker_id).toBeNull();
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
    expect(decidedBy(line("x", null, { source: "llm" })).text).toBe("AI named none of the speakers");
    expect(decidedBy(line("x", "june", { source: null })).text).toBe("From the import");
  });

  it("asks the Check question in terms of the conversation", () => {
    expect(checkQuestion(LINES[1], GROUPS, nameOf)).toBe("June speaks 3 times with no reply — is one of these the other person's?");
    expect(checkQuestion(LINES[4], GROUPS, nameOf)).toBe("No speaker, so it can't render. The AI thought Marius, but wasn't sure.");
    expect(checkQuestion(LINES[5], GROUPS, nameOf)).toBe("");
    expect(checkQuestion(line("x", null, { source: "llm" }), GROUPS, nameOf))
      .toBe("No speaker, so it can't render. The AI didn't name any of this book's speakers.");
    const g = [
      { check: "only", speaker: "marius", lines: ["a"] },
      { check: "disagree", speaker: "june", other: "marius", lines: ["a"] },
    ];
    expect(checkQuestion(line("a", "marius", { flags: [0] }), g, nameOf, "Chapter")).toBe("Marius's only line in this chapter — is it theirs?");
    expect(checkQuestion(line("a", "june", { flags: [1] }), g, nameOf)).toBe("The book says June, the AI says Marius — whose line is it?");
  });

  it("says where Analyze's second look found a speaker, and asks to check it (2026-10-05)", () => {
    const seen = line("a", "marius", { source: "second_look", flags: [0] });
    expect(decidedBy(seen, [seen])).toMatchObject({ text: "AI, from the chapters around it", sub: "" });
    const g = [{ check: "nearby", speaker: "marius", lines: ["a"] }];
    expect(checkQuestion(seen, g, nameOf, "Chapter")).toBe("Found in a nearby chapter — is it Marius?");
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

describe("a line's words (2026-09-30)", () => {
  const TEXTED = LINES.map((l) => ({ ...l, text: `words of ${l.id}`, takes: l.id === "d3" ? 2 : 0 }));

  it("Save sends the new words, and Undo puts the old ones back", () => {
    const changes = editText(TEXTED, "d2", "  new words  ");
    expect(changes.map((c) => c.after)).toEqual([{ text: "new words" }]);
    expect(applyLocally(TEXTED, changes).find((l) => l.id === "d2").text).toBe("new words");
    const u = popUndo(pushUndo([], changes, "words"));
    expect(u.patches[0].body).toEqual({ text: "words of d2", no_fix: true });
  });

  it("blank or unchanged words send nothing", () => {
    expect(editText(TEXTED, "d2", "   ")).toEqual([]);
    expect(editText(TEXTED, "d2", "words of d2")).toEqual([]);
    expect(editText(TEXTED, "gone", "x")).toEqual([]);
  });

  it("an Undo of a speaker change never sends the words", () => {
    const u = popUndo(pushUndo([], setSpeaker(TEXTED, ["d4"], "june"), "set"));
    expect(u.patches[0].body).not.toHaveProperty("text");
  });

  it("Merge takes two or more readable lines that sit next to each other", () => {
    expect(mergeState(TEXTED, ["d3", "d1", "d2"])).toEqual({ ok: true, ids: ["d1", "d2", "d3"], takes: 2 });
    expect(mergeState(TEXTED, ["d1", "d3"]).reason).toMatch(/next to each other/);
    expect(mergeState(TEXTED, ["d1"]).ok).toBe(false);
    expect(mergeState(TEXTED, ["d5", "m6"]).reason).toMatch(/spoken or narrated/);
  });

  it("the takes Merge deletes are every line's but the first", () => {
    expect(mergeState(TEXTED, ["d3", "d4"]).takes).toBe(0);
    expect(mergeState(TEXTED, ["d2", "d3"]).takes).toBe(2);
  });
});
