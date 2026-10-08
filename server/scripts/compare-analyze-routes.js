// SPDX-License-Identifier: MIT
// The Analyze and Discover ROUTES compared (API agent 3, step 5): the WHOLE Python server and the
// WHOLE JavaScript server, each on its own COPY of JustVoice's dev data root, run Script's AI
// routes over the real book with every model call answered by a FAKE llama-server
// (fake-llama.js — the answers derived from the request only, so equal requests get equal
// answers). Nothing loads a model: the copies' engine presets run on the "LM Studio (local)"
// provider (openai-compat), pointed at the fake; warm-on-boot is OFF; the family registry and the
// user cache are a scratch folder's.
//
// Each server, in turn, with the second look turned ON (PATCH /v1/settings): for every chapter —
// POST /v1/scenes/{id}/analyze (the text it was analyzed from, so the run writes in place),
// POST …/analyze/stream on the guided route (SSE), POST …/second-look/stream (SSE), POST
// …/discover-speakers, GET …/script; then the Lab's POST /v1/extraction/analyze-text and
// /v1/extraction/discover-speakers, POST /v1/llm/smart-assign, POST /v1/projects/{id}/show-notes
// and a speaker's rewrite; then a book cut afresh — the first two chapters' texts imported as a
// JustWrite book, ＋ Add Narrator, Analyze re-cutting chapter one (resegment), its second look,
// the stream re-cutting chapter two, Analyze again in place, Discover and Script; then POST
// /v1/shutdown. The ids each side makes up (the new book, chapters, speakers, lines) are
// remembered in order and read as Python's before comparing. Compared: every request the fake received,
// byte for byte, in order; every answer (JSON by value and key order; SSE text exactly, its
// clock readings blanked); and every table both servers wrote, cell by cell (clock readings
// blanked). Refuses to run beside the app; records graphics memory and runtime processes.
//
//   node scripts/node24.js server/scripts/compare-analyze-routes.js [--keep]   (JV_PYTHON overrides)

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { cleanup, compare, dataCopy, PY, SERVER, tempRoot } from "./compare-render-lib.js";
import { fakeServer } from "./fake-llama.js";

const procs = await import("@delebash/llm-runner/platform/procs");
const PY_PORT = 8794;
const JS_PORT = 8795;
const keep = process.argv.includes("--keep");

async function vramMb() {
  const r = await procs.run(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader"], { timeout: 20 });
  return String(r.stdout).trim();
}
async function modelProcesses() {
  const r = await procs.run(["tasklist", "/FO", "CSV", "/NH"], { timeout: 30 });
  return String(r.stdout)
    .split(/\r?\n/)
    .filter((l) => /audiocpp_server|audio-server|llama-server/i.test(l));
}
async function listening(ports) {
  const r = await procs.run(["netstat", "-ano", "-p", "TCP"], { timeout: 30 });
  const re = new RegExp(`:(${ports.join("|")})\\s`);
  return String(r.stdout)
    .split(/\r?\n/)
    .filter((l) => re.test(l) && /LISTENING/.test(l));
}

// ── the guard: never beside the user's app ───────────────────────────────────
const busy = [...(await listening([17494, 17495, 8741, 1430, 1431, PY_PORT, JS_PORT])), ...(await modelProcesses())];
if (busy.length) {
  console.log(`SKIPPED — JustVoice (or a model runtime) is running:\n  ${busy.join("\n  ")}`);
  process.exit(2);
}
const vram = { before: await vramMb() };
console.log(`graphics memory before: ${vram.before}`);

const dir = tempRoot("jv-compare-analyze-routes-");
const require = createRequire(join(SERVER, "..", "node_modules", "@delebash", "llm-runner", "package.json"));
const Database = require("better-sqlite3");

const base = dataCopy(dir, "base", { links: [] });
let models;
{
  const db = new Database(join(base, "justvoice.db"));
  db.prepare("update runner_setting set value = '0' where key = 'warm_default_on_startup'").run();
  // Every engine preset runs on LM Studio's provider (openai-compat): never the bundled runner.
  db.prepare("update engine_presets set provider_id = 'lmstudio'").run();
  models = [...new Set(db.prepare("select model from engine_presets where model != ''").all().map((r) => r.model))];
  db.close();
}
const sides = { py: dataCopy(dir, "py-data", { from: base, copy: ["voices", "personas", "lexicons"], links: [] }), js: dataCopy(dir, "js-data", { from: base, copy: ["voices", "personas", "lexicons"], links: [] }) };

const env = { ...process.env, PYTHONIOENCODING: "utf-8" };
delete env.JUSTVOICE_AUDIOCPP_BUILD;

/** One server up on its copy, its LLM provider pointed at `fakePort`. */
async function startServer(side, fakePort) {
  const data = sides[side];
  const db = new Database(join(data, "justvoice.db"));
  db.prepare("update llm_providers set base_url = ? where id = 'lmstudio'").run(`http://127.0.0.1:${fakePort}/v1`);
  db.close();
  const port = side === "py" ? PY_PORT : JS_PORT;
  const [cmd, args, extra] =
    side === "py"
      ? [PY, ["-m", "justvoice.serve", "serve", "--host", "127.0.0.1", "--port", String(port), "--data-dir", data], {}]
      : [process.execPath, [join(SERVER, "src", "serve.js"), "serve", "--host", "127.0.0.1", "--port", String(port), "--data-dir", data], { ELECTRON_RUN_AS_NODE: "1" }];
  const child = spawn(cmd, args, { cwd: SERVER, env: { ...env, ...extra }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const log = [];
  child.stdout.on("data", (d) => log.push(d));
  child.stderr.on("data", (d) => log.push(d));
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
  const text = await r.text();
  const type = (r.headers.get("content-type") || "").split(";")[0];
  return { status: r.status, type, text, json: type.includes("json") ? JSON.parse(text) : undefined };
}

/** An answer as compared: clock readings blanked (a run's duration, the second look's seconds,
 * the stamps of when Analyze ran or Discover scanned). */
function clean(r) {
  const blank = (t) =>
    t
      .replace(/"duration_ms": ?\d+/g, '"duration_ms": "<ms>"')
      .replace(/"seconds": ?[\d.]+/g, '"seconds": "<s>"')
      .replace(/("(?:analyzed_at|scanned_at)": ?")[^"]+"/g, '$1<stamp>"');
  if (r.json !== undefined) return { status: r.status, type: r.type, json: JSON.parse(blank(JSON.stringify(r.json))) };
  return { status: r.status, type: r.type, text: blank(r.text) };
}

/** The run on one side: every answer, in order. */
async function runSide(side) {
  const fake = await fakeServer(models);
  const s = await startServer(side, fake.port);
  const answers = [];
  const idLists = [];
  const ask = async (label, method, url, json) => {
    const r = await call(s.port, method, url, json);
    answers.push({ label, ...clean(r) });
    return r;
  };
  try {
    await ask("second look on", "PATCH", "/v1/settings", { extraction: { second_look: true } });
    const project = (await call(s.port, "GET", "/v1/projects")).json.projects[0];
    const scenes = (await call(s.port, "GET", `/v1/projects/${project.id}/scenes`)).json;
    const speakers = (await call(s.port, "GET", `/v1/projects/${project.id}/speakers`)).json.speakers;
    for (const sc of scenes) {
      const lines = (await call(s.port, "GET", `/v1/scenes/${sc.id}/text`)).json.text;
      const text = sc.metadata.source_text || lines;
      await ask(`${sc.title}: analyze`, "POST", `/v1/scenes/${sc.id}/analyze`, { text });
      await ask(`${sc.title}: analyze streamed`, "POST", `/v1/scenes/${sc.id}/analyze/stream`, { text, route: "guided" });
      await ask(`${sc.title}: second look`, "POST", `/v1/scenes/${sc.id}/second-look/stream`);
      await ask(`${sc.title}: discover`, "POST", `/v1/scenes/${sc.id}/discover-speakers`, { text: lines });
      await ask(`${sc.title}: script`, "GET", `/v1/scenes/${sc.id}/script`);
    }
    await ask("book script", "GET", `/v1/projects/${project.id}/script`);
    const first = (await call(s.port, "GET", `/v1/scenes/${scenes[0].id}/text`)).json.text;
    const cast = speakers.map((sp) => ({ id: sp.id, name: sp.name, aliases: sp.aliases, pronouns: sp.pronouns, description: sp.description }));
    await ask("lab analyze", "POST", "/v1/extraction/analyze-text", { text: first, characters: cast, project_id: project.id, second_look: true, route: "direct" });
    await ask("lab discover", "POST", "/v1/extraction/discover-speakers", { text: first, known_characters: speakers.map((sp) => sp.name) });
    const personas = (await call(s.port, "GET", "/v1/personas")).json.personas;
    await ask("smart assign", "POST", "/v1/llm/smart-assign", {
      characters: speakers.map((sp) => ({ id: sp.id, name: sp.name, description: sp.description, pronouns: sp.pronouns, aliases: sp.aliases })),
      voices: personas.map((p) => ({ id: p.id, name: p.name, language: p.language })),
    });
    await ask("show notes", "POST", `/v1/projects/${project.id}/show-notes`);
    const described = speakers.find((sp) => sp.description);
    if (described) await ask("rewrite", "POST", `/v1/speakers/${described.id}/rewrite`, { text: "We leave at dawn." });

    // A book cut afresh: the first two chapters' lines imported as a JustWrite book (one <p> a
    // line), then Analyze re-cuts chapter one (resegment) and the stream re-cuts chapter two.
    // The ids each side makes up are remembered in order, to be read as Python's.
    const texts = [];
    for (const sc of scenes.slice(0, 2)) texts.push(sc.metadata.source_text || (await call(s.port, "GET", `/v1/scenes/${sc.id}/text`)).json.text);
    const imp = await ask("import", "POST", "/v1/projects/import?source=justwrite", justwriteBook(speakers, texts));
    const pid = imp.json.project_id;
    idLists.push([pid, (await call(s.port, "GET", `/v1/projects/${pid}`)).json.default_lexicon_id]);
    const fresh = (await call(s.port, "GET", `/v1/projects/${pid}/scenes`)).json;
    idLists.push(fresh.map((x) => x.id));
    idLists.push((await call(s.port, "GET", `/v1/projects/${pid}/speakers`)).json.speakers.map((x) => x.id));
    const blocksOf = async (sid) => idLists.push((await call(s.port, "GET", `/v1/scenes/${sid}/blocks`)).json.map((x) => x.id));
    await ask("fresh 1: narrator", "POST", `/v1/projects/${pid}/narrator`);
    idLists.push([(await call(s.port, "GET", `/v1/projects/${pid}/speakers`)).json.speakers.find((x) => x.role_label === "narrator")?.id]);
    await ask("fresh 1: analyze (re-cut)", "POST", `/v1/scenes/${fresh[0].id}/analyze`, { text: texts[0] });
    await blocksOf(fresh[0].id);
    await ask("fresh 1: second look", "POST", `/v1/scenes/${fresh[0].id}/second-look/stream`);
    await ask("fresh 1: script", "GET", `/v1/scenes/${fresh[0].id}/script`);
    await ask("fresh 2: analyze streamed (re-cut)", "POST", `/v1/scenes/${fresh[1].id}/analyze/stream`, { text: texts[1], route: "direct" });
    await blocksOf(fresh[1].id);
    await ask("fresh 2: analyze", "POST", `/v1/scenes/${fresh[1].id}/analyze`, { text: texts[1] });
    await ask("fresh 2: discover", "POST", `/v1/scenes/${fresh[1].id}/discover-speakers`, { text: texts[1] });
    await ask("fresh: script", "GET", `/v1/projects/${pid}/script`);
  } finally {
    try {
      await call(s.port, "POST", "/v1/shutdown");
    } catch {
      /* already gone */
    }
    await new Promise((r) => {
      if (s.child.exitCode !== null) return r();
      const t = setTimeout(() => {
        s.child.kill();
        r();
      }, 30000);
      s.child.once("exit", () => {
        clearTimeout(t);
        r();
      });
    });
    fake.server.close();
  }
  return { answers, idLists, requests: fake.log, left: await modelProcesses(), vram: await vramMb() };
}

const escapeHtml = (t) => t.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** A JustWrite book.json of `texts` (a chapter each, a paragraph each), cast with `speakers`. */
function justwriteBook(speakers, texts) {
  const chapters = texts.map((_, i) => ({ id: `ch${i + 1}`, num: i + 1, title: `Fresh ${i + 1}`, words: 0, status: "done", strands: [] }));
  return {
    project: { title: "Fresh Cut", author: "RD", premise: "" },
    parts: [{ id: "p1", title: "Part One", chapters }],
    scenes: Object.fromEntries(
      texts.map((t, i) => [
        `ch${i + 1}`,
        [
          {
            id: `s${i + 1}`,
            title: "",
            body: t
              .split("\n\n")
              .map((p) => `<p>${escapeHtml(p)}</p>`)
              .join(""),
          },
        ],
      ]),
    ),
    characters: speakers
      .filter((sp) => sp.role_label !== "narrator")
      .map((sp) => ({ id: sp.id.slice(0, 8), name: sp.name, aliases: sp.aliases, pronouns: sp.pronouns, oneLiner: sp.description || "" })),
  };
}

/** `text` with every id the JS side made up read as Python's (the id lists, item for item). */
function idMapper(py, js) {
  const pairs = [];
  py.idLists.forEach((list, i) => {
    list.forEach((id, k) => {
      const other = js.idLists[i]?.[k];
      if (id && other && id !== other) pairs.push([other, id]);
    });
  });
  return (text) => pairs.reduce((t, [a, b]) => t.split(a).join(b), text);
}

let exitCode = 0;
try {
  const py = await runSide("py");
  const js = await runSide("js");
  const mapIds = idMapper(py, js);
  let diffs = 0;
  const report = (label, ds) => {
    if (!ds.length) return;
    diffs += ds.length;
    for (const d of ds.slice(0, 6)) console.log(`  DIFF ${label}: ${String(d).slice(0, 600)}`);
  };

  // 1. every request the fake received, byte for byte, in order
  const a = py.requests;
  const b = js.requests;
  if (a.length !== b.length) report("requests", [`python sent ${a.length}, js ${b.length}`]);
  const kinds = {};
  let bytes = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    bytes += a[i].body.length;
    const kind = `${a[i].method} ${a[i].path}${a[i].body.includes('"stream":true') ? " (stream)" : ""}`;
    kinds[kind] = (kinds[kind] || 0) + 1;
    if (a[i].method !== b[i].method || a[i].path !== b[i].path) report(`request #${i}`, [`python ${a[i].method} ${a[i].path} | js ${b[i].method} ${b[i].path}`]);
    else if (a[i].body !== b[i].body) {
      let at = 0;
      while (at < a[i].body.length && a[i].body[at] === b[i].body[at]) at++;
      report(`request #${i} body`, [`from char ${at}: python …${JSON.stringify(a[i].body.slice(Math.max(0, at - 60), at + 80))} | js …${JSON.stringify(b[i].body.slice(Math.max(0, at - 60), at + 80))}`]);
    }
  }
  console.log(`requests: ${a.length} (${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(", ")}), ${bytes} bytes of bodies`);

  // 2. every answer
  if (py.answers.length !== js.answers.length) report("answers", [`python ${py.answers.length}, js ${js.answers.length}`]);
  py.answers.forEach((p, i) => {
    const j0 = js.answers[i];
    if (!j0) return;
    const j = {
      ...j0,
      json: j0.json === undefined ? undefined : JSON.parse(mapIds(JSON.stringify(j0.json))),
      text: j0.text === undefined ? undefined : mapIds(j0.text),
    };
    if (p.status !== j.status || p.type !== j.type) report(`answer ${p.label}`, [`python ${p.status} ${p.type} | js ${j.status} ${j.type}: ${(p.text ?? JSON.stringify(p.json)).slice(0, 300)} | ${(j.text ?? JSON.stringify(j.json)).slice(0, 300)}`]);
    else if (p.json !== undefined) report(`answer ${p.label}`, compare(p.json, j.json));
    else if (p.text !== j.text) {
      let at = 0;
      while (at < p.text.length && p.text[at] === j.text[at]) at++;
      report(`answer ${p.label}`, [`text from char ${at}: python …${JSON.stringify(p.text.slice(Math.max(0, at - 80), at + 120))} | js …${JSON.stringify(j.text.slice(Math.max(0, at - 80), at + 120))}`]);
    }
  });
  // What the runs did (Python's answers): each Analyze's write, each second look's questions.
  for (const x of py.answers) {
    if (x.json?.persisted) console.log(`  ${x.label}: ${x.json.rows.length} rows, ${x.json.route_used}/${x.json.route_source}, ${JSON.stringify(x.json.persisted)}`);
    if (x.text !== undefined) {
      const done = x.text
        .split("\n\n")
        .filter((f) => f.startsWith("data: {"))
        .map((f) => JSON.parse(f.slice(6)))
        .find((f) => f.done);
      if (done?.persisted) console.log(`  ${x.label}: ${done.rows.length} rows, ${JSON.stringify(done.persisted)}`);
      else if (done) console.log(`  ${x.label}: asked ${done.asked}, named ${done.named}, not in cast ${JSON.stringify(done.not_in_cast)}, failed ${done.failed}`);
    }
    if (x.json?.candidates) console.log(`  ${x.label}: ${x.json.candidates.length} candidates, ${x.json.named_cast?.length ?? 0} named`);
  }
  const sse = py.answers.filter((x) => x.text !== undefined);
  const frames = sse.reduce((n, x) => n + x.text.split("\n\n").filter((f) => f.startsWith("data:")).length, 0);
  console.log(`answers: ${py.answers.length} (${py.answers.filter((x) => x.status === 200).length} ok; ${sse.length} streams with ${frames} frames) — ${py.answers.map((x) => `${x.label} ${x.status}`).join(" · ")}`);

  // 3. every table both wrote
  const STAMP = /^'\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(\.\d{1,6})?(Z|[+-]\d\d:\d\d)?'$/;
  const mask = (t, c, v) => {
    if (typeof v !== "string") return v;
    // Each side's own fake server.
    if (t === "llm_providers" && c === "base_url" && v.startsWith("'http://127.0.0.1:")) return "<fake>";
    if (t === "llm_usage" && c === "id") return "<id>";
    // A lexicon entry's own random id (never answered).
    if (t === "lexicon_entries" && c === "id") return "<id>";
    // The cast a chapter was analyzed with, sorted by id: each side's new ids sort their own way.
    if (t === "scenes" && c === "metadata_json" && v.includes('"analyzed_cast"')) {
      const meta = JSON.parse(v.slice(1, -1).replaceAll("''", "'"));
      if (Array.isArray(meta.analyzed_cast)) meta.analyzed_cast.sort();
      v = `'${JSON.stringify(meta)}'`;
    }
    if (t === "llm_usage" && c === "at") return "<at>";
    if (t === "llm_usage" && c === "meta") return v.replace(/"durationMs": \d+/, '"durationMs": <ms>');
    if (STAMP.test(v) && /(_at|^at)$/.test(c)) return "<stamp>";
    return v.replace(/("(?:analyzed_at|scanned_at|updated_at)": ?")[^"]+"/g, '$1<stamp>"');
  };
  const dump = (file, ids = (v) => v) => {
    const db = new Database(file, { readonly: true });
    const out = {};
    for (const { name } of db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name").all()) {
      const cols = db.prepare(`pragma table_info("${name}")`).all().map((c) => c.name);
      out[name] = db
        .prepare(`select ${cols.map((c) => `quote("${c}") as "${c}"`).join(", ")} from "${name}" order by rowid`)
        .all()
        .map((row) => Object.fromEntries(cols.map((c) => [c, mask(name, c, typeof row[c] === "string" ? ids(row[c]) : row[c])])));
    }
    db.close();
    return out;
  };
  const pyDb = dump(join(sides.py, "justvoice.db"));
  const jsDb = dump(join(sides.js, "justvoice.db"), mapIds);
  let cells = 0;
  const volatile = [];
  for (const t of Object.keys(pyDb)) {
    for (const r of pyDb[t]) cells += Object.keys(r).length;
    const ds = compare(pyDb[t], jsDb[t] ?? []);
    if (ds.length && /hardware|measurement/.test(t)) volatile.push(`${t} (${ds.length})`);
    else report(`table ${t}`, ds);
  }
  console.log(`database: ${Object.keys(pyDb).length} tables, ${cells} cells compared${volatile.length ? ` — this machine's live probes differ in: ${volatile.join(", ")}` : ""}`);
  console.log(`graphics memory: before ${vram.before}, after Python ${py.vram}, after JS ${js.vram}; model processes left: ${[...py.left, ...js.left].length}`);
  console.log(diffs ? `FAILED: ${diffs} differences` : "identical");
  if (diffs) exitCode = 1;
} finally {
  if (keep) console.log(`kept ${dir}`);
  else {
    cleanup(dir);
    console.log(`removed ${dir}`);
  }
}
process.exitCode = exitCode;
