// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { CANT_RENDER_STATES, chapterRendered, countOf, lineStateWord, needSpeaker, partOf } from "./lineStates.js";

describe("lineStates — one set of words for a line's state (2026-10-06)", () => {
  it("says needs a persona when the speaker has none, needs a voice when its persona has no voice", () => {
    expect(lineStateWord("needs a voice", { hasPersona: false })).toBe("needs a persona");
    expect(lineStateWord("needs a voice", { hasPersona: true })).toBe("needs a voice");
    expect(lineStateWord("stale")).toBe("stale");
  });

  it("stops a render on a missing speaker or voice only", () => {
    expect([...CANT_RENDER_STATES]).toEqual(["needs a speaker", "needs a voice"]);
  });

  it("always names the unit", () => {
    expect(countOf(1, "line")).toBe("1 line");
    expect(partOf(412, 2140, "line", "rendered")).toBe("412 of 2,140 lines rendered");
    expect(partOf(9, 10, "speaker", "cast")).toBe("9 of 10 speakers cast");
    expect(partOf(3, 40, "line")).toBe("3 of 40 lines");
    expect(needSpeaker(1)).toBe("1 line needs a speaker");
    expect(needSpeaker(3)).toBe("3 lines need a speaker");
  });

  it("counts a chapter rendered only when every line has a current take", () => {
    expect(chapterRendered({ lines: 4, rendered: 4, stale: 0 })).toBe(true);
    expect(chapterRendered({ lines: 4, rendered: 3, stale: 1 })).toBe(false);
    expect(chapterRendered({ lines: 0, rendered: 0, stale: 0 })).toBe(false);
  });
});
