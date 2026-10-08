// SPDX-License-Identifier: MIT
// Python's text semantics the extraction and import ports need beyond the kit's platform/py.js
// (every export here is a candidate for platform/): `json.loads` / `JSONDecoder.raw_decode`
// with CPython's C scanner's rules and error words, `bytes.decode("utf-8"[-sig])` with its
// UnicodeDecodeError words, `str.splitlines`, `str(x)` / `float(x)` / `int(x)` of parsed JSON,
// `str.title` / `isupper` / `capitalize`, code-point lengths and slices (`len(s)` counts code
// points where JavaScript counts UTF-16 units), and `re.escape`'s lengths.
//
// A parsed JSON float is a PyFloat (platform/pyjson), so `str(2.0)` is "2.0" as in Python —
// an LLM answering `{"id": 2.0}` must not read as line 2 (pipeline.align_picks).

import { PY_WS, strip, ValueError } from "@delebash/llm-runner/platform/py";
import { PyFloat, pyFloat } from "@delebash/llm-runner/platform/pyjson";

/** Python's `$` without MULTILINE: the end, or just before a newline that ends the string. */
export const END = "(?=\\n?$)";

export class OverflowError extends Error {
  constructor(m) {
    super(m);
    this.name = "OverflowError";
  }
}

export class AssertionError extends Error {
  constructor(m) {
    super(m);
    this.name = "AssertionError";
  }
}

// ── code points ───────────────────────────────────────────────────────────────

const SURROGATE = /[\uD800-\uDFFF]/;

/** `len(s)` — code points. */
export function cpLen(s) {
  if (!SURROGATE.test(s)) return s.length;
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** `s[a:b]` with code-point indexes (non-negative, b may be omitted). */
export function cpSlice(s, a, b) {
  if (!SURROGATE.test(s)) return s.slice(a, b);
  const cps = Array.from(s);
  return cps.slice(a, b).join("");
}

/** The code-point index of UTF-16 index `i` in `s` (what Python reports as a position). */
export function cpIndex(s, i) {
  if (!SURROGATE.test(s)) return i;
  return cpLen(s.slice(0, i));
}

// ── str.splitlines() ─────────────────────────────────────────────────────────

// \r\n, \n, \r, \v, \f, \x1c-\x1e, \x85 and the line and paragraph separators — those two built
// from char codes (one written into source would end a regex literal).
const LINE_BREAK = new RegExp(`\\r\\n|[\\n\\r\\v\\f\\x1c\\x1d\\x1e\\x85${String.fromCharCode(0x2028, 0x2029)}]`);

/** `str.splitlines()` — every line boundary Python knows, no trailing empty line. */
export function splitlines(s) {
  if (!s) return [];
  const parts = s.split(LINE_BREAK);
  if (parts[parts.length - 1] === "") parts.pop();
  return parts;
}

// ── str(x), float(x), int(x) of a parsed value ─────────────────────────────────

/** `isinstance(v, dict)` for a parsed JSON value. */
export const isDict = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof PyFloat);

/** `isinstance(v, (int, float))` — a bool is an int in Python. */
export const isNumber = (v) => typeof v === "number" || typeof v === "boolean" || v instanceof PyFloat;

function intText(v) {
  if (Number.isSafeInteger(v)) return String(v);
  if (Number.isInteger(v)) return BigInt(v).toString();
  return pyFloat(v);
}

/** `repr(s)` of a str. */
export function strRepr(s) {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = q;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === "\\") out += "\\\\";
    else if (ch === q) out += `\\${q}`;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (c < 0x20 || (c >= 0x7f && c < 0xa0)) out += `\\x${c.toString(16).padStart(2, "0")}`;
    else out += ch;
  }
  return out + q;
}

/** `repr(v)` of a parsed JSON value. */
export function pyRepr(v) {
  return typeof v === "string" ? strRepr(v) : pyStrOf(v);
}

/** `str(v)` of a parsed JSON value (None, bool, int, float, str, list, dict). */
export function pyStrOf(v) {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (v instanceof PyFloat) return floatText(v.v);
  if (typeof v === "number") return Number.isFinite(v) ? intText(v) : floatText(v);
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(", ")}]`;
  if (typeof v === "object") return `{${Object.entries(v).map(([k, x]) => `${strRepr(k)}: ${pyRepr(x)}`).join(", ")}}`;
  return String(v);
}

function floatText(x) {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  return pyFloat(x);
}

let ndZeros = null;
/** The value of one Unicode decimal digit (`\p{Nd}`), as `int()` reads it. */
export function digitValue(ch) {
  const c = ch.codePointAt(0);
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (ndZeros === null) {
    // Nd runs are whole decimal blocks: each run starts on a zero (Unicode's stability rule).
    ndZeros = [];
    const nd = /\p{Nd}/u;
    let runStart = -1;
    for (let cp = 0x80; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      if (nd.test(String.fromCodePoint(cp))) {
        if (runStart < 0) runStart = cp;
      } else if (runStart >= 0) {
        ndZeros.push([runStart, cp - 1]);
        runStart = -1;
      }
    }
  }
  for (const [a, b] of ndZeros) if (c >= a && c <= b) return (c - a) % 10;
  return -1;
}

/** A run of `\p{Nd}` digits as the integer Python's `int()` reads. */
export function digitsToInt(s) {
  let n = 0;
  for (const ch of s) n = n * 10 + digitValue(ch);
  return n;
}

/** Every `\p{Nd}` digit as its ASCII digit (`float()` and `int()` read them all). */
const asAsciiDigits = (s) => s.replace(/\p{Nd}/gu, (ch) => String(digitValue(ch)));

const FLOAT_TEXT = /^[-+]?(?:(?:\d(?:_?\d)*)(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][-+]?\d(?:_?\d)*)?$/;

/** `float(v)` — TypeError for None, a list or a dict; ValueError for a string it can't read. */
export function pyFloatOf(v) {
  if (v instanceof PyFloat) return v.v;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const t = asAsciiDigits(strip(v));
    const low = t.toLowerCase();
    if (/^[-+]?(?:inf|infinity)$/.test(low)) return low.startsWith("-") ? -Infinity : Infinity;
    if (/^[-+]?nan$/.test(low)) return Number.NaN;
    if (!FLOAT_TEXT.test(t)) throw new ValueError(`could not convert string to float: ${strRepr(v)}`);
    return Number(t.replace(/_/g, ""));
  }
  const name = v === null || v === undefined ? "NoneType" : Array.isArray(v) ? "list" : "dict";
  throw new TypeError(`float() argument must be a string or a real number, not '${name}'`);
}

/** `int(s)` of a str: Python whitespace around, a sign, any decimal digits (with single
 * underscores between them); anything else is a ValueError. */
export function pyIntOfStr(s) {
  const t = asAsciiDigits(strip(s));
  if (!/^[-+]?\d(?:_?\d)*$/.test(t)) throw new ValueError(`invalid literal for int() with base 10: ${strRepr(s)}`);
  return Number(t.replace(/_/g, ""));
}

/** `int(v)` of a number (a parsed int, float or bool): truncated; NaN and infinities raise. */
export function pyIntOfNumber(v) {
  if (typeof v === "boolean") return v ? 1 : 0;
  const x = v instanceof PyFloat ? v.v : v;
  if (Number.isNaN(x)) throw new ValueError("cannot convert float NaN to integer");
  if (!Number.isFinite(x)) throw new OverflowError("cannot convert float infinity to integer");
  return Math.trunc(x);
}

/** `format(x, f".{d}f")` — correctly rounded with ties to even, as Python formats a float
 * (JavaScript's toFixed breaks an exact tie upward: 0.125 → "0.13", Python "0.12"). */
export function pyFixed(x, d) {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? "nan" : x > 0 ? "inf" : "-inf";
  // From 1e21 toFixed answers in exponent form; such a double is a whole number.
  if (Math.abs(x) >= 1e21) return `${BigInt(x)}${d ? `.${"0".repeat(d)}` : ""}`;
  const wide = Math.abs(x).toFixed(Math.min(100, d + 30));
  const cut = wide.indexOf(".") + 1 + d; // where the kept digits end
  const rest = wide.slice(cut);
  let out = Math.abs(x).toFixed(d);
  if (/^50*$/.test(rest)) {
    // An exact tie: keep the even last digit.
    const kept = d ? wide.slice(0, cut) : wide.slice(0, cut - 1);
    const last = Number(kept[kept.length - 1]);
    if (last % 2 === 0) out = kept;
  }
  return x < 0 || Object.is(x, -0) ? `-${out}` : out;
}

// ── str.title(), str.isupper(), str.capitalize() ────────────────────────────

const CASED = /[\p{Lowercase}\p{Uppercase}\p{Lt}]/u;
const CASE_IGNORABLE = /\p{Case_Ignorable}/u;

// Unicode's titlecase where it is not the uppercase: the four digraph letters, the
// special-cased ligatures and ß, and Georgian Mkhedruli (titlecase = itself).
const TITLE = new Map([
  ..."ǄǅǆǇǈǉǊǋǌǱǲǳ".split("").map((c, i) => [c, "ǅǅǅǈǈǈǋǋǋǲǲǲ"[i]]),
  ["ß", "Ss"],
  ["ﬀ", "Ff"],
  ["ﬁ", "Fi"],
  ["ﬂ", "Fl"],
  ["ﬃ", "Ffi"],
  ["ﬄ", "Ffl"],
  ["ﬅ", "St"],
  ["ﬆ", "St"],
  ["և", "Եւ"],
  ["ﬓ", "Մն"],
  ["ﬔ", "Մե"],
  ["ﬕ", "Մի"],
  ["ﬖ", "Վն"],
  ["ﬗ", "Մխ"],
]);
const titleOf = (ch) => {
  const c = ch.codePointAt(0);
  if ((c >= 0x10d0 && c <= 0x10fa) || (c >= 0x10fd && c <= 0x10ff)) return ch;
  return TITLE.get(ch) ?? ch.toUpperCase();
};

/** The lower case of the character at `i` of `cps` — Σ by Unicode's Final_Sigma rule (ς at a
 * word's end, after a cased letter), as CPython's lower() reads it in context. */
function lowerAt(cps, i) {
  const ch = cps[i];
  if (ch !== "Σ") return ch.toLowerCase();
  let j = i - 1;
  while (j >= 0 && CASE_IGNORABLE.test(cps[j])) j--;
  const before = j >= 0 && CASED.test(cps[j]);
  let k = i + 1;
  while (k < cps.length && CASE_IGNORABLE.test(cps[k])) k++;
  const after = k < cps.length && CASED.test(cps[k]);
  return before && !after ? "ς" : "σ";
}

/** `str.title()`: a cased character after another cased one goes lower, any other to its
 * titlecase. */
export function pyTitle(s) {
  const cps = Array.from(s);
  let out = "";
  let prevCased = false;
  cps.forEach((ch, i) => {
    out += prevCased ? lowerAt(cps, i) : titleOf(ch);
    prevCased = CASED.test(ch);
  });
  return out;
}

/** `str.isupper()`: at least one cased character, and none lower or title case. */
export const pyIsUpper = (s) => !/[\p{Lowercase}\p{Lt}]/u.test(s) && /\p{Uppercase}/u.test(s);

/** `str.capitalize()`: the first character to its titlecase, the rest lower. */
export function pyCapitalize(s) {
  const cps = Array.from(s);
  if (!cps.length) return "";
  return titleOf(cps[0]) + cps.slice(1).map((_, k) => lowerAt(cps, k + 1)).join("");
}

// ── re.escape ────────────────────────────────────────────────────────────────

const PY_SPECIAL = new Set(Array.from("()[]{}?*+-|^$\\.&~# \t\n\r\v\f"));

/** `len(re.escape(s))` — Python escapes more than a `u`-flag JavaScript pattern allows
 * (a space, `-`, `#`, `&`, `~`), and names are sorted by their escaped length. */
export function pyEscapedLen(s) {
  let n = 0;
  for (const ch of s) n += PY_SPECIAL.has(ch) ? 2 : 1;
  return n;
}

/** A literal for a `u`-flag pattern. */
export const reEscape = (s) => s.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");

// ── bytes.decode("utf-8") ────────────────────────────────────────────────────

export class UnicodeDecodeError extends ValueError {
  constructor(encoding, buf, start, end, reason) {
    const what =
      end === start + 1
        ? `can't decode byte 0x${buf[start].toString(16).padStart(2, "0")} in position ${start}`
        : `can't decode bytes in position ${start}-${end - 1}`;
    super(`'${encoding}' codec ${what}: ${reason}`);
    this.name = "UnicodeDecodeError";
  }
}

const isCont = (b) => b >= 0x80 && b <= 0xbf;

/** The first error CPython's UTF-8 decoder reports in `buf`: [start, end, reason] or null. */
function utf8Error(buf) {
  const n = buf.length;
  let i = 0;
  while (i < n) {
    const ch = buf[i];
    if (ch < 0x80) {
      i++;
      continue;
    }
    const left = n - i;
    let bad = 0; // 1 invalid start, 2..4 invalid continuation (CPython's codes), -1 end of data
    let size = 0;
    if (ch < 0xc2) bad = 1;
    else if (ch < 0xe0) {
      if (left < 2) bad = -1;
      else if (!isCont(buf[i + 1])) bad = 2;
      else size = 2;
    } else if (ch < 0xf0) {
      const c2 = buf[i + 1];
      if (left < 3) {
        if (left < 2) bad = -1;
        else if (!isCont(c2) || (c2 < 0xa0 ? ch === 0xe0 : ch === 0xed)) bad = 2;
        else bad = -1;
      } else if (!isCont(c2) || (ch === 0xe0 && c2 < 0xa0) || (ch === 0xed && c2 >= 0xa0)) bad = 2;
      else if (!isCont(buf[i + 2])) bad = 3;
      else size = 3;
    } else if (ch < 0xf5) {
      const c2 = buf[i + 1];
      if (left < 4) {
        if (left < 2) bad = -1;
        else if (!isCont(c2) || (c2 < 0x90 ? ch === 0xf0 : ch === 0xf4)) bad = 2;
        else if (left < 3) bad = -1;
        else if (!isCont(buf[i + 2])) bad = 3;
        else bad = -1;
      } else if (!isCont(c2) || (ch === 0xf0 && c2 < 0x90) || (ch === 0xf4 && c2 >= 0x90)) bad = 2;
      else if (!isCont(buf[i + 2])) bad = 3;
      else if (!isCont(buf[i + 3])) bad = 4;
      else size = 4;
    } else bad = 1;
    if (bad === 0) {
      i += size;
      continue;
    }
    if (bad === -1) return [i, n, "unexpected end of data"];
    if (bad === 1) return [i, i + 1, "invalid start byte"];
    return [i, i + bad - 1, "invalid continuation byte"];
  }
  return null;
}

const STRICT = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const REPLACE = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });

/**
 * `buf.decode("utf-8")` (`sig`: "utf-8-sig", one leading BOM dropped; `replace`:
 * errors="replace"). A strict decode that fails throws UnicodeDecodeError in Python's words —
 * positions after the BOM under utf-8-sig, as CPython reports them.
 */
export function decodeUtf8(buf, { sig = false, replace = false } = {}) {
  let b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (sig && b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  if (replace) return REPLACE.decode(b);
  const err = utf8Error(b);
  if (err) throw new UnicodeDecodeError("utf-8", b, ...err);
  return STRICT.decode(b);
}

// ── json.loads / JSONDecoder.raw_decode ──────────────────────────────────────

export class JSONDecodeError extends ValueError {
  /** `pos` is a UTF-16 index into `doc`; the message counts code points, as Python does. */
  constructor(msg, doc, pos) {
    const cp = cpIndex(doc, pos);
    const before = doc.slice(0, pos);
    const lineno = before.split("\n").length;
    const nl = before.lastIndexOf("\n");
    const colno = nl < 0 ? cp + 1 : cp - cpIndex(doc, nl);
    super(`${msg}: line ${lineno} column ${colno} (char ${cp})`);
    this.name = "JSONDecodeError";
    this.msg = msg;
    this.pos = cp;
    this.lineno = lineno;
    this.colno = colno;
  }
}

class StopScan {
  constructor(pos) {
    this.pos = pos;
  }
}

const JSON_WS = (c) => c === " " || c === "\t" || c === "\n" || c === "\r";
const NUMBER = /-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?/y;

function skipWs(s, i) {
  while (i < s.length && JSON_WS(s[i])) i++;
  return i;
}

function scanString(s, start) {
  // start = the index after the opening quote (CPython's c_scanstring, strict).
  const begin = start - 1;
  let out = "";
  let i = start;
  for (;;) {
    let j = i;
    while (j < s.length) {
      const c = s.charCodeAt(j);
      if (c === 0x22 || c === 0x5c || c <= 0x1f) break;
      j++;
    }
    if (j >= s.length) throw new JSONDecodeError("Unterminated string starting at", s, begin);
    out += s.slice(i, j);
    const t = s[j];
    if (t === '"') return [out, j + 1];
    if (t !== "\\") throw new JSONDecodeError("Invalid control character at", s, j);
    const esc = s[j + 1];
    if (esc === undefined) throw new JSONDecodeError("Unterminated string starting at", s, begin);
    if (esc !== "u") {
      const map = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
      if (!(esc in map)) throw new JSONDecodeError("Invalid \\escape", s, j);
      out += map[esc];
      i = j + 2;
      continue;
    }
    const hex = s.slice(j + 2, j + 6);
    if (j + 6 >= s.length || !/^[0-9A-Fa-f]{4}$/.test(hex)) throw new JSONDecodeError("Invalid \\uXXXX escape", s, j + 1);
    // A surrogate pair is two units in JavaScript either way: each escape decodes on its own.
    out += String.fromCharCode(Number.parseInt(hex, 16));
    i = j + 6;
  }
}

function scanOnce(s, idx) {
  if (idx >= s.length) throw new StopScan(idx);
  const c = s[idx];
  if (c === '"') return scanString(s, idx + 1);
  if (c === "{") return parseObject(s, idx + 1);
  if (c === "[") return parseArray(s, idx + 1);
  if (c === "n" && s.startsWith("null", idx)) return [null, idx + 4];
  if (c === "t" && s.startsWith("true", idx)) return [true, idx + 4];
  if (c === "f" && s.startsWith("false", idx)) return [false, idx + 5];
  if (c === "N" && s.startsWith("NaN", idx)) return [new PyFloat(Number.NaN), idx + 3];
  if (c === "I" && s.startsWith("Infinity", idx)) return [new PyFloat(Infinity), idx + 8];
  if (c === "-" && s.startsWith("-Infinity", idx)) return [new PyFloat(-Infinity), idx + 9];
  NUMBER.lastIndex = idx;
  const m = NUMBER.exec(s);
  if (!m) throw new StopScan(idx);
  const text = m[0];
  const end = idx + text.length;
  return m[1] !== undefined || m[2] !== undefined ? [new PyFloat(Number(text)), end] : [Number(text), end];
}

function parseObject(s, idx) {
  const out = {};
  idx = skipWs(s, idx);
  if (idx < s.length && s[idx] === "}") return [out, idx + 1];
  for (;;) {
    if (idx >= s.length || s[idx] !== '"') {
      throw new JSONDecodeError("Expecting property name enclosed in double quotes", s, idx);
    }
    const [key, afterKey] = scanString(s, idx + 1);
    idx = skipWs(s, afterKey);
    if (idx >= s.length || s[idx] !== ":") throw new JSONDecodeError("Expecting ':' delimiter", s, idx);
    idx = skipWs(s, idx + 1);
    const [value, afterValue] = scanOnce(s, idx);
    out[key] = value;
    idx = skipWs(s, afterValue);
    if (idx < s.length && s[idx] === "}") return [out, idx + 1];
    if (idx >= s.length || s[idx] !== ",") throw new JSONDecodeError("Expecting ',' delimiter", s, idx);
    idx = skipWs(s, idx + 1);
  }
}

function parseArray(s, idx) {
  const out = [];
  idx = skipWs(s, idx);
  if (idx < s.length && s[idx] === "]") return [out, idx + 1];
  for (;;) {
    const [value, after] = scanOnce(s, idx);
    out.push(value);
    idx = skipWs(s, after);
    if (idx < s.length && s[idx] === "]") return [out, idx + 1];
    if (idx >= s.length || s[idx] !== ",") throw new JSONDecodeError("Expecting ',' delimiter", s, idx);
    idx = skipWs(s, idx + 1);
  }
}

/** `json.JSONDecoder().raw_decode(s, idx)` → [value, end] (UTF-16 indexes). */
export function jsonRawDecode(s, idx = 0) {
  try {
    return scanOnce(s, idx);
  } catch (e) {
    if (e instanceof StopScan) throw new JSONDecodeError("Expecting value", s, e.pos);
    throw e;
  }
}

/** `json.loads(s)` for a str: Python's values (a float literal is a PyFloat; NaN and the
 * infinities are read) and Python's JSONDecodeError words and positions. */
export function jsonLoads(s) {
  if (s.startsWith("﻿")) throw new JSONDecodeError("Unexpected UTF-8 BOM (decode using utf-8-sig)", s, 0);
  const [value, end] = jsonRawDecode(s, skipWs(s, 0));
  const tail = skipWs(s, end);
  if (tail !== s.length) throw new JSONDecodeError("Extra data", s, tail);
  return value;
}

/** Python's whitespace class for building patterns (`\s` on str). */
export const WS = `[${PY_WS}]`;
