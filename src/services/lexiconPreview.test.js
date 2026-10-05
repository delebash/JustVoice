// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { lexiconMatches } from "./lexiconPreview.js";

const ENTRIES = [
  { grapheme: "Beauchamp", phoneme_ipa: "ˈbiːtʃəm" },
  { grapheme: "Worcester", phoneme_ipa: "ˈwʊstər", alias: "WOOS-ter" },
  { grapheme: "Vance", alias: "VANSS" },
];
const LINE = "Beauchamp met Vance in Worcester.";

describe("lexiconMatches — IPA counts only where the model takes it (2026-10-05)", () => {
  it("counts every entry on a model that takes IPA", () => {
    const m = lexiconMatches(LINE, ENTRIES);
    expect(m.map((x) => [x.word, x.kind])).toEqual([
      ["Beauchamp", "pronunciation"],
      ["Worcester", "spelling + pronunciation"],
      ["Vance", "spelling"],
    ]);
  });

  it("drops IPA-only entries, and reads a both-entry as its respelling, where it doesn't", () => {
    const m = lexiconMatches(LINE, ENTRIES, { ipa: false });
    expect(m.map((x) => [x.word, x.kind, x.display])).toEqual([
      ["Worcester", "spelling", "WOOS-ter"],
      ["Vance", "spelling", "VANSS"],
    ]);
  });
});
