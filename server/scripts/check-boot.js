// SPDX-License-Identifier: MIT
// The boot check of the API wave (step 5, agent 1 — check b): the JavaScript server started the
// way the desktop shell and headless users start it (`serve.js serve`), on a COPY of the dev data
// root, beside the Python server on another copy.
//
//   1. the boot order — hardware detected before the boot sweeps: a stale render job planted in
//      the copy makes the sweep log its line, read from the server's own log (debug level);
//   2. `/mcp` — initialize and tools/list on the WHOLE app answer as Python's whole app does
//      (session ids aside);
//   3. a clean shutdown — the DSP program the server started (an analyze request starts it) is
//      gone after POST /v1/shutdown, the process has exited, and nothing listens on its port.
//
//   node scripts/node24.js server/scripts/check-boot.js        (ports 8790 / 8791)
//
// Copies: justvoice.db and the small folders copied; the JS side's `engines-runtime` is a
// junction to Python's source-tree runtime (read only, unlinked first at cleanup). Warm-on-boot
// OFF, nothing is loaded, nothing reaches the network.

import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmdirSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as procs from "@delebash/llm-runner/platform/procs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, "..");
const REPO = path.resolve(SERVER, "..");
const DEV_DATA = path.join(REPO, "data");
const PY = process.env.JV_PYTHON || path.join(SERVER, ".venv", "Scripts", "python.exe");
const PY_RUNTIME = path.join(SERVER, "justvoice", "engines");
const PY_PORT = 8790;
const JS_PORT = 8791;

const root = mkdtempSync(path.join(tmpdir(), "jv-check-boot-"));
const home = path.join(root, "home");
mkdirSync(home);
const junctions = [];
const out = { checks: {} };

function copy(name, side) {
  const d = path.join(root, name);
  mkdirSync(d, { recursive: true });
  cpSync(path.join(DEV_DATA, "justvoice.db"), path.join(d, "justvoice.db"));
  for (const rel of ["voices", "personas", "lexicons", "engines-runtime-config", "justvoice"]) {
    if (existsSync(path.join(DEV_DATA, rel))) cpSync(path.join(DEV_DATA, rel), path.join(d, rel), { recursive: true });
  }
  if (side === "js") {
    symlinkSync(PY_RUNTIME, path.join(d, "engines-runtime"), "junction");
    junctions.push(path.join(d, "engines-runtime"));
  }
  // Warm OFF, and a render job a dead server left running (the sweep's line).
  const require = createRequire(path.join(REPO, "node_modules", "@delebash", "llm-runner", "package.json"));
  const Database = require("better-sqlite3");
  const db = new Database(path.join(d, "justvoice.db"));
  db.prepare("update runner_setting set value = '0' where key = 'warm_default_on_startup'").run();
  const project = db.prepare("select id from projects limit 1").get()?.id;
  if (project) {
    db.prepare(
      "insert into render_jobs (id, project_id, scope, status, completed_blocks, failed_blocks, created_at) values ('boot-check-job', ?, 'project', 'running', 0, 0, '2026-10-08 00:00:00.000000')",
    ).run(project);
  }
  db.close();
  return d;
}

const env = { ...process.env, JUST_AI_HOME: home, PYTHONIOENCODING: "utf-8", ELECTRON_RUN_AS_NODE: "1" };
delete env.JUSTVOICE_AUDIOCPP_BUILD;

const children = {};
function start(label, cmd, args) {
  const c = spawn(cmd, args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const log = { out: [], err: [] };
  c.stdout.on("data", (d) => log.out.push(d));
  c.stderr.on("data", (d) => log.err.push(d));
  children[label] = { c, log };
  return c;
}

async function up(port, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/v1/health`)).status === 200) return Date.now() - t0;
    } catch {
      /* not yet */
    }
    if (children[label].c.exitCode !== null) throw new Error(`${label} exited: ${Buffer.concat(children[label].log.err).toString().slice(-2000)}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${label} never came up`);
}

/** A JSON-RPC exchange on /mcp → {status, session, msg} (the SSE frame's message). */
async function mcp(port, body, sid = null) {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (sid) headers["mcp-session-id"] = sid;
  const r = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await r.text();
  const data = /^data: (.*)$/m.exec(text);
  let msg = null;
  try {
    msg = JSON.parse(data ? data[1] : text);
  } catch {
    msg = text;
  }
  return { status: r.status, session: r.headers.get("mcp-session-id"), msg };
}

async function mcpScript(port) {
  const init = await mcp(port, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "boot-check", version: "1" } } });
  const sid = init.session;
  const notified = await mcp(port, { jsonrpc: "2.0", method: "notifications/initialized" }, sid);
  const tools = await mcp(port, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, sid);
  return { initialize: { status: init.status, session: Boolean(sid), result: init.msg?.result }, initialized: notified.status, toolsList: { status: tools.status, result: tools.msg?.result } };
}

/** Child processes of `pid` (the kit's no-console door, CIM). */
async function childrenOf(pid) {
  const r = await procs.run(
    ["powershell", "-NoProfile", "-NonInteractive", "-Command", `Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" | ForEach-Object { "$($_.ProcessId) $($_.Name)" }`],
    { timeout: 30 },
  );
  return String(r.stdout)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => ({ pid: Number(l.split(" ")[0]), name: l.split(" ").slice(1).join(" ") }));
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const listening = async (port) => {
  try {
    await fetch(`http://127.0.0.1:${port}/v1/health`);
    return true;
  } catch {
    return false;
  }
};

let exitCode = 0;
try {
  const py = copy("py", "py");
  const js = copy("js", "js");
  start("python", PY, ["-m", "justvoice.serve", "serve", "--host", "127.0.0.1", "--port", String(PY_PORT), "--data-dir", py, "--log-level", "debug"]);
  start("node", process.execPath, [path.join(SERVER, "src", "serve.js"), "serve", "--host", "127.0.0.1", "--port", String(JS_PORT), "--data-dir", js, "--log-level", "debug"]);
  const [pyMs, jsMs] = await Promise.all([up(PY_PORT, "python"), up(JS_PORT, "node")]);
  out.upMs = { python: pyMs, node: jsMs };

  // 1. The boot order, from the server's own log.
  const err = Buffer.concat(children.node.log.err).toString();
  const hwAt = err.indexOf("boot: hardware detected");
  const sweepAt = err.indexOf("render jobs: 1 interrupted job(s) marked paused");
  const mcpAt = err.indexOf("MCP: mounted at /mcp");
  out.checks.bootOrder = { hardwareBeforeSweep: hwAt >= 0 && sweepAt > hwAt, sweepBeforeMcp: sweepAt >= 0 && mcpAt > sweepAt, hwAt, sweepAt, mcpAt };
  out.bootLog = err
    .split(/\r?\n/)
    .filter((l) => /boot: hardware|render jobs:|takes:|plugin manager|MCP: mounted|UI served|Legacy reference/.test(l))
    .map((l) => l.replace(/^\S+ \S+ /, ""));

  // 2. /mcp on the whole app, both servers.
  const [pyMcp, jsMcp] = [await mcpScript(PY_PORT), await mcpScript(JS_PORT)];
  out.checks.mcpIdentical = JSON.stringify(pyMcp) === JSON.stringify(jsMcp);
  out.mcp = { python: pyMcp, node: jsMcp };

  // 3. A clean shutdown: the DSP program first started (an analyze request), then closed.
  const nodePid = children.node.c.pid;
  const wav = Buffer.alloc(44 + 3200);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + 3200, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(3200, 40);
  const analyzed = await fetch(`http://127.0.0.1:${JS_PORT}/v1/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wav_b64: wav.toString("base64") }),
  });
  out.analyzeStatus = analyzed.status;
  const before = await childrenOf(nodePid);
  const dsp = before.filter((p) => /audiocpp_dsp/i.test(p.name));
  out.childrenBeforeShutdown = before;
  const bye = await fetch(`http://127.0.0.1:${JS_PORT}/v1/shutdown`, { method: "POST" });
  out.shutdownAnswer = { status: bye.status, body: await bye.json() };
  const pyBye = await fetch(`http://127.0.0.1:${PY_PORT}/v1/shutdown`, { method: "POST" });
  out.pythonShutdownAnswer = { status: pyBye.status, body: await pyBye.json() };
  const exitCodeOf = (label) =>
    new Promise((r) => {
      const c = children[label].c;
      if (c.exitCode !== null) return r(c.exitCode);
      const t = setTimeout(() => r("still running after 20 s"), 20000);
      c.once("exit", (code) => {
        clearTimeout(t);
        r(code);
      });
    });
  out.exit = { node: await exitCodeOf("node"), python: await exitCodeOf("python") };
  await new Promise((r) => setTimeout(r, 500));
  out.checks.shutdown = {
    dspStarted: dsp.length > 0,
    dspGone: dsp.length > 0 && dsp.every((p) => !alive(p.pid)),
    nodeExitedZero: out.exit.node === 0,
    portClosed: !(await listening(JS_PORT)),
    pythonPortClosed: !(await listening(PY_PORT)),
  };
  const ok = (v) => (typeof v === "object" ? Object.values(v).every((x) => (typeof x === "boolean" ? x : true)) : v);
  exitCode = Object.values(out.checks).every(ok) ? 0 : 1;
} catch (e) {
  out.error = String(e?.stack || e);
  exitCode = 2;
} finally {
  for (const { c } of Object.values(children)) {
    try {
      if (c.exitCode === null) c.kill();
    } catch {
      /* gone */
    }
  }
  await new Promise((r) => setTimeout(r, 800));
  for (const j of junctions.splice(0)) rmdirSync(j); // the link goes, the target stays
  const left = [];
  const walk = (p) => {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      const q = path.join(p, e.name);
      if (e.isSymbolicLink()) left.push(q);
      else if (e.isDirectory()) walk(q);
    }
  };
  walk(root);
  if (left.length) out.cleanup = `kept ${root}: links left: ${left.join(", ")}`;
  else rmSync(root, { recursive: true, force: true });
}
console.log(JSON.stringify(out, null, 2));
process.exitCode = exitCode;
