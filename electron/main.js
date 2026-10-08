// SPDX-License-Identifier: MIT
// The desktop app — the kit's shared Electron main module with this app's settings (the
// family's move to Electron, 2026-10-08; it replaced src-tauri/). Everything the shell does
// — the data folder, the window from app://, the tray, the dialogs, the server's life — is
// the kit's `runDesktopApp`; this file only says which app it is. No logic lives here.

import path from "node:path";
import { runDesktopApp } from "@delebash/llm-runner/shell";

const root = path.resolve(import.meta.dirname, "..");

runDesktopApp({
  // The window's origin is app://justvoice — the server's CSRF guard and CORS allow it
  // (server/src/app.js; TASKS step-5 rec 4).
  id: "justvoice",
  // The data folder's name under the OS fallback (%LOCALAPPDATA%\<name>\<name>) — the same
  // name the server's data_paths ladder uses (server/src/paths.js).
  appName: "JustVoice",
  productName: "JustVoice",
  port: 17494, // the family port registry: this app 17494 · JW 17495 · docgen 8742
  serverEntry: path.join(root, "server", "src", "serve.js"),
  dataDirEnv: "JUSTVOICE_DATA_DIR",
  repoRoot: root,
  distDir: path.join(root, "dist"),
  window: {
    title: "JustVoice",
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#f6f5f1", // tokens.css --bg (light)
  },
  icon: path.join(root, "build", process.platform === "win32" ? "icon.ico" : "icon.png"),
  trayIcon: path.join(root, "build", "tray.png"),
  logFile: path.join("logs", "justvoice.log"), // server/src/app.js installFileLog
  // The microphone, for recording a voice to clone (PersonaCloneMaker); the shell denies every
  // other web permission beyond the clipboard.
  permissions: ["media"],
  // The Tauri tray's two JustVoice items. Their renderer half is parked feature work, as it
  // was under Tauri (App.vue has no listener; the events go nowhere yet).
  trayExtras: [
    { id: "dictateStart", label: "🎙️ Start dictation (⌥⌘V)", event: "dictate-start" },
    { id: "mcpToggle", label: "🎚️ MCP server: toggle", event: "mcp-toggle" },
  ],
});
