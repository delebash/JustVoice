// SPDX-License-Identifier: MIT
/**
 * uiStore — appearance config + dialog open-state + currently-selected entity
 * ids. Persisted server-side via /v1/prefs (key: `ui`). Partial-persist: only
 * `appearance` + `selectedProfileId` survive a reload. Theming runs through the
 * shared engine (@delebash/ui appearance via services/appearance.js).
 */
import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { readPref, writePref } from "../services/prefs.js";
import { applyAppearance, migrateAppearance, DEFAULT_APPEARANCE } from "../services/appearance.js";
import { i18n, LOCALE_CODES } from "../i18n/index.js";

function loadInitial() {
  const p = readPref("ui", {});
  return p && typeof p === "object" ? p : {};
}

export const useUiStore = defineStore("ui", () => {
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
  /** The kit's LanguagePicker sets vue-i18n's locale; this keeps the choice, with the appearance. */
  function setLocale(code) {
    appearance.value = { ...appearance.value, locale: code || null };
  }

  // Apply appearance on store init (synchronous in App setup → before paint).
  // The engine owns the OS-preference listener while mode === "system".
  applyAppearance(appearance.value);
  // and the language picked, when JustVoice has words for it (the template's ui store)
  if (LOCALE_CODES.includes(appearance.value.locale)) i18n.global.locale.value = appearance.value.locale;

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
    setLocale,
  };
});
