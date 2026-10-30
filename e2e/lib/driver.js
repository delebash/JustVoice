// SPDX-License-Identifier: MIT
// The e2e driver: the REAL desktop app (Electron) launched and driven through Playwright's Electron
// driver (`playwright-core`'s `_electron` — no browser download, no driver binary; app-structure
// §10). The kit template's e2e/lib/driver.js, with JustVoice's id, port and data variable; it is
// hermetic (§18):
//
//   - a temp folder per run holds the data folder, and JUST_AI_HOME points there, so nothing reads
//     or writes your real data (<repo>/data, the installed app's) or the family's cache registry;
//   - the harness starts the app's own server on that folder itself (from source, on Electron's
//     Node — scripts/node24.js) and stops it after (POST /v1/shutdown);
//   - the app runs with the shell's JUSTVOICE_DEV_NO_SERVER=1 (§10), so the shell never starts,
//     evicts or strands a server of its own.
// The window talks to the registered port (17494): a run refuses to start while something already
// listens there — the app, `npm run dev`, `npm run server` — rather than touch it.
//
// What it launches: the built desktop app before packaging — Quasar's dist/electron/UnPackaged
// (`npm run build:unpacked` first) — run by the checkout's Electron, loading the BUILT UI from
// app://, with the app's real CSP: page scripts run over the debugger protocol, which the CSP
// doesn't apply to. The packaged app's fuses forbid this driver (EnableNodeCliInspectArguments off),
// which is why the unfused UnPackaged build is the target.
//
// A fresh data folder has no speech runtime and no models, so nothing here loads a model on the
// graphics card: a voice's preview answers 409 (the client's ask-before-load), and warm-on-boot
// is off by default.

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { _electron } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "../..");
const APP_ROOT = path.join(REPO_ROOT, "dist", "electron", "UnPackaged");
// Electron is the desktop app's dependency, installed in src-electron/ (Quasar's Electron mode).
// Its package's main export is the binary's path — an ES import by file URL (no require).
const { default: ELECTRON } = await import(pathToFileURL(path.join(REPO_ROOT, "src-electron", "node_modules", "electron", "index.js")).href);

/** The shell's id (src-electron/electron-main.js) — its switch is <ID>_DEV_NO_SERVER. */
const ID = "justvoice";
const NO_SERVER = `${ID.toUpperCase().replace(/-/g, "_")}_DEV_NO_SERVER`;
/** The shell's data-folder variable (src-electron/electron-main.js `dataDirEnv`). */
const DATA_DIR_ENV = "JUSTVOICE_DATA_DIR";

/** The registered server port (app-structure §1) — where the window looks for its server. */
export const PORT = 17494;
export const API = `http://127.0.0.1:${PORT}/v1`;

const listening = (port) =>
  new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port }, () => {
      s.destroy();
      resolve(true);
    });
    s.on("error", () => resolve(false));
  });

/** Poll `fn` until it answers truthy (no fixed sleeps); throws after `timeout`. */
export async function waitFor(fn, { timeout = 30_000, interval = 200, what = "condition" } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

export class Driver {
  constructor() {
    this.app = null;
    this.page = null;
    this.server = null;
    this.tmp = null;
  }

  /** The app's own server on a temp data folder. */
  async startServer() {
    if (await listening(PORT)) {
      throw new Error(`port ${PORT} is in use — stop the server there (the app, npm run dev or npm run server?) before running the e2e; it never touches one it didn't start`);
    }
    this.tmp = mkdtempSync(path.join(os.tmpdir(), "justvoice-e2e-"));
    const env = { ...process.env, JUST_AI_HOME: path.join(this.tmp, "family") };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.JUSTVOICE_AUDIOCPP_BUILD; // the pinned speech runtime's rules, never a dev build
    // a data folder the server is told of must be there (a named folder that isn't is refused, never made)
    mkdirSync(this.dataDir, { recursive: true });
    this.server = spawn(process.execPath, ["scripts/node24.js", "server/src/serve.js", "serve", "--host", "127.0.0.1", "--port", String(PORT), "--data-dir", this.dataDir], {
      cwd: REPO_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.serverLog = "";
    for (const s of [this.server.stdout, this.server.stderr]) s.on("data", (d) => (this.serverLog += d));
    // ready when what the pages ask first answers — the database seeded, the engines read (the
    // renderer gate's lesson, scripts/lib/smoke-common.js waitForServerReady), not merely /health
    await waitFor(
      async () => {
        for (const p of ["/health", "/settings", "/engines"]) if (!(await fetch(`${API}${p}`)).ok) return false;
        return true;
      },
      { timeout: 60_000, what: `the server on ${PORT}` },
    );
  }

  get dataDir() {
    return path.join(this.tmp, "data");
  }

  async launch() {
    if (!this.server) await this.startServer();
    const env = { ...process.env, [NO_SERVER]: "1", [DATA_DIR_ENV]: this.dataDir, JUST_AI_HOME: path.join(this.tmp, "family") };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.DEV_URL; // the built UI, from app://
    this.app = await _electron.launch({ executablePath: ELECTRON, args: [APP_ROOT], cwd: REPO_ROOT, env });
    this.page = await this.app.firstWindow();
    await this.page.waitForLoadState("domcontentloaded");
    return this;
  }

  async close() {
    try {
      // the page first, its beforeunload skipped (Playwright's page.close runs none by default): a page with unsaved
      // work held the app's close on the shell's "Leave without saving?" box (the template's nineteenth review)
      await this.page?.close().catch(() => {});
      if (this.app) await this.app.close();
    } catch {
      // already gone
    }
    this.app = null;
    this.page = null;
    if (this.server) {
      const exited = new Promise((resolve) => this.server.once("exit", resolve));
      await fetch(`${API}/shutdown`, { method: "POST" }).catch(() => {});
      const killer = setTimeout(() => this.server?.kill(), 15_000);
      await exited;
      clearTimeout(killer);
      this.server = null;
    }
    if (this.tmp) {
      rmSync(this.tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      this.tmp = null;
    }
  }

  // ── helpers ────────────────────────────────────────────
  /** A WebDriver-style script body (`arguments[0]`, `return`) run in the page. */
  exec(script, args = []) {
    return this.page.evaluate(`(function(){ ${script} \n}).apply(null, ${JSON.stringify(args)})`);
  }

  navigate(hash) {
    return this.exec("window.location.hash = arguments[0];", [hash]);
  }

  screenshot(file) {
    return this.page.screenshot({ path: file });
  }

  /** The server's API, for a test's own checks (the window's server). */
  async api(pathname, init) {
    const r = await fetch(`${API}${pathname}`, init);
    return r.status === 204 ? null : r.json();
  }

  /** The server's raw answer, for a status or a body's bytes. */
  fetch(pathname, init) {
    return fetch(`${API}${pathname}`, init);
  }
}
