// SPDX-License-Identifier: MIT
// The py_compat parity check (wave D of step 5): the Python semantics the extraction and import
// ports are built on — json.loads and its error words, bytes.decode("utf-8"[-sig]) and its
// UnicodeDecodeError words, the csv reader, str.splitlines / title / isupper / capitalize,
// float(), format(x, "g") and ".1f", html.unescape, re.escape's lengths — answered by CPython
// (compare-pycompat.py) and by this port over thousands of generated cases (a fixed seed, so a
// run repeats), compared answer for answer.
//
//   node scripts/node24.js server/scripts/compare-pycompat.js      (JV_PYTHON overrides)

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, compare, HERE, PY, SERVER, tempRoot } from "./compare-render-lib.js";

const dir = tempRoot("jv-compare-pycompat-");
let exitCode = 0;

// A small seeded generator (mulberry32), so the cases are the same every run.
let seed = 20261008;
const rand = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const gen = (alphabet, maxLen) => Array.from({ length: Math.floor(rand() * (maxLen + 1)) }, () => pick(alphabet)).join("");

try {
  // ── the cases ──
  const JSON_SEEDS = [
    '{"a": 1, "b": [1.0, 2.5e3, -0.0, 1e-7], "c": "x\\u00e9\\ud83d\\ude00", "d": null, "e": true}',
    '[{"id": "D0", "speaker": "a", "confidence": 0.9}, {"id": 2.0}]',
    '{"name": "Tom", "approx_lines": 11, "nested": {"k": [[], {}]}}',
    "  [1, 2, 3]  ",
    '"just a string"',
    "NaN",
    "[Infinity, -Infinity, NaN]",
  ];
  const json = [
    ...JSON_SEEDS,
    "",
    " ",
    "[",
    "]",
    "{",
    "{}",
    "[,]",
    "[1,]",
    '{"a":1,}',
    '{"a" 1}',
    '{"a":}',
    "{1: 2}",
    '"unterminated',
    '"bad \\x escape"',
    '"bad \\u12 escape"',
    '"bad \\u12"',
    '"ctrl \u0001 char"',
    "01",
    "1.",
    "1e",
    "-",
    "-Infinityx",
    "tru",
    "nul",
    "[1 2]",
    "[1] x",
    "﻿[1]",
    '{"a":1}{"b":2}',
    '"\\',
    "[1,\n2,\n\n x]",
    '{"😀": "😀", "x": [1, "😀", ]}',
  ];
  const CH = ['{', '}', '[', ']', ',', ':', '"', "1", "0", ".", "e", "-", " ", "\n", "a", "\\", "u", "n", "t", "N", "😀", "é"];
  for (let i = 0; i < 1500; i++) {
    const base = pick(JSON_SEEDS);
    const at = Math.floor(rand() * (base.length + 1));
    const op = rand();
    json.push(op < 0.33 ? base.slice(0, at) + base.slice(at + 1) : op < 0.66 ? base.slice(0, at) + pick(CH) + base.slice(at) : gen(CH, 12));
  }
  const utf8 = [];
  const BYTES = [0x00, 0x41, 0x7f, 0x80, 0x9f, 0xa0, 0xbf, 0xc0, 0xc1, 0xc2, 0xdf, 0xe0, 0xe1, 0xed, 0xef, 0xf0, 0xf4, 0xf5, 0xff, 0xbb, 0xbf, 0x90, 0x8f];
  for (let i = 0; i < 2000; i++) utf8.push(Buffer.from(Array.from({ length: Math.floor(rand() * 8) }, () => pick(BYTES))).toString("hex"));
  utf8.push("efbbbf41", "efbbbfff", "efbbbf", "efbb", "e282ac", "f09f9880", "eda080", "f4908080", "c0af", "e080af");
  const csv = ["a,b\nc,d\n", 'a,"b\nc",d\n', 'x,"un""q"\n', "a,b\r\nc\r\n", "\n\n", "a\rb\n", 'a,"never', '"a"b,c\n', "a,,b,\n", ",\n", "﻿h,t\n1,2", "a,b"];
  for (let i = 0; i < 1500; i++) csv.push(gen(["a", ",", '"', "\n", "\r", "x", " ", "\r\n", "😀"], 14));
  const str = ["hello world", "o'neil mcdonald", "ALL CAPS", "Mixed Case", "ǆemal", "ß", "123", "", "a\nb\r\nc\rd\u000be\u000cf\u001cg\u001dh\u001ei\u0085j k l\n", "x\n\n", "\n", "İstanbul", "ǅ", "ΣΑΣ", "aBc dEf", "ﬁne", "ⅷ", "ǈ"];
  for (let i = 0; i < 600; i++) str.push(gen(["a", "B", " ", "'", "-", "\n", "\r", "é", "Ä", "1", "_", "ß", "ǅ", " ", "\u0085", "Σ"], 10));
  const float = ["1", "1.5", " 2 ", "1e3", "1E-3", "-0", "+.5", "5.", ".", "e3", "1_000", "1__0", "_1", "1_", "inf", "-Infinity", "nan", "NaN", "INF", "١٢", "1.2.3", "", "0x10", "1e", " 1 ", "1 2"];
  for (let i = 0; i < 400; i++) float.push(gen(["1", "0", ".", "e", "-", "+", "_", " ", "i", "n", "f", "a"], 6));
  const num = [0, -0, 1, 0.5, 14, 14.5, 0.0001, 0.00001, 123456, 1234567, 1e16, 1e-7, 2.675, 0.125, 0.25, 0.35, 1.05, 31.25, 62.5, 99.95, -2.5, 1 / 3, 2 / 3, 1e21, 123456789.123, 0.1, 100, 999999.5, 9999995];
  for (let i = 0; i < 400; i++) num.push(Number((rand() * 10 ** Math.floor(rand() * 9 - 4)).toPrecision(1 + Math.floor(rand() * 8))));
  const unescape = ["&amp;", "&amp", "&ampx", "&notin", "&notit;", "&#65;", "&#x41", "&#0;", "&#128;", "&#xD800;", "&#x110000;", "&#9999999999;", "&nbsp&nbsp;", "&unknown;", "& amp;", "&#;", "&#x;", "a&b", "&lt;&gt;&quot;&apos;", "&Aacute&aacute", "&ThickSpace;"];
  for (let i = 0; i < 300; i++) unescape.push(gen(["&", "#", "x", "a", "m", "p", ";", "1", "2", "l", "t", "n", "o", "i"], 10));
  const escape = ["Mary Anne", "a-b", "x.y", "#tag", "a&b", "~", "plain", "é ü", "(x)"];
  // Numbers travel as their shortest text (JSON would turn -0 into 0).
  const cases = { json, utf8, csv, str, float, num: num.map((x) => (Object.is(x, -0) ? "-0.0" : String(x))), unescape, escape };
  const casesPath = join(dir, "cases.json");
  writeFileSync(casesPath, JSON.stringify(cases));

  // ── Python ──
  const procs = await import("@delebash/llm-runner/platform/procs");
  const outPath = join(dir, "py.json");
  const r = await procs.run([PY, join(HERE, "compare-pycompat.py"), casesPath, outPath], { cwd: SERVER, env: { ...process.env, PYTHONIOENCODING: "utf-8" }, timeout: 600 });
  if (r.returncode !== 0) throw new Error(`compare-pycompat.py failed:\n${r.stderr}`);
  const py = JSON.parse(readFileSync(outPath, "utf8"));

  // ── this port ──
  const pc = await import("../src/py_compat.js");
  const { csvReader } = await import("../src/imports/adapters/csv_lines.js");
  const { unescape: unesc } = await import("../src/imports/adapters/html_parser.js");
  const { formatG } = await import("../src/extraction/pipeline.js");
  const { PyFloat, pyFloat } = await import("@delebash/llm-runner/platform/pyjson");
  const typeName = (e) => (e?.name === "Error" && e instanceof pc.AssertionError ? "AssertionError" : e?.name || "Error");
  const attempt = (fn) => {
    try {
      return { ok: fn() };
    } catch (e) {
      return { err: `${typeName(e)}: ${e?.message ?? e}` };
    }
  };
  const mark = (v) => {
    if (v instanceof PyFloat) return { $float: Number.isFinite(v.v) ? pyFloat(v.v) : Number.isNaN(v.v) ? "nan" : v.v > 0 ? "inf" : "-inf" };
    if (Array.isArray(v)) return v.map(mark);
    if (v !== null && typeof v === "object") return { $dict: Object.entries(v).map(([k, x]) => [k, mark(x)]) };
    return v;
  };
  const js = {
    json: json.map((s) => attempt(() => mark(pc.jsonLoads(s)))),
    utf8: utf8.map((b) => ({
      strict: attempt(() => pc.decodeUtf8(Buffer.from(b, "hex"))),
      sig: attempt(() => pc.decodeUtf8(Buffer.from(b, "hex"), { sig: true })),
      replace: pc.decodeUtf8(Buffer.from(b, "hex"), { replace: true }),
    })),
    csv: csv.map((t) => attempt(() => [...csvReader(t)])),
    str: str.map((s) => ({ splitlines: pc.splitlines(s), title: pc.pyTitle(s), isupper: pc.pyIsUpper(s), capitalize: pc.pyCapitalize(s) })),
    float: float.map((s) => attempt(() => {
      const x = pc.pyFloatOf(s);
      return Number.isNaN(x) ? "nan" : !Number.isFinite(x) ? (x > 0 ? "inf" : "-inf") : pyFloat(x);
    })),
    fmt: cases.num.map((t) => ({ g: formatG(Number(t)), f1: pc.pyFixed(Number(t), 1) })),
    unescape: unescape.map(unesc),
    escape: escape.map(pc.pyEscapedLen),
  };

  // Error type names: Python's csv.Error is "Error"; its UnicodeDecodeError / JSONDecodeError /
  // ValueError match by name.
  let total = 0;
  let diffs = 0;
  for (const [k, input] of [["json", "json"], ["utf8", "utf8"], ["csv", "csv"], ["str", "str"], ["float", "float"], ["fmt", "num"], ["unescape", "unescape"], ["escape", "escape"]]) {
    let d = 0;
    py[k].forEach((p, i) => {
      total += 1;
      const ds = compare(p, js[k][i]);
      if (ds.length) {
        d += 1;
        if (d <= 5) console.log(`  DIFF ${k} #${i} ${JSON.stringify(cases[input][i]).slice(0, 80)}: ${ds[0].slice(0, 300)}`);
      }
    });
    diffs += d;
    console.log(`${k}: ${py[k].length} cases, ${d} different`);
  }
  console.log(diffs ? `FAILED: ${diffs} of ${total} different` : `identical (${total} cases)`);
  if (diffs) exitCode = 1;
} finally {
  cleanup(dir);
}
process.exitCode = exitCode;
