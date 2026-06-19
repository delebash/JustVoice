// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * uiStore — theme + dialog open-state + currently-selected entity ids.
 * Persisted server-side via /v1/prefs (key: `ui`). Partial-persist: only
 * `theme` + `selectedProfileId` survive a reload.
 */
import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { readPref, writePref } from "../services/prefs.js";

function resolveTheme(theme) {
  if (theme !== "system") return theme;
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", resolveTheme(theme) === "dark");
}

function loadInitial() {
  const p = readPref("ui", {});
  return p && typeof p === "object" ? p : {};
}

export const useUIStore = defineStore("ui", () => {
  const persisted = loadInitial();

  const sidebarOpen = ref(true);
  const profileDialogOpen = ref(false);
  const editingProfileId = ref(null);
  const generationDialogOpen = ref(false);
  const selectedProfileId = ref(persisted.selectedProfileId ?? null);
  const selectedEngine = ref("kokoro");
  const selectedVoiceId = ref(null);
  const theme = ref(persisted.theme ?? "system"); // "light" | "dark" | "system"

  // Help drawer state. helpDrawerSlug=null means closed; any string opens
  // the JvHelpDrawer scoped to that docs/<slug>.md file.
  const helpDrawerSlug = ref(null);
  function openHelp(slug) {
    helpDrawerSlug.value = slug || "";
  }
  function closeHelp() {
    helpDrawerSlug.value = null;
  }

  function setSidebarOpen(v) {
    sidebarOpen.value = v;
  }
  function setProfileDialogOpen(v) {
    profileDialogOpen.value = v;
  }
  function setEditingProfileId(v) {
    editingProfileId.value = v;
  }
  function setSelectedProfileId(v) {
    selectedProfileId.value = v;
  }
  function setSelectedEngine(v) {
    selectedEngine.value = v;
  }
  function setSelectedVoiceId(v) {
    selectedVoiceId.value = v;
  }
  function setTheme(v) {
    theme.value = v;
    applyTheme(v);
  }

  // Apply theme on store init.
  applyTheme(theme.value);

  // Watch the system theme preference; re-apply when in "system" mode.
  if (typeof window !== "undefined") {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (theme.value === "system") applyTheme("system");
    });
  }

  watch([theme, selectedProfileId], () => {
    writePref("ui", { theme: theme.value, selectedProfileId: selectedProfileId.value });
  });

  return {
    sidebarOpen,
    profileDialogOpen,
    editingProfileId,
    generationDialogOpen,
    selectedProfileId,
    selectedEngine,
    selectedVoiceId,
    theme,
    helpDrawerSlug,
    setSidebarOpen,
    setProfileDialogOpen,
    setEditingProfileId,
    setSelectedProfileId,
    setSelectedEngine,
    setSelectedVoiceId,
    setTheme,
    openHelp,
    closeHelp,
  };
});
