// SPDX-License-Identifier: MIT
//
// Projects store — the single source of truth for the project list.
// Every view that shows projects reads `items` from here; nobody keeps
// a private `ref([])` copy. Mutations elsewhere call `reload()`, and
// because all consumers share this one reactive list, they all update.
//
// See docs/plans/2026-06-13-data-layer-rebuild.md for the why. Key
// rule: refs are returned DIRECTLY (Pinia auto-unwraps at access
// sites). Do NOT wrap in computed(() => items.value) — that layer
// silently failed to propagate updates in the prior attempt.

import { defineStore } from "pinia";
import { ref } from "vue";

import { projectsService } from "../services/projects.js";

export const useProjectsStore = defineStore("projects", () => {
  const items = ref([]);
  const loaded = ref(false);
  let _inflight = null;

  async function reload() {
    const res = await projectsService.list();
    items.value = res?.projects ?? [];
    loaded.value = true;
    return items.value;
  }

  // Load once; concurrent callers share the in-flight promise. Views
  // call this in onMounted — first one loads, the rest are no-ops.
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
