// SPDX-License-Identifier: GPL-3.0-or-later
// Backend base URL.
//
// Two serving modes, and we must pick the right API origin for each:
//
//  1. Server-served UI (headless `justvoice-server serve`, or any case where the
//     Python server hosts dist/ at its own origin). Here the API lives on the
//     SAME origin the page was loaded from — use window.location.origin so it
//     works on whatever port/host the server happens to bind. Same-origin also
//     sidesteps CORS entirely.
//
//  2. Vite dev server (port 1430) or the packaged Tauri webview
//     (tauri://localhost — not a real HTTP server). There the page origin is
//     NOT the API, so fall back to the fixed loopback port the sidecar binds.
//
// Override either with VITE_SERVER_URL at build/dev time.
const FALLBACK = import.meta.env.VITE_SERVER_URL || "http://127.0.0.1:17494";

function resolveServerUrl() {
  if (typeof window === "undefined" || !window.location) return FALLBACK;
  const { protocol, origin, port, hostname } = window.location;
  const isViteDev = port === "1430" || port === "1431";
  const isTauri = protocol === "tauri:" || hostname === "tauri.localhost";
  if (!isViteDev && !isTauri && (protocol === "http:" || protocol === "https:")) {
    return origin; // server hosts both the UI and the API
  }
  return FALLBACK;
}

export const SERVER_URL = resolveServerUrl();
