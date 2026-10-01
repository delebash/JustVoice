// SPDX-License-Identifier: MIT
// Lexicons' "Used by" column (decided 2026-09-30, docs/plans/2026-09-30-
// project-lexicon.md §6 item 3): the book it's chosen for, or the personas
// that use it, or not in use.
import { describe, expect, it } from "vitest";

import { lexiconUsedBy } from "./lexiconUsage.js";

const PROJECTS = [
  { id: "p1", name: "Stillwater", project_type: "audiobook", default_lexicon_id: "lx1" },
  { id: "p2", name: "Emberfall", project_type: "game_voicelines", default_lexicon_id: "lx1" },
  { id: "p3", name: "Harbor Hour", project_type: "podcast", default_lexicon_id: null },
];
const PERSONAS = [
  { id: "a", name: "Gravel", lexicon_id: "lx2" },
  { id: "b", name: "June", lexicon_id: "lx1" },
  { id: "c", name: "Narrator", lexicon_id: null },
];

describe("a lexicon's Used by", () => {
  it("lists the books it's chosen for, then the personas that use it", () => {
    expect(lexiconUsedBy("lx1", PROJECTS, PERSONAS)).toEqual(["📖 Stillwater", "🎮 Emberfall", "🎭 June"]);
    expect(lexiconUsedBy("lx2", PROJECTS, PERSONAS)).toEqual(["🎭 Gravel"]);
  });

  it("is empty when nothing reads it — the page says so", () => {
    expect(lexiconUsedBy("lx9", PROJECTS, PERSONAS)).toEqual([]);
    expect(lexiconUsedBy("lx1", [], [])).toEqual([]);
    expect(lexiconUsedBy("lx1", undefined, undefined)).toEqual([]);
  });
});
