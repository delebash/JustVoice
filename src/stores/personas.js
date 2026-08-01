// SPDX-License-Identifier: MIT
//
// Personas store — single source of truth for the persona list. See
// stores/projects.js + docs/plans/2026-06-13-data-layer-rebuild.md.

import { defineStore } from "pinia";
import { ref } from "vue";

import { useApi } from "./api.js";

export const usePersonasStore = defineStore("personas", () => {
  const items = ref([]);
  const loaded = ref(false);
  let _inflight = null;

  async function reload() {
    const r = await useApi().safeRequest("/v1/personas", { personas: [] });
    items.value = r?.personas ?? [];
    loaded.value = true;
    return items.value;
  }

  function ensureLoaded() {
    if (loaded.value) return Promise.resolve(items.value);
    if (!_inflight) _inflight = reload().finally(() => { _inflight = null; });
    return _inflight;
  }

  function byId(id) {
    return items.value.find((p) => p.id === id) || null;
  }

  return { items, loaded, reload, ensureLoaded, byId };
});
