// SPDX-License-Identifier: GPL-3.0-or-later
//
// Onboarding store — first-run "what are you using JustVoice for?" state.
//
// Lives in Pinia because the answer drives terminology (services/copy.js),
// the launch tab (App.vue), and featured docs across the app. We persist
// to the server's settings.json via PATCH /v1/settings so the choice
// survives across machines that share the same server data dir, and
// hydrate on boot so the welcome modal only shows once.

import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useApi } from "./api.js";

const VALID = new Set([
  "audiobook",
  "game",
  "podcast",
  "dictation",
  "multiple",
  "unset",
]);

export const useOnboarding = defineStore("onboarding", () => {
  const api = useApi();

  const primaryUseCase = ref("unset");
  const secondaryUseCases = ref([]);
  const shown = ref(false);
  const hydrated = ref(false);

  const isUnset = computed(() => primaryUseCase.value === "unset");
  const needsWelcome = computed(() => hydrated.value && !shown.value);

  async function hydrate() {
    if (hydrated.value) return;
    try {
      const settings = await api.request("/v1/settings");
      const app = settings?.app || {};
      const pri = VALID.has(app.primary_use_case) ? app.primary_use_case : "unset";
      const sec = Array.isArray(app.secondary_use_cases)
        ? app.secondary_use_cases.filter((u) => VALID.has(u))
        : [];
      primaryUseCase.value = pri;
      secondaryUseCases.value = sec;
      shown.value = !!app.onboarding_shown;
    } catch (_) {
      // Server unreachable on boot — keep defaults so the welcome modal
      // doesn't trigger until we can actually persist a choice.
      shown.value = true;
    } finally {
      hydrated.value = true;
    }
  }

  async function persist() {
    try {
      await api.request("/v1/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app: {
            primary_use_case: primaryUseCase.value,
            secondary_use_cases: secondaryUseCases.value,
            onboarding_shown: shown.value,
          },
        }),
      });
    } catch (_) {
      // Persistence failure is non-fatal — the in-memory choice keeps
      // driving the session and the next successful PATCH will catch up.
    }
  }

  async function set({ primary, secondary }) {
    if (primary && VALID.has(primary)) primaryUseCase.value = primary;
    if (Array.isArray(secondary)) {
      secondaryUseCases.value = secondary.filter((u) => VALID.has(u));
    }
    shown.value = true;
    await persist();
  }

  async function dismiss() {
    shown.value = true;
    await persist();
  }

  async function reset() {
    shown.value = false;
    await persist();
  }

  return {
    primaryUseCase,
    secondaryUseCases,
    shown,
    hydrated,
    isUnset,
    needsWelcome,
    hydrate,
    set,
    dismiss,
    reset,
  };
});
