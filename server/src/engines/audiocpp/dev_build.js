// SPDX-License-Identifier: MIT
// A development build of audio.cpp — what `npm run dev` runs instead of the pinned release
// (the port of justvoice/engines/audiocpp/dev_build.py).
//
// `scripts/audiocpp-dev.js` builds our fork's checkout beside this one (`../audio.cpp`, into
// `build/jv-dev`) before the app starts and names its bin folder in JUSTVOICE_AUDIOCPP_BUILD
// (docs/dev/TASKS.md, "`npm run dev` always runs the latest audio.cpp"). With it set, the kit's
// audio.cpp runtime runs it in place of an installed build (installLlm's
// `runtimeExeOverrides.audiocpp`, app.js — round E):
// - its server is that build's, never a downloaded one;
// - every feature the kit knows is on, both what the app offers and what the build answers for
//   (kit_settings.js `shippedHas`, `runtimeHas`) — the dev build is the fork's latest;
// - its backend comes from the build's own CMake cache;
// - the runtime row says it is the development build (`version`).
//
// A packaged app ignores the variable.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { runtime as dataRuntime } from "@delebash/core/platform/data_paths";
import { getLogger } from "@delebash/core/platform/log";
import { splitlines } from "@delebash/core/platform/py";

const log = getLogger("justvoice.engines.audiocpp.dev_build");

export const ENV = "JUSTVOICE_AUDIOCPP_BUILD";
export const SERVER_EXE = process.platform === "win32" ? "audiocpp_server.exe" : "audiocpp_server";

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
