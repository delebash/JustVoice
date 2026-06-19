// SPDX-License-Identifier: GPL-3.0-or-later
// Renderer UI preferences — server-backed (SQL via /v1/prefs), NOT localStorage.
//
// bootPrefs() pulls the whole prefs document into a REACTIVE in-memory cache
// before Vue mounts; views read it (often inside computeds, so it must be
// reactive) and writePref() updates the cache + queues a debounced PATCH.
// Replaces the renderer's localStorage for content prefs (appearance, hidden
// voices, per-voice gender overrides, speaker-lab presets, autoload) so a thin
// client reads them from the server too.
//
// The server address + bearer token are the one thing a client MUST keep
// locally — it can't fetch the server's own address from the server — so they
// stay in localStorage, mirroring stores/api.js.

import { reactive } from "vue";
import { SERVER_URL } from "../config.js";

function base() {
  return (localStorage.getItem("jt:server") || SERVER_URL).replace(/\/$/, "");
}
function authHeaders(extra = {}) {
  const token = localStorage.getItem("jt:token") || "";
  return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
}

// Reactive so computeds across views re-evaluate when a pref changes.
const _doc = reactive({});

const _timers = new Map();
const PATCH_DEBOUNCE_MS = 150;

/** Boot the prefs cache. MUST be awaited before mounting Vue so views read
 *  populated data. Resilient: boots empty (defaults) on failure. */
export async function bootPrefs() {
  try {
    const res = await fetch(base() + "/v1/prefs", { headers: authHeaders() });
    if (res.ok) {
      const doc = await res.json();
      if (doc && typeof doc === "object") Object.assign(_doc, doc);
    }
  } catch (err) {
    console.error("bootPrefs failed:", err);
  }
}

/** Read a pref's value (reactive), or `fallback` if unset. */
export function readPref(key, fallback = undefined) {
  return key in _doc ? _doc[key] : fallback;
}

function _patch(body) {
  return fetch(base() + "/v1/prefs", {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
    keepalive: true,
  }).catch((err) => console.error("prefs PATCH failed:", err));
}

/** Write a pref wholesale: update the cache and queue a debounced PATCH. */
export function writePref(key, value) {
  _doc[key] = value;
  const existing = _timers.get(key);
  if (existing) clearTimeout(existing);
  _timers.set(key, setTimeout(() => { _timers.delete(key); _patch({ [key]: value }); }, PATCH_DEBOUNCE_MS));
}

/** Flush pending debounced writes immediately (e.g. before unload). */
export function flushPrefs() {
  const keys = [..._timers.keys()];
  if (!keys.length) return;
  const body = {};
  for (const k of keys) { clearTimeout(_timers.get(k)); _timers.delete(k); body[k] = _doc[k]; }
  _patch(body);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushPrefs);
  window.addEventListener("beforeunload", flushPrefs);
}
