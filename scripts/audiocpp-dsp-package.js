// SPDX-License-Identifier: MIT
// The audiocpp_dsp an installer carries beside the app's executable — the server's audio math,
// which a packaged app looks for there (server/src/audio/dsp_client.js `findExe`; decided
// 2026-10-07: a separate program "shipped with the app instead of downloaded", with no models and
// no GPU, so it works with nothing installed). Quasar's `beforeBuild` hook stages it into
// dist/audiocpp-dsp/ for an Electron build, and electron-builder's `extraFiles` copies that folder
// beside the executable (quasar.config.js).
//
// Where it comes from, first found wins:
//   1. JUSTVOICE_DSP_EXE — a local build; on Windows the Microsoft C++ runtime DLLs beside it
//      come along;
//   2. the pinned audio.cpp release (server/src/engines/audiocpp/release.js `cfg.TAG`): this
//      platform's CPU archive, refused unless it matches its published sha256, the program taken
//      from it — on Windows with the vcruntime140 / msvcp140 DLLs the archive carries. macOS: the
//      arm64 and x64 programs joined into one universal binary (`lipo`), for the universal .dmg.
// The staged program must start (`--version`, the kit's launch check).
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { _fileSha256, _findServerExe, _unpack, _verifyExeLaunches } from "@delebash/llm-runner/runner/binary";
import { streamDownload } from "@delebash/llm-runner/runner/download";
import * as release from "../server/src/engines/audiocpp/release.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const STAGE = path.join(ROOT, "dist", "audiocpp-dsp");
const ENV_EXE = "JUSTVOICE_DSP_EXE";
const PLATFORM = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";
const EXE = PLATFORM === "windows" ? "audiocpp_dsp.exe" : "audiocpp_dsp";
// the Microsoft C++ runtime a Windows release build loads (the release bundles it, app-local)
const MSVC_RUNTIME = /^(vcruntime140|msvcp140).*\.dll$/i;

/** The CPU archives of the pinned release that hold this platform's program. */
function archives() {
  const tag = release.cfg.TAG;
  if (PLATFORM === "windows") return [`audio-${tag}-bin-windows-x64-cpu-portable.zip`];
  if (PLATFORM === "linux") return [`audio-${tag}-bin-ubuntu-x64-cpu-portable.tar.gz`];
  return [`audio-${tag}-bin-macos-arm64-metal.tar.gz`, `audio-${tag}-bin-macos-x64-metal.tar.gz`];
}

/** One archive of the pinned release, downloaded, checked and unpacked; the program's path. */
async function fromRelease(name, work) {
  const sha = release.SHA256[name];
  if (!sha) {
    throw new Error(
      `${name} has no published sha256 in server/src/engines/audiocpp/release.js — a pin move brings ` +
        `its release's checksums (or set ${ENV_EXE} to a local build)`,
    );
  }
  const archive = path.join(work, name);
  const url = `https://github.com/delebash/audio.cpp/releases/download/${release.cfg.TAG}/${name}`;
  console.log(`[audiocpp_dsp] ${url}`);
  await streamDownload(url, archive, {});
  const got = await _fileSha256(archive);
  if (got.toLowerCase() !== sha.toLowerCase()) throw new Error(`${name} does not match its published sha256 — refusing it`);
  const dir = path.join(work, name.replace(/\.(zip|tar\.gz)$/, ""));
  await _unpack(archive, dir);
  const exe = _findServerExe(dir, EXE);
  if (exe === null) throw new Error(`${EXE} is not in ${name} — the release predates audiocpp_dsp`);
  return exe;
}

/** The program beside its Windows runtime DLLs, copied into the stage. */
function stageWithRuntime(exe) {
  copyFileSync(exe, path.join(STAGE, EXE));
  if (PLATFORM !== "windows") return;
  for (const f of readdirSync(path.dirname(exe))) {
    if (MSVC_RUNTIME.test(f)) copyFileSync(path.join(path.dirname(exe), f), path.join(STAGE, f));
  }
}

/** Fill dist/audiocpp-dsp/ with the program (and what it loads) for this platform's installer. */
export async function stageDsp() {
  rmSync(STAGE, { recursive: true, force: true });
  mkdirSync(STAGE, { recursive: true });
  const local = process.env[ENV_EXE];
  if (local) {
    if (!existsSync(local)) throw new Error(`${ENV_EXE} names ${local}, which doesn't exist`);
    console.log(`[audiocpp_dsp] the local build ${local}`);
    stageWithRuntime(local);
  } else {
    const work = path.join(os.tmpdir(), `jv-audiocpp-dsp-${process.pid}`);
    mkdirSync(work, { recursive: true });
    try {
      const exes = [];
      for (const name of archives()) exes.push(await fromRelease(name, work));
      if (PLATFORM === "macos") {
        // one universal program for the universal .dmg
        const r = spawnSync("lipo", ["-create", ...exes, "-output", path.join(STAGE, EXE)], { stdio: "inherit" });
        if (r.status !== 0) throw new Error("lipo could not join the arm64 and x64 programs");
      } else {
        stageWithRuntime(exes[0]);
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  await _verifyExeLaunches(path.join(STAGE, EXE), PLATFORM);
  console.log(`[audiocpp_dsp] staged: ${readdirSync(STAGE).join(", ")}`);
  return STAGE;
}

// `node scripts/audiocpp-dsp-package.js` stages it by hand
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await stageDsp();
