// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { facetCounts, facetOptions, facetTotal, narrowed } from "./facets.js";

const voices = [
  { id: "a", engine: "kokoro", dir: "sliders", lang: "fr", g: "F" },
  { id: "b", engine: "kokoro", dir: "sliders", lang: "en", g: "M" },
  { id: "c", engine: "qwen3", dir: "words", lang: "en", g: "M" },
  { id: "d", engine: "qwen3", dir: "words", lang: "zh", g: "F" },
];
const filters = (over = {}) => [
  { key: "engine", value: over.engine ?? "all", empty: "all", test: (v, x) => v.engine === x },
  { key: "dir", value: over.dir ?? "", test: (v, x) => v.dir === x },
  { key: "lang", value: over.lang ?? "", test: (v, x) => v.lang === x },
];

describe("filters that narrow each other (2026-10-05)", () => {
  it("lists a filter's options from what the other filters leave, with matching counts", () => {
    const f = filters({ dir: "words" });
    expect(facetOptions(voices, f, "engine", (v) => v.engine, (e, n) => `${e} (${n})`).map((o) => o.label))
      .toEqual(["qwen3 (2)"]);
    expect(facetOptions(voices, f, "lang", (v) => v.lang, (c, n) => `${c} (${n})`).map((o) => o.label))
      .toEqual(["en (1)", "zh (1)"]);
    expect(narrowed(voices, f).map((v) => v.id)).toEqual(["c", "d"]);
    expect(facetTotal(voices, f, "engine")).toBe(2);
  });

  it("keeps the chosen option, with 0, when nothing fits it any more", () => {
    const f = filters({ engine: "kokoro", dir: "words" });
    expect(facetOptions(voices, f, "engine", (v) => v.engine, (e, n) => `${e} (${n})`).map((o) => o.label))
      .toEqual(["kokoro (0)", "qwen3 (2)"]);
    expect(narrowed(voices, f)).toEqual([]);
  });

  it("counts test-shaped options (line chips) against the other filters only", () => {
    const f = [...filters({ lang: "en" }), { key: "chip", value: "all", empty: "all", test: (v, x) => v.dir === x }];
    expect(facetCounts(voices, f, "chip", ["words", "sliders"], (v, x) => v.dir === x)).toEqual({ words: 1, sliders: 1 });
  });
});

describe("fixed option sets", () => {
  it("counts each option from what the others leave, and drops an empty one unless chosen", async () => {
    const { facetChoices } = await import("./facets.js");
    const opts = [{ value: "", label: "Any" }, { value: "words", label: "Written" }, { value: "tags", label: "Tags" }];
    const f = filters({ engine: "kokoro" });
    expect(facetChoices(voices, f, "dir", opts, (v, x) => v.dir === x).map((o) => o.label)).toEqual(["Any (2)"]);
    const g = filters({ engine: "kokoro", dir: "words" });
    expect(facetChoices(voices, g, "dir", opts, (v, x) => v.dir === x).map((o) => o.label)).toEqual(["Any (2)", "Written (0)"]);
  });
});
