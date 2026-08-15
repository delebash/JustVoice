// SPDX-License-Identifier: MIT
//
// Engines store — single source of truth for the engine list as the
// READ-ONLY consumers see it (Personas, Voices, Studio, Generate,
// Home, etc.). See stores/projects.js + the rebuild plan doc.
//
// NOTE: EnginesView itself owns the install/load progress polling and
// dispatches `jv:health-refresh` after state changes; this store
// listens for that event and reloads so the other views stay current
// without their own fetches.

import { defineStore } from "pinia";
import { ref } from "vue";

import { useApi } from "./api.js";

export const useEnginesStore = defineStore("engines", () => {
  const items = ref([]);
  const loaded = ref(false);
  let _inflight = null;
  let _listening = false;

  // Failure leaves `loaded` false so the next caller retries — see the note in
  // stores/personas.js.
  async function reload() {
    const r = await useApi().safeRequest("/v1/engines", null);
    if (!r) return items.value;
    items.value = r.engines ?? [];
    loaded.value = true;
    return items.value;
  }

  function ensureLoaded() {
    if (!_listening) {
      window.addEventListener("jv:health-refresh", () => { void reload(); });
      _listening = true;
    }
    if (loaded.value) return Promise.resolve(items.value);
    if (!_inflight) _inflight = reload().finally(() => { _inflight = null; });
    return _inflight;
  }

  function byId(id) {
    return items.value.find((e) => e.id === id) || null;
  }

  return { items, loaded, reload, ensureLoaded, byId };
});
