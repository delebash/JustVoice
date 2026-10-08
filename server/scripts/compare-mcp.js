// SPDX-License-Identifier: MIT
// The MCP parity check (wave D of step 5, check c): Python's MCP mount (fastmcp 3.4.5 on a bare
// FastAPI, compare-mcp.py) and this port's (the SDK on a bare Fastify, mountInto) serve the
// SAME session script on two free loopback ports, each over its own COPY of the dev database.
//
// Compared: initialize (three protocol versions), tools/list, every read-only tool call
// (list_voices — default, with a limit, every refusal; list_personas; transcribe's refusals,
// none of which reaches the speech runtime; a bad argument of each kind; an unknown tool),
// ping, the empty prompt and resource lists, logging/setLevel, an unknown method, the
// transport's refusals (no session, unknown session, a client that won't take SSE), and the
// mcp_bindings rows the client-id header stamps (times aside). `speak` is never called.
//
//   node scripts/node24.js server/scripts/compare-mcp.js      (JV_PYTHON overrides)

import { createServer as netServer } from "node:net";
import { join } from "node:path";
import { cleanup, compare, dataCopy, HERE, PY, SERVER, tempRoot } from "./compare-render-lib.js";

const FORBIDDEN = new Set([17494, 17495, 8742, 1420, 1430, 1431]);
const dir = tempRoot("jv-compare-mcp-");
let exitCode = 0;
let pyProc = null;
let jsApp = null;
const ports = [];

/** A free loopback port (never one the app or its dev tools use). */
async function freePort() {
  for (;;) {
    const port = await new Promise((resolve, reject) => {
      const s = netServer();
      s.once("error", reject);
      s.listen(0, "127.0.0.1", () => {
        const p = s.address().port;
        s.close(() => resolve(p));
      });
    });
    if (!FORBIDDEN.has(port)) return port;
  }
}

/** Is something listening on this port? */
async function listening(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/mcp`, { method: "GET" });
    return true;
  } catch {
    return false;
  }
}

const CLIENT = "parity-client";

/** One request; the parsed JSON-RPC message(s) of an SSE or JSON answer, with the status. */
async function call(port, body, { sid = null, accept = "application/json, text/event-stream", method = "POST" } = {}) {
  const headers = { "content-type": "application/json", accept, "x-justvoice-client-id": CLIENT };
  if (sid) headers["mcp-session-id"] = sid;
  const r = await fetch(`http://127.0.0.1:${port}/mcp`, { method, headers, body: method === "POST" ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let msg = null;
  const data = /^data: (.*)$/m.exec(text);
  if (data) msg = JSON.parse(data[1]);
  else if (text.trim()) {
    try {
      msg = JSON.parse(text);
    } catch {
      msg = { text };
    }
  }
  return { status: r.status, session: r.headers.get("mcp-session-id"), msg };
}

/** The session script — the same requests, in order, against one server. */
async function script(port) {
  const out = [];
  const keep = (label, r) => {
    // The JSON-RPC envelope's own key order is the library's; compare what it carries.
    const m = r.msg;
    const body = m && typeof m === "object" ? { id: m.id ?? null, result: m.result, error: m.error, text: m.text } : m;
    out.push({ label, status: r.status, body });
  };
  const init = (v) => ({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: v, capabilities: {}, clientInfo: { name: "parity", version: "1" } } });
  const first = await call(port, init("2025-06-18"));
  keep("initialize 2025-06-18", first);
  const sid = first.session;
  keep("notifications/initialized", await call(port, { jsonrpc: "2.0", method: "notifications/initialized" }, { sid }));
  let id = 10;
  const rpc = async (label, method, params) => keep(label, await call(port, { jsonrpc: "2.0", id: id++, method, ...(params === undefined ? {} : { params }) }, { sid }));
  await rpc("tools/list", "tools/list", {});
  const tool = (name, args) => rpc(`tools/call ${name} ${JSON.stringify(args)}`, "tools/call", args === undefined ? { name } : { name, arguments: args });
  await tool("justvoice.list_voices", {});
  await tool("justvoice.list_voices", { limit: 3 });
  await tool("justvoice.list_voices", { limit: "5" });
  await tool("justvoice.list_voices", { limit: true });
  await tool("justvoice.list_voices", { limit: 0 });
  await tool("justvoice.list_voices", { limit: 1001 });
  await tool("justvoice.list_voices", { limit: "x" });
  await tool("justvoice.list_voices", { limit: 2.5 });
  await tool("justvoice.list_voices", { limit: null });
  await tool("justvoice.list_voices", { limit: [1] });
  await tool("justvoice.list_voices", { limit: 1, extra: "x", other: 2 });
  await tool("justvoice.list_personas", {});
  await tool("justvoice.list_personas", undefined);
  await tool("justvoice.list_personas", { bogus: 1 });
  await tool("justvoice.transcribe", {});
  await tool("justvoice.transcribe", { audio_base64: "QUJD", audio_path: "C:\\x.wav" });
  await tool("justvoice.transcribe", { audio_path: "relative/x.wav" });
  await tool("justvoice.transcribe", { audio_path: "/abs/x.wav" });
  await tool("justvoice.transcribe", { audio_path: "C:\\definitely\\not\\here.wav" });
  for (const b64 of ["@@@", "QUJD=", "=QUJD", "QQ", "QUJDR", "QU=JD", "QUI=x", "é", "QU JD"]) await tool("justvoice.transcribe", { audio_base64: b64 });
  await tool("justvoice.transcribe", { audio_path: "", audio_base64: "QUJD" });
  await tool("justvoice.transcribe", { audio_path: 5, audio_base64: { a: 1 } });
  await tool("nope", {});
  await rpc("ping", "ping");
  await rpc("prompts/list", "prompts/list", {});
  await rpc("resources/list", "resources/list", {});
  await rpc("resources/templates/list", "resources/templates/list", {});
  await rpc("logging/setLevel", "logging/setLevel", { level: "info" });
  await rpc("completion/complete (not served)", "completion/complete", {});
  // Two more sessions: an older protocol and one neither side knows.
  for (const v of ["2024-10-07", "1999-01-01", "2025-03-26"]) keep(`initialize ${v}`, await call(port, init(v)));
  // The transport's refusals.
  keep("POST with no session", await call(port, { jsonrpc: "2.0", id: 99, method: "tools/list" }));
  keep("POST to an unknown session", await call(port, { jsonrpc: "2.0", id: 99, method: "tools/list" }, { sid: "0123456789abcdef0123456789abcdef" }));
  keep("GET without SSE", await call(port, null, { method: "GET", accept: "application/json" }));
  keep("POST that won't take SSE", await call(port, init("2025-06-18"), { accept: "application/json" }));
  return out;
}

try {
  const pyData = dataCopy(dir, "py-data", { links: [] });
  const jsData = dataCopy(dir, "js-data", { links: [] });
  const pyPort = await freePort();
  const jsPort = await freePort();
  ports.push(pyPort, jsPort);
  console.log(`ports: python ${pyPort}, js ${jsPort}`);

  // ── Python ──
  const procs = await import("@delebash/llm-runner/platform/procs");
  pyProc = procs.popen([PY, join(HERE, "compare-mcp.py"), "serve", pyData, String(pyPort)], {
    cwd: SERVER,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  let pyErr = "";
  pyProc.stdout?.resume();
  pyProc.stderr?.on("data", (c) => {
    pyErr += c;
  });
  for (let i = 0; i < 120 && !(await listening(pyPort)); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await listening(pyPort))) throw new Error(`the Python MCP app did not start:\n${pyErr.slice(-2000)}`);

  // ── this port ──
  const { createServer } = await import("@delebash/llm-runner/platform/server");
  const session = await import("../src/database/session.js");
  const { AppState, setState } = await import("../src/app_state.js");
  const runtime = await import("../src/engines/audiocpp/runtime.js");
  const { mountInto } = await import("../src/mcp/index.js");
  session.initDb(jsData);
  setState(new AppState(jsData));
  await runtime.ensureHardware();
  jsApp = createServer({ typeBase: "https://justvoice.dev/errors/" });
  const mcp = mountInto(jsApp);
  await jsApp.listen({ host: "127.0.0.1", port: jsPort });

  const pyOut = await script(pyPort);
  const jsOut = await script(jsPort);
  await mcp.close();

  let diffs = 0;
  pyOut.forEach((p, i) => {
    const ds = compare(p, jsOut[i]);
    if (ds.length) {
      diffs += ds.length;
      for (const d of ds.slice(0, 4)) console.log(`  DIFF ${p.label}: ${d.slice(0, 400)}`);
    }
  });
  const tools = pyOut.find((x) => x.label === "tools/list").body.result.tools.length;
  const voices = pyOut.find((x) => x.label.startsWith("tools/call justvoice.list_voices {}")).body.result.structuredContent.total;
  const personas = pyOut.find((x) => x.label.startsWith("tools/call justvoice.list_personas {}")).body.result.structuredContent.personas.length;
  console.log(`answers: ${pyOut.length} exchanges (${tools} tools, ${voices} voices, ${personas} personas): ${diffs} different`);

  // ── the rows the client-id header stamped ──
  await jsApp.close();
  jsApp = null;
  session.closeDb();
  pyProc.kill();
  for (let i = 0; i < 40 && (await listening(pyPort)); i++) await new Promise((r) => setTimeout(r, 250));
  const { openDatabase } = await import("@delebash/llm-runner/platform/sql");
  const rows = (file) => {
    const db = openDatabase(file, { foreignKeys: false, readonly: true });
    const out = db.all("select client_id, label, persona_id, default_engine, last_seen_at is not null as seen, created_at is not null as created from mcp_bindings order by rowid");
    db.close();
    return out;
  };
  const pyRows = rows(join(pyData, "justvoice.db"));
  const jsRows = rows(join(jsData, "justvoice.db"));
  const rowDiffs = compare(pyRows, jsRows);
  for (const d of rowDiffs) console.log(`  DIFF mcp_bindings: ${d}`);
  diffs += rowDiffs.length;
  console.log(`mcp_bindings: ${pyRows.length} rows (${pyRows.map((r) => r.client_id).join(", ")}): ${rowDiffs.length} different`);
  console.log(diffs ? `FAILED: ${diffs} differences` : "identical");
  if (diffs) exitCode = 1;
} finally {
  if (jsApp) await jsApp.close().catch(() => {});
  if (pyProc && pyProc.exitCode === null) pyProc.kill();
  try {
    (await import("../src/database/session.js")).closeDb();
  } catch {}
  for (let i = 0; i < 40 && ports.length && (await Promise.all(ports.map(listening))).some(Boolean); i++) await new Promise((r) => setTimeout(r, 250));
  const still = [];
  for (const p of ports) if (await listening(p)) still.push(p);
  console.log(still.length ? `PORTS STILL OPEN: ${still.join(", ")}` : `ports ${ports.join(", ")} are free`);
  cleanup(dir);
  console.log(`removed ${dir}`);
}
process.exitCode = exitCode;
