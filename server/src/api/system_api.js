// SPDX-License-Identifier: MIT
// GET /v1/system/info — OS / CPU / RAM / GPU / runtime detection.
// (The port of justvoice/api/system_api.py. POST /v1/shutdown moved to the kit's
// platform/shutdown_api.js on 2026-10-15, mounted in app.js.)

import { Hono } from "@delebash/core/platform";
import { getState } from "../app_state.js";
import * as systemInfo from "../system_info.js";

export function router() {
  const app = new Hono();
  app.get("/v1/system/info", async (c) => {
    const info = await systemInfo.detect();
    // data_dir rides along so the desktop shell can open on-disk artifacts (the rotating log
    // file) at their real location (W4 rev).
    info.data_dir = String(getState().dataDir);
    return c.json(info);
  });
  return app;
}
