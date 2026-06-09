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

  async function request(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (token.value) headers.Authorization = `Bearer ${token.value}`;
    const url = serverUrl.value.replace(/\/$/, "") + path;
    try {
      const res = await fetch(url, { ...opts, headers });
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
      const text = await res.text();
      throw new Error(`${res.status} ${res.statusText}: ${text}`);
    }
    return res.blob();
  }

  async function postForm(path, formData, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (token.value) headers.Authorization = `Bearer ${token.value}`;
    const url = serverUrl.value.replace(/\/$/, "") + path;
    const res = await fetch(url, { ...opts, method: "POST", headers, body: formData });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${res.statusText}: ${text}`);
    }
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("json")) return res.json();
    return res.text();
  }

  return {
    serverUrl,
    token,
    lastError,
    setServer,
    setToken,
    request,
    get,
    post,
    requestBlob,
    postForm,
    isAuthed: computed(() => !!token.value),
  };
});
