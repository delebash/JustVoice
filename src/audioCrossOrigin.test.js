// SPDX-License-Identifier: MIT
// Every <audio> and `new Audio()` in the window plays with crossorigin="anonymous" (the kit's app-structure §19,
// "The server's audio or video played in the window"): the server's resourceIsolation refuses a no-cors load the
// browser marks cross-site, and the desktop window (app://justvoice) and the dev server reach the server cross-site
// — the attribute makes the request carry the window's Origin, which passes, and it still streams with a Range.
// A blob: URL plays the same with it, so the rule is every player, not only the ones at the server's address.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "vitest";

const SRC = import.meta.dirname;

function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.(vue|js)$/.test(e.name) && !/\.test\.js$/.test(e.name) ? [p] : [];
  });
}

/** The file without its comments (an <audio> named in prose is not a player). */
function code(file) {
  return readFileSync(file, "utf8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

test("every <audio> in the window plays with crossorigin=anonymous", () => {
  const bare = [];
  for (const f of sources(SRC)) {
    // the whole tag: a quoted value may hold a `>` (`:ref="(el) => …"`)
    for (const [tag] of code(f).matchAll(/<audio\b(?:[^>"]|"[^"]*")*>/g)) {
      if (!/\bcrossorigin="anonymous"/.test(tag)) bare.push(`${relative(SRC, f)}: ${tag.slice(0, 60)}`);
    }
  }
  expect(bare).toEqual([]);
});

test("every new Audio() sets crossOrigin before its source", () => {
  const bare = [];
  for (const f of sources(SRC)) {
    const text = code(f);
    const made = text.match(/\bnew Audio\(/g)?.length ?? 0;
    const set = text.match(/\.crossOrigin = "anonymous"/g)?.length ?? 0;
    if (made > set) bare.push(`${relative(SRC, f)}: ${made} new Audio(), ${set} crossOrigin`);
  }
  expect(bare).toEqual([]);
});
