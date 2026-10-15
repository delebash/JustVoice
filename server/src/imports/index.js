// SPDX-License-Identifier: MIT
// Multi-adapter import pipeline (the port of justvoice/imports/__init__.py).
//
// Each adapter module under `imports/adapters/` exports `SOURCE_ID` and a
// `parse(raw, {filename, …options})` returning a StandardImport (an adapter that takes more
// options lists them on `parse.options`, as Python's registry read them off the signature).
// This file collects them into a registry and exposes:
//
//   - `getAdapter(sourceId)` — the parse function or null
//   - `listAdapters()` — AdapterInfo objects for the UI picker
//   - `runAdapter(sourceId, raw, {filename, …options})` — the convenience wrapper
//
// Adding a new adapter: create `imports/adapters/<name>.js` exporting `SOURCE_ID` + `parse`,
// append a registry entry below, document the input shape in `docs/import-and-export.md`.

import { badRequest } from "../errors.js";
import { construct } from "../models.js";
import * as audacityLabels from "./adapters/audacity_labels.js";
import * as bookProse from "./adapters/book_prose.js";
import * as csvLines from "./adapters/csv_lines.js";
import * as justvoiceStandard from "./adapters/justvoice_standard.js";
import * as justwrite from "./adapters/justwrite.js";
import * as podcastMarkdown from "./adapters/podcast_markdown.js";
import * as srt from "./adapters/srt.js";
import { AdapterInfo, StandardImport } from "./standard_schema.js";

export { AdapterInfo, StandardImport };

const info = (v) => construct(AdapterInfo, v);

// Each row: [info, parser]. Order is the order the UI picker shows. JustWrite first — it's the
// primary integration partner.
//
// `description` is what lands from the file, in the screen's words (New project's "What lands",
// the re-import picker under its select): written from what each parser and
// projects_api._materializeStandard really bring in, no internal names (design law 6b — until
// 2026-10-15 these said "character roster", "lift to characters", `pause_after_ms`).
// `says_who_speaks` is the table's yes / no.
const _ADAPTER_REGISTRY = [
  [
    info({
      id: justwrite.SOURCE_ID,
      label: "JustWrite book",
      description: "Chapters and paragraphs; the book's people become its speakers, with their descriptions.",
      // The zip is the real export; a bare book.json (someone unzipped it first) parses too.
      file_extensions: [".zip", ".json"],
      implemented: true,
      docs_anchor: "import-justwrite",
      says_who_speaks: false,
    }),
    justwrite.parse,
  ],
  [
    info({
      id: bookProse.SOURCE_ID,
      label: "Book / manuscript",
      description: "Chapters and paragraphs.",
      file_extensions: [".epub", ".docx", ".md", ".markdown", ".txt"],
      implemented: true,
      docs_anchor: "import-book_prose",
      says_who_speaks: false,
    }),
    bookProse.parse,
  ],
  [
    info({
      id: podcastMarkdown.SOURCE_ID,
      label: "Podcast script (markdown)",
      description: "A line per paragraph, in segments split at its headings; a label like SARAH: says who speaks.",
      file_extensions: [".md", ".markdown", ".txt", ".fountain"],
      implemented: true,
      docs_anchor: "import-podcast_markdown",
      says_who_speaks: true,
    }),
    podcastMarkdown.parse,
  ],
  [
    info({
      id: csvLines.SOURCE_ID,
      label: "CSV lines",
      description: `A line per row, grouped by a "scene" column; a "character" column says who speaks, an "id" column keeps each line's id.`,
      file_extensions: [".csv"],
      implemented: true,
      docs_anchor: "import-csv_lines",
      says_who_speaks: true,
    }),
    csvLines.parse,
  ],
  [
    info({
      id: srt.SOURCE_ID,
      label: "SubRip subtitles (.srt)",
      description: "A line per subtitle, the gap before the next kept as a pause; a NAME: at its start says who speaks.",
      file_extensions: [".srt"],
      implemented: true,
      docs_anchor: "import-srt",
      says_who_speaks: true,
    }),
    srt.parse,
  ],
  [
    info({
      id: audacityLabels.SOURCE_ID,
      label: "Audacity label track",
      description: "A line per label, the gap before the next kept as a pause.",
      file_extensions: [".txt"],
      implemented: true,
      docs_anchor: "import-audacity_labels",
      says_who_speaks: false,
    }),
    audacityLabels.parse,
  ],
  [
    info({
      id: justvoiceStandard.SOURCE_ID,
      label: "JustVoice standard JSON",
      description: "Chapters, lines, speakers and pronunciations, as the file sets them out.",
      file_extensions: [".json"],
      implemented: true,
      // "import-standard-json" since the import/export doc merge (2026-08-08): the old
      // "import-standard" id was duplicated in the page, so the help link landed on the schema.
      docs_anchor: "import-standard-json",
      says_who_speaks: true,
    }),
    justvoiceStandard.parse,
  ],
  // NOTHING UNIMPLEMENTED GOES IN THIS LIST: an entry in the format menu that could not import
  // anything was deleted 2026-08-08 (the ElevenLabs row). `AdapterInfo.implemented` stays: it is
  // part of the /v1/projects/import/adapters response shape.
];

const _BY_ID = new Map(_ADAPTER_REGISTRY.map(([i, parser]) => [i.id, parser]));

/** All registered adapters in display order. */
export function listAdapters() {
  return _ADAPTER_REGISTRY.map(([i]) => i);
}

export function getAdapter(sourceId) {
  return _BY_ID.get(sourceId) ?? null;
}

/**
 * Run an adapter over the file's bytes → a StandardImport. Adapter-specific options (e.g.
 * book_prose `split_on`) are dropped for an adapter that doesn't declare them, and so is a null
 * one, so callers can pass them uniformly.
 */
export function runAdapter(sourceId, raw, { filename = null, ...options } = {}) {
  const parser = getAdapter(sourceId);
  if (parser === null) {
    const known = [..._BY_ID.keys()].join(", ");
    throw badRequest(`unknown import source '${sourceId}'. Known: ${known}`);
  }
  const accepted = parser.options || [];
  const kept = Object.fromEntries(Object.entries(options).filter(([k, v]) => accepted.includes(k) && v !== null && v !== undefined));
  return parser(raw, { filename, ...kept });
}
