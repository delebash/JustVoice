// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";

import { blockStats, continueStep, projectState, proposedSpeakers, stepStatus } from "./studioStatus.js";

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
    expect(st).toEqual({ speakable: 3, unplaced: 1, analyzed: true, byPersona: { nar: 1, june: 1 } });
  });

  it("calls a chapter unanalyzed when no block carries speaker information", () => {
    expect(blockStats([{ text: "Plain prose." }]).analyzed).toBe(false);
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
      chapters: 2, scanned: 0, proposed: 0, analyzed: 1, lines: 14, unplaced: 2,
      castTotal: 2, castVoiced: 1, speakersBesideNarrator: 1, blocked: 4,
      rendered: 5, renderable: 11,
    });
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
    expect(stepStatus("script", base, UNIT)).toEqual({
      text: "3 of 14 chapters analyzed", tag: { intent: "danger", label: "88 lines need a speaker" },
    });
    expect(stepStatus("cast", base, UNIT)).toEqual({
      text: "3 of 5 personas voiced", tag: { intent: "danger", label: "40 lines blocked" },
    });
    expect(stepStatus("render", base, UNIT)).toEqual({
      text: "412 of 2,140 lines rendered", tag: { intent: "accent2", label: "1,728 to go" },
    });
  });

  it("shows no count where nothing records one", () => {
    expect(stepStatus("export", base, UNIT)).toEqual({ text: "M4B · WAVs · ACX check", tag: null });
    expect(stepStatus("discover", base, UNIT)).toEqual({
      text: "3 of 14 chapters scanned", tag: { intent: "accent2", label: "3 speakers to review" },
    });
  });
});

describe("continueStep", () => {
  const done = {
    chapters: 2, scanned: 2, proposed: 0, analyzed: 2, lines: 10, unplaced: 0, castTotal: 2, castVoiced: 2,
    speakersBesideNarrator: 1, blocked: 0, rendered: 10, renderable: 10,
  };

  it("goes to the first step with work left, in the steps' own order", () => {
    expect(continueStep("audiobook", { ...done, speakersBesideNarrator: 0, scanned: 1 })).toBe("discover");
    expect(continueStep("audiobook", { ...done, proposed: 2 })).toBe("discover");
    // Every chapter scanned and nobody found: nothing left for Discover.
    expect(continueStep("audiobook", { ...done, speakersBesideNarrator: 0 })).toBe("export");
    expect(continueStep("audiobook", { ...done, unplaced: 3 })).toBe("script");
    expect(continueStep("audiobook", { ...done, analyzed: 1 })).toBe("script");
    expect(continueStep("audiobook", { ...done, castVoiced: 1 })).toBe("cast");
    expect(continueStep("audiobook", { ...done, rendered: 4 })).toBe("render");
    expect(continueStep("audiobook", done)).toBe("export");
  });

  it("skips Discover and Script for game projects, and sends an empty one to its lines", () => {
    expect(continueStep("game_voicelines", { ...done, speakersBesideNarrator: 0, unplaced: 3 })).toBe("export");
    expect(continueStep("game_voicelines", { ...done, lines: 0 })).toBe("lines");
  });

  it("has nowhere to send a prose project with no text yet", () => {
    expect(continueStep("audiobook", { ...done, lines: 0 })).toBeNull();
  });
});

describe("proposedSpeakers", () => {
  const scan = (candidates) => ({ discover: { scanned_at: "t", candidates } });

  it("merges saved scans across chapters and drops names already cast", () => {
    const scenes = [
      { id: "a", metadata: scan([
        { name: "Tom Harlan", role_hint: "neighbor", approx_lines: 3, evidence: "Tom Harlan kept the ledger", evidence_found: true },
        { name: "Mara Vance", approx_lines: 9 },
      ]) },
      { id: "b", metadata: scan([{ name: "tom harlan", approx_lines: 2 }]) },
      { id: "c", metadata: {} },
    ];
    expect(proposedSpeakers(scenes, ["Mara Vance"])).toEqual([{
      key: "tom harlan", name: "Tom Harlan", names: ["Tom Harlan", "tom harlan"], role_hint: "neighbor",
      evidence: "Tom Harlan kept the ledger", evidence_found: true, lines: 5, chapters: ["a", "b"], library: null,
    }]);
    expect(projectState({ scenes, cast: [{ id: "m", name: "Mara Vance", voice_id: null }] }))
      .toMatchObject({ scanned: 2, proposed: 1 });
  });

  it("folds a name into its longer variant — Sedge and Old Sedge are one person", () => {
    const scenes = [
      { id: "a", metadata: scan([{ name: "Sedge", approx_lines: 4 }]) },
      { id: "b", metadata: scan([{ name: "Old Sedge", approx_lines: 0 }]) },
    ];
    const [row, ...rest] = proposedSpeakers(scenes, []);
    expect(rest).toEqual([]);
    expect(row).toMatchObject({ name: "Old Sedge", names: ["Sedge", "Old Sedge"], lines: 4, chapters: ["a", "b"] });
  });

  it("makes one row per library persona, and drops it once that persona is cast", () => {
    const lib = { persona_id: "p-brick", name: "Brick Halvorn" };
    const scenes = [
      { id: "a", metadata: scan([{ name: "Brick", approx_lines: 4, library_match: lib }]) },
      { id: "b", metadata: scan([{ name: "Brick Halvorn", approx_lines: 1, library_match: lib }]) },
    ];
    const rows = proposedSpeakers(scenes, []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "lib:p-brick", names: ["Brick", "Brick Halvorn"], library: lib, lines: 5 });
    expect(proposedSpeakers(scenes, [{ id: "p-brick", name: "Brick Halvorn" }])).toEqual([]);
  });

  it("never merges different people who only share a prefix", () => {
    const scenes = [{ id: "a", metadata: scan([{ name: "Ann" }, { name: "Annabel" }]) }];
    expect(proposedSpeakers(scenes, []).map((r) => r.name)).toEqual(["Ann", "Annabel"]);
  });
});
