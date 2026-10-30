// The import picker's content sniff. Each case here is a file a user actually
// drops, and the adapter it must land on — the two regressions that motivated
// the module (an Audacity label track importing as prose, a JustVoice payload
// handed to the JustWrite adapter) are the third and fifth cases.

import { describe, expect, it } from "vitest";

import { groupedFormatOptions, pickAdapter } from "./importPicker.js";

// The live registry shape, trimmed to what the picker reads.
const ADAPTERS = [
  { id: "justwrite", implemented: true, file_extensions: [".zip", ".json"] },
  { id: "book_prose", implemented: true, file_extensions: [".epub", ".docx", ".md", ".markdown", ".txt"] },
  { id: "podcast_markdown", implemented: true, file_extensions: [".md", ".markdown", ".txt", ".fountain"] },
  { id: "csv_lines", implemented: true, file_extensions: [".csv"] },
  { id: "srt", implemented: true, file_extensions: [".srt"] },
  { id: "audacity_labels", implemented: true, file_extensions: [".txt"] },
  { id: "justvoice_standard", implemented: true, file_extensions: [".json"] },
];

const pick = (ext, head = "") => pickAdapter({ ext, head, adapters: ADAPTERS })?.id ?? null;

describe("pickAdapter", () => {
  it("takes the only candidate when an extension is unambiguous", () => {
    expect(pick(".zip")).toBe("justwrite");
    expect(pick(".csv", "scene,character,text\n")).toBe("csv_lines");
    expect(pick(".epub")).toBe("book_prose");
  });

  it("returns null for an extension no adapter claims", () => {
    expect(pick(".wav")).toBe(null);
  });

  it("sends an Audacity label track to audacity_labels, not book_prose", () => {
    const head = "0.000000\t4.250000\tFirst label text\n4.500000\t6.000000\tSecond\n";
    expect(pick(".txt", head)).toBe("audacity_labels");
  });

  it("sends a point-label track (two columns) there too", () => {
    expect(pick(".txt", "1.234567\tA label at this point\n")).toBe("audacity_labels");
  });

  it("sends a JustVoice standard payload to justvoice_standard, not justwrite", () => {
    const head = '{"schema_version": "1.0", "source": "csv_lines", "project": {"name": "x"}}';
    expect(pick(".json", head)).toBe("justvoice_standard");
  });

  it("sends a JustWrite book.json to justwrite", () => {
    const head = '{"project": {"title": "The Ninth Facet"}, "parts": [], "scenes": {}}';
    expect(pick(".json", head)).toBe("justwrite");
  });

  it("still routes speaker-labeled scripts to podcast_markdown", () => {
    expect(pick(".md", "SARAH: Welcome back.\n")).toBe("podcast_markdown");
    expect(pick(".txt", "**JIN:** Your team just shipped.\n")).toBe("podcast_markdown");
  });

  it("routes plain prose to book_prose and never to the script adapter", () => {
    expect(pick(".md", "# Chapter One\n\nIt began at dawn.\n")).toBe("book_prose");
    expect(pick(".txt", "It began at dawn. The dock was empty.\n")).toBe("book_prose");
  });

  it("falls back without a readable head — a binary book zip still picks JustWrite", () => {
    expect(pick(".zip", "")).toBe("justwrite");
    expect(pick(".txt", "")).toBe("book_prose");
  });

  it("ignores adapters flagged unimplemented", () => {
    const withStub = [
      ...ADAPTERS,
      { id: "stub", implemented: false, file_extensions: [".xyz"] },
    ];
    expect(pickAdapter({ ext: ".xyz", head: "", adapters: withStub })).toBe(null);
  });
});

describe("the format picker's groups (the user's words, 2026-10-29)", () => {
  // the registry's seven, in its order, with the labels the server sends (server/src/imports/index.js)
  const LIVE = [
    { id: "justwrite", label: "JustWrite book" },
    { id: "book_prose", label: "Book / manuscript" },
    { id: "podcast_markdown", label: "Podcast script (markdown)" },
    { id: "csv_lines", label: "CSV lines" },
    { id: "srt", label: "SubRip subtitles (.srt)" },
    { id: "audacity_labels", label: "Audacity label track" },
    { id: "justvoice_standard", label: "JustVoice standard JSON" },
  ];

  it("puts the formats under Books, Scripts and line lists, and Timed lines, each with its own label", () => {
    expect(groupedFormatOptions(LIVE)).toEqual([
      { label: "Books", options: [{ label: "JustWrite book", value: "justwrite" }, { label: "Book / manuscript", value: "book_prose" }] },
      {
        label: "Scripts and line lists",
        options: [
          { label: "Podcast script (markdown)", value: "podcast_markdown" },
          { label: "CSV lines", value: "csv_lines" },
          { label: "JustVoice standard JSON", value: "justvoice_standard" },
        ],
      },
      { label: "Timed lines", options: [{ label: "SubRip subtitles (.srt)", value: "srt" }, { label: "Audacity label track", value: "audacity_labels" }] },
    ]);
  });

  it("still lists a format no group names yet, after the groups, and leaves out an empty group", () => {
    const some = [{ id: "csv_lines", label: "CSV lines" }, { id: "new_one", label: "Something new" }];
    expect(groupedFormatOptions(some)).toEqual([
      { label: "Scripts and line lists", options: [{ label: "CSV lines", value: "csv_lines" }] },
      { label: "Something new", value: "new_one" },
    ]);
  });
});
