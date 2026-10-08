// SPDX-License-Identifier: MIT
// CSV-lines import adapter (the port of justvoice/imports/adapters/csv_lines.py).
//
// Useful for game studios + podcasters who track dialogue in spreadsheets. Expected columns
// (header row required, case-insensitive):
//
//     scene,character,text,delivery,pause_after_ms
//
// Only `text` is mandatory. `scene` groups rows into a StandardScene (missing -> "default").
// `delivery` is parsed as JSON if present, else treated as a free-form instruct string.
//
// The sheet is read by `dictReader`, a port of CPython 3.12's csv.DictReader over the excel
// dialect (its C reader's state machine), so quoting, embedded line breaks and blank rows land
// as they did in Python.

import { decodeUtf8, isDict, pyIntOfStr, strip, ValueError } from "@delebash/llm-runner/platform/py";
import { jsonLoads } from "@delebash/llm-runner/platform/pyjson";
import { badRequest } from "../../errors.js";
import { construct } from "../../models.js";
import { StandardImport } from "../standard_schema.js";
import { beforeLastDot } from "./book_prose.js";

export const SOURCE_ID = "csv_lines";

// ── csv.reader (excel dialect) ───────────────────────────────────────────────

/** `_csv.Error`. */
export class CsvError extends Error {
  constructor(m) {
    super(m);
    this.name = "Error";
  }
}

const FIELD_LIMIT = 131072; // csv.field_size_limit()
const EOL = Symbol("EOL");

/** `csv.reader(io.StringIO(text, newline=""))` with the excel dialect → its rows, in order. The
 * input is read in lines split after "\r\n", "\r" or "\n" (StringIO's line ends with
 * newline=""), as the C reader receives them. */
export function* csvReader(text) {
  const lines = [];
  let at = 0;
  while (at < text.length) {
    let end = at;
    while (end < text.length && text[end] !== "\n" && text[end] !== "\r") end++;
    if (end < text.length) end += text[end] === "\r" && text[end + 1] === "\n" ? 2 : 1;
    lines.push(text.slice(at, end));
    at = end;
  }
  let state = "START_RECORD";
  let fields = [];
  let field = "";
  let fieldLen = 0;
  const save = () => {
    fields.push(field);
    field = "";
    fieldLen = 0;
  };
  const add = (c) => {
    if (fieldLen >= FIELD_LIMIT) throw new CsvError(`field larger than field limit (${FIELD_LIMIT})`);
    field += c;
    fieldLen += 1;
  };
  const step = (c) => {
    switch (state) {
      case "START_RECORD":
        if (c === EOL) return; // empty line - return []
        if (c === "\n" || c === "\r") {
          state = "EAT_CRNL";
          return;
        }
        state = "START_FIELD";
      // falls through: a normal character is handled as START_FIELD
      case "START_FIELD":
        if (c === "\n" || c === "\r" || c === EOL) {
          save();
          state = c === EOL ? "START_RECORD" : "EAT_CRNL";
        } else if (c === '"') state = "IN_QUOTED_FIELD";
        else if (c === ",") save();
        else {
          add(c);
          state = "IN_FIELD";
        }
        return;
      case "IN_FIELD":
        if (c === "\n" || c === "\r" || c === EOL) {
          save();
          state = c === EOL ? "START_RECORD" : "EAT_CRNL";
        } else if (c === ",") {
          save();
          state = "START_FIELD";
        } else add(c);
        return;
      case "IN_QUOTED_FIELD":
        if (c === EOL) return;
        if (c === '"') state = "QUOTE_IN_QUOTED_FIELD";
        else add(c);
        return;
      case "QUOTE_IN_QUOTED_FIELD":
        if (c === '"') {
          add(c);
          state = "IN_QUOTED_FIELD";
        } else if (c === ",") {
          save();
          state = "START_FIELD";
        } else if (c === "\n" || c === "\r" || c === EOL) {
          save();
          state = c === EOL ? "START_RECORD" : "EAT_CRNL";
        } else {
          add(c);
          state = "IN_FIELD";
        }
        return;
      case "EAT_CRNL":
        if (c === "\n" || c === "\r") return;
        if (c === EOL) {
          state = "START_RECORD";
          return;
        }
        throw new CsvError("new-line character seen in unquoted field - do you need to open the file with newline=''?");
    }
  };
  let li = 0;
  for (;;) {
    fields = [];
    do {
      if (li >= lines.length) {
        // End of input: a field in progress (or an open quote) is saved; otherwise done.
        if (fieldLen !== 0 || state === "IN_QUOTED_FIELD") {
          save();
          yield fields;
        }
        return;
      }
      for (const c of lines[li++]) step(c);
      step(EOL);
    } while (state !== "START_RECORD");
    yield fields;
  }
}

/** `csv.DictReader(io.StringIO(text))`: `fieldnames` (the first row, [] when none) and the rows
 * as Maps keyed by field name — blank rows skipped, a short row's missing keys null, a long
 * row's extras under the key null. */
export function dictReader(text) {
  const rows = csvReader(text);
  const first = rows.next();
  const fieldnames = first.done ? null : first.value;
  function* records() {
    if (fieldnames === null) return;
    for (const row of rows) {
      if (!row.length) continue;
      const d = new Map();
      fieldnames.forEach((name, i) => {
        if (i < row.length) d.set(name, row[i]);
      });
      if (fieldnames.length < row.length) d.set(null, row.slice(fieldnames.length));
      else for (const name of fieldnames.slice(row.length)) d.set(name, null);
      yield d;
    }
  }
  return { fieldnames, records: records() };
}

// ── the adapter ─────────────────────────────────────────────────────────────

function _slug(s) {
  return strip((s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-"), "-") || "x";
}

/** A file the csv reader can't read is the uploader's to fix (a 400, not a 500). With
 * newline="" the excel dialect raises only for an over-long field. */
function _csvRefusal(e) {
  let msg = e.message;
  if (msg.startsWith("field larger than field limit")) msg = `a field is longer than ${FIELD_LIMIT.toLocaleString("en-US")} characters`;
  return badRequest(`csv_lines import: not a readable CSV file — ${msg}`);
}

function* _rows(records) {
  try {
    yield* records;
  } catch (e) {
    if (e instanceof CsvError) throw _csvRefusal(e);
    throw e;
  }
}

export function parse(raw, { filename = null } = {}) {
  let text;
  try {
    text = decodeUtf8(Buffer.isBuffer(raw) ? raw : Buffer.from(raw), { sig: true });
  } catch (e) {
    if (e?.name === "UnicodeDecodeError") throw badRequest(`csv_lines import: not valid UTF-8 (${e.message})`);
    throw e;
  }

  // newline="" as the csv module asks: a lone CR (an old Mac file's line end) ends a row.
  // Without it the reader raised "new-line character seen in unquoted field" — a 500.
  let reader;
  try {
    reader = dictReader(text);
  } catch (e) {
    if (e instanceof CsvError) throw _csvRefusal(e);
    throw e;
  }
  if (!reader.fieldnames?.length) throw badRequest("csv_lines import: no header row");
  const headers = new Map(reader.fieldnames.map((h) => [strip(h).toLowerCase(), h]));
  if (!headers.has("text")) throw badRequest("csv_lines import: missing required 'text' column");

  const col = (row, key) => {
    if (!headers.has(key)) return null;
    const v = row.get(headers.get(key));
    return typeof v === "string" && strip(v) ? strip(v) : null;
  };

  const scenesById = new Map();
  const charsById = new Map();
  let rowNo = 1;
  for (const row of _rows(reader.records)) {
    rowNo += 1;
    const lineText = col(row, "text");
    if (!lineText) continue;

    const sceneLabel = col(row, "scene") || "default";
    const sceneId = _slug(sceneLabel);
    let scene = scenesById.get(sceneId);
    if (scene === undefined) {
      scene = { id: sceneId, title: sceneLabel, kind: "scene", lines: [] };
      scenesById.set(sceneId, scene);
    }

    const charName = col(row, "character");
    let charId = null;
    if (charName) {
      charId = _slug(charName);
      if (!charsById.has(charId)) charsById.set(charId, { id: charId, name: charName });
    }

    const deliveryRaw = col(row, "delivery");
    let deliveryObj = null;
    if (deliveryRaw) {
      try {
        const parsed = jsonLoads(deliveryRaw);
        deliveryObj = isDict(parsed) ? parsed : { instruct: deliveryRaw };
      } catch (e) {
        if (e?.name !== "JSONDecodeError") throw e;
        deliveryObj = { instruct: deliveryRaw };
      }
    }

    const pauseRaw = col(row, "pause_after_ms");
    let pauseMs = null;
    if (pauseRaw) {
      try {
        pauseMs = pyIntOfStr(pauseRaw);
      } catch (e) {
        if (!(e instanceof ValueError)) throw e;
      }
    }

    // Stable line id — the game build consumes audio BY THIS ID, and re-imports match rows on
    // it (CONCEPTS §1/§3). Falls back to the row number when the sheet has no id column.
    const lineId = col(row, "id") || col(row, "line_id") || col(row, "dialogue_id");
    scene.lines.push({
      character_id: charId,
      text: lineText,
      delivery: deliveryObj,
      pause_after_ms: pauseMs,
      source_ref: lineId || `row:${rowNo}`,
    });
  }

  if (!scenesById.size) throw badRequest("csv_lines import: no data rows with text");

  const projectName = beforeLastDot(filename || "CSV import") || "CSV import";
  return construct(StandardImport, {
    source: SOURCE_ID,
    project: { name: projectName, kind: "game_voicelines" },
    characters: [...charsById.values()],
    scenes: [...scenesById.values()],
  });
}
