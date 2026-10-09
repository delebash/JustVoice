// SPDX-License-Identifier: MIT
// Overview's "Pronunciation lexicon" row (decided 2026-09-30,
// docs/plans/2026-09-30-project-lexicon.md a): None, this book's lexicons,
// then the reusable ones.
import { describe, expect, it } from "vitest";

import { lexiconChoices } from "./studioLexicon.js";

const LEXICONS = [
  { id: "g1", name: "Nautical", scope: "global" },
  { id: "b1", name: "Harbor names", scope: "project", project_id: "p1" },
  { id: "o1", name: "Another book's names", scope: "project", project_id: "p2" },
  { id: "s1", name: "Crow's slang", scope: "persona", persona_id: "x" },
  { id: "g0", name: "Old list" }, // no scope stored = reusable
];

describe("Overview's pronunciation lexicon choices", () => {
  it("offers None, this book's lexicons, then the reusable ones", () => {
    const { options, chosen } = lexiconChoices(LEXICONS, { id: "p1", default_lexicon_id: null });
    expect(options).toEqual([
      { id: "", label: "None" },
      { id: "b1", label: "Harbor names" },
      { id: "g1", label: "Nautical" },
      { id: "g0", label: "Old list" },
    ]);
    expect(chosen).toBe("");
  });

  it("shows the project's lexicon as chosen", () => {
    expect(lexiconChoices(LEXICONS, { id: "p1", default_lexicon_id: "b1" }).chosen).toBe("b1");
  });

  it("lists a chosen lexicon from outside the two groups, so a live choice never reads as None", () => {
    const { options, chosen } = lexiconChoices(LEXICONS, { id: "p1", default_lexicon_id: "o1" });
    expect(chosen).toBe("o1");
    expect(options.at(-1)).toEqual({ id: "o1", label: "Another book's names" });
  });

  it("never shows None for a lexicon the render still reads — one missing from the list says so", () => {
    // The library list can lag behind the project: an import makes the
    // book's lexicon on the server while the list was loaded earlier.
    const { options, chosen } = lexiconChoices(LEXICONS, { id: "p1", default_lexicon_id: "new" });
    expect(chosen).toBe("new");
    expect(options.at(-1)).toEqual({ id: "new", label: "(lexicon not found)" });
  });

  it("survives an empty library", () => {
    expect(lexiconChoices([], { id: "p1" })).toEqual({ options: [{ id: "", label: "None" }], chosen: "" });
  });
});
