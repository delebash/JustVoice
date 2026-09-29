// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";

import { blockStats, foundSpeakers, projectState, stepStatus } from "./studioStatus.js";

const UNIT = { singular: "Chapter", plural: "Chapters" };

describe("blockStats", () => {
  it("counts spoken lines, unplaced lines and lines per persona — markers and blanks are not lines", () => {
    const st = blockStats([
      { text: "Narration.", persona_id: "nar", source: "narration" },
      { text: "“Hi,” said June.", persona_id: "june", source: "tag" },
      { text: "“Who?”", persona_id: null, source: "floored" },
      { text: "[music]", metadata: { marker: true } },
      { text: "   " },
    ]);
    expect(st).toEqual({ speakable: 3, unplaced: 1, analyzed: true, fromImport: false, byPersona: { nar: 1, june: 1 } });
  });

  it("calls a chapter analyzed only when Analyze ran on it — the one rule", () => {
    expect(blockStats([{ text: "Plain prose." }]).analyzed).toBe(false);
    // Analyze recorded when it ran …
    expect(blockStats([{ text: "Prose.", persona_id: "nar", source: "corrected" }],
      { metadata: { analyzed_at: "2026-09-29T00:00:00Z" } }).analyzed).toBe(true);
    // … and older data counts by its pipeline sources.
    expect(blockStats([{ text: "Prose.", persona_id: "nar", source: "narration" }]).analyzed).toBe(true);
  });

  it("an imported script with every speaker set is 'from the import', not analyzed", () => {
    const st = blockStats([
      { text: "Welcome back.", persona_id: "host" },
      { text: "Thanks.", persona_id: "guest", source: "manual" },
      { text: "[music]", metadata: { marker: true } },
    ]);
    expect(st).toMatchObject({ analyzed: false, fromImport: true });
    expect(blockStats([{ text: "Prose." }]).fromImport).toBe(false);
  });
});

describe("projectState", () => {
  const scenes = [{ id: "a" }, { id: "b" }];
  const stats = {
    a: { speakable: 10, unplaced: 2, analyzed: true, byPersona: { nar: 5, harbek: 3 } },
    b: { speakable: 4, unplaced: 0, analyzed: false, byPersona: { harbek: 1 } },
  };
  const cast = [{ id: "nar", voice_id: "v1", narrator: true }, { id: "harbek", voice_id: null }];

  it("rolls chapters and cast up, and counts lines blocked on a missing voice", () => {
    expect(projectState({ scenes, stats, cast, cache: { total: 11, cached: 5 } })).toEqual({
      chapters: 2, scanned: 0, proposed: 0, analyzed: 1, fromImport: 0, running: 0, flagged: 0,
      noSpeaker: 2, lines: 14, unplaced: 2, castTotal: 2, castVoiced: 1, speakersBesideNarrator: 1, blocked: 4,
      rendered: 5, renderable: 11,
    });
  });

  it("takes the flagged lines from the server's Script rows, and counts no-speaker lines only where Analyze ran", () => {
    const script = [
      { scene_id: "a", analyzed: true, flagged: 4, no_speaker: 2 },
      { scene_id: "b", analyzed: false, flagged: 0, no_speaker: 4 },
    ];
    expect(projectState({ scenes, stats, cast, script, running: 1 }))
      .toMatchObject({ flagged: 4, noSpeaker: 2, running: 1 });
  });

  it("leaves the render counts null until the cache has been read", () => {
    const s = projectState({ scenes, stats, cast });
    expect(s.rendered).toBeNull();
    expect(stepStatus("render", s, UNIT).text).toBe("Checking what is rendered…");
  });
});

describe("stepStatus", () => {
  const base = {
    chapters: 14, scanned: 3, proposed: 3, analyzed: 3, lines: 2140, unplaced: 88, castTotal: 5, castVoiced: 3,
    speakersBesideNarrator: 4, blocked: 40, rendered: 412, renderable: 2140,
  };

  it("names what is in the way, never a verdict", () => {
    const toCheck = { go: ["script", "check"], title: "Opens Script on the chapters to check" };
    const noSpeaker = { intent: "danger", label: "88 no speaker", ...toCheck };
    const flagged = { intent: "danger", label: "10 flagged", ...toCheck };
    expect(stepStatus("script", { ...base, flagged: 10, noSpeaker: 88, running: 1 }, UNIT)).toEqual({
      text: "3 of 14 chapters analyzed · 1 running", tag: noSpeaker, tags: [noSpeaker, flagged],
    });
    expect(stepStatus("cast", base, UNIT)).toEqual({
      text: "3 of 5 personas voiced", tag: { intent: "danger", label: "40 lines blocked" },
    });
    expect(stepStatus("render", base, UNIT)).toEqual({
      text: "412 of 2,140 lines rendered", tag: { intent: "accent2", label: "1,728 to go" },
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
      ], [{ persona_id: "m", name: "Mara Vance", mentions: 4, evidence: "Mara Vance sat." }]) },
      { id: "b", metadata: scan([{ name: "tom harlan", approx_lines: 2 }]) },
      { id: "c", metadata: {} },
    ];
    const cast = [{ id: "m", name: "Mara Vance", aliases: ["Mara"] }];
    const rows = foundSpeakers(scenes, cast);
    expect(rows[0]).toEqual({
      key: "new:tom harlan", status: "new", name: "Tom Harlan", names: ["Tom Harlan", "tom harlan"], persona: null,
      role_hint: "neighbor", evidence: "Tom Harlan kept the ledger", evidence_found: true, lines: 5, mentions: 0,
      chapters: ["a", "b"],
    });
    // The AI's "Mara" (her alias) and the name match are ONE row: her.
    expect(rows[1]).toMatchObject({ key: "p:m", status: "cast", name: "Mara Vance", persona: { id: "m" },
      lines: 9, mentions: 4, chapters: ["a"] });
    expect(rows).toHaveLength(2);
    expect(projectState({ scenes, cast: [{ ...cast[0], voice_id: null }] }))
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

  it("makes one row per library persona, In your library until it is cast", () => {
    const lib = { persona_id: "p-brick", name: "Brick Halvorn" };
    const scenes = [
      { id: "a", metadata: scan([{ name: "Brick", approx_lines: 4, library_match: lib }]) },
      { id: "b", metadata: scan([{ name: "Brick Halvorn", approx_lines: 1, library_match: lib }]) },
    ];
    const rows = foundSpeakers(scenes, []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "p:p-brick", status: "library", name: "Brick Halvorn",
      names: ["Brick", "Brick Halvorn"], persona: { id: "p-brick" }, lines: 5 });
    const cast = foundSpeakers(scenes, [{ id: "p-brick", name: "Brick Halvorn" }]);
    expect(pick(cast)).toEqual([["Brick Halvorn", "cast"]]);
  });

  it("a cast member taken out of the cast since the scan shows In your library", () => {
    const scenes = [{ id: "a", metadata: scan([], [{ persona_id: "n", name: "Nettle", mentions: 2 }]) }];
    expect(pick(foundSpeakers(scenes, [{ id: "n", name: "Nettle" }]))).toEqual([["Nettle", "cast"]]);
    expect(pick(foundSpeakers(scenes, []))).toEqual([["Nettle", "library"]]);
  });

  it("never merges different people who only share a prefix", () => {
    const scenes = [{ id: "a", metadata: scan([{ name: "Ann" }, { name: "Annabel" }]) }];
    expect(foundSpeakers(scenes, []).map((r) => r.name)).toEqual(["Ann", "Annabel"]);
  });
});
