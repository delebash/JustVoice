// SPDX-License-Identifier: MIT
/**
 * uiStore — appearance config + dialog open-state + currently-selected entity
 * ids. Persisted server-side via /v1/prefs (key: `ui`). Partial-persist: only
 * `appearance` + `selectedProfileId` survive a reload. Theming runs through the
 * shared engine (@delebash/llm-ui appearance via services/appearance.js).
 */
import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { readPref, writePref } from "../services/prefs.js";
import { applyAppearance, migrateAppearance, DEFAULT_APPEARANCE } from "../services/appearance.js";

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

  // Appearance config on the shared theme engine. Migrate the two legacy theme
  // controls — the old "ui".theme topbar value + the old SettingsView
  // "appearance" pref — into the unified config (mode + accent hue + ui scale).
  const legacyAp = readPref("appearance", {});
  const appearance = ref(
    persisted.appearance && typeof persisted.appearance === "object"
      ? { ...DEFAULT_APPEARANCE, ...persisted.appearance }
      : migrateAppearance({ theme: legacyAp.theme || persisted.theme }),
  );
  if (!persisted.appearance && legacyAp.locale) appearance.value.locale = legacyAp.locale;

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
  function setAppearance(patch) {
    appearance.value = { ...appearance.value, ...patch };
    applyAppearance(appearance.value);
  }

  // Apply appearance on store init (synchronous in App setup → before paint).
  // The engine owns the OS-preference listener while mode === "system".
  applyAppearance(appearance.value);

  watch([appearance, selectedProfileId], () => {
    writePref("ui", { appearance: appearance.value, selectedProfileId: selectedProfileId.value });
  }, { deep: true });

  return {
    sidebarOpen,
    profileDialogOpen,
    editingProfileId,
    generationDialogOpen,
    selectedProfileId,
    selectedEngine,
    selectedVoiceId,
    appearance,
    setSidebarOpen,
    setProfileDialogOpen,
    setEditingProfileId,
    setSelectedProfileId,
    setSelectedEngine,
    setSelectedVoiceId,
    setAppearance,
  };
});
