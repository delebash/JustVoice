// SPDX-License-Identifier: MIT
// Ruling 12 (2026-08-15): prose kinds open on Script, game opens on Cast.
import { describe, expect, it } from "vitest";

import { firstStepFor, stepKeysFor, stepsFor } from "./studioSteps.js";

describe("Studio step order", () => {
  it("puts Script first for prose kinds — it is what creates the cast", () => {
    for (const kind of ["audiobook", "podcast", "custom"]) {
      expect(stepKeysFor(kind)).toEqual(["script", "cast", "render", "export"]);
      expect(firstStepFor(kind)).toBe("script");
    }
  });

  it("keeps Cast first for game projects, with no Script step at all", () => {
    expect(stepKeysFor("game_voicelines")).toEqual(["cast", "render", "export"]);
    expect(firstStepFor("game_voicelines")).toBe("cast");
  });

  it("treats an unknown or missing kind as prose", () => {
    expect(firstStepFor(undefined)).toBe("script");
    expect(firstStepFor("")).toBe("script");
  });

  it("numbers the steps from their order, so a reorder renumbers itself", () => {
    expect(stepsFor("audiobook").map((s) => s.label)).toEqual([
      "1 · Script", "2 · Cast", "3 · Render", "4 · Export",
    ]);
    expect(stepsFor("game_voicelines").map((s) => s.label)).toEqual([
      "1 · Cast", "2 · Render", "3 · Export",
    ]);
  });

  it("hands back a fresh array — a caller cannot mutate the canon", () => {
    stepKeysFor("audiobook").push("nonsense");
    expect(stepKeysFor("audiobook")).toEqual(["script", "cast", "render", "export"]);
  });
});
