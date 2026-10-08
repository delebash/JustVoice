// SPDX-License-Identifier: MIT
// The API wave's real-render check (API agent 2, step 5): the WHOLE Python server and the WHOLE
// JavaScript server, one at a time, each on its own COPY of JustVoice's dev data root, render the
// same real lines through their HTTP routes with the real speech runtime and Kokoro — and every
// result is compared byte for byte.
//
// The copies (compare-render-lib.mjs): the database copied, the speech models through a junction
// to the real speech cache (read only), a fresh empty render cache and take folder in each; the
// JS side's `engines-runtime` is a junction to Python's source-tree runtime (the pinned release,
// JUSTVOICE_AUDIOCPP_BUILD unset). `compare-render.py prep` adds the two small books from The
// Keystone's real lines ("Parity Game": three lines, one over Kokoro's piece size; "Parity
// Audio": two chapters, mastered to ACX) and gives every persona a Kokoro seed. Warm-on-boot is
// OFF in the copies, so no LLM loads.
//
// Each server, in turn: POST /v1/blocks/{id}/render for the game book's three lines, the take
// lists (GET /v1/takes/by_block), POST /v1/generate twice (a preset voice with a seed; a persona
// with its seed and delivery), POST /v1/render_chapter for the audio book's first chapter (scene
// mode — each line's ★ take where it has one, the rest rendered, joined, mastered to ACX), then
// POST /v1/shutdown. Compared: every answer (ids and clocks aside), the generation and take rows,
// the take WAVs, the render-cache files, both Generate WAVs, the chapter WAV and its X-Master-*
// headers. Before anything it refuses to run beside the app (JustVoice's ports, any runtime);
// after each server it records graphics memory and the runtime processes left.
//
//   node scripts/node24.mjs server/scripts/compare-api-render.mjs [--keep]   (JV_PYTHON overrides)

import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { cleanup, compare, DEV_DATA, dataCopy, fingerprint, PY, python, SERVER, tempRoot } from "./compare-render-lib.mjs";

const procs = await import("@delebash/llm-runner/platform/procs");
const PY_PORT = 8792;
const JS_PORT = 8793;

async function vramMb() {
  const r = await procs.run(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader"], { timeout: 20 });
  return String(r.stdout).trim();
}
async function runtimeProcesses() {
  const r = await procs.run(["tasklist", "/FO", "CSV", "/NH"], { timeout: 30 });
  return String(r.stdout)
    .split(/\r?\n/)
    .filter((l) => /audiocpp_server|audiocpp_dsp|audio-server|llama-server/i.test(l));
}
async function listening(ports) {
  const r = await procs.run(["netstat", "-ano", "-p", "TCP"], { timeout: 30 });
  const re = new RegExp(`:(${ports.join("|")})\\s`);
  return String(r.stdout)
    .split(/\r?\n/)
    .filter((l) => re.test(l) && /LISTENING/.test(l));
}

// ── the guard: never beside the user's app ───────────────────────────────────
const busy = [...(await listening([17494, 17495, 8741, 8742, 1430, 1431, PY_PORT, JS_PORT])), ...(await runtimeProcesses())];
if (busy.length) {
  console.log(`SKIPPED — JustVoice (or a runtime) is running:\n  ${busy.join("\n  ")}`);
  process.exit(2);
}
const vram = { before: await vramMb() };
const before = Object.fromEntries(["cache", "generations", "speech-cache"].map((d) => [d, fingerprint(join(DEV_DATA, d))]));
console.log(`graphics memory before: ${vram.before}`);

const dir = tempRoot("jv-compare-api-render-");
// A failure anywhere still unlinks the junctions and removes the copies (cleanup refuses to
// delete through a link).
process.on("uncaughtException", (e) => {
  console.error(String(e?.stack || e));
  try {
    cleanup(dir);
  } finally {
    process.exit(2);
  }
});
process.on("unhandledRejection", (e) => {
  throw e;
});
const base = dataCopy(dir, "base", { links: [] });
const ids = JSON.parse((await python(["prep", base])).trim());
// Warm-on-boot OFF in the base (both copies are made from it): no LLM loads.
{
  const require = createRequire(join(SERVER, "..", "node_modules", "@delebash", "llm-runner", "package.json"));
  const Database = require("better-sqlite3");
  const db = new Database(join(base, "justvoice.db"));
  db.prepare("update runner_setting set value = '0' where key = 'warm_default_on_startup'").run();
  const n = db.prepare("select value from runner_setting where key = 'warm_default_on_startup'").get();
  db.close();
  console.log(`warm-on-boot in the copies: ${n ? n.value : "(no row — off)"}`);
}
const pyData = dataCopy(dir, "py-data", { from: base, copy: ["voices"] });
const jsData = dataCopy(dir, "js-data", { from: base, copy: ["voices"], runtime: true });

const env = { ...process.env, PYTHONIOENCODING: "utf-8" };
delete env.JUSTVOICE_AUDIOCPP_BUILD;

/** One server up (Python's or this port's) on its copy; resolves when it answers. */
async function startServer(side) {
  const [cmd, args, extra] =
    side === "py"
      ? [PY, ["-m", "justvoice.serve", "serve", "--host", "127.0.0.1", "--port", String(PY_PORT), "--data-dir", pyData], {}]
      : [
          process.execPath,
          [join(SERVER, "src", "serve.js"), "serve", "--host", "127.0.0.1", "--port", String(JS_PORT), "--data-dir", jsData],
          { ELECTRON_RUN_AS_NODE: "1" },
        ];
  const child = spawn(cmd, args, { cwd: SERVER, env: { ...env, ...extra }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const log = [];
  child.stdout.on("data", (d) => log.push(d));
  child.stderr.on("data", (d) => log.push(d));
  const port = side === "py" ? PY_PORT : JS_PORT;
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    if (child.exitCode !== null) throw new Error(`${side} exited: ${Buffer.concat(log).toString().slice(-3000)}`);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/v1/health`);
      if (r.status < 500) return { child, log, port };
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  child.kill();
  throw new Error(`${side} never came up`);
}

async function call(port, method, url, json) {
  const init = { method, headers: {} };
  if (json !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(json);
  }
  const r = await fetch(`http://127.0.0.1:${port}${url}`, init);
  const buf = Buffer.from(await r.arrayBuffer());
  const type = (r.headers.get("content-type") || "").split(";")[0];
  const headers = Object.fromEntries([...r.headers].filter(([k]) => k.startsWith("x-master")));
  return { status: r.status, type, buf, headers, json: type.includes("json") ? JSON.parse(buf.toString("utf8")) : undefined };
}

/** What one server makes of the run: the answers and the audio. */
async function runSide(side) {
  const s = await startServer(side);
  const out = { answers: {}, audio: {}, times: {} };
  try {
    const t0 = performance.now();
    for (const [i, bid] of ids.game.blocks.entries()) {
      const r = await call(s.port, "POST", `/v1/blocks/${bid}/render`, i === 2 ? { new_take: false } : undefined);
      out.answers[`render ${i}`] = { status: r.status, json: r.json };
      if (r.status !== 200) throw new Error(`${side} render ${i}: ${r.status} ${r.buf.toString().slice(0, 400)}`);
    }
    out.times.lines = Math.round((performance.now() - t0) / 100) / 10;
    for (const [i, bid] of ids.game.blocks.entries()) {
      const r = await call(s.port, "GET", `/v1/takes/by_block/${bid}`);
      out.answers[`takes ${i}`] = { status: r.status, json: r.json };
    }
    const g1 = await call(s.port, "POST", "/v1/generate", { voice: "af_heart", text: "The keystone held, and the arch held with it.", seed: 4242 });
    out.answers.generate = { status: g1.status, type: g1.type };
    out.audio.generate = g1.buf;
    const personas = (await call(s.port, "GET", "/v1/personas")).json.personas;
    const narrator = personas.find((p) => p.voice_id) || personas[0];
    const g2 = await call(s.port, "POST", "/v1/generate", {
      voice: narrator.voice_id,
      text: "Every stone in it had been cut to lean on the next.",
      persona_id: narrator.id,
      delivery: { speed: 1.1 },
    });
    out.answers.generate_persona = { status: g2.status, type: g2.type };
    out.audio.generate_persona = g2.buf;
    const t1 = performance.now();
    const ch = await call(s.port, "POST", "/v1/render_chapter", { scene_id: ids.audio.scenes[0] });
    out.times.chapter = Math.round((performance.now() - t1) / 100) / 10;
    out.answers.chapter = { status: ch.status, type: ch.type, headers: ch.headers };
    out.audio.chapter = ch.buf;
    if (ch.status !== 200) console.log(`${side} chapter: ${ch.status} ${ch.buf.toString().slice(0, 400)}`);
    out.vramLoaded = await vramMb();
  } finally {
    try {
      await call(s.port, "POST", "/v1/shutdown");
    } catch {
      /* already gone */
    }
    const code = await new Promise((r) => {
      if (s.child.exitCode !== null) return r(s.child.exitCode);
      const t = setTimeout(() => {
        s.child.kill();
        r("killed after 30 s");
      }, 30000);
      s.child.once("exit", (c) => {
        clearTimeout(t);
        r(c);
      });
    });
    out.exit = code;
  }
  await new Promise((r) => setTimeout(r, 2000));
  out.left = await runtimeProcesses();
  out.vramAfter = await vramMb();
  return out;
}

// ── Python, then this port — one at a time on the GPU ─────────────────────────
const py = await runSide("py");
console.log(`python: ${JSON.stringify(py.times)}; exit ${py.exit}; graphics memory loaded ${py.vramLoaded}, after ${py.vramAfter}; runtime processes left: ${py.left.length ? py.left.join(" | ") : "none"}`);
const js = await runSide("js");
console.log(`js: ${JSON.stringify(js.times)}; exit ${js.exit}; graphics memory loaded ${js.vramLoaded}, after ${js.vramAfter}; runtime processes left: ${js.left.length ? js.left.join(" | ") : "none"}`);

// ── compare ─────────────────────────────────────────────────────────────────────
const results = [];
const same = (what, a, b) => {
  const ok = Buffer.isBuffer(a) ? Buffer.isBuffer(b) && a.equals(b) : a === b;
  results.push([ok, what, Buffer.isBuffer(a) ? `${a.length} | ${b?.length} bytes` : ""]);
  return ok;
};

// The answers: ids and clocks aside (each side makes its own take and generation ids).
const scrub = (v) => {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      if (["id", "generation_id", "default_take_id", "created_at"].includes(k) && typeof x === "string") o[k] = "<id>";
      else if (k === "audio_url" && typeof x === "string") o[k] = x.replace(/[0-9a-f-]{36}/g, "<id>");
      else o[k] = scrub(x);
    }
    return o;
  }
  return v;
};
for (const k of Object.keys(py.answers)) {
  const d = compare(scrub(py.answers[k]), scrub(js.answers[k]));
  results.push([!d.length, `answer: ${k} (${py.answers[k].status})`, d.slice(0, 3).join("; ")]);
}
for (const k of Object.keys(py.audio)) same(`WAV: ${k}`, py.audio[k], js.audio[k]);

// The rows: each game line's generations and takes, ids aside.
const require = createRequire(join(SERVER, "..", "node_modules", "@delebash", "llm-runner", "package.json"));
const Database = require("better-sqlite3");
function rowsOf(data) {
  const db = new Database(join(data, "justvoice.db"), { readonly: true });
  const marks = ids.game.blocks.map(() => "?").join(", ");
  const cols = ["block_id", "persona_id", "profile_id", "project_id", "chapter_id", "text", "language", "engine", "model", "seed", "instruct",
    "duration_sec", "status", "ok_status", "error", "source", "effects_chain", "cache_key"];
  const gens = db.prepare(`select * from generations where block_id in (${marks}) order by block_id`).all(...ids.game.blocks);
  const genIds = new Set(gens.map((g) => g.id));
  const takes = db
    .prepare(`select * from takes where block_id in (${marks}) order by block_id`)
    .all(...ids.game.blocks)
    .map((t) => [t.block_id, t.is_default, t.label, t.source_take_id, genIds.has(t.generation_id)]);
  const wavs = Object.fromEntries(gens.map((g) => [g.block_id, readFileSync(join(data, g.audio_path))]));
  const out = { generations: gens.map((g) => Object.fromEntries(cols.map((c) => [c, g[c]]))), takes, wavs };
  db.close();
  return out;
}
const pr = rowsOf(pyData);
const jr = rowsOf(jsData);
const rowDiffs = compare({ g: pr.generations, t: pr.takes }, { g: jr.generations, t: jr.takes });
results.push([!rowDiffs.length, `generation + take rows (${pr.generations.length} generations, ${pr.takes.length} takes)`, rowDiffs.slice(0, 5).join("; ")]);
for (const [bid, wav] of Object.entries(pr.wavs)) same(`take WAV ${bid.slice(0, 8)}`, wav, jr.wavs[bid]);

// The render caches: every file, by name and bytes.
const tree = (root) => {
  const out = new Map();
  const walk = (p) => {
    if (!existsSync(p)) return;
    for (const e of readdirSync(p)) {
      const q = join(p, e);
      if (statSync(q).isDirectory()) walk(q);
      else out.set(relative(root, q).replaceAll("\\", "/"), readFileSync(q));
    }
  };
  walk(root);
  return out;
};
const pyCache = tree(join(pyData, "cache"));
const jsCache = tree(join(jsData, "cache"));
same(`render-cache file names (${pyCache.size})`, [...pyCache.keys()].sort().join("\n"), [...jsCache.keys()].sort().join("\n"));
let cacheBytes = true;
for (const [k, v] of pyCache) if (!jsCache.get(k)?.equals(v)) cacheBytes = false;
results.push([cacheBytes, `render-cache file bytes (${pyCache.size} files)`, ""]);

for (const [ok, what, note] of results) console.log(`  ${ok ? "same" : "DIFF"}  ${what}${note ? `  (${note})` : ""}`);
const bad = results.filter(([ok]) => !ok).length;
console.log(bad ? `${bad} difference(s) of ${results.length}` : `0 differences in ${results.length} comparisons`);

const after = Object.fromEntries(["cache", "generations", "speech-cache"].map((d) => [d, fingerprint(join(DEV_DATA, d))]));
console.log(`real cache / generations / speech-cache unchanged: ${JSON.stringify(before) === JSON.stringify(after)}`);
console.log(`graphics memory before ${vram.before}, after ${await vramMb()}; runtime processes left: ${(await runtimeProcesses()).length}`);
if (process.argv.includes("--keep")) console.log(`kept ${dir}`);
else cleanup(dir);
process.exit(bad ? 1 : 0);
