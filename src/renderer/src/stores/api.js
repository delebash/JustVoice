// Tiny fetch wrapper around the FastAPI server. Pinia store so any
// component can call `useApi().request(...)` and shared state (server
// URL, bearer token, last error) is reactive.
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { SERVER_URL } from "../config.js";

export const useApi = defineStore("api", () => {
  const serverUrl = ref(localStorage.getItem("jt:server") || SERVER_URL);
  const token = ref(localStorage.getItem("jt:token") || "");
  const lastError = ref("");

  function setServer(v) {
    serverUrl.value = v;
    localStorage.setItem("jt:server", v);
  }

  function setToken(v) {
    token.value = v;
    localStorage.setItem("jt:token", v);
  }

  // Build an Error carrying machine-readable context: .status (HTTP code)
  // and .body (parsed problem+json, or null). The swap-at-render helper
  // keys off err.body.code === "engine-swap-required".
  function _httpError(res, text) {
    const err = new Error(`${res.status} ${res.statusText}: ${text}`);
    err.status = res.status;
    try { err.body = JSON.parse(text); } catch { err.body = null; }
    return err;
  }

  async function request(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (token.value) headers.Authorization = `Bearer ${token.value}`;
    const url = serverUrl.value.replace(/\/$/, "") + path;
    try {
      const res = await fetch(url, { ...opts, headers });
      if (!res.ok) {
        throw _httpError(res, await res.text());
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

  // Convenience helpers used by service modules.
  function get(path, opts = {}) {
    return request(path, { ...opts, method: "GET" });
  }

  function post(path, body, opts = {}) {
    return request(path, {
      ...opts,
      method: "POST",
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      body: body != null ? JSON.stringify(body) : undefined,
    });
  }

  async function requestBlob(method, path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (token.value) headers.Authorization = `Bearer ${token.value}`;
    const url = serverUrl.value.replace(/\/$/, "") + path;
    const res = await fetch(url, { ...opts, method, headers });
    if (!res.ok) {
      throw _httpError(res, await res.text());
    }
    return res.blob();
  }

  async function postForm(path, formData, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (token.value) headers.Authorization = `Bearer ${token.value}`;
    const url = serverUrl.value.replace(/\/$/, "") + path;
    const res = await fetch(url, { ...opts, method: "POST", headers, body: formData });
    if (!res.ok) {
      throw _httpError(res, await res.text());
    }
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("json")) return res.json();
    return res.text();
  }

  // safeRequest — like request() but swallows errors and returns the
  // provided fallback. Use in view refresh() functions so server-offline
  // doesn't blank the entire view. The fallback should match the
  // successful response shape so destructuring `.voices` / `.projects`
  // / etc. keeps working.
  async function safeRequest(path, fallback = null, opts = {}) {
    try {
      const result = await request(path, opts);
      return result ?? fallback;
    } catch {
      return fallback;
    }
  }

  return {
    serverUrl,
    token,
    lastError,
    setServer,
    setToken,
    request,
    safeRequest,
    get,
    post,
    requestBlob,
    postForm,
    isAuthed: computed(() => !!token.value),
  };
});
