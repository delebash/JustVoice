// SPDX-License-Identifier: MIT
// Home's memory cells read /v1/llm-runner/resident the way AI Settings' strip
// does (kit AiModelsArea memCells) — 2026-10-06: Home showed "VRAM NaN / 8 GB".
import { describe, expect, it } from "vitest";
import { residentCells } from "./vramFeed.js";

const R = { vramTotalMb: 8192, usedMb: 7578, committedMb: 6861, remainingMb: 1331, memArch: "discrete" };

describe("residentCells", () => {
  it("reads measured use, free, and the LLM's take with its model, as the strip does", () => {
    const cells = residentCells({ ...R, models: [{ id: "gemma-4-26b-a4b-qat", status: "loaded", vramMb: 6861 }] });
    expect(cells.map((c) => [c.label, c.value, c.sub])).toEqual([
      ["VRAM used", "7.4 of 8.0 GB", undefined],
      ["Free", "0.6 GB", undefined],
      ["LLM", "6.7 GB", "gemma-4-26b-a4b-qat"],
    ]);
  });

  it("says reserved when nothing measures, Memory on unified memory, and the claim when no LLM is loaded", () => {
    const cells = residentCells({ ...R, usedMb: null, memArch: "unified", models: [] }, { text: "~6.7 GB on demand" });
    expect(cells.map((c) => [c.label, c.value])).toEqual([
      ["Memory reserved", "6.7 of 8.0 GB"],
      ["Free", "1.3 GB"],
      ["LLM", "~6.7 GB on demand"],
    ]);
  });

  it("shows nothing without graphics memory", () => {
    expect(residentCells(null)).toEqual([]);
  });
});
