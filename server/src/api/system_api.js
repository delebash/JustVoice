// SPDX-License-Identifier: MIT
// GET /v1/system/info — OS / CPU / RAM / GPU / runtime detection.
// POST /v1/shutdown — stop this server cleanly (the desktop shell's close).
// (The port of justvoice/api/system_api.py.)

import { getLogger } from "@delebash/llm-runner/platform/log";
import { getState } from "../app_state.js";
import * as manager from "../engines/manager.js";
import { forbidden } from "../errors.js";
import * as systemInfo from "../system_info.js";

const log = getLogger("justvoice.api.system_api");

/** `EXIT_DEADLINE_S`: a clean exit that stalls (a stuck request, a hung engine) still ends this
 * many seconds after /v1/shutdown answered. `startTimer(seconds, fn)` starts that deadline
 * (Python's `threading.Timer`; a test replaces it — the real one would end the test run). */
export const cfg = {
  EXIT_DEADLINE_S: 10.0,
  startTimer: (seconds, fn) => setTimeout(fn, seconds * 1000).unref(),
  exit: (code) => process.exit(code),
};

/** Python's own `_is_loopback` here: the three literal names only. */
const isLoopback = (host) => host === "127.0.0.1" || host === "::1" || host === "localhost";

export async function router(app) {
  app.get("/v1/system/info", async () => {
    const info = await systemInfo.detect();
    // data_dir rides along so the desktop shell can open on-disk artifacts (the rotating log
    // file) at their real location (W4 rev).
    info.data_dir = String(getState().dataDir);
    return info;
  });

  /**
   * The desktop shell calls this when its window closes (2026-09-29). Engines are stopped first
   * — each one's GPU memory is released at once — then the server exits. From this machine
   * only. Nothing exits when the app wasn't started by `justvoice-server serve` (a test, an
   * embedding host): the engines are still stopped, and the answer says so.
   */
  app.post("/v1/shutdown", async (req, reply) => {
    const host = req.ip || "";
    if (!isLoopback(host)) throw forbidden("The server can only be shut down from this machine.");
    log.info(`shutdown requested from ${host} — stopping engines, then exiting`);
    await manager.shutdownManager();
    // serve.js hands the app its server handle (Python's `app.state.uvicorn_server`).
    const server = req.server.serverHandle ?? null;
    if (server === null) return { ok: true, exiting: false };
    // The answer goes out first; then the server stops (uvicorn's `should_exit`).
    reply.raw.once("finish", () => server.stop("POST /v1/shutdown"));
    cfg.startTimer(cfg.EXIT_DEADLINE_S, () => cfg.exit(0));
    return { ok: true, exiting: true };
  });
}
