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

  // A null fallback, not an empty list: safeRequest swallows the error, so a
  // store that sets `loaded` on a FAILED call answers every id→name lookup
  // with "no such id" for the rest of the session — silently. That is what put
  // raw UUIDs in the Lab's reassign dropdown (2026-08-15). On failure leave
  // `loaded` false and the items alone, so the next caller retries.
  async function reload() {
    const r = await useApi().safeRequest("/v1/personas", null);
    if (!r) return items.value;
    items.value = r.personas ?? [];
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
