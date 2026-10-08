// SPDX-License-Identifier: MIT
// Port of tests/test_import_refusals.py — a malformed upload is refused with a 400 that says
// what is wrong, never a 500. Each case was a 500 until 2026-10-08, when the port's comparison
// found them: a zip named .epub that isn't one, a damaged zip, a CSV with old-Mac line ends, a
// JustWrite file whose fields have the wrong type (docs/dev/TASKS.md, the step-5 FINDING).
import { ZipWriter } from "@delebash/llm-runner/platform/zip";
import { expect, test } from "vitest";
import { ApiError } from "../src/errors.js";
import { runAdapter } from "../src/imports/index.js";
import { bookJson, bookZip } from "./jw_fixtures.js";

const CONTAINER =
  '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>' +
  '<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';

function zip(members) {
  const zf = new ZipWriter();
  for (const [name, text] of Object.entries(members)) zf.writestr(name, text);
  return zf.toBuffer();
}

const central = (raw) => raw.indexOf(Buffer.from("PK\x01\x02", "latin1"));

/** The (first) member's CRC in the archive's directory changed: the reader finds the mismatch
 * after reading the member. */
function badCrc(raw) {
  const out = Buffer.from(raw);
  const at = central(raw) + 16;
  out.writeUInt32LE((raw.readUInt32LE(at) ^ 0xffffffff) >>> 0, at);
  return out;
}

/** The first member's deflate stream overwritten with 0xFF bytes — a block of the reserved
 * type, which zlib refuses. */
function badDeflate(raw) {
  const out = Buffer.from(raw);
  const size = raw.readUInt32LE(central(raw) + 20);
  const start = 30 + raw.readUInt16LE(26) + raw.readUInt16LE(28);
  out.fill(0xff, start, start + size);
  return out;
}

function refused(adapter, raw, filename) {
  let err = null;
  try {
    runAdapter(adapter, raw, { filename });
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(ApiError);
  expect(err.statusCode).toBe(400);
  return err.detail;
}

// ── book_prose: EPUB / DOCX ──

test("a_zip_named_epub_without_a_container_is_refused", () => {
  const raw = zip({ "notes.txt": "not a book" });
  expect(refused("book_prose", raw, "book.epub")).toBe("book_prose import: EPUB has no META-INF/container.xml");
});

test("an_epub_whose_package_file_is_missing_is_refused", () => {
  const raw = zip({ "META-INF/container.xml": CONTAINER });
  expect(refused("book_prose", raw, "book.epub")).toBe("book_prose import: EPUB has no OEBPS/content.opf");
});

const damaged = {
  "not-a-zip": Buffer.from("PK\x03\x04 this is not really a zip", "latin1"),
  "bad-crc": badCrc(zip({ "META-INF/container.xml": CONTAINER })),
  "bad-deflate": badDeflate(zip({ "META-INF/container.xml": CONTAINER })),
};
for (const [id, raw] of Object.entries(damaged)) {
  for (const filename of ["book.epub", "book.docx"]) {
    test(`a_damaged_zip_is_refused[${filename}-${id}]`, () => {
      expect(refused("book_prose", raw, filename)).toBe("book_prose import: zip file is damaged");
    });
  }
}

// ── csv_lines ──

test("old_mac_line_ends_are_rows", () => {
  const raw = Buffer.from("scene,character,text\rq1,Hale,Halt.\rq1,Mara,Go on.\r");
  const result = runAdapter("csv_lines", raw, { filename: "lines.csv" });
  expect(result.scenes[0].lines.map((l) => l.text)).toEqual(["Halt.", "Go on."]);
});

test("an_over_long_field_is_refused", () => {
  const raw = Buffer.from(`text\n${"x".repeat(131073)}\n`);
  expect(refused("csv_lines", raw, "lines.csv")).toBe(
    "csv_lines import: not a readable CSV file — a field is longer than 131,072 characters",
  );
});

// ── justwrite ──

function book(changes) {
  const doc = bookJson();
  for (const [path, value] of Object.entries(changes)) {
    const keys = path.split("__");
    const last = keys.pop();
    let target = doc;
    for (const k of keys) target = target[k];
    target[last] = value;
  }
  return Buffer.from(JSON.stringify(doc));
}

const wrongTypes = [
  [{ project: ["not", "an", "object"] }, "'project' must be an object"],
  [{ characters: 7 }, "'characters' must be a list"],
  [{ characters__0__aliases: 5 }, "'aliases' of character 'mara' must be a list"],
  [{ scenes: [{ id: "scn1" }] }, "'scenes' must be an object"],
  [{ parts: 3 }, "'parts' must be a list"],
  [{ parts__0__chapters: 7 }, "'chapters' of a part must be a list"],
  [{ scenes__ch1: 9 }, "'scenes' for chapter 'ch1' must be a list"],
  [{ scenes__ch1__0__body: 42 }, "'body' of scene 'scn1' must be text"],
];
for (const [changes, says] of wrongTypes) {
  test(`a_book_with_a_wrong_type_is_refused_by_name[${says}]`, () => {
    expect(refused("justwrite", book(changes), "book.json")).toBe(`justwrite import: book.json is malformed — ${says}`);
  });
}

test("a_damaged_book_zip_is_refused", () => {
  expect(refused("justwrite", badDeflate(bookZip()), "book.zip")).toBe("justwrite import: zip file is damaged");
});
