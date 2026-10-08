// SPDX-License-Identifier: MIT
// Model parity check: every pydantic model in justvoice/models.py against its TypeBox twin in
// src/models.js — field order, type, constraints, required/default, extra="forbid", and the
// default values themselves (pydantic's JSON of each default vs the JS default).
//
//   node scripts/node24.mjs server/scripts/compare-models.mjs      (JV_PYTHON overrides)

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import * as procs from "@delebash/llm-runner/platform/procs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(HERE, "..");
const PY = process.env.JV_PYTHON || join(SERVER, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const M = await import("../src/models.js");

function sig(s) {
  if (!s) return "?";
  if (s.anyOf) {
    if (s.anyOf.every((b) => "const" in b)) return `lit(${s.anyOf.map((b) => JSON.stringify(b.const)).join(",")})`;
    return s.anyOf.map(sig).join("|");
  }
  if ("const" in s) return `lit(${JSON.stringify(s.const)})`;
  switch (s.type) {
    case "integer":
      return "int";
    case "number":
      return "float";
    case "string":
      return s.$comment === "datetime" ? "datetime" : "str";
    case "boolean":
      return "bool";
    case "null":
      return "null";
    case "array":
      return `list[${sig(s.items)}]`;
    case "object":
      if (s.patternProperties) return `dict[${sig(Object.values(s.patternProperties)[0])}]`;
      return objSig(s);
    default:
      return Object.keys(s).length === 0 || (!s.type && !s.anyOf) ? "any" : `?${JSON.stringify(s)}`;
  }
}
function cons(s) {
  const out = [];
  const inner = s.anyOf ? s.anyOf.find((b) => b.type !== "null") || s : s;
  for (const [k, label] of [
    ["minimum", "ge"],
    ["maximum", "le"],
    ["exclusiveMinimum", "gt"],
    ["exclusiveMaximum", "lt"],
    ["minLength", "minlen"],
    ["maxLength", "maxlen"],
  ]) {
    if (inner[k] !== undefined) out.push(`${label}=${pyRepr(inner[k], inner.type)}`);
  }
  return out.sort();
}
function pyRepr(v, type) {
  if (type === "number") return Number.isInteger(v) ? `${v}.0` : String(v);
  return String(v);
}
function objSig(s) {
  const req = new Set(s.required || []);
  const fields = Object.entries(s.properties).map(([k, f]) => {
    let t = `${k}:${sig(f)}`;
    const c = cons(f);
    if (c.length) t += `[${c.join(",")}]`;
    if (req.has(k)) t += "!";
    return t;
  });
  return `${s.additionalProperties === false ? "strict" : ""}{${fields.join(";")}}`;
}

const r = await procs.run([PY, join(HERE, "compare-models.py")], {
  cwd: SERVER,
  env: { ...process.env, PYTHONIOENCODING: "utf-8" },
});
if (r.returncode !== 0) throw new Error(r.stderr);
const py = JSON.parse(r.stdout);

let bad = 0;
let n = 0;
for (const [name, { sig: psig, defaults }] of Object.entries(py)) {
  if (name.startsWith("__")) continue;
  n++;
  const js = M[name];
  if (!js) {
    console.log(`MISSING ${name}`);
    bad++;
    continue;
  }
  const jsig = sig(js);
  if (jsig !== psig) {
    console.log(`SIG ${name}\n  py ${psig}\n  js ${jsig}`);
    bad++;
  }
  for (const [f, d] of Object.entries(defaults)) {
    const jd = js.properties[f]?.default;
    if (!isDeepStrictEqual(jd, d)) {
      console.log(`DEFAULT ${name}.${f}: py ${JSON.stringify(d)} js ${JSON.stringify(jd)}`);
      bad++;
    }
  }
}
if (!isDeepStrictEqual(py.__EMOTION_VALUES__, M.EMOTION_VALUES)) {
  console.log("EMOTION_VALUES differ");
  bad++;
}
console.log(`${n} models compared, ${bad} difference(s)`);
process.exit(bad ? 1 : 0);
