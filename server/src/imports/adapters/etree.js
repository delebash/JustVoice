// SPDX-License-Identifier: MIT
// The part of Python's `xml.etree.ElementTree` the importers use — `fromstring(bytes)` (expat
// underneath, with ElementTree's namespace expansion), Element `tag` / `attrib` / `text` /
// `tail`, `get`, `iter`, `find` and `findtext` over the path forms the adapters write
// (".//{ns}name", "{ns}a/{ns}b", "{ns}name") — for EPUB packages and DOCX parts. A small
// well-formedness parser written to expat's rules and words: a malformed file is refused with
// ParseError "<what>: line L, column C" as Python refuses it (book_prose puts that text in its
// 400). Candidate for platform/.
//
// What expat does that this does too: the XML declaration's encoding (UTF-8, UTF-16 by BOM,
// ISO-8859-1, US-ASCII and the single-byte codepages Python lends it), line ends normalized to
// \n, literal tabs and newlines in attribute values as spaces, the five predefined entities,
// character references (refused when they name a character XML forbids), a DOCTYPE's internal
// general entities, `undefined entity` (ElementTree's own wording when the DOCTYPE names an
// external subset), namespaces (`xml:` bound, unbound prefixes refused), comments and processing
// instructions dropped. Not done: attribute defaults declared in a DTD, parameter entities.

import { cpIndex } from "@delebash/llm-runner/platform/py";

export class ParseError extends Error {
  constructor(msg, line, column) {
    super(`${msg}: line ${line}, column ${column}`);
    this.name = "ParseError";
    this.position = [line, column];
  }
}

const XML_NS = "http://www.w3.org/XML/1998/namespace";

/** A path's steps: split on "/" outside "{…}". */
function steps(path) {
  const out = [];
  let cur = "";
  let depth = 0;
  for (const ch of path) {
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    if (ch === "/" && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export class Element {
  constructor(tag, attrib) {
    this.tag = tag;
    this.attrib = attrib;
    this.text = null;
    this.tail = null;
    this.children = [];
  }

  /** `elem.get(key, default)`. */
  get(key, dflt = null) {
    return Object.hasOwn(this.attrib, key) ? this.attrib[key] : dflt;
  }

  /** `elem.iter(tag)` — this element and every descendant, in document order. */
  *iter(tag = null) {
    if (tag === null || tag === "*" || this.tag === tag) yield this;
    for (const c of this.children) yield* c.iter(tag);
  }

  /** `elem.iterfind(path)` for "name", "a/b" and ".//name" (a "{uri}" holds slashes of its
   * own, so steps split on "/" outside braces only). */
  *iterfind(path) {
    if (path.startsWith(".//")) {
      const [first, ...rest] = steps(path.slice(3));
      for (const e of this.iter(first)) {
        if (e === this) continue;
        if (!rest.length) yield e;
        else yield* e.iterfind(rest.join("/"));
      }
      return;
    }
    const [first, ...rest] = steps(path);
    for (const c of this.children) {
      if (first !== "*" && c.tag !== first) continue;
      if (!rest.length) yield c;
      else yield* c.iterfind(rest.join("/"));
    }
  }

  /** `elem.find(path)` — the first match, or null. */
  find(path) {
    for (const e of this.iterfind(path)) return e;
    return null;
  }

  /** `elem.findtext(path, default)` — the first match's text ("" when it has none). */
  findtext(path, dflt = null) {
    const e = this.find(path);
    return e === null ? dflt : (e.text ?? "");
  }
}

// ── decoding ──────────────────────────────────────────────────────────────────

const SINGLE_BYTE = new Set([
  "iso-8859-1", "latin-1", "latin1", "iso8859-1", "l1", "iso-8859-2", "iso-8859-15", "windows-1250", "windows-1251",
  "windows-1252", "windows-1253", "windows-1254", "windows-1255", "windows-1256", "windows-1257", "windows-1258",
  "cp1250", "cp1251", "cp1252", "cp1253", "cp1254", "cp1255", "cp1256", "cp1257", "cp1258", "koi8-r",
]);

/** The XML declaration's encoding name (lower-cased), from the first bytes as ASCII. */
function declaredEncoding(buf) {
  const head = buf.subarray(0, 200).toString("latin1");
  const m = /^<\?xml[\t\n\r ][^>]*?encoding[\t\n\r ]*=[\t\n\r ]*(["'])([A-Za-z][A-Za-z0-9._-]*)\1/.exec(head);
  return m ? m[2].toLowerCase() : null;
}

/** [text, utf8 check failure index | -1, error] — the document as expat reads its bytes. */
function decodeDocument(buf) {
  if (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))) {
    const le = buf[0] === 0xff;
    return [new TextDecoder(le ? "utf-16le" : "utf-16be").decode(buf.subarray(2)), -1, null];
  }
  if (buf.length >= 4 && buf[0] === 0x3c && buf[1] === 0 && buf[2] === 0x3f && buf[3] === 0) {
    return [new TextDecoder("utf-16le").decode(buf), -1, null];
  }
  if (buf.length >= 4 && buf[0] === 0 && buf[1] === 0x3c && buf[2] === 0 && buf[3] === 0x3f) {
    return [new TextDecoder("utf-16be").decode(buf), -1, null];
  }
  let body = buf;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) body = buf.subarray(3);
  const enc = declaredEncoding(body);
  if (enc === "utf-16" || enc === "utf-16le" || enc === "utf-16be") return [body.toString("latin1"), -1, "encoding specified in XML declaration is incorrect"];
  if (enc && enc !== "utf-8" && enc !== "utf8" && (SINGLE_BYTE.has(enc) || enc === "us-ascii" || enc === "ascii")) {
    const label = enc === "us-ascii" || enc === "ascii" ? "latin1" : enc.replace(/^cp/, "windows-").replace(/^latin-?1$|^l1$|^iso8859-1$/, "iso-8859-1");
    if (label === "iso-8859-1" || label === "latin1") return [body.toString("latin1"), -1, null];
    return [new TextDecoder(label).decode(body), -1, null];
  }
  if (enc && enc !== "utf-8" && enc !== "utf8") return [body.toString("latin1"), -1, "unknown encoding"];
  // UTF-8: the first byte that does not start a valid sequence is an invalid token.
  const fatal = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  try {
    return [fatal.decode(body), -1, null];
  } catch {
    let i = 0;
    let good = 0;
    while (i < body.length) {
      const b = body[i];
      const len = b < 0x80 ? 1 : b >= 0xc2 && b < 0xe0 ? 2 : b >= 0xe0 && b < 0xf0 ? 3 : b >= 0xf0 && b < 0xf5 ? 4 : 0;
      if (!len) break;
      try {
        fatal.decode(body.subarray(i, i + len));
      } catch {
        break;
      }
      i += len;
      good = i;
    }
    return [fatal.decode(body.subarray(0, good)), good, null];
  }
}

// ── names and characters ──────────────────────────────────────────────────────

const NAME_START = /[:A-Z_a-zÀ-ÖØ-öø-˿Ͱ-ͽͿ-῿‌-‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�\u{10000}-\u{EFFFF}]/u;
const NAME_CHAR = /[-.0-9:A-Z_a-z·À-ÖØ-öø-ͽͿ-῿‌-‍‿-⁀⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�\u{10000}-\u{EFFFF}]/u;

const isXmlChar = (c) =>
  c === 0x9 || c === 0xa || c === 0xd || (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd) || (c >= 0x10000 && c <= 0x10ffff);
const isWs = (ch) => ch === " " || ch === "\t" || ch === "\n" || ch === "\r";

const PREDEFINED = { lt: "<", gt: ">", amp: "&", apos: "'", quot: '"' };

class Parser {
  constructor(text, utf8Bad) {
    this.s = text;
    this.i = 0;
    this.limit = utf8Bad >= 0 ? text.length : -1; // the text ends where the bytes went bad
    this.badAtEnd = utf8Bad >= 0;
    this.entities = new Map();
    this.externalSubset = false;
    this.stack = [];
    this.nsStack = [new Map([["xml", XML_NS]])];
    this.root = null;
  }

  fail(msg, at = this.i) {
    const before = this.s.slice(0, at);
    const lines = before.split(/\r\n|\r|\n/);
    const line = lines.length;
    const lastStart = before.length - lines[lines.length - 1].length;
    throw new ParseError(msg, line, cpIndex(this.s, at) - cpIndex(this.s, lastStart));
  }

  /** The end of input: a bad UTF-8 byte there is an invalid token, else `msg`. */
  eof(msg, at = this.i) {
    if (this.badAtEnd) this.fail("not well-formed (invalid token)", this.s.length);
    this.fail(msg, at);
  }

  peek(k = 0) {
    return this.s[this.i + k];
  }

  atEnd() {
    return this.i >= this.s.length;
  }

  /** The code point at i; a character XML forbids is an invalid token there. */
  checkChar(i) {
    const c = this.s.codePointAt(i);
    if (!isXmlChar(c)) this.fail("not well-formed (invalid token)", i);
    return c > 0xffff ? 2 : 1;
  }

  skipWs() {
    while (!this.atEnd() && isWs(this.peek())) this.i++;
  }

  readName() {
    const start = this.i;
    const first = String.fromCodePoint(this.s.codePointAt(this.i));
    if (!NAME_START.test(first)) this.fail("not well-formed (invalid token)", this.i);
    this.i += first.length;
    while (!this.atEnd()) {
      const ch = String.fromCodePoint(this.s.codePointAt(this.i));
      if (!NAME_CHAR.test(ch)) break;
      this.i += ch.length;
    }
    return this.s.slice(start, this.i);
  }

  /** `&…;` at i → its text. `inAttr`: an entity's replacement may not hold `<`. */
  reference(inAttr) {
    const amp = this.i;
    this.i++;
    if (this.peek() === "#") {
      this.i++;
      const hex = this.peek() === "x";
      if (hex) this.i++;
      const start = this.i;
      const digits = hex ? /[0-9a-fA-F]/ : /[0-9]/;
      while (!this.atEnd() && digits.test(this.peek())) this.i++;
      if (this.atEnd()) this.eof("unclosed token", amp);
      if (this.i === start || this.peek() !== ";") this.fail("not well-formed (invalid token)", this.i);
      const n = Number.parseInt(this.s.slice(start, this.i), hex ? 16 : 10);
      this.i++;
      if (!isXmlChar(n)) this.fail("reference to invalid character number", amp);
      return String.fromCodePoint(n);
    }
    if (this.atEnd()) this.eof("unclosed token", amp);
    const name = this.readName();
    if (this.atEnd()) this.eof("unclosed token", amp);
    if (this.peek() !== ";") this.fail("not well-formed (invalid token)", this.i);
    this.i++;
    if (Object.hasOwn(PREDEFINED, name)) return PREDEFINED[name];
    if (this.entities.has(name)) {
      const v = this.entities.get(name);
      if (inAttr && v.includes("<")) this.fail("not well-formed (invalid token)", amp);
      return v;
    }
    if (this.externalSubset) this.fail(`undefined entity &${name};`, amp);
    this.fail("undefined entity", amp);
  }

  /** The prolog: an XML declaration (only at the very start), comments, PIs, a DOCTYPE. */
  prolog() {
    if (this.s.startsWith("﻿")) this.i = 1;
    if (this.s.startsWith("<?xml", this.i) && /[\t\n\r ?]/.test(this.s[this.i + 5] || "")) {
      const end = this.s.indexOf("?>", this.i);
      if (end < 0) this.eof("unclosed token", this.i);
      this.i = end + 2;
    }
    for (;;) {
      this.skipWs();
      if (this.atEnd()) this.eof("no element found");
      if (this.s.startsWith("<!--", this.i)) this.comment();
      else if (this.s.startsWith("<?", this.i)) this.pi();
      else if (this.s.startsWith("<!DOCTYPE", this.i)) this.doctype();
      else if (this.peek() === "<") return;
      else this.fail("syntax error", this.i);
    }
  }

  comment() {
    const start = this.i;
    this.i += 4;
    for (;;) {
      if (this.atEnd()) this.eof("unclosed token", start);
      if (this.s.startsWith("--", this.i)) {
        if (this.s[this.i + 2] === ">") {
          this.i += 3;
          return;
        }
        if (this.i + 2 >= this.s.length) this.eof("unclosed token", start);
        this.fail("not well-formed (invalid token)", this.i + 2);
      }
      this.i += this.checkChar(this.i);
    }
  }

  pi() {
    const start = this.i;
    this.i += 2;
    if (this.atEnd()) this.eof("unclosed token", start);
    const target = this.readName();
    if (target === "xml") this.fail("XML or text declaration not at start of entity", start);
    const end = this.s.indexOf("?>", this.i);
    if (end < 0) this.eof("unclosed token", start);
    for (let k = this.i; k < end; ) k += this.checkChar(k);
    this.i = end + 2;
  }

  doctype() {
    const start = this.i;
    this.i += 9;
    this.skipWs();
    this.readName();
    this.skipWs();
    if (this.s.startsWith("SYSTEM", this.i) || this.s.startsWith("PUBLIC", this.i)) {
      this.externalSubset = true;
      const pub = this.s.startsWith("PUBLIC", this.i);
      this.i += 6;
      for (let k = 0; k < (pub ? 2 : 1); k++) {
        this.skipWs();
        const q = this.peek();
        if (q !== '"' && q !== "'") this.fail("syntax error", this.i);
        const end = this.s.indexOf(q, this.i + 1);
        if (end < 0) this.eof("unclosed token", start);
        this.i = end + 1;
      }
      this.skipWs();
    }
    if (this.peek() === "[") {
      this.i++;
      for (;;) {
        this.skipWs();
        if (this.atEnd()) this.eof("unclosed token", start);
        if (this.peek() === "]") {
          this.i++;
          break;
        }
        if (this.s.startsWith("<!ENTITY", this.i)) this.entityDecl();
        else if (this.s.startsWith("<!--", this.i)) this.comment();
        else if (this.s.startsWith("<?", this.i)) this.pi();
        else if (this.s.startsWith("<!", this.i)) {
          // ELEMENT / ATTLIST / NOTATION: skipped, quotes respected.
          let k = this.i + 2;
          let q = null;
          while (k < this.s.length && (q !== null || this.s[k] !== ">")) {
            if (q === null && (this.s[k] === '"' || this.s[k] === "'")) q = this.s[k];
            else if (q !== null && this.s[k] === q) q = null;
            k++;
          }
          if (k >= this.s.length) this.eof("unclosed token", start);
          this.i = k + 1;
        } else if (this.peek() === "%") {
          const end = this.s.indexOf(";", this.i);
          if (end < 0) this.eof("unclosed token", start);
          this.i = end + 1;
        } else this.fail("syntax error", this.i);
      }
      this.skipWs();
    }
    if (this.peek() !== ">") this.fail("syntax error", this.i);
    this.i++;
  }

  entityDecl() {
    const start = this.i;
    this.i += 8;
    this.skipWs();
    const param = this.peek() === "%";
    if (param) {
      this.i++;
      this.skipWs();
    }
    const name = this.readName();
    this.skipWs();
    const q = this.peek();
    let value = null;
    if (q === '"' || q === "'") {
      const end = this.s.indexOf(q, this.i + 1);
      if (end < 0) this.eof("unclosed token", start);
      value = this.s.slice(this.i + 1, end);
      this.i = end + 1;
    }
    let k = this.i;
    let quote = null;
    while (k < this.s.length && (quote !== null || this.s[k] !== ">")) {
      if (quote === null && (this.s[k] === '"' || this.s[k] === "'")) quote = this.s[k];
      else if (quote !== null && this.s[k] === quote) quote = null;
      k++;
    }
    if (k >= this.s.length) this.eof("unclosed token", start);
    this.i = k + 1;
    if (!param && value !== null && !this.entities.has(name)) {
      // Character references in an entity value are expanded when it is declared.
      this.entities.set(
        name,
        value.replace(/&#(x[0-9a-fA-F]+|[0-9]+);/g, (_m, d) => String.fromCodePoint(Number.parseInt(d[0] === "x" ? d.slice(1) : d, d[0] === "x" ? 16 : 10))),
      );
    }
  }

  resolve(qname, isAttr, ns, at) {
    const colon = qname.indexOf(":");
    if (colon < 0) {
      if (isAttr) return qname;
      const uri = ns.get("");
      return uri ? `{${uri}}${qname}` : qname;
    }
    const prefix = qname.slice(0, colon);
    if (!ns.has(prefix)) this.fail("unbound prefix", at);
    return `{${ns.get(prefix)}}${qname.slice(colon + 1)}`;
  }

  /** A start tag at i → [element, empty?]. */
  startTag() {
    const lt = this.i;
    this.i++;
    if (this.atEnd()) this.eof("unclosed token", lt);
    const qname = this.readName();
    const raw = [];
    for (;;) {
      const hadWs = !this.atEnd() && isWs(this.peek());
      this.skipWs();
      if (this.atEnd()) this.eof("unclosed token", lt);
      const ch = this.peek();
      if (ch === ">" || ch === "/") break;
      if (!hadWs) this.fail("not well-formed (invalid token)", this.i);
      const nameAt = this.i;
      const name = this.readName();
      this.skipWs();
      if (this.atEnd()) this.eof("unclosed token", lt);
      if (this.peek() !== "=") this.fail("not well-formed (invalid token)", this.i);
      this.i++;
      this.skipWs();
      if (this.atEnd()) this.eof("unclosed token", lt);
      const q = this.peek();
      if (q !== '"' && q !== "'") this.fail("not well-formed (invalid token)", this.i);
      this.i++;
      let value = "";
      for (;;) {
        if (this.atEnd()) this.eof("unclosed token", lt);
        const c = this.peek();
        if (c === q) {
          this.i++;
          break;
        }
        if (c === "<") this.fail("not well-formed (invalid token)", this.i);
        if (c === "&") value += this.reference(true);
        else if (c === "\r") {
          value += " ";
          this.i += this.s[this.i + 1] === "\n" ? 2 : 1;
        } else if (c === "\n" || c === "\t") {
          value += " ";
          this.i++;
        } else {
          const n = this.checkChar(this.i);
          value += this.s.slice(this.i, this.i + n);
          this.i += n;
        }
      }
      if (raw.some(([n]) => n === name)) this.fail("duplicate attribute", nameAt);
      raw.push([name, value, nameAt]);
    }
    let empty = false;
    if (this.peek() === "/") {
      this.i++;
      if (this.atEnd()) this.eof("unclosed token", lt);
      if (this.peek() !== ">") this.fail("not well-formed (invalid token)", this.i);
      empty = true;
    }
    this.i++;

    // Namespaces: this element's declarations, then its names.
    const ns = new Map(this.nsStack[this.nsStack.length - 1]);
    for (const [name, value] of raw) {
      if (name === "xmlns") ns.set("", value);
      else if (name.startsWith("xmlns:")) {
        if (value === "") this.fail("must not undeclare prefix", lt);
        ns.set(name.slice(6), value);
      }
    }
    const tag = this.resolve(qname, false, ns, lt);
    const attrib = {};
    for (const [name, value, nameAt] of raw) {
      if (name === "xmlns" || name.startsWith("xmlns:")) continue;
      const key = this.resolve(name, true, ns, lt);
      if (Object.hasOwn(attrib, key)) this.fail("duplicate attribute", nameAt);
      attrib[key] = value;
    }
    const el = new Element(tag, attrib);
    el.qname = qname;
    return [el, empty, ns];
  }

  /** Character data up to the next markup → appended to `into` (the text or last child's tail). */
  content(parent) {
    let data = null;
    const add = (t) => {
      data = (data ?? "") + t;
    };
    const flush = () => {
      if (data === null) return;
      if (parent.children.length) {
        const last = parent.children[parent.children.length - 1];
        last.tail = (last.tail ?? "") + data;
      } else parent.text = (parent.text ?? "") + data;
      data = null;
    };
    for (;;) {
      if (this.atEnd()) this.eof("no element found");
      const c = this.peek();
      if (c === "<") {
        if (this.s.startsWith("</", this.i)) {
          flush();
          return;
        }
        if (this.s.startsWith("<!--", this.i)) {
          this.comment();
          continue;
        }
        if (this.s.startsWith("<![CDATA[", this.i)) {
          const end = this.s.indexOf("]]>", this.i + 9);
          if (end < 0) this.eof("unclosed CDATA section", this.s.length);
          let k = this.i + 9;
          while (k < end) k += this.checkChar(k);
          add(this.s.slice(this.i + 9, end).replace(/\r\n?/g, "\n"));
          this.i = end + 3;
          continue;
        }
        if (this.s.startsWith("<?", this.i)) {
          this.pi();
          continue;
        }
        if (this.s.startsWith("<!", this.i)) this.fail("not well-formed (invalid token)", this.i + 1);
        flush();
        this.element(parent);
        continue;
      }
      if (c === "&") {
        add(this.reference(false));
        continue;
      }
      if (c === "]" && this.s.startsWith("]]>", this.i)) this.fail("not well-formed (invalid token)", this.i + 2);
      if (c === "\r") {
        add("\n");
        this.i += this.s[this.i + 1] === "\n" ? 2 : 1;
        continue;
      }
      const n = this.checkChar(this.i);
      add(this.s.slice(this.i, this.i + n));
      this.i += n;
    }
  }

  element(parent) {
    const [el, empty, ns] = this.startTag();
    if (parent) parent.children.push(el);
    if (empty) return el;
    this.nsStack.push(ns);
    this.content(el);
    // The end tag.
    const lt = this.i;
    this.i += 2;
    const nameAt = this.i;
    if (this.atEnd()) this.eof("unclosed token", lt);
    const name = this.readName();
    if (name !== el.qname) this.fail("mismatched tag", nameAt);
    this.skipWs();
    if (this.atEnd()) this.eof("unclosed token", lt);
    if (this.peek() !== ">") this.fail("not well-formed (invalid token)", this.i);
    this.i++;
    this.nsStack.pop();
    return el;
  }

  document() {
    this.prolog();
    this.root = this.element(null);
    for (;;) {
      this.skipWs();
      if (this.atEnd()) break;
      if (this.s.startsWith("<!--", this.i)) this.comment();
      else if (this.s.startsWith("<?", this.i)) this.pi();
      else this.fail("junk after document element", this.i);
    }
    if (this.badAtEnd) this.fail("not well-formed (invalid token)", this.s.length);
    return this.root;
  }
}

/** `ET.fromstring(data)` — the root Element, or ParseError in expat's words. */
export function fromstring(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
  const [text, bad, encErr] = decodeDocument(buf);
  const p = new Parser(text, bad);
  if (encErr === "encoding specified in XML declaration is incorrect") {
    const m = /encoding[\t\n\r ]*=[\t\n\r ]*["']/.exec(text);
    p.fail(encErr, m ? m.index + m[0].length : 0);
  }
  if (encErr) p.fail(encErr, 0);
  return p.document();
}
