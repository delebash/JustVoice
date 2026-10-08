// SPDX-License-Identifier: MIT
// The long-text splitter's fixes of 2026-10-08 (the clean-room rewrite's ruling 15): dotted
// abbreviations are abbreviations, a number at a sentence end ends the sentence, a [bracket] tag
// is never split or cut (one with a space in it included), and a piece length of 0 or less is
// refused. And the guarantees every split keeps: no piece over the length, nothing but
// whitespace lost, code points counted.
import { ValueError } from "@delebash/llm-runner/platform/py";
import { expect, test } from "vitest";
import { splitTextIntoChunks as split } from "../src/audio/chunked.js";

const squash = (s) => s.replace(/\s+/g, "");

test("dotted_abbreviations_do_not_end_a_sentence", () => {
  for (const abbr of ["e.g.", "i.e.", "a.m.", "U.S."]) {
    const text = `We left at nine ${abbr} Then we walked a long way home.`;
    const pieces = split(text, `We left at nine ${abbr} Then`.length);
    // Cut at the abbreviation's period as a sentence end, the piece would end there AND the
    // next would start with "Then"; the abbreviation is not a sentence end, so no cut lands
    // right after it at the sentence-end rank — the last space in the window is used instead.
    expect(pieces[0], abbr).toBe(`We left at nine ${abbr}`);
    expect(pieces.join(" ")).toBe(text);
  }
  // A real sentence end after the abbreviation still wins over it.
  expect(split("Bring tools, e.g. a saw. Then go.", 26)).toEqual(["Bring tools, e.g. a saw.", "Then go."]);
  expect(split("Ask the U.S. office first. Then wait.", 30)).toEqual(["Ask the U.S. office first.", "Then wait."]);
});

test("a_number_at_a_sentence_end_ends_the_sentence", () => {
  expect(split("It was 2024. Then we all left town.", 20)).toEqual(["It was 2024.", "Then we all left", "town."]);
  // A decimal point is not one.
  expect(split("Pi is 3.14159 or so, they say.", 14)[0]).toBe("Pi is 3.14159");
});

test("a_bracket_tag_is_never_split_or_cut", () => {
  // The space inside a tag is not a place to cut…
  expect(split("Well then [clears throat] we begin again.", 18)).toEqual(["Well then", "[clears throat]", "we begin again."]);
  // …nor is a hard cut that would land inside one: it moves to before the tag.
  expect(split("Abcdefghijklmn[clears-throat]xyz", 20)).toEqual(["Abcdefghijklmn", "[clears-throat]xyz"]);
  // …and punctuation inside a tag is no boundary.
  expect(split("She waited [long pause. really long] then spoke softly.", 40)).toEqual([
    "She waited [long pause. really long]",
    "then spoke softly.",
  ]);
  // (Every length here holds the longest tag, 15 characters: only a tag longer than the piece
  // length itself has to be cut.)
  for (const n of [15, 16, 20, 25, 40]) {
    const text = "Once upon a time [laugh] there was a wolf [sigh] who [clears throat] spoke.";
    for (const p of split(text, n)) expect(/\[[^\]]*$|^[^[]*\]/.test(p), `${n}: ${p}`).toBe(false);
  }
});

test("a_piece_length_below_one_is_refused", () => {
  for (const bad of [0, -1, -800]) expect(() => split("Some words here.", bad)).toThrow(ValueError);
  expect(() => split("Some words here.", 0)).toThrow(/at least 1/);
});

test("every_split_keeps_its_guarantees", () => {
  const text =
    "Mr. Grey said: we leave at 6 p.m. sharp — no excuses. 雨が降った。傘を持った。 [sigh] Fine, fine… " +
    "The fee is 3.50, i.e. cheap! Really? Yes. 🙂🙂 Done";
  for (let n = 1; n <= 60; n++) {
    const pieces = split(text, n);
    for (const p of pieces) {
      expect([...p].length, `${n}: ${p}`).toBeLessThanOrEqual(n);
      expect(p).toBe(p.trim());
      expect(p.length).toBeGreaterThan(0);
    }
    expect(squash(pieces.join("")), `${n}`).toBe(squash(text));
  }
});
