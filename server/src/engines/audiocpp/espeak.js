// SPDX-License-Identifier: MIT
// eSpeak NG for audio.cpp's Kokoro — fetched onto this machine, never shipped by us (the port
// of justvoice/engines/audiocpp/espeak.py).
//
// audio.cpp's Kokoro phonemizes English, Spanish, French, Hindi, Italian and Portuguese with
// eSpeak NG, and KittenTTS phonemizes English with it, each loading it as a shared library
// from a path we pass: Kokoro reads the runtime's environment (`AUDIOCPP_ESPEAK_LIBRARY` /
// `AUDIOCPP_ESPEAK_DATA`, set by `runtime._childEnv`), KittenTTS its own session options
// (`kitten_tts.espeak_library_path` / `…_data_path`, set by `slot._entriesFor`). Without them
// each falls back to whatever eSpeak NG the system path finds, or fails. eSpeak NG is
// GPL-3.0, so JustVoice (MIT) never bundles it: the user's machine downloads it from PyPI — the
// `espeakng-loader` wheel, which carries the library and its data — and only audio.cpp's
// process loads it. A wheel is a zip: no Python is involved, the same pinned file is fetched,
// verified and its `espeakng_loader/` folder unpacked to the same layout.
//
// Pinned to one version, verified by the wheel's sha256 from PyPI's own record.

import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as http from "@delebash/llm-runner/platform/http";
import { RuntimeError } from "@delebash/llm-runner/platform/py";
import { extractZip } from "@delebash/llm-runner/platform/zip";

export const VERSION = "0.2.4";
export const _SHA256 = {
  win_amd64: "41f1e08ac9deda2efd1ea9de0b81dab9f5ae3c4b24284f76533d0a7b1dd7abd7",
  win_arm64: "d7a2928843eaeb2df82f99a370f44e8a630f59b02f9b0d1f168a03c4eeb76b89",
  manylinux_2_17_x86_64: "08721baf27d13d461f6be6eed9a65277e70d68234ff484fd8b9897b222cdcb6d",
  manylinux_2_28_aarch64: "d1e798141b46a050cdb75fcf3c17db969bb2c40394f3f4a48910655d547508b9",
  macosx_10_12_x86_64: "b77477ae2ddf62a748e04e49714eabb2f3a24f344166200b00539083bd669904",
  macosx_11_0_arm64: "d27cdca31112226e7299d8562e889d3e38a1e48055c9ee381b45d669072ee59f",
};

export function _wheelTag() {
  const arm = ["arm64", "aarch64"].includes(os.arch().toLowerCase());
  if (process.platform === "win32") return arm ? "win_arm64" : "win_amd64";
  if (process.platform === "darwin") return arm ? "macosx_11_0_arm64" : "macosx_10_12_x86_64";
  return arm ? "manylinux_2_28_aarch64" : "manylinux_2_17_x86_64";
}

/** Whether a wheel file serves `tag`. A wheel's last name field can carry several platform
 * tags joined by dots — PyPI's Linux x86_64 file for 0.2.4 is
 * `…-manylinux_2_17_x86_64.manylinux2014_x86_64.whl`, which an exact suffix match missed, so
 * the runtime install could never finish on Linux x86_64 (audit 2026-10-04 §5 A2). */
export function wheelMatches(filename, tag) {
  if (!filename.endsWith(".whl")) return false;
  const stem = filename.slice(0, -".whl".length);
  return stem.slice(stem.lastIndexOf("-") + 1).split(".").includes(tag);
}

export const home = (runtimeRoot) => path.join(String(runtimeRoot), "audiocpp", `espeak-ng-${VERSION}`);

const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** `[library, dataDir]` when installed, else null. */
export function paths(runtimeRoot) {
  const root = home(runtimeRoot);
  let names;
  try {
    names = readdirSync(root);
  } catch {
    return null;
  }
  const libs = names.filter((n) => [".dll", ".so", ".dylib"].includes(path.extname(n)) || n.includes(".so."));
  const data = path.join(root, "espeak-ng-data");
  if (libs.length && isDir(data)) return [path.join(root, libs[0]), data];
  return null;
}

async function getBytes(url, timeoutS) {
  const r = await http.fetch(url, { timeoutMs: timeoutS * 1000 });
  if (!r.ok) throw new http.HttpStatusError(r.status, url, await r.text().catch(() => ""));
  return Buffer.from(await r.arrayBuffer());
}

/** Fetch and unpack the pinned wheel's library + data (idempotent; `force` fetches it again —
 * the runtime row's Reinstall). Returns `[library, dataDir]`. */
export async function install(runtimeRoot, force = false) {
  const got = paths(runtimeRoot);
  if (got && !force) return got;
  const tag = _wheelTag();
  const meta = JSON.parse((await getBytes(`https://pypi.org/pypi/espeakng-loader/${VERSION}/json`, 60)).toString("utf8"));
  const entry = (meta.urls || []).find((u) => wheelMatches(u.filename, tag));
  if (!entry) throw new RuntimeError(`eSpeak NG ${VERSION} has no build for ${tag}`);
  const blob = await getBytes(entry.url, 300);
  const digest = createHash("sha256").update(blob).digest("hex");
  if (digest !== _SHA256[tag]) throw new RuntimeError(`eSpeak NG wheel checksum mismatch (${digest.slice(0, 12)}…) — refusing it`);
  const root = home(runtimeRoot);
  const staging = `${root}.staging`;
  const unpack = `${root}.unpack`;
  const wheel = `${root}.whl`;
  rmSync(staging, { recursive: true, force: true });
  rmSync(unpack, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  try {
    writeFileSync(wheel, blob);
    await extractZip(wheel, unpack);
    // Only the package folder, without its Python wrapper (*.py), lands — the layout the
    // runtime is pointed at.
    const pkg = path.join(unpack, "espeakng_loader");
    const copy = (from, to) => {
      for (const name of readdirSync(from)) {
        const src = path.join(from, name);
        const dst = path.join(to, name);
        if (isDir(src)) {
          copy(src, dst);
        } else if (!name.endsWith(".py")) {
          mkdirSync(to, { recursive: true });
          cpSync(src, dst);
        }
      }
    };
    if (existsSync(pkg)) copy(pkg, staging);
  } finally {
    rmSync(wheel, { force: true });
    rmSync(unpack, { recursive: true, force: true });
  }
  rmSync(root, { recursive: true, force: true });
  renameSync(staging, root);
  const done = paths(runtimeRoot);
  if (!done) throw new RuntimeError("eSpeak NG wheel unpacked without its library or data");
  return done;
}
