// SPDX-License-Identifier: MIT
// The extraction parity check (wave D of step 5, check b): Python's extraction pipeline and this
// port run the same chapters against a FAKE llama-server, and everything they send and make is
// compared.
//
//   1. Two COPIES of the dev data root (the database and the small config files).
//   2. compare-extraction.py `plan` reads the Python copy with the Analyze and Discover routes'
//      own helpers and writes each chapter's inputs (text, cast, corrections, Speech marks, the
//      kept lines' segments, the neighbouring chapters, the lines set by you).
//   3. A fake llama-server per language (a Node HTTP server here on a free loopback port):
//      `GET /v1/models` (the presets' models, a 3,000-token context — so every chapter is read
//      in pieces), `/apply-template`, `/tokenize` (a token per 4 characters) and
//      `/v1/chat/completions` (JSON, or SSE with a prompt-progress frame, a thinking frame and
//      the answer in chunks). Its answers are derived from the request — attribution answers
//      per [D#] (some by name, some unknown, some below the floor, some missing, some wrapped in
//      prose), second-look answers per marked line, Discover's names from the manuscript — so
//      equal requests get equal answers. It records every request's path and body text.
//   4. Python runs, per chapter: Analyze (kept lines, second look on), Analyze streamed (cut
//      afresh, guided route), Discover. Then this port runs the same on its copy.
//   5. Compared: every request byte for byte, in order; every result (the rows, the run report
//      with its clock readings blanked, the streamed deltas, progress, thinking and steps, the
//      candidates); and every table both servers wrote, cell by cell (ids and times aside).
//
// No model is loaded and nothing is started: the bundled runner's model-load hook is off and its
// base URL is the fake server.
//
//   node scripts/node24.js server/scripts/compare-extraction.js      (JV_PYTHON overrides)

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, compare, dataCopy, HERE, PY, SERVER, tempRoot } from "./compare-render-lib.js";

const dir = tempRoot("jv-compare-extraction-");
const CTX = 3000;
let exitCode = 0;
const servers = [];

/** A small deterministic hash of a string. */
const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.codePointAt(0)) >>> 0, 7);
const cps = (s) => [...s].length;

/** The answer a request gets — derived from what it asks, nothing else. */
function answerFor(body) {
  const msgs = body.messages || [];
  const sys = msgs.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const user = msgs.filter((m) => m.role !== "system").map((m) => m.content).join("\n");
  if (sys.includes("casting assistant") || user.includes("Manuscript text:")) {
    const known = new Set([...user.matchAll(/^- ([^(\n—]+)/gm)].map((m) => m[1].trim().toLowerCase()));
    const manuscript = user.split("Manuscript text:").pop();
    const names = [];
    for (const m of manuscript.matchAll(/\b([A-Z][a-z]{3,})\b/g)) {
      const n = m[1];
      if (!known.has(n.toLowerCase()) && !names.includes(n)) names.push(n);
      if (names.length >= 3) break;
    }
    const arr = names.map((n, i) => ({ name: i === 2 ? n.toUpperCase() : n, role_hint: i ? "someone in the text" : "", approx_lines: i === 1 ? 2.0 : i, evidence: `${n} was there` }));
    const json = JSON.stringify(arr);
    return hash(manuscript) % 2 ? `\`\`\`json\n${json}\n\`\`\`\nThose are all.` : json;
  }
  if (sys.includes("You attribute ONE line") || user.includes("Who speaks the marked line")) {
    const cast = [...user.matchAll(/^- id="([^"]+)", name="([^"]+)"/gm)].map((m) => [m[1], m[2]]);
    const line = /⟦([^⟧]*)⟧\?/.exec(user)?.[1] ?? "";
    const k = hash(line) % (cast.length + 3);
    if (k < cast.length) return JSON.stringify({ reason: "The text names them.", speaker: cast[k][0], confidence: 0.9 });
    if (k === cast.length) return `Thinking aloud. {"reason": "Someone new.", "speaker": "unknown", "confidence": 0.5, "not_in_cast": "Captain Vire"}`;
    if (k === cast.length + 1) return JSON.stringify({ reason: "Unsure.", speaker: cast[0]?.[1] ?? "unknown", confidence: 0.3 });
    return "no json at all";
  }
  if (user.includes("[D")) {
    const ids = [...new Set([...user.matchAll(/\[D(\d+)\]/g)].map((m) => Number(m[1])))];
    const cast = [...user.matchAll(/^- id="([^"]+)", name="([^"]+)"/gm)].map((m) => [m[1], m[2]]);
    const confs = [0.95, 0.6, 0.35, 0.8, 1, 0.72];
    const picks = [];
    for (const n of ids) {
      if (n % 11 === 5) continue; // a gap
      const k = (n * 7 + 3) % (cast.length + 2);
      const speaker = k < cast.length ? cast[k][0] : k === cast.length ? "unknown" : (cast[n % Math.max(1, cast.length)]?.[1] ?? "unknown");
      const id = n % 9 === 4 ? `[D${n}]` : n % 13 === 6 ? n : `D${n}`;
      picks.push({ id, speaker, confidence: confs[n % confs.length] });
    }
    const json = JSON.stringify(picks);
    return ids.length % 2 ? json : `Checking [D${ids[0]}] first.\n${json}\nDone.`;
  }
  return "OK";
}

/** A fake llama-server recording every request; resolves to {port, log}. */
function fakeServer(models) {
  const log = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      log.push({ method: req.method, path: req.url, body: raw });
      const send = (obj) => {
        const text = JSON.stringify(obj);
        res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
        res.end(text);
      };
      if (req.method === "GET" && req.url === "/v1/models") return send({ data: models.map((id) => ({ id, meta: { n_ctx: CTX } })) });
      const body = raw ? JSON.parse(raw) : {};
      if (req.url === "/apply-template") return send({ prompt: (body.messages || []).map((m) => `<|${m.role}|>\n${m.content}`).join("\n") });
      if (req.url === "/tokenize") return send({ tokens: Array.from({ length: Math.ceil(cps(body.content || "") / 4) }, (_, i) => i % 1000) });
      if (req.url === "/v1/chat/completions") {
        const content = answerFor(body);
        const pt = Math.ceil(cps(JSON.stringify(body.messages || [])) / 4);
        const ct = Math.ceil(cps(content) / 4);
        if (!body.stream) {
          return send({ model: body.model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: pt, completion_tokens: ct } });
        }
        res.writeHead(200, { "content-type": "text/event-stream" });
        const frame = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
        frame({ choices: [], prompt_progress: { total: 100, processed: 40 } });
        frame({ choices: [{ index: 0, delta: { reasoning_content: "Let me read the lines." } }] });
        for (let i = 0; i < content.length; i += 17) frame({ choices: [{ index: 0, delta: { content: content.slice(i, i + 17) } }] });
        frame({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
        frame({ choices: [], usage: { prompt_tokens: pt, completion_tokens: ct } });
        res.end("data: [DONE]\n\n");
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end('{"error":"not found"}');
    });
  });
  servers.push(server);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ port: server.address().port, log })));
}

try {
  const pyData = dataCopy(dir, "py-data", { links: [] });
  const jsData = dataCopy(dir, "js-data", { links: [] });
  const procs = await import("@delebash/llm-runner/platform/procs");
  const py = async (args) => {
    const r = await procs.run([PY, join(HERE, "compare-extraction.py"), ...args], { cwd: SERVER, env: { ...process.env, PYTHONIOENCODING: "utf-8" }, timeout: 3600 });
    if (r.returncode !== 0) throw new Error(`compare-extraction.py ${args[0]} failed:\n${r.stderr.slice(-4000)}`);
  };

  // The presets' models (what /v1/models must list for the measure to find the context).
  const { openDatabase } = await import("@delebash/llm-runner/platform/sql");
  const probe = openDatabase(join(pyData, "justvoice.db"), { foreignKeys: false, readonly: true });
  const models = [...new Set(probe.all("select model from engine_presets where model != ''").map((r) => r.model))];
  probe.close();

  const planPath = join(dir, "plan.json");
  await py(["plan", pyData, planPath]);
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  console.log(`chapters: ${plan.chapters.map((c) => `${c.title} (${c.text.length} chars, ${c.characters.length} speakers, ${c.segments ? "kept lines" : "cut afresh"})`).join(" · ")}`);

  // ── Python ──
  const fakePy = await fakeServer(models);
  const pyOut = join(dir, "py.json");
  await py(["run", pyData, planPath, `http://127.0.0.1:${fakePy.port}`, pyOut]);
  const pyRes = JSON.parse(readFileSync(pyOut, "utf8"));

  // ── this port ──
  const fakeJs = await fakeServer(models);
  const base = `http://127.0.0.1:${fakeJs.port}`;
  const { installLlm } = await import("@delebash/llm-runner/llm");
  const dispatch = await import("@delebash/llm-runner/llm/dispatch");
  const session = await import("../src/database/session.js");
  const { AppState, setState, getState } = await import("../src/app_state.js");
  const seedPresets = await import("../src/seed_presets.js");
  const { DEFAULT_FEATURE_PROMPTS } = await import("../src/seed_feature_prompts.js");
  const { FEATURE_CATALOG, PREFER_LOCAL_FEATURES } = await import("../src/feature_catalog.js");
  const { PRODUCT } = await import("../src/version.js");
  const { analyzeScene } = await import("../src/extraction/pipeline.js");
  const { identifySpeakers } = await import("../src/extraction/identify.js");
  const { spokenBlock } = await import("../src/extraction/flags.js");
  const { paragraphsOf, segmentsFromLines } = await import("../src/extraction/segmentation.js");
  session.initDb(jsData);
  setState(new AppState(jsData));
  await installLlm(null, {
    db: session.getDb(),
    featureCatalog: FEATURE_CATALOG,
    featurePrompts: DEFAULT_FEATURE_PROMPTS,
    enginePresets: seedPresets.DEFAULT_ENGINE_PRESETS,
    featurePresets: seedPresets.DEFAULT_FEATURE_PRESETS,
    defaultPresetId: seedPresets.DEFAULT_PRESET_ID,
    testSamples: seedPresets.DEFAULT_TEST_SAMPLES,
    modelCatalogExtra: seedPresets.JV_MODEL_CATALOG,
    classTunesSeed: seedPresets.JV_CLASS_TUNES,
    classTuneIdentity: seedPresets.JV_CLASS_TUNE_IDENTITY,
    preferLocalFeatures: PREFER_LOCAL_FEATURES,
    dataDir: jsData,
    product: PRODUCT,
  });
  // The serve boot's workspace seed — it also loads the stored providers into the registry.
  const { seedWorkspace } = await import("../src/database/seed.js");
  await seedWorkspace();
  dispatch.setEnsureLocalModel(null);
  dispatch.setLocalRunnerBaseUrl(() => base);

  const settings = getState().settings.get();
  const wire = (v) => JSON.parse(JSON.stringify(v));
  const clean = (raw) => {
    const out = wire(raw);
    if (out.usage && "duration_ms" in out.usage) out.usage.duration_ms = "<ms>";
    if (out.second_look && "seconds" in out.second_look) out.second_look.seconds = "<s>";
    return out;
  };
  const attempt = async (fn) => {
    try {
      return { ok: await fn() };
    } catch (e) {
      return { error: `${e?.name || "Error"}: ${e?.message ?? e}` };
    }
  };
  const jsRes = [];
  for (const ch of plan.chapters) {
    const rec = { title: ch.title };
    rec.analyze = await attempt(async () => {
      const raw = {};
      const rows = await analyzeScene({
        settings,
        request: { text: ch.text, characters: ch.characters, corrections: ch.corrections, before_text: ch.before_text, after_text: ch.after_text, second_look: true, second_look_skip: ch.second_look_skip },
        rawOut: raw,
        marks: ch.marks,
        segments: ch.segments,
      });
      return { rows: wire(rows), raw: clean(raw) };
    });
    rec.analyze_edited = await attempt(async () => {
      const segs = segmentsFromLines(ch.lines.map((ln) => ({ text: ln.text, spoken: spokenBlock(ln.source, ln.text), paragraph: ln.paragraph })));
      const raw = {};
      const rows = await analyzeScene({
        settings,
        request: { text: paragraphsOf(segs).join("\n\n"), characters: ch.characters, corrections: ch.corrections, route: "direct", second_look: false },
        rawOut: raw,
        marks: ch.marks,
        segments: segs,
      });
      return { segments: wire(segs), rows: wire(rows), raw: clean(raw) };
    });
    rec.analyze_streamed = await attempt(async () => {
      const raw = {};
      const seen = { deltas: [], progress: [], thinking: [], steps: [] };
      const rows = await analyzeScene({
        settings,
        request: { text: ch.body_text, characters: ch.characters, corrections: ch.corrections, route: "guided", before_text: ch.before_text, after_text: ch.after_text, second_look: true },
        rawOut: raw,
        marks: ch.marks,
        onDelta: (t) => seen.deltas.push(t),
        onProgress: (p) => seen.progress.push(p),
        onThinking: (t) => seen.thinking.push(t),
        onStep: (done, total) => seen.steps.push([done, total]),
      });
      return { rows: wire(rows), raw: clean(raw), ...seen };
    });
    rec.discover = await attempt(async () => {
      const raw = {};
      const got = await identifySpeakers(ch.body_text, ch.characters, { settings, rawOut: raw, marks: ch.discover_marks });
      return { candidates: wire(got), raw: clean(raw) };
    });
    jsRes.push(rec);
  }

  // ── compare ──
  let diffs = 0;
  const report = (label, ds) => {
    if (!ds.length) return;
    diffs += ds.length;
    for (const d of ds.slice(0, 8)) console.log(`  DIFF ${label}: ${d.slice(0, 500)}`);
  };
  // 1. every request, byte for byte, in order
  const a = fakePy.log;
  const b = fakeJs.log;
  let bytes = 0;
  const kinds = {};
  if (a.length !== b.length) report("requests", [`python sent ${a.length}, js ${b.length}`]);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    bytes += a[i].body.length;
    const kind = a[i].path === "/v1/chat/completions" ? (JSON.parse(a[i].body).stream ? "chat (stream)" : "chat") : a[i].path;
    kinds[kind] = (kinds[kind] || 0) + 1;
    if (a[i].method !== b[i].method || a[i].path !== b[i].path) report(`request #${i}`, [`python ${a[i].method} ${a[i].path} | js ${b[i].method} ${b[i].path}`]);
    else if (a[i].body !== b[i].body) {
      const ds = a[i].body && b[i].body ? compare(JSON.parse(a[i].body), JSON.parse(b[i].body)) : [];
      let at = 0;
      while (at < a[i].body.length && a[i].body[at] === b[i].body[at]) at++;
      report(`request #${i} ${a[i].path} body`, ds.length ? ds : [`same JSON, different text from char ${at}: python …${JSON.stringify(a[i].body.slice(Math.max(0, at - 40), at + 60))} | js …${JSON.stringify(b[i].body.slice(Math.max(0, at - 40), at + 60))}`]);
    }
  }
  console.log(
    `requests: ${a.length} (${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(", ")}), ${bytes} bytes of bodies`,
  );
  // 2. every result
  let rows = 0;
  pyRes.forEach((p, i) => {
    report(`results ${p.title}`, compare(p, jsRes[i]));
    for (const k of ["analyze", "analyze_edited", "analyze_streamed"]) rows += p[k].ok?.rows?.length ?? 0;
  });
  const sum = (k) => pyRes.reduce((n, p) => n + (p[k].ok ? 1 : 0), 0);
  console.log(`results: ${pyRes.length} chapters × (Analyze ${sum("analyze")} ok, Analyze an edited chapter ${sum("analyze_edited")} ok, Analyze streamed ${sum("analyze_streamed")} ok, Discover ${sum("discover")} ok) — ${rows} rows`);
  for (const p of pyRes) {
    for (const k of ["analyze", "analyze_edited", "analyze_streamed", "discover"]) if (p[k].error) console.log(`  ${p.title} ${k}: ${p[k].error.slice(0, 300)}`);
    const r = p.analyze.ok?.raw;
    if (r) console.log(`  ${p.title}: ${r.usage?.pieces} pieces, route ${r.route}/${r.route_source}, second look ${JSON.stringify({ ...r.second_look, seconds: undefined })}`);
  }
  // 3. every table both wrote
  session.closeDb();
  const DT = /^'\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(\.\d{1,6})?(Z|[+-]\d\d:\d\d)?'$/;
  const ID = /^'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'$/;
  const tablesOf = (h) => h.all("select name from sqlite_master where type = 'table' order by name").map((r) => r.name);
  // The usage ledger's own clock and random ids: its row id, its `at` (epoch ms) and the call's
  // measured durationMs inside its meta.
  const USAGE_ID = /^'u_[0-9a-f]{12}'$/;
  const mask = (t, c, v) => {
    if (typeof v === "string" && (DT.test(v) || ID.test(v) || USAGE_ID.test(v))) return "<masked>";
    if (t === "llm_usage" && c === "at") return "<at>";
    if (t === "llm_usage" && c === "meta" && typeof v === "string") return v.replace(/"durationMs": \d+/, '"durationMs": <ms>');
    return v;
  };
  const dump = (file) => {
    const db = openDatabase(file, { foreignKeys: false, readonly: true });
    const out = {};
    for (const t of tablesOf(db)) {
      const cols = db.columnNames(t);
      out[t] = db
        .all(`select ${cols.map((c) => `quote("${c}") as "${c}"`).join(", ")} from "${t}" order by rowid`)
        .map((row) => Object.fromEntries(cols.map((c) => [c, mask(t, c, row[c])])));
    }
    db.close();
    return out;
  };
  const pyDb = dump(join(pyData, "justvoice.db"));
  const jsDb = dump(join(jsData, "justvoice.db"));
  let cells = 0;
  const volatile = [];
  for (const t of Object.keys(pyDb)) {
    for (const r of pyDb[t]) cells += Object.keys(r).length;
    const ds = compare(pyDb[t], jsDb[t] ?? []);
    if (ds.length && /hardware|measurement/.test(t)) volatile.push(`${t} (${ds.length})`);
    else report(`table ${t}`, ds);
  }
  console.log(`database: ${Object.keys(pyDb).length} tables, ${cells} cells compared${volatile.length ? ` — this machine's live probes differ in: ${volatile.join(", ")}` : ""}`);
  console.log(diffs ? `FAILED: ${diffs} differences` : "identical");
  if (diffs) exitCode = 1;
} finally {
  for (const s of servers) s.close();
  try {
    (await import("../src/database/session.js")).closeDb();
  } catch {}
  cleanup(dir);
  console.log(`removed ${dir}`);
}
process.exitCode = exitCode;
