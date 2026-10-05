// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { splitByName, voicesForBook } from "./newPersonas.js";

describe("New persona for the N with none (2026-10-05)", () => {
  it("casts a speaker with the library persona of exactly their name; the rest need one", () => {
    const { byName, rest } = splitByName(
      [{ id: "s1", name: "Narrator" }, { id: "s2", name: "Nettle" }, { id: "s3", name: "nettle" }],
      [{ id: "p1", name: "Narrator" }, { id: "p2", name: "June" }],
    );
    expect(byName.map((x) => [x.speaker.id, x.persona.id])).toEqual([["s1", "p1"]]);
    expect(rest.map((s) => s.id)).toEqual(["s2", "s3"]);
  });

  it("offers the voices that speak the book's language, region aside — all when it isn't set", () => {
    const voices = [
      { id: "a", language: "en-us" }, { id: "b", language: "ko" },
      { id: "c", language: "zh", speaks: ["zh", "en", "ko"] }, { id: "d", language: "en-gb" },
    ];
    expect(voicesForBook(voices, "en").map((v) => v.id)).toEqual(["a", "c", "d"]);
    expect(voicesForBook(voices, "ko").map((v) => v.id)).toEqual(["b", "c"]);
    expect(voicesForBook(voices, "").length).toBe(4);
  });
});
