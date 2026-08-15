// SPDX-License-Identifier: MIT
//
// Lexicons store — single source of truth for the lexicon list. See
// stores/projects.js + docs/plans/2026-06-13-data-layer-rebuild.md.

import { defineStore } from "pinia";
import { ref } from "vue";

import { useApi } from "./api.js";

export const useLexiconsStore = defineStore("lexicons", () => {
  const items = ref([]);
  const loaded = ref(false);
  let _inflight = null;

  // Failure leaves `loaded` false so the next caller retries — see the note in
  // stores/personas.js.
  async function reload() {
    const r = await useApi().safeRequest("/v1/lexicons", null);
    if (!r) return items.value;
    items.value = r.lexicons ?? [];
    loaded.value = true;
    return items.value;
  }

  function ensureLoaded() {
    if (loaded.value) return Promise.resolve(items.value);
    if (!_inflight) _inflight = reload().finally(() => { _inflight = null; });
    return _inflight;
  }

  function byId(id) {
    return items.value.find((l) => l.id === id) || null;
  }

  return { items, loaded, reload, ensureLoaded, byId };
});
