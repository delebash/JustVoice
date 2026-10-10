// SPDX-License-Identifier: MIT
// The desktop app — the kit's shared Electron main module with this app's settings. Everything
// the shell does — the data folder, the window from app://, the tray, the dialogs, the server's
// life — is the kit's `runDesktopApp`; this file only says which app it is. No logic lives here.
// Quasar builds this file (its Electron mode, app-structure §Q.2) and runs it in Electron's main
// process; it replaced electron/main.js with the Quasar move (2026-10-08).
import path from "node:path";
import { runDesktopApp } from "@delebash/llm-runner/shell";
import { resolveElectronAssetsPath } from "#q-app/electron/main";

const here = import.meta.dirname;
const dev = Boolean(import.meta.env.QUASAR_DEV);

runDesktopApp({
  // The window's origin is app://justvoice — the server's CSRF guard and CORS allow it
  // (server/src/app.js; TASKS step-5 rec 4).
  id: "justvoice",
  // The data folder's name under the OS fallback (%LOCALAPPDATA%\<name>\<name>) — the same
  // name the server's data_paths ladder uses (server/src/paths.js).
  appName: "JustVoice",
  productName: "JustVoice",
  port: 17494, // the family port registry: this app 17494 · JW 17495 · docgen 8742 · template 17490
  // the server package (server/): its source in development, the installed copy when packaged
  serverEntry: dev ? path.resolve("server", "src", "serve.js") : path.join(here, "node_modules", "justvoice-server", "src", "serve.js"),
  dataDirEnv: "JUSTVOICE_DATA_DIR",
  repoRoot: dev ? path.resolve(".") : null, // development: the data root is <repo>/data
  distDir: here, // Quasar puts the built renderer beside this file
  devUrl: import.meta.env.QUASAR_APP_URL,
  preload: path.join(here, "electron-preload.cjs"),
  window: {
    title: "JustVoice",
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#f6f5f1", // tokens.css --bg (light)
  },
  icon: resolveElectronAssetsPath(process.platform === "win32" ? "icons/icon.ico" : "icons/icon.png"),
  trayIcon: resolveElectronAssetsPath("icons/tray.png"),
  logFile: path.join("logs", "justvoice.log"), // server/src/app.js installFileLog
  // The microphone, for recording a voice to clone (PersonaCloneMaker); the shell denies every
  // other web permission beyond the clipboard.
  permissions: ["media"],
  // Updates: the feed is the GitHub releases electron-builder's `publish` names (quasar.config.js);
  // a Mac, which can't install an unsigned update, gets the release's page from here.
  updates: { releasesUrl: "https://github.com/delebash/JustVoice/releases" },
  // The Tauri tray's two JustVoice items. Their renderer half is parked feature work, as it
  // was under Tauri (AppShell.vue has no listener; the events go nowhere yet).
  trayExtras: [
    { id: "dictateStart", label: "🎙️ Start dictation (⌥⌘V)", event: "dictate-start" },
    { id: "mcpToggle", label: "🎚️ MCP server: toggle", event: "mcp-toggle" },
  ],
});
