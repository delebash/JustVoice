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
// HTTP goes through the shared kit transport (@delebash/llm-ui serverApi),
// which configureServerApi() wired with the base + bearer at boot — main.js
// calls it before bootPrefs(), so the transport is ready here.

import { reactive } from "vue";
import { safeRequest, patch } from "@delebash/llm-ui";

// Reactive so computeds across views re-evaluate when a pref changes.
const _doc = reactive({});

const _timers = new Map();
const PATCH_DEBOUNCE_MS = 150;

/** Boot the prefs cache. MUST be awaited before mounting Vue so views read
 *  populated data. Resilient: boots empty (defaults) on failure. */
export async function bootPrefs() {
  const doc = await safeRequest("/v1/prefs", null);
  if (doc && typeof doc === "object") Object.assign(_doc, doc);
}

/** Read a pref's value (reactive), or `fallback` if unset. */
export function readPref(key, fallback = undefined) {
  return key in _doc ? _doc[key] : fallback;
}

function _patch(body) {
  // keepalive so a flush during pagehide/beforeunload still lands.
  return patch("/v1/prefs", body, { keepalive: true }).catch((err) =>
    console.error("prefs PATCH failed:", err),
  );
}

/** Write a pref wholesale: update the cache and queue a debounced PATCH. */
export function writePref(key, value) {
  _doc[key] = value;
  const existing = _timers.get(key);
  if (existing) clearTimeout(existing);
  _timers.set(key, setTimeout(() => { _timers.delete(key); _patch({ [key]: value }); }, PATCH_DEBOUNCE_MS));
}

/** Boot-time default for the active-project slot: if no project is "open" yet
 *  (no `activeProject` pref), point it at the most-recently-updated project so
 *  the kind-driven sidebar reflects your work on launch — the same restore JW
 *  does. Server-derived (GET /v1/projects), no localStorage. Awaited after
 *  bootPrefs(), before mount. */
export async function ensureActiveProjectDefault() {
  if (readPref("activeProject")?.id) return; // a project is already the active slot
  const data = await safeRequest("/v1/projects", null);
  if (!data) return;
  const list = (data.projects || []).slice()
    .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
  const p = list[0];
  if (p) writePref("activeProject", {
    id: p.id, name: p.name || p.id, projectType: p.project_type || "",
    master: p.mastering_preset || "", openedAt: Date.now(),
  });
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
