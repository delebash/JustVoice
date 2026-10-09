// SPDX-License-Identifier: MIT
// The segmenter: speech over several paragraphs, and a book's speech marks (the port of
// tests/test_segmentation.py).
//
// A long speech opens a quote on every paragraph and closes only the last. The curly branch
// always read that; the straight one needed the closing quote, so a straightened book lost a
// fifth of its speech to the Narrator (§8.24, 3a). Speech marks (2026-09-30, B3): a book
// written in ‘single quotes’, «guillemets» or „German“ marks read as all narration; each style
// is read now, and Auto picks a chapter's by counting; the three answer-keyed books must cut
// exactly as they did.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  detectMarks,
  leftOpen,
  opensSpeech,
  paragraphsOf,
  segmentParagraphs,
  segmentsFromLines,
  splitIntoParagraphs,
  stripMarks,
} from "../src/extraction/segmentation.js";
import { runAdapter } from "../src/imports/index.js";

const SAMPLES = path.resolve(import.meta.dirname, "..", "samples"); // the server package's bundled samples
const BOOK = path.join(SAMPLES, "the-speckled-band", "book.txt");

const _spoken = (text) =>
  segmentParagraphs(splitIntoParagraphs(text))
    .filter((s) => s.kind === "dialogue")
    .map((s) => s.text);

const _straighten = (text) => text.replaceAll("“", '"').replaceAll("”", '"');

test("a_straight_quote_left_open_is_speech_to_the_paragraphs_end", () => {
  const text = '"I have come to you, sir," said she. "My name is Helen Stoner, and I live';
  const segs = segmentParagraphs(splitIntoParagraphs(text));
  expect(segs.map((s) => [s.kind, s.text])).toEqual([
    ["dialogue", "I have come to you, sir,"],
    ["narration", "said she."],
    ["dialogue", "My name is Helen Stoner, and I live"],
  ]);
});

test("a_speech_over_several_paragraphs_is_speech_on_each", () => {
  const text = '"It began last spring.\n\n"Then the letters stopped.\n\n"That is all," she said.';
  expect(_spoken(text)).toEqual(["It began last spring.", "Then the letters stopped.", "That is all,"]);
});

test("the_straightened_book_finds_every_line_the_curly_one_does", () => {
  const curly = readFileSync(BOOK, "utf8");
  expect(_spoken(curly).length).toBe(247); // the answer key's count
  expect(_spoken(_straighten(curly))).toEqual(_spoken(curly));
});

// ── Speech marks ─────────────────────────────────────────────────────────

const _cut = (text, marks = null) => segmentParagraphs(splitIntoParagraphs(text), { marks }).map((s) => [s.kind, s.text]);

test("single_quotes_are_speech_and_an_apostrophe_never_ends_one", () => {
  expect(_cut("‘Come here,’ said Marius. ‘I don’t know why.’")).toEqual([
    ["dialogue", "Come here,"],
    ["narration", "said Marius."],
    ["dialogue", "I don’t know why."],
  ]);
  expect(_cut("'Wait,' she said. 'It's late.'", "single")).toEqual([
    ["dialogue", "Wait,"],
    ["narration", "she said."],
    ["dialogue", "It's late."],
  ]);
});

test("an_elision_never_opens_a_speech", () => {
  const text = "'Tis late, and he played rock 'n' roll in the '90s. 'Em too.";
  expect(_cut(text, "single")).toEqual([["narration", text]]);
});

test("a_trailing_apostrophe_cuts_the_line_early_the_known_limit", () => {
  // Split and Merge on Script fix this line by hand.
  expect(_cut("‘The boys’ bikes are gone,’ she said.", "single")[0]).toEqual(["dialogue", "The boys"]);
});

test("guillemets_both_ways_and_german_marks", () => {
  expect(_cut("«Bonjour», dit-il. «Ça va?»")).toEqual([
    ["dialogue", "Bonjour"],
    ["narration", ", dit-il."],
    ["dialogue", "Ça va?"],
  ]);
  expect(_cut("»Komm her«, sagte er.", "guillemets")).toEqual([
    ["dialogue", "Komm her"],
    ["narration", ", sagte er."],
  ]);
  expect(_cut("„Komm her“, sagte Marius. „Jetzt.”")).toEqual([
    ["dialogue", "Komm her"],
    ["narration", ", sagte Marius."],
    ["dialogue", "Jetzt."],
  ]);
});

test("a_german_closing_mark_is_not_read_as_an_english_opening_one", () => {
  // Read as double quotes, the closing “ opened a speech and inverted the line.
  expect(detectMarks("„Komm her“, sagte Marius. „Geh“, sagte sie.")).toBe("german");
});

test("another_styles_marks_are_quotes_inside_the_speech", () => {
  // The Speckled Band quotes Helen's sister inside Helen's own speech.
  const text = "“‘Tell me, Helen,’ said she, ‘have you ever heard anyone whistle?’”";
  expect(detectMarks([text, text, text].join("\n\n"))).toBe("double");
  expect(_cut(text, "double")).toEqual([["dialogue", text.slice(1, -1)]]);
});

describe("auto_reads_every_keyed_chapter_of_the_samples_as_double", () => {
  test.each(["the-ninth-facet", "the-salt-iron-road", "the-speckled-band"])("%s", (sample) => {
    const root = path.join(SAMPLES, sample);
    const key = JSON.parse(readFileSync(path.join(root, "attribution-truth.json"), "utf8"));
    const bookFile = key.book ?? "book.json";
    const book = runAdapter(key.adapter ?? "justwrite", readFileSync(path.join(root, bookFile)), { filename: bookFile });
    const keyed = book.scenes.filter((s) => Object.hasOwn(key.chapters, s.title));
    expect(keyed.length).toBeGreaterThan(0);
    for (const scene of keyed) {
      const text = scene.lines
        .filter((l) => l.text)
        .map((l) => l.text)
        .join("\n\n");
      expect(detectMarks(text), scene.title).toBe("double");
    }
  });
});

test("a_speech_left_open_in_each_style", () => {
  expect(leftOpen("‘Tell me about it", "single")).toBe(true);
  expect(leftOpen("«Il était une fois", "guillemets")).toBe(true);
  expect(leftOpen("„Es war einmal", "german")).toBe(true);
  expect(leftOpen("“a” b “c", "double")).toBe(true);
  expect(leftOpen("“a” b", "double")).toBe(false);
  expect(leftOpen("‘I don’t know,’ she said.", "single")).toBe(false);
});

test("a_stored_line_opens_speech_in_any_style_but_not_on_an_elision", () => {
  for (const t of ["“Hi.”", '"Hi."', "‘Hi.’", "'Hi.'", "«Salut»", "»Hallo«", "„Hallo“"]) expect(opensSpeech(t), t).toBe(true);
  for (const t of ["said Marius,", "'Tis nothing.", ""]) expect(opensSpeech(t), t).toBe(false);
});

// ── An edited chapter, read as its lines ───────────────────────────────────

test("strip_marks_takes_off_the_pair_and_a_mark_left_open", () => {
  expect(stripMarks("“Come here,”")).toBe("Come here,");
  expect(stripMarks("'Wait,’")).toBe("Wait,");
  expect(stripMarks("„Jetzt.“")).toBe("Jetzt.");
  expect(stripMarks("“and the rest")).toBe("and the rest");
  expect(stripMarks("said Marius,")).toBe("said Marius,");
});

test("lines_of_one_paragraph_read_together_again", () => {
  const lines = [
    { text: "“Come here,”", spoken: true, paragraph: 4 },
    { text: "said Marius,", spoken: false, paragraph: 4 },
    { text: "“now.”", spoken: true, paragraph: 4 },
    { text: "A line you added.", spoken: false, paragraph: null },
    { text: "“Yes.”", spoken: true, paragraph: 9 },
  ];
  const segs = segmentsFromLines(lines);
  expect(segs.map((s) => [s.kind, s.text, s.paragraph_idx, s.dialogue_id ?? null])).toEqual([
    ["dialogue", "Come here,", 0, 0],
    ["narration", "said Marius,", 0, null],
    ["dialogue", "now.", 0, 1],
    ["narration", "A line you added.", 1, null],
    ["dialogue", "Yes.", 2, 2],
  ]);
  expect(paragraphsOf(segs)).toEqual(["Come here, said Marius, now.", "A line you added.", "Yes."]);
});
