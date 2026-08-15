// SPDX-License-Identifier: MIT
/**
 * serverStore — server URL, connection mode, keep-running-on-close flag.
 * Persisted to localStorage (key: justvoice-server).
 */
import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { setKeepRunning } from "../services/native.js";

function getDefaultServerUrl() {
  if (typeof window === "undefined") return "http://127.0.0.1:17494";
  const { protocol, origin, hostname } = window.location;
  if (
    (protocol === "http:" || protocol === "https:") &&
    origin &&
    hostname !== "tauri.localhost"
  ) {
    return origin;
  }
  return "http://127.0.0.1:17494";
}

const STORAGE_KEY = "justvoice-server";

function loadInitial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* corrupt storage; fall through */
  }
  return {};
}

export const useServerStore = defineStore("server", () => {
  const persisted = loadInitial();

  const serverUrl = ref(persisted.serverUrl ?? getDefaultServerUrl());
  const isConnected = ref(false);
  const mode = ref(persisted.mode ?? "local"); // "local" | "remote"
  const keepServerRunningOnClose = ref(
    Boolean(persisted.keepServerRunningOnClose ?? false),
  );
  const customModelsDir = ref(persisted.customModelsDir ?? null);

  function setServerUrl(url) {
    const prev = serverUrl.value;
    serverUrl.value = url;
    if (url !== prev) {
      // Invalidate any tanstack-query-like caches. We don't use TanStack
      // Query in the Vue port, but if downstream stores cache, they should
      // subscribe to this and clear.
    }
  }
  function setIsConnected(v) {
    isConnected.value = v;
  }
  function setMode(v) {
    mode.value = v;
  }
  async function setKeepServerRunningOnClose(v) {
    keepServerRunningOnClose.value = Boolean(v);
    // Sync to the Rust shell through services/native.js — the ONE place a
    // command name is written (family shape, 2026-08-15). No-op in a browser.
    await setKeepRunning(v);
  }
  function setCustomModelsDir(v) {
    customModelsDir.value = v;
  }

  watch(
    [serverUrl, mode, keepServerRunningOnClose, customModelsDir],
    () => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            serverUrl: serverUrl.value,
            mode: mode.value,
            keepServerRunningOnClose: keepServerRunningOnClose.value,
            customModelsDir: customModelsDir.value,
          }),
        );
      } catch {
        /* quota or private-mode; ignore */
      }
    },
    { deep: false },
  );

  return {
    serverUrl,
    isConnected,
    mode,
    keepServerRunningOnClose,
    customModelsDir,
    setServerUrl,
    setIsConnected,
    setMode,
    setKeepServerRunningOnClose,
    setCustomModelsDir,
  };
});
