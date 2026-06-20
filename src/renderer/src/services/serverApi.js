// SPDX-License-Identifier: GPL-3.0-or-later
// Server transport — the single fetch layer for the FastAPI server (app
// standard: one services/serverApi.js with url() + request/safeRequest/
// requestBlob/postForm). Stateless functions read the base + bearer token from
// localStorage on each call, so a runtime server/token switch (setServer/
// setToken in stores/api.js) takes effect immediately. The Pinia `api` store is
// a thin reactive wrapper over this module for UI binding (serverUrl, token,
// lastError, isAuthed); all actual transport lives here.

import { ref } from "vue";
import { SERVER_URL } from "../config.js";

// Reactive so views binding `api.lastError` still update. Shared instance: the
// store re-exposes this same ref.
export const lastError = ref("");

// Base: a runtime override (jt:server — thin client pointed at a remote host)
// wins over the origin-aware default resolved in config.js.
function base() {
  return (typeof localStorage !== "undefined" && localStorage.getItem("jt:server")) || SERVER_URL;
}
function authToken() {
  return (typeof localStorage !== "undefined" && localStorage.getItem("jt:token")) || "";
}

export function url(path) {
  return base().replace(/\/$/, "") + path;
}

async function _doRequest(path, opts) {
  const headers = { ...(opts.headers || {}) };
  const tok = authToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  try {
    const res = await fetch(url(path), { ...opts, headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${res.statusText}: ${text}`);
    }
    const ct = res.headers.get("content-type") || "";
    if (ct.startsWith("audio/")) return await res.blob();
    if (ct.includes("json")) return await res.json();
    return await res.text();
  } catch (e) {
    lastError.value = String(e.message || e);
    throw e;
  }
}

// In-flight GET dedupe. Boot fires several stores/components fetching the same
// endpoint (engines, settings, health, projects…) in the same tick; without
// this each one opens its own request. Collapse concurrent identical GETs onto
// one in-flight promise (GETs are idempotent), cleared when it settles — so a
// later read still re-fetches. Cuts redundant boot traffic; non-GETs untouched.
const _inflight = new Map();

export function request(path, opts = {}) {
  const method = (opts.method || "GET").toUpperCase();
  if (method !== "GET") return _doRequest(path, opts);
  const key = url(path);
  const hit = _inflight.get(key);
  if (hit) return hit;
  const p = _doRequest(path, opts);
  _inflight.set(key, p);
  const clear = () => _inflight.delete(key);
  p.then(clear, clear); // settle-cleanup; callers still see p's result/rejection
  return p;
}

// Convenience verbs used by service modules. Path is always the FIRST arg —
// never hand-roll request(method, path) (that 3-arg shape silently broke 15
// methods in services/projects.js once; wiring-audit W2).
export function get(path, opts = {}) {
  return request(path, { ...opts, method: "GET" });
}
export function post(path, body, opts = {}) {
  return request(path, {
    ...opts,
    method: "POST",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    body: body != null ? JSON.stringify(body) : undefined,
  });
}
export function patch(path, body, opts = {}) {
  return request(path, {
    ...opts,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    body: body != null ? JSON.stringify(body) : undefined,
  });
}
export function put(path, body, opts = {}) {
  return request(path, {
    ...opts,
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    body: body != null ? JSON.stringify(body) : undefined,
  });
}
export function del(path, opts = {}) {
  return request(path, { ...opts, method: "DELETE" });
}

export async function requestBlob(method, path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const tok = authToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const res = await fetch(url(path), { ...opts, method, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.blob();
}

export async function postForm(path, formData, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const tok = authToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const res = await fetch(url(path), { ...opts, method: "POST", headers, body: formData });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("json")) return res.json();
  return res.text();
}

// safeRequest — like request() but swallows errors and returns the fallback.
// Use in view refresh() functions so server-offline doesn't blank the view.
export async function safeRequest(path, fallback = null, opts = {}) {
  try {
    const result = await request(path, opts);
    return result ?? fallback;
  } catch {
    return fallback;
  }
}
