// SPDX-License-Identifier: MIT
// Book / manuscript import adapter — EPUB, DOCX, Markdown, plain text (the port of
// justvoice/imports/adapters/book_prose.py).
//
// The audiobook entry point for users who don't come from JustWrite: a finished book file goes
// in, chapters + paragraph lines come out. No speaker data exists in these formats, so no
// characters are emitted — speakers are discovered later by Script extraction (CONCEPTS.md §3).
//
// The parsers are the kit's ZIP reader and this folder's ports of Python's html.parser
// (html_parser.js) and ElementTree (etree.js), so a book reads word for word as it did in
// Python, and headless `serve` needs nothing optional.
//
// Format handling:
//   - EPUB  — spine order from the OPF; one chapter per spine document; chapter title from
//             the first <h1>–<h3>; nav/cover and near-empty front-matter docs are skipped with
//             a warning.
//   - DOCX  — paragraphs from word/document.xml; "Heading 1/2/3" styles start a new chapter.
//   - MD    — "#" / "##" headings start a new chapter.
//   - TXT   — short "Chapter N…"-style lines start a new chapter; otherwise the whole file is
//             one scene.

import { BadZipFile, ZipReader } from "@delebash/llm-runner/platform/zip";
import { B, KeyError, PY_WS, splitWs, strip, W } from "@delebash/llm-runner/platform/py";
import { badRequest } from "../../errors.js";
import { construct } from "../../models.js";
import { cpLen, decodeUtf8, END, splitlines } from "../../py_compat.js";
import { StandardImport } from "../standard_schema.js";
import { ParseError, fromstring } from "./etree.js";
import { HTMLParser } from "./html_parser.js";

export const SOURCE_ID = "book_prose";

// Spine documents with fewer words than this and no heading are treated as front matter
// (title page, dedication) and skipped with a warning.
const _FRONT_MATTER_MAX_WORDS = 15;

const _BLOCK_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote"]);
const _HEADING_TAGS = new Set(["h1", "h2", "h3"]);

const S = `[${PY_WS}]`;
const WS_RUN = new RegExp(`${S}+`, "gu");

// Chapter-split strategies (import-review "Split chapters on" selector):
//   auto  — format default: EPUB = one chapter per spine doc; DOCX = Heading 1-3 styles;
//           MD = #/##/### ; TXT = "Chapter N" lines.
//   h1    — split only on level-1 headings (EPUB re-splits the merged spine at <h1>).
//   h1_h2 — split on level-1 AND level-2 headings.
//   none  — no splitting: the whole book lands as one chapter.
export const SPLIT_MODES = ["auto", "h1", "h1_h2", "none"];

/** `repr()` of the selector value, for the error. */
const reprStr = (v) => (typeof v === "string" ? `'${v.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'` : String(v));

export function parse(raw, { filename = null, split_on = "auto" } = {}) {
  if (!SPLIT_MODES.includes(split_on)) {
    throw badRequest(`book_prose import: unknown split_on ${reprStr(split_on)}. Known: ${SPLIT_MODES.join(", ")}`);
  }
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  const ext = _extension(filename);
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const names = _zipNames(buf);
    // A damaged archive (its directory, a member's CRC, its compressed data cut short or
    // corrupt — zlib's Z_* errors) is the uploader's to fix — a 400, not the 500 it was.
    try {
      if (names.has("META-INF/container.xml") || ext === ".epub") return _parseEpub(buf, filename, split_on);
      if (names.has("word/document.xml") || ext === ".docx") return _parseDocx(buf, filename, split_on);
    } catch (e) {
      if (e instanceof BadZipFile || /^Z_/.test(e?.code ?? "")) throw badRequest("book_prose import: zip file is damaged");
      throw e;
    }
    throw badRequest("book_prose import: zip file is neither EPUB nor DOCX");
  }
  let text;
  try {
    text = decodeUtf8(buf, { sig: true });
  } catch (e) {
    if (e?.name === "UnicodeDecodeError") throw badRequest("book_prose import: file is not UTF-8 text, EPUB, or DOCX");
    throw e;
  }
  if (ext === ".md" || ext === ".markdown" || _looksLikeMarkdown(text)) return _parseMarkdown(text, filename, split_on);
  return _parseTxt(text, filename, split_on);
}
parse.options = ["split_on"];

// ── shared helpers ───────────────────────────────────────────────────

function _extension(filename) {
  if (!filename || !filename.includes(".")) return "";
  return `.${filename.slice(filename.lastIndexOf(".") + 1).toLowerCase()}`;
}

/** `s.rsplit(".", 1)[0]`. */
export const beforeLastDot = (s) => (s.includes(".") ? s.slice(0, s.lastIndexOf(".")) : s);

function _stem(filename, fallback) {
  if (!filename) return fallback;
  const name = filename.replaceAll("\\", "/").split("/").pop();
  return beforeLastDot(name) || fallback;
}

function _zipNames(buf) {
  try {
    return new Set(ZipReader.fromBuffer(buf).names());
  } catch (e) {
    if (e instanceof BadZipFile) return new Set();
    throw e;
  }
}

function _slug(text, fallback = "scene") {
  const s = strip(text.toLowerCase().replace(/[^a-z0-9]+/g, "_"), "_");
  return s.slice(0, 64) || fallback;
}

function _uniqueId(base, taken) {
  let sid = base;
  let n = 2;
  while (taken.has(sid)) {
    sid = `${base}_${n}`;
    n += 1;
  }
  taken.add(sid);
  return sid;
}

function _build({ name, language, description, chapters, sourcePrefix, warnings }) {
  const scenes = [];
  const taken = new Set();
  chapters.forEach(([title, paragraphs], i) => {
    const idx = i + 1;
    const base = _slug(title || `chapter_${idx}`, `chapter_${idx}`);
    scenes.push({
      id: _uniqueId(base, taken),
      title: title || `Chapter ${idx}`,
      kind: "chapter",
      lines: paragraphs.map((p, pi) => ({ text: p, source_ref: `${sourcePrefix}:ch${idx}:p${pi + 1}` })),
    });
  });
  if (!scenes.length) throw badRequest("book_prose import: no readable text found");
  return construct(StandardImport, {
    source: SOURCE_ID,
    project: { name, kind: "audiobook", description, language },
    characters: [], // prose carries no speaker data — Script discovers them
    scenes,
    warnings,
  });
}

// ── EPUB ─────────────────────────────────────────────────────────────

/**
 * Collects ["h1"|"h2"|"h3"|"p", text] blocks from one XHTML document, in order.
 *
 * `skipClasses` drops whole blocks whose class attribute names one of them. Empty by default;
 * the JustWrite adapter passes {"scene-mark"} because JustWrite's editor can leave a
 * `<p class="scene-mark">* * *</p>` separator inside a single scene's body, and a narrator must
 * not read the asterisks aloud.
 */
export class XhtmlBlocks extends HTMLParser {
  constructor(skipClasses = new Set()) {
    super();
    this.blocks = [];
    this._skipClasses = skipClasses;
    this._tag = null;
    this._buf = [];
    this._skipDepth = 0;
    this._drop = false;
  }

  handleStarttag(tag, attrs) {
    if (tag === "script" || tag === "style") this._skipDepth += 1;
    else if (_BLOCK_TAGS.has(tag) && this._skipDepth === 0) {
      this._flush();
      this._tag = tag;
      // dict(attrs).get("class"): the last of a repeated attribute wins.
      let cls = null;
      for (const [k, v] of attrs) if (k === "class") cls = v;
      const classes = new Set(splitWs(cls || ""));
      this._drop = [...this._skipClasses].some((c) => classes.has(c));
    } else if (tag === "br" && this._tag) this._buf.push(" ");
  }

  handleEndtag(tag) {
    if (tag === "script" || tag === "style") this._skipDepth = Math.max(0, this._skipDepth - 1);
    else if (_BLOCK_TAGS.has(tag)) this._flush();
  }

  handleData(data) {
    if (this._tag && this._skipDepth === 0) this._buf.push(data);
  }

  _flush() {
    if (this._tag && !this._drop) {
      const text = strip(this._buf.join("").replace(WS_RUN, " "));
      // Headings keep their tag (h1/h2/h3) so split_on can distinguish levels; everything
      // else is "p".
      if (text) this.blocks.push([_HEADING_TAGS.has(this._tag) ? this._tag : "p", text]);
    }
    this._tag = null;
    this._buf = [];
    this._drop = false;
  }

  /** Flush a trailing unterminated block, THEN let the parser handle what it still holds —
   * Python's order (anything that reaches handleData after this flush is dropped). */
  close() {
    this._flush();
    super.close();
  }
}

/**
 * Ordered [kind, text] blocks from an HTML fragment. The ONE door for other adapters — nobody
 * re-forks the parser. The JustWrite adapter reads rich-editor HTML out of `book.json` scene
 * rows and needs exactly this: inline markup flattened to text, `<hr>` and empty paragraphs
 * dropped, heading level preserved.
 */
export function htmlBlocks(html, { skipClasses = new Set() } = {}) {
  const parser = new XhtmlBlocks(skipClasses);
  parser.feed(html || "");
  parser.close();
  return parser.blocks;
}

function _xmlRoot(data, what) {
  try {
    return fromstring(data);
  } catch (e) {
    if (e instanceof ParseError) throw badRequest(`book_prose import: malformed ${what} (${e.message})`);
    throw e;
  }
}

/** Re-chapter a merged [kind, text] block stream by heading level. Non-splitting headings (an
 * h2 in h1 mode, h3 always) stay in the text as plain paragraphs so nothing is silently
 * dropped. */
function _splitBlocks(blocks, splitOn) {
  if (splitOn === "none") {
    const title = blocks.find(([k]) => _HEADING_TAGS.has(k))?.[1] ?? null;
    const paragraphs = blocks.filter(([k, t]) => !_HEADING_TAGS.has(k) || t !== title).map(([, t]) => t);
    return paragraphs.length ? [[title, paragraphs]] : [];
  }
  const levels = splitOn === "h1" ? new Set(["h1"]) : new Set(["h1", "h2"]);
  const chapters = [];
  let current = null;
  for (const [k, t] of blocks) {
    if (levels.has(k)) {
      current = [t, []];
      chapters.push(current);
    } else {
      if (current === null) {
        current = [null, []];
        chapters.push(current);
      }
      current[1].push(t);
    }
  }
  return chapters.filter((c) => c[1].length);
}

const NS_CONTAINER = "{urn:oasis:names:tc:opendocument:xmlns:container}";
const NS_OPF = "{http://www.idpf.org/2007/opf}";
const NS_DC = "{http://purl.org/dc/elements/1.1/}";

function _parseEpub(buf, filename, splitOn = "auto") {
  const zf = ZipReader.fromBuffer(buf);
  let container;
  try {
    container = _xmlRoot(zf.read("META-INF/container.xml"), "container.xml");
  } catch (e) {
    if (e instanceof KeyError) throw badRequest("book_prose import: EPUB has no META-INF/container.xml");
    throw e;
  }
  const rootfile = container.find(`.//${NS_CONTAINER}rootfile`);
  if (rootfile === null || !rootfile.get("full-path")) throw badRequest("book_prose import: EPUB container has no rootfile");
  const opfPath = rootfile.get("full-path");
  const opfDir = opfPath.includes("/") ? `${opfPath.slice(0, opfPath.lastIndexOf("/"))}/` : "";
  let opf;
  try {
    opf = _xmlRoot(zf.read(opfPath), "OPF package");
  } catch (e) {
    if (e instanceof KeyError) throw badRequest(`book_prose import: EPUB has no ${opfPath}`);
    throw e;
  }

  const title = strip(opf.findtext(`.//${NS_DC}title`) || "");
  const creator = strip(opf.findtext(`.//${NS_DC}creator`) || "");
  const language = strip(opf.findtext(`.//${NS_DC}language`) || "") || "en-US";

  const manifest = new Map(); // id -> [href, media, properties]
  for (const item of opf.iter(`${NS_OPF}item`)) {
    manifest.set(item.get("id", ""), [item.get("href", ""), item.get("media-type", ""), item.get("properties", "") || ""]);
  }

  const warnings = [];
  let chapters = [];
  const mergedBlocks = []; // for non-auto split modes
  for (const itemref of opf.iter(`${NS_OPF}itemref`)) {
    const [href, media, props] = manifest.get(itemref.get("idref", "")) ?? ["", "", ""];
    if (!href || !media.includes("html")) continue;
    const propList = splitWs(props);
    if (propList.includes("nav") || propList.includes("cover-image")) continue;
    const full = opfDir + href;
    let doc;
    try {
      doc = zf.read(full);
    } catch (e) {
      if (e instanceof KeyError) {
        warnings.push(`spine document missing from archive: ${href}`);
        continue;
      }
      throw e;
    }
    const extractor = new XhtmlBlocks();
    extractor.feed(decodeUtf8(doc, { replace: true }));
    extractor.close();
    const heading = extractor.blocks.find(([k]) => _HEADING_TAGS.has(k))?.[1] ?? null;
    const paragraphs = extractor.blocks.filter(([k]) => k === "p").map(([, t]) => t);
    const words = paragraphs.reduce((a, p) => a + splitWs(p).length, 0);
    if (!paragraphs.length || (heading === null && words < _FRONT_MATTER_MAX_WORDS)) {
      warnings.push(`skipped front matter: ${href}`);
      continue;
    }
    if (splitOn === "auto") chapters.push([heading, paragraphs]);
    else mergedBlocks.push(...extractor.blocks);
  }

  // Re-chapter the merged spine by heading level — fixes books that ship every chapter in one
  // spine doc (auto would make 1 chapter) and books that split one chapter across many docs.
  if (splitOn !== "auto") chapters = _splitBlocks(mergedBlocks, splitOn);

  return _build({
    name: title || _stem(filename, "Imported book"),
    language,
    description: creator ? `by ${creator}` : null,
    chapters,
    sourcePrefix: "epub",
    warnings,
  });
}

// ── DOCX ─────────────────────────────────────────────────────────────

const NS_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}";

function _parseDocx(buf, filename, splitOn = "auto") {
  const zf = ZipReader.fromBuffer(buf);
  let doc;
  try {
    doc = _xmlRoot(zf.read("word/document.xml"), "word/document.xml");
  } catch (e) {
    if (e instanceof KeyError) throw badRequest("book_prose import: DOCX has no word/document.xml");
    throw e;
  }

  let title = null;
  let coreXml = null;
  try {
    coreXml = zf.read("docProps/core.xml");
  } catch (e) {
    if (!(e instanceof KeyError)) throw e;
  }
  if (coreXml !== null) {
    const core = _xmlRoot(coreXml, "docProps/core.xml");
    title = strip(core.findtext(`${NS_DC}title`) || "") || null;
  }

  // Which heading STYLES start a new chapter (split_on selector).
  const splitLevels = { auto: "[1-3]", h1: "[1]", h1_h2: "[1-2]", none: null }[splitOn];
  const headingRe = splitLevels === null ? null : new RegExp(`^heading${S}*${splitLevels}${END}|^h${splitLevels}${END}`, "iu");
  const chapters = [];
  let current = null;
  for (const para of doc.iter(`${NS_W}p`)) {
    const styleEl = para.find(`${NS_W}pPr/${NS_W}pStyle`);
    const style = styleEl !== null ? styleEl.get(`${NS_W}val`) || "" : "";
    const text = strip([...para.iter(`${NS_W}t`)].map((t) => t.text || "").join("").replace(WS_RUN, " "));
    if (!text) continue;
    if (headingRe !== null && headingRe.test(style.replaceAll("_", " "))) {
      current = [text, []];
      chapters.push(current);
    } else {
      if (current === null) {
        current = [null, []];
        chapters.push(current);
      }
      current[1].push(text);
    }
  }

  return _build({
    name: title || _stem(filename, "Imported manuscript"),
    language: "en-US",
    description: null,
    chapters: chapters.filter((c) => c[1].length),
    sourcePrefix: "docx",
    warnings: [],
  });
}

// ── Markdown / plain text ────────────────────────────────────────────

// `(?m)^` is a line start after "\n" only in Python (a lone "\r" starts none).
const MD_HEADING_ANYWHERE = new RegExp(`(?:^|(?<=\\n))#{1,3}${S}+[^${PY_WS}]`, "u");

function _looksLikeMarkdown(text) {
  return MD_HEADING_ANYWHERE.test(text);
}

const PARA_SPLIT = new RegExp(`\\n${S}*\\n`, "u");

function _splitParagraphs(body) {
  return body
    .split(PARA_SPLIT)
    .filter((chunk) => strip(chunk))
    .map((chunk) => strip(chunk.replace(WS_RUN, " ")));
}

// Python's `.` (no DOTALL) is "anything but \n" — `[^\n]` here, since JavaScript's also
// stops at \r and the line separators.
const MD_SPLIT_HEADING = new RegExp(`^(#{1,3})${S}+([^\\n]*[^${PY_WS}])${S}*${END}`, "u");
const MD_ANY_HEADING = new RegExp(`^#{1,6}${S}+([^\\n]*[^${PY_WS}])${S}*${END}`, "u");

function _parseMarkdown(text, filename, splitOn = "auto") {
  // Max heading level that starts a new chapter; 0 = never split.
  const maxLevel = { auto: 3, h1: 1, h1_h2: 2, none: 0 }[splitOn];
  const chapters = [];
  let currentTitle = null;
  let buf = [];

  const flush = () => {
    const paragraphs = _splitParagraphs(buf.join("\n"));
    if (paragraphs.length || currentTitle) chapters.push([currentTitle, paragraphs]);
  };

  for (const line of splitlines(text)) {
    const m = maxLevel ? MD_SPLIT_HEADING.exec(line) : null;
    if (m && m[1].length <= maxLevel) {
      if (buf.length || currentTitle !== null) flush();
      currentTitle = m[2];
      buf = [];
    } else {
      // Deeper headings (and all headings in "none" mode) stay in the text — strip the
      // markdown marks so they read cleanly.
      const hm = MD_ANY_HEADING.exec(line);
      buf.push(hm ? hm[1] : line);
    }
  }
  flush();

  return _build({
    name: _stem(filename, "Imported manuscript"),
    language: "en-US",
    description: null,
    chapters: chapters.filter((c) => c[1].length),
    sourcePrefix: "md",
    warnings: [],
  });
}

const _TXT_CHAPTER_RE = new RegExp(`^${S}*(chapter|part|book)${S}+([0-9]+|[ivxlc]+|${W}+)${B}[^\\n]{0,40}${END}`, "iu");

function _parseTxt(text, filename, splitOn = "auto") {
  // Plain text has no heading levels — h1/h1_h2 behave like auto ("Chapter N…" lines split);
  // "none" keeps the whole file together.
  const warnings = [];
  if (splitOn === "h1" || splitOn === "h1_h2") {
    warnings.push("plain text has no heading levels — split on 'Chapter N' lines (auto) applied");
  }
  const chapters = [];
  let currentTitle = null;
  let buf = [];

  const flush = () => {
    const paragraphs = _splitParagraphs(buf.join("\n"));
    if (paragraphs.length) chapters.push([currentTitle, paragraphs]);
  };

  for (const line of splitlines(text)) {
    if (splitOn !== "none" && cpLen(line) < 60 && _TXT_CHAPTER_RE.test(line)) {
      flush();
      currentTitle = strip(line);
      buf = [];
    } else buf.push(line);
  }
  flush();

  return _build({
    name: _stem(filename, "Imported text"),
    language: "en-US",
    description: null,
    chapters,
    sourcePrefix: "txt",
    warnings,
  });
}
