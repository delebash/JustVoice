// SPDX-License-Identifier: MIT
//
// Voices store — single source of truth for the voice catalog. See
// stores/projects.js + docs/plans/2026-06-13-data-layer-rebuild.md.
//
// Voices change when engines load/unload (an engine brings its preset
// voices online), so the store reloads on the `jv:health-refresh`
// event that EnginesView/MCP dispatch after a load/unload.

import { defineStore } from "pinia";
import { ref } from "vue";

import { useApi } from "./api.js";

export const useVoicesStore = defineStore("voices", () => {
  const items = ref([]);
  const loaded = ref(false);
  let _inflight = null;

  // Subscribed at store creation — see the note in stores/engines.js. A
  // subscription that only happened inside ensureLoaded() meant a view
  // calling reload() directly never heard an engine load, so its preset
  // voices never appeared.
  window.addEventListener("jv:health-refresh", () => { void reload(); });

  // Failure leaves `loaded` false so the next caller retries — see the note in
  // stores/personas.js: marking a failed load as loaded poisons every later
  // id→name lookup for the whole session.
  async function reload() {
    const r = await useApi().safeRequest("/v1/voices", null);
    if (!r) return items.value;
    items.value = r.voices ?? [];
    loaded.value = true;
    return items.value;
  }

  function ensureLoaded() {
    if (loaded.value) return Promise.resolve(items.value);
    if (!_inflight) _inflight = reload().finally(() => { _inflight = null; });
    return _inflight;
  }

  function byId(id) {
    return items.value.find((v) => v.id === id) || null;
  }

  return { items, loaded, reload, ensureLoaded, byId };
});
