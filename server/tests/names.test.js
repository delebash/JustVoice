// SPDX-License-Identifier: MIT
// The one name matcher behind Discover's cast filter, library match and alias learning
// (2026-09-27) — the port of tests/test_names.py.
import { expect, test } from "vitest";
import { isVariant, match, norm, quoteInText, refersTo } from "../src/extraction/names.js";

const BRICK = { id: "b", name: "Brick Halvorn", aliases: [] };
const THRELL = { id: "t", name: "Haldane Threll", aliases: [] };
const ODE = { id: "o", name: "Odeline Marran", aliases: ["Ode"] };
const MARA = { id: "m", name: "Mara Vance", aliases: [] };
const EDITH = { id: "e", name: "Edith Vance", aliases: [] };

test("norm_is_case_accent_and_punctuation_blind", () => {
  expect(norm("  BRICK   Halvorn! ")).toBe("brick halvorn");
  expect(norm("O’Brien")).toBe(norm("o'brien"));
});

test("first_last_name_and_alias_refer_to_the_persona", () => {
  expect(refersTo("Brick", BRICK)).toBe(true);
  expect(refersTo("Threll", THRELL)).toBe(true);
  expect(refersTo("ode", ODE)).toBe(true); // a recorded alias
  expect(refersTo("Odeline Brick", BRICK)).toBe(false);
  expect(refersTo("Hal", BRICK)).toBe(false); // a prefix is not a name
});

test("short_words_and_prefixes_never_match_loosely", () => {
  expect(refersTo("Ode", { name: "Odeline Marran", aliases: [] })).toBe(false);
  // "Al" is Al Brandt's first name, but two letters is too short to trust.
  expect(refersTo("Al", { name: "Al Brandt", aliases: [] })).toBe(false);
  expect(refersTo("Al Brandt", { name: "Al Brandt", aliases: [] })).toBe(true);
  expect(refersTo("Al", { name: "Al Brandt", aliases: ["Al"] })).toBe(true); // unless recorded
});

test("match_refuses_ambiguity_and_prefers_exact", () => {
  expect(match("Brick", [BRICK, THRELL]).id).toBe("b");
  expect(match("Vance", [MARA, EDITH])).toBeNull(); // two people fit — no guess
  expect(match("Mara Vance", [MARA, EDITH]).id).toBe("m");
  expect(match("Nobody", [BRICK])).toBeNull();
});

test("variants_are_whole_word_containment", () => {
  expect(isVariant("Sedge", "Old Sedge")).toBe(true);
  expect(isVariant("Old Sedge", "sedge")).toBe(true);
  expect(isVariant("Ann", "Annabel")).toBe(false);
  expect(isVariant("Brick", "Nettle")).toBe(false);
});

test("quote_check_ignores_marks_and_spacing", () => {
  const text = "Brick went first, because that was what Brick was for. “Board says brass,” Brick said.";
  expect(quoteInText('"Board says brass," Brick said', text)).toBe(true);
  expect(quoteInText("brick  WENT first", text)).toBe(true);
  expect(quoteInText("Brick sang", text)).toBe(false);
  expect(quoteInText("", text)).toBe(false);
});
