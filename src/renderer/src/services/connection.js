// SPDX-License-Identifier: GPL-3.0-or-later
// Boot-time server reachability check.
//
// The renderer is a thin client — all data lives in the Python server (SQLite +
// engines). With no server we must NOT boot the app: it would render empty/
// default state and silently fail. main.js mounts the ConnectionError screen
// instead. Retries briefly so the Tauri-spawned sidecar (which takes a moment to
// come up) isn't falsely reported as down.

import { SERVER_URL } from "../config.js";

export async function checkServer({ tries = 8, delayMs = 500 } = {}) {
  const token = (typeof localStorage !== "undefined" && localStorage.getItem("jt:token")) || "";
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const url = `${SERVER_URL.replace(/\/$/, "")}/v1/health`;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers, cache: "no-store" });
      if (res.ok) return true;
    } catch { /* server not up yet */ }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}
