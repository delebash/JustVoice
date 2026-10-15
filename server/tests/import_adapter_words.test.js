// SPDX-License-Identifier: MIT
// What New project's table says about each source (GET /v1/projects/import/adapters): "What
// lands" in plain words and "Says who speaks?" yes / no (2026-10-15, the build's question 9 — the
// table's columns and words toward the mock's `_s1`, no internal words, design law 6b). The yes /
// no is checked against what each parser really does with a line that names its speaker.
import { expect, test } from "vitest";
import { construct } from "../src/models.js";
import { listAdapters, runAdapter } from "../src/imports/index.js";
import { AdapterListResponse } from "../src/imports/standard_schema.js";

// One small file per source, each with a line that names its speaker the way a script would.
const SAMPLES = {
  justwrite: [
    "book.json",
    JSON.stringify({
      project: { title: "The Dock" },
      parts: [{ id: "p1", chapters: [{ id: "c1", title: "One" }] }],
      scenes: { c1: [{ id: "s1", body: "<p>SARAH: You're late.</p><p>“I know,” said Tom.</p>" }] },
      characters: [{ id: "sarah", name: "Sarah" }, { id: "tom", name: "Tom" }],
    }),
  ],
  book_prose: ["dock.txt", "Chapter 1\n\nSARAH: You're late.\n\n“I know,” said Tom.\n"],
  podcast_markdown: ["dock.md", "SARAH: You're late.\n\nTOM: I know.\n"],
  csv_lines: ["dock.csv", "scene,character,text\ndock,Sarah,You're late.\ndock,Tom,I know.\n"],
  srt: ["dock.srt", "1\n00:00:01,000 --> 00:00:02,000\nSARAH: You're late.\n\n2\n00:00:03,000 --> 00:00:04,000\nTOM: I know.\n"],
  audacity_labels: ["dock.txt", "0.000000\t1.000000\tSARAH: You're late.\n1.500000\t2.000000\tTOM: I know.\n"],
  justvoice_standard: [
    "dock.json",
    JSON.stringify({
      source: "justvoice_standard",
      project: { name: "The Dock" },
      characters: [{ id: "sarah", name: "Sarah" }],
      scenes: [{ id: "s1", title: "Dock", lines: [{ character_id: "sarah", text: "You're late." }] }],
    }),
  ],
};

test("every_source_has_a_sample", () => {
  expect(Object.keys(SAMPLES).sort()).toEqual(listAdapters().map((a) => a.id).sort());
});

test.each(listAdapters().map((a) => [a.id, a.says_who_speaks]))("says_who_speaks_is_what_%s_does", (id, says) => {
  const [filename, text] = SAMPLES[id];
  const out = runAdapter(id, Buffer.from(text, "utf8"), { filename });
  const named = out.scenes.flatMap((s) => s.lines).some((l) => !!l.character_id);
  expect(named).toBe(says);
});

test("what_lands_is_in_the_screens_words", () => {
  // The words the descriptions used to carry: field names, the schema's "characters", parser talk.
  for (const a of listAdapters()) {
    expect(a.description, a.id).not.toMatch(/pause_after_ms|roster|lift to|pass-through|payload|TSV|\bcue\b|\[tags\]/i);
    expect(a.description, a.id).not.toMatch(/\bcharacters?\b(?!" column)/i);
  }
});

test("the_list_carries_the_yes_or_no", () => {
  const wire = construct(AdapterListResponse, { adapters: listAdapters() });
  expect(wire.adapters.map((a) => [a.id, a.says_who_speaks])).toEqual([
    ["justwrite", false],
    ["book_prose", false],
    ["podcast_markdown", true],
    ["csv_lines", true],
    ["srt", true],
    ["audacity_labels", false],
    ["justvoice_standard", true],
  ]);
});
