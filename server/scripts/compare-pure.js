// SPDX-License-Identifier: MIT
// Pure-function parity: JustVoice's text and key functions against the Python they port, on
// generated cases (a fixed seed) — difflib.SequenceMatcher (blocks, opcodes, all three
// ratios, autojunk on and off), word alignment, the pronunciation scan (Unicode names,
// sentence breaks, multi-word coverage), captions, inline tags, the delivery cache key
// (floats sent as Python floats), the delivery merge and the render-cache key builder.
//
//   node scripts/node24.js server/scripts/compare-pure.js      (JV_PYTHON overrides)

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import * as procs from "@delebash/llm-runner/platform/procs";
import { PyFloat, pyJson, pyJsonParse } from "@delebash/llm-runner/platform/pyjson";
import { alignKnownText } from "../src/alignment.js";
import { CacheKeyBuilder } from "../src/cache.js";
import { groupCues, toSrt, toVtt } from "../src/captions.js";
import { canonicalJson } from "../src/delivery.js";
import { composeInstruct, mergeDelivery, nestEngineKeys } from "../src/delivery_merge.js";
import { SequenceMatcher } from "../src/difflib.js";
import { parse, strip } from "../src/inline_tags.js";
import { scanNames } from "../src/pronunciation.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(HERE, "..");
const PY = process.env.JV_PYTHON || join(SERVER, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

let seed = 20261008;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const F = (v) => new PyFloat(v);

const VOCAB = ["the", "a", "Mara", "said", "Élodie", "went", "down", "to", "the", "cellar", "Zoë", "and", "ŋ", "hello", "x"];
const NAMES = ["Elara", "Brindlewood", "Élodie", "Zoë", "Ødegaard", "Mara Vance", "Mara", "Vance", "Iñigo", "Ōtani", "Wren", "I", "Al"];

const cases = { difflib: [], align: [], scan: [], captions: [], strip: [], parse: [], canonical: [], merge: [], nest: [], compose: [], cachekey: [] };

for (let i = 0; i < 120; i++) {
  const n = i < 20 ? int(195, 260) : int(0, 30);
  const a = Array.from({ length: n }, () => pick(VOCAB));
  const b = a.filter(() => rnd() > 0.2).map((w) => (rnd() < 0.15 ? pick(VOCAB) : w));
  if (rnd() < 0.3) b.push(...Array.from({ length: int(0, 5) }, () => pick(VOCAB)));
  cases.difflib.push({ a, b, autojunk: rnd() < 0.5 });
}

for (let i = 0; i < 120; i++) {
  const words = Array.from({ length: int(0, 14) }, () => pick(VOCAB) + pick(["", "", ",", ".", "!", '"', "’s"]));
  const text = words.map((w, k) => (k === 0 && rnd() < 0.3 ? `"${w}` : w)).join(pick([" ", "  ", "\n", "  "]));
  let t = 0;
  const hyp = [];
  for (const w of words) {
    if (rnd() < 0.15) continue;
    const s = t + rnd() * 0.2;
    const e = s + 0.05 + rnd() * 0.6;
    t = e;
    hyp.push({ word: rnd() < 0.1 ? pick(VOCAB) : w.replace(/[^\p{L}']/gu, "").toLowerCase(), start: Math.round(s * 1000) / 1000, end: Math.round(e * 1000) / 1000 });
  }
  if (rnd() < 0.1) hyp.push({ word: "", start: 0, end: 0 });
  cases.align.push({ text, hyp, total: rnd() < 0.5 ? null : Math.round((t + rnd()) * 100) / 100 });
}

for (let i = 0; i < 80; i++) {
  const lines = [];
  for (let k = 0; k < int(1, 5); k++) {
    const parts = [];
    for (let j = 0; j < int(1, 12); j++) {
      parts.push(rnd() < 0.35 ? pick(NAMES) : pick(VOCAB));
      if (rnd() < 0.2) parts.push(pick([".", "!", "?", "…", '."', "?”", ".)"]));
    }
    const text = parts.join(" ").replace(/ ([.!?…])/g, "$1");
    const cov = NAMES.filter(() => rnd() < 0.15).map((x) => (rnd() < 0.5 ? x.toLowerCase() : x));
    lines.push([rnd() < 0.05 ? "" : text, cov]);
  }
  cases.scan.push(lines);
}

for (let i = 0; i < 60; i++) {
  let t = rnd() * 3700;
  cases.captions.push(
    Array.from({ length: int(0, 25) }, () => {
      const s = t + (rnd() < 0.1 ? 1.5 : rnd() * 0.3);
      const e = s + rnd() * 0.7;
      t = e;
      return { word: pick(VOCAB) + (rnd() < 0.2 ? "xxxxxxxxxx" : ""), start: s, end: e };
    }),
  );
}

const TAGS = ["[laugh]", "[LAUGH]", "[sigh]", "[warm]", "[clear throat]", "[sic]", "[pause:0.5s]", "[speed:0.7]", "[/speed]", "[whisper]", "[/whisper]", "[pitch:-3]", "[a b c]", "[ŋ]", "[1x]", "[x:]", "[]", "[ trailing ]", "[Laugh hard]"];
for (let i = 0; i < 150; i++) {
  const s = Array.from({ length: int(0, 8) }, () => (rnd() < 0.5 ? pick(TAGS) : pick(VOCAB))).join(pick([" ", "", "  "]));
  const keep = rnd() < 0.3 ? null : TAGS.filter(() => rnd() < 0.2).map((x) => x.replace(/[[\]/]/g, "").split(":")[0]);
  cases.strip.push([s, keep]);
  cases.parse.push(s);
}

const val = () => pick([null, 0, 1, F(1.0), F(0.0), 0.5, -2, F(-3.0), "1", "0", "", "  ", "x", 1e-7, F(1.0000001)]);
for (let i = 0; i < 150; i++) {
  const d = {};
  for (const k of ["speed", "pitch", "pause_before", "pause_after", "gain_db", "instruct", "engine", "emotion", "tags", "seed", "temperature"]) {
    if (rnd() < 0.5) continue;
    if (k === "instruct" || k === "emotion") d[k] = pick([null, "", " ", "calm", "angry"]);
    else if (k === "engine") d[k] = pick([null, {}, { exaggeration: F(0.5), cfg: F(2.0) }]);
    else if (k === "tags") d[k] = pick([null, [], ["fear", "dramatic"]]);
    else if (k.startsWith("pause")) d[k] = pick([null, 0, 300, F(0.0)]);
    else if (k === "seed") d[k] = pick([null, 0, 42]);
    else d[k] = val();
  }
  // canonical_json raises for a number string like "x" (float("x")) — keep its inputs valid
  for (const k of ["speed", "pitch", "gain_db"]) if (d[k] === "x" || d[k] === "" || d[k] === "  ") d[k] = F(1.0);
  cases.canonical.push(d);
  const flat = () => Object.fromEntries(Object.entries({ exaggeration: 0.7, speed: F(1.0), cfg_weight: 0.3, engine: rnd() < 0.5 ? { cfg_weight: 0.9 } : null, instruct: "x" }).filter(() => rnd() < 0.6));
  cases.merge.push([rnd() < 0.2 ? null : flat(), rnd() < 0.2 ? null : flat()]);
  cases.nest.push(flat());
  cases.compose.push(Array.from({ length: int(0, 4) }, () => pick([null, "", "weary.", "angry", "shouting over wind", "Clipped. ", "a . b. ."])));
}

for (let i = 0; i < 40; i++) {
  cases.cachekey.push([pick(["kokoro", "qwen3"]), pick(["v1", "0.9.0-jv.4"]), pick(["af_heart", "voice_é"]), pick(["Hello.", "Zoë said “hi” 📚", ""]), pick([null, "", "en-US"]), pick([null, 0, 7, 123456789]), canonicalJson(pick(cases.canonical)), pick([null, "", "abc123", "noeffects"])]);
}

const dir = mkdtempSync(join(tmpdir(), "jv-compare-pure-"));
const text = pyJson(cases, { ensureAscii: false });
writeFileSync(join(dir, "in.json"), text);
const r = await procs.run([PY, join(HERE, "compare-pure.py"), join(dir, "in.json"), join(dir, "out.json")], {
  cwd: SERVER,
  env: { ...process.env, PYTHONIOENCODING: "utf-8" },
});
if (r.returncode !== 0) throw new Error(r.stderr);
const py = JSON.parse(readFileSync(join(dir, "out.json"), "utf8"));
const c = pyJsonParse(text); // the same inputs, whole-number floats as PyFloat as Python read them

const js = {
  difflib: c.difflib.map(({ a, b, autojunk }) => {
    const sm = new SequenceMatcher(null, a, b, autojunk);
    return {
      blocks: sm.getMatchingBlocks().map((m) => m.toArray()),
      opcodes: sm.getOpcodes(),
      ratio: sm.ratio(),
      quick: sm.quickRatio(),
      real_quick: sm.realQuickRatio(),
    };
  }),
  align: c.align.map((x) => alignKnownText(x.text, x.hyp, { totalDuration: x.total })),
  scan: c.scan.map((lines) => scanNames(lines.map(([t, cov]) => [t, new Set(cov)]))),
  captions: c.captions.map((w) => [toVtt(w), toSrt(w), groupCues(w)]),
  strip: c.strip.map(([t, k]) => strip(t, k === null ? null : new Set(k))),
  parse: c.parse.map((t) => parse(t).map((tok) => [tok.constructor.name, ...Object.values(tok)])),
  canonical: c.canonical.map((d) => canonicalJson(d)),
  merge: c.merge.map(([req, per]) => JSON.parse(JSON.stringify(mergeDelivery(req, per)))),
  nest: c.nest.map((d) => JSON.parse(JSON.stringify(nestEngineKeys(d)))),
  compose: c.compose.map((h) => composeInstruct(...h)),
  cachekey: c.cachekey.map((k) =>
    new CacheKeyBuilder().withEngine(k[0], k[1]).withVoice(k[2]).withText(k[3]).withLanguage(k[4]).withSeed(k[5]).withDeliveryJson(k[6]).withEffectsChain(k[7]).finish(),
  ),
};

let bad = 0;
for (const [k, list] of Object.entries(py)) {
  let diff = 0;
  list.forEach((p, i) => {
    if (!isDeepStrictEqual(p, js[k][i])) {
      diff++;
      if (diff <= 3) console.log(`  DIFF ${k}[${i}]\n    py ${JSON.stringify(p).slice(0, 400)}\n    js ${JSON.stringify(js[k][i]).slice(0, 400)}`);
    }
  });
  bad += diff;
  console.log(`${k}: ${list.length} cases, ${diff} different`);
}
process.exit(bad ? 1 : 0);
