#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// `npm run dev` and `npm run tauri …` — the Tauri CLI, with one addition for `dev`: the app
// runs our audio.cpp checkout's latest build, never a release (docs/dev/TASKS.md, "`npm run
// dev` always runs the latest audio.cpp"). Before `tauri dev` starts, ../audio.cpp is built
// (scripts/audiocpp-dev.js, only what changed) and its bin folder goes to the server in
// JUSTVOICE_AUDIOCPP_BUILD — the desktop shell passes its environment on to the sidecar.
// A failed build stops here (decided D1). Without a checkout the app runs the pinned release.
// Every other command (`tauri build`, …) passes straight through.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHECKOUT, ENV, prepareAudioCppDevBuild } from "./audiocpp-dev.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const env = { ...process.env };

if (args[0] === "dev") {
  try {
    const bin = prepareAudioCppDevBuild();
    if (bin) env[ENV] = bin;
    else console.log(`[audio.cpp] no checkout at ${CHECKOUT} — the app runs the pinned speech runtime`);
  } catch (e) {
    console.error(`[audio.cpp] ${e.message}`);
    console.error("[audio.cpp] the app was not started — fix the build, then run npm run dev again");
    process.exit(1);
  }
}

const cli = join(ROOT, "node_modules", "@tauri-apps", "cli", "tauri.js");
const child = spawn(process.execPath, [cli, ...args], { cwd: ROOT, stdio: "inherit", env });
// Ctrl+C reaches the CLI too; wait for it to shut the app down, then leave with its code.
process.on("SIGINT", () => {});
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
