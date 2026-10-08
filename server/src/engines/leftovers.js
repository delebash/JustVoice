// SPDX-License-Identifier: MIT
// Speech-runtime processes left behind by a server that is gone — found, measured, stopped
// (decided 2026-09-29; the runtime since 2026-10-01). The port of
// justvoice/engines/leftovers.py.
//
// Every speech model runs in an audio.cpp server process our server starts
// (`engines/audiocpp/runtime.js`). On Windows it sits in a kill-on-close Job Object, so it dies
// with our server however that server dies; elsewhere, or for one an older JustVoice left,
// this module is the sweep:
//   - run once when the server starts (`stopLeftoverEngines`, from app.js);
//   - `GET /v1/engines/leftovers` / `POST /v1/engines/leftovers/stop`, which the boot
//     splash's failed-load box offers as a button.
//
// Only THIS install's runtime is touched: a process counts only when it runs a binary under
// this install's runtime folder, or the development build `npm run dev` points it at
// (`audiocpp/dev_build.js`). One whose server is alive is never touched — that includes a
// second JustVoice server on the same install (the renderer gate runs one).
//
// Python read the process table with psutil; here it is one table read per call — Windows'
// process table through PowerShell (CIM), Linux's /proc, macOS' ps — and a process's own
// environment (`JUSTVOICE_SERVER_PID`) from its process block on Windows (kernel32/ntdll
// through koffi, as the kit's job object), /proc on Linux; where it can't be read the parent
// is the server, as Python fell back.

import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { sleep } from "@delebash/llm-runner/platform/asyncutil";
import { getLogger } from "@delebash/llm-runner/platform/log";
import * as procs from "@delebash/llm-runner/platform/procs";
import * as hardware from "@delebash/llm-runner/runner/hardware";
import * as devBuild from "./audiocpp/dev_build.js";
import * as manager from "./manager.js";
import * as self from "./leftovers.js";

const log = getLogger("justvoice.engines.leftovers");

/** One leftover process tree. */
export class Leftover {
  constructor({ pid, engineId, started, serverPid, pids = [], gpuMb = null }) {
    this.pid = pid; // the tree's root
    this.engineId = engineId;
    this.started = started; // epoch seconds
    this.serverPid = serverPid; // who started it, when known
    this.pids = pids; // the whole tree, root first
    this.gpuMb = gpuMb;
  }
}

const normcase = (p) => (process.platform === "win32" ? path.normalize(p).toLowerCase() : path.normalize(p));

/** normcase(every dir this install's audio.cpp servers live under): the runtime folder, and
 * the development build's bin folder when `npm run dev` points at one. */
export function _audiocppRoots() {
  const roots = [normcase(path.join(String(manager.enginesRuntimeRoot()), "audiocpp"))];
  const dev = devBuild.current();
  if (dev !== null) roots.push(normcase(dev.binDir));
  return roots;
}

/** "audiocpp" when this command line runs a binary under one of this install's runtime
 * folders (our own server, started with JUSTVOICE_SERVER_PID set), else null. */
export function _engineIdOf(cmdline, audiocppRoots) {
  if (cmdline && cmdline.length && audiocppRoots.some((r) => r && normcase(cmdline[0]).startsWith(r))) return "audiocpp";
  return null;
}

// ── the process table ───────────────────────────────────────────────────────

/** CommandLineToArgvW's rules: argv[0] up to the closing quote or the first space; then
 * backslashes double before a quote, `""` inside quotes is a literal quote. */
export function _splitWindowsCommandLine(s) {
  const out = [];
  s = String(s ?? "");
  let i = 0;
  // argv[0]
  let a0 = "";
  if (s[0] === '"') {
    i = 1;
    while (i < s.length && s[i] !== '"') a0 += s[i++];
    i += 1;
  } else {
    while (i < s.length && s[i] !== " " && s[i] !== "\t") a0 += s[i++];
  }
  out.push(a0);
  while (i < s.length) {
    while (i < s.length && (s[i] === " " || s[i] === "\t")) i++;
    if (i >= s.length) break;
    let arg = "";
    let inQ = false;
    while (i < s.length && (inQ || (s[i] !== " " && s[i] !== "\t"))) {
      if (s[i] === "\\") {
        let n = 0;
        while (s[i] === "\\") {
          n++;
          i++;
        }
        if (s[i] === '"') {
          arg += "\\".repeat(Math.floor(n / 2));
          if (n % 2) {
            arg += '"';
            i++;
          }
        } else arg += "\\".repeat(n);
      } else if (s[i] === '"') {
        if (inQ && s[i + 1] === '"') {
          arg += '"';
          i += 2;
        } else {
          inQ = !inQ;
          i++;
        }
      } else arg += s[i++];
    }
    out.push(arg);
  }
  return out;
}

async function windowsTable() {
  const ps =
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8; " +
    "Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{p=$_.ProcessId;q=$_.ParentProcessId;" +
    "e=$_.ExecutablePath;c=$_.CommandLine;t=$(if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString('o')}else{$null})} } " +
    "| ConvertTo-Json -Compress";
  const r = await procs.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], { timeout: 60 });
  let rows = JSON.parse(String(r.stdout).trim() || "[]");
  if (!Array.isArray(rows)) rows = [rows];
  return rows.map((x) => ({
    pid: Number(x.p),
    ppid: Number(x.q),
    exe: x.e || null,
    cmdline: x.c ? self._splitWindowsCommandLine(x.c) : [],
    created: x.t ? Date.parse(x.t) / 1000 : 0,
  }));
}

let bootSeconds = null;
function linuxTable() {
  if (bootSeconds === null) {
    const stat = readFileSync("/proc/stat", "utf8");
    bootSeconds = Number(/^btime\s+(\d+)/m.exec(stat)?.[1] ?? 0);
  }
  const hz = 100; // USER_HZ — 100 on every Linux this runs on
  const out = [];
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, "utf8");
      const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const cmdline = readFileSync(`/proc/${name}/cmdline`, "utf8").split("\0").filter((x, i, a) => i < a.length - 1 || x);
      let exe = null;
      try {
        exe = readlinkSync(`/proc/${name}/exe`);
      } catch {
        /* another user's */
      }
      out.push({ pid: Number(name), ppid: Number(rest[1]), exe, cmdline, created: bootSeconds + Number(rest[19]) / hz });
    } catch {
      /* gone meanwhile */
    }
  }
  return out;
}

async function macTable() {
  const r = await procs.run(["ps", "-axo", "pid=,ppid=,etime=,command="], { timeout: 15 });
  const now = Date.now() / 1000;
  const out = [];
  for (const line of String(r.stdout).split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const [d, hms] = m[3].includes("-") ? m[3].split("-") : [0, m[3]];
    const parts = hms.split(":").map(Number);
    while (parts.length < 3) parts.unshift(0);
    const elapsed = Number(d) * 86400 + parts[0] * 3600 + parts[1] * 60 + parts[2];
    const cmdline = m[4].split(" ");
    out.push({ pid: Number(m[1]), ppid: Number(m[2]), exe: cmdline[0] || null, cmdline, created: now - elapsed });
  }
  return out;
}

/** Every live process: `{pid, ppid, exe, cmdline (array), created (epoch seconds)}`. */
export async function processTable() {
  if (process.platform === "win32") return windowsTable();
  if (process.platform === "linux") return linuxTable();
  return macTable();
}

// ── a process's own environment ─────────────────────────────────────────────

let winApi = null;
function windowsApi() {
  if (winApi) return winApi;
  const require = createRequire(import.meta.resolve("@delebash/llm-runner/runner/process"));
  const koffi = require("koffi");
  const k32 = koffi.load("kernel32.dll");
  const nt = koffi.load("ntdll.dll");
  winApi = {
    OpenProcess: k32.func("OpenProcess", "void *", ["uint32", "bool", "uint32"]),
    CloseHandle: k32.func("CloseHandle", "bool", ["void *"]),
    ReadProcessMemory: k32.func("ReadProcessMemory", "bool", ["void *", "uint64", "void *", "size_t", "void *"]),
    NtQueryInformationProcess: nt.func("NtQueryInformationProcess", "int32", ["void *", "int", "void *", "uint32", "void *"]),
  };
  return winApi;
}

/** A 64-bit process's environment block, read from its PEB (psutil's own method): the
 * process parameters at PEB+0x20, their Environment at +0x80 and EnvironmentSize at +0x3F0. */
function windowsEnviron(pid) {
  const api = windowsApi();
  const h = api.OpenProcess(0x0410, false, pid); // PROCESS_QUERY_INFORMATION | PROCESS_VM_READ
  if (!h) return null;
  try {
    const read = (addr, n) => {
      const b = Buffer.alloc(n);
      return api.ReadProcessMemory(h, addr, b, n, null) ? b : null;
    };
    const pbi = Buffer.alloc(48);
    if (api.NtQueryInformationProcess(h, 0, pbi, 48, null) !== 0) return null;
    const peb = pbi.readBigUInt64LE(8);
    const pebHead = peb ? read(peb, 0x28) : null;
    if (!pebHead) return null;
    const params = read(pebHead.readBigUInt64LE(0x20), 0x3f8);
    if (!params) return null;
    const envAddr = params.readBigUInt64LE(0x80);
    const envSize = Number(params.readBigUInt64LE(0x3f0));
    if (!envAddr || envSize <= 0 || envSize > 1 << 24) return null;
    const block = read(envAddr, envSize);
    if (!block) return null;
    const out = {};
    for (const kv of block.toString("utf16le").split("\0")) {
      if (!kv) break;
      const i = kv.indexOf("=", 1);
      if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1);
    }
    return out;
  } finally {
    api.CloseHandle(h);
  }
}

/** `pid`'s environment (an object), or null when it can't be read (psutil's AccessDenied). */
export function _environOf(pid) {
  try {
    if (process.platform === "win32") return windowsEnviron(pid);
    if (process.platform === "linux") {
      const out = {};
      for (const kv of readFileSync(`/proc/${pid}/environ`, "utf8").split("\0")) {
        const i = kv.indexOf("=");
        if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1);
      }
      return out;
    }
  } catch {
    /* refused */
  }
  return null;
}

const envGet = (env, key) => {
  if (!env) return undefined;
  for (const [k, v] of Object.entries(env)) if (k.toUpperCase() === key) return v;
  return undefined;
};

/** [gone?, server pid]. The server pid comes from the process's environment
 * (`JUSTVOICE_SERVER_PID`); a pid that now belongs to a process started AFTER this one was
 * recycled, so that server is gone too. With no variable the parent is the server. */
export function _serverGone(proc, byPid) {
  let serverPid = null;
  const raw = String(envGet(self._environOf(proc.pid), "JUSTVOICE_SERVER_PID") ?? "");
  if (/^\d+$/.test(raw.trim())) serverPid = Number(raw.trim());
  if (serverPid === null) serverPid = proc.ppid;
  if (serverPid === process.pid) return [false, serverPid];
  const server = byPid.get(serverPid);
  if (server === undefined) return [true, serverPid];
  if (server.created > proc.created + 1) return [true, serverPid]; // pid recycled after the engine started
  return [false, serverPid];
}

function descendants(pid, table) {
  const kids = new Map();
  for (const p of table) {
    if (!kids.has(p.ppid)) kids.set(p.ppid, []);
    kids.get(p.ppid).push(p.pid);
  }
  const out = [];
  const stack = [...(kids.get(pid) ?? [])];
  const seen = new Set([pid]);
  while (stack.length) {
    const cur = stack.shift();
    if (seen.has(cur)) continue;
    seen.add(cur);
    out.push(cur);
    stack.push(...(kids.get(cur) ?? []));
  }
  return out;
}

/** This install's runtime process trees whose server is gone. */
export async function findLeftoverEngines({ measure = true } = {}) {
  let table;
  try {
    table = await self.processTable();
  } catch (e) {
    log.debug(`process table unavailable: ${e?.message ?? e}`);
    return [];
  }
  const roots = self._audiocppRoots();
  const byPid = new Map(table.map((p) => [p.pid, p]));
  const engines = new Map();
  for (const p of table) {
    let eid = null;
    try {
      eid = self._engineIdOf(p.cmdline || [], roots);
    } catch {
      eid = null;
    }
    if (eid) engines.set(p.pid, [p, eid]);
  }
  const out = [];
  for (const [pid, [proc, eid]] of engines) {
    if (engines.has(proc.ppid)) continue; // a child of another engine process — its root decides
    const [gone, serverPid] = self._serverGone(proc, byPid);
    if (!gone) continue;
    const tree = [pid, ...descendants(pid, table)];
    out.push(new Leftover({ pid, engineId: eid, started: proc.created, serverPid, pids: tree }));
  }
  if (measure && out.length) {
    const held = await self._gpuByPid();
    if (held !== null) {
      for (const lo of out) lo.gpuMb = lo.pids.reduce((s, p) => s + (held.get(p) ?? 0), 0);
    }
  }
  return out.sort((a, b) => a.started - b.started);
}

/** pid → GPU MB (a Map) for every process holding any, from the kit's ONE whole-machine query
 * (`gpuProcesses`). Not the per-tree probe: on Windows that runs a counter query per pid,
 * ~1 s each, and the sweep runs at startup. null = unmeasurable here. */
export async function _gpuByPid() {
  let snap;
  try {
    snap = await hardware.gpuProcesses({ fresh: true });
  } catch {
    return null; // measuring is informative only
  }
  if (snap == null) return null;
  return new Map((snap.processes || []).map((r) => [Number(r.pid), Number(r.memMb)]));
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === "EPERM";
  }
};

/** Stop every leftover engine tree (children first) and log what it held. */
export async function stopLeftoverEngines(reason = "startup sweep") {
  const found = await self.findLeftoverEngines();
  if (!found.length) return [];
  for (const lo of found) {
    const killed = [];
    for (const p of [...lo.pids].reverse()) {
      // children before their launcher
      try {
        process.kill(p, "SIGKILL");
        killed.push(p);
      } catch {
        /* gone, or not ours to kill */
      }
    }
    const deadline = Date.now() + 5000;
    while (killed.some(alive) && Date.now() < deadline) await sleep(100);
  }
  const freed = found.reduce((s, lo) => s + (lo.gpuMb || 0), 0);
  log.warning(
    `${reason}: stopped ${found.length} leftover engine process tree(s) whose server is gone — ` +
      found.map((lo) => `${lo.engineId} pid ${lo.pid} (server ${lo.serverPid}, ${lo.gpuMb ?? "?"} MB)`).join(", ") +
      ` — freeing about ${freed} MB of GPU memory`,
  );
  return found;
}
