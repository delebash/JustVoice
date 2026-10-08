// SPDX-License-Identifier: MIT
// What the render layer's parity checks share (compare-render.js, compare-render-real.js):
// the temp folder and the COPIES of JustVoice's dev data root (data — read
// only: the database and the small config files are copied; the speech cache, and where asked
// the render cache and the take audio, are reached through junctions, never written), the
// Python runner, the JSON comparison, and the cleanup — junctions unlinked first, then a check
// that no reparse point is left, then the folder removed.

import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmdirSync, rmSync, statSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const SERVER = resolve(HERE, "..");
export const REPO = resolve(SERVER, "..");
export const PY = process.env.JV_PYTHON || join(SERVER, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
export const DEV_DATA = join(REPO, "data");
export const PY_RUNTIME = join(SERVER, "justvoice", "engines");

/** A new temp folder with the family registry and the user cache inside it. */
export function tempRoot(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  process.env.JUST_AI_HOME = join(dir, "family");
  process.env.LLM_RUNNER_CACHE = join(dir, "user-cache");
  delete process.env.JUSTVOICE_AUDIOCPP_BUILD;
  return dir;
}

const junctions = [];

/** `target` reached from `link` (a Windows junction). */
export function junction(target, link) {
  symlinkSync(target, link, "junction");
  junctions.push(link);
}

/**
 * A data-root copy at `dir/name` from `from` (a data root): its database and the small config
 * files copied (`copy`: extra relative paths copied too, e.g. "voices"); `links`: relative
 * paths reached through a junction to the REAL dev data root (read only); `runtime`: the JS
 * side's `engines-runtime` junction to Python's source-tree runtime.
 */
export function dataCopy(dir, name, { from = DEV_DATA, copy = [], links = ["speech-cache"], runtime = false } = {}) {
  const d = join(dir, name);
  mkdirSync(d, { recursive: true });
  cpSync(join(from, "justvoice.db"), join(d, "justvoice.db"));
  for (const rel of ["engines-runtime-config", ...copy]) {
    if (existsSync(join(from, rel))) cpSync(join(from, rel), join(d, rel), { recursive: true });
  }
  for (const rel of links) junction(join(DEV_DATA, rel), join(d, rel));
  if (runtime) junction(PY_RUNTIME, join(d, "engines-runtime"));
  return d;
}

/** Run the Python half; throws with its stderr on a failure. */
export async function python(args, timeout = 1800) {
  const procs = await import("@delebash/llm-runner/platform/procs");
  const r = await procs.run([PY, join(HERE, "compare-render.py"), ...args], {
    cwd: SERVER,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    timeout,
  });
  if (r.returncode !== 0) throw new Error(`compare-render.py ${args[0]} failed:\n${r.stderr}`);
  return r.stdout;
}

/** A fingerprint of a real folder (files, bytes, newest change) — taken before and after, so a
 * check can say it left the folder as it was. */
export function fingerprint(root) {
  let files = 0;
  let bytes = 0;
  let newest = 0;
  const walk = (p) => {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      const q = join(p, e.name);
      if (e.isDirectory()) walk(q);
      else {
        const s = statSync(q);
        files += 1;
        bytes += s.size;
        newest = Math.max(newest, s.mtimeMs);
      }
    }
  };
  if (existsSync(root)) walk(root);
  return { files, bytes, newest };
}

/** Unlink every junction made here, check none is left anywhere in `dir`, then remove it. */
export function cleanup(dir) {
  for (const link of junctions.splice(0)) {
    try {
      rmdirSync(link); // a junction: the link goes, the target stays
    } catch {
      unlinkSync(link);
    }
  }
  const left = [];
  const walk = (p) => {
    for (const e of readdirSync(p)) {
      const q = join(p, e);
      const s = lstatSync(q);
      if (s.isSymbolicLink()) left.push(q);
      else if (s.isDirectory()) walk(q);
    }
  };
  walk(dir);
  if (left.length) throw new Error(`refusing to delete ${dir}: links left: ${left.join(", ")}`);
  rmSync(dir, { recursive: true, force: true });
}

/** `{ok}` or `{error}` — the message only (the type names differ between the languages). */
export async function attempt(fn) {
  try {
    return { ok: await fn() };
  } catch (e) {
    return { error: `${e?.name || "Error"}: ${e?.detail ?? e?.message ?? e}` };
  }
}

/** Deep-compare two parsed dumps: values (numbers by value), key order, and an `error` text by
 * its message (after the type name). Returns the differences as text. */
export function compare(a, b) {
  const diffs = [];
  const msg = (s) => (typeof s === "string" ? s.replace(/^[A-Za-z_.]+: /, "") : s);
  function walk(x, y, at) {
    if (x !== null && y !== null && typeof x === "object" && typeof y === "object") {
      if (Array.isArray(x) !== Array.isArray(y)) {
        diffs.push(`${at}: array vs object`);
        return;
      }
      const kx = Object.keys(x);
      const ky = Object.keys(y);
      if (Array.isArray(x) && kx.length !== ky.length) diffs.push(`${at}: length ${kx.length} vs ${ky.length}`);
      if (!Array.isArray(x) && kx.join("\u0001") !== ky.join("\u0001")) {
        const onlyA = kx.filter((k) => !ky.includes(k));
        const onlyB = ky.filter((k) => !kx.includes(k));
        diffs.push(`${at}: keys differ${onlyA.length ? ` (python only: ${onlyA})` : ""}${onlyB.length ? ` (js only: ${onlyB})` : ""}${!onlyA.length && !onlyB.length ? " (order)" : ""}`);
      }
      for (const k of new Set([...kx, ...ky])) {
        if (k === "error" && typeof x[k] === "string" && typeof y[k] === "string") {
          if (msg(x[k]) !== msg(y[k])) diffs.push(`${at}.error: python ${JSON.stringify(x[k])} | js ${JSON.stringify(y[k])}`);
        } else walk(x[k], y[k], `${at}.${k}`);
      }
      return;
    }
    if (x !== y) diffs.push(`${at}: python ${JSON.stringify(x)} | js ${JSON.stringify(y)}`);
  }
  walk(a, b, "$");
  return diffs;
}

/** How many leaf values a dump holds. */
export function leaves(v) {
  if (v !== null && typeof v === "object") return Object.values(v).reduce((n, x) => n + leaves(x), 0);
  return 1;
}
