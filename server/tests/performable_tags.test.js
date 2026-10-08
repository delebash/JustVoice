// SPDX-License-Identifier: MIT
// Every [tag] the rendering engine can't perform is dropped (the port of
// tests/test_performable_tags.py; decided 2026-09-29: "drop every [word] tag the chosen engine
// doesn't list, not only the ones the app recognises"). Found on the walkthrough: the podcast
// demo's "[warm]" survived `inline_tags.strip` and Kokoro said the word "warm" aloud.
import { expect, test, vi } from "vitest";
import "./engines_helpers.js";
import { strip } from "../src/inline_tags.js";
import * as renderCore from "../src/render_core.js";

test("strip_drops_every_tag_by_default", () => {
  expect(strip("Welcome back. [warm] Good to see you.")).toBe("Welcome back.  Good to see you.");
  expect(strip("He sighed. [sigh] Fine.")).toBe("He sighed.  Fine.");
  expect(strip("[whisper]quiet[/whisper] [pause:0.5s]done")).toBe("quiet done");
  // Bracketed text is a tag by this shape — decided with the rule.
  expect(strip("It was their [sic] house.")).toBe("It was their  house.");
});

test("a_tag_of_several_words_is_one_tag", () => {
  // Turbo's `[clear throat]` — kept where it is performed, gone where not.
  expect(strip("Well. [clear throat] Right.")).toBe("Well.  Right.");
  expect(strip("Well. [clear throat] Right.", new Set(["clear throat"]))).toBe("Well. [clear throat] Right.");
});

test("strip_keeps_only_the_listed_tags", () => {
  expect(strip("[laugh] ha [warm] there", new Set(["laugh"]))).toBe("[laugh] ha  there");
  expect(strip("[LAUGH] ha", new Set(["laugh"]))).toBe("[LAUGH] ha");
});

test("a_model_without_tags_loses_them_all", () => {
  expect(renderCore.performableText(null, "kokoro", "kokoro", "Hi. [laugh] [warm] Bye.")).toBe("Hi.   Bye.");
});

test("a_tag_model_keeps_exactly_what_it_lists", () => {
  // Turbo's own vocabulary survives; a word it doesn't list goes.
  const out = renderCore.performableText(null, "chatterbox", "chatterbox-turbo", "[sigh] So. [warm] [laugh]");
  expect(out).toBe("[sigh] So.  [laugh]");
});

test("a_tokenless_model_of_a_tag_engine_keeps_none", () => {
  // Chatterbox Multilingual: the same engine as Turbo, a model with no tags — so none survive,
  // whichever model happens to be loaded (the tags follow the VOICE's model since 2026-10-03).
  expect(renderCore.performableText(null, "chatterbox", "chatterbox-multilingual", "[laugh] Ha.")).toBe(" Ha.");
});

test("without_a_capability_row_a_tag_engine_keeps_the_parsers_set", () => {
  vi.spyOn(renderCore, "_engineTakesTags").mockReturnValue(true);
  expect(renderCore.performableText(null, "x", "x", "[laugh] [warm] ok")).toBe("[laugh]  ok");
});

test("without_a_capability_row_a_tagless_engine_keeps_none", () => {
  vi.spyOn(renderCore, "_engineTakesTags").mockReturnValue(false);
  expect(renderCore.performableText(null, "x", "x", "[laugh] ok")).toBe(" ok");
});
