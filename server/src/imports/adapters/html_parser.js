// SPDX-License-Identifier: MIT
// CPython 3.12.9's `html.parser.HTMLParser` (convert_charrefs=True) and `html.unescape`,
// ported line for line for the importers (book_prose's EPUB documents, the JustWrite adapter's
// scene bodies). A port rather than an npm parser on purpose: what Python's parser does with
// real books' markup — entities with and without their semicolon, `<br/>`, comments, CDATA
// sections (dropped: `unknown_decl` does nothing), `<script>`/`<style>` content, a `<` that
// opens no tag, an unclosed tag at the end, the ORDER in which buffered text reaches the
// handler on close() — decides which words a narrator reads, and an HTML5 parser (parse5,
// htmlparser2) differs on several of those. Candidate for platform/.
//
// Python's `\s` is Unicode on str (PY_WS here); a `match(s, pos)` is a sticky regex at
// lastIndex = pos, a `search(s, pos)` a global one (lookbehinds see before pos in both).

import { PY_WS, ValueError } from "@delebash/llm-runner/platform/py";
import { AssertionError } from "../../py_compat.js";
import { HTML5_ENTITIES } from "./html5_entities.js";

const WS = PY_WS;
const S = `[${WS}]`;

// ── html.unescape ─────────────────────────────────────────────────────────────

// See https://html.spec.whatwg.org/multipage/parsing.html#numeric-character-reference-end-state
const INVALID_CHARREFS = new Map([
  [0x00, "\ufffd"], [0x0d, "\r"], [0x80, "\u20ac"], [0x81, "\x81"], [0x82, "\u201a"], [0x83, "\u0192"],
  [0x84, "\u201e"], [0x85, "\u2026"], [0x86, "\u2020"], [0x87, "\u2021"], [0x88, "\u02c6"], [0x89, "\u2030"],
  [0x8a, "\u0160"], [0x8b, "\u2039"], [0x8c, "\u0152"], [0x8d, "\x8d"], [0x8e, "\u017d"], [0x8f, "\x8f"],
  [0x90, "\x90"], [0x91, "\u2018"], [0x92, "\u2019"], [0x93, "\u201c"], [0x94, "\u201d"], [0x95, "\u2022"],
  [0x96, "\u2013"], [0x97, "\u2014"], [0x98, "\u02dc"], [0x99, "\u2122"], [0x9a, "\u0161"], [0x9b, "\u203a"],
  [0x9c, "\u0153"], [0x9d, "\x9d"], [0x9e, "\u017e"], [0x9f, "\u0178"],
]);

const INVALID_CODEPOINTS = new Set([
  0x1, 0x2, 0x3, 0x4, 0x5, 0x6, 0x7, 0x8,
  0xe, 0xf, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
  0x7f, 0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x8d, 0x8e, 0x8f,
  0x90, 0x91, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0x9b, 0x9c, 0x9d, 0x9e, 0x9f,
  0xfdd0, 0xfdd1, 0xfdd2, 0xfdd3, 0xfdd4, 0xfdd5, 0xfdd6, 0xfdd7, 0xfdd8, 0xfdd9, 0xfdda, 0xfddb,
  0xfddc, 0xfddd, 0xfdde, 0xfddf, 0xfde0, 0xfde1, 0xfde2, 0xfde3, 0xfde4, 0xfde5, 0xfde6, 0xfde7,
  0xfde8, 0xfde9, 0xfdea, 0xfdeb, 0xfdec, 0xfded, 0xfdee, 0xfdef,
  0xb, 0xfffe, 0xffff, 0x1fffe, 0x1ffff, 0x2fffe, 0x2ffff, 0x3fffe, 0x3ffff, 0x4fffe, 0x4ffff, 0x5fffe,
  0x5ffff, 0x6fffe, 0x6ffff, 0x7fffe, 0x7ffff, 0x8fffe, 0x8ffff, 0x9fffe, 0x9ffff, 0xafffe, 0xaffff,
  0xbfffe, 0xbffff, 0xcfffe, 0xcffff, 0xdfffe, 0xdffff, 0xefffe, 0xeffff, 0xffffe, 0xfffff, 0x10fffe, 0x10ffff,
]);

function replaceCharref(s) {
  if (s[0] === "#") {
    let num;
    if (s[1] === "x" || s[1] === "X") num = BigInt(`0x${s.slice(2).replace(/;+$/, "")}`);
    else {
      const digits = s.slice(1).replace(/;+$/, "");
      // int() refuses more than 4300 decimal digits (CPython's int_max_str_digits).
      if (digits.length > 4300) {
        throw new ValueError(
          `Exceeds the limit (4300 digits) for integer string conversion: value has ${digits.length} digits; use sys.set_int_max_str_digits() to increase the limit`,
        );
      }
      num = BigInt(digits);
    }
    if (num <= 0x9fn && INVALID_CHARREFS.has(Number(num))) return INVALID_CHARREFS.get(Number(num));
    if ((num >= 0xd800n && num <= 0xdfffn) || num > 0x10ffffn) return "\ufffd";
    if (INVALID_CODEPOINTS.has(Number(num))) return "";
    return String.fromCodePoint(Number(num));
  }
  // named charref
  if (HTML5_ENTITIES.has(s)) return HTML5_ENTITIES.get(s);
  // find the longest matching name (as defined by the standard)
  const cps = Array.from(s);
  for (let x = cps.length - 1; x > 1; x--) {
    const head = cps.slice(0, x).join("");
    if (HTML5_ENTITIES.has(head)) return HTML5_ENTITIES.get(head) + cps.slice(x).join("");
  }
  return `&${s}`;
}

const CHARREF = /&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[^\t\n\f <&#;]{1,32};?)/gu;

/** `html.unescape(s)`: every named and numeric character reference, by HTML5's rules. */
export function unescape(s) {
  if (!s.includes("&")) return s;
  return s.replace(CHARREF, (_m, g1) => replaceCharref(g1));
}

// ── html.parser ──────────────────────────────────────────────────────────────

const interestingNormal = /[&<]/g;
const starttagopen = /<[a-zA-Z]/y;
const piclose = />/g;
const commentclose = new RegExp(`--${S}*>`, "gu");
const tagfindTolerant = new RegExp(`([a-zA-Z][^\\t\\n\\r\\f />\\x00]*)(?:${S}|/(?!>))*`, "uy");
const attrfindTolerant = new RegExp(
  `((?<=['"${WS}/])[^${WS}/>][^${WS}/=>]*)(${S}*=+${S}*('[^']*'|"[^"]*"|(?!['"])[^>${WS}]*))?(?:${S}|/(?!>))*`,
  "uy",
);
const locatestarttagendTolerant = new RegExp(
  `<[a-zA-Z][^\\t\\n\\r\\f />\\x00]*` +
    `(?:[${WS}/]*` +
    `(?:(?<=['"${WS}/])[^${WS}/>][^${WS}/=>]*` +
    `(?:${S}*=+${S}*` +
    `(?:'[^']*'|"[^"]*"|(?!['"])[^>${WS}]*)` +
    `${S}*` +
    `)?(?:${S}|/(?!>))*` +
    `)*` +
    `)?` +
    `${S}*`,
  "uy",
);
const endendtag = />/g;
const endtagfind = new RegExp(`</${S}*([a-zA-Z][-.a-zA-Z0-9:_]*)${S}*>`, "uy");
const AMP_STOP = new RegExp(`[${WS};]`, "gu");

// _markupbase
const declnameMatch = new RegExp(`[a-zA-Z][-_.a-zA-Z0-9]*${S}*`, "uy");
const markedsectionclose = new RegExp(`\\]${S}*\\]${S}*>`, "gu");
const msmarkedsectionclose = new RegExp(`\\]${S}*>`, "gu");

const CDATA_CONTENT_ELEMENTS = ["script", "style"];

/** `pattern.match(s, pos)` for a sticky regex. */
function matchAt(re, s, pos) {
  re.lastIndex = pos;
  return re.exec(s);
}

/** `pattern.search(s, pos)` for a global regex. */
function searchFrom(re, s, pos) {
  re.lastIndex = pos;
  return re.exec(s);
}

/** The UTF-16 index of the code point `n` code points before the end of `s` (0 if fewer). */
function backCodePoints(s, n) {
  let i = s.length;
  while (n > 0 && i > 0) {
    i -= 1;
    const c = s.charCodeAt(i);
    if (c >= 0xdc00 && c <= 0xdfff && i > 0) {
      const p = s.charCodeAt(i - 1);
      if (p >= 0xd800 && p <= 0xdbff) i -= 1;
    }
    n -= 1;
  }
  return i;
}

/**
 * Find tags and other markup and call handler methods (`handleStarttag(tag, attrs)`,
 * `handleEndtag(tag)`, `handleData(data)`, `handleComment`, `handleDecl`, `handlePi`,
 * `unknownDecl`), as CPython's HTMLParser with convert_charrefs=True: character references in
 * text are converted, and text reaches handleData whole between markup. `attrs` is a list of
 * [name, value] with the names lower-cased and value null for a bare attribute.
 */
export class HTMLParser {
  constructor() {
    this.reset();
  }

  reset() {
    this.rawdata = "";
    this.lasttag = "???";
    this.interesting = interestingNormal;
    this.cdataElem = null;
  }

  /** Feed data to the parser. */
  feed(data) {
    this.rawdata += data;
    this.goahead(false);
  }

  /** Handle any buffered data. */
  close() {
    this.goahead(true);
  }

  setCdataMode(elem) {
    this.cdataElem = elem.toLowerCase();
    this.interesting = new RegExp(`</${S}*${this.cdataElem}${S}*>`, "giu");
  }

  clearCdataMode() {
    this.interesting = interestingNormal;
    this.cdataElem = null;
  }

  goahead(end) {
    const rawdata = this.rawdata;
    let i = 0;
    const n = rawdata.length;
    while (i < n) {
      let j;
      if (!this.cdataElem) {
        j = rawdata.indexOf("<", i);
        if (j < 0) {
          // If we can't find the next <, either we are at the end or there's more text
          // incoming. If the latter is True, we can't pass the text to handle_data in case
          // we have a charref cut in half at end. Try to determine if this is the case
          // before proceeding by looking for an & near the end and see if it's followed by a
          // space or ;.
          const amppos = rawdata.lastIndexOf("&");
          const from = Math.max(i, backCodePoints(rawdata, 34));
          if (amppos >= from && amppos >= 0 && searchFrom(AMP_STOP, rawdata, amppos) === null) break; // wait till we get all the text
          j = n;
        }
      } else {
        const match = searchFrom(this.interesting, rawdata, i); // < or &
        if (match) j = match.index;
        else {
          if (this.cdataElem) break;
          j = n;
        }
      }
      if (i < j) {
        if (!this.cdataElem) this.handleData(unescape(rawdata.slice(i, j)));
        else this.handleData(rawdata.slice(i, j));
      }
      i = j;
      if (i === n) break;
      if (rawdata.startsWith("<", i)) {
        let k;
        if (matchAt(starttagopen, rawdata, i)) k = this.parseStarttag(i); // < + letter
        else if (rawdata.startsWith("</", i)) k = this.parseEndtag(i);
        else if (rawdata.startsWith("<!--", i)) k = this.parseComment(i);
        else if (rawdata.startsWith("<?", i)) k = this.parsePi(i);
        else if (rawdata.startsWith("<!", i)) k = this.parseHtmlDeclaration(i);
        else if (i + 1 < n) {
          this.handleData("<");
          k = i + 1;
        } else break;
        if (k < 0) {
          if (!end) break;
          k = rawdata.indexOf(">", i + 1);
          if (k < 0) {
            k = rawdata.indexOf("<", i + 1);
            if (k < 0) k = i + 1;
          } else k += 1;
          if (!this.cdataElem) this.handleData(unescape(rawdata.slice(i, k)));
          else this.handleData(rawdata.slice(i, k));
        }
        i = k;
      } else {
        // `&#` / `&` branches: unreachable with convert_charrefs (text runs to the next `<`).
        throw new AssertionError("interesting.search() lied");
      }
    }
    // end while
    if (end && i < n && !this.cdataElem) {
      this.handleData(unescape(rawdata.slice(i, n)));
      i = n;
    }
    this.rawdata = rawdata.slice(i);
  }

  // Internal -- parse html declarations, return length or -1 if not terminated.
  parseHtmlDeclaration(i) {
    const rawdata = this.rawdata;
    if (rawdata.startsWith("<!--", i)) return this.parseComment(i);
    if (rawdata.startsWith("<![", i)) return this.parseMarkedSection(i);
    if (rawdata.slice(i, i + 9).toLowerCase() === "<!doctype") {
      // find the closing >
      const gtpos = rawdata.indexOf(">", i + 9);
      if (gtpos === -1) return -1;
      this.handleDecl(rawdata.slice(i + 2, gtpos));
      return gtpos + 1;
    }
    return this.parseBogusComment(i);
  }

  // Internal -- parse bogus comment, return length or -1 if not terminated.
  parseBogusComment(i, report = true) {
    const rawdata = this.rawdata;
    const pos = rawdata.indexOf(">", i + 2);
    if (pos === -1) return -1;
    if (report) this.handleComment(rawdata.slice(i + 2, pos));
    return pos + 1;
  }

  // Internal -- parse processing instr, return end or -1 if not terminated.
  parsePi(i) {
    const rawdata = this.rawdata;
    const match = searchFrom(piclose, rawdata, i + 2); // >
    if (!match) return -1;
    this.handlePi(rawdata.slice(i + 2, match.index));
    return match.index + match[0].length;
  }

  // Internal -- handle starttag, return end or -1 if not terminated.
  parseStarttag(i) {
    const endpos = this.checkForWholeStartTag(i);
    if (endpos < 0) return endpos;
    const rawdata = this.rawdata;

    // Now parse the data between i+1 and j into a tag and attrs.
    const attrs = [];
    const match = matchAt(tagfindTolerant, rawdata, i + 1);
    if (!match) throw new AssertionError("unexpected call to parse_starttag()");
    let k = match.index + match[0].length;
    const tag = match[1].toLowerCase();
    this.lasttag = tag;
    while (k < endpos) {
      const m = matchAt(attrfindTolerant, rawdata, k);
      if (!m) break;
      const attrname = m[1];
      const rest = m[2];
      let attrvalue = m[3];
      if (!rest) attrvalue = null;
      else if (
        (attrvalue.slice(0, 1) === "'" && attrvalue.slice(-1) === "'") ||
        (attrvalue.slice(0, 1) === '"' && attrvalue.slice(-1) === '"')
      ) {
        attrvalue = attrvalue.slice(1, -1);
      }
      if (attrvalue) attrvalue = unescape(attrvalue);
      attrs.push([attrname.toLowerCase(), attrvalue]);
      k = m.index + m[0].length;
    }

    const endText = rawdata.slice(k, endpos).replace(new RegExp(`^${S}+|${S}+$`, "gu"), "");
    if (endText !== ">" && endText !== "/>") {
      this.handleData(rawdata.slice(i, endpos));
      return endpos;
    }
    if (endText.endsWith("/>")) {
      // XHTML-style empty tag: <span attr="value" />
      this.handleStartendtag(tag, attrs);
    } else {
      this.handleStarttag(tag, attrs);
      if (CDATA_CONTENT_ELEMENTS.includes(tag)) this.setCdataMode(tag);
    }
    return endpos;
  }

  // Internal -- check to see if we have a complete starttag; return end or -1 if incomplete.
  checkForWholeStartTag(i) {
    const rawdata = this.rawdata;
    const m = matchAt(locatestarttagendTolerant, rawdata, i);
    if (m) {
      const j = m.index + m[0].length;
      const next = rawdata.slice(j, j + 1);
      if (next === ">") return j + 1;
      if (next === "/") {
        if (rawdata.startsWith("/>", j)) return j + 2;
        if (rawdata.startsWith("/", j)) return -1; // buffer boundary
        // else bogus input
        return j > i ? j : i + 1;
      }
      if (next === "") return -1; // end of input
      if ("abcdefghijklmnopqrstuvwxyz=/ABCDEFGHIJKLMNOPQRSTUVWXYZ".includes(next)) return -1;
      return j > i ? j : i + 1;
    }
    throw new AssertionError("we should not get here!");
  }

  // Internal -- parse endtag, return end or -1 if incomplete.
  parseEndtag(i) {
    const rawdata = this.rawdata;
    let match = searchFrom(endendtag, rawdata, i + 1); // >
    if (!match) return -1;
    let gtpos = match.index + 1;
    match = matchAt(endtagfind, rawdata, i); // </ + tag + >
    if (!match) {
      if (this.cdataElem !== null) {
        this.handleData(rawdata.slice(i, gtpos));
        return gtpos;
      }
      // find the name: w3.org/TR/html5/tokenization.html#tag-name-state
      const namematch = matchAt(tagfindTolerant, rawdata, i + 2);
      if (!namematch) {
        // w3.org/TR/html5/tokenization.html#end-tag-open-state
        if (rawdata.slice(i, i + 3) === "</>") return i + 3;
        return this.parseBogusComment(i);
      }
      const tagname = namematch[1].toLowerCase();
      // consume and ignore other stuff between the name and the >
      gtpos = rawdata.indexOf(">", namematch.index + namematch[0].length);
      this.handleEndtag(tagname);
      return gtpos + 1;
    }

    const elem = match[1].toLowerCase(); // script or style
    if (this.cdataElem !== null && elem !== this.cdataElem) {
      this.handleData(rawdata.slice(i, gtpos));
      return gtpos;
    }

    this.handleEndtag(elem);
    this.clearCdataMode();
    return gtpos;
  }

  // _markupbase.ParserBase.parse_comment
  parseComment(i, report = true) {
    const rawdata = this.rawdata;
    if (rawdata.slice(i, i + 4) !== "<!--") throw new AssertionError("unexpected call to parse_comment()");
    const match = searchFrom(commentclose, rawdata, i + 4);
    if (!match) return -1;
    if (report) this.handleComment(rawdata.slice(i + 4, match.index));
    return match.index + match[0].length;
  }

  // _markupbase.ParserBase.parse_marked_section — a CDATA section's text goes to unknownDecl.
  parseMarkedSection(i, report = true) {
    const rawdata = this.rawdata;
    const [sectName, j] = this.scanName(i + 3, i);
    if (j < 0) return j;
    let match;
    if (["temp", "cdata", "ignore", "include", "rcdata"].includes(sectName)) {
      // look for standard ]]> ending
      match = searchFrom(markedsectionclose, rawdata, i + 3);
    } else if (["if", "else", "endif"].includes(sectName)) {
      // look for MS Office ]> ending
      match = searchFrom(msmarkedsectionclose, rawdata, i + 3);
    } else {
      throw new AssertionError(`unknown status keyword ${pyReprStr(rawdata.slice(i + 3, j))} in marked section`);
    }
    if (!match) return -1;
    if (report) this.unknownDecl(rawdata.slice(i + 3, match.index));
    return match.index + match[0].length;
  }

  // _markupbase.ParserBase._scan_name — [name, end] or [null, -1] at the buffer's end.
  scanName(i, declstartpos) {
    const rawdata = this.rawdata;
    const n = rawdata.length;
    if (i === n) return [null, -1];
    const m = matchAt(declnameMatch, rawdata, i);
    if (m) {
      const s = m[0];
      const name = s.replace(new RegExp(`^${S}+|${S}+$`, "gu"), "");
      if (i + s.length === n) return [null, -1]; // end of buffer
      return [name.toLowerCase(), m.index + s.length];
    }
    throw new AssertionError(`expected name token at ${pyReprStr(rawdata.slice(declstartpos, declstartpos + 20))}`);
  }

  // Overridable -- finish processing of start+end tag: <tag.../>
  handleStartendtag(tag, attrs) {
    this.handleStarttag(tag, attrs);
    this.handleEndtag(tag);
  }

  handleStarttag(_tag, _attrs) {}
  handleEndtag(_tag) {}
  handleData(_data) {}
  handleComment(_data) {}
  handleDecl(_decl) {}
  handlePi(_data) {}
  unknownDecl(_data) {}
}

/** `repr(s)` for the parser's assertion messages. */
function pyReprStr(s) {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  return q + s.replaceAll("\\", "\\\\").replaceAll(q, `\\${q}`).replaceAll("\n", "\\n").replaceAll("\r", "\\r").replaceAll("\t", "\\t") + q;
}
