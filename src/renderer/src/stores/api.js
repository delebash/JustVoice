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

  return {
    serverUrl,
    token,
    lastError,
    setServer,
    setToken,
    request,
    isAuthed: computed(() => !!token.value),
  };
});
