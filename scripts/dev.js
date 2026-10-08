// SPDX-License-Identifier: MIT
// `npm run dev` — THE app, as the family's `npm run dev` always opens it: Vite on its own
// port (1430, with hot reload) and the desktop app pointed at it (DEV_URL), its server
// started by the shell from server/src/serve.js on the dev data folder <repo>/data.
// Closing the window ends both.
//
// One addition for JustVoice: the app runs our audio.cpp checkout's latest build, never a
// release (docs/dev/TASKS.md, "`npm run dev` always runs the latest audio.cpp"). Before the
// app starts, ../audio.cpp is built (scripts/audiocpp-dev.js, only what changed) and its bin
// folder goes to the server in JUSTVOICE_AUDIOCPP_BUILD — the shell passes its environment on
// to the server. A failed build stops here (decided D1). Without a checkout the app runs the
// pinned release.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { CHECKOUT, ENV, prepareAudioCppDevBuild } from "./audiocpp-dev.js";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(path.join(root, "package.json"));
const DEV_URL = "http://127.0.0.1:1430"; // vite.config.js server.port (JustWrite has 1420)

const env = { ...process.env, DEV_URL };
delete env.ELECTRON_RUN_AS_NODE;
try {
  const bin = prepareAudioCppDevBuild();
  if (bin) env[ENV] = bin;
  else console.log(`[audio.cpp] no checkout at ${CHECKOUT} — the app runs the pinned speech runtime`);
} catch (e) {
  console.error(`[audio.cpp] ${e.message}`);
  console.error("[audio.cpp] the app was not started — fix the build, then run npm run dev again");
  process.exit(1);
}

// Vite's command, from its package.json "bin" field — vite 8's "exports" no longer lists
// bin/vite.js, so require.resolve can't name the file directly.
const vitePkg = require.resolve("vite/package.json");
const viteBin = path.join(path.dirname(vitePkg), require(vitePkg).bin.vite);
const vite = spawn(process.execPath, [viteBin], { cwd: root, stdio: "inherit" });

async function waitForVite() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(DEV_URL);
      if (r.ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Vite never answered on ${DEV_URL}`);
}

let app;
const stop = (code) => {
  try {
    vite.kill();
  } catch {
    /* gone */
  }
  process.exit(code ?? 0);
};
vite.on("exit", (code) => {
  if (app && app.exitCode === null) app.kill();
  process.exit(code ?? 1);
});

await waitForVite();
app = spawn(require("electron"), ["."], { cwd: root, stdio: "inherit", env });
app.on("exit", (code) => stop(code));
process.on("SIGINT", () => {
  app?.kill();
  stop(0);
});
