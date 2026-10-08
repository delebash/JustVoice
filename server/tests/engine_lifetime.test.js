// SPDX-License-Identifier: MIT
// The speech runtime never outlives its server (decided 2026-09-29; the runtime since the
// 2026-10-01 switch). The parts pinned here with REAL processes where it matters:
//   1. on Windows the runtime sits in the kit's kill-on-close Job Object
//      (`runner/process.spawnChild`), so it dies with its server however the server dies;
//   2. a startup sweep stops this install's runtime whose server is gone
//      (`engines/leftovers.js`).
// (The port of tests/test_engine_lifetime.py. Python's stand-in processes were Python
// sleepers; here they are Node sleepers on this test's own runtime.)
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { addSink } from "@delebash/llm-runner/platform/log";
import * as procs from "@delebash/llm-runner/platform/procs";
import * as hardware from "@delebash/llm-runner/runner/hardware";
import { pollProc, waitExit } from "@delebash/llm-runner/runner/process";
import { afterEach, expect, test, vi } from "vitest";
import "./engines_helpers.js";
import * as systemApi from "../src/api/system_api.js";
import * as leftovers from "../src/engines/leftovers.js";
import * as manager from "../src/engines/manager.js";
import { client, closeApps, makeApp } from "./app_helpers.js";
import { tmpPath } from "./helpers.js";

const NODE = process.execPath;
const sleeper = (seconds, extra = [], env = {}) =>
  procs.popen([NODE, "-e", `setTimeout(() => {}, ${Math.round(seconds * 1000)})`, ...(extra.length ? ["--", ...extra] : [])], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "ignore", "ignore"],
  });

async function deadPid() {
  const p = sleeper(0);
  await waitExit(p, 30);
  return p.pid;
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === "EPERM";
  }
};
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const kill = async (p) => {
  if (pollProc(p) === null) {
    p.kill("SIGKILL");
    await waitExit(p, 10);
  }
};

// ── 1. the runtime dies with its server ─────────────────────────────────────

test.skipIf(process.platform !== "win32")("the_runtime_dies_when_its_server_is_hard_killed", async () => {
  // End to end, the way the app spawns it: a stand-in server spawns a stand-in runtime through
  // the kit's spawn seam, then the server is killed the hard way (TerminateProcess — no exit
  // hook). The runtime must be gone a moment later.
  const kitProcess = pathToFileURL(path.resolve(import.meta.dirname, "../../node_modules/@delebash/llm-runner/src/runner/process.js")).href;
  const script = path.join(tmpPath(), "server.mjs");
  writeFileSync(
    script,
    `const { spawnChild } = await import(${JSON.stringify(kitProcess)});
const [proc] = await spawnChild(null, [process.execPath, "-e", "setTimeout(() => {}, 120000)"], null);
process.stdout.write(proc.pid + "\\n");
setTimeout(() => {}, 120000);
`,
  );
  const server = procs.popen([NODE, script], { env: process.env });
  let child = null;
  try {
    child = await new Promise((resolve, reject) => {
      let buf = "";
      server.stdout.on("data", (d) => {
        buf += d;
        if (buf.includes("\n")) resolve(Number.parseInt(buf, 10));
      });
      server.once("exit", () => reject(new Error(`server exited: ${buf}`)));
      setTimeout(() => reject(new Error("no child pid")), 30000);
    });
    expect(alive(child), "the runtime must run while its server lives").toBe(true);
    server.kill("SIGKILL");
    await waitExit(server, 10);
    const deadline = Date.now() + 10000;
    while (alive(child) && Date.now() < deadline) await sleepMs(200);
    expect(alive(child), "the runtime outlived its server").toBe(false);
  } finally {
    await kill(server);
    if (child && alive(child)) process.kill(child, "SIGKILL");
  }
});

// ── 2. the startup sweep ────────────────────────────────────────────────────

const FAKE = "--jv-fake-runtime";

/** A sleeping node tagged FAKE counts as the runtime — the sweep's server-gone logic under
 * test, without a real binary. */
function runtimeRoot() {
  vi.spyOn(leftovers, "_engineIdOf").mockImplementation((cmdline) => (cmdline.includes(FAKE) ? "audiocpp" : null));
}
const fakeRuntime = (serverPid) => sleeper(120, [FAKE], { JUSTVOICE_SERVER_PID: String(serverPid) });

test("a_runtime_whose_server_is_gone_is_a_leftover", async () => {
  runtimeRoot();
  const rt = fakeRuntime(await deadPid());
  try {
    await sleepMs(500);
    const found = (await leftovers.findLeftoverEngines({ measure: false })).filter((lo) => lo.pid === rt.pid);
    expect(found.length).toBe(1);
    expect(found[0].engineId).toBe("audiocpp");
  } finally {
    await kill(rt);
  }
}, 60000);

test("a_runtime_whose_server_lives_is_never_touched", async () => {
  // Another JustVoice server on this install (the renderer gate runs one) keeps its runtime —
  // and so does this one.
  runtimeRoot();
  const server = sleeper(120);
  const theirs = fakeRuntime(server.pid);
  const ours = fakeRuntime(process.pid);
  try {
    await sleepMs(500);
    const pids = new Set((await leftovers.findLeftoverEngines({ measure: false })).map((lo) => lo.pid));
    expect(pids.has(theirs.pid)).toBe(false);
    expect(pids.has(ours.pid)).toBe(false);
  } finally {
    for (const p of [theirs, ours, server]) await kill(p);
  }
}, 60000);

test("only_a_binary_under_this_installs_runtime_folder_counts", () => {
  const roots = [path.normalize("C:\\data\\engines-runtime\\audiocpp").toLowerCase()];
  expect(leftovers._engineIdOf(["C:\\data\\engines-runtime\\audiocpp\\v0.9.0\\cuda12\\audiocpp_server.exe", "--config", "x"], roots)).toBe(
    "audiocpp",
  );
  expect(leftovers._engineIdOf(["C:\\elsewhere\\audiocpp_server.exe"], roots)).toBeNull();
  expect(leftovers._engineIdOf(["python", "E:/x/engines/kokoro/engine.py", "serve"], roots)).toBeNull();
  expect(leftovers._engineIdOf([], roots)).toBeNull();
});

let removeSink = null;
afterEach(async () => {
  await closeApps();
  if (removeSink) removeSink();
  removeSink = null;
});

test("stop_kills_the_tree_and_reports_what_it_freed", async () => {
  const rt = fakeRuntime(await deadPid());
  const lo = new leftovers.Leftover({ pid: rt.pid, engineId: "audiocpp", started: Date.now() / 1000, serverPid: 1, pids: [rt.pid], gpuMb: 1295 });
  vi.spyOn(leftovers, "findLeftoverEngines").mockResolvedValue([lo]);
  const records = [];
  removeSink = addSink((r) => records.push(r));
  try {
    const out = await leftovers.stopLeftoverEngines("startup sweep");
    expect(out).toEqual([lo]);
    expect(await waitExit(rt, 10)).not.toBeNull();
    const text = records
      .filter((r) => r.name === "justvoice.engines.leftovers" && r.levelno >= 30)
      .map((r) => r.msg)
      .join("\n");
    expect(text).toContain("audiocpp pid");
    expect(text).toContain("1295");
  } finally {
    await kill(rt);
  }
}, 60000);

test("gpu_is_measured_with_one_whole_machine_query", async () => {
  // Not the per-tree probe (a counter query per pid on Windows, ~1 s each — the sweep runs at
  // startup).
  const calls = [];
  vi.spyOn(hardware, "gpuProcesses").mockImplementation(async ({ fresh = false } = {}) => {
    calls.push(fresh);
    return { processes: [{ pid: 10, memMb: 4 }, { pid: 11, memMb: 1291 }, { pid: 99, memMb: 500 }] };
  });
  expect(await leftovers._gpuByPid()).toEqual(new Map([[10, 4], [11, 1291], [99, 500]]));
  expect(calls).toEqual([true]);
});

// ── 3. POST /v1/shutdown · 4. the endpoints behind the splash's button ─────

const SYSTEM_CFG = { ...systemApi.cfg };

test("shutdown_is_refused_from_another_machine", async () => {
  const app = await makeApp();
  expect((await client(app, { remoteAddress: "192.168.1.20" }).post("/v1/shutdown")).status).toBe(403);
});

test("shutdown_stops_engines_and_ends_the_server", async () => {
  const app = await makeApp();
  const stopped = [];
  const timers = [];
  const exits = [];
  vi.spyOn(manager, "shutdownManager").mockImplementation(async () => stopped.push(true));
  // never the real timer: it would end this test run
  systemApi.cfg.startTimer = (s, fn) => timers.push([s, fn]);
  systemApi.cfg.exit = (code) => exits.push(code);
  const server = { stopped: [], stop: (why) => server.stopped.push(why) };
  app.serverHandle = server;
  try {
    const r = await client(app, { remoteAddress: "127.0.0.1" }).post("/v1/shutdown");
    expect(r.status).toBe(200);
    expect(r.json()).toEqual({ ok: true, exiting: true });
    expect(stopped, "engines stop before the server goes").toEqual([true]);
    await new Promise((res) => setImmediate(res));
    expect(server.stopped.length).toBe(1); // uvicorn's should_exit
    // A stalled exit still ends: the deadline exits the process.
    expect(timers.length).toBe(1);
    expect(timers[0][0]).toBe(10.0);
    timers[0][1]();
    expect(exits).toEqual([0]);
  } finally {
    Object.assign(systemApi.cfg, SYSTEM_CFG);
    app.serverHandle = null;
  }
});

test("shutdown_without_a_server_handle_only_stops_engines", async () => {
  const app = await makeApp();
  const stopped = [];
  vi.spyOn(manager, "shutdownManager").mockImplementation(async () => stopped.push(true));
  const r = await client(app, { remoteAddress: "127.0.0.1" }).post("/v1/shutdown");
  expect(r.json()).toEqual({ ok: true, exiting: false });
  expect(stopped).toEqual([true]);
});

const twoRuntimes = () => [
  new leftovers.Leftover({ pid: 10, engineId: "audiocpp", started: 1.0, serverPid: 7, pids: [10], gpuMb: 1295 }),
  new leftovers.Leftover({ pid: 20, engineId: "audiocpp", started: 2.0, serverPid: 8, pids: [20], gpuMb: 286 }),
];

test("leftovers_endpoint_names_the_engine_and_sums_the_memory", async () => {
  vi.spyOn(leftovers, "findLeftoverEngines").mockResolvedValue(twoRuntimes());
  const body = (await client(await makeApp()).get("/v1/engines/leftovers")).json();
  expect(body.gpu_mb).toBe(1581);
  expect(body.leftovers.map((r) => [r.pid, r.engine_name, r.gpu_mb])).toEqual([
    [10, "Speech runtime", 1295],
    [20, "Speech runtime", 286],
  ]);
});

test("unmeasurable_memory_is_null_not_zero", async () => {
  const rows = twoRuntimes();
  for (const lo of rows) lo.gpuMb = null;
  vi.spyOn(leftovers, "findLeftoverEngines").mockResolvedValue(rows);
  expect((await client(await makeApp()).get("/v1/engines/leftovers")).json().gpu_mb).toBeNull();
});

test("stop_endpoint_reports_what_it_stopped", async () => {
  const seen = [];
  vi.spyOn(leftovers, "stopLeftoverEngines").mockImplementation(async (reason = "") => {
    seen.push(reason);
    return twoRuntimes();
  });
  const body = (await client(await makeApp()).post("/v1/engines/leftovers/stop")).json();
  expect(body.leftovers.map((r) => r.pid)).toEqual([10, 20]);
  expect(seen).toEqual(["stopped from the app"]);
});

// ── 5. The close works with "Require a token even on localhost" on (2026-09-30) ──

test("shutdown_needs_no_token_from_this_machine", async () => {
  const app = await makeApp();
  const stopped = [];
  vi.spyOn(manager, "shutdownManager").mockImplementation(async () => stopped.push(true));
  systemApi.cfg.startTimer = () => {};
  try {
    const local = client(app, { remoteAddress: "127.0.0.1" });
    const r = await local.patch("/v1/settings", { json: { auth: { tokens: ["t0k"], require_for_loopback: true } } });
    expect(r.status, r.text).toBe(200);
    expect((await local.get("/v1/settings")).status).toBe(401); // the setting is really on

    expect((await local.post("/v1/shutdown")).status).toBe(200); // the shell's close, no token
    expect(stopped).toEqual([true]);
    const remote = client(app, { remoteAddress: "192.168.1.20" });
    expect((await remote.post("/v1/shutdown")).status).toBe(401);
  } finally {
    Object.assign(systemApi.cfg, SYSTEM_CFG);
  }
});
