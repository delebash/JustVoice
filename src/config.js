// SPDX-License-Identifier: MIT
// Backend base URL config for JustVoice.
//
// The origin-aware resolver is shared (kit `makeOriginAwareResolver`): when the
// server hosts the UI at its own origin, use that origin (same-origin, no CORS);
// otherwise — the Vite dev server (1430/1431) or the Tauri webview
// (tauri://localhost) — fall back to the fixed loopback port. This file supplies
// JV's per-app dev ports + fallback, layers the runtime `jt:server` override on
// top, and is what main.js hands to configureServerApi() at boot.
//
// Override the fallback with VITE_SERVER_URL at build/dev time.
import { makeOriginAwareResolver } from "@delebash/llm-ui";

const FALLBACK = import.meta.env.VITE_SERVER_URL || "http://127.0.0.1:17494";
const originBase = makeOriginAwareResolver({ devPorts: ["1430", "1431"], fallback: FALLBACK });

// Runtime override: a thin client explicitly pointed at a remote host
// (`jt:server`) wins over the origin-aware default.
export function resolveBase() {
  const override = typeof localStorage !== "undefined" && localStorage.getItem("jt:server");
  return override || originBase();
}

// Static snapshot for display + back-compat consumers (ConnectionError prop,
// prefs.js, the api store's initial serverUrl).
export const SERVER_URL = resolveBase();
