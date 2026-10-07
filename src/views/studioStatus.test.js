// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";

import { blockStats, foundSpeakers, projectState, stepStatus } from "./studioStatus.js";

const UNIT = { singular: "Chapter", plural: "Chapters" };

describe("blockStats", () => {
  it("counts spoken lines, unplaced lines and lines per speaker — markers and blanks are not lines", () => {
    const st = blockStats([
      { text: "Narration.", speaker_id: "nar", source: "narration" },
      { text: "“Hi,” said June.", speaker_id: "june", source: "tag" },
      { text: "“Who?”", speaker_id: null, source: "floored" },
      { text: "[music]", metadata: { marker: true } },
      { text: "   " },
    ]);
    expect(st).toEqual({ speakable: 3, unplaced: 1, analyzed: true, fromImport: false, bySpeaker: { nar: 1, june: 1 } });
  });

  it("calls a chapter analyzed only when Analyze ran on it — the one rule", () => {
    expect(blockStats([{ text: "Plain prose." }]).analyzed).toBe(false);
    // Analyze recorded when it ran …
    expect(blockStats([{ text: "Prose.", speaker_id: "nar", source: "corrected" }],
      { metadata: { analyzed_at: "2026-09-29T00:00:00Z" } }).analyzed).toBe(true);
    // … and older data counts by its pipeline sources.
    expect(blockStats([{ text: "Prose.", speaker_id: "nar", source: "narration" }]).analyzed).toBe(true);
  });

  it("an imported script with every speaker set is 'from the import', not analyzed", () => {
    const st = blockStats([
      { text: "Welcome back.", speaker_id: "host" },
      { text: "Thanks.", speaker_id: "guest", source: "manual" },
      { text: "[music]", metadata: { marker: true } },
    ]);
    expect(st).toMatchObject({ analyzed: false, fromImport: true });
    expect(blockStats([{ text: "Prose." }]).fromImport).toBe(false);
  });
});

describe("projectState", () => {
  const scenes = [{ id: "a" }, { id: "b" }];
  const stats = {
    a: { speakable: 10, unplaced: 2, analyzed: true, bySpeaker: { nar: 5, harbek: 3 } },
    b: { speakable: 4, unplaced: 0, analyzed: false, bySpeaker: { harbek: 1 } },
  };
  const cast = [{ id: "nar", ready: true, narrator: true }, { id: "harbek", ready: false }];

  it("rolls chapters and speakers up, and counts lines blocked on a speaker no voiced persona plays", () => {
    // Render's counts (GET /v1/projects/{id}/render_state totals): rendered is a
    // current take — a stale line isn't counted (2026-10-06, lineStates.js); lines
    // that can't render don't count toward what can.
    const render = { lines: 14, needs_speaker: 2, needs_voice: 1, ready: 6, rendered: 3, stale: 2 };
    expect(projectState({ scenes, stats, cast, render })).toEqual({
      chapters: 2, scanned: 0, proposed: 0, analyzed: 1, fromImport: 0, running: 0, flagged: 0,
      noSpeaker: 2, lines: 14, unplaced: 2, castTotal: 2, castReady: 1, speakersBesideNarrator: 1, blocked: 4,
      linesLoaded: true, cantRender: 3, rendered: 3, renderable: 11, ready: 6, stale: 2, noNarrator: false,
    });
  });

  it("says the lines are being checked until every chapter's lines are read (2026-10-07)", () => {
    const s = projectState({ scenes, stats: { a: stats.a }, cast });
    expect(s.linesLoaded).toBe(false);
    expect(stepStatus("lines", s, UNIT).text).toBe("Checking the lines…");
    expect(stepStatus("lines", projectState({ scenes: [], scenesLoaded: false, stats: {}, cast }), UNIT).text)
      .toBe("Checking the lines…");
    expect(stepStatus("lines", projectState({ scenes: [], stats: {}, cast }), UNIT).text)
      .toBe("No lines yet — re-import the sheet");
  });

  it("names the lines that can't render beside what is rendered (2026-10-07)", () => {
    const render = { lines: 12, needs_speaker: 0, needs_voice: 8, ready: 4, rendered: 0, stale: 0 };
    expect(stepStatus("render", projectState({ scenes, stats, cast, render }), UNIT).text)
      .toBe("0 of 4 lines rendered · 8 can't render");
  });

  it("takes the flagged lines from the server's Script rows, and counts no-speaker lines only where Analyze ran", () => {
    const script = [
      { scene_id: "a", analyzed: true, flagged: 4, no_speaker: 2 },
      { scene_id: "b", analyzed: false, flagged: 0, no_speaker: 4 },
    ];
    expect(projectState({ scenes, stats, cast, script, running: 1 }))
      .toMatchObject({ flagged: 4, noSpeaker: 2, running: 1 });
  });

  it("leaves the render counts null until Render's counts have been read", () => {
    const s = projectState({ scenes, stats, cast });
    expect(s.rendered).toBeNull();
    expect(stepStatus("render", s, UNIT).text).toBe("Checking what is rendered…");
  });
});

describe("stepStatus", () => {
  const base = {
    chapters: 14, scanned: 3, proposed: 3, analyzed: 3, lines: 2140, unplaced: 88, castTotal: 5, castReady: 3,
    speakersBesideNarrator: 4, blocked: 40, rendered: 412, renderable: 2140, ready: 1728,
  };

  it("says 'no narrator' while a book with narration has none, and opens Cast (2026-10-05)", () => {
    const script = [{ scene_id: "a", analyzed: true, lines: 10, spoken: 4, no_speaker: 0, flagged: 0 }];
    const lone = projectState({ cast: [{ id: "harbek", ready: true }], script });
    expect(lone.noNarrator).toBe(true);
    expect(stepStatus("script", { ...base, ...lone, chapters: 1, analyzed: 1 }, UNIT).tags[0]).toEqual({
      intent: "danger", label: "no narrator", go: ["cast"],
      title: "This book has narration and no narrator — Add Narrator on Cast gives it one",
    });
    const narrated = projectState({ cast: [{ id: "nar", ready: true, narrator: true }], script });
    expect(narrated.noNarrator).toBe(false);
    const noNarration = projectState({ cast: [], script: [{ ...script[0], lines: 4 }] });
    expect(noNarration.noNarrator).toBe(false);
  });

  it("names what is in the way, never a verdict", () => {
    const toCheck = { go: ["script", "check"], title: "Opens Script on the chapters to check" };
    const noSpeaker = { intent: "danger", label: "88 no speaker", ...toCheck };
    const flagged = { intent: "danger", label: "10 flagged", ...toCheck };
    expect(stepStatus("script", { ...base, flagged: 10, noSpeaker: 88, running: 1 }, UNIT)).toEqual({
      text: "3 of 14 chapters analyzed · 1 running", tag: noSpeaker, tags: [noSpeaker, flagged],
    });
    expect(stepStatus("cast", base, UNIT)).toEqual({
      text: "3 of 5 speakers cast", tag: { intent: "danger", label: "40 lines can't render" },
    });
    expect(stepStatus("render", base, UNIT)).toEqual({
      text: "412 of 2,140 lines rendered", tag: { intent: "accent2", label: "1,728 to go" },
    });
    // Everything has a take, some stale: stale isn't rendered, and the tag says why.
    expect(stepStatus("render", { ...base, rendered: 2131, ready: 0, stale: 9 }, UNIT)).toEqual({
      text: "2,131 of 2,140 lines rendered", tag: { intent: "accent2", label: "9 stale" },
    });
  });

  it("says a script whose speakers came with the import has speakers, not 'analyzed'", () => {
    const pod = { ...base, chapters: 12, analyzed: 0, fromImport: 12, unplaced: 0 };
    expect(stepStatus("script", pod, { singular: "Episode", plural: "Episodes" })).toEqual({
      text: "12 of 12 episodes have speakers · from the import", tag: null, tags: [],
    });
  });

  it("shows no count where nothing records one", () => {
    expect(stepStatus("export", base, UNIT)).toEqual({ text: "M4B · WAVs · ACX check", tag: null });
    expect(stepStatus("discover", base, UNIT)).toEqual({
      text: "3 of 14 chapters scanned", tag: { intent: "accent2", label: "3 speakers to review" },
    });
  });
});

describe("foundSpeakers", () => {
  const scan = (candidates, named_cast = []) => ({ discover: { scanned_at: "t", candidates, named_cast } });
  const pick = (rows) => rows.map((r) => [r.name, r.status]);

  it("merges saved scans across chapters, each person once with a status", () => {
    const scenes = [
      { id: "a", metadata: scan([
        { name: "Tom Harlan", role_hint: "neighbor", approx_lines: 3, evidence: "Tom Harlan kept the ledger", evidence_found: true },
        { name: "Mara", approx_lines: 9 },
      ], [{ speaker_id: "m", name: "Mara Vance", mentions: 4, evidence: "Mara Vance sat." }]) },
      { id: "b", metadata: scan([{ name: "tom harlan", approx_lines: 2 }]) },
      { id: "c", metadata: {} },
    ];
    const cast = [{ id: "m", name: "Mara Vance", aliases: ["Mara"] }];
    const rows = foundSpeakers(scenes, cast);
    expect(rows[0]).toEqual({
      key: "new:tom harlan", status: "new", name: "Tom Harlan", names: ["Tom Harlan", "tom harlan"],
      speaker: null, persona: null, role_hint: "neighbor", evidence: "Tom Harlan kept the ledger",
      evidence_found: true, lines: 5, mentions: 0, chapters: ["a", "b"],
    });
    // The AI's "Mara" (her alias) and the name match are ONE row: her.
    expect(rows[1]).toMatchObject({ key: "s:m", status: "cast", name: "Mara Vance", speaker: { id: "m" },
      lines: 9, mentions: 4, chapters: ["a"] });
    expect(rows).toHaveLength(2);
    expect(projectState({ scenes, cast: [{ ...cast[0], ready: false }] }))
      .toMatchObject({ scanned: 2, proposed: 1 });
  });

  it("Add and Ignore change a row's status, never remove it", () => {
    const scenes = [{ id: "a", metadata: scan([{ name: "Old Sedge" }, { name: "Gudgeon" }, { name: "Nettle" }]) }];
    expect(pick(foundSpeakers(scenes, []))).toEqual([["Old Sedge", "new"], ["Gudgeon", "new"], ["Nettle", "new"]]);
    const cast = [{ id: "s", name: "Old Sedge", aliases: [] }];
    expect(pick(foundSpeakers(scenes, cast, ["gudgeon"])))
      .toEqual([["Nettle", "new"], ["Old Sedge", "cast"], ["Gudgeon", "ignored"]]);
    expect(projectState({ scenes, cast, ignored: ["Gudgeon"] })).toMatchObject({ proposed: 1 });
  });

  it("folds a name into its longer variant — Sedge and Old Sedge are one person", () => {
    const scenes = [
      { id: "a", metadata: scan([{ name: "Sedge", approx_lines: 4 }]) },
      { id: "b", metadata: scan([{ name: "Old Sedge", approx_lines: 0 }]) },
    ];
    const [row, ...rest] = foundSpeakers(scenes, []);
    expect(rest).toEqual([]);
    expect(row).toMatchObject({ name: "Old Sedge", names: ["Sedge", "Old Sedge"], lines: 4, chapters: ["a", "b"] });
  });

  it("In your library = a persona of EXACTLY that name, one only (2026-09-29)", () => {
    const scenes = [{ id: "a", metadata: scan([
      { name: "Old Sedge", approx_lines: 4 }, { name: "Sedge's dog" }, { name: "Brick" }]) }];
    const personas = [{ id: "p1", name: "old sedge" }, { id: "p2", name: "Brick Halvorn" }];
    const rows = foundSpeakers(scenes, [], [], personas);
    expect(pick(rows)).toEqual([["Sedge's dog", "new"], ["Brick", "new"], ["Old Sedge", "library"]]);
    expect(rows[2].persona).toEqual({ id: "p1", name: "old sedge" });
    // Two personas share the name: neither is meant, so it is New.
    const twin = [...personas, { id: "p3", name: "Old Sedge" }];
    expect(pick(foundSpeakers(scenes, [], [], twin))).toContainEqual(["Old Sedge", "new"]);
    expect(projectState({ scenes, personas })).toMatchObject({ proposed: 3 });
  });

  it("a shorter spelling joins the library row — Sedge is Old Sedge", () => {
    const scenes = [
      { id: "a", metadata: scan([{ name: "Sedge", approx_lines: 2 }]) },
      { id: "b", metadata: scan([{ name: "Old Sedge", approx_lines: 1 }]) },
    ];
    const rows = foundSpeakers(scenes, [], [], [{ id: "p1", name: "Old Sedge" }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "library", names: ["Old Sedge", "Sedge"], lines: 3,
      chapters: ["b", "a"], persona: { id: "p1" } });
  });

  it("a speaker removed since the scan turns New, and stays in the list", () => {
    const scenes = [{ id: "a", metadata: scan([], [{ speaker_id: "n", name: "Nettle", mentions: 2 }]) }];
    expect(pick(foundSpeakers(scenes, [{ id: "n", name: "Nettle" }]))).toEqual([["Nettle", "cast"]]);
    expect(pick(foundSpeakers(scenes, []))).toEqual([["Nettle", "new"]]);
  });

  it("never merges different people who only share a prefix", () => {
    const scenes = [{ id: "a", metadata: scan([{ name: "Ann" }, { name: "Annabel" }]) }];
    expect(foundSpeakers(scenes, []).map((r) => r.name)).toEqual(["Ann", "Annabel"]);
  });
});
