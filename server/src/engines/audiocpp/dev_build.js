// SPDX-License-Identifier: MIT
// A development build of audio.cpp — what `npm run dev` runs instead of the pinned release
// (the port of justvoice/engines/audiocpp/dev_build.py).
//
// `scripts/audiocpp-dev.js` builds our fork's checkout beside this one (`../audio.cpp`, into
// `build/jv-dev`) before the app starts and names its bin folder in JUSTVOICE_AUDIOCPP_BUILD
// (docs/dev/TASKS.md, "`npm run dev` always runs the latest audio.cpp"). With it set:
// - `runtime.installedExe` is that build's server, never a downloaded one;
// - every feature in `release.FEATURES` is on, both what the app offers (`release.pinnedHas`)
//   and what the build answers for (`runtime.hasFeature`) — the dev build is the fork's latest;
// - its backend comes from the build's own CMake cache;
// - the runtime row says it is the development build, and Install fetches only eSpeak NG.
//
// A packaged app ignores the variable. The wrapper's check before it builds (decided D5):
//
//     node scripts/node24.js server/src/engines/audiocpp/dev_build.js --stop-leftovers
//
// stops a server a crashed session left on this build, and exits 3 when one is still served
// by a running app.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runtime as dataRuntime } from "@delebash/llm-runner/platform/data_paths";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { splitlines } from "@delebash/llm-runner/platform/py";
import * as self from "./dev_build.js";

const log = getLogger("justvoice.engines.audiocpp.dev_build");

export const ENV = "JUSTVOICE_AUDIOCPP_BUILD";
export const TAG = "dev"; // what `runtime.installedTag` answers for a development build
export const SERVER_EXE = process.platform === "win32" ? "audiocpp_server.exe" : "audiocpp_server";
export const DSP_EXE = process.platform === "win32" ? "audiocpp_dsp.exe" : "audiocpp_dsp";

export class DevBuild {
  constructor({ binDir, exe, backend, commit, dirty, source }) {
    this.binDir = binDir;
    this.exe = exe;
    this.backend = backend; // "cuda" | "vulkan" | "metal" | "cpu" — from the build's CMake cache
    this.commit = commit; // the checkout's commit when it was built ("" when unknown)
    this.dirty = dirty; // the checkout had uncommitted edits
    this.source = source; // the checkout, relative to this one ("..\\audio.cpp")
    Object.freeze(this);
  }

  /** The runtime row's version (decided D4): "dev · 6a2bb4c5 + local changes". */
  get version() {
    const out = this.commit ? `dev · ${this.commit}` : "dev";
    return this.dirty ? `${out} + local changes` : out;
  }
}

function backendOf(cache) {
  let text;
  try {
    text = readFileSync(cache).toString("utf8");
  } catch {
    return "cpu";
  }
  const on = new Set(splitlines(text).filter((l) => l.endsWith(":BOOL=ON")).map((l) => l.split(":", 1)[0]));
  for (const [key, backend] of [
    ["ENGINE_ENABLE_CUDA", "cuda"],
    ["ENGINE_ENABLE_VULKAN", "vulkan"],
    ["ENGINE_ENABLE_METAL", "metal"],
    ["GGML_METAL", "metal"],
  ]) {
    if (on.has(key)) return backend;
  }
  return "cpu";
}

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

// functools.cache: the answer is kept until `current.cacheClear()`.
const memo = { has: false, value: null };

/** The development build `npm run dev` pointed this server at, or null. */
export function current() {
  if (memo.has) return memo.value;
  memo.value = compute();
  memo.has = true;
  return memo.value;
}
current.cacheClear = () => {
  memo.has = false;
  memo.value = null;
};

function compute() {
  const raw = String(process.env[ENV] || "").trim();
  if (!raw || dataRuntime.frozen) return null;
  const binDir = path.normalize(raw);
  const exe = path.join(binDir, SERVER_EXE);
  if (!isFile(exe)) {
    log.warning(`${ENV} names ${binDir}, which has no ${SERVER_EXE} — running the pinned release`);
    return null;
  }
  let info = {};
  try {
    info = JSON.parse(readFileSync(path.join(binDir, "jv-dev-build.json"), "utf8"));
    if (info === null || typeof info !== "object") info = {};
  } catch {
    info = {};
  }
  return new DevBuild({
    binDir,
    exe,
    backend: backendOf(path.join(path.dirname(binDir), "CMakeCache.txt")),
    commit: String(info.commit || ""),
    dirty: Boolean(info.dirty),
    source: String(info.source || path.dirname(path.dirname(path.dirname(binDir)))),
  });
}

const normcase = (p) => (process.platform === "win32" ? path.normalize(p).toLowerCase() : path.normalize(p));

/** Whether `exe` is the development build's server (a Windows path compares caseless, as
 * pathlib does). */
export function isDevExe(exe) {
  const dev = self.current();
  return dev !== null && exe != null && normcase(String(exe)) === normcase(dev.exe);
}

/** Stop this build's servers whose JustVoice is gone; 3 when one is still served. The DSP
 * program counts too: a running one holds its exe, which the build replaces. */
export async function _stopLeftovers() {
  const leftovers = await import("../leftovers.js");
  const dev = self.current();
  if (dev === null) return 0;
  // The app's own sweep: every audio.cpp server (this build's included) whose JustVoice is gone.
  const stopped = await leftovers.stopLeftoverEngines("npm run dev");
  if (stopped.length) console.log(`[audio.cpp] stopped ${stopped.length} audio.cpp server(s) left by a closed JustVoice`);
  const want = new Set([normcase(dev.exe), normcase(path.join(dev.binDir, DSP_EXE))]);
  for (const p of await leftovers.processTable()) {
    if (p.exe && want.has(normcase(p.exe))) {
      console.log(`[audio.cpp] ${path.basename(p.exe)} (pid ${p.pid}) is still running for an open JustVoice`);
      return 3;
    }
  }
  return 0;
}

// `node … dev_build.js --stop-leftovers` (the module run as a program — Python's __main__).
const isMain = (() => {
  try {
    return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (isMain) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--stop-leftovers") {
    self._stopLeftovers().then(
      (code) => process.exit(code),
      (e) => {
        console.error(e?.stack || e);
        process.exit(1);
      },
    );
  } else {
    console.log("usage: node scripts/node24.js server/src/engines/audiocpp/dev_build.js --stop-leftovers");
    process.exit(2);
  }
}
