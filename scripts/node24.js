// SPDX-License-Identifier: MIT
// Runs a Node script on Electron's own Node (24 — the runtime the server ships on), not
// whatever `node` is first on PATH. `node scripts/node24.js <script> [args…]`.
// Electron is the desktop app's dependency, so it is installed in src-electron/ (Quasar's
// Electron mode, app-structure §Q.1).
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The electron package's entry exports its binary's path (CommonJS `module.exports`, which an ES
// import receives as the default export).
const entry = path.resolve(import.meta.dirname, "..", "src-electron", "node_modules", "electron", "index.js");
const { default: electron } = await import(pathToFileURL(entry).href);
const child = spawn(electron, process.argv.slice(2), {
  stdio: "inherit",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
