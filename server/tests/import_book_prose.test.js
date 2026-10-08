// SPDX-License-Identifier: MIT
// book_prose adapter — EPUB / DOCX / Markdown / TXT, synthetic fixtures (the port of
// tests/test_import_book_prose.py). The last test posts a multipart dry run through the real
// router — a bare app holding only projects_api's router (render_helpers.js `viaRoutes`) over the
// test's own database and app state (`useState()`; Python overrode `get_db` with conftest_db's
// session).
import { ZipWriter } from "@delebash/llm-runner/platform/zip";
import { expect, test } from "vitest";
import { client } from "./app_helpers.js";
import { endState, useState } from "./engines_helpers.js";
import { router as projectsRouter } from "../src/api/projects_api.js";
import { ApiError } from "../src/errors.js";
import { parse } from "../src/imports/adapters/book_prose.js";
import { getAdapter, runAdapter } from "../src/imports/index.js";
import { viaRoutes } from "./render_helpers.js";

// ── fixture builders ─────────────────────────────────────────────────

const _CONTAINER = `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

function _opf(spineItems) {
  const manifest = spineItems.map((h, i) => `<item id="d${i}" href="${h}" media-type="application/xhtml+xml"/>`).join("\n");
  const spine = spineItems.map((_, i) => `<itemref idref="d${i}"/>`).join("\n");
  return `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>The Ninth Facet</dc:title>
    <dc:creator>Tamsin Vale</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>${manifest}</manifest>
  <spine>${spine}</spine>
</package>`;
}

function _xhtml(title, paragraphs) {
  const h = title ? `<h1>${title}</h1>` : "";
  const body = paragraphs.map((p) => `<p>${p}</p>`).join("");
  return `<html><head><title>x</title></head><body>${h}${body}</body></html>`;
}

function _makeEpub(docs) {
  const zf = new ZipWriter();
  zf.writestr("mimetype", "application/epub+zip");
  zf.writestr("META-INF/container.xml", _CONTAINER);
  zf.writestr("OEBPS/content.opf", _opf(Object.keys(docs)));
  for (const [href, content] of Object.entries(docs)) zf.writestr(`OEBPS/${href}`, content);
  return zf.toBuffer();
}

const _W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function _docxPara(text, style = null) {
  const ppr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${ppr}<w:r><w:t>${text}</w:t></w:r></w:p>`;
}

function _makeDocx(paras, title = null) {
  const body = paras.map(([t, s]) => _docxPara(t, s)).join("");
  const document = `<?xml version="1.0"?><w:document xmlns:w="${_W}"><w:body>${body}</w:body></w:document>`;
  const zf = new ZipWriter();
  zf.writestr("word/document.xml", document);
  if (title) {
    zf.writestr(
      "docProps/core.xml",
      '<?xml version="1.0"?><cp:coreProperties ' +
        'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
        'xmlns:dc="http://purl.org/dc/elements/1.1/">' +
        `<dc:title>${title}</dc:title></cp:coreProperties>`,
    );
  }
  return zf.toBuffer();
}

const enc = (s) => Buffer.from(s, "utf8");

// ── EPUB ─────────────────────────────────────────────────────────────

test("epub_chapters_split_on_spine_with_titles", () => {
  const raw = _makeEpub({
    "title.xhtml": _xhtml(null, ["The Ninth Facet. By Tamsin Vale."]),
    "ch1.xhtml": _xhtml("The Lake House", ["The lake held the fog all morning.", "Mara watched it burn off."]),
    "ch2.xhtml": _xhtml("What the Water Keeps", ["Edith poured the tea without apology."]),
  });
  const out = parse(raw, { filename: "the-ninth-facet.epub" });
  expect(out.source).toBe("book_prose");
  expect(out.project.name).toBe("The Ninth Facet");
  expect(out.project.kind).toBe("audiobook");
  expect(out.project.language).toBe("en");
  expect(out.project.description).toBe("by Tamsin Vale");
  expect(out.scenes.map((s) => s.title)).toEqual(["The Lake House", "What the Water Keeps"]);
  expect(out.scenes.map((s) => s.lines.length)).toEqual([2, 1]);
  expect(out.scenes[0].lines[0].text).toBe("The lake held the fog all morning.");
  expect(out.scenes[0].lines[0].character_id).toBeNull(); // prose: no speakers yet
  expect(out.characters).toEqual([]);
  expect(out.warnings.some((w) => w.includes("front matter"))).toBe(true); // title page skipped
});

test("epub_detected_by_content_despite_wrong_extension", () => {
  const raw = _makeEpub({ "ch1.xhtml": _xhtml("One", ["Some honest paragraph text here."]) });
  expect(parse(raw, { filename: "mystery.bin" }).scenes[0].title).toBe("One");
});

test("epub_unique_scene_ids_for_duplicate_titles", () => {
  const raw = _makeEpub({
    "a.xhtml": _xhtml("Interlude", ["First interlude paragraph content."]),
    "b.xhtml": _xhtml("Interlude", ["Second interlude paragraph content."]),
  });
  const ids = parse(raw, { filename: "book.epub" }).scenes.map((s) => s.id);
  expect(ids.length).toBe(2);
  expect(new Set(ids).size).toBe(2);
});

// ── DOCX ─────────────────────────────────────────────────────────────

test("docx_headings_start_chapters", () => {
  const raw = _makeDocx(
    [
      ["The Lake House", "Heading1"],
      ["The lake held the fog all morning.", null],
      ["Mara watched it burn off.", null],
      ["Old Debts", "Heading1"],
      ["Edith poured the tea.", null],
    ],
    "The Ninth Facet",
  );
  const out = parse(raw, { filename: "the-ninth-facet.docx" });
  expect(out.project.name).toBe("The Ninth Facet");
  expect(out.scenes.map((s) => s.title)).toEqual(["The Lake House", "Old Debts"]);
  expect(out.scenes.map((s) => s.lines.length)).toEqual([2, 1]);
});

test("docx_without_headings_is_one_chapter", () => {
  const out = parse(
    _makeDocx([
      ["Only paragraph one.", null],
      ["Only paragraph two.", null],
    ]),
    { filename: "draft.docx" },
  );
  expect(out.scenes.length).toBe(1);
  expect(out.scenes[0].lines.length).toBe(2);
  expect(out.project.name).toBe("draft"); // falls back to file stem
});

// ── Markdown / TXT ───────────────────────────────────────────────────

test("markdown_headings_split", () => {
  const out = parse(enc("# One\n\nPara a.\n\nPara b.\n\n## Two\n\nPara c.\n"), { filename: "book.md" });
  expect(out.scenes.map((s) => s.title)).toEqual(["One", "Two"]);
  expect(out.scenes.map((s) => s.lines.length)).toEqual([2, 1]);
});

test("txt_chapter_heuristic", () => {
  const out = parse(enc("Chapter 1\n\nFirst paragraph.\n\nChapter 2\n\nSecond paragraph.\n"), { filename: "book.txt" });
  expect(out.scenes.map((s) => s.title)).toEqual(["Chapter 1", "Chapter 2"]);
});

test("txt_without_chapters_is_single_scene", () => {
  const out = parse(enc("Just one blob of text.\n\nAnd another paragraph."), { filename: "note.txt" });
  expect(out.scenes.length).toBe(1);
  expect(out.scenes[0].lines.length).toBe(2);
});

// ── split_on (import-review "Split chapters on" selector) ───────────

test("markdown_split_h1_keeps_h2_in_text", () => {
  const out = parse(enc("# One\n\nPara a.\n\n## Two\n\nPara c.\n"), { filename: "book.md", split_on: "h1" });
  expect(out.scenes.map((s) => s.title)).toEqual(["One"]);
  // the h2 line stays in the chapter as plain text, marks stripped
  expect(out.scenes[0].lines.some((line) => line.text === "Two")).toBe(true);
});

test("markdown_split_none_is_one_chapter", () => {
  const out = parse(enc("# One\n\nPara a.\n\n# Two\n\nPara b.\n"), { filename: "book.md", split_on: "none" });
  expect(out.scenes.length).toBe(1);
});

test("epub_split_h1_rechapters_single_spine_doc", () => {
  // Whole book in ONE spine doc — auto yields 1 chapter, h1 re-splits.
  const doc =
    "<html><body>" + "<h1>The Lake House</h1><p>The lake held the fog all morning.</p>" + "<h1>Old Debts</h1><p>Edith poured the tea.</p>" + "</body></html>";
  const raw = _makeEpub({ "book.xhtml": doc });
  expect(parse(raw, { filename: "one-doc.epub" }).scenes.length).toBe(1);
  const out = parse(raw, { filename: "one-doc.epub", split_on: "h1" });
  expect(out.scenes.map((s) => s.title)).toEqual(["The Lake House", "Old Debts"]);
});

test("epub_split_none_merges_spine_docs", () => {
  const raw = _makeEpub({
    "ch1.xhtml": _xhtml("One", ["First chapter paragraph text."]),
    "ch2.xhtml": _xhtml("Two", ["Second chapter paragraph text."]),
  });
  const out = parse(raw, { filename: "book.epub", split_on: "none" });
  expect(out.scenes.length).toBe(1);
  const texts = out.scenes[0].lines.map((line) => line.text);
  expect(texts).toContain("First chapter paragraph text.");
  expect(texts).toContain("Second chapter paragraph text.");
});

test("docx_split_h1_ignores_heading2", () => {
  const raw = _makeDocx([
    ["Part One", "Heading1"],
    ["Intro paragraph.", null],
    ["Scene break", "Heading2"],
    ["More paragraph.", null],
  ]);
  expect(parse(raw, { filename: "d.docx" }).scenes.length).toBe(2); // auto splits on H1 + H2
  const out = parse(raw, { filename: "d.docx", split_on: "h1" });
  expect(out.scenes.map((s) => s.title)).toEqual(["Part One"]);
  expect(out.scenes[0].lines.some((line) => line.text === "Scene break")).toBe(true);
});

test("txt_split_none_keeps_chapter_lines_in_text", () => {
  const out = parse(enc("Chapter 1\n\nFirst paragraph.\n\nChapter 2\n\nSecond paragraph.\n"), { filename: "book.txt", split_on: "none" });
  expect(out.scenes.length).toBe(1);
});

test("unknown_split_mode_rejected", () => {
  expect(() => parse(enc("# T\n\nHello."), { filename: "t.md", split_on: "pages" })).toThrow(ApiError);
});

test("registry_drops_split_on_for_adapters_without_it", () => {
  // csv_lines.parse has no split_on — runAdapter must filter it out.
  const out = runAdapter("csv_lines", enc("scene,character,text\nintro,NARRATOR,Hello there.\n"), { filename: "lines.csv", split_on: "h1" });
  expect(out.scenes[0].lines[0].text).toBe("Hello there.");
});

// ── errors + registry ────────────────────────────────────────────────

test("unreadable_binary_rejected", () => {
  expect(() => parse(Buffer.from([0xff, 0xfe, 0x00, 0x01, ...Buffer.from("binarygarbage")]), { filename: "bad.epub" })).toThrow(ApiError);
});

test("registered_and_runs_through_registry", () => {
  expect(getAdapter("book_prose")).not.toBeNull();
  const out = runAdapter("book_prose", enc("# T\n\nHello world paragraph."), { filename: "t.md" });
  expect(out.scenes[0].lines[0].text).toBe("Hello world paragraph.");
});

// ── endpoint: multipart dry-run through the real router ──────────────

test("endpoint_multipart_dry_run_epub", async () => {
  useState();
  try {
    const raw = _makeEpub({
      "front.xhtml": _xhtml(null, ["Tiny title page."]),
      "ch1.xhtml": _xhtml("One", ["First chapter paragraph text goes here."]),
    });
    const r = await viaRoutes([projectsRouter], (app) =>
      client(app).post("/v1/projects/import", {
        data: { source: "book_prose", dry_run: "true" },
        files: { file: ["the-ninth-facet.epub", raw, "application/epub+zip"] },
      }),
    );
    expect(r.status, r.text).toBe(200);
    const body = r.json();
    expect(body.committed).toBe(false);
    expect(body.project_id).toBeNull();
    expect(body.standard.project.name).toBe("The Ninth Facet");
    expect(body.standard.scenes.map((s) => s.title)).toEqual(["One"]);
    expect(body.warnings.some((w) => w.includes("front matter"))).toBe(true);
  } finally {
    endState();
  }
});
