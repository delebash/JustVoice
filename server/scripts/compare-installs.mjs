// SPDX-License-Identifier: MIT
// eSpeak NG and the Japanese dictionary, installed by this port from the same pinned PyPI
// artifacts Python fetched (the wheel and the sdist — verified by the same sha256), compared
// file for file (relative path, size, sha256) with what Python's install left in the source
// tree's runtime folder (server/justvoice/engines/audiocpp). Downloads ~50 MB into a temp
// folder; writes nothing else.
//
//   node scripts/node24.mjs server/scripts/compare-installs.mjs

import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PY_ROOT = resolve(HERE, "..", "justvoice", "engines");
const dir = mkdtempSync(join(tmpdir(), "jv-compare-installs-"));
process.env.JUST_AI_HOME = join(dir, "family");
process.env.LLM_RUNNER_CACHE = join(dir, "user-cache");

const espeak = await import("../src/engines/audiocpp/espeak.js");
const japanese = await import("../src/engines/audiocpp/japanese.js");

function tree(root) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[relative(root, p).replaceAll("\\", "/")] = `${statSync(p).size}:${createHash("sha256").update(readFileSync(p)).digest("hex")}`;
    }
  };
  walk(root);
  return out;
}

let bad = 0;
for (const [label, install, home] of [
  ["eSpeak NG", () => espeak.install(dir), espeak.home],
  ["Japanese dictionary", () => japanese.install(dir), japanese.home],
]) {
  await install();
  const a = tree(home(PY_ROOT));
  const b = tree(home(dir));
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const diff = keys.filter((k) => a[k] !== b[k]);
  console.log(`${label}: ${Object.keys(b).length} files (python ${Object.keys(a).length}) — ${diff.length ? `${diff.length} different: ${diff.slice(0, 10).join(", ")}` : "identical"}`);
  bad += diff.length;
}
console.log(`(${dir})`);
process.exit(bad ? 1 : 0);
