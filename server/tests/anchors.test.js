// SPDX-License-Identifier: MIT
// The "said X" rule (`extraction/anchors.js`): a tag is "Name said" or "said Name" at the edge
// of a narration, and propagation stops at narration that names someone else or tags a speech
// of its own (2026-10-10 — on Alice VII–VIII the old rule and propagation made 9 of 10 misses,
// RESEARCH §10.4).
import { expect, test } from "vitest";
import { findAnchors } from "../src/extraction/anchors.js";
import { segmentParagraphs, splitIntoParagraphs } from "../src/extraction/segmentation.js";

const CAST = [
  { id: "alice", name: "Alice" },
  { id: "hatter", name: "Hatter", aliases: ["the Hatter"] },
  { id: "hare", name: "March Hare", aliases: ["the March Hare"] },
  { id: "dormouse", name: "Dormouse", aliases: ["the Dormouse"] },
];

/** dialogue id → "source:speaker" for one text. */
const who = (text) =>
  Object.fromEntries([...findAnchors(segmentParagraphs(splitIntoParagraphs(text)), CAST)].map(([d, a]) => [d, `${a.source}:${a.speaker}`]));

test("the_speaker_is_the_name_before_the_verb_not_who_is_spoken_to", () => {
  expect(who("“Have some wine,” the March Hare said to Alice.")).toEqual({ 0: "tag:hare" });
});

test("a_pronoun_tag_is_left_to_the_model", () => {
  expect(who("“What day is it?” he said, turning to Alice.")).toEqual({});
});

test("a_name_and_verb_away_from_the_quote_tag_nothing", () => {
  expect(who("Alice thought this very curious, and she heard one of them say, “Look out now!”")).toEqual({});
});

test("a_tag_that_closes_a_narration_belongs_to_the_speech_after_it", () => {
  expect(who("“Sh! sh!” and the Dormouse sulkily remarked, “If you can’t be civil, finish it yourself.”")).toEqual({
    1: "tag:dormouse",
  });
});

test("a_tag_between_two_speeches_tags_both", () => {
  expect(who("“A,” said Alice. “B.”")).toEqual({ 0: "tag:alice", 1: "tag:alice" });
});

test("propagation_carries_a_speaker_through_their_own_tag", () => {
  expect(who("“Oh, hush!” the Hatter whispered in a frightened tone. “The Queen will hear you!”")).toEqual({
    0: "tag:hatter",
    1: "propagated:hatter",
  });
});

test("propagation_stops_at_narration_with_a_speech_verb_of_its_own", () => {
  // A group line: "they cried out" is not Alice's.
  expect(who("“No room!” they cried out when they saw Alice coming. “There’s plenty of room!” said Alice.")).toEqual({
    1: "tag:alice",
  });
});
