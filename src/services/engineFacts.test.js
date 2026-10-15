// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { memoryText } from "./engineFacts.js";

describe("memoryText", () => {
  // The narrowings review, M4: a measured size fits the card with the server's safety margin —
  // the rule Auto loads by.
  it("fits a measured size only with the safety margin", () => {
    // Decided 2026-10-15: one that fits only without the margin says so, with the live values.
    expect(memoryText({ measuredMb: 7500 }, 8192, 1024)).toMatchObject({
      text: "about 7.3 GB, measured here · more than this card holds with the 1 GB safety margin",
      warn: true,
      fits: false,
    });
    expect(memoryText({ measuredMb: 7500 }, 8192, 1536).text).toBe(
      "about 7.3 GB, measured here · more than this card holds with the 1.5 GB safety margin",
    );
    // More than the card itself, margin aside.
    expect(memoryText({ measuredMb: 9000 }, 8192, 1024)).toMatchObject({
      text: "about 8.8 GB, measured here · more than this card has",
      warn: true,
      fits: false,
    });
    expect(memoryText({ measuredMb: 6000 }, 8192, 1024)).toMatchObject({
      text: "about 5.9 GB, measured here · fits this card",
      warn: false,
      fits: true,
    });
  });

  it("holds an estimate to the card alone, as Auto does", () => {
    expect(memoryText({ needGb: 7.5 }, 8192, 1024)).toMatchObject({ text: "needs about 7.5 GB · fits this card", fits: true });
    expect(memoryText({ needGb: 10, runsOn: "cpu" }, 8192, 1024).fits).toBe(false);
  });

  it("knows no fit without a card or a number", () => {
    expect(memoryText({ measuredMb: 600 }, null, 1024)).toMatchObject({ text: "about 0.6 GB, measured here", fits: null });
    expect(memoryText({}, 8192, 1024)).toEqual({ text: "memory not measured yet", warn: false, gb: null, fits: null });
  });
});
