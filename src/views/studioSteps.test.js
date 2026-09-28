// SPDX-License-Identifier: MIT
// Redesign §8.5 + the 2026-09-27 rulings: every project opens on Overview;
// prose runs Discover → Script → Cast → Render → Export; game runs
// Lines → Cast → Render → Export.
import { describe, expect, it } from "vitest";

import { firstStepFor, isStepFor, stepKeysFor, stepsFor } from "./studioSteps.js";

describe("Studio step order", () => {
  it("runs Discover before Script for prose kinds — attribution can only pick personas that exist", () => {
    for (const kind of ["audiobook", "podcast", "custom"]) {
      expect(stepKeysFor(kind)).toEqual(["discover", "script", "cast", "render", "export"]);
    }
  });

  it("gives game projects the lines grid as step 1, with no Discover or Script", () => {
    expect(stepKeysFor("game_voicelines")).toEqual(["lines", "cast", "render", "export"]);
  });

  it("opens every project on Overview, whatever its kind", () => {
    for (const kind of ["audiobook", "podcast", "custom", "game_voicelines", undefined, ""]) {
      expect(firstStepFor(kind)).toBe("overview");
      expect(stepsFor(kind)[0]).toEqual({ key: "overview", label: "Overview" });
    }
  });

  it("treats an unknown or missing kind as prose", () => {
    expect(stepKeysFor(undefined)).toEqual(stepKeysFor("audiobook"));
    expect(stepKeysFor("")).toEqual(stepKeysFor("audiobook"));
  });

  it("numbers the steps from their order and leaves Overview unnumbered", () => {
    expect(stepsFor("audiobook").map((s) => s.label)).toEqual([
      "Overview", "1 · Discover", "2 · Script", "3 · Cast", "4 · Render", "5 · Export",
    ]);
    expect(stepsFor("game_voicelines").map((s) => s.label)).toEqual([
      "Overview", "1 · Lines", "2 · Cast", "3 · Render", "4 · Export",
    ]);
  });

  it("knows which stops belong to which kind", () => {
    expect(isStepFor("audiobook", "discover")).toBe(true);
    expect(isStepFor("audiobook", "lines")).toBe(false);
    expect(isStepFor("game_voicelines", "script")).toBe(false);
    expect(isStepFor("game_voicelines", "overview")).toBe(true);
  });

  it("hands back a fresh array — a caller cannot mutate the canon", () => {
    stepKeysFor("audiobook").push("nonsense");
    expect(stepKeysFor("audiobook")).toEqual(["discover", "script", "cast", "render", "export"]);
  });
});
